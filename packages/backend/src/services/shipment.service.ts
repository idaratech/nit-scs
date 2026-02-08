import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { generateDocumentNumber } from './document-number.service.js';
import { NotFoundError, BusinessRuleError } from '@nit-scs/shared';

const LIST_INCLUDE = {
  supplier: { select: { id: true, supplierName: true, supplierCode: true } },
  freightForwarder: { select: { id: true, supplierName: true } },
  project: { select: { id: true, projectName: true, projectCode: true } },
  portOfEntry: { select: { id: true, portName: true, portCode: true } },
  destinationWarehouse: { select: { id: true, warehouseName: true } },
  _count: { select: { shipmentLines: true, customsTracking: true } },
} satisfies Prisma.ShipmentInclude;

const DETAIL_INCLUDE = {
  shipmentLines: {
    include: {
      item: { select: { id: true, itemCode: true, itemDescription: true } },
      uom: { select: { id: true, uomCode: true, uomName: true } },
    },
  },
  customsTracking: { orderBy: { stageDate: 'asc' as const } },
  supplier: true,
  freightForwarder: true,
  project: true,
  portOfEntry: true,
  destinationWarehouse: true,
  mrrv: { select: { id: true, mrrvNumber: true, status: true } },
  transportJo: { select: { id: true, joNumber: true, status: true } },
} satisfies Prisma.ShipmentInclude;

export async function list(params: {
  skip: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
  search?: string;
  status?: string;
  modeOfShipment?: string;
}) {
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { shipmentNumber: { contains: params.search, mode: 'insensitive' } },
      { awbBlNumber: { contains: params.search, mode: 'insensitive' } },
      { containerNumber: { contains: params.search, mode: 'insensitive' } },
      { supplier: { supplierName: { contains: params.search, mode: 'insensitive' } } },
    ];
  }
  if (params.status) where.status = params.status;
  if (params.modeOfShipment) where.modeOfShipment = params.modeOfShipment;

  const [data, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip: params.skip,
      take: params.pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.shipment.count({ where }),
  ]);
  return { data, total };
}

export async function getById(id: string) {
  const s = await prisma.shipment.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!s) throw new NotFoundError('Shipment', id);
  return s;
}

