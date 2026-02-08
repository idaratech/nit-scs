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
import { submitForApproval } from '../services/approval.service.js';
import { emitToDocument, emitToRole, emitToAll } from '../socket/setup.js';
import {
  joCreateSchema,
  joUpdateSchema,
  joApprovalSchema,
  joPaymentSchema,
} from '../schemas/job-order.schema.js';

const router = Router();

function clientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

// ── GET / — List Job Orders ───────────────────────────────────────────

router.get('/', authenticate, paginate('createdAt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { joNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter;

    const joTypeFilter = req.query.joType as string | undefined;
    if (joTypeFilter) where.joType = joTypeFilter;

    const projectIdFilter = req.query.projectId as string | undefined;
    if (projectIdFilter) where.projectId = projectIdFilter;

    const [data, total] = await Promise.all([
      prisma.jobOrder.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        include: {
          project: { select: { id: true, projectName: true, projectCode: true } },
          supplier: { select: { id: true, supplierName: true, supplierCode: true } },
          requestedBy: { select: { id: true, fullName: true } },
          entity: { select: { id: true, entityName: true } },
          slaTracking: { select: { slaDueDate: true, slaMet: true } },
          _count: { select: { approvals: true, payments: true, equipmentLines: true } },
        },
      }),
      prisma.jobOrder.count({ where }),
    ]);

    sendSuccess(res, data, { page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — Get single JO with all subtables ──────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({
      where: { id: req.params.id as string },
      include: {
        project: true,
        supplier: true,
        entity: true,
        requestedBy: { select: { id: true, fullName: true, email: true } },
        completedBy: { select: { id: true, fullName: true, email: true } },
        transportDetails: true,
        rentalDetails: true,
        generatorDetails: {
          include: {
            generator: { select: { id: true, generatorCode: true, generatorName: true, capacityKva: true } },
          },
        },
        scrapDetails: true,
        equipmentLines: {
          include: {
            equipmentType: { select: { id: true, typeName: true } },
          },
        },
        slaTracking: true,
        approvals: {
          include: {
            approver: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { approvedDate: 'desc' },
        },
        payments: {
          orderBy: { invoiceReceiptDate: 'desc' },
        },
        stockTransfers: { select: { id: true, transferNumber: true, status: true } },
        shipments: { select: { id: true, shipmentNumber: true, status: true } },
      },
    });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }

    sendSuccess(res, jo);
  } catch (err) {
    next(err);
  }
});

// ── POST / — Create Job Order + type-specific details ─────────────────

