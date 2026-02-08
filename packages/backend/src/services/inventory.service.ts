import { prisma } from '../utils/prisma.js';
import { generateDocumentNumber } from './document-number.service.js';
import { createAuditLog } from './audit.service.js';
import { log } from '../config/logger.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface AddStockParams {
  itemId: string;
  warehouseId: string;
  qty: number;
  unitCost?: number;
  supplierId?: string;
  mrrvLineId?: string;
  expiryDate?: Date;
  performedById?: string;
}

export interface StockLevel {
  onHand: number;
  reserved: number;
  available: number;
}

export interface ConsumptionResult {
  totalCost: number;
}

// ── Add Stock ───────────────────────────────────────────────────────────

export async function addStock(params: AddStockParams): Promise<void> {
  const { itemId, warehouseId, qty, unitCost, supplierId, mrrvLineId, expiryDate, performedById } = params;

  await prisma.$transaction(async tx => {
    // 1. Upsert InventoryLevel - increment qtyOnHand
    await tx.inventoryLevel.upsert({
      where: {
        itemId_warehouseId: { itemId, warehouseId },
      },
      create: {
        itemId,
        warehouseId,
        qtyOnHand: qty,
        qtyReserved: 0,
        lastMovementDate: new Date(),
      },
      update: {
        qtyOnHand: { increment: qty },
        lastMovementDate: new Date(),
        alertSent: false,
      },
    });

    // 2. Create InventoryLot
    const lotNumber = await generateDocumentNumber('lot');
    await tx.inventoryLot.create({
      data: {
        lotNumber,
        itemId,
        warehouseId,
        mrrvLineId: mrrvLineId ?? null,
        receiptDate: new Date(),
        expiryDate: expiryDate ?? null,
        initialQty: qty,
        availableQty: qty,
        reservedQty: 0,
        unitCost: unitCost ?? null,
        supplierId: supplierId ?? null,
        status: 'active',
      },
    });

    // 3. Audit log
    if (performedById) {
      await createAuditLog({
        tableName: 'inventory_levels',
        recordId: `${itemId}:${warehouseId}`,
        action: 'update',
        newValues: {
          action: 'add_stock',
          qty,
          unitCost,
          lotNumber,
          mrrvLineId,
        },
        performedById,
      });
    }
  });

  log('info', `[Inventory] Added ${qty} units of item ${itemId} to warehouse ${warehouseId}`);
}

// ── Reserve Stock (FIFO) ────────────────────────────────────────────────

export async function reserveStock(itemId: string, warehouseId: string, qty: number): Promise<boolean> {
  return prisma.$transaction(async tx => {
    // 1. Check availability
    const level = await tx.inventoryLevel.findUnique({
      where: { itemId_warehouseId: { itemId, warehouseId } },
    });

    if (!level) return false;

    const available = Number(level.qtyOnHand) - Number(level.qtyReserved);
    if (available < qty) return false;

    // 2. Increment qtyReserved in InventoryLevel
    await tx.inventoryLevel.update({
      where: { itemId_warehouseId: { itemId, warehouseId } },
      data: {
        qtyReserved: { increment: qty },
      },
    });

    // 3. Reserve from oldest lots first (FIFO by receiptDate)
    const lots = await tx.inventoryLot.findMany({
      where: {
        itemId,
        warehouseId,
        status: 'active',
        availableQty: { gt: 0 },
      },
      orderBy: { receiptDate: 'asc' },
    });

    let remaining = qty;
    for (const lot of lots) {
      if (remaining <= 0) break;

      const lotAvailable = Number(lot.availableQty) - Number(lot.reservedQty ?? 0);
      if (lotAvailable <= 0) continue;

      const toReserve = Math.min(remaining, lotAvailable);

      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: {
          reservedQty: { increment: toReserve },
        },
      });

      remaining -= toReserve;
    }

    if (remaining > 0) {
      // Should not happen since we checked availability, but safeguard
      throw new Error('Insufficient lot availability for reservation');
    }

    return true;
  });
}

// ── Release Reservation ─────────────────────────────────────────────────

export async function releaseReservation(itemId: string, warehouseId: string, qty: number): Promise<void> {
  await prisma.$transaction(async tx => {
    // 1. Decrement qtyReserved in InventoryLevel
    await tx.inventoryLevel.update({
      where: { itemId_warehouseId: { itemId, warehouseId } },
      data: {
        qtyReserved: { decrement: qty },
      },
    });

    // 2. Release from oldest lots first (FIFO)
    const lots = await tx.inventoryLot.findMany({
      where: {
        itemId,
        warehouseId,
        status: 'active',
        reservedQty: { gt: 0 },
      },
      orderBy: { receiptDate: 'asc' },
    });

    let remaining = qty;
    for (const lot of lots) {
      if (remaining <= 0) break;

      const lotReserved = Number(lot.reservedQty ?? 0);
      if (lotReserved <= 0) continue;

      const toRelease = Math.min(remaining, lotReserved);

      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: {
          reservedQty: { decrement: toRelease },
        },
      });

      remaining -= toRelease;
    }
  });

  log('info', `[Inventory] Released reservation of ${qty} units of item ${itemId} in warehouse ${warehouseId}`);
}

