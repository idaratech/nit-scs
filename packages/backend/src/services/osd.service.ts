import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { generateDocumentNumber } from './document-number.service.js';
import { NotFoundError, BusinessRuleError } from '@nit-scs/shared';

const LIST_INCLUDE = {
  mrrv: { select: { id: true, mrrvNumber: true } },
  supplier: { select: { id: true, supplierName: true, supplierCode: true } },
  warehouse: { select: { id: true, warehouseName: true } },
  _count: { select: { osdLines: true } },
} satisfies Prisma.OsdReportInclude;

const DETAIL_INCLUDE = {
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
} satisfies Prisma.OsdReportInclude;

export async function list(params: {
  skip: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
  search?: string;
  status?: string;
}) {
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [{ osdNumber: { contains: params.search, mode: 'insensitive' } }];
  }
  if (params.status) where.status = params.status;

  const [data, total] = await Promise.all([
    prisma.osdReport.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip: params.skip,
      take: params.pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.osdReport.count({ where }),
  ]);
  return { data, total };
}

export async function getById(id: string) {
  const osd = await prisma.osdReport.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!osd) throw new NotFoundError('OSD report', id);
  return osd;
}

export async function create(headerData: Record<string, unknown>, lines: Record<string, unknown>[]) {
  return prisma.$transaction(async tx => {
    const osdNumber = await generateDocumentNumber('osd');

    let totalOverValue = 0;
    let totalShortValue = 0;
    let totalDamageValue = 0;

    for (const line of lines) {
      const unitCost = (line.unitCost as number) ?? 0;
      const qtyInvoice = line.qtyInvoice as number;
      const qtyReceived = line.qtyReceived as number;
      const qtyDamaged = (line.qtyDamaged as number) ?? 0;

      if (qtyReceived > qtyInvoice) totalOverValue += (qtyReceived - qtyInvoice) * unitCost;
      else if (qtyReceived < qtyInvoice) totalShortValue += (qtyInvoice - qtyReceived) * unitCost;
      totalDamageValue += qtyDamaged * unitCost;
    }

    return tx.osdReport.create({
      data: {
        osdNumber,
        mrrvId: (headerData.mrrvId as string) ?? null,
        poNumber: (headerData.poNumber as string) ?? null,
        supplierId: (headerData.supplierId as string) ?? null,
        warehouseId: (headerData.warehouseId as string) ?? null,
        reportDate: new Date(headerData.reportDate as string),
        reportTypes: headerData.reportTypes as string[],
        status: 'draft',
        totalOverValue,
        totalShortValue,
        totalDamageValue,
        osdLines: {
          create: lines.map(line => ({
            itemId: line.itemId as string,
            uomId: line.uomId as string,
            mrrvLineId: (line.mrrvLineId as string) ?? null,
            qtyInvoice: line.qtyInvoice as number,
            qtyReceived: line.qtyReceived as number,
            qtyDamaged: (line.qtyDamaged as number) ?? 0,
            damageType: (line.damageType as string) ?? null,
            unitCost: (line.unitCost as number) ?? null,
            notes: (line.notes as string) ?? null,
          })),
        },
      },
      include: {
        osdLines: true,
        mrrv: { select: { id: true, mrrvNumber: true } },
        supplier: { select: { id: true, supplierName: true } },
      },
    });
  });
}

export async function update(id: string, data: Record<string, unknown>) {
  const existing = await prisma.osdReport.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('OSD report', id);

  const updated = await prisma.osdReport.update({
    where: { id },
    data: {
      ...data,
      ...(data.reportDate ? { reportDate: new Date(data.reportDate as string) } : {}),
    },
  });
  return { existing, updated };
}

export async function sendClaim(id: string, claimReference?: string) {
  const osd = await prisma.osdReport.findUnique({ where: { id } });
  if (!osd) throw new NotFoundError('OSD report', id);
  if (osd.status !== 'draft' && osd.status !== 'under_review') {
    throw new BusinessRuleError('OSD must be draft or under review to send claim');
  }

  return prisma.osdReport.update({
    where: { id: osd.id },
    data: { status: 'claim_sent', claimSentDate: new Date(), claimReference: claimReference ?? null },
  });
}

export async function resolve(
  id: string,
  userId: string,
  params: { resolutionType?: string; resolutionAmount?: number; supplierResponse?: string },
) {
  const osd = await prisma.osdReport.findUnique({ where: { id } });
  if (!osd) throw new NotFoundError('OSD report', id);

  const validStatuses = ['claim_sent', 'awaiting_response', 'negotiating'];
  if (!validStatuses.includes(osd.status)) {
    throw new BusinessRuleError(`OSD cannot be resolved from status: ${osd.status}`);
  }

  return prisma.osdReport.update({
    where: { id: osd.id },
    data: {
      status: 'resolved',
      resolutionType: params.resolutionType ?? null,
      resolutionAmount: params.resolutionAmount ?? null,
      resolutionDate: new Date(),
      resolvedById: userId,
      supplierResponse: params.supplierResponse ?? null,
      responseDate: params.supplierResponse ? new Date() : null,
    },
  });
}
