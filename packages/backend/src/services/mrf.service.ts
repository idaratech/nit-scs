import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { generateDocumentNumber } from './document-number.service.js';
import { getStockLevel } from './inventory.service.js';
import { NotFoundError, BusinessRuleError } from '@nit-scs/shared';
import { assertTransition } from '@nit-scs/shared';

const DOC_TYPE = 'mrf';

const LIST_INCLUDE = {
  project: { select: { id: true, projectName: true, projectCode: true } },
  requestedBy: { select: { id: true, fullName: true } },
  reviewedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  _count: { select: { mrfLines: true } },
} satisfies Prisma.MaterialRequisitionInclude;

const DETAIL_INCLUDE = {
  mrfLines: {
    include: {
      item: { select: { id: true, itemCode: true, itemDescription: true } },
      uom: { select: { id: true, uomCode: true, uomName: true } },
      mirvLine: { select: { id: true, qtyIssued: true } },
    },
  },
  project: true,
  requestedBy: { select: { id: true, fullName: true, email: true } },
  reviewedBy: { select: { id: true, fullName: true, email: true } },
  approvedBy: { select: { id: true, fullName: true, email: true } },
  mirv: { select: { id: true, mirvNumber: true, status: true } },
} satisfies Prisma.MaterialRequisitionInclude;

export async function list(params: {
  skip: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
  search?: string;
  status?: string;
  projectId?: string;
}) {
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { mrfNumber: { contains: params.search, mode: 'insensitive' } },
      { project: { projectName: { contains: params.search, mode: 'insensitive' } } },
    ];
  }
  if (params.status) where.status = params.status;
  if (params.projectId) where.projectId = params.projectId;

  const [data, total] = await Promise.all([
    prisma.materialRequisition.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip: params.skip,
      take: params.pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.materialRequisition.count({ where }),
  ]);
  return { data, total };
}

export async function getById(id: string) {
  const mrf = await prisma.materialRequisition.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!mrf) throw new NotFoundError('Material Requisition', id);
  return mrf;
}

export async function create(headerData: Record<string, unknown>, lines: Record<string, unknown>[], userId: string) {
  return prisma.$transaction(async tx => {
    const mrfNumber = await generateDocumentNumber('mrf');

    let totalEstimatedValue = 0;
    for (const line of lines) {
      if (line.itemId) {
        const item = await tx.item.findUnique({
          where: { id: line.itemId as string },
          select: { standardCost: true },
        });
        if (item?.standardCost) {
          totalEstimatedValue += Number(item.standardCost) * (line.qtyRequested as number);
        }
      }
    }

    return tx.materialRequisition.create({
      data: {
        mrfNumber,
        requestDate: new Date(headerData.requestDate as string),
        requiredDate: headerData.requiredDate ? new Date(headerData.requiredDate as string) : null,
        projectId: headerData.projectId as string,
        department: (headerData.department as string) ?? null,
        requestedById: userId,
        deliveryPoint: (headerData.deliveryPoint as string) ?? null,
        workOrder: (headerData.workOrder as string) ?? null,
        drawingReference: (headerData.drawingReference as string) ?? null,
        priority: (headerData.priority as string) ?? 'medium',
        totalEstimatedValue,
        status: 'draft',
        notes: (headerData.notes as string) ?? null,
        mrfLines: {
          create: lines.map(line => ({
            itemId: (line.itemId as string) ?? null,
            itemDescription: (line.itemDescription as string) ?? null,
            category: (line.category as string) ?? null,
            qtyRequested: line.qtyRequested as number,
            uomId: (line.uomId as string) ?? null,
            source: (line.source as string) ?? 'tbd',
            notes: (line.notes as string) ?? null,
          })),
        },
      },
      include: {
        mrfLines: true,
        project: { select: { id: true, projectName: true } },
      },
    });
  });
}

