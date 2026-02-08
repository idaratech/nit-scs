import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../utils/prisma.js';
import { sendSuccess, sendCreated, sendError } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { paginate } from '../middleware/pagination.js';
import { validate } from '../middleware/validate.js';
import { createAuditLog } from '../services/audit.service.js';
import { generateDocumentNumber } from '../services/document-number.service.js';
import { addStock, deductStock } from '../services/inventory.service.js';
import { emitToDocument, emitToAll } from '../socket/setup.js';
import { stockTransferCreateSchema, stockTransferUpdateSchema } from '../schemas/logistics.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List Stock Transfers ─────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { transferNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const transferTypeFilter = req.query.transferType as string | undefined;
    if (transferTypeFilter) where.transferType = transferTypeFilter;

    const [data, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          fromWarehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
          toWarehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
          fromProject: { select: { id: true, projectName: true, projectCode: true } },
          toProject: { select: { id: true, projectName: true, projectCode: true } },
          requestedBy: { select: { id: true, fullName: true } },
          _count: { select: { stockTransferLines: true } },
        },
      }),
      prisma.stockTransfer.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single Stock Transfer ────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id as string },
      include: {
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
      },
    });

    if (!transfer) {
      sendError(res, 404, 'Stock Transfer not found');
      return;
    }

    sendSuccess(res, transfer);
  } catch (err) {
    next(err);
  }
});

// ── POST / — Create Stock Transfer ──────────────────────────────────

