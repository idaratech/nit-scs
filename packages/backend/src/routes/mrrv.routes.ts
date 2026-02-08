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
import { mrrvCreateSchema, mrrvUpdateSchema } from '../schemas/document.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List MRRVs ──────────────────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { mrrvNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { supplierName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Status filter
    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const [data, total] = await Promise.all([
      prisma.mrrv.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          supplier: { select: { id: true, supplierName: true, supplierCode: true } },
          warehouse: { select: { id: true, warehouseName: true, warehouseCode: true } },
          project: { select: { id: true, projectName: true, projectCode: true } },
          receivedBy: { select: { id: true, fullName: true } },
          _count: { select: { mrrvLines: true } },
        },
      }),
      prisma.mrrv.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single MRRV ─────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrrv = await prisma.mrrv.findUnique({
      where: { id: req.params.id as string },
      include: {
        mrrvLines: {
          include: {
            item: { select: { id: true, itemCode: true, itemDescription: true } },
            uom: { select: { id: true, uomCode: true, uomName: true } },
          },
        },
        supplier: true,
        warehouse: true,
        project: true,
        receivedBy: { select: { id: true, fullName: true, email: true } },
        qcInspector: { select: { id: true, fullName: true, email: true } },
        rfims: true,
        osdReports: true,
      },
    });

    if (!mrrv) {
      sendError(res, 404, 'MRRV not found');
      return;
    }

    sendSuccess(res, mrrv);
  } catch (err) {
    next(err);
  }
});

// ── POST / — Create MRRV ───────────────────────────────────────────────