router.post('/', authenticate, requireRole('admin', 'manager', 'logistics_coordinator', 'site_engineer'), validate(joCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      transportDetails,
      rentalDetails,
      generatorDetails,
      scrapDetails,
      equipmentLines,
      ...headerData
    } = req.body;

    const jo = await prisma.$transaction(async (tx) => {
      const joNumber = await generateDocumentNumber('jo');

      const created = await tx.jobOrder.create({
        data: {
          joNumber,
          joType: headerData.joType,
          entityId: headerData.entityId ?? null,
          projectId: headerData.projectId,
          supplierId: headerData.supplierId ?? null,
          requestedById: req.user!.userId,
          requestDate: new Date(headerData.requestDate),
          requiredDate: headerData.requiredDate ? new Date(headerData.requiredDate) : null,
          priority: headerData.priority ?? 'normal',
          description: headerData.description,
          notes: headerData.notes ?? null,
          totalAmount: headerData.totalAmount ?? 0,
          status: 'draft',
        },
      });

      // Create type-specific subtable
      if (transportDetails && (headerData.joType === 'transport')) {
        await tx.joTransportDetail.create({
          data: {
            jobOrderId: created.id,
            pickupLocation: transportDetails.pickupLocation,
            pickupLocationUrl: transportDetails.pickupLocationUrl ?? null,
            pickupContactName: transportDetails.pickupContactName ?? null,
            pickupContactPhone: transportDetails.pickupContactPhone ?? null,
            deliveryLocation: transportDetails.deliveryLocation,
            deliveryLocationUrl: transportDetails.deliveryLocationUrl ?? null,
            deliveryContactName: transportDetails.deliveryContactName ?? null,
            deliveryContactPhone: transportDetails.deliveryContactPhone ?? null,
            cargoType: transportDetails.cargoType,
            cargoWeightTons: transportDetails.cargoWeightTons ?? null,
            numberOfTrailers: transportDetails.numberOfTrailers ?? null,
            numberOfTrips: transportDetails.numberOfTrips ?? null,
            includeLoadingEquipment: transportDetails.includeLoadingEquipment ?? false,
            loadingEquipmentType: transportDetails.loadingEquipmentType ?? null,
            insuranceRequired: transportDetails.insuranceRequired ?? false,
            materialPriceSar: transportDetails.materialPriceSar ?? null,
          },
        });
      }

      if (rentalDetails && (headerData.joType === 'rental_monthly' || headerData.joType === 'rental_daily')) {
        await tx.joRentalDetail.create({
          data: {
            jobOrderId: created.id,
            rentalStartDate: new Date(rentalDetails.rentalStartDate),
            rentalEndDate: new Date(rentalDetails.rentalEndDate),
            monthlyRate: rentalDetails.monthlyRate ?? null,
            dailyRate: rentalDetails.dailyRate ?? null,
            withOperator: rentalDetails.withOperator ?? false,
            overtimeHours: rentalDetails.overtimeHours ?? 0,
            overtimeApproved: rentalDetails.overtimeApproved ?? false,
          },
        });
      }

      if (generatorDetails && (headerData.joType === 'generator_rental' || headerData.joType === 'generator_maintenance')) {
        await tx.joGeneratorDetail.create({
          data: {
            jobOrderId: created.id,
            generatorId: generatorDetails.generatorId ?? null,
            capacityKva: generatorDetails.capacityKva ?? null,
            maintenanceType: generatorDetails.maintenanceType ?? null,
            issueDescription: generatorDetails.issueDescription ?? null,
            shiftStartTime: generatorDetails.shiftStartTime ? new Date(`1970-01-01T${generatorDetails.shiftStartTime}`) : null,
          },
        });
      }

      if (scrapDetails && headerData.joType === 'scrap') {
        await tx.joScrapDetail.create({
          data: {
            jobOrderId: created.id,
            scrapType: scrapDetails.scrapType,
            scrapWeightTons: scrapDetails.scrapWeightTons,
            scrapDescription: scrapDetails.scrapDescription ?? null,
            scrapDestination: scrapDetails.scrapDestination ?? null,
            materialPriceSar: scrapDetails.materialPriceSar ?? null,
          },
        });
      }

      if (equipmentLines && equipmentLines.length > 0 && headerData.joType === 'equipment') {
        await tx.joEquipmentLine.createMany({
          data: equipmentLines.map((line: Record<string, unknown>) => ({
            jobOrderId: created.id,
            equipmentTypeId: line.equipmentTypeId as string,
            quantity: line.quantity as number,
            withOperator: (line.withOperator as boolean) ?? false,
            siteLocation: (line.siteLocation as string) ?? null,
            dailyRate: (line.dailyRate as number) ?? null,
            durationDays: (line.durationDays as number) ?? null,
          })),
        });
      }

      // Create SLA tracking record
      await tx.joSlaTracking.create({
        data: {
          jobOrderId: created.id,
        },
      });

      return created;
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'create',
      newValues: { joNumber: jo.joNumber, joType: jo.joType, status: 'draft', totalAmount: Number(jo.totalAmount) },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    // Fetch full record for response
    const full = await prisma.jobOrder.findUnique({
      where: { id: jo.id },
      include: {
        transportDetails: true,
        rentalDetails: true,
        generatorDetails: true,
        scrapDetails: true,
        equipmentLines: true,
        slaTracking: true,
        project: { select: { id: true, projectName: true } },
        supplier: { select: { id: true, supplierName: true } },
      },
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToRole(io, 'logistics_coordinator', 'jo:created', { id: jo.id, joNumber: jo.joNumber, joType: jo.joType });
      emitToAll(io, 'entity:created', { entity: 'job-orders' });
    }

    sendCreated(res, full);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id — Update JO base fields (draft only) ────────────────────

router.put('/:id', authenticate, requireRole('admin', 'manager', 'logistics_coordinator', 'site_engineer'), validate(joUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (existing.status !== 'draft') {
      sendError(res, 400, 'Only draft Job Orders can be updated');
      return;
    }

    const updated = await prisma.jobOrder.update({
      where: { id: req.params.id as string },
      data: {
        ...req.body,
        ...(req.body.requestDate ? { requestDate: new Date(req.body.requestDate) } : {}),
        ...(req.body.requiredDate ? { requiredDate: new Date(req.body.requiredDate) } : {}),
      },
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: updated.id,
      action: 'update',
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: req.body,
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToAll(io, 'entity:updated', { entity: 'job-orders' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/submit — Submit for approval ───────────────────────────

router.post('/:id/submit', authenticate, requireRole('admin', 'manager', 'logistics_coordinator', 'site_engineer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (jo.status !== 'draft') {
      sendError(res, 400, 'Only draft Job Orders can be submitted for approval');
      return;
    }

    const io = req.app.get('io') as SocketIOServer | undefined;

    const approval = await submitForApproval({
      documentType: 'jo',
      documentId: jo.id,
      amount: Number(jo.totalAmount ?? 0),
      submittedById: req.user!.userId,
      io,
    });

    // Update SLA tracking with approval SLA hours
    await prisma.joSlaTracking.update({
      where: { jobOrderId: jo.id },
      data: {
        slaResponseHours: approval.slaHours,
        slaDueDate: (() => {
          const due = new Date();
          due.setHours(due.getHours() + approval.slaHours);
          return due;
        })(),
      },
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'pending_approval', approverRole: approval.approverRole },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    sendSuccess(res, {
      id: jo.id,
      status: 'pending_approval',
      approverRole: approval.approverRole,
      slaHours: approval.slaHours,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/approve — Approve JO ──────────────────────────────────

router.post('/:id/approve', authenticate, requireRole('admin', 'manager'), validate(joApprovalSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({
      where: { id: req.params.id as string },
      include: { approvals: true },
    });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (jo.status !== 'pending_approval' && jo.status !== 'quoted') {
      sendError(res, 400, 'Job Order must be pending approval or quoted');
      return;
    }

    const { approved, quoteAmount, comments } = req.body;

    if (!approved) {
      // Rejection
      await prisma.$transaction(async (tx) => {
        await tx.joApproval.create({
          data: {
            jobOrderId: jo.id,
            approvalType: 'standard',
            approverId: req.user!.userId,
            approvedDate: new Date(),
            approved: false,
            quoteAmount: quoteAmount ?? null,
            comments: comments ?? null,
          },
        });

        await tx.jobOrder.update({
          where: { id: jo.id },
          data: { status: 'rejected' },
        });
      });

      await createAuditLog({
        tableName: 'job_orders',
        recordId: jo.id,
        action: 'update',
        newValues: { status: 'rejected', rejectedById: req.user!.userId, comments },
        performedById: req.user!.userId,
        ipAddress: clientIp(req),
      });

      const io = req.app.get('io') as SocketIOServer | undefined;
      if (io) {
        emitToDocument(io, jo.id, 'jo:rejected', { id: jo.id, status: 'rejected' });
        emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'rejected' });
      }

      sendSuccess(res, { id: jo.id, status: 'rejected' });
      return;
    }

    // Approval
    await prisma.$transaction(async (tx) => {
      await tx.joApproval.create({
        data: {
          jobOrderId: jo.id,
          approvalType: 'standard',
          approverId: req.user!.userId,
          approvedDate: new Date(),
          approved: true,
          quoteAmount: quoteAmount ?? null,
          comments: comments ?? null,
        },
      });

      await tx.jobOrder.update({
        where: { id: jo.id },
        data: { status: 'approved' },
      });
    });

    // Check SLA
    const sla = await prisma.joSlaTracking.findUnique({ where: { jobOrderId: jo.id } });
    if (sla?.slaDueDate) {
      await prisma.joSlaTracking.update({
        where: { jobOrderId: jo.id },
        data: { slaMet: new Date() <= sla.slaDueDate },
      });
    }

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'approved', approvedById: req.user!.userId, quoteAmount },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, jo.id, 'jo:approved', { id: jo.id, status: 'approved' });
      emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'approved' });
    }

    sendSuccess(res, { id: jo.id, status: 'approved' });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/reject — Reject JO ────────────────────────────────────

router.post('/:id/reject', authenticate, requireRole('admin', 'manager'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (jo.status !== 'pending_approval' && jo.status !== 'quoted') {
      sendError(res, 400, 'Job Order must be pending approval or quoted to reject');
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.joApproval.create({
        data: {
          jobOrderId: jo.id,
          approvalType: 'standard',
          approverId: req.user!.userId,
          approvedDate: new Date(),
          approved: false,
          comments: (req.body.comments as string) ?? null,
        },
      });

      await tx.jobOrder.update({
        where: { id: jo.id },
        data: { status: 'rejected' },
      });
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'rejected', comments: req.body.comments },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, jo.id, 'jo:rejected', { id: jo.id, status: 'rejected' });
      emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'rejected' });
    }

    sendSuccess(res, { id: jo.id, status: 'rejected' });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/assign — Assign supplier ──────────────────────────────

router.post('/:id/assign', authenticate, requireRole('admin', 'manager', 'logistics_coordinator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (jo.status !== 'approved') {
      sendError(res, 400, 'Job Order must be approved before assigning');
      return;
    }

    const updated = await prisma.jobOrder.update({
      where: { id: jo.id },
      data: {
        status: 'assigned',
        supplierId: (req.body.supplierId as string) ?? jo.supplierId,
      },
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'assigned', supplierId: updated.supplierId },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, jo.id, 'jo:assigned', { id: jo.id, status: 'assigned' });
      emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'assigned' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/start — Start work ────────────────────────────────────

router.post('/:id/start', authenticate, requireRole('admin', 'manager', 'logistics_coordinator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (jo.status !== 'assigned') {
      sendError(res, 400, 'Job Order must be assigned before starting');
      return;
    }

    const updated = await prisma.jobOrder.update({
      where: { id: jo.id },
      data: {
        status: 'in_progress',
        startDate: new Date(),
      },
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'in_progress', startDate: updated.startDate?.toISOString() },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, jo.id, 'jo:started', { id: jo.id, status: 'in_progress' });
      emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'in_progress' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/hold — Put on hold (stop SLA clock) ──────────────────

router.post('/:id/hold', authenticate, requireRole('admin', 'manager', 'logistics_coordinator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (jo.status !== 'in_progress') {
      sendError(res, 400, 'Job Order must be in progress to put on hold');
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.jobOrder.update({
        where: { id: jo.id },
        data: { status: 'on_hold' },
      });

      // Stop SLA clock
      await tx.joSlaTracking.update({
        where: { jobOrderId: jo.id },
        data: {
          stopClockStart: new Date(),
          stopClockReason: (req.body.reason as string) ?? null,
        },
      });
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'on_hold', reason: req.body.reason },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, jo.id, 'jo:on_hold', { id: jo.id, status: 'on_hold' });
      emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'on_hold' });
    }

    sendSuccess(res, { id: jo.id, status: 'on_hold' });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/resume — Resume from hold ─────────────────────────────

router.post('/:id/resume', authenticate, requireRole('admin', 'manager', 'logistics_coordinator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (jo.status !== 'on_hold') {
      sendError(res, 400, 'Job Order must be on hold to resume');
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.jobOrder.update({
        where: { id: jo.id },
        data: { status: 'in_progress' },
      });

      // Stop SLA clock end
      const sla = await tx.joSlaTracking.findUnique({ where: { jobOrderId: jo.id } });
      if (sla?.stopClockStart && sla.slaDueDate) {
        const pausedMs = Date.now() - sla.stopClockStart.getTime();
        const newDue = new Date(sla.slaDueDate.getTime() + pausedMs);

        await tx.joSlaTracking.update({
          where: { jobOrderId: jo.id },
          data: {
            stopClockEnd: new Date(),
            slaDueDate: newDue,
          },
        });
      } else {
        await tx.joSlaTracking.update({
          where: { jobOrderId: jo.id },
          data: { stopClockEnd: new Date() },
        });
      }
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'in_progress', resumed: true },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, jo.id, 'jo:resumed', { id: jo.id, status: 'in_progress' });
      emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'in_progress' });
    }

    sendSuccess(res, { id: jo.id, status: 'in_progress' });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/complete — Complete JO ────────────────────────────────

router.post('/:id/complete', authenticate, requireRole('admin', 'manager', 'logistics_coordinator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({
      where: { id: req.params.id as string },
      include: { slaTracking: true },
    });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (jo.status !== 'in_progress') {
      sendError(res, 400, 'Job Order must be in progress to complete');
      return;
    }

    const now = new Date();

    // Check SLA met
    let slaMet: boolean | null = null;
    if (jo.slaTracking?.slaDueDate) {
      slaMet = now <= jo.slaTracking.slaDueDate;
    }

    await prisma.$transaction(async (tx) => {
      await tx.jobOrder.update({
        where: { id: jo.id },
        data: {
          status: 'completed',
          completionDate: now,
          completedById: req.user!.userId,
        },
      });

      if (slaMet !== null) {
        await tx.joSlaTracking.update({
          where: { jobOrderId: jo.id },
          data: { slaMet },
        });
      }
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'completed', completionDate: now.toISOString(), slaMet },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, jo.id, 'jo:completed', { id: jo.id, status: 'completed', slaMet });
      emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'completed' });
    }

    sendSuccess(res, { id: jo.id, status: 'completed', slaMet });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/invoice — Mark as invoiced + create payment ───────────

