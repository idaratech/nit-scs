import type { VoucherLineItem } from '../types/materials.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  rule: string;
  message: string;
}

export interface ValidationWarning {
  field: string;
  rule: string;
  message: string;
}

// ── MRRV Validators ─────────────────────────────────────────────────────

export function validateMRRV(data: Record<string, unknown>, lineItems: VoucherLineItem[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (data.date && new Date(data.date as string) > new Date()) {
    errors.push({ field: 'date', rule: 'MRRV-V001', message: 'Receipt date cannot be in the future' });
  }

  if (data.date) {
    const daysDiff = Math.floor((Date.now() - new Date(data.date as string).getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 7) {
      warnings.push({ field: 'date', rule: 'MRRV-V002', message: `Receipt date is ${daysDiff} days old — requires supervisor approval` });
    }
  }

  if (lineItems.length === 0) {
    errors.push({ field: 'lineItems', rule: 'MRRV-V003', message: 'At least one line item is required' });
  }

  if (!data.poNumber || !(data.poNumber as string).trim()) {
    errors.push({ field: 'poNumber', rule: 'MRRV-V004', message: 'PO Number is required' });
  }

  if (!data.supplier || !(data.supplier as string).trim()) {
    errors.push({ field: 'supplier', rule: 'MRRV-V005', message: 'Supplier is required' });
  }

  lineItems.forEach((item, idx) => {
    if (item.qtyExpected && item.qtyReceived) {
      const overPct = ((item.qtyReceived - item.qtyExpected) / item.qtyExpected) * 100;
      if (overPct > 10) {
        warnings.push({
          field: `lineItems[${idx}]`,
          rule: 'MRRV-V006',
          message: `Over-delivery of ${overPct.toFixed(1)}% on ${item.itemName} (tolerance: 10%)`,
        });
      }
    }
    if (item.condition === 'Damaged') {
      warnings.push({
        field: `lineItems[${idx}]`,
        rule: 'MRRV-AUTO1',
        message: `Damaged item "${item.itemName}" — RFIM will be auto-created`,
      });
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

// ── MIRV Validators ─────────────────────────────────────────────────────

export function validateMIRV(data: Record<string, unknown>, lineItems: VoucherLineItem[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (lineItems.length === 0) {
    errors.push({ field: 'lineItems', rule: 'MIRV-V001', message: 'At least one line item is required' });
  }

  if (!data.project || !(data.project as string).trim()) {
    errors.push({ field: 'project', rule: 'MIRV-V002', message: 'Project is required' });
  }

  if (!data.warehouse || !(data.warehouse as string).trim()) {
    errors.push({ field: 'warehouse', rule: 'MIRV-V003', message: 'Warehouse is required' });
  }

  lineItems.forEach((item, idx) => {
    if (item.qtyAvailable !== undefined && item.quantity > item.qtyAvailable) {
      errors.push({
        field: `lineItems[${idx}]`,
        rule: 'MIRV-V004',
        message: `Insufficient stock for ${item.itemName}: requested ${item.quantity}, available ${item.qtyAvailable}`,
      });
    }
    if (item.qtyApproved !== undefined && item.qtyIssued !== undefined && item.qtyIssued > item.qtyApproved) {
      errors.push({
        field: `lineItems[${idx}]`,
        rule: 'MIRV-V005',
        message: `Issued qty (${item.qtyIssued}) exceeds approved qty (${item.qtyApproved}) for ${item.itemName}`,
      });
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

// ── MRV Validators ──────────────────────────────────────────────────────

export function validateMRV(data: Record<string, unknown>, lineItems: VoucherLineItem[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!data.returnType) {
    errors.push({ field: 'returnType', rule: 'MRV-V001', message: 'Return type is required' });
  }
  if (!data.project || !(data.project as string).trim()) {
    errors.push({ field: 'project', rule: 'MRV-V002', message: 'Project is required' });
  }
  if (!data.reason || !(data.reason as string).trim()) {
    errors.push({ field: 'reason', rule: 'MRV-V003', message: 'Return reason is required' });
  }
  if (lineItems.length === 0) {
    errors.push({ field: 'lineItems', rule: 'MRV-V004', message: 'At least one line item is required' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── JO Validators ───────────────────────────────────────────────────────

export function validateJO(data: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!data.joType && !data.type) {
    errors.push({ field: 'joType', rule: 'JO-V001', message: 'Job Order type is required' });
  }
  if (!data.project || !(data.project as string).trim()) {
    errors.push({ field: 'project', rule: 'JO-V002', message: 'Project is required' });
  }

  const type = (data.joType || data.type) as string;
  if (type === 'Transport') {
    if (!data.cargoType || !(data.cargoType as string).trim()) {
      errors.push({ field: 'cargoType', rule: 'JO-V003', message: 'Cargo type is required for transport' });
    }
    if (!data.cargoWeight && !data.cargoWeightTons) {
      errors.push({ field: 'cargoWeight', rule: 'JO-V004', message: 'Cargo weight is required for transport' });
    }
  }
  if (type === 'Scrap') {
    if (!data.scrapType || !(data.scrapType as string).trim()) {
      errors.push({ field: 'scrapType', rule: 'JO-V005', message: 'Scrap type is required' });
    }
    if (!data.weightTons && !data.scrapWeightTons) {
      errors.push({ field: 'weightTons', rule: 'JO-V006', message: 'Scrap weight is required' });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Generic ─────────────────────────────────────────────────────────────

export function validateRequired(data: Record<string, unknown>, fields: { key: string; label: string }[]): ValidationError[] {
  return fields
    .filter(f => !data[f.key] || (typeof data[f.key] === 'string' && !(data[f.key] as string).trim()))
    .map(f => ({ field: f.key, rule: 'REQUIRED', message: `${f.label} is required` }));
}
