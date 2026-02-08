import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { generateDocumentNumber } from './document-number.service.js';
import { addStock } from './inventory.service.js';
import { NotFoundError, BusinessRuleError } from '@nit-scs/shared';
import { assertTransition } from '@nit-scs/shared';

const DOC_TYPE = 'mrv';

const LIST_INCLUDE = {
  project: { select: { id: true, projectName: true, projectCode: true } },
  toWarehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
  fromWarehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
  returnedBy: { select: { id: true, fullName: true } },
  _count: { select: { mrvLines: true } },
} satisfies Prisma.MrvInclude;

const DETAIL_INCLUDE = {
  mrvLines: {
    include: {
      item: { select: { id: true, itemCode: true, itemDescription: true } },
      uom: { select: { id: true, uomCode: true, uomName: true } },
    },
  },
  project: true,
  toWarehouse: true,
  fromWarehouse: true,
  returnedBy: { select: { id: true, fullName: true, email: true } },
  receivedBy: { select: { id: true, fullName: true, email: true } },
  originalMirv: { select: { id: true, mirvNumber: true } },
} satisfies Prisma.MrvInclude;

export async function list(params: {
  skip: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
  search?: string;
  status?: string;
}) {
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [{ mrvNumber: { contains: params.search, mode: 'insensitive' } }];
  }
  if (params.status) where.status = params.status;

  const [data, total] = await Promise.all([
    prisma.mrv.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip: params.skip,
      take: params.pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.mrv.count({ where }),
  ]);
  return { data, total };
}

export async function getById(id: string) {
  const mrv = await prisma.mrv.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!mrv) throw new NotFoundError('MRV', id);
  return mrv;
}

export async function create(headerData: Record<string, unknown>, lines: Record<string, unknown>[], userId: string) {
  return prisma.$transaction(async tx => {
    const mrvNumber = await generateDocumentNumber('mrv');
    return tx.mrv.create({
      data: {
        mrvNumber,
        returnType: headerData.returnType as string,
        projectId: headerData.projectId as string,
        fromWarehouseId: headerData.fromWarehouseId as string,
        toWarehouseId: headerData.toWarehouseId as string,
        returnedById: userId,
        returnDate: new Date(headerData.returnDate as string),
        reason: (headerData.reason as string) ?? null,
        originalMirvId: (headerData.originalMirvId as string) ?? null,
        status: 'draft',
        notes: (headerData.notes as string) ?? null,
        mrvLines: {
          create: lines.map(line => ({
            itemId: line.itemId as string,
            qtyReturned: line.qtyReturned as number,
            uomId: line.uomId as string,
            condition: line.condition as string,
            notes: (line.notes as string) ?? null,
          })),
        },
      },
      include: {
        mrvLines: true,
        project: { select: { id: true, projectName: true } },
        toWarehouse: { select: { id: true, warehouseName: true } },
      },
    });
  });
}

export async function update(id: string, data: Record<string, unknown>) {
  const existing = await prisma.mrv.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('MRV', id);
  if (existing.status !== 'draft') throw new BusinessRuleError('Only draft MRVs can be updated');

  const updated = await prisma.mrv.update({
    where: { id },
    data: {
      ...data,
      ...(data.returnDate ? { returnDate: new Date(data.returnDate as string) } : {}),
    },
  });
  return { existing, updated };
}

export async function submit(id: string) {
  const mrv = await prisma.mrv.findUnique({ where: { id } });
  if (!mrv) throw new NotFoundError('MRV', id);
  assertTransition(DOC_TYPE, mrv.status, 'pending');

  return prisma.mrv.update({ where: { id: mrv.id }, data: { status: 'pending' } });
}

export async function receive(id: string, userId: string) {
  const mrv = await prisma.mrv.findUnique({ where: { id } });
  if (!mrv) throw new NotFoundError('MRV', id);
  assertTransition(DOC_TYPE, mrv.status, 'received');

  return prisma.mrv.update({
    where: { id: mrv.id },
    data: { status: 'received', receivedById: userId, receivedDate: new Date() },
  });
}

export async function complete(id: string, userId: string) {
  const mrv = await prisma.mrv.findUnique({
    where: { id },
    include: { mrvLines: true },
  });
  if (!mrv) throw new NotFoundError('MRV', id);
  assertTransition(DOC_TYPE, mrv.status, 'completed');

  await prisma.mrv.update({ where: { id: mrv.id }, data: { status: 'completed' } });

  const goodLines = mrv.mrvLines.filter(l => l.condition === 'good');
  for (const line of goodLines) {
    await addStock({
      itemId: line.itemId,
      warehouseId: mrv.toWarehouseId,
      qty: Number(line.qtyReturned),
      performedById: userId,
    });
  }

  return {
    id: mrv.id,
    toWarehouseId: mrv.toWarehouseId,
    goodLinesRestocked: goodLines.length,
    totalLines: mrv.mrvLines.length,
  };
}