export async function update(id: string, data: Record<string, unknown>) {
  const existing = await prisma.materialRequisition.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Material Requisition', id);
  if (existing.status !== 'draft') throw new BusinessRuleError('Only draft MRFs can be updated');

  const updated = await prisma.materialRequisition.update({
    where: { id },
    data: {
      ...data,
      ...(data.requestDate ? { requestDate: new Date(data.requestDate as string) } : {}),
      ...(data.requiredDate ? { requiredDate: new Date(data.requiredDate as string) } : {}),
    },
  });
  return { existing, updated };
}

export async function submit(id: string) {
  const mrf = await prisma.materialRequisition.findUnique({ where: { id } });
  if (!mrf) throw new NotFoundError('Material Requisition', id);
  assertTransition(DOC_TYPE, mrf.status, 'submitted');
  return prisma.materialRequisition.update({ where: { id: mrf.id }, data: { status: 'submitted' } });
}

export async function review(id: string, userId: string) {
  const mrf = await prisma.materialRequisition.findUnique({ where: { id } });
  if (!mrf) throw new NotFoundError('Material Requisition', id);
  assertTransition(DOC_TYPE, mrf.status, 'under_review');

  return prisma.materialRequisition.update({
    where: { id: mrf.id },
    data: { status: 'under_review', reviewedById: userId, reviewDate: new Date() },
  });
}

export async function approve(id: string, userId: string) {
  const mrf = await prisma.materialRequisition.findUnique({ where: { id } });
  if (!mrf) throw new NotFoundError('Material Requisition', id);
  assertTransition(DOC_TYPE, mrf.status, 'approved');

  return prisma.materialRequisition.update({
    where: { id: mrf.id },
    data: { status: 'approved', approvedById: userId, approvalDate: new Date() },
  });
}

export async function checkStock(id: string) {
  const mrf = await prisma.materialRequisition.findUnique({
    where: { id },
    include: {
      mrfLines: true,
      project: { select: { id: true, warehouses: { select: { id: true } } } },
    },
  });
  if (!mrf) throw new NotFoundError('Material Requisition', id);
  if (mrf.status !== 'approved') throw new BusinessRuleError('MRF must be approved to check stock');

  const stockResults: Array<{ lineId: string; itemId: string | null; available: number; source: string }> = [];

  for (const line of mrf.mrfLines) {
    if (!line.itemId) {
      stockResults.push({ lineId: line.id, itemId: null, available: 0, source: 'purchase_required' });
      continue;
    }

    let totalAvailable = 0;
    const projectWarehouses = mrf.project?.warehouses ?? [];
    for (const wh of projectWarehouses) {
      const stock = await getStockLevel(line.itemId, wh.id);
      totalAvailable += stock.available;
    }

    const qtyNeeded = Number(line.qtyRequested);
    const source = totalAvailable >= qtyNeeded ? 'from_stock' : totalAvailable > 0 ? 'both' : 'purchase_required';

    await prisma.mrfLine.update({
      where: { id: line.id },
      data: {
        source,
        qtyFromStock: Math.min(totalAvailable, qtyNeeded),
        qtyFromPurchase: Math.max(0, qtyNeeded - totalAvailable),
      },
    });

    stockResults.push({ lineId: line.id, itemId: line.itemId, available: totalAvailable, source });
  }

  const updated = await prisma.materialRequisition.update({
    where: { id: mrf.id },
    data: { status: 'checking_stock' },
  });

  return { id: mrf.id, status: updated.status, stockResults };
}

