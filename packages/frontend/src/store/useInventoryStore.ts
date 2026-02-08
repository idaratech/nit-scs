// ============================================================================
// Inventory Store (Zustand) - TEMPORARY
// Will be replaced by React Query hooks in Phase 8
// ============================================================================

import { create } from 'zustand';
import type { InventoryLevel, StockReservation, InventoryLot } from '@nit-wms/shared/types';

interface InventoryState {
  levels: InventoryLevel[];
  reservations: StockReservation[];
  lots: InventoryLot[];
  getAvailableQty: (itemCode: string, warehouseId?: string) => number;
  getStockStatus: (itemCode: string, warehouseId?: string) => 'In Stock' | 'Low Stock' | 'Out of Stock';
  getLowStockItems: () => InventoryLevel[];
  getOutOfStockItems: () => InventoryLevel[];
  reserveStock: (itemCode: string, warehouseId: string, mirvId: string, qty: number) => boolean;
  releaseReservation: (reservationId: string) => void;
  consumeReservation: (reservationId: string) => void;
  addStock: (itemCode: string, warehouseId: string, qty: number, mrrvId: string) => void;
  deductStock: (itemCode: string, warehouseId: string, qty: number) => boolean;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  levels: [],
  reservations: [],
  lots: [],

  getAvailableQty: (itemCode, warehouseId) => {
    const level = get().levels.find(l =>
      l.itemCode === itemCode && (!warehouseId || l.warehouseId === warehouseId)
    );
    return level ? level.qtyAvailable : 0;
  },

  getStockStatus: (itemCode, warehouseId) => {
    const level = get().levels.find(l =>
      l.itemCode === itemCode && (!warehouseId || l.warehouseId === warehouseId)
    );
    if (!level || level.qtyAvailable <= 0) return 'Out of Stock';
    if (level.qtyAvailable <= level.minStock) return 'Low Stock';
    return 'In Stock';
  },

  getLowStockItems: () => get().levels.filter(l => l.status === 'Low Stock'),
  getOutOfStockItems: () => get().levels.filter(l => l.status === 'Out of Stock'),

  reserveStock: (itemCode, warehouseId, mirvId, qty) => {
    const level = get().levels.find(l =>
      l.itemCode === itemCode && l.warehouseId === warehouseId
    );
    if (!level || level.qtyAvailable < qty) return false;

    const reservation: StockReservation = {
      id: `RES-${Date.now()}`,
      itemId: level.itemId,
      warehouseId,
      mirvId,
      quantity: qty,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    set(state => ({
      reservations: [...state.reservations, reservation],
      levels: state.levels.map(l =>
        l.itemCode === itemCode && l.warehouseId === warehouseId
          ? { ...l, qtyReserved: l.qtyReserved + qty, qtyAvailable: l.qtyAvailable - qty }
          : l
      ),
    }));
    return true;
  },

  releaseReservation: (reservationId) => {
    const reservation = get().reservations.find(r => r.id === reservationId);
    if (!reservation || reservation.status !== 'active') return;

    set(state => ({
      reservations: state.reservations.map(r =>
        r.id === reservationId ? { ...r, status: 'released' as const } : r
      ),
      levels: state.levels.map(l =>
        l.itemId === reservation.itemId && l.warehouseId === reservation.warehouseId
          ? { ...l, qtyReserved: l.qtyReserved - reservation.quantity, qtyAvailable: l.qtyAvailable + reservation.quantity }
          : l
      ),
    }));
  },

  consumeReservation: (reservationId) => {
    const reservation = get().reservations.find(r => r.id === reservationId);
    if (!reservation || reservation.status !== 'active') return;

    set(state => ({
      reservations: state.reservations.map(r =>
        r.id === reservationId ? { ...r, status: 'consumed' as const } : r
      ),
      levels: state.levels.map(l =>
        l.itemId === reservation.itemId && l.warehouseId === reservation.warehouseId
          ? { ...l, qtyReserved: l.qtyReserved - reservation.quantity, qtyOnHand: l.qtyOnHand - reservation.quantity }
          : l
      ),
    }));
  },

  addStock: (itemCode, warehouseId, qty, mrrvId) => {
    const lot: InventoryLot = {
      id: `LOT-${Date.now()}`,
      itemId: itemCode,
      lotNumber: `LOT-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      mrrvId,
      receiptDate: new Date().toISOString(),
      quantity: qty,
      remainingQty: qty,
      unitCost: 0,
    };

    set(state => ({
      lots: [...state.lots, lot],
      levels: state.levels.map(l =>
        l.itemCode === itemCode && l.warehouseId === warehouseId
          ? {
              ...l,
              qtyOnHand: l.qtyOnHand + qty,
              qtyAvailable: l.qtyAvailable + qty,
              status: (l.qtyOnHand + qty > l.minStock ? 'In Stock' : 'Low Stock') as InventoryLevel['status'],
            }
          : l
      ),
    }));
  },

  deductStock: (itemCode, warehouseId, qty) => {
    const level = get().levels.find(l =>
      l.itemCode === itemCode && l.warehouseId === warehouseId
    );
    if (!level || level.qtyOnHand < qty) return false;

    set(state => ({
      levels: state.levels.map(l =>
        l.itemCode === itemCode && l.warehouseId === warehouseId
          ? {
              ...l,
              qtyOnHand: l.qtyOnHand - qty,
              qtyAvailable: l.qtyAvailable - qty,
              status: (l.qtyOnHand - qty <= 0 ? 'Out of Stock' : l.qtyOnHand - qty <= l.minStock ? 'Low Stock' : 'In Stock') as InventoryLevel['status'],
            }
          : l
      ),
    }));
    return true;
  },
}));
