import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { generateDocumentNumber } from './document-number.service.js';
import { addStock } from './inventory.service.js';
import { NotFoundError, BusinessRuleError } from '@nit-scs/shared';
import { assertTransition } from '@nit-scs/shared';

const DOC_TYPE = 'mrrv';

const LIST_INCLUDE = {
  supplier: { select: { id: true, supplierName: true, supplierCode: true } },
  warehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
  project: { select: { id: true, projectName: true, projectCode: true } },
  receivedBy: { select: { id: true, fullName: true } },
  _count: { select: { mrrvLines: true } },
} satisfies Prisma.MrrvInclude;

const DETAIL_INCLUDE = {
  mrrvLines: {
    include: {
      item: { select: { id: true, itemCode: true, itemDescription: true } },
      uom: { select: { id: true, uomCode: true, uomName: true } },
    },
  },
  supplier: true,
  warehouse: true,
  project: true,
  receivedBy: { select: { id: true, fullName: true, email: true } },
  qcInspector: { select: { id: true, fullName: true, email: true } },
  rfims: true,
  osdReports: true,
} satisfies Prisma.MrrvInclude;

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
    where.OR = [
      { mrrvNumber: { contains: params.search, mode: 'insensitive' } },
      { supplier: { supplierName: { contains: params.search, mode: 'insensitive' } } },
    ];
  }
  if (params.status) where.status = params.status;

  const [data, total] = await Promise.all([
    prisma.mrrv.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip: params.skip,
      take: params.pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.mrrv.count({ where }),
  ]);

  return { data, total };
}

export async function getById(id: string) {
  const mrrv = await prisma.mrrv.findUnique({
    where: { id },
    include: DETAIL_INCLUDE,
  });
  if (!mrrv) throw new NotFoundError('MRRV', id);
  return mrrv;
}

export async function create(headerData: Record<string, unknown>, lines: Record<string, unknown>[], userId: string) {
  const mrrv = await prisma.$transaction(async tx => {
    const mrrvNumber = await generateDocumentNumber('mrrv');

    let totalValue = 0;
    for (const line of lines) {
      if (line.unitCost && line.qtyReceived) {
        totalValue += (line.unitCost as number) * (line.qtyReceived as number);
      }
    }

    const hasOsd = lines.some(l => l.qtyDamaged && (l.qtyDamaged as number) > 0);

    const created = await tx.mrrv.create({
      data: {
        mrrvNumber,
        supplierId: headerData.supplierId as string,
        poNumber: (headerData.poNumber as string) ?? null,
        warehouseId: headerData.warehouseId as string,
        projectId: (headerData.projectId as string) ?? null,
        receivedById: userId,
        receiveDate: new Date(headerData.receiveDate as string),
        invoiceNumber: (headerData.invoiceNumber as string) ?? null,
        deliveryNote: (headerData.deliveryNote as string) ?? null,
        rfimRequired: (headerData.rfimRequired as boolean) ?? false,
        hasOsd,
        totalValue,
        status: 'draft',
        notes: (headerData.notes as string) ?? null,
        mrrvLines: {
          create: lines.map(line => ({
            itemId: line.itemId as string,
            qtyOrdered: (line.qtyOrdered as number) ?? null,
            qtyReceived: line.qtyReceived as number,
            qtyDamaged: (line.qtyDamaged as number) ?? 0,
            uomId: line.uomId as string,
            unitCost: (line.unitCost as number) ?? null,
            condition: (line.condition as string) ?? 'good',
            storageLocation: (line.storageLocation as string) ?? null,
            expiryDate: line.expiryDate ? new Date(line.expiryDate as string) : null,
            notes: (line.notes as string) ?? null,
          })),
        },
      },
      include: {
        mrrvLines: true,
        supplier: { select: { id: true, supplierName: true } },
        warehouse: { select: { id: true, warehouseName: true } },
      },
    });

    return created;
  });

  return mrrv;
}

export async function update(id: string, data: Record<string, unknown>) {
  const existing = await prisma.mrrv.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('MRRV', id);
  if (existing.status !== 'draft') {
    throw new BusinessRuleError('Only draft MRRVs can be updated');
  }

  const updated = await prisma.mrrv.update({
    where: { id },
    data: {
      ...data,
      ...(data.receiveDate ? { receiveDate: new Date(data.receiveDate as string) } : {}),
    },
  });

  return { existing, updated };
}

