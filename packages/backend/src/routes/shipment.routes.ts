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
import {
  shipmentCreateSchema,
  shipmentUpdateSchema,
  shipmentStatusSchema,
  customsStageSchema,
  customsStageUpdateSchema,
} from '../schemas/logistics.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List Shipments ───────────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { shipmentNumber: { contains: search, mode: 'insensitive' } },
        { awbBlNumber: { contains: search, mode: 'insensitive' } },
        { containerNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { supplierName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const modeFilter = req.query.modeOfShipment as string | undefined;
    if (modeFilter) where.modeOfShipment = modeFilter;

    const [data, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          supplier: { select: { id: true, supplierName: true, supplierCode: true } },
          freightForwarder: { select: { id: true, supplierName: true } },
          project: { select: { id: true, projectName: true, projectCode: true } },
          portOfEntry: { select: { id: true, portName: true, portCode: true } },
          destinationWarehouse: { select: { id: true, warehouseName: true } },
          _count: { select: { shipmentLines: true, customsTracking: true } },
        },
      }),
      prisma.shipment.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single Shipment ──────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id as string },
      include: {
        shipmentLines: {
          include: {
            item: { select: { id: true, itemCode: true, itemDescription: true } },
            uom: { select: { id: true, uomCode: true, uomName: true } },
          },
        },
        customsTracking: {
          orderBy: { stageDate: 'asc' },
        },
        supplier: true,
        freightForwarder: true,
        project: true,
        portOfEntry: true,
        destinationWarehouse: true,
        mrrv: { select: { id: true, mrrvNumber: true, status: true } },
        transportJo: { select: { id: true, joNumber: true, status: true } },
      },
    });

    if (!shipment) {
      sendError(res, 404, 'Shipment not found');
      return;
    }

    sendSuccess(res, shipment);
  } catch (err) {
    next(err);
  }
});

// ── POST / — Create Shipment ────────────────────────────────────────