router.post('/', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor', 'warehouse_staff'), validate(mrrvCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lines, ...headerData } = req.body;

    const mrrv = await prisma.$transaction(async (tx) => {
      const mrrvNumber = await generateDocumentNumber('mrrv');

      // Calculate total value from lines
      let totalValue = 0;
      for (const line of lines) {
        if (line.unitCost && line.qtyReceived) {
          totalValue += line.unitCost * line.qtyReceived;
        }
      }

      // Check if any line has damage
      const hasOsd = lines.some((l: { qtyDamaged?: number }) => l.qtyDamaged && l.qtyDamaged > 0);

      const created = await tx.mrrv.create({
        data: {
          mrrvNumber,
          supplierId: headerData.supplierId,
          poNumber: headerData.poNumber,
          warehouseId: headerData.warehouseId,
          projectId: headerData.projectId,
          receivedById: req.user!.userId,
          receiveDate: new Date(headerData.receiveDate),
          invoiceNumber: headerData.invoiceNumber,
          deliveryNote: headerData.deliveryNote,
          rfimRequired: headerData.rfimRequired ?? false,
          hasOsd,
          totalValue,
          status: 'draft',
          notes: headerData.notes,
          mrrvLines: {
            create: lines.map((line: Record<string, unknown>) => ({
              itemId: line.itemId,
              qtyOrdered: line.qtyOrdered ?? null,
              qtyReceived: line.qtyReceived,
              qtyDamaged: line.qtyDamaged ?? 0,
              uomId: line.uomId,
              unitCost: line.unitCost ?? null,
              condition: line.condition ?? 'good',
              storageLocation: line.storageLocation ?? null,
              expiryDate: line.expiryDate ? new Date(line.expiryDate as string) : null,
              notes: line.notes ?? null,
            })),
          },
        },
        include: {
          mrrvLines: true,
          supplier: { select: { id: true, supplierName: true } },
          warehouse: { select: { id: true, warehouseName: true } },
        },
      });

      return created;
    });

    await createAuditLog({
      tableName: 'mrrv',
      recordId: mrrv.id,
      action: 'create',
      newValues: { mrrvNumber: mrrv.mrrvNumber, status: 'draft', totalValue: Number(mrrv.totalValue) },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'mrrv:created', { id: mrrv.id, mrrvNumber: mrrv.mrrvNumber });
      emitToAll(io, 'entity:created', { entity: 'mrrv' });
    }

    sendCreated(res, mrrv);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update MRRV header (draft only) ─────────────────────────

router.put('/:id', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor', 'warehouse_staff'), validate(mrrvUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.mrrv.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'MRRV not found');
      return;
    }
    if (existing.status !== 'draft') {
      sendError(res, 400, 'Only draft MRRVs can be updated');
      return;
    }

    const updated = await prisma.mrrv.update({
      where: { id: req.params.id as string },
      data: {
        ...req.body,
        ...(req.body.receiveDate ? { receiveDate: new Date(req.body.receiveDate) } : {}),
      },
    });

    await createAuditLog({
      tableName: 'mrrv',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'entity:updated', { entity: 'mrrv' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/submit — Submit for QC ───────────────────────────────────

router.post('/:id/submit', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrrv = await prisma.mrrv.findUnique({
      where: { id: req.params.id as string },
      include: { mrrvLines: true },
    });

    if (!mrrv) {
      sendError(res, 404, 'MRRV not found');
      return;
    }
    if (mrrv.status !== 'draft') {
      sendError(res, 400, 'Only draft MRRVs can be submitted for QC');
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Update status
      await tx.mrrv.update({
        where: { id: mrrv.id },
        data: { status: 'pending_qc' },
      });

      // Auto-create RFIM if rfimRequired
      if (mrrv.rfimRequired) {
        const rfimNumber = await generateDocumentNumber('rfim');
        await tx.rfim.create({
          data: {
            rfimNumber,
            mrrvId: mrrv.id,
            requestDate: new Date(),
            status: 'pending',
          },
        });
      }

      // Auto-create OSD if any line has qtyDamaged > 0
      const damagedLines = mrrv.mrrvLines.filter(l => Number(l.qtyDamaged ?? 0) > 0);
      if (damagedLines.length > 0) {
        const osdNumber = await generateDocumentNumber('osd');
        await tx.osdReport.create({
          data: {
            osdNumber,
            mrrvId: mrrv.id,
            poNumber: mrrv.poNumber,
            supplierId: mrrv.supplierId,
            warehouseId: mrrv.warehouseId,
            reportDate: new Date(),
            reportTypes: ['damage'],
            status: 'draft',
            osdLines: {
              create: damagedLines.map(line => ({
                itemId: line.itemId,
                uomId: line.uomId,
                mrrvLineId: line.id,
                qtyInvoice: line.qtyOrdered ?? line.qtyReceived,
                qtyReceived: line.qtyReceived,
                qtyDamaged: line.qtyDamaged ?? 0,
                damageType: 'physical',
                unitCost: line.unitCost,
              })),
            },
          },
        });

        // Mark MRRV as having OSD
        await tx.mrrv.update({
          where: { id: mrrv.id },
          data: { hasOsd: true },
        });
      }
    });

    await createAuditLog({
      tableName: 'mrrv',
      recordId: mrrv.id,
      action: 'update',
      newValues: { status: 'pending_qc', rfimCreated: !!mrrv.rfimRequired },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrrv.id, 'mrrv:submitted', { id: mrrv.id, status: 'pending_qc' });
      emitToAll(io, 'document:status', { documentType: 'mrrv', documentId: mrrv.id, status: 'pending_qc' });
    }

    sendSuccess(res, { id: mrrv.id, status: 'pending_qc' });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/approve-qc — QC Approve ──────────────────────────────────

router.post('/:id/approve-qc', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrrv = await prisma.mrrv.findUnique({ where: { id: req.params.id as string } });

    if (!mrrv) {
      sendError(res, 404, 'MRRV not found');
      return;
    }
    if (mrrv.status !== 'pending_qc') {
      sendError(res, 400, 'MRRV must be in pending_qc status to approve QC');
      return;
    }

    const updated = await prisma.mrrv.update({
      where: { id: mrrv.id },
      data: {
        status: 'qc_approved',
        qcInspectorId: req.user!.userId,
        qcApprovedDate: new Date(),
      },
    });

    await createAuditLog({
      tableName: 'mrrv',
      recordId: mrrv.id,
      action: 'update',
      newValues: { status: 'qc_approved', qcInspectorId: req.user!.userId },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrrv.id, 'mrrv:qc_approved', { id: mrrv.id, status: 'qc_approved' });
      emitToAll(io, 'document:status', { documentType: 'mrrv', documentId: mrrv.id, status: 'qc_approved' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/receive — Mark received ───────────────────────────────────

router.post('/:id/receive', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrrv = await prisma.mrrv.findUnique({ where: { id: req.params.id as string } });

    if (!mrrv) {
      sendError(res, 404, 'MRRV not found');
      return;
    }
    if (mrrv.status !== 'qc_approved') {
      sendError(res, 400, 'MRRV must be QC approved before receiving');
      return;
    }

    const updated = await prisma.mrrv.update({
      where: { id: mrrv.id },
      data: { status: 'received' },
    });

    await createAuditLog({
      tableName: 'mrrv',
      recordId: mrrv.id,
      action: 'update',
      newValues: { status: 'received' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrrv.id, 'mrrv:received', { id: mrrv.id, status: 'received' });
      emitToAll(io, 'document:status', { documentType: 'mrrv', documentId: mrrv.id, status: 'received' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/store — Mark stored + add inventory ──────────────────────

router.post('/:id/store', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mrrv = await prisma.mrrv.findUnique({
      where: { id: req.params.id as string },
      include: { mrrvLines: true },
    });

    if (!mrrv) {
      sendError(res, 404, 'MRRV not found');
      return;
    }
    if (mrrv.status !== 'received') {
      sendError(res, 400, 'MRRV must be received before storing');
      return;
    }

    // Update status
    await prisma.mrrv.update({
      where: { id: mrrv.id },
      data: { status: 'stored' },
    });

    // Add stock for each line
    for (const line of mrrv.mrrvLines) {
      const qtyToStore = Number(line.qtyReceived) - Number(line.qtyDamaged ?? 0);
      if (qtyToStore > 0) {
        await addStock({
          itemId: line.itemId,
          warehouseId: mrrv.warehouseId,
          qty: qtyToStore,
          unitCost: line.unitCost ? Number(line.unitCost) : undefined,
          supplierId: mrrv.supplierId,
          mrrvLineId: line.id,
          expiryDate: line.expiryDate ?? undefined,
          performedById: req.user!.userId,
        });
      }
    }

    await createAuditLog({
      tableName: 'mrrv',
      recordId: mrrv.id,
      action: 'update',
      newValues: { status: 'stored', linesStored: mrrv.mrrvLines.length },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, mrrv.id, 'mrrv:stored', { id: mrrv.id, status: 'stored' });
      emitToAll(io, 'document:status', { documentType: 'mrrv', documentId: mrrv.id, status: 'stored' });
      emitToAll(io, 'inventory:updated', { warehouseId: mrrv.warehouseId, mrrvId: mrrv.id });
    }

    sendSuccess(res, { id: mrrv.id, status: 'stored' });
  } catch (err) {
    next(err);
  }
});

export default router;
