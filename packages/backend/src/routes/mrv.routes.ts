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
import { addStock } from '../services/inventory.service.js';
import { emitToDocument, emitToAll } from '../socket/setup.js';
import { mrvCreateSchema, mrvUpdateSchema } from '../schemas/document.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List MRVs ───────────────────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { mrvNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const [data, total] = await Promise.all([
      prisma.mrv.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          project: { select: { id: true, projectName: true, projectCode: true } },
          toWarehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
          fromWarehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
          returnedBy: { select: { id: true, fullName: true } },
          _count: { select: { mrvLines: true } },
        },
      }),
      prisma.mrv.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single MRV ──────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrv = await prisma.mrv.findUnique({
      where: { id: req.params.id as string },
      include: {
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
      },
    });

    if (!mrv) {
      sendError(res, 404, 'MRV not found');
      return;
    }

    sendSuccess(res, mrv);
  } catch (err) {
    next(err);
  }
});

// ── POST / — Create MRV ────────────────────────────────────────────────

router.post('/', authenticate, requireRole('admin', 'manager', 'site_engineer', 'warehouse_supervisor'), validate(mrvCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lines, ...headerData } = req.body;

    const mrv = await prisma.$transaction(async (tx) => {
      const mrvNumber = await generateDocumentNumber('mrv');

      const created = await tx.mrv.create({
        data: {
          mrvNumber,
          returnType: headerData.returnType,
          projectId: headerData.projectId,
          fromWarehouseId: headerData.fromWarehouseId,
          toWarehouseId: headerData.toWarehouseId,
          returnedById: req.user!.userId,
          returnDate: new Date(headerData.returnDate),
          reason: headerData.reason,
          originalMirvId: headerData.originalMirvId,
          status: 'draft',
          notes: headerData.notes,
          mrvLines: {
            create: lines.map((line: Record<string, unknown>) => ({
              itemId: line.itemId,
              qtyReturned: line.qtyReturned,
              uomId: line.uomId,
              condition: line.condition,
              notes: line.notes ?? null,
            })),
          },
        },
        include: {
          mrvLines: true,
          project: { select: { id: true, projectName: true } },
          toWarehouse: { select: { id: true, warehouseName: true } },
        },
      });

      return created;
    });

    await createAuditLog({
      tableName: 'mrv',
      recordId: mrv.id,
      action: 'create',
      newValues: { mrvNumber: mrv.mrvNumber, status: 'draft', returnType: mrv.returnType },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'mrv:created', { id: mrv.id, mrvNumber: mrv.mrvNumber });
      emitToAll(io, 'entity:created', { entity: 'mrv' });
    }

    sendCreated(res, mrv);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update MRV header (draft only) ──────────────────────────

router.put('/:id', authenticate, requireRole('admin', 'manager', 'site_engineer', 'warehouse_supervisor'), validate(mrvUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.mrv.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'MRV not found');
      return;
    }
    if (existing.status !== 'draft') {
      sendError(res, 400, 'Only draft MRVs can be updated');
      return;
    }

    const updated = await prisma.mrv.update({
      where: { id: req.params.id as string },
      data: {
        ...req.body,
        ...(req.body.returnDate ? { returnDate: new Date(req.body.returnDate) } : {}),
      },
    });

    await createAuditLog({
      tableName: 'mrv',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'entity:updated', { entity: 'mrv' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/submit — Submit MRV ──────────────────────────────────────

router.post('/:id/submit', authenticate, requireRole('admin', 'manager', 'site_engineer', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrv = await prisma.mrv.findUnique({ where: { id: req.params.id as string } });

    if (!mrv) {
      sendError(res, 404, 'MRV not found');
      return;
    }
    if (mrv.status !== 'draft') {
      sendError(res, 400, 'Only draft MRVs can be submitted');
      return;
    }

    const updated = await prisma.mrv.update({
      where: { id: mrv.id },
      data: { status: 'pending' },
    });

    await createAuditLog({
      tableName: 'mrv',
      recordId: mrv.id,
      action: 'update',
      newValues: { status: 'pending' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrv.id, 'mrv:submitted', { id: mrv.id, status: 'pending' });
      emitToAll(io, 'document:status', { documentType: 'mrv', documentId: mrv.id, status: 'pending' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/receive — Mark received ───────────────────────────────────

router.post('/:id/receive', authenticate, requireRole('admin', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrv = await prisma.mrv.findUnique({ where: { id: req.params.id as string } });

    if (!mrv) {
      sendError(res, 404, 'MRV not found');
      return;
    }
    if (mrv.status !== 'pending') {
      sendError(res, 400, 'MRV must be pending to receive');
      return;
    }

    const updated = await prisma.mrv.update({
      where: { id: mrv.id },
      data: {
        status: 'received',
        receivedById: req.user!.userId,
        receivedDate: new Date(),
      },
    });

    await createAuditLog({
      tableName: 'mrv',
      recordId: mrv.id,
      action: 'update',
      newValues: { status: 'received', receivedById: req.user!.userId },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrv.id, 'mrv:received', { id: mrv.id, status: 'received' });
      emitToAll(io, 'document:status', { documentType: 'mrv', documentId: mrv.id, status: 'received' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/complete — Complete MRV + add stock for good items ────────

router.post('/:id/complete', authenticate, requireRole('admin', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrv = await prisma.mrv.findUnique({
      where: { id: req.params.id as string },
      include: { mrvLines: true },
    });

    if (!mrv) {
      sendError(res, 404, 'MRV not found');
      return;
    }
    if (mrv.status !== 'received') {
      sendError(res, 400, 'MRV must be received before completing');
      return;
    }

    // Update status to completed
    await prisma.mrv.update({
      where: { id: mrv.id },
      data: { status: 'completed' },
    });

    // Add stock for lines with condition = 'good'
    const goodLines = mrv.mrvLines.filter(l => l.condition === 'good');
    for (const line of goodLines) {
      await addStock({
        itemId: line.itemId,
        warehouseId: mrv.toWarehouseId,
        qty: Number(line.qtyReturned),
        performedById: req.user!.userId,
      });
    }

    await createAuditLog({
      tableName: 'mrv',
      recordId: mrv.id,
      action: 'update',
      newValues: {
        status: 'completed',
        goodLinesRestocked: goodLines.length,
        totalLinesReturned: mrv.mrvLines.length,
      },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrv.id, 'mrv:completed', { id: mrv.id, status: 'completed' });
      emitToAll(io, 'document:status', { documentType: 'mrv', documentId: mrv.id, status: 'completed' });
      if (goodLines.length > 0) {
        emitToAll(io, 'inventory:updated', { warehouseId: mrv.toWarehouseId, mrvId: mrv.id });
      }
    }

    sendSuccess(res, { id: mrv.id, status: 'completed', goodLinesRestocked: goodLines.length });
  } catch (err) {
    next(err);
  }
});

export default router;
