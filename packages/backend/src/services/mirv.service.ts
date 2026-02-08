import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { generateDocumentNumber } from './document-number.service.js';
import { submitForApproval, processApproval } from './approval.service.js';
import { reserveStock, consumeReservation, releaseReservation } from './inventory.service.js';
import { NotFoundError, BusinessRuleError } from '@nit-scs/shared';
import { assertTransition } from '@nit-scs/shared';
import type { Server as SocketIOServer } from 'socket.io';

const DOC_TYPE = 'mirv';

const LIST_INCLUDE = {
  project: { select: { id: true, projectName: true, projectCode: true } },
  warehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
  requestedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  _count: { select: { mirvLines: true } },
} satisfies Prisma.MirvInclude;

const DETAIL_INCLUDE = {
  mirvLines: {
    include: {
      item: { select: { id: true, itemCode: true, itemDescription: true, standardCost: true } },
    },
  },
  project: true,
  warehouse: true,
  requestedBy: { select: { id: true, fullName: true, email: true } },
  approvedBy: { select: { id: true, fullName: true, email: true } },
  issuedBy: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.MirvInclude;

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
      { mirvNumber: { contains: params.search, mode: 'insensitive' } },
      { project: { projectName: { contains: params.search, mode: 'insensitive' } } },
    ];
  }
  if (params.status) where.status = params.status;

  const [data, total] = await Promise.all([
    prisma.mirv.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip: params.skip,
      take: params.pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.mirv.count({ where }),
  ]);
  return { data, total };
}

export async function getById(id: string) {
  const mirv = await prisma.mirv.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!mirv) throw new NotFoundError('MIRV', id);
  return mirv;
}

export async function create(headerData: Record<string, unknown>, lines: Record<string, unknown>[], userId: string) {
  const mirv = await prisma.$transaction(async tx => {
    const mirvNumber = await generateDocumentNumber('mirv');

    let estimatedValue = 0;
    for (const line of lines) {
      const item = await tx.item.findUnique({
        where: { id: line.itemId as string },
        select: { standardCost: true },
      });
      if (item?.standardCost) {
        estimatedValue += Number(item.standardCost) * (line.qtyRequested as number);
      }
    }

    return tx.mirv.create({
      data: {
        mirvNumber,
        projectId: headerData.projectId as string,
        warehouseId: headerData.warehouseId as string,
        locationOfWork: (headerData.locationOfWork as string) ?? null,
        requestedById: userId,
        requestDate: new Date(headerData.requestDate as string),
        requiredDate: headerData.requiredDate ? new Date(headerData.requiredDate as string) : null,
        priority: (headerData.priority as string) ?? 'normal',
        estimatedValue,
        status: 'draft',
        notes: (headerData.notes as string) ?? null,
        mirvLines: {
          create: lines.map(line => ({
            itemId: line.itemId as string,
            qtyRequested: line.qtyRequested as number,
            notes: (line.notes as string) ?? null,
          })),
        },
      },
      include: {
        mirvLines: true,
        project: { select: { id: true, projectName: true } },
        warehouse: { select: { id: true, warehouseName: true } },
      },
    });
  });
  return mirv;
}

export async function update(id: string, data: Record<string, unknown>) {
  const existing = await prisma.mirv.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('MIRV', id);
  if (existing.status !== 'draft') throw new BusinessRuleError('Only draft MIRVs can be updated');

  const updated = await prisma.mirv.update({
    where: { id },
    data: {
      ...data,
      ...(data.requestDate ? { requestDate: new Date(data.requestDate as string) } : {}),
      ...(data.requiredDate ? { requiredDate: new Date(data.requiredDate as string) } : {}),
    },
  });
  return { existing, updated };
}

export async function submit(id: string, userId: string, io?: SocketIOServer) {
  const mirv = await prisma.mirv.findUnique({ where: { id } });
  if (!mirv) throw new NotFoundError('MIRV', id);
  assertTransition(DOC_TYPE, mirv.status, 'pending_approval');

  const approval = await submitForApproval({
    documentType: 'mirv',
    documentId: mirv.id,
    amount: Number(mirv.estimatedValue ?? 0),
    submittedById: userId,
    io,
  });
  return { id: mirv.id, approverRole: approval.approverRole, slaHours: approval.slaHours };
}