router.post('/', authenticate, requireRole('admin', 'manager', 'logistics_coordinator', 'freight_forwarder'), validate(shipmentCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lines, ...headerData } = req.body;

    const shipment = await prisma.$transaction(async (tx) => {
      const shipmentNumber = await generateDocumentNumber('shipment');

      const created = await tx.shipment.create({
        data: {
          shipmentNumber,
          poNumber: headerData.poNumber ?? null,
          supplierId: headerData.supplierId,
          freightForwarderId: headerData.freightForwarderId ?? null,
          projectId: headerData.projectId ?? null,
          originCountry: headerData.originCountry ?? null,
          modeOfShipment: headerData.modeOfShipment,
          portOfLoading: headerData.portOfLoading ?? null,
          portOfEntryId: headerData.portOfEntryId ?? null,
          destinationWarehouseId: headerData.destinationWarehouseId ?? null,
          orderDate: headerData.orderDate ? new Date(headerData.orderDate) : null,
          expectedShipDate: headerData.expectedShipDate ? new Date(headerData.expectedShipDate) : null,
          status: 'draft',
          awbBlNumber: headerData.awbBlNumber ?? null,
          containerNumber: headerData.containerNumber ?? null,
          vesselFlight: headerData.vesselFlight ?? null,
          trackingUrl: headerData.trackingUrl ?? null,
          commercialValue: headerData.commercialValue ?? null,
          freightCost: headerData.freightCost ?? null,
          insuranceCost: headerData.insuranceCost ?? null,
          dutiesEstimated: headerData.dutiesEstimated ?? null,
          description: headerData.description ?? null,
          notes: headerData.notes ?? null,
          shipmentLines: {
            create: lines.map((line: Record<string, unknown>) => ({
              itemId: (line.itemId as string) ?? null,
              description: line.description as string,
              quantity: line.quantity as number,
              uomId: (line.uomId as string) ?? null,
              unitValue: (line.unitValue as number) ?? null,
              hsCode: (line.hsCode as string) ?? null,
            })),
          },
        },
        include: {
          shipmentLines: true,
          supplier: { select: { id: true, supplierName: true } },
        },
      });

      return created;
    });

    await createAuditLog({
      tableName: 'shipments',
      recordId: shipment.id,
      action: 'create',
      newValues: {
        shipmentNumber: shipment.shipmentNumber,
        modeOfShipment: shipment.modeOfShipment,
        status: 'draft',
      },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'shipment:created', { id: shipment.id, shipmentNumber: shipment.shipmentNumber });
      emitToAll(io, 'entity:created', { entity: 'shipments' });
    }

    sendCreated(res, shipment);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update Shipment header ───────────────────────────────

router.put('/:id', authenticate, requireRole('admin', 'manager', 'logistics_coordinator', 'freight_forwarder'), validate(shipmentUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.shipment.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'Shipment not found');
      return;
    }

    const dateFields = ['orderDate', 'expectedShipDate', 'actualShipDate', 'etaPort', 'actualArrivalDate'];
    const dateTransforms: Record<string, Date> = {};
    for (const field of dateFields) {
      if (req.body[field]) {
        dateTransforms[field] = new Date(req.body[field]);
      }
    }

    const updated = await prisma.shipment.update({
      where: { id: req.params.id as string },
      data: {
        ...req.body,
        ...dateTransforms,
      },
    });

    await createAuditLog({
      tableName: 'shipments',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, updated.id, 'shipment:updated', { id: updated.id, status: updated.status });
      emitToAll(io, 'entity:updated', { entity: 'shipments' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id/status — Update shipment status ────────────────────────

router.put('/:id/status', authenticate, requireRole('admin', 'manager', 'logistics_coordinator', 'freight_forwarder'), validate(shipmentStatusSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.shipment.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'Shipment not found');
      return;
    }

    const { status, actualShipDate, etaPort, actualArrivalDate } = req.body;

    const data: Record<string, unknown> = { status };
    if (actualShipDate) data.actualShipDate = new Date(actualShipDate);
    if (etaPort) data.etaPort = new Date(etaPort);
    if (actualArrivalDate) data.actualArrivalDate = new Date(actualArrivalDate);

    const updated = await prisma.shipment.update({
      where: { id: req.params.id as string },
      data,
    });

    await createAuditLog({
      tableName: 'shipments',
      recordId: updated.id,
      action: 'update',
      oldValues: { status: existing.status },
      newValues: { status, actualShipDate, etaPort, actualArrivalDate },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, updated.id, 'shipment:status', { id: updated.id, status });
      emitToAll(io, 'document:status', { documentType: 'shipments', documentId: updated.id, status });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/customs — Add customs tracking stage ──────────────────

router.post('/:id/customs', authenticate, requireRole('admin', 'manager', 'logistics_coordinator', 'freight_forwarder'), validate(customsStageSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id as string } });

    if (!shipment) {
      sendError(res, 404, 'Shipment not found');
      return;
    }

    const customs = await prisma.customsTracking.create({
      data: {
        shipmentId: shipment.id,
        stage: req.body.stage,
        stageDate: new Date(req.body.stageDate),
        customsDeclaration: req.body.customsDeclaration ?? null,
        customsRef: req.body.customsRef ?? null,
        inspectorName: req.body.inspectorName ?? null,
        inspectionType: req.body.inspectionType ?? null,
        dutiesAmount: req.body.dutiesAmount ?? null,
        vatAmount: req.body.vatAmount ?? null,
        otherFees: req.body.otherFees ?? null,
        paymentStatus: req.body.paymentStatus ?? null,
        issues: req.body.issues ?? null,
        resolution: req.body.resolution ?? null,
      },
    });

    // Auto-update shipment status based on customs stage
    const stageToStatus: Record<string, string> = {
      docs_submitted: 'customs_clearing',
      declaration_filed: 'customs_clearing',
      under_inspection: 'customs_clearing',
      awaiting_payment: 'customs_clearing',
      duties_paid: 'customs_clearing',
      ready_for_release: 'customs_clearing',
      released: 'cleared',
    };

    const newShipmentStatus = stageToStatus[req.body.stage];
    if (newShipmentStatus && shipment.status !== newShipmentStatus) {
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { status: newShipmentStatus },
      });
    }

    await createAuditLog({
      tableName: 'customs_tracking',
      recordId: customs.id,
      action: 'create',
      newValues: { shipmentId: shipment.id, stage: customs.stage },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, shipment.id, 'shipment:customs', {
        shipmentId: shipment.id,
        customsId: customs.id,
        stage: customs.stage,
      });
      if (newShipmentStatus) {
        emitToAll(io, 'document:status', { documentType: 'shipments', documentId: shipment.id, status: newShipmentStatus });
      }
    }

    sendCreated(res, customs);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id/customs/:cid — Update customs stage ───────────────────

router.put('/:id/customs/:cid', authenticate, requireRole('admin', 'manager', 'logistics_coordinator', 'freight_forwarder'), validate(customsStageUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.customsTracking.findFirst({
      where: {
        id: req.params.cid as string,
        shipmentId: req.params.id as string,
      },
    });

    if (!existing) {
      sendError(res, 404, 'Customs tracking stage not found');
      return;
    }

    const updated = await prisma.customsTracking.update({
      where: { id: existing.id },
      data: {
        ...(req.body.stage !== undefined ? { stage: req.body.stage } : {}),
        ...(req.body.stageDate ? { stageDate: new Date(req.body.stageDate) } : {}),
        ...(req.body.customsDeclaration !== undefined ? { customsDeclaration: req.body.customsDeclaration } : {}),
        ...(req.body.customsRef !== undefined ? { customsRef: req.body.customsRef } : {}),
        ...(req.body.inspectorName !== undefined ? { inspectorName: req.body.inspectorName } : {}),
        ...(req.body.inspectionType !== undefined ? { inspectionType: req.body.inspectionType } : {}),
        ...(req.body.dutiesAmount !== undefined ? { dutiesAmount: req.body.dutiesAmount } : {}),
        ...(req.body.vatAmount !== undefined ? { vatAmount: req.body.vatAmount } : {}),
        ...(req.body.otherFees !== undefined ? { otherFees: req.body.otherFees } : {}),
        ...(req.body.paymentStatus !== undefined ? { paymentStatus: req.body.paymentStatus } : {}),
        ...(req.body.issues !== undefined ? { issues: req.body.issues } : {}),
        ...(req.body.resolution !== undefined ? { resolution: req.body.resolution } : {}),
        stageEndDate: req.body.resolution ? new Date() : undefined,
      },
    });

    await createAuditLog({
      tableName: 'customs_tracking',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/deliver — Mark as delivered ───────────────────────────

router.post('/:id/deliver', authenticate, requireRole('admin', 'manager', 'logistics_coordinator', 'freight_forwarder'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id as string } });

    if (!shipment) {
      sendError(res, 404, 'Shipment not found');
      return;
    }

    const deliverable = ['cleared', 'in_delivery'];
    if (!deliverable.includes(shipment.status)) {
      sendError(res, 400, `Shipment cannot be delivered from status: ${shipment.status}`);
      return;
    }

    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: 'delivered',
        deliveryDate: new Date(),
      },
    });

    // If linked to MRRV, update it
    if (shipment.mrrvId) {
      await prisma.mrrv.update({
        where: { id: shipment.mrrvId },
        data: { status: 'received' },
      }).catch(() => {
        // MRRV update is best-effort; don't fail the shipment delivery
      });
    }

    await createAuditLog({
      tableName: 'shipments',
      recordId: shipment.id,
      action: 'update',
      newValues: { status: 'delivered', deliveryDate: updated.deliveryDate?.toISOString() },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, shipment.id, 'shipment:delivered', { id: shipment.id, status: 'delivered' });
      emitToAll(io, 'shipment:delivered', { id: shipment.id, shipmentNumber: shipment.shipmentNumber });
      emitToAll(io, 'document:status', { documentType: 'shipments', documentId: shipment.id, status: 'delivered' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/cancel — Cancel Shipment ──────────────────────────────

router.post('/:id/cancel', authenticate, requireRole('admin', 'manager', 'logistics_coordinator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id as string } });

    if (!shipment) {
      sendError(res, 404, 'Shipment not found');
      return;
    }

    const nonCancellable = ['delivered', 'cancelled'];
    if (nonCancellable.includes(shipment.status)) {
      sendError(res, 400, `Shipment cannot be cancelled from status: ${shipment.status}`);
      return;
    }

    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: 'cancelled' },
    });

    await createAuditLog({
      tableName: 'shipments',
      recordId: shipment.id,
      action: 'update',
      newValues: { status: 'cancelled' },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, shipment.id, 'shipment:cancelled', { id: shipment.id, status: 'cancelled' });
      emitToAll(io, 'document:status', { documentType: 'shipments', documentId: shipment.id, status: 'cancelled' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

export default router;