router.post('/:id/invoice', authenticate, requireRole('admin', 'manager', 'logistics_coordinator'), validate(joPaymentSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }
    if (jo.status !== 'completed') {
      sendError(res, 400, 'Job Order must be completed before invoicing');
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.jobOrder.update({
        where: { id: jo.id },
        data: { status: 'invoiced' },
      });

      const payment = await tx.joPayment.create({
        data: {
          jobOrderId: jo.id,
          invoiceNumber: req.body.invoiceNumber ?? null,
          invoiceReceiptDate: req.body.invoiceReceiptDate ? new Date(req.body.invoiceReceiptDate) : null,
          costExclVat: req.body.costExclVat ?? null,
          vatAmount: req.body.vatAmount ?? null,
          grandTotal: req.body.grandTotal ?? null,
          paymentStatus: req.body.paymentStatus ?? 'pending',
          oracleVoucher: req.body.oracleVoucher ?? null,
          attachmentUrl: req.body.attachmentUrl ?? null,
        },
      });

      return { updated, payment };
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'invoiced', paymentId: result.payment.id },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, jo.id, 'jo:invoiced', { id: jo.id, status: 'invoiced' });
      emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'invoiced' });
    }

    sendSuccess(res, { id: jo.id, status: 'invoiced', payment: result.payment });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/cancel — Cancel JO ────────────────────────────────────