export async function submit(id: string) {
  const mrrv = await prisma.mrrv.findUnique({
    where: { id },
    include: { mrrvLines: true },
  });
  if (!mrrv) throw new NotFoundError('MRRV', id);
  assertTransition(DOC_TYPE, mrrv.status, 'pending_qc');

  await prisma.$transaction(async tx => {
    await tx.mrrv.update({
      where: { id: mrrv.id },
      data: { status: 'pending_qc' },
    });

    if (mrrv.rfimRequired) {
      const rfimNumber = await generateDocumentNumber('rfim');
      await tx.rfim.create({
        data: {
          rfimNumber,
          mrrvId: mrrv.id,
          requestDate: new Date(),
          status: 'pending',
        },
      });
    }

    const damagedLines = mrrv.mrrvLines.filter(l => Number(l.qtyDamaged ?? 0) > 0);
    if (damagedLines.length > 0) {
      const osdNumber = await generateDocumentNumber('osd');
      await tx.osdReport.create({
        data: {
          osdNumber,
          mrrvId: mrrv.id,
          poNumber: mrrv.poNumber,
          supplierId: mrrv.supplierId,
          warehouseId: mrrv.warehouseId,
          reportDate: new Date(),
          reportTypes: ['damage'],
          status: 'draft',
          osdLines: {
            create: damagedLines.map(line => ({
              itemId: line.itemId,
              uomId: line.uomId,
              mrrvLineId: line.id,
              qtyInvoice: line.qtyOrdered ?? line.qtyReceived,
              qtyReceived: line.qtyReceived,
              qtyDamaged: line.qtyDamaged ?? 0,
              damageType: 'physical',
              unitCost: line.unitCost,
            })),
          },
        },
      });
      await tx.mrrv.update({
        where: { id: mrrv.id },
        data: { hasOsd: true },
      });
    }
  });

  return { id: mrrv.id, rfimRequired: !!mrrv.rfimRequired };
}

export async function approveQc(id: string, userId: string) {
  const mrrv = await prisma.mrrv.findUnique({ where: { id } });
  if (!mrrv) throw new NotFoundError('MRRV', id);
  assertTransition(DOC_TYPE, mrrv.status, 'qc_approved');

  const updated = await prisma.mrrv.update({
    where: { id: mrrv.id },
    data: {
      status: 'qc_approved',
      qcInspectorId: userId,
      qcApprovedDate: new Date(),
    },
  });
  return updated;
}

export async function receive(id: string) {
  const mrrv = await prisma.mrrv.findUnique({ where: { id } });
  if (!mrrv) throw new NotFoundError('MRRV', id);
  assertTransition(DOC_TYPE, mrrv.status, 'received');

  const updated = await prisma.mrrv.update({
    where: { id: mrrv.id },
    data: { status: 'received' },
  });
  return updated;
}

export async function store(id: string, userId: string) {
  const mrrv = await prisma.mrrv.findUnique({
    where: { id },
    include: { mrrvLines: true },
  });
  if (!mrrv) throw new NotFoundError('MRRV', id);
  assertTransition(DOC_TYPE, mrrv.status, 'stored');

  await prisma.mrrv.update({
    where: { id: mrrv.id },
    data: { status: 'stored' },
  });

  for (const line of mrrv.mrrvLines) {
    const qtyToStore = Number(line.qtyReceived) - Number(line.qtyDamaged ?? 0);
    if (qtyToStore > 0) {
      await addStock({
        itemId: line.itemId,
        warehouseId: mrrv.warehouseId,
        qty: qtyToStore,
        unitCost: line.unitCost ? Number(line.unitCost) : undefined,
        supplierId: mrrv.supplierId,
        mrrvLineId: line.id,
        expiryDate: line.expiryDate ?? undefined,
        performedById: userId,
      });
    }
  }

  return { id: mrrv.id, warehouseId: mrrv.warehouseId, linesStored: mrrv.mrrvLines.length };
}