export async function create(headerData: Record<string, unknown>, lines: Record<string, unknown>[]) {
  return prisma.$transaction(async tx => {
    const shipmentNumber = await generateDocumentNumber('shipment');
    return tx.shipment.create({
      data: {
        shipmentNumber,
        poNumber: (headerData.poNumber as string) ?? null,
        supplierId: headerData.supplierId as string,
        freightForwarderId: (headerData.freightForwarderId as string) ?? null,
        projectId: (headerData.projectId as string) ?? null,
        originCountry: (headerData.originCountry as string) ?? null,
        modeOfShipment: headerData.modeOfShipment as string,
        portOfLoading: (headerData.portOfLoading as string) ?? null,
        portOfEntryId: (headerData.portOfEntryId as string) ?? null,
        destinationWarehouseId: (headerData.destinationWarehouseId as string) ?? null,
        orderDate: headerData.orderDate ? new Date(headerData.orderDate as string) : null,
        expectedShipDate: headerData.expectedShipDate ? new Date(headerData.expectedShipDate as string) : null,
        status: 'draft',
        awbBlNumber: (headerData.awbBlNumber as string) ?? null,
        containerNumber: (headerData.containerNumber as string) ?? null,
        vesselFlight: (headerData.vesselFlight as string) ?? null,
        trackingUrl: (headerData.trackingUrl as string) ?? null,
        commercialValue: (headerData.commercialValue as number) ?? null,
        freightCost: (headerData.freightCost as number) ?? null,
        insuranceCost: (headerData.insuranceCost as number) ?? null,
        dutiesEstimated: (headerData.dutiesEstimated as number) ?? null,
        description: (headerData.description as string) ?? null,
        notes: (headerData.notes as string) ?? null,
        shipmentLines: {
          create: lines.map(line => ({
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
  });
}

export async function update(id: string, data: Record<string, unknown>) {
  const existing = await prisma.shipment.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Shipment', id);

  const dateFields = ['orderDate', 'expectedShipDate', 'actualShipDate', 'etaPort', 'actualArrivalDate'];
  const dateTransforms: Record<string, Date> = {};
  for (const field of dateFields) {
    if (data[field]) dateTransforms[field] = new Date(data[field] as string);
  }

  const updated = await prisma.shipment.update({
    where: { id },
    data: { ...data, ...dateTransforms },
  });
  return { existing, updated };
}

export async function updateStatus(
  id: string,
  status: string,
  extra: { actualShipDate?: string; etaPort?: string; actualArrivalDate?: string },
) {
  const existing = await prisma.shipment.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Shipment', id);

  const updateData: Record<string, unknown> = { status };
  if (extra.actualShipDate) updateData.actualShipDate = new Date(extra.actualShipDate);
  if (extra.etaPort) updateData.etaPort = new Date(extra.etaPort);
  if (extra.actualArrivalDate) updateData.actualArrivalDate = new Date(extra.actualArrivalDate);

  const updated = await prisma.shipment.update({ where: { id }, data: updateData });
  return { existing, updated };
}

export async function addCustomsStage(shipmentId: string, data: Record<string, unknown>) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError('Shipment', shipmentId);

  const customs = await prisma.customsTracking.create({
    data: {
      shipmentId: shipment.id,
      stage: data.stage as string,
      stageDate: new Date(data.stageDate as string),
      customsDeclaration: (data.customsDeclaration as string) ?? null,
      customsRef: (data.customsRef as string) ?? null,
      inspectorName: (data.inspectorName as string) ?? null,
      inspectionType: (data.inspectionType as string) ?? null,
      dutiesAmount: (data.dutiesAmount as number) ?? null,
      vatAmount: (data.vatAmount as number) ?? null,
      otherFees: (data.otherFees as number) ?? null,
      paymentStatus: (data.paymentStatus as string) ?? null,
      issues: (data.issues as string) ?? null,
      resolution: (data.resolution as string) ?? null,
    },
  });

  const stageToStatus: Record<string, string> = {
    docs_submitted: 'customs_clearing',
    declaration_filed: 'customs_clearing',
    under_inspection: 'customs_clearing',
    awaiting_payment: 'customs_clearing',
    duties_paid: 'customs_clearing',
    ready_for_release: 'customs_clearing',
    released: 'cleared',
  };

  const newShipmentStatus = stageToStatus[data.stage as string];
  if (newShipmentStatus && shipment.status !== newShipmentStatus) {
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: newShipmentStatus },
    });
  }

  return { customs, newShipmentStatus, shipmentId: shipment.id };
}

export async function updateCustomsStage(shipmentId: string, customsId: string, data: Record<string, unknown>) {
  const existing = await prisma.customsTracking.findFirst({
    where: { id: customsId, shipmentId },
  });
  if (!existing) throw new NotFoundError('Customs tracking stage', customsId);

  const updated = await prisma.customsTracking.update({
    where: { id: existing.id },
    data: {
      ...(data.stage !== undefined ? { stage: data.stage as string } : {}),
      ...(data.stageDate ? { stageDate: new Date(data.stageDate as string) } : {}),
      ...(data.customsDeclaration !== undefined ? { customsDeclaration: data.customsDeclaration as string } : {}),
      ...(data.customsRef !== undefined ? { customsRef: data.customsRef as string } : {}),
      ...(data.inspectorName !== undefined ? { inspectorName: data.inspectorName as string } : {}),
      ...(data.inspectionType !== undefined ? { inspectionType: data.inspectionType as string } : {}),
      ...(data.dutiesAmount !== undefined ? { dutiesAmount: data.dutiesAmount as number } : {}),
      ...(data.vatAmount !== undefined ? { vatAmount: data.vatAmount as number } : {}),
      ...(data.otherFees !== undefined ? { otherFees: data.otherFees as number } : {}),
      ...(data.paymentStatus !== undefined ? { paymentStatus: data.paymentStatus as string } : {}),
      ...(data.issues !== undefined ? { issues: data.issues as string } : {}),
      ...(data.resolution !== undefined ? { resolution: data.resolution as string } : {}),
      stageEndDate: data.resolution ? new Date() : undefined,
    },
  });

  return { existing, updated };
}

export async function deliver(id: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id } });
  if (!shipment) throw new NotFoundError('Shipment', id);

  const deliverable = ['cleared', 'in_delivery'];
  if (!deliverable.includes(shipment.status)) {
    throw new BusinessRuleError(`Shipment cannot be delivered from status: ${shipment.status}`);
  }

  const updated = await prisma.shipment.update({
    where: { id: shipment.id },
    data: { status: 'delivered', deliveryDate: new Date() },
  });

  // Best-effort MRRV update
  if (shipment.mrrvId) {
    await prisma.mrrv
      .update({
        where: { id: shipment.mrrvId },
        data: { status: 'received' },
      })
      .catch(() => {});
  }

  return updated;
}

export async function cancel(id: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id } });
  if (!shipment) throw new NotFoundError('Shipment', id);

  const nonCancellable = ['delivered', 'cancelled'];
  if (nonCancellable.includes(shipment.status)) {
    throw new BusinessRuleError(`Shipment cannot be cancelled from status: ${shipment.status}`);
  }

  return prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'cancelled' } });
}