router.post('/:id/cancel', authenticate, requireRole('admin', 'manager'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }

    const nonCancellable = ['completed', 'invoiced', 'cancelled'];
    if (nonCancellable.includes(jo.status)) {
      sendError(res, 400, `Job Order cannot be cancelled from status: ${jo.status}`);
      return;
    }

    const updated = await prisma.jobOrder.update({
      where: { id: jo.id },
      data: { status: 'cancelled' },
    });

    await createAuditLog({
      tableName: 'job_orders',
      recordId: jo.id,
      action: 'update',
      newValues: { status: 'cancelled', reason: req.body.reason },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io) {
      emitToDocument(io, jo.id, 'jo:cancelled', { id: jo.id, status: 'cancelled' });
      emitToAll(io, 'document:status', { documentType: 'job-orders', documentId: jo.id, status: 'cancelled' });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/payments — Add payment record ─────────────────────────

router.post('/:id/payments', authenticate, requireRole('admin', 'manager', 'logistics_coordinator'), validate(joPaymentSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jo = await prisma.jobOrder.findUnique({ where: { id: req.params.id as string } });

    if (!jo) {
      sendError(res, 404, 'Job Order not found');
      return;
    }

    const payment = await prisma.joPayment.create({
      data: {
        jobOrderId: jo.id,
        invoiceNumber: req.body.invoiceNumber ?? null,
        invoiceReceiptDate: req.body.invoiceReceiptDate ? new Date(req.body.invoiceReceiptDate) : null,
        costExclVat: req.body.costExclVat ?? null,
        vatAmount: req.body.vatAmount ?? null,
        grandTotal: req.body.grandTotal ?? null,
        paymentStatus: req.body.paymentStatus ?? 'pending',
        oracleVoucher: req.body.oracleVoucher ?? null,
        attachmentUrl: req.body.attachmentUrl ?? null,
      },
    });

    await createAuditLog({
      tableName: 'jo_payments',
      recordId: payment.id,
      action: 'create',
      newValues: { jobOrderId: jo.id, invoiceNumber: payment.invoiceNumber },
      performedById: req.user!.userId,
      ipAddress: clientIp(req),
    });

    sendCreated(res, payment);
  } catch (err) {
    next(err);
  }
});

// ── PUT /:id/payments/:pid — Update payment record ──────────────────

router.put('/:id/payments/:pid', authenticate, requireRole('admin', 'manager', 'logistics_coordinator'), validate(joPaymentSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.joPayment.findFirst({
      where: {
        id: req.params.pid as string,
        jobOrderId: req.params.id as string,
      },
    });

    if (!existing) {
      sendError(res, 404, 'Payment not found');
      return;
    }

    const updated = await prisma.joPayment.update({
      where: { id: existing.id },
      data: {
        ...(req.body.invoiceNumber !== undefined ? { invoiceNumber: req.body.invoiceNumber } : {}),
        ...(req.body.invoiceReceiptDate ? { invoiceReceiptDate: new Date(req.body.invoiceReceiptDate) } : {}),
        ...(req.body.costExclVat !== undefined ? { costExclVat: req.body.costExclVat } : {}),
        ...(req.body.vatAmount !== undefined ? { vatAmount: req.body.vatAmount } : {}),
        ...(req.body.grandTotal !== undefined ? { grandTotal: req.body.grandTotal } : {}),
        ...(req.body.paymentStatus ? { paymentStatus: req.body.paymentStatus } : {}),
        ...(req.body.oracleVoucher !== undefined ? { oracleVoucher: req.body.oracleVoucher } : {}),
        ...(req.body.attachmentUrl !== undefined ? { attachmentUrl: req.body.attachmentUrl } : {}),
        ...(req.body.paymentStatus === 'approved' ? { paymentApprovedDate: new Date() } : {}),
        ...(req.body.paymentStatus === 'paid' ? { actualPaymentDate: new Date() } : {}),
      },
    });

    await createAuditLog({
      tableName: 'jo_payments',
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

export default router;