export async function convertToMirv(id: string, userId: string, warehouseIdOverride?: string) {
  const mrf = await prisma.materialRequisition.findUnique({
    where: { id },
    include: {
      mrfLines: true,
      project: { select: { id: true, warehouses: { select: { id: true }, take: 1 } } },
    },
  });
  if (!mrf) throw new NotFoundError('Material Requisition', id);
  if (mrf.status !== 'checking_stock' && mrf.status !== 'approved') {
    throw new BusinessRuleError('MRF must be in checking_stock or approved status to convert to MIRV');
  }

  const fromStockLines = mrf.mrfLines.filter(l => l.source === 'from_stock' || l.source === 'both');

  if (fromStockLines.length === 0) {
    const updated = await prisma.materialRequisition.update({
      where: { id: mrf.id },
      data: { status: 'needs_purchase' },
    });
    return { id: mrf.id, status: updated.status, mirv: null };
  }

  const warehouseId = warehouseIdOverride ?? mrf.project?.warehouses[0]?.id;
  if (!warehouseId) throw new BusinessRuleError('No warehouse specified and project has no warehouses');

  const result = await prisma.$transaction(async tx => {
    const mirvNumber = await generateDocumentNumber('mirv');
    const mirv = await tx.mirv.create({
      data: {
        mirvNumber,
        projectId: mrf.projectId,
        warehouseId,
        requestedById: userId,
        requestDate: new Date(),
        priority: mrf.priority === 'urgent' ? 'urgent' : 'normal',
        status: 'draft',
        mrfId: mrf.id,
        notes: `Auto-created from MRF ${mrf.mrfNumber}`,
        mirvLines: {
          create: fromStockLines.map(line => ({
            itemId: line.itemId!,
            qtyRequested: line.qtyFromStock && Number(line.qtyFromStock) > 0 ? line.qtyFromStock : line.qtyRequested,
            notes: line.notes ?? null,
          })),
        },
      },
      include: { mirvLines: true },
    });

    for (let i = 0; i < fromStockLines.length; i++) {
      const mrfLine = fromStockLines[i];
      const mirvLine = mirv.mirvLines[i];
      if (mrfLine && mirvLine) {
        await tx.mrfLine.update({ where: { id: mrfLine.id }, data: { mirvLineId: mirvLine.id } });
      }
    }

    const allFromStock = mrf.mrfLines.every(l => l.source === 'from_stock');
    const newStatus = allFromStock ? 'from_stock' : 'needs_purchase';
    await tx.materialRequisition.update({
      where: { id: mrf.id },
      data: { status: newStatus, mirvId: mirv.id },
    });

    return { mirv, newStatus };
  });

  return {
    id: mrf.id,
    status: result.newStatus,
    mirv: { id: result.mirv.id, mirvNumber: result.mirv.mirvNumber },
  };
}

export async function fulfill(id: string) {
  const mrf = await prisma.materialRequisition.findUnique({ where: { id } });
  if (!mrf) throw new NotFoundError('Material Requisition', id);

  const fulfillable = ['from_stock', 'needs_purchase', 'partially_fulfilled'];
  if (!fulfillable.includes(mrf.status)) {
    throw new BusinessRuleError(`MRF cannot be fulfilled from status: ${mrf.status}`);
  }

  return prisma.materialRequisition.update({
    where: { id: mrf.id },
    data: { status: 'fulfilled', fulfillmentDate: new Date() },
  });
}

export async function reject(id: string) {
  const mrf = await prisma.materialRequisition.findUnique({ where: { id } });
  if (!mrf) throw new NotFoundError('Material Requisition', id);

  const rejectable = ['submitted', 'under_review'];
  if (!rejectable.includes(mrf.status)) {
    throw new BusinessRuleError(`MRF cannot be rejected from status: ${mrf.status}`);
  }

  return prisma.materialRequisition.update({ where: { id: mrf.id }, data: { status: 'rejected' } });
}

export async function cancel(id: string) {
  const mrf = await prisma.materialRequisition.findUnique({ where: { id } });
  if (!mrf) throw new NotFoundError('Material Requisition', id);

  const nonCancellable = ['fulfilled', 'cancelled'];
  if (nonCancellable.includes(mrf.status)) {
    throw new BusinessRuleError(`MRF cannot be cancelled from status: ${mrf.status}`);
  }

  return prisma.materialRequisition.update({ where: { id: mrf.id }, data: { status: 'cancelled' } });
}