export async function approve(
  id: string,
  action: 'approve' | 'reject',
  userId: string,
  comments?: string,
  io?: SocketIOServer,
) {
  const mirv = await prisma.mirv.findUnique({
    where: { id },
    include: { mirvLines: true },
  });
  if (!mirv) throw new NotFoundError('MIRV', id);
  if (mirv.status !== 'pending_approval') {
    throw new BusinessRuleError('MIRV must be pending approval');
  }

  await processApproval({
    documentType: 'mirv',
    documentId: mirv.id,
    action,
    processedById: userId,
    comments,
    io,
  });

  if (action === 'approve') {
    let allReserved = true;
    for (const line of mirv.mirvLines) {
      const reserved = await reserveStock(line.itemId, mirv.warehouseId, Number(line.qtyRequested));
      if (!reserved) allReserved = false;
      await prisma.mirvLine.update({
        where: { id: line.id },
        data: { qtyApproved: line.qtyRequested },
      });
    }
    await prisma.mirv.update({
      where: { id: mirv.id },
      data: { reservationStatus: allReserved ? 'reserved' : 'none' },
    });
  }

  return {
    id: mirv.id,
    action,
    status: action === 'approve' ? 'approved' : 'rejected',
    warehouseId: mirv.warehouseId,
  };
}

export async function issue(id: string, userId: string) {
  const mirv = await prisma.mirv.findUnique({
    where: { id },
    include: { mirvLines: true },
  });
  if (!mirv) throw new NotFoundError('MIRV', id);
  if (mirv.status !== 'approved' && mirv.status !== 'partially_issued') {
    throw new BusinessRuleError('MIRV must be approved or partially issued to issue materials');
  }

  let totalCost = 0;
  for (const line of mirv.mirvLines) {
    const qtyToIssue = Number(line.qtyApproved ?? line.qtyRequested);
    const result = await consumeReservation(line.itemId, mirv.warehouseId, qtyToIssue, line.id);
    totalCost += result.totalCost;
    await prisma.mirvLine.update({
      where: { id: line.id },
      data: {
        qtyIssued: qtyToIssue,
        unitCost: qtyToIssue > 0 ? result.totalCost / qtyToIssue : 0,
      },
    });
  }

  await prisma.mirv.update({
    where: { id: mirv.id },
    data: {
      status: 'issued',
      issuedById: userId,
      issuedDate: new Date(),
      reservationStatus: 'released',
    },
  });

  // Auto-create outbound GatePass
  const gatePassNumber = await generateDocumentNumber('gatepass');
  await prisma.gatePass.create({
    data: {
      gatePassNumber,
      passType: 'outbound',
      mirvId: mirv.id,
      projectId: mirv.projectId,
      warehouseId: mirv.warehouseId,
      vehicleNumber: 'TBD',
      driverName: 'TBD',
      destination: mirv.locationOfWork ?? 'Project Site',
      issueDate: new Date(),
      status: 'pending',
      issuedById: userId,
    },
  });

  return { id: mirv.id, totalCost, warehouseId: mirv.warehouseId };
}

export async function cancel(id: string) {
  const mirv = await prisma.mirv.findUnique({
    where: { id },
    include: { mirvLines: true },
  });
  if (!mirv) throw new NotFoundError('MIRV', id);

  const cancellableStatuses = ['approved', 'partially_issued', 'pending_approval'];
  if (!cancellableStatuses.includes(mirv.status)) {
    throw new BusinessRuleError(`MIRV cannot be cancelled from status: ${mirv.status}`);
  }

  if (mirv.reservationStatus === 'reserved') {
    for (const line of mirv.mirvLines) {
      await releaseReservation(line.itemId, mirv.warehouseId, Number(line.qtyApproved ?? line.qtyRequested));
    }
  }

  const updated = await prisma.mirv.update({
    where: { id: mirv.id },
    data: { status: 'cancelled', reservationStatus: 'released' },
  });

  return {
    updated,
    wasReserved: mirv.reservationStatus === 'reserved',
    warehouseId: mirv.warehouseId,
  };
}
