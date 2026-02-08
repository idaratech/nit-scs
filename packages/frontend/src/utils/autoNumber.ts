// ============================================================================
// Auto Document Numbering (client-side for mock)
// In production this will be generated server-side
// ============================================================================

const COUNTER_KEY = 'nit_wms_doc_counters';

interface CounterStore {
  [key: string]: number;
}

function getCounters(): CounterStore {
  try {
    return JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCounters(counters: CounterStore): void {
  localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));
}

const DOC_PREFIXES: Record<string, string> = {
  mrrv: 'MRRV',
  mirv: 'MIRV',
  mrv: 'MRV',
  rfim: 'RFIM',
  osd: 'OSD',
  jo: 'JO-NIT',
  gatepass: 'GP',
  'stock-transfer': 'ST',
  mrf: 'MRF',
  shipment: 'SH',
  customs: 'CC',
};

export function generateDocumentNumber(documentType: string): string {
  const prefix = DOC_PREFIXES[documentType] || documentType.toUpperCase();
  const year = new Date().getFullYear();
  const counterKey = `${prefix}-${year}`;

  const counters = getCounters();
  const nextNumber = (counters[counterKey] || 0) + 1;
  counters[counterKey] = nextNumber;
  saveCounters(counters);

  return `${prefix}-${year}-${String(nextNumber).padStart(4, '0')}`;
}

export function previewNextNumber(documentType: string): string {
  const prefix = DOC_PREFIXES[documentType] || documentType.toUpperCase();
  const year = new Date().getFullYear();
  const counterKey = `${prefix}-${year}`;
  const counters = getCounters();
  const nextNumber = (counters[counterKey] || 0) + 1;
  return `${prefix}-${year}-${String(nextNumber).padStart(4, '0')}`;
}
