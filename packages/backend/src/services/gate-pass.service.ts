import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { generateDocumentNumber } from './document-number.service.js';
import { NotFoundError, BusinessRuleError } from '@nit-scs/shared';
import { assertTransition } from '@nit-scs/shared';

const DOC_TYPE = 'gate_pass';

const LIST_INCLUDE = {
  warehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
  project: { select: { id: true, projectName: true, projectCode: true } },
  issuedBy: { select: { id: true, fullName: true } },
  _count: { select: { gatePassItems: true } },
} satisfies Prisma.GatePassInclude;

const DETAIL_INCLUDE = {
  gatePassItems: {
    include: {
      item: { select: { id: true, itemCode: true, itemDescription: true } },
      uom: { select: { id: true, uomCode: true, uomName: true } },
    },
  },
  warehouse: true,
  mirv: { select: { id: true, mirvNumber: true, status: true } },
  project: true,
  issuedBy: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.GatePassInclude;

export async function list(params: {
  skip: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
  search?: string;
  status?: string;
  passType?: string;
}) {
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { gatePassNumber: { contains: params.search, mode: 'insensitive' } },
      { driverName: { contains: params.search, mode: 'insensitive' } },
      { vehicleNumber: { contains: params.search, mode: 'insensitive' } },
    ];
  }
  if (params.status) where.status = params.status;
  if (params.passType) where.passType = params.passType;

  const [data, total] = await Promise.all([
    prisma.gatePass.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip: params.skip,
      take: params.pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.gatePass.count({ where }),
  ]);
  return { data, total };
}

export async function getById(id: string) {
  const gp = await prisma.gatePass.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!gp) throw new NotFoundError('Gate Pass', id);
  return gp;
}

export async function create(headerData: Record<string, unknown>, items: Record<string, unknown>[], userId: string) {
  return prisma.$transaction(async tx => {
    const gatePassNumber = await generateDocumentNumber('gatepass');
    return tx.gatePass.create({
      data: {
        gatePassNumber,
        passType: headerData.passType as string,
        mirvId: (headerData.mirvId as string) ?? null,
        projectId: (headerData.projectId as string) ?? null,
        warehouseId: headerData.warehouseId as string,
        vehicleNumber: headerData.vehicleNumber as string,
        driverName: headerData.driverName as string,
        driverIdNumber: (headerData.driverIdNumber as string) ?? null,
        destination: headerData.destination as string,
        purpose: (headerData.purpose as string) ?? null,
        issueDate: new Date(headerData.issueDate as string),
        validUntil: headerData.validUntil ? new Date(headerData.validUntil as string) : null,
        status: 'draft',
        issuedById: userId,
        notes: (headerData.notes as string) ?? null,
        gatePassItems: {
          create: items.map(item => ({
            itemId: item.itemId as string,
            quantity: item.quantity as number,
            uomId: item.uomId as string,
            description: (item.description as string) ?? null,
          })),
        },
      },
      include: {
        gatePassItems: true,
        warehouse: { select: { id: true, warehouseName: true } },
      },
    });
  });
}

export async function update(id: string, data: Record<string, unknown>) {
  const existing = await prisma.gatePass.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Gate Pass', id);
  if (existing.status !== 'draft') throw new BusinessRuleError('Only draft Gate Passes can be updated');

  const updated = await prisma.gatePass.update({
    where: { id },
    data: {
      ...data,
      ...(data.issueDate ? { issueDate: new Date(data.issueDate as string) } : {}),
      ...(data.validUntil ? { validUntil: new Date(data.validUntil as string) } : {}),
    },
  });
  return { existing, updated };
}

export async function submit(id: string) {
  const gp = await prisma.gatePass.findUnique({ where: { id } });
  if (!gp) throw new NotFoundError('Gate Pass', id);
  assertTransition(DOC_TYPE, gp.status, 'pending');
  return prisma.gatePass.update({ where: { id: gp.id }, data: { status: 'pending' } });
}

export async function approve(id: string) {
  const gp = await prisma.gatePass.findUnique({ where: { id } });
  if (!gp) throw new NotFoundError('Gate Pass', id);
  assertTransition(DOC_TYPE, gp.status, 'approved');
  return prisma.gatePass.update({ where: { id: gp.id }, data: { status: 'approved' } });
}

export async function release(id: string, securityOfficer?: string) {
  const gp = await prisma.gatePass.findUnique({ where: { id } });
  if (!gp) throw new NotFoundError('Gate Pass', id);
  assertTransition(DOC_TYPE, gp.status, 'released');

  return prisma.gatePass.update({
    where: { id: gp.id },
    data: { status: 'released', exitTime: new Date(), securityOfficer: securityOfficer ?? null },
  });
}

export async function returnPass(id: string) {
  const gp = await prisma.gatePass.findUnique({ where: { id } });
  if (!gp) throw new NotFoundError('Gate Pass', id);
  assertTransition(DOC_TYPE, gp.status, 'returned');

  return prisma.gatePass.update({
    where: { id: gp.id },
    data: { status: 'returned', returnTime: new Date() },
  });
}

export async function cancel(id: string) {
  const gp = await prisma.gatePass.findUnique({ where: { id } });
  if (!gp) throw new NotFoundError('Gate Pass', id);

  const nonCancellable = ['released', 'returned', 'cancelled'];
  if (nonCancellable.includes(gp.status)) {
    throw new BusinessRuleError(`Gate Pass cannot be cancelled from status: ${gp.status}`);
  }

  return prisma.gatePass.update({ where: { id: gp.id }, data: { status: 'cancelled' } });
}