router.post('/', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), validate(stockTransferCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lines, ...headerData } = req.body;

    const transfer = await prisma.$transaction(async (tx) => {
      const transferNumber = await generateDocumentNumber('stock_transfer');

      const created = await tx.stockTransfer.create({
        data: {
          transferNumber,
          transferType: headerData.transferType,
          fromWarehouseId: headerData.fromWarehouseId,
          toWarehouseId: headerData.toWarehouseId,
          fromProjectId: headerData.fromProjectId ?? null,
          toProjectId: headerData.toProjectId ?? null,
          requestedById: req.user!.userId,
          transferDate: new Date(headerData.transferDate),
          status: 'draft',
          notes: headerData.notes ?? null,
          stockTransferLines: {
            create: lines.map((line: Record<string, unknown>) => ({
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

      return created;
    });

    await createAuditLog({
      tableName: 'stock_transfers',
      recordId: transfer.id,
      action: 'create',
      newValues: { transferNumber: transfer.transferNumber, transferType: transfer.transferType, status: 'draft' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'stock_transfer:created', { id: transfer.id, transferNumber: transfer.transferNumber });
      emitToAll(io, 'entity:created', { entity: 'stock-transfers' });
    }

    sendCreated(res, transfer);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update Stock Transfer (draft only) ───────────────────

router.put('/:id', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), validate(stockTransferUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.stockTransfer.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'Stock Transfer not found');
      return;
    }
    if (existing.status !== 'draft') {
      sendError(res, 400, 'Only draft Stock Transfers can be updated');
      return;
    }

    const updated = await prisma.stockTransfer.update({
      where: { id: req.params.id as string },
      data: {
        ...req.body,
        ...(req.body.transferDate ? { transferDate: new Date(req.body.transferDate) } : {}),
      },
    });

    await createAuditLog({
      tableName: 'stock_transfers',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'entity:updated', { entity: 'stock-transfers' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/submit — Submit for approval ──────────────────────────

router.post('/:id/submit', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id as string } });

    if (!transfer) {
      sendError(res, 404, 'Stock Transfer not found');
      return;
    }
    if (transfer.status !== 'draft') {
      sendError(res, 400, 'Only draft Stock Transfers can be submitted');
      return;
    }

    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: 'pending' },
    });

    await createAuditLog({
      tableName: 'stock_transfers',
      recordId: transfer.id,
      action: 'update',
      newValues: { status: 'pending' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, transfer.id, 'stock_transfer:submitted', { id: transfer.id, status: 'pending' });
      emitToAll(io, 'document:status', { documentType: 'stock-transfers', documentId: transfer.id, status: 'pending' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/approve — Approve ─────────────────────────────────────

router.post('/:id/approve', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id as string } });

    if (!transfer) {
      sendError(res, 404, 'Stock Transfer not found');
      return;
    }
    if (transfer.status !== 'pending') {
      sendError(res, 400, 'Stock Transfer must be pending to approve');
      return;
    }

    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: 'approved' },
    });

    await createAuditLog({
      tableName: 'stock_transfers',
      recordId: transfer.id,
      action: 'update',
      newValues: { status: 'approved' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, transfer.id, 'stock_transfer:approved', { id: transfer.id, status: 'approved' });
      emitToAll(io, 'document:status', { documentType: 'stock-transfers', documentId: transfer.id, status: 'approved' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/ship — Ship (deduct from source warehouse) ───────────

router.post('/:id/ship', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id as string },
      include: { stockTransferLines: true },
    });

    if (!transfer) {
      sendError(res, 404, 'Stock Transfer not found');
      return;
    }
    if (transfer.status !== 'approved') {
      sendError(res, 400, 'Stock Transfer must be approved to ship');
      return;
    }

    // Deduct stock from source warehouse for each line
    for (const line of transfer.stockTransferLines) {
      await deductStock(
        line.itemId,
        transfer.fromWarehouseId,
        Number(line.quantity),
        line.id, // use line ID as mirvLineId placeholder for lot consumption tracking
      );
    }

    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'shipped',
        shippedDate: new Date(),
      },
    });

    await createAuditLog({
      tableName: 'stock_transfers',
      recordId: transfer.id,
      action: 'update',
      newValues: { status: 'shipped', shippedDate: updated.shippedDate?.toISOString() },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, transfer.id, 'stock_transfer:shipped', { id: transfer.id, status: 'shipped' });
      emitToAll(io, 'document:status', { documentType: 'stock-transfers', documentId: transfer.id, status: 'shipped' });
      emitToAll(io, 'inventory:updated', { warehouseId: transfer.fromWarehouseId, transferId: transfer.id });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/receive — Receive (add to destination warehouse) ──────

router.post('/:id/receive', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id as string },
      include: { stockTransferLines: true },
    });

    if (!transfer) {
      sendError(res, 404, 'Stock Transfer not found');
      return;
    }
    if (transfer.status !== 'shipped') {
      sendError(res, 400, 'Stock Transfer must be shipped to receive');
      return;
    }

    // Add stock to destination warehouse for each line
    for (const line of transfer.stockTransferLines) {
      await addStock({
        itemId: line.itemId,
        warehouseId: transfer.toWarehouseId,
        qty: Number(line.quantity),
        performedById: req.user!.userId,
      });
    }

    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'received',
        receivedDate: new Date(),
      },
    });

    await createAuditLog({
      tableName: 'stock_transfers',
      recordId: transfer.id,
      action: 'update',
      newValues: { status: 'received', receivedDate: updated.receivedDate?.toISOString() },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, transfer.id, 'stock_transfer:received', { id: transfer.id, status: 'received' });
      emitToAll(io, 'document:status', { documentType: 'stock-transfers', documentId: transfer.id, status: 'received' });
      emitToAll(io, 'inventory:updated', { warehouseId: transfer.toWarehouseId, transferId: transfer.id });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/complete — Complete ───────────────────────────────────

router.post('/:id/complete', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id as string } });

    if (!transfer) {
      sendError(res, 404, 'Stock Transfer not found');
      return;
    }
    if (transfer.status !== 'received') {
      sendError(res, 400, 'Stock Transfer must be received to complete');
      return;
    }

    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: 'completed' },
    });

    await createAuditLog({
      tableName: 'stock_transfers',
      recordId: transfer.id,
      action: 'update',
      newValues: { status: 'completed' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, transfer.id, 'stock_transfer:completed', { id: transfer.id, status: 'completed' });
      emitToAll(io, 'document:status', { documentType: 'stock-transfers', documentId: transfer.id, status: 'completed' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/cancel — Cancel ───────────────────────────────────────

router.post('/:id/cancel', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id as string } });

    if (!transfer) {
      sendError(res, 404, 'Stock Transfer not found');
      return;
    }

    const nonCancellable = ['shipped', 'received', 'completed', 'cancelled'];
    if (nonCancellable.includes(transfer.status)) {
      sendError(res, 400, `Stock Transfer cannot be cancelled from status: ${transfer.status}`);
      return;
    }

    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: 'cancelled' },
    });

    await createAuditLog({
      tableName: 'stock_transfers',
      recordId: transfer.id,
      action: 'update',
      newValues: { status: 'cancelled' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, transfer.id, 'stock_transfer:cancelled', { id: transfer.id, status: 'cancelled' });
      emitToAll(io, 'document:status', { documentType: 'stock-transfers', documentId: transfer.id, status: 'cancelled' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

export default router;
