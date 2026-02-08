import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { generateDocumentNumber } from './document-number.service.js';
import { addStock, deductStock } from './inventory.service.js';
import { NotFoundError, BusinessRuleError } from '@nit-scs/shared';
import { assertTransition } from '@nit-scs/shared';

const DOC_TYPE = 'stock_transfer';

const LIST_INCLUDE = {
  fromWarehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
  toWarehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
  fromProject: { select: { id: true, projectName: true, projectCode: true } },
  toProject: { select: { id: true, projectName: true, projectCode: true } },
  requestedBy: { select: { id: true, fullName: true } },
  _count: { select: { stockTransferLines: true } },
} satisfies Prisma.StockTransferInclude;

const DETAIL_INCLUDE = {
  stockTransferLines: {
    include: {
      item: { select: { id: true, itemCode: true, itemDescription: true } },
      uom: { select: { id: true, uomCode: true, uomName: true } },
    },
  },
  fromWarehouse: true,
  toWarehouse: true,
  fromProject: true,
  toProject: true,
  requestedBy: { select: { id: true, fullName: true, email: true } },
  sourceMrv: { select: { id: true, mrvNumber: true, status: true } },
  destinationMirv: { select: { id: true, mirvNumber: true, status: true } },
  transportJo: { select: { id: true, joNumber: true, status: true } },
  gatePass: { select: { id: true, gatePassNumber: true, status: true } },
} satisfies Prisma.StockTransferInclude;

export async function list(params: {
  skip: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
  search?: string;
  status?: string;
  transferType?: string;
}) {
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [{ transferNumber: { contains: params.search, mode: 'insensitive' } }];
  }
  if (params.status) where.status = params.status;
  if (params.transferType) where.transferType = params.transferType;

  const [data, total] = await Promise.all([
    prisma.stockTransfer.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip: params.skip,
      take: params.pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.stockTransfer.count({ where }),
  ]);
  return { data, total };
}

export async function getById(id: string) {
  const st = await prisma.stockTransfer.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!st) throw new NotFoundError('Stock Transfer', id);
  return st;
}

export async function create(headerData: Record<string, unknown>, lines: Record<string, unknown>[], userId: string) {
  return prisma.$transaction(async tx => {
    const transferNumber = await generateDocumentNumber('stock_transfer');
    return tx.stockTransfer.create({
      data: {
        transferNumber,
        transferType: headerData.transferType as string,
        fromWarehouseId: headerData.fromWarehouseId as string,
        toWarehouseId: headerData.toWarehouseId as string,
        fromProjectId: (headerData.fromProjectId as string) ?? null,
        toProjectId: (headerData.toProjectId as string) ?? null,
        requestedById: userId,
        transferDate: new Date(headerData.transferDate as string),
        status: 'draft',
        notes: (headerData.notes as string) ?? null,
        stockTransferLines: {
          create: lines.map(line => ({
            itemId: line.itemId as string,
            quantity: line.quantity as number,
            uomId: line.uomId as string,
            condition: (line.condition as string) ?? 'good',
          })),
        },
      },
      include: {
        stockTransferLines: true,
        fromWarehouse: { select: { id: true, warehouseName: true } },
        toWarehouse: { select: { id: true, warehouseName: true } },
      },
    });
  });
}

export async function update(id: string, data: Record<string, unknown>) {
  const existing = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Stock Transfer', id);
  if (existing.status !== 'draft') throw new BusinessRuleError('Only draft Stock Transfers can be updated');

  const updated = await prisma.stockTransfer.update({
    where: { id },
    data: {
      ...data,
      ...(data.transferDate ? { transferDate: new Date(data.transferDate as string) } : {}),
    },
  });
  return { existing, updated };
}

export async function submit(id: string) {
  const st = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!st) throw new NotFoundError('Stock Transfer', id);
  assertTransition(DOC_TYPE, st.status, 'pending');
  return prisma.stockTransfer.update({ where: { id: st.id }, data: { status: 'pending' } });
}

export async function approve(id: string) {
  const st = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!st) throw new NotFoundError('Stock Transfer', id);
  assertTransition(DOC_TYPE, st.status, 'approved');
  return prisma.stockTransfer.update({ where: { id: st.id }, data: { status: 'approved' } });
}

export async function ship(id: string) {
  const st = await prisma.stockTransfer.findUnique({
    where: { id },
    include: { stockTransferLines: true },
  });
  if (!st) throw new NotFoundError('Stock Transfer', id);
  assertTransition(DOC_TYPE, st.status, 'shipped');

  for (const line of st.stockTransferLines) {
    await deductStock(line.itemId, st.fromWarehouseId, Number(line.quantity), line.id);
  }

  const updated = await prisma.stockTransfer.update({
    where: { id: st.id },
    data: { status: 'shipped', shippedDate: new Date() },
  });

  return { updated, fromWarehouseId: st.fromWarehouseId };
}

export async function receive(id: string, userId: string) {
  const st = await prisma.stockTransfer.findUnique({
    where: { id },
    include: { stockTransferLines: true },
  });
  if (!st) throw new NotFoundError('Stock Transfer', id);
  assertTransition(DOC_TYPE, st.status, 'received');

  for (const line of st.stockTransferLines) {
    await addStock({
      itemId: line.itemId,
      warehouseId: st.toWarehouseId,
      qty: Number(line.quantity),
      performedById: userId,
    });
  }

  const updated = await prisma.stockTransfer.update({
    where: { id: st.id },
    data: { status: 'received', receivedDate: new Date() },
  });

  return { updated, toWarehouseId: st.toWarehouseId };
}

export async function complete(id: string) {
  const st = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!st) throw new NotFoundError('Stock Transfer', id);
  assertTransition(DOC_TYPE, st.status, 'completed');
  return prisma.stockTransfer.update({ where: { id: st.id }, data: { status: 'completed' } });
}

export async function cancel(id: string) {
  const st = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!st) throw new NotFoundError('Stock Transfer', id);

  const nonCancellable = ['shipped', 'received', 'completed', 'cancelled'];
  if (nonCancellable.includes(st.status)) {
    throw new BusinessRuleError(`Stock Transfer cannot be cancelled from status: ${st.status}`);
  }

  return prisma.stockTransfer.update({ where: { id: st.id }, data: { status: 'cancelled' } });
}
