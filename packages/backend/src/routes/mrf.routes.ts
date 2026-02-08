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
import { getStockLevel } from '../services/inventory.service.js';
import { emitToDocument, emitToAll } from '../socket/setup.js';
import { mrfCreateSchema, mrfUpdateSchema } from '../schemas/logistics.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List MRFs ────────────────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { mrfNumber: { contains: search, mode: 'insensitive' } },
        { project: { projectName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const projectIdFilter = req.query.projectId as string | undefined;
    if (projectIdFilter) where.projectId = projectIdFilter;

    const [data, total] = await Promise.all([
      prisma.materialRequisition.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          project: { select: { id: true, projectName: true, projectCode: true } },
          requestedBy: { select: { id: true, fullName: true } },
          reviewedBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
          _count: { select: { mrfLines: true } },
        },
      }),
      prisma.materialRequisition.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single MRF ───────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrf = await prisma.materialRequisition.findUnique({
      where: { id: req.params.id as string },
      include: {
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
      },
    });

    if (!mrf) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }

    sendSuccess(res, mrf);
  } catch (err) {
    next(err);
  }
});

// ── POST / — Create MRF ─────────────────────────────────────────────

router.post('/', authenticate, requireRole('admin', 'manager', 'site_engineer', 'warehouse_supervisor'), validate(mrfCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lines, ...headerData } = req.body;

    const mrf = await prisma.$transaction(async (tx) => {
      const mrfNumber = await generateDocumentNumber('mrf');

      // Calculate total estimated value from lines
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

      const created = await tx.materialRequisition.create({
        data: {
          mrfNumber,
          requestDate: new Date(headerData.requestDate),
          requiredDate: headerData.requiredDate ? new Date(headerData.requiredDate) : null,
          projectId: headerData.projectId,
          department: headerData.department ?? null,
          requestedById: req.user!.userId,
          deliveryPoint: headerData.deliveryPoint ?? null,
          workOrder: headerData.workOrder ?? null,
          drawingReference: headerData.drawingReference ?? null,
          priority: headerData.priority ?? 'medium',
          totalEstimatedValue,
          status: 'draft',
          notes: headerData.notes ?? null,
          mrfLines: {
            create: lines.map((line: Record<string, unknown>) => ({
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

      return created;
    });

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: mrf.id,
      action: 'create',
      newValues: { mrfNumber: mrf.mrfNumber, status: 'draft', totalEstimatedValue: Number(mrf.totalEstimatedValue) },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'mrf:created', { id: mrf.id, mrfNumber: mrf.mrfNumber });
      emitToAll(io, 'entity:created', { entity: 'mrf' });
    }

    sendCreated(res, mrf);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update MRF header (draft only) ──────────────────────

router.put('/:id', authenticate, requireRole('admin', 'manager', 'site_engineer', 'warehouse_supervisor'), validate(mrfUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.materialRequisition.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }
    if (existing.status !== 'draft') {
      sendError(res, 400, 'Only draft MRFs can be updated');
      return;
    }

    const updated = await prisma.materialRequisition.update({
      where: { id: req.params.id as string },
      data: {
        ...req.body,
        ...(req.body.requestDate ? { requestDate: new Date(req.body.requestDate) } : {}),
        ...(req.body.requiredDate ? { requiredDate: new Date(req.body.requiredDate) } : {}),
      },
    });

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'entity:updated', { entity: 'mrf' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/submit — Submit MRF ───────────────────────────────────

router.post('/:id/submit', authenticate, requireRole('admin', 'manager', 'site_engineer', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrf = await prisma.materialRequisition.findUnique({ where: { id: req.params.id as string } });

    if (!mrf) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }
    if (mrf.status !== 'draft') {
      sendError(res, 400, 'Only draft MRFs can be submitted');
      return;
    }

    const updated = await prisma.materialRequisition.update({
      where: { id: mrf.id },
      data: { status: 'submitted' },
    });

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: mrf.id,
      action: 'update',
      newValues: { status: 'submitted' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrf.id, 'mrf:submitted', { id: mrf.id, status: 'submitted' });
      emitToAll(io, 'document:status', { documentType: 'mrf', documentId: mrf.id, status: 'submitted' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/review — Mark under review ───────────────────────────

router.post('/:id/review', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrf = await prisma.materialRequisition.findUnique({ where: { id: req.params.id as string } });

    if (!mrf) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }
    if (mrf.status !== 'submitted') {
      sendError(res, 400, 'MRF must be submitted to start review');
      return;
    }

    const updated = await prisma.materialRequisition.update({
      where: { id: mrf.id },
      data: {
        status: 'under_review',
        reviewedById: req.user!.userId,
        reviewDate: new Date(),
      },
    });

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: mrf.id,
      action: 'update',
      newValues: { status: 'under_review', reviewedById: req.user!.userId },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrf.id, 'mrf:under_review', { id: mrf.id, status: 'under_review' });
      emitToAll(io, 'document:status', { documentType: 'mrf', documentId: mrf.id, status: 'under_review' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/approve — Approve MRF ────────────────────────────────

router.post('/:id/approve', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrf = await prisma.materialRequisition.findUnique({ where: { id: req.params.id as string } });

    if (!mrf) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }
    if (mrf.status !== 'under_review') {
      sendError(res, 400, 'MRF must be under review to approve');
      return;
    }

    const updated = await prisma.materialRequisition.update({
      where: { id: mrf.id },
      data: {
        status: 'approved',
        approvedById: req.user!.userId,
        approvalDate: new Date(),
      },
    });

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: mrf.id,
      action: 'update',
      newValues: { status: 'approved', approvedById: req.user!.userId },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrf.id, 'mrf:approved', { id: mrf.id, status: 'approved' });
      emitToAll(io, 'document:status', { documentType: 'mrf', documentId: mrf.id, status: 'approved' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/check-stock — Check stock availability ────────────────

router.post('/:id/check-stock', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrf = await prisma.materialRequisition.findUnique({
      where: { id: req.params.id as string },
      include: {
        mrfLines: true,
        project: { select: { id: true, warehouses: { select: { id: true } } } },
      },
    });

    if (!mrf) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }
    if (mrf.status !== 'approved') {
      sendError(res, 400, 'MRF must be approved to check stock');
      return;
    }

    // Check stock for each line item across project warehouses
    const stockResults: Array<{ lineId: string; itemId: string | null; available: number; source: string }> = [];

    for (const line of mrf.mrfLines) {
      if (!line.itemId) {
        stockResults.push({ lineId: line.id, itemId: null, available: 0, source: 'purchase_required' });
        continue;
      }

      // Check all warehouses associated with the project
      let totalAvailable = 0;
      const projectWarehouses = mrf.project?.warehouses ?? [];
      for (const wh of projectWarehouses) {
        const stock = await getStockLevel(line.itemId, wh.id);
        totalAvailable += stock.available;
      }

      let source = 'tbd';
      const qtyNeeded = Number(line.qtyRequested);
      if (totalAvailable >= qtyNeeded) {
        source = 'from_stock';
      } else if (totalAvailable > 0) {
        source = 'both';
      } else {
        source = 'purchase_required';
      }

      // Update line with source determination
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

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: mrf.id,
      action: 'update',
      newValues: { status: 'checking_stock', stockResults },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrf.id, 'mrf:stock_checked', { id: mrf.id, stockResults });
      emitToAll(io, 'document:status', { documentType: 'mrf', documentId: mrf.id, status: 'checking_stock' });
    }

    sendSuccess(res, { id: mrf.id, status: updated.status, stockResults });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/convert-mirv — Convert to MIRV ───────────────────────

router.post('/:id/convert-mirv', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrf = await prisma.materialRequisition.findUnique({
      where: { id: req.params.id as string },
      include: {
        mrfLines: true,
        project: { select: { id: true, warehouses: { select: { id: true }, take: 1 } } },
      },
    });

    if (!mrf) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }
    if (mrf.status !== 'checking_stock' && mrf.status !== 'approved') {
      sendError(res, 400, 'MRF must be in checking_stock or approved status to convert to MIRV');
      return;
    }

    // Get lines that can be fulfilled from stock
    const fromStockLines = mrf.mrfLines.filter(
      (l) => l.source === 'from_stock' || l.source === 'both'
    );

    if (fromStockLines.length === 0) {
      // All lines need purchase
      const updated = await prisma.materialRequisition.update({
        where: { id: mrf.id },
        data: { status: 'needs_purchase' },
      });

      sendSuccess(res, { id: mrf.id, status: updated.status, message: 'No lines available from stock' });
      return;
    }

    // Determine warehouse for MIRV (use project's first warehouse)
    const warehouseId = (req.body.warehouseId as string) ?? mrf.project?.warehouses[0]?.id;
    if (!warehouseId) {
      sendError(res, 400, 'No warehouse specified and project has no warehouses');
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create MIRV
      const mirvNumber = await generateDocumentNumber('mirv');

      const mirv = await tx.mirv.create({
        data: {
          mirvNumber,
          projectId: mrf.projectId,
          warehouseId,
          requestedById: req.user!.userId,
          requestDate: new Date(),
          priority: mrf.priority === 'urgent' ? 'urgent' : 'normal',
          status: 'draft',
          mrfId: mrf.id,
          notes: `Auto-created from MRF ${mrf.mrfNumber}`,
          mirvLines: {
            create: fromStockLines.map((line) => ({
              itemId: line.itemId!,
              qtyRequested: line.qtyFromStock && Number(line.qtyFromStock) > 0
                ? line.qtyFromStock
                : line.qtyRequested,
              notes: line.notes ?? null,
            })),
          },
        },
        include: { mirvLines: true },
      });

      // Link MRF lines to MIRV lines
      for (let i = 0; i < fromStockLines.length; i++) {
        const mrfLine = fromStockLines[i];
        const mirvLine = mirv.mirvLines[i];
        if (mrfLine && mirvLine) {
          await tx.mrfLine.update({
            where: { id: mrfLine.id },
            data: { mirvLineId: mirvLine.id },
          });
        }
      }

      // Update MRF status
      const allFromStock = mrf.mrfLines.every(
        (l) => l.source === 'from_stock'
      );
      const newStatus = allFromStock ? 'from_stock' : 'needs_purchase';

      await tx.materialRequisition.update({
        where: { id: mrf.id },
        data: {
          status: newStatus,
          mirvId: mirv.id,
        },
      });

      return { mirv, newStatus };
    });

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: mrf.id,
      action: 'update',
      newValues: {
        status: result.newStatus,
        mirvId: result.mirv.id,
        mirvNumber: result.mirv.mirvNumber,
      },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrf.id, 'mrf:mirv_created', {
        id: mrf.id,
        mirvId: result.mirv.id,
        mirvNumber: result.mirv.mirvNumber,
      });
      emitToAll(io, 'document:status', { documentType: 'mrf', documentId: mrf.id, status: result.newStatus });
      emitToAll(io, 'mirv:created', { id: result.mirv.id, mirvNumber: result.mirv.mirvNumber });
      emitToAll(io, 'entity:created', { entity: 'mirv' });
    }

    sendSuccess(res, {
      id: mrf.id,
      status: result.newStatus,
      mirv: { id: result.mirv.id, mirvNumber: result.mirv.mirvNumber },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/fulfill — Mark as fulfilled ───────────────────────────

router.post('/:id/fulfill', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrf = await prisma.materialRequisition.findUnique({ where: { id: req.params.id as string } });

    if (!mrf) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }

    const fulfillable = ['from_stock', 'needs_purchase', 'partially_fulfilled'];
    if (!fulfillable.includes(mrf.status)) {
      sendError(res, 400, `MRF cannot be fulfilled from status: ${mrf.status}`);
      return;
    }

    const updated = await prisma.materialRequisition.update({
      where: { id: mrf.id },
      data: {
        status: 'fulfilled',
        fulfillmentDate: new Date(),
      },
    });

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: mrf.id,
      action: 'update',
      newValues: { status: 'fulfilled', fulfillmentDate: updated.fulfillmentDate?.toISOString() },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrf.id, 'mrf:fulfilled', { id: mrf.id, status: 'fulfilled' });
      emitToAll(io, 'document:status', { documentType: 'mrf', documentId: mrf.id, status: 'fulfilled' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/reject — Reject MRF ──────────────────────────────────

router.post('/:id/reject', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrf = await prisma.materialRequisition.findUnique({ where: { id: req.params.id as string } });

    if (!mrf) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }

    const rejectable = ['submitted', 'under_review'];
    if (!rejectable.includes(mrf.status)) {
      sendError(res, 400, `MRF cannot be rejected from status: ${mrf.status}`);
      return;
    }

    const updated = await prisma.materialRequisition.update({
      where: { id: mrf.id },
      data: { status: 'rejected' },
    });

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: mrf.id,
      action: 'update',
      newValues: { status: 'rejected', reason: req.body.reason },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrf.id, 'mrf:rejected', { id: mrf.id, status: 'rejected' });
      emitToAll(io, 'document:status', { documentType: 'mrf', documentId: mrf.id, status: 'rejected' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/cancel — Cancel MRF ──────────────────────────────────

router.post('/:id/cancel', authenticate, requireRole('admin', 'manager'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrf = await prisma.materialRequisition.findUnique({ where: { id: req.params.id as string } });

    if (!mrf) {
      sendError(res, 404, 'Material Requisition not found');
      return;
    }

    const nonCancellable = ['fulfilled', 'cancelled'];
    if (nonCancellable.includes(mrf.status)) {
      sendError(res, 400, `MRF cannot be cancelled from status: ${mrf.status}`);
      return;
    }

    const updated = await prisma.materialRequisition.update({
      where: { id: mrf.id },
      data: { status: 'cancelled' },
    });

    await createAuditLog({
      tableName: 'material_requisitions',
      recordId: mrf.id,
      action: 'update',
      newValues: { status: 'cancelled' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrf.id, 'mrf:cancelled', { id: mrf.id, status: 'cancelled' });
      emitToAll(io, 'document:status', { documentType: 'mrf', documentId: mrf.id, status: 'cancelled' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

export default router;
