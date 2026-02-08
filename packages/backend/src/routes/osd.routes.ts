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
import { osdCreateSchema, osdUpdateSchema } from '../schemas/document.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List OSDs ───────────────────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { osdNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const [data, total] = await Promise.all([
      prisma.osdReport.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          mrrv: { select: { id: true, mrrvNumber: true } },
          supplier: { select: { id: true, supplierName: true, supplierCode: true } },
          warehouse: { select: { id: true, warehouseName: true } },
          _count: { select: { osdLines: true } },
        },
      }),
      prisma.osdReport.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single OSD ──────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const osd = await prisma.osdReport.findUnique({
      where: { id: req.params.id as string },
      include: {
        osdLines: {
          include: {
            item: { select: { id: true, itemCode: true, itemDescription: true } },
            uom: { select: { id: true, uomCode: true, uomName: true } },
            mrrvLine: { select: { id: true, qtyOrdered: true, qtyReceived: true } },
          },
        },
        mrrv: {
          select: {
            id: true,
            mrrvNumber: true,
            supplierId: true,
            poNumber: true,
            supplier: { select: { id: true, supplierName: true } },
          },
        },
        supplier: true,
        warehouse: true,
        resolvedBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!osd) {
      sendError(res, 404, 'OSD report not found');
      return;
    }

    sendSuccess(res, osd);
  } catch (err) {
    next(err);
  }
});

// ── POST / — Create OSD ────────────────────────────────────────────────

router.post('/', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor', 'qc_officer'), validate(osdCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lines, ...headerData } = req.body;

    const osd = await prisma.$transaction(async (tx) => {
      const osdNumber = await generateDocumentNumber('osd');

      // Calculate totals from lines
      let totalOverValue = 0;
      let totalShortValue = 0;
      let totalDamageValue = 0;

      for (const line of lines) {
        const unitCost = line.unitCost ?? 0;
        const qtyInvoice = line.qtyInvoice as number;
        const qtyReceived = line.qtyReceived as number;
        const qtyDamaged = (line.qtyDamaged as number) ?? 0;

        if (qtyReceived > qtyInvoice) {
          totalOverValue += (qtyReceived - qtyInvoice) * unitCost;
        } else if (qtyReceived < qtyInvoice) {
          totalShortValue += (qtyInvoice - qtyReceived) * unitCost;
        }
        totalDamageValue += qtyDamaged * unitCost;
      }

      const created = await tx.osdReport.create({
        data: {
          osdNumber,
          mrrvId: headerData.mrrvId,
          poNumber: headerData.poNumber,
          supplierId: headerData.supplierId,
          warehouseId: headerData.warehouseId,
          reportDate: new Date(headerData.reportDate),
          reportTypes: headerData.reportTypes,
          status: 'draft',
          totalOverValue,
          totalShortValue,
          totalDamageValue,
          osdLines: {
            create: lines.map((line: Record<string, unknown>) => ({
              itemId: line.itemId,
              uomId: line.uomId,
              mrrvLineId: line.mrrvLineId ?? null,
              qtyInvoice: line.qtyInvoice,
              qtyReceived: line.qtyReceived,
              qtyDamaged: line.qtyDamaged ?? 0,
              damageType: line.damageType ?? null,
              unitCost: line.unitCost ?? null,
              notes: line.notes ?? null,
            })),
          },
        },
        include: {
          osdLines: true,
          mrrv: { select: { id: true, mrrvNumber: true } },
          supplier: { select: { id: true, supplierName: true } },
        },
      });

      return created;
    });

    await createAuditLog({
      tableName: 'osd_reports',
      recordId: osd.id,
      action: 'create',
      newValues: {
        osdNumber: osd.osdNumber,
        status: 'draft',
        totalOverValue: Number(osd.totalOverValue),
        totalShortValue: Number(osd.totalShortValue),
        totalDamageValue: Number(osd.totalDamageValue),
      },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'osd:created', { id: osd.id, osdNumber: osd.osdNumber });
      emitToAll(io, 'entity:created', { entity: 'osd' });
    }

    sendCreated(res, osd);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update OSD header ────────────────────────────────────────

router.put('/:id', authenticate, requireRole('admin', 'manager', 'warehouse_supervisor', 'qc_officer'), validate(osdUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.osdReport.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'OSD report not found');
      return;
    }

    const updated = await prisma.osdReport.update({
      where: { id: req.params.id as string },
      data: {
        ...req.body,
        ...(req.body.reportDate ? { reportDate: new Date(req.body.reportDate) } : {}),
      },
    });

    await createAuditLog({
      tableName: 'osd_reports',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'entity:updated', { entity: 'osd' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/send-claim — Send supplier claim ─────────────────────────

router.post('/:id/send-claim', authenticate, requireRole('admin', 'warehouse_supervisor', 'qc_officer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const osd = await prisma.osdReport.findUnique({ where: { id: req.params.id as string } });

    if (!osd) {
      sendError(res, 404, 'OSD report not found');
      return;
    }
    if (osd.status !== 'draft' && osd.status !== 'under_review') {
      sendError(res, 400, 'OSD must be draft or under review to send claim');
      return;
    }

    const updated = await prisma.osdReport.update({
      where: { id: osd.id },
      data: {
        status: 'claim_sent',
        claimSentDate: new Date(),
        claimReference: (req.body as { claimReference?: string }).claimReference ?? null,
      },
    });

    await createAuditLog({
      tableName: 'osd_reports',
      recordId: osd.id,
      action: 'update',
      newValues: { status: 'claim_sent', claimSentDate: new Date().toISOString() },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, osd.id, 'osd:claim_sent', { id: osd.id, status: 'claim_sent' });
      emitToAll(io, 'document:status', { documentType: 'osd', documentId: osd.id, status: 'claim_sent' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/resolve — Resolve OSD ────────────────────────────────────

router.post('/:id/resolve', authenticate, requireRole('admin', 'warehouse_supervisor', 'qc_officer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const osd = await prisma.osdReport.findUnique({ where: { id: req.params.id as string } });

    if (!osd) {
      sendError(res, 404, 'OSD report not found');
      return;
    }

    const validStatuses = ['claim_sent', 'awaiting_response', 'negotiating'];
    if (!validStatuses.includes(osd.status)) {
      sendError(res, 400, `OSD cannot be resolved from status: ${osd.status}`);
      return;
    }

    const {
      resolutionType,
      resolutionAmount,
      supplierResponse,
    } = req.body as {
      resolutionType?: string;
      resolutionAmount?: number;
      supplierResponse?: string;
    };

    const updated = await prisma.osdReport.update({
      where: { id: osd.id },
      data: {
        status: 'resolved',
        resolutionType: resolutionType ?? null,
        resolutionAmount: resolutionAmount ?? null,
        resolutionDate: new Date(),
        resolvedById: req.user!.userId,
        supplierResponse: supplierResponse ?? null,
        responseDate: supplierResponse ? new Date() : null,
      },
    });

    await createAuditLog({
      tableName: 'osd_reports',
      recordId: osd.id,
      action: 'update',
      newValues: {
        status: 'resolved',
        resolutionType,
        resolutionAmount,
        resolvedById: req.user!.userId,
      },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, osd.id, 'osd:resolved', { id: osd.id, status: 'resolved', resolutionType });
      emitToAll(io, 'document:status', { documentType: 'osd', documentId: osd.id, status: 'resolved' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

export default router;
