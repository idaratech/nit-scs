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
import { submitForApproval, processApproval } from '../services/approval.service.js';
import { reserveStock, consumeReservation, releaseReservation } from '../services/inventory.service.js';
import { emitToDocument, emitToAll } from '../socket/setup.js';
import { mirvCreateSchema, mirvUpdateSchema, approvalActionSchema } from '../schemas/document.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List MIRVs ──────────────────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { mirvNumber: { contains: search, mode: 'insensitive' } },
        { project: { projectName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const [data, total] = await Promise.all([
      prisma.mirv.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          project: { select: { id: true, projectName: true, projectCode: true } },
          warehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
          requestedBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
          _count: { select: { mirvLines: true } },
        },
      }),
      prisma.mirv.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single MIRV ─────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mirv = await prisma.mirv.findUnique({
      where: { id: req.params.id as string },
      include: {
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
      },
    });

    if (!mirv) {
      sendError(res, 404, 'MIRV not found');
      return;
    }

    sendSuccess(res, mirv);
  } catch (err) {
    next(err);
  }
});

// ── POST / — Create MIRV ───────────────────────────────────────────────

router.post('/', authenticate, requireRole('admin', 'manager', 'site_engineer', 'warehouse_supervisor'), validate(mirvCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lines, ...headerData } = req.body;

    const mirv = await prisma.$transaction(async (tx) => {
      const mirvNumber = await generateDocumentNumber('mirv');

      // Calculate estimatedValue from line items (use item standardCost if available)
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

      const created = await tx.mirv.create({
        data: {
          mirvNumber,
          projectId: headerData.projectId,
          warehouseId: headerData.warehouseId,
          locationOfWork: headerData.locationOfWork,
          requestedById: req.user!.userId,
          requestDate: new Date(headerData.requestDate),
          requiredDate: headerData.requiredDate ? new Date(headerData.requiredDate) : null,
          priority: headerData.priority ?? 'normal',
          estimatedValue,
          status: 'draft',
          notes: headerData.notes,
          mirvLines: {
            create: lines.map((line: Record<string, unknown>) => ({
              itemId: line.itemId,
              qtyRequested: line.qtyRequested,
              notes: line.notes ?? null,
            })),
          },
        },
        include: {
          mirvLines: true,
          project: { select: { id: true, projectName: true } },
          warehouse: { select: { id: true, warehouseName: true } },
        },
      });

      return created;
    });

    await createAuditLog({
      tableName: 'mirv',
      recordId: mirv.id,
      action: 'create',
      newValues: { mirvNumber: mirv.mirvNumber, status: 'draft', estimatedValue: Number(mirv.estimatedValue) },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'mirv:created', { id: mirv.id, mirvNumber: mirv.mirvNumber });
      emitToAll(io, 'entity:created', { entity: 'mirv' });
    }

    sendCreated(res, mirv);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update MIRV header (draft only) ─────────────────────────

router.put('/:id', authenticate, requireRole('admin', 'manager', 'site_engineer', 'warehouse_supervisor'), validate(mirvUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.mirv.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'MIRV not found');
      return;
    }
    if (existing.status !== 'draft') {
      sendError(res, 400, 'Only draft MIRVs can be updated');
      return;
    }

    const updated = await prisma.mirv.update({
      where: { id: req.params.id as string },
      data: {
        ...req.body,
        ...(req.body.requestDate ? { requestDate: new Date(req.body.requestDate) } : {}),
        ...(req.body.requiredDate ? { requiredDate: new Date(req.body.requiredDate) } : {}),
      },
    });

    await createAuditLog({
      tableName: 'mirv',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'entity:updated', { entity: 'mirv' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/submit — Submit for approval ─────────────────────────────

router.post('/:id/submit', authenticate, requireRole('admin', 'manager', 'site_engineer', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mirv = await prisma.mirv.findUnique({ where: { id: req.params.id as string } });

    if (!mirv) {
      sendError(res, 404, 'MIRV not found');
      return;
    }
    if (mirv.status !== 'draft') {
      sendError(res, 400, 'Only draft MIRVs can be submitted for approval');
      return;
    }

    const io = req.app.get('io') as SocketIOServer | undefined;

    const approval = await submitForApproval({
      documentType: 'mirv',
      documentId: mirv.id,
      amount: Number(mirv.estimatedValue ?? 0),
      submittedById: req.user!.userId,
      io,
    });

    sendSuccess(res, {
      id: mirv.id,
      status: 'pending_approval',
      approverRole: approval.approverRole,
      slaHours: approval.slaHours,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/approve — Process approval ───────────────────────────────

router.post('/:id/approve', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), validate(approvalActionSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mirv = await prisma.mirv.findUnique({
      where: { id: req.params.id as string },
      include: { mirvLines: true },
    });

    if (!mirv) {
      sendError(res, 404, 'MIRV not found');
      return;
    }
    if (mirv.status !== 'pending_approval') {
      sendError(res, 400, 'MIRV must be pending approval');
      return;
    }

    const { action, comments } = req.body as { action: 'approve' | 'reject'; comments?: string };
    const io = req.app.get('io') as SocketIOServer | undefined;

    await processApproval({
      documentType: 'mirv',
      documentId: mirv.id,
      action,
      processedById: req.user!.userId,
      comments,
      io,
    });

    // If approved, reserve stock for each line
    if (action === 'approve') {
      let allReserved = true;
      for (const line of mirv.mirvLines) {
        const reserved = await reserveStock(
          line.itemId,
          mirv.warehouseId,
          Number(line.qtyRequested),
        );
        if (!reserved) {
          allReserved = false;
        }

        // Set qtyApproved = qtyRequested on approval
        await prisma.mirvLine.update({
          where: { id: line.id },
          data: { qtyApproved: line.qtyRequested },
        });
      }

      // Update reservation status
      await prisma.mirv.update({
        where: { id: mirv.id },
        data: {
          reservationStatus: allReserved ? 'reserved' : 'none',
        },
      });

      if (io) {
        emitToAll(io, 'inventory:reserved', { mirvId: mirv.id, warehouseId: mirv.warehouseId });
      }
    }

    sendSuccess(res, {
      id: mirv.id,
      action,
      status: action === 'approve' ? 'approved' : 'rejected',
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/issue — Issue materials ──────────────────────────────────

router.post('/:id/issue', authenticate, requireRole('admin', 'warehouse_supervisor', 'warehouse_staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mirv = await prisma.mirv.findUnique({
      where: { id: req.params.id as string },
      include: { mirvLines: true },
    });

    if (!mirv) {
      sendError(res, 404, 'MIRV not found');
      return;
    }
    if (mirv.status !== 'approved' && mirv.status !== 'partially_issued') {
      sendError(res, 400, 'MIRV must be approved or partially issued to issue materials');
      return;
    }

    let totalCost = 0;

    // Consume reservations for each line
    for (const line of mirv.mirvLines) {
      const qtyToIssue = Number(line.qtyApproved ?? line.qtyRequested);

      const result = await consumeReservation(
        line.itemId,
        mirv.warehouseId,
        qtyToIssue,
        line.id,
      );

      totalCost += result.totalCost;

      // Update line with qtyIssued and unitCost
      await prisma.mirvLine.update({
        where: { id: line.id },
        data: {
          qtyIssued: qtyToIssue,
          unitCost: qtyToIssue > 0 ? result.totalCost / qtyToIssue : 0,
        },
      });
    }

    // Update MIRV status
    const updated = await prisma.mirv.update({
      where: { id: mirv.id },
      data: {
        status: 'issued',
        issuedById: req.user!.userId,
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
        issuedById: req.user!.userId,
      },
    });

    await createAuditLog({
      tableName: 'mirv',
      recordId: mirv.id,
      action: 'update',
      newValues: { status: 'issued', totalCost, issuedById: req.user!.userId },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mirv.id, 'mirv:issued', { id: mirv.id, status: 'issued', totalCost });
      emitToAll(io, 'document:status', { documentType: 'mirv', documentId: mirv.id, status: 'issued' });
      emitToAll(io, 'inventory:updated', { warehouseId: mirv.warehouseId, mirvId: mirv.id });
    }

    sendSuccess(res, { id: mirv.id, status: 'issued', totalCost });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/cancel — Cancel MIRV ─────────────────────────────────────

router.post('/:id/cancel', authenticate, requireRole('admin', 'manager'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mirv = await prisma.mirv.findUnique({
      where: { id: req.params.id as string },
      include: { mirvLines: true },
    });

    if (!mirv) {
      sendError(res, 404, 'MIRV not found');
      return;
    }

    const cancellableStatuses = ['approved', 'partially_issued', 'pending_approval'];
    if (!cancellableStatuses.includes(mirv.status)) {
      sendError(res, 400, `MIRV cannot be cancelled from status: ${mirv.status}`);
      return;
    }

    // Release reservations if they exist
    if (mirv.reservationStatus === 'reserved') {
      for (const line of mirv.mirvLines) {
        await releaseReservation(
          line.itemId,
          mirv.warehouseId,
          Number(line.qtyApproved ?? line.qtyRequested),
        );
      }
    }

    const updated = await prisma.mirv.update({
      where: { id: mirv.id },
      data: {
        status: 'cancelled',
        reservationStatus: 'released',
      },
    });

    await createAuditLog({
      tableName: 'mirv',
      recordId: mirv.id,
      action: 'update',
      newValues: { status: 'cancelled', reservationStatus: 'released' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mirv.id, 'mirv:cancelled', { id: mirv.id, status: 'cancelled' });
      emitToAll(io, 'document:status', { documentType: 'mirv', documentId: mirv.id, status: 'cancelled' });
      if (mirv.reservationStatus === 'reserved') {
        emitToAll(io, 'inventory:released', { mirvId: mirv.id, warehouseId: mirv.warehouseId });
      }
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

export default router;
