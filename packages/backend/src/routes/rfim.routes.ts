import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../utils/prisma.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { paginate } from '../middleware/pagination.js';
import { validate } from '../middleware/validate.js';
import { createAuditLog } from '../services/audit.service.js';
import { emitToDocument, emitToAll } from '../socket/setup.js';
import { rfimUpdateSchema } from '../schemas/document.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List RFIMs ──────────────────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { rfimNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const [data, total] = await Promise.all([
      prisma.rfim.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          mrrv: { select: { id: true, mrrvNumber: true, status: true } },
          inspector: { select: { id: true, fullName: true } },
        },
      }),
      prisma.rfim.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single RFIM ─────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rfim = await prisma.rfim.findUnique({
      where: { id: req.params.id as string },
      include: {
        mrrv: {
          include: {
            mrrvLines: {
              include: {
                item: { select: { id: true, itemCode: true, itemDescription: true } },
                uom: { select: { id: true, uomCode: true, uomName: true } },
              },
            },
            supplier: { select: { id: true, supplierName: true } },
            warehouse: { select: { id: true, warehouseName: true } },
          },
        },
        inspector: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!rfim) {
      sendError(res, 404, 'RFIM not found');
      return;
    }

    sendSuccess(res, rfim);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update RFIM (assign inspector, set result) ──────────────

router.put('/:id', authenticate, requireRole('admin', 'manager', 'qc_officer', 'warehouse_supervisor'), validate(rfimUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.rfim.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'RFIM not found');
      return;
    }

    const updated = await prisma.rfim.update({
      where: { id: req.params.id as string },
      data: req.body,
    });

    await createAuditLog({
      tableName: 'rfim',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'entity:updated', { entity: 'rfim' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/start — Start inspection ─────────────────────────────────

router.post('/:id/start', authenticate, requireRole('admin', 'qc_officer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rfim = await prisma.rfim.findUnique({ where: { id: req.params.id as string } });

    if (!rfim) {
      sendError(res, 404, 'RFIM not found');
      return;
    }
    if (rfim.status !== 'pending') {
      sendError(res, 400, 'RFIM must be pending to start inspection');
      return;
    }

    const updated = await prisma.rfim.update({
      where: { id: rfim.id },
      data: {
        status: 'in_progress',
        inspectionDate: new Date(),
        inspectorId: req.user!.userId,
      },
    });

    await createAuditLog({
      tableName: 'rfim',
      recordId: rfim.id,
      action: 'update',
      newValues: { status: 'in_progress', inspectorId: req.user!.userId },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, rfim.id, 'rfim:started', { id: rfim.id, status: 'in_progress' });
      emitToAll(io, 'document:status', { documentType: 'rfim', documentId: rfim.id, status: 'in_progress' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/complete — Complete inspection ────────────────────────────

router.post('/:id/complete', authenticate, requireRole('admin', 'qc_officer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rfim = await prisma.rfim.findUnique({ where: { id: req.params.id as string } });

    if (!rfim) {
      sendError(res, 404, 'RFIM not found');
      return;
    }
    if (rfim.status !== 'in_progress') {
      sendError(res, 400, 'RFIM must be in progress to complete');
      return;
    }

    // Result must be provided in request body
    const { result, comments } = req.body as { result?: string; comments?: string };
    if (!result || !['pass', 'fail', 'conditional'].includes(result)) {
      sendError(res, 400, 'Inspection result is required (pass, fail, or conditional)');
      return;
    }

    const updated = await prisma.rfim.update({
      where: { id: rfim.id },
      data: {
        status: 'completed',
        result,
        comments: comments ?? rfim.comments,
      },
    });

    await createAuditLog({
      tableName: 'rfim',
      recordId: rfim.id,
      action: 'update',
      newValues: { status: 'completed', result, comments },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, rfim.id, 'rfim:completed', { id: rfim.id, status: 'completed', result });
      emitToAll(io, 'document:status', { documentType: 'rfim', documentId: rfim.id, status: 'completed' });
      // Notify the linked MRRV
      emitToDocument(io, rfim.mrrvId, 'rfim:completed', { rfimId: rfim.id, result });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

export default router;
