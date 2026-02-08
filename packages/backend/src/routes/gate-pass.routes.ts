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
import { emitToDocument, emitToAll } from '../socket/setup.js';
import { gatePassCreateSchema, gatePassUpdateSchema } from '../schemas/logistics.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List Gate Passes ──────────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { gatePassNumber: { contains: search, mode: 'insensitive' } },
        { driverName: { contains: search, mode: 'insensitive' } },
        { vehicleNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const passTypeFilter = req.query.passType as string | undefined;
    if (passTypeFilter) where.passType = passTypeFilter;

    const [data, total] = await Promise.all([
      prisma.gatePass.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          warehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
          project: { select: { id: true, projectName: true, projectCode: true } },
          issuedBy: { select: { id: true, fullName: true } },
          _count: { select: { gatePassItems: true } },
        },
      }),
      prisma.gatePass.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single Gate Pass ──────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gatePass = await prisma.gatePass.findUnique({
      where: { id: req.params.id as string },
      include: {
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
      },
    });

    if (!gatePass) {
      sendError(res, 404, 'Gate Pass not found');
      return;
    }

    sendSuccess(res, gatePass);
  } catch (err) {
    next(err);
  }
});

// ── POST / — Create Gate Pass ────────────────────────────────────────

router.post('/', authenticate, requireRole('admin', 'warehouse_supervisor', 'warehouse_staff'), validate(gatePassCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { items, ...headerData } = req.body;

    const gatePass = await prisma.$transaction(async (tx) => {
      const gatePassNumber = await generateDocumentNumber('gatepass');

      const created = await tx.gatePass.create({
        data: {
          gatePassNumber,
          passType: headerData.passType,
          mirvId: headerData.mirvId ?? null,
          projectId: headerData.projectId ?? null,
          warehouseId: headerData.warehouseId,
          vehicleNumber: headerData.vehicleNumber,
          driverName: headerData.driverName,
          driverIdNumber: headerData.driverIdNumber ?? null,
          destination: headerData.destination,
          purpose: headerData.purpose ?? null,
          issueDate: new Date(headerData.issueDate),
          validUntil: headerData.validUntil ? new Date(headerData.validUntil) : null,
          status: 'draft',
          issuedById: req.user!.userId,
          notes: headerData.notes ?? null,
          gatePassItems: {
            create: items.map((item: Record<string, unknown>) => ({
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

      return created;
    });

    await createAuditLog({
      tableName: 'gate_passes',
      recordId: gatePass.id,
      action: 'create',
      newValues: { gatePassNumber: gatePass.gatePassNumber, passType: gatePass.passType, status: 'draft' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'gatepass:created', { id: gatePass.id, gatePassNumber: gatePass.gatePassNumber });
      emitToAll(io, 'entity:created', { entity: 'gate-passes' });
    }

    sendCreated(res, gatePass);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update Gate Pass (draft only) ─────────────────────────

router.put('/:id', authenticate, requireRole('admin', 'warehouse_supervisor', 'warehouse_staff'), validate(gatePassUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'Gate Pass not found');
      return;
    }
    if (existing.status !== 'draft') {
      sendError(res, 400, 'Only draft Gate Passes can be updated');
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id: req.params.id as string },
      data: {
        ...req.body,
        ...(req.body.issueDate ? { issueDate: new Date(req.body.issueDate) } : {}),
        ...(req.body.validUntil ? { validUntil: new Date(req.body.validUntil) } : {}),
      },
    });

    await createAuditLog({
      tableName: 'gate_passes',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'entity:updated', { entity: 'gate-passes' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/submit — Submit for approval ──────────────────────────

router.post('/:id/submit', authenticate, requireRole('admin', 'warehouse_supervisor', 'warehouse_staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gatePass = await prisma.gatePass.findUnique({ where: { id: req.params.id as string } });

    if (!gatePass) {
      sendError(res, 404, 'Gate Pass not found');
      return;
    }
    if (gatePass.status !== 'draft') {
      sendError(res, 400, 'Only draft Gate Passes can be submitted');
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id: gatePass.id },
      data: { status: 'pending' },
    });

    await createAuditLog({
      tableName: 'gate_passes',
      recordId: gatePass.id,
      action: 'update',
      newValues: { status: 'pending' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, gatePass.id, 'gatepass:submitted', { id: gatePass.id, status: 'pending' });
      emitToAll(io, 'document:status', { documentType: 'gate-passes', documentId: gatePass.id, status: 'pending' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/approve — Approve ─────────────────────────────────────

router.post('/:id/approve', authenticate, requireRole('admin', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gatePass = await prisma.gatePass.findUnique({ where: { id: req.params.id as string } });

    if (!gatePass) {
      sendError(res, 404, 'Gate Pass not found');
      return;
    }
    if (gatePass.status !== 'pending') {
      sendError(res, 400, 'Gate Pass must be pending to approve');
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id: gatePass.id },
      data: { status: 'approved' },
    });

    await createAuditLog({
      tableName: 'gate_passes',
      recordId: gatePass.id,
      action: 'update',
      newValues: { status: 'approved' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, gatePass.id, 'gatepass:approved', { id: gatePass.id, status: 'approved' });
      emitToAll(io, 'document:status', { documentType: 'gate-passes', documentId: gatePass.id, status: 'approved' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/release — Release (set exit time) ────────────────────

router.post('/:id/release', authenticate, requireRole('admin', 'warehouse_supervisor', 'warehouse_staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gatePass = await prisma.gatePass.findUnique({ where: { id: req.params.id as string } });

    if (!gatePass) {
      sendError(res, 404, 'Gate Pass not found');
      return;
    }
    if (gatePass.status !== 'approved') {
      sendError(res, 400, 'Gate Pass must be approved to release');
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id: gatePass.id },
      data: {
        status: 'released',
        exitTime: new Date(),
        securityOfficer: (req.body.securityOfficer as string) ?? null,
      },
    });

    await createAuditLog({
      tableName: 'gate_passes',
      recordId: gatePass.id,
      action: 'update',
      newValues: { status: 'released', exitTime: updated.exitTime?.toISOString() },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, gatePass.id, 'gatepass:released', { id: gatePass.id, status: 'released' });
      emitToAll(io, 'document:status', { documentType: 'gate-passes', documentId: gatePass.id, status: 'released' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/return — Return (set return time) ────────────────────

router.post('/:id/return', authenticate, requireRole('admin', 'warehouse_supervisor', 'warehouse_staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gatePass = await prisma.gatePass.findUnique({ where: { id: req.params.id as string } });

    if (!gatePass) {
      sendError(res, 404, 'Gate Pass not found');
      return;
    }
    if (gatePass.status !== 'released') {
      sendError(res, 400, 'Gate Pass must be released to mark as returned');
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id: gatePass.id },
      data: {
        status: 'returned',
        returnTime: new Date(),
      },
    });

    await createAuditLog({
      tableName: 'gate_passes',
      recordId: gatePass.id,
      action: 'update',
      newValues: { status: 'returned', returnTime: updated.returnTime?.toISOString() },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, gatePass.id, 'gatepass:returned', { id: gatePass.id, status: 'returned' });
      emitToAll(io, 'document:status', { documentType: 'gate-passes', documentId: gatePass.id, status: 'returned' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/cancel — Cancel ───────────────────────────────────────

router.post('/:id/cancel', authenticate, requireRole('admin', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gatePass = await prisma.gatePass.findUnique({ where: { id: req.params.id as string } });

    if (!gatePass) {
      sendError(res, 404, 'Gate Pass not found');
      return;
    }

    const nonCancellable = ['released', 'returned', 'cancelled'];
    if (nonCancellable.includes(gatePass.status)) {
      sendError(res, 400, `Gate Pass cannot be cancelled from status: ${gatePass.status}`);
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id: gatePass.id },
      data: { status: 'cancelled' },
    });

    await createAuditLog({
      tableName: 'gate_passes',
      recordId: gatePass.id,
      action: 'update',
      newValues: { status: 'cancelled' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, gatePass.id, 'gatepass:cancelled', { id: gatePass.id, status: 'cancelled' });
      emitToAll(io, 'document:status', { documentType: 'gate-passes', documentId: gatePass.id, status: 'cancelled' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

export default router;