// ── Consume Reservation (FIFO) ─────────────────────────────────────────

export async function consumeReservation(
  itemId: string,
  warehouseId: string,
  qty: number,
  mirvLineId: string,
): Promise<ConsumptionResult> {
  return prisma.$transaction(async tx => {
    // 1. Decrement both qtyOnHand AND qtyReserved in InventoryLevel
    await tx.inventoryLevel.update({
      where: { itemId_warehouseId: { itemId, warehouseId } },
      data: {
        qtyOnHand: { decrement: qty },
        qtyReserved: { decrement: qty },
        lastMovementDate: new Date(),
      },
    });

    // 2. Consume from oldest lots (FIFO)
    const lots = await tx.inventoryLot.findMany({
      where: {
        itemId,
        warehouseId,
        status: 'active',
        availableQty: { gt: 0 },
      },
      orderBy: { receiptDate: 'asc' },
    });

    let remaining = qty;
    let totalCost = 0;

    for (const lot of lots) {
      if (remaining <= 0) break;

      const lotAvailable = Number(lot.availableQty);
      if (lotAvailable <= 0) continue;

      const toConsume = Math.min(remaining, lotAvailable);
      const unitCost = Number(lot.unitCost ?? 0);
      totalCost += toConsume * unitCost;

      // Decrement availableQty and reservedQty on lot
      const newAvailable = lotAvailable - toConsume;
      const newReserved = Math.max(0, Number(lot.reservedQty ?? 0) - toConsume);

      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: {
          availableQty: newAvailable,
          reservedQty: newReserved,
          status: newAvailable <= 0 ? 'depleted' : 'active',
        },
      });

      // 3. Create LotConsumption record
      await tx.lotConsumption.create({
        data: {
          lotId: lot.id,
          mirvLineId,
          quantity: toConsume,
          unitCost: unitCost > 0 ? unitCost : null,
          consumptionDate: new Date(),
        },
      });

      remaining -= toConsume;
    }

    return { totalCost };
  });
}

// ── Deduct Stock (without reservation) ──────────────────────────────────

export async function deductStock(
  itemId: string,
  warehouseId: string,
  qty: number,
  mirvLineId: string,
): Promise<ConsumptionResult> {
  return prisma.$transaction(async tx => {
    // 1. Check availability
    const level = await tx.inventoryLevel.findUnique({
      where: { itemId_warehouseId: { itemId, warehouseId } },
    });

    if (!level || Number(level.qtyOnHand) < qty) {
      throw new Error(`Insufficient stock for item ${itemId} in warehouse ${warehouseId}`);
    }

    // 2. Decrement qtyOnHand only (no reservation involved)
    await tx.inventoryLevel.update({
      where: { itemId_warehouseId: { itemId, warehouseId } },
      data: {
        qtyOnHand: { decrement: qty },
        lastMovementDate: new Date(),
      },
    });

    // 3. Consume from oldest lots (FIFO)
    const lots = await tx.inventoryLot.findMany({
      where: {
        itemId,
        warehouseId,
        status: 'active',
        availableQty: { gt: 0 },
      },
      orderBy: { receiptDate: 'asc' },
    });

    let remaining = qty;
    let totalCost = 0;

    for (const lot of lots) {
      if (remaining <= 0) break;

      const lotAvailable = Number(lot.availableQty);
      if (lotAvailable <= 0) continue;

      const toConsume = Math.min(remaining, lotAvailable);
      const unitCost = Number(lot.unitCost ?? 0);
      totalCost += toConsume * unitCost;

      const newAvailable = lotAvailable - toConsume;

      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: {
          availableQty: newAvailable,
          status: newAvailable <= 0 ? 'depleted' : 'active',
        },
      });

      // Create LotConsumption record
      await tx.lotConsumption.create({
        data: {
          lotId: lot.id,
          mirvLineId,
          quantity: toConsume,
          unitCost: unitCost > 0 ? unitCost : null,
          consumptionDate: new Date(),
        },
      });

      remaining -= toConsume;
    }

    return { totalCost };
  });
}

// ── Get Stock Level ─────────────────────────────────────────────────────

export async function getStockLevel(itemId: string, warehouseId: string): Promise<StockLevel> {
  const level = await prisma.inventoryLevel.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  });

  if (!level) {
    return { onHand: 0, reserved: 0, available: 0 };
  }

  const onHand = Number(level.qtyOnHand);
  const reserved = Number(level.qtyReserved);

  return {
    onHand,
    reserved,
    available: onHand - reserved,
  };
}
