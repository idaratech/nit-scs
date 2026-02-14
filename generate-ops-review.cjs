/**
 * NIT SCS V2 — Operations Review & Requirements Validation
 * Professional document from Idaratech to NIT/Nesma
 * Run: node generate-ops-review.cjs
 */
const docx = require('/private/tmp/node_modules/docx');
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType,
  PageBreak, TabStopPosition, TabStopType, ImageRun,
} = docx;

// ── Colors ──────────────────────────────────────────────────────────────
const BLUE = '2E3192';
const CYAN = '0EA5E9';
const GREEN = '059669';
const AMBER = 'D97706';
const RED = 'DC2626';
const DARK = '1E293B';
const GRAY = '64748B';
const LIGHT_GRAY = '94A3B8';
const WHITE = 'FFFFFF';
const BG_LIGHT = 'F8FAFC';
const BG_BLUE = 'EFF6FF';
const BG_AMBER = 'FFFBEB';
const BG_GREEN = 'F0FDF4';
const BG_RED = 'FEF2F2';

const noBorder = { style: BorderStyle.NONE, size: 0 };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' };
const thinBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

// ── Helpers ─────────────────────────────────────────────────────────────
function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 500, after: 200 },
    children: [new TextRun({ text, bold: true, size: 32, color: BLUE, font: 'Calibri' })] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 150 },
    children: [new TextRun({ text, bold: true, size: 26, color: DARK, font: 'Calibri' })] });
}
function h3(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 250, after: 100 },
    children: [new TextRun({ text, bold: true, size: 22, color: BLUE, font: 'Calibri' })] });
}
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 80 },
    children: [new TextRun({ text, size: 20, color: opts.color || '334155', bold: opts.bold, italics: opts.italic, font: 'Calibri' })] });
}
function b(text, opts = {}) {
  return new Paragraph({ bullet: { level: opts.level || 0 }, spacing: { after: 50 },
    children: [new TextRun({ text, size: 20, color: opts.color || '334155', bold: opts.bold, font: 'Calibri' })] });
}
function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }
function spacer(h = 200) { return new Paragraph({ spacing: { before: h } }); }

// ── Styled Table Helper ─────────────────────────────────────────────────
function styledTable(headers, rows, opts = {}) {
  const headerColor = opts.headerColor || BLUE;
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(text =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: headerColor },
        borders: thinBorders,
        children: [new Paragraph({ spacing: { before: 40, after: 40 },
          children: [new TextRun({ text, bold: true, size: 18, color: WHITE, font: 'Calibri' })] })],
      })
    ),
  });
  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map(text =>
        new TableCell({
          shading: ri % 2 === 0 ? { type: ShadingType.SOLID, color: BG_LIGHT } : undefined,
          borders: thinBorders,
          children: [new Paragraph({ spacing: { before: 30, after: 30 },
            children: [new TextRun({ text: String(text), size: 18, color: '334155', font: 'Calibri' })] })],
        })
      ),
    })
  );
  return new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

// ── Flow Diagram ────────────────────────────────────────────────────────
function flowDiagram(steps) {
  // steps: array of { label, type: 'start'|'active'|'end'|'reject'|'cancel' }
  const MAX = 6;
  const lines = [];
  for (let i = 0; i < steps.length; i += MAX) lines.push(steps.slice(i, i + MAX));
  return lines.map((line, li) =>
    new Paragraph({
      spacing: { before: li === 0 ? 100 : 40, after: 60 },
      children: [
        ...(li > 0 ? [new TextRun({ text: '    \u21B3 ', bold: true, size: 18, color: LIGHT_GRAY, font: 'Calibri' })] : []),
        ...line.flatMap((s, i) => {
          const c = s.type === 'start' ? GREEN : s.type === 'end' ? CYAN : s.type === 'reject' ? RED : s.type === 'cancel' ? AMBER : BLUE;
          return [
            ...(i > 0 ? [new TextRun({ text: '  \u2192  ', size: 18, color: LIGHT_GRAY, font: 'Calibri' })] : []),
            new TextRun({ text: `[${s.label}]`, bold: true, size: 18, color: c, font: 'Calibri' }),
          ];
        }),
      ],
    })
  );
}

// ── Flow Detail Table ───────────────────────────────────────────────────
function flowDetailTable(steps) {
  return styledTable(
    ['#', 'Status', 'Description', 'Actor', 'System Action'],
    steps.map((s, i) => [String(i + 1), s.status, s.desc, s.actor, s.system || '-']),
  );
}

// ── Response Box (question + answer area) ──────────────────────────────
function responseBox(num, question, options) {
  const cells = [];
  cells.push(new Paragraph({ spacing: { before: 60, after: 40 },
    children: [
      new TextRun({ text: `Q${num}. `, bold: true, size: 20, color: BLUE, font: 'Calibri' }),
      new TextRun({ text: question, size: 20, color: '1E293B', font: 'Calibri' }),
    ] }));
  if (options && options.length) {
    cells.push(new Paragraph({ spacing: { before: 40, after: 20 },
      children: options.map((opt, i) =>
        new TextRun({ text: `${i > 0 ? '     ' : ''}  \u2610 ${opt}`, size: 18, color: '475569', font: 'Calibri' })
      ) }));
  }
  cells.push(new Paragraph({ spacing: { before: 60, after: 20 },
    children: [new TextRun({ text: 'Your Response / Suggestions:', bold: true, size: 18, color: BLUE, font: 'Calibri' })] }));
  for (let i = 0; i < 3; i++) {
    cells.push(new Paragraph({
      spacing: { after: 30 },
      border: { bottom: { style: BorderStyle.DOTTED, size: 1, color: 'CBD5E1' } },
      children: [new TextRun({ text: '  ', size: 18, font: 'Calibri' })],
    }));
  }
  return new Table({
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.SOLID, color: BG_BLUE },
      borders: { top: { style: BorderStyle.SINGLE, size: 1, color: 'BFDBFE' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BFDBFE' },
        left: { style: BorderStyle.SINGLE, size: 6, color: BLUE },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'BFDBFE' } },
      children: cells,
    })] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ── Automation Box ──────────────────────────────────────────────────────
function automationBox(title, items) {
  return new Table({
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.SOLID, color: BG_GREEN },
      borders: { top: thinBorder, bottom: thinBorder, left: { style: BorderStyle.SINGLE, size: 6, color: GREEN }, right: thinBorder },
      children: [
        new Paragraph({ spacing: { before: 40, after: 40 },
          children: [new TextRun({ text: `\u2699 ${title}`, bold: true, size: 20, color: GREEN, font: 'Calibri' })] }),
        ...items.map(item => new Paragraph({ bullet: { level: 0 }, spacing: { after: 30 },
          children: [new TextRun({ text: item, size: 18, color: '166534', font: 'Calibri' })] })),
      ],
    })] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ── Inventory Impact Box ────────────────────────────────────────────────
function inventoryBox(items) {
  return new Table({
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.SOLID, color: 'FEF3C7' },
      borders: { top: thinBorder, bottom: thinBorder, left: { style: BorderStyle.SINGLE, size: 6, color: AMBER }, right: thinBorder },
      children: [
        new Paragraph({ spacing: { before: 40, after: 40 },
          children: [new TextRun({ text: 'Inventory Impact', bold: true, size: 20, color: AMBER, font: 'Calibri' })] }),
        ...items.map(item => new Paragraph({ bullet: { level: 0 }, spacing: { after: 30 },
          children: [new TextRun({ text: item, size: 18, color: item.startsWith('+') ? '166534' : item.startsWith('-') ? 'B91C1C' : '92400E', font: 'Calibri' })] })),
      ],
    })] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ── Screenshot Placeholder ──────────────────────────────────────────────
function screenshotPlaceholder(desc) {
  return new Table({
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.SOLID, color: 'F1F5F9' },
      borders: { style: BorderStyle.DASHED, size: 2, color: 'CBD5E1' },
      children: [
        new Paragraph({ spacing: { before: 200, after: 200 }, alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '[Screenshot: ', size: 18, color: GRAY, italics: true, font: 'Calibri' }),
            new TextRun({ text: desc, size: 18, color: GRAY, italics: true, bold: true, font: 'Calibri' }),
            new TextRun({ text: ']', size: 18, color: GRAY, italics: true, font: 'Calibri' }),
          ] }),
      ],
    })] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ── Note Box ────────────────────────────────────────────────────────────
function noteBox(text, type = 'info') {
  const colors = {
    info: { bg: BG_BLUE, border: '3B82F6', text: '1E40AF' },
    warning: { bg: BG_AMBER, border: AMBER, text: '92400E' },
    success: { bg: BG_GREEN, border: GREEN, text: '166534' },
    danger: { bg: BG_RED, border: RED, text: '991B1B' },
  };
  const c = colors[type] || colors.info;
  return new Table({
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.SOLID, color: c.bg },
      borders: { top: thinBorder, bottom: thinBorder, left: { style: BorderStyle.SINGLE, size: 6, color: c.border }, right: thinBorder },
      children: [new Paragraph({ spacing: { before: 40, after: 40 },
        children: [new TextRun({ text, size: 18, color: c.text, font: 'Calibri' })] })],
    })] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ══════════════════════════════════════════════════════════════════════════
// DOCUMENT CONTENT
// ══════════════════════════════════════════════════════════════════════════
const children = [];

// ── COVER PAGE ──────────────────────────────────────────────────────────
children.push(
  spacer(800),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [new TextRun({ text: 'IDARATECH SOFTWARE SOLUTIONS', bold: true, size: 22, color: GRAY, font: 'Calibri', allCaps: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 },
    children: [new TextRun({ text: 'presents to', size: 18, color: LIGHT_GRAY, italics: true, font: 'Calibri' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [new TextRun({ text: 'NESMA INDUSTRIES & TRADE (NIT)', bold: true, size: 28, color: BLUE, font: 'Calibri' })] }),
  spacer(300),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [new TextRun({ text: 'NIT Supply Chain Management System V2', bold: true, size: 40, color: DARK, font: 'Calibri' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: 'Operations Review & Requirements Validation', size: 28, color: BLUE, font: 'Calibri' })] }),
  spacer(200),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: `Date: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, size: 20, color: GRAY, font: 'Calibri' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: 'Version: 1.0', size: 20, color: GRAY, font: 'Calibri' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: 'Classification: Confidential', size: 20, color: RED, bold: true, font: 'Calibri' })] }),
  spacer(400),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' } },
    children: [new TextRun({ text: 'This document is based on an analysis of the NIT SCS V2 codebase.', size: 16, color: GRAY, italics: true, font: 'Calibri' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'It requires your team\'s review and feedback in the designated response areas.', size: 16, color: GRAY, italics: true, font: 'Calibri' })] }),
  pageBreak(),
);

// ── LETTER / INTRODUCTION ───────────────────────────────────────────────
children.push(h1('1. Introduction'));

children.push(p('Dear NIT Operations Team,', { bold: true }));
children.push(spacer(60));
children.push(p('As part of our development of the NIT Supply Chain Management System V2, we have conducted a thorough analysis of the current system architecture, workflows, business rules, and automations. This document presents our findings for your review and validation.'));
children.push(spacer(40));
children.push(h3('Purpose of This Document'));
children.push(b('Present the current system workflows as implemented in the codebase'));
children.push(b('Identify areas requiring clarification or business input'));
children.push(b('Validate automation rules and approval hierarchies'));
children.push(b('Align system behavior with your actual operational needs'));
children.push(b('Gather feedback on features to add, modify, or remove'));

children.push(spacer(40));
children.push(h3('How to Use This Document'));
children.push(b('Review each section carefully \u2014 each covers a specific module of the system'));
children.push(b('Each section includes: process description, status flow diagram, roles & permissions, automations, and inventory impact'));
children.push(b('Questions are presented in blue boxes with space for your written response'));
children.push(b('Checkboxes (\u2610) are provided where applicable \u2014 tick the appropriate option'));
children.push(b('Use the "Your Response / Suggestions" area to provide detailed feedback'));
children.push(b('If a feature is not needed, please indicate so we can simplify the system'));

children.push(spacer(40));
children.push(h3('Document Scope'));
children.push(styledTable(
  ['Section', 'Modules Covered', 'Questions'],
  [
    ['Warehouse Operations', 'GRN, QCI, DR, MR, MI, MRN, WT/IMSF, Inventory, BinCard', '1 \u2013 26'],
    ['Transport & Equipment', 'Job Orders, GatePass, Fleet, Generators, Rental, Tools, Yard', '27 \u2013 41'],
    ['Scrap & Surplus', 'Scrap, Surplus, Scrap Sales Committee (SSC)', '42 \u2013 49'],
    ['Shipping & Customs', 'Shipments, Customs Tracking', '50 \u2013 55'],
  ],
));

children.push(pageBreak());

// ── 2. SYSTEM OVERVIEW ──────────────────────────────────────────────────
children.push(h1('2. System Overview'));

children.push(h3('2.1 Technology Stack'));
children.push(styledTable(
  ['Layer', 'Technology', 'Purpose'],
  [
    ['Frontend', 'React 19 + Vite 6 + TypeScript', 'User interface (dark glassmorphism theme)'],
    ['Backend', 'Express 5 + TypeScript', 'REST API + real-time updates (Socket.IO)'],
    ['Database', 'PostgreSQL + Prisma 6 ORM', 'Data storage with 100+ models'],
    ['Shared', '@nit-scs-v2/shared', 'Types, validators, state machine, permissions'],
    ['Auth', 'Firebase Authentication', 'User login + role-based access'],
    ['Real-time', 'Socket.IO', 'Live updates + notification delivery'],
    ['i18n', 'i18next', 'English + Arabic with full RTL support'],
  ],
));

children.push(spacer(100));
children.push(h3('2.2 System Architecture'));
children.push(screenshotPlaceholder('System Architecture Diagram \u2014 Frontend, API, Database layers'));

children.push(spacer(40));
children.push(styledTable(
  ['Component', 'Description', 'Key Features'],
  [
    ['Frontend App', 'Single-page React application', 'Role-based dashboards, dark theme, PWA-ready, offline queue'],
    ['API Server', 'Express 5 with factory-pattern routers', 'CRUD + document workflows, validation, Socket.IO events'],
    ['State Machine', 'Shared transition rules', 'Enforces valid status changes for all 17 document types'],
    ['RBAC Engine', '10 roles \u00d7 30+ resources', 'Permission matrix with DB-backed overrides'],
    ['Inventory Engine', 'FIFO lot tracking', 'Reservations, consumption, automatic BinCard updates'],
    ['Approval Engine', 'Multi-level approvals', '5 levels for MI, 4 levels for JO (amount-based)'],
    ['Notification System', 'Socket.IO + DB', 'Real-time alerts for status changes, SLA breaches'],
  ],
));

children.push(spacer(100));
children.push(h3('2.3 Master Document Registry'));
children.push(p('The system manages the following document types. Each has its own status flow, roles, and automations:'));
children.push(spacer(40));

children.push(styledTable(
  ['Code', 'Full Name', 'Purpose', 'Status Flow (Summary)', 'Auto-Created By'],
  [
    ['GRN', 'Goods Receipt Note', 'Record material receipt from suppliers', 'draft \u2192 pending_qc \u2192 stored', '\u2014'],
    ['QCI', 'Quality Check Inspection', 'Inspect received materials', 'pending \u2192 in_progress \u2192 completed', 'GRN (auto)'],
    ['DR', 'Discrepancy Report', 'Report over/short/damage', 'draft \u2192 under_review \u2192 resolved \u2192 closed', 'GRN (auto)'],
    ['MR', 'Material Request', 'Request materials for a project', 'draft \u2192 approved \u2192 checking_stock \u2192 fulfilled', '\u2014'],
    ['MI', 'Material Issue', 'Issue materials from warehouse', 'draft \u2192 approved \u2192 issued \u2192 completed', 'MR (auto)'],
    ['MRN', 'Material Return Note', 'Return materials to warehouse', 'draft \u2192 pending \u2192 received \u2192 completed', '\u2014'],
    ['WT', 'Warehouse Transfer', 'Transfer between warehouses', 'draft \u2192 approved \u2192 shipped \u2192 completed', '\u2014'],
    ['IMSF', 'Internal Material Shifting', 'Transfer between projects', 'created \u2192 confirmed \u2192 delivered \u2192 completed', 'MR (auto)'],
    ['JO', 'Job Order', 'Transport, rental, maintenance tasks', 'draft \u2192 approved \u2192 in_progress \u2192 invoiced', '\u2014'],
    ['GatePass', 'Gate Pass', 'Authorize material entry/exit', 'draft \u2192 approved \u2192 released', 'MI (auto)'],
    ['Shipment', 'Shipment Tracking', 'Track supplier shipments', 'draft \u2192 in_transit \u2192 delivered', '\u2014'],
    ['Customs', 'Customs Tracking', 'Track customs clearance', 'docs_submitted \u2192 cleared \u2192 released', '\u2014'],
    ['Scrap', 'Scrap Item', 'Identify and sell scrap', 'identified \u2192 approved \u2192 sold/disposed \u2192 closed', '\u2014'],
    ['Surplus', 'Surplus Item', 'Handle surplus materials', 'identified \u2192 approved \u2192 actioned \u2192 closed', 'MRN (auto)'],
    ['SSC', 'Scrap Sales Committee', 'Manage scrap bids and sales', 'Bid: submit \u2192 accept \u2192 sign_memo', '\u2014'],
    ['RC', 'Rental Contract', 'Equipment rental agreements', 'draft \u2192 active \u2192 terminated', '\u2014'],
    ['Tool Issue', 'Tool Issue Record', 'Track tool lending', 'issued \u2192 returned', '\u2014'],
  ],
));

children.push(pageBreak());

// ── 3. CROSS-MODULE INTEGRATION MAP ─────────────────────────────────────
children.push(h1('3. Cross-Module Integration & Automations'));

children.push(p('The following diagram shows how documents automatically create or update other documents:'));
children.push(spacer(40));
children.push(screenshotPlaceholder('Cross-Module Integration Diagram \u2014 showing auto-creation links between documents'));

children.push(spacer(40));
children.push(h3('3.1 Automatic Document Creation'));
children.push(styledTable(
  ['Trigger', 'Condition', 'Auto-Created Document', 'Initial Status'],
  [
    ['GRN submitted', 'qciRequired = true', 'QCI (Quality Check Inspection)', 'pending'],
    ['GRN submitted', 'qtyDamaged > 0', 'DR (Discrepancy Report)', 'draft'],
    ['MR approved (stock check)', 'Items available in stock', 'MI (Material Issue) via convertToMirv', 'draft'],
    ['MR approved (stock check)', 'Items available in other project', 'IMSF (Inter-project Transfer) via convertToImsf', 'created'],
    ['MI issued', 'Always', 'GatePass (outbound)', 'draft'],
    ['MRN completed', 'returnType = "surplus"', 'Surplus Item', 'identified'],
    ['Shipment delivered', 'Linked GRN exists', 'Updates GRN to "received"', '\u2014'],
    ['SSC bid accepted', 'Other bids exist', 'Auto-rejects all other bids', '\u2014'],
  ],
));

children.push(spacer(60));
children.push(h3('3.2 Inventory Flow'));
children.push(p('The FIFO-based inventory system is affected by the following operations:'));
children.push(styledTable(
  ['Operation', 'Inventory Effect', 'Lot Impact', 'BinCard'],
  [
    ['GRN \u2192 stored', '+qty added to warehouse', 'New lot created per item', 'Transaction: receipt'],
    ['MI \u2192 approved', 'qty reserved (not deducted yet)', '\u2014', '\u2014'],
    ['MI \u2192 issued', '-qty deducted from warehouse', 'Lots consumed (FIFO order)', 'Transaction: issue'],
    ['MI \u2192 cancelled', 'Reservation released', '\u2014', '\u2014'],
    ['MRN \u2192 received', '+qty added (good items only)', '\u2014', 'Transaction: receipt'],
    ['WT \u2192 shipped', '-qty from source warehouse', '\u2014', 'Transaction: transfer_out'],
    ['WT \u2192 received', '+qty to destination warehouse', '\u2014', 'Transaction: transfer_in'],
    ['Stock Adjustment', '\u00b1qty manual correction', '\u2014', 'Transaction: adjustment'],
  ],
));

children.push(spacer(60));
children.push(h3('3.3 SLA Configuration'));
children.push(styledTable(
  ['Process', 'SLA Duration', 'Consequence'],
  [
    ['MR \u2192 Warehouse stock check response', '4 hours', 'SLA breach alert'],
    ['JO execution after quotation', '48 hours', 'SLA breach alert'],
    ['QCI inspection completion', '14 days (336 hours)', 'SLA breach alert'],
    ['GatePass validity', '24 hours', 'Auto-expire'],
    ['Post-installation check', '48 hours', 'SLA breach alert'],
    ['Scrap buyer pickup', '10 days (240 hours)', 'SLA breach alert'],
    ['Surplus waiting period', '14 days (336 hours)', 'Auto-escalation'],
  ],
));

children.push(pageBreak());

// ══════════════════════════════════════════════════════════════════════════
// SECTION 4: WAREHOUSE OPERATIONS
// ══════════════════════════════════════════════════════════════════════════
children.push(h1('4. Warehouse Operations'));
children.push(p('This section covers all warehouse processes from material receipt through storage, issuance, return, and transfer.'));
children.push(screenshotPlaceholder('Warehouse Module Dashboard \u2014 showing KPIs, recent activity, and quick actions'));

// ── 4.1 GRN ─────────────────────────────────────────────────────────────
children.push(h2('4.1 GRN \u2014 Goods Receipt Note'));
children.push(noteBox('Formerly known as MRRV in V1. Created when materials arrive from a supplier to the warehouse.', 'info'));
children.push(spacer(40));

children.push(h3('Description'));
children.push(p('A GRN records the receipt of materials from suppliers. It captures item details, quantities (expected vs received), PO reference, supplier information, and delivery note number. Upon storage, inventory is updated and FIFO lots are created.'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'pending_qc', type: 'active' },
  { label: 'qc_approved', type: 'active' },
  { label: 'received', type: 'active' },
  { label: 'stored', type: 'end' },
]));
children.push(p('  Alternate: rejected \u2192 draft (return to edit)', { italic: true, color: GRAY }));
children.push(spacer(40));

children.push(flowDetailTable([
  { status: 'draft', desc: 'Storekeeper creates GRN upon material arrival', actor: 'Warehouse Staff', system: 'Auto-generates document number (GRN-XXXX)' },
  { status: 'pending_qc', desc: 'Submitted for quality inspection', actor: 'Warehouse Staff', system: 'Auto-creates QCI if qciRequired=true; Auto-creates DR if qtyDamaged>0' },
  { status: 'qc_approved', desc: 'Quality inspection passed', actor: 'QC Officer', system: 'Linked QCI marked completed' },
  { status: 'received', desc: 'Materials accepted into warehouse', actor: 'Warehouse Supervisor', system: '\u2014' },
  { status: 'stored', desc: 'Materials placed in storage location', actor: 'Warehouse Staff', system: 'Creates inventory lots (FIFO), updates BinCard, adds to stock' },
]));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['Warehouse Staff (Storekeeper)', 'Creates and fills GRN on material arrival', 'create, read, update'],
    ['Warehouse Supervisor', 'Reviews, approves, oversees storage', 'create, read, update, approve'],
    ['QC Officer', 'Notified automatically when pending_qc', 'read'],
    ['Logistics Coordinator', 'Can create GRN for shipments they manage', 'create, read, update'],
    ['Manager', 'Reviews and exports', 'read, approve, export'],
  ],
));

children.push(spacer(40));
children.push(automationBox('Automations (from codebase)', [
  'On submit (draft \u2192 pending_qc): Auto-creates QCI if qciRequired = true',
  'On submit: Auto-creates DR if any line item has qtyDamaged > 0',
  'On store: Only stores good quantity (qtyReceived - qtyDamaged)',
  'On store: Creates a new inventory Lot per item with unitCost and supplierId',
  'On store: Updates BinCard with "receipt" transaction',
]));

children.push(spacer(40));
children.push(inventoryBox([
  '+ On "stored": qty added to warehouse stock (qtyOnHand)',
  '+ New FIFO Lot created per item (with cost tracking)',
  '+ BinCard automatically updated (transaction type: receipt)',
]));

children.push(spacer(40));
children.push(screenshotPlaceholder('GRN Form \u2014 showing line items, quantities, PO reference'));
children.push(spacer(40));

children.push(responseBox(1, 'QCI is auto-created from code when qciRequired=true. How is qciRequired determined? Is it set manually by the storekeeper or automatically based on item type / supplier?',
  ['Manual (per GRN)', 'Automatic (by item category)', 'Automatic (by supplier)', 'Other']));
children.push(spacer(20));
children.push(responseBox(2, 'Do all GRN documents require a quality inspection, or only specific item categories / suppliers?',
  ['All GRN require QCI', 'Only certain items', 'Only certain suppliers', 'Other']));
children.push(spacer(20));
children.push(responseBox(3, 'The system enforces an over-delivery percentage tolerance (overDeliveryPct). Is this a unified percentage for all items, or does it vary by item / contract?',
  ['Unified (e.g., 5% for all)', 'Varies by item', 'Varies by contract', 'Other']));

children.push(pageBreak());

// ── 4.2 QCI ─────────────────────────────────────────────────────────────
children.push(h2('4.2 QCI \u2014 Quality Check Inspection'));
children.push(noteBox('Formerly known as RFIM in V1. Typically auto-created by GRN when inspection is required.', 'info'));
children.push(spacer(40));

children.push(h3('Description'));
children.push(p('A quality inspection document for received materials. Includes inspection type, checklist items (pass/fail/conditional per item), photos, and final verdict. Inspection types: Visual, Dimensional, Functional, Documentation, Lab Test.'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'pending', type: 'start' },
  { label: 'in_progress', type: 'active' },
  { label: 'completed', type: 'end' },
]));
children.push(p('  Alternate: in_progress \u2192 completed_conditional \u2192 completed (requires PM approval)', { italic: true, color: GRAY }));

children.push(spacer(40));
children.push(flowDetailTable([
  { status: 'pending', desc: 'QCI created (usually auto from GRN)', actor: 'System / QC Officer', system: 'Linked to GRN via mrrvId' },
  { status: 'in_progress', desc: 'QC Officer begins inspection', actor: 'QC Officer', system: '\u2014' },
  { status: 'completed_conditional', desc: 'Accepted with conditions (needs PM sign-off)', actor: 'QC Officer', system: 'Awaits Project Manager approval' },
  { status: 'completed', desc: 'Inspection finished, materials cleared', actor: 'QC Officer / PM', system: 'Updates linked GRN to qc_approved' },
]));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['QC Officer', 'Creates inspection, runs tests, records results, approves', 'create, read, update, approve'],
    ['Warehouse Staff', 'Can create inspection request', 'create, read'],
    ['Warehouse Supervisor', 'Can create inspection request', 'create, read'],
  ],
));

children.push(spacer(40));
children.push(screenshotPlaceholder('QCI Form \u2014 showing checklist items, inspection results, photos'));
children.push(spacer(40));

children.push(responseBox(4, 'Is quality inspection mandatory for every GRN, or only for specific item categories or suppliers?',
  ['All GRN require QCI', 'Only certain items', 'Only for new suppliers', 'Other']));
children.push(spacer(20));
children.push(responseBox(5, 'The current QCI SLA is set to 14 days. Is this appropriate for your operations?',
  ['14 days is fine', 'Too long \u2014 reduce to ___', 'Too short \u2014 increase to ___', 'Other']));
children.push(spacer(20));
children.push(responseBox(6, 'The "completed_conditional" status allows accepting materials with conditions pending PM approval. Is this workflow used in practice? Who specifically approves?',
  ['Yes, used actively', 'No, not used \u2014 remove it', 'Other']));

children.push(pageBreak());

// ── 4.3 DR ──────────────────────────────────────────────────────────────
children.push(h2('4.3 DR \u2014 Discrepancy Report'));
children.push(noteBox('Formerly known as OSD (Over/Short/Damage) in V1. Tracks discrepancies and supplier claims.', 'info'));
children.push(spacer(40));

children.push(h3('Description'));
children.push(p('Created when received materials show discrepancies vs expected quantities. Tracks the claim process with the supplier through resolution. Types: Over (excess), Short (deficit), Damage.'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'under_review', type: 'active' },
  { label: 'claim_sent', type: 'active' },
  { label: 'awaiting_response', type: 'active' },
  { label: 'negotiating', type: 'active' },
  { label: 'resolved', type: 'active' },
  { label: 'closed', type: 'end' },
]));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['Warehouse Staff', 'Creates DR when discrepancy found', 'create, read'],
    ['Warehouse Supervisor', 'Reviews, sends claim to supplier', 'create, read, update'],
    ['QC Officer', 'Documents discrepancies, provides evidence', 'create, read, update'],
  ],
));

children.push(spacer(40));
children.push(automationBox('Automations', [
  'Auto-created from GRN when damaged items detected (qtyDamaged > 0)',
  'Auto-calculates: totalOverValue, totalShortValue, totalDamageValue',
  'Per-item action tracking: accept, reject, return, or claim',
  'Records rootCause, costImpact, and responsiblePerson',
]));

children.push(spacer(40));
children.push(responseBox(7, 'DR is auto-created when damage is found. Should it also be auto-created for quantity discrepancies (over or short) without damage?',
  ['Yes \u2014 auto-create for all discrepancies', 'Only for damage', 'Only above a threshold', 'Other']));
children.push(spacer(20));
children.push(responseBox(8, 'Is there a minimum difference threshold that should trigger a DR? (e.g., >5% variance)',
  ['No threshold \u2014 any difference', 'Yes \u2014 threshold: ____%', 'Other']));

children.push(pageBreak());

// ── 4.4 MR ──────────────────────────────────────────────────────────────
children.push(h2('4.4 MR \u2014 Material Request'));
children.push(noteBox('Formerly known as MRF in V1. Created by site engineers to request materials for projects.', 'info'));
children.push(spacer(40));

children.push(h3('Description'));
children.push(p('A material request from a site engineer or department. Goes through approval, then the system automatically checks stock availability across all project warehouses. Can auto-create MI (for available stock) or IMSF (for cross-project transfers).'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'submitted', type: 'active' },
  { label: 'under_review', type: 'active' },
  { label: 'approved', type: 'active' },
  { label: 'checking_stock', type: 'active' },
]));
children.push(p('  After stock check, per-item resolution:', { italic: true, color: GRAY }));
children.push(b('from_stock \u2192 partially_fulfilled \u2192 fulfilled (available in warehouse)'));
children.push(b('needs_purchase \u2192 partially_fulfilled \u2192 fulfilled (requires procurement)'));
children.push(b('not_available_locally \u2192 partially_fulfilled \u2192 fulfilled (available in other project)'));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['Site Engineer', 'Creates material request for their project', 'create, read'],
    ['Manager', 'Reviews and approves', 'read, approve, export'],
    ['Admin', 'Full control', 'create, read, update, delete, approve, export'],
  ],
));

children.push(spacer(40));
children.push(h3('Approval Levels (Amount-Based)'));
children.push(styledTable(
  ['Level', 'Amount Range (SAR)', 'Approver Role', 'SLA'],
  [
    ['1', '0 \u2013 10,000', 'Warehouse Staff', '4 hours'],
    ['2', '10,000 \u2013 50,000', 'Logistics Coordinator', '8 hours'],
    ['3', '50,000 \u2013 100,000', 'Department Head (Manager)', '24 hours'],
    ['4', '100,000 \u2013 500,000', 'Operations Director (Manager)', '48 hours'],
    ['5', '500,000+', 'CEO (Admin)', '72 hours'],
  ],
));

children.push(spacer(40));
children.push(automationBox('Automations', [
  'Auto-checks stock across ALL project warehouses on approval',
  'Per item result: from_stock / both / purchase_required / available_other_project',
  'convertToMirv: Auto-creates MI for items available in stock',
  'convertToImsf: Auto-creates IMSF for items available in other projects',
  'suggestedWarehouse: Automatically suggests source warehouse based on availability',
]));

children.push(spacer(40));
children.push(responseBox(9, 'Is MR mandatory before MI (Material Issue), or can MI be created directly without a preceding MR?',
  ['MR is mandatory before MI', 'MI can be created directly', 'Other']));
children.push(spacer(20));
children.push(responseBox(10, 'The code uses 5-level amount-based approval. You mentioned that only the Warehouse Supervisor approves. Which is correct?',
  ['Keep 5-level approval (amount-based)', 'Only Warehouse Supervisor approves', 'Other']));
children.push(spacer(20));
children.push(responseBox(11, 'The system auto-checks stock across all warehouses. Is this the desired behavior, or should stock checking be manual?',
  ['Auto-check is correct', 'Manual check preferred', 'Other']));

children.push(pageBreak());

// ── 4.5 MI ──────────────────────────────────────────────────────────────
children.push(h2('4.5 MI \u2014 Material Issue'));
children.push(noteBox('Formerly known as MIRV in V1. The most critical warehouse document \u2014 governs material issuance from stock.', 'warning'));
children.push(spacer(40));

children.push(h3('Description'));
children.push(p('Issues materials from warehouse to a project or department. Directly affects inventory (deduction). Uses FIFO lot consumption. The code currently implements amount-based approval levels, but the client indicated that only the Warehouse Supervisor should approve.'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'pending_approval', type: 'active' },
  { label: 'approved', type: 'active' },
  { label: 'issued', type: 'active' },
  { label: 'completed', type: 'end' },
]));
children.push(p('  Alternate paths:', { italic: true, color: GRAY }));
children.push(b('approved \u2192 partially_issued \u2192 issued (partial then full issuance)'));
children.push(b('approved \u2192 cancelled (cancellation releases reservations)'));
children.push(b('rejected \u2192 draft (return to edit)'));

children.push(spacer(40));
children.push(flowDetailTable([
  { status: 'draft', desc: 'Site engineer or staff creates MI', actor: 'Site Engineer / Staff', system: 'Auto-number: MI-XXXX' },
  { status: 'pending_approval', desc: 'Submitted for approval', actor: 'Submitter', system: '\u2014' },
  { status: 'approved', desc: 'Approved for issuance', actor: 'Warehouse Supervisor', system: 'Reserves stock via FIFO (reserveStockBatch)' },
  { status: 'issued', desc: 'Materials physically handed out', actor: 'Warehouse Staff', system: 'Requires QC signature (V5); Auto-creates outbound GatePass; Consumes FIFO lots' },
  { status: 'completed', desc: 'Process finished', actor: 'System', system: 'All quantities issued and confirmed' },
]));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['Site Engineer', 'Creates material issue request', 'create, read'],
    ['Warehouse Staff', 'Fills details, performs physical issuance', 'read, update'],
    ['Warehouse Supervisor', 'Approves issuance', 'read, update, approve'],
    ['Logistics Coordinator', 'Can create and approve', 'create, read, update, approve'],
    ['Manager', 'Reviews, approves, exports', 'read, approve, export'],
  ],
));

children.push(spacer(40));
children.push(noteBox('IMPORTANT: Client confirmed that MI approval should be by Warehouse Supervisor only (not amount-based). The current codebase uses 5-level amount-based approval. This needs alignment.', 'warning'));

children.push(spacer(40));
children.push(automationBox('Automations', [
  'On approve: Reserves stock automatically using FIFO (reserveStockBatch)',
  'On approve: Sets qtyApproved = qtyRequested per line item',
  'On issue: REQUIRES QC signature (qcSignatureId) \u2014 V5 feature',
  'On issue: Auto-creates outbound GatePass (passType: outbound)',
  'On issue: Consumes inventory lots in FIFO order (oldest first)',
  'On issue: Updates BinCard with "issue" transaction',
  'On cancel: Auto-releases all stock reservations (releaseReservation)',
]));

children.push(spacer(40));
children.push(inventoryBox([
  '- On "issued": qty deducted from warehouse stock (qtyOnHand)',
  '- Lots consumed in FIFO order (oldest lot first)',
  '+ BinCard automatically updated (transaction type: issue)',
  '\u00b1 On "approved": qty reserved (qtyReserved increases, qtyAvailable decreases)',
  '\u00b1 On "cancelled": reservation released (qtyReserved decreases)',
]));

children.push(spacer(40));
children.push(screenshotPlaceholder('MI Form \u2014 showing approval status, line items, FIFO lot allocation'));
children.push(spacer(40));

children.push(responseBox(12, 'The code implements 5-level amount-based approval for MI. You confirmed only Warehouse Supervisor approves. Should we remove the amount-based levels entirely?',
  ['Remove amount levels \u2014 only WH Supervisor', 'Keep amount-based levels', 'Modify levels (specify below)', 'Other']));
children.push(spacer(20));
children.push(responseBox(13, 'Stock reservation system: When MI is approved, stock is reserved (blocked from other MIs). Is this reservation mechanism needed?',
  ['Yes \u2014 keep reservations', 'No \u2014 remove, just check at issuance time', 'Other']));
children.push(spacer(20));
children.push(responseBox(14, 'The code auto-creates an outbound GatePass when MI is issued. Is this the correct behavior?',
  ['Yes \u2014 always create GatePass', 'Only for certain items/projects', 'No \u2014 GatePass should be manual', 'Other']));
children.push(spacer(20));
children.push(responseBox(15, 'QC signature (V5 feature) is required before material can be issued. Is this currently enforced in your operations?',
  ['Yes \u2014 QC must sign off', 'No \u2014 not required, remove it', 'Only for certain items', 'Other']));
children.push(spacer(20));
children.push(responseBox(16, 'Partial issuance (partially_issued status) allows issuing some items now and the rest later. Is this used in practice?',
  ['Yes \u2014 used regularly', 'Rarely \u2014 but keep it', 'No \u2014 remove partial issuance', 'Other']));

children.push(pageBreak());

// ── 4.6 MRN ─────────────────────────────────────────────────────────────
children.push(h2('4.6 MRN \u2014 Material Return Note'));
children.push(noteBox('Formerly known as MRV in V1. Used to return materials from projects back to the warehouse.', 'info'));
children.push(spacer(40));

children.push(h3('Description'));
children.push(p('Records material returns from project sites to the warehouse. Return types: Surplus, Damaged, Wrong Item, Project_Complete. Only "good" condition items are added back to stock.'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'pending', type: 'active' },
  { label: 'received', type: 'active' },
  { label: 'completed', type: 'end' },
]));
children.push(p('  rejected \u2192 draft (return to edit)', { italic: true, color: GRAY }));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['Warehouse Staff', 'Creates MRN, receives returned materials', 'create, read, update'],
    ['Warehouse Supervisor', 'Creates and reviews', 'create, read, update'],
    ['Logistics Coordinator', 'Creates and reviews', 'create, read, update'],
    ['Manager', 'Approves and exports', 'read, approve, export'],
  ],
));

children.push(spacer(40));
children.push(automationBox('Automations', [
  'On complete: Only "good" condition items are added back to stock (addStockBatch)',
  'On complete: Damaged/defective items are automatically excluded from stock',
  'On complete: If returnType = "surplus" \u2192 auto-creates SurplusItem with status "identified"',
  'Can be linked to original MI via originalMirvId for traceability',
]));

children.push(spacer(40));
children.push(inventoryBox([
  '+ On "received": good-condition qty added to warehouse stock',
  '+ BinCard updated (transaction type: receipt)',
  '+ Linked to original MI for full traceability',
]));

children.push(spacer(40));
children.push(responseBox(17, 'Should returned materials require a quality inspection (QCI) before being added to stock?',
  ['Yes \u2014 always inspect returns', 'Only for certain item types', 'No \u2014 trust the return condition', 'Other']));
children.push(spacer(20));
children.push(responseBox(18, 'The code auto-creates a Surplus record when returnType is "surplus". Is this the correct behavior?',
  ['Yes \u2014 correct', 'No \u2014 surplus should be manual', 'Other']));

children.push(pageBreak());

// ── 4.7 WT / IMSF ──────────────────────────────────────────────────────
children.push(h2('4.7 WT / IMSF \u2014 Material Transfers'));
children.push(noteBox('WT (Warehouse Transfer) was StockTransfer in V1. IMSF is new. Client requested merging both into a single form.', 'warning'));
children.push(spacer(40));

children.push(h3('Description'));
children.push(p('Two transfer mechanisms currently exist: WT for inter-warehouse transfers and IMSF for inter-project transfers. Both follow similar workflows but are separate documents. The client has requested merging them into a unified transfer form.'));

children.push(h3('Current Status Flow \u2014 WT (Warehouse Transfer)'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'pending', type: 'active' },
  { label: 'approved', type: 'active' },
  { label: 'shipped', type: 'active' },
  { label: 'received', type: 'active' },
  { label: 'completed', type: 'end' },
]));

children.push(h3('Current Status Flow \u2014 IMSF (Inter-Project Transfer)'));
children.push(...flowDiagram([
  { label: 'created', type: 'start' },
  { label: 'sent', type: 'active' },
  { label: 'confirmed', type: 'active' },
  { label: 'in_transit', type: 'active' },
  { label: 'delivered', type: 'active' },
  { label: 'completed', type: 'end' },
]));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'WT Permissions', 'IMSF Permissions'],
  [
    ['Warehouse Staff', 'create, read', '\u2014'],
    ['Warehouse Supervisor', 'create, read, update', 'create, read, update'],
    ['Logistics Coordinator', 'create, read, update', 'create, read, update'],
    ['Transport Supervisor', 'create, read, update, approve', 'create, read, update'],
    ['Manager', 'read, approve, export', '\u2014'],
  ],
));

children.push(spacer(40));
children.push(inventoryBox([
  '- On "shipped"/"in_transit": qty deducted from source warehouse/project',
  '+ On "received"/"delivered": qty added to destination warehouse/project',
  '\u00b1 Transfer type: inter_warehouse or inter_project',
  '\u00b1 IMSF tracks material type: normal or hazardous',
]));

children.push(spacer(40));
children.push(h3('Proposed Merge'));
children.push(p('After merging WT + IMSF into one form, the unified transfer should support:'));
children.push(b('Inter-warehouse transfers (same project, different warehouses)'));
children.push(b('Inter-project transfers (different projects)'));
children.push(b('Material type classification (normal / hazardous)'));
children.push(b('Link to originating MR (if applicable)'));
children.push(b('Two-sided confirmation (sender ships, receiver confirms)'));

children.push(spacer(40));
children.push(responseBox(19, 'After merging WT + IMSF: Should all transfers require approval, or only above a certain amount?',
  ['All transfers require approval', 'Only above SAR ____', 'Only inter-project, not inter-warehouse', 'Other']));
children.push(spacer(20));
children.push(responseBox(20, 'Should the system auto-create a GatePass when a transfer is shipped?',
  ['Yes \u2014 always', 'Only for external transfers', 'No \u2014 manual', 'Other']));
children.push(spacer(20));
children.push(responseBox(21, 'Do we need two-sided confirmation (sender marks shipped, receiver confirms receipt)?',
  ['Yes \u2014 both sides must confirm', 'No \u2014 sender confirmation is sufficient', 'Other']));

children.push(pageBreak());

// ── 4.8 Inventory ───────────────────────────────────────────────────────
children.push(h2('4.8 Inventory Management'));

children.push(h3('Description'));
children.push(p('Comprehensive inventory tracking system with FIFO lot management, stock levels per warehouse, reservations, and low-stock alerts.'));

children.push(h3('Key Components'));
children.push(styledTable(
  ['Component', 'Description', 'Key Fields'],
  [
    ['InventoryLevel', 'Stock qty per item per warehouse', 'qtyOnHand, qtyReserved, qtyAvailable, qtyOnOrder'],
    ['InventoryLot', 'FIFO lot tracking (each GRN creates a lot)', 'lotNumber, qtyRemaining, unitCost, supplierId, receivedAt'],
    ['LotConsumption', 'Records which lots were consumed by MI', 'lotId, mirvId, qtyConsumed'],
    ['StockReservation', 'Blocks stock for approved MI', 'status: active/consumed/released, qty, mirvId'],
    ['LeftoverMaterial', 'Materials remaining from completed projects', 'projectId, itemId, qty, condition'],
  ],
));

children.push(spacer(40));
children.push(h3('Stock Status Definitions'));
children.push(styledTable(
  ['Status', 'Condition', 'Action'],
  [
    ['In Stock', 'qty > minimum level', 'Normal operations'],
    ['Low Stock', 'qty between min level and reorder point', 'Alert generated'],
    ['Out of Stock', 'qty = 0', 'Urgent alert'],
    ['Overstocked', 'qty exceeds maximum level', 'Review surplus'],
  ],
));

children.push(spacer(40));
children.push(screenshotPlaceholder('Inventory Dashboard \u2014 stock levels, low-stock alerts, FIFO lots'));
children.push(spacer(40));

children.push(responseBox(22, 'Do you need a Cycle Count (stock take) feature? The database has a CycleCount model but it is not fully active.',
  ['Yes \u2014 implement cycle counting', 'No \u2014 not needed now', 'Yes \u2014 but later', 'Other']));
children.push(spacer(20));
children.push(responseBox(23, 'Do you need Stock Adjustments to manually correct inventory discrepancies?',
  ['Yes \u2014 with approval workflow', 'Yes \u2014 supervisor can adjust directly', 'No \u2014 not needed', 'Other']));
children.push(spacer(20));
children.push(responseBox(24, 'Are low-stock alerts currently active? What should happen when stock drops below the minimum?',
  ['Alert warehouse supervisor', 'Auto-create MR', 'Both alert and auto-MR', 'Other']));

children.push(pageBreak());

// ── 4.9 BinCard ─────────────────────────────────────────────────────────
children.push(h2('4.9 BinCard'));

children.push(h3('Description'));
children.push(p('A detailed ledger for every item movement at a specific storage location (zone-aisle-shelf). Automatically updated by GRN, MI, WT, and adjustments. Each entry records qty in/out and a running balance.'));

children.push(h3('Transaction Types'));
children.push(styledTable(
  ['Type', 'Triggered By', 'Direction'],
  [
    ['receipt', 'GRN stored / MRN received', 'IN (+qty)'],
    ['issue', 'MI issued', 'OUT (-qty)'],
    ['transfer', 'WT shipped / received', 'OUT or IN'],
    ['adjustment', 'Manual stock correction', 'IN or OUT'],
  ],
));

children.push(spacer(40));
children.push(h3('Recorded Data'));
children.push(b('binNumber: Storage location code (e.g., A-03-12)'));
children.push(b('qtyIn / qtyOut: Quantity moved'));
children.push(b('runningBalance: Cumulative balance after this transaction'));
children.push(b('referenceType + referenceId: Source document reference'));
children.push(b('performedById + performedAt: Who performed it and when'));

children.push(spacer(40));
children.push(responseBox(25, 'Is BinCard actively used in daily operations, or is it mainly a background ledger for auditing?',
  ['Actively used daily', 'Background ledger only', 'Not used at all', 'Other']));
children.push(spacer(20));
children.push(responseBox(26, 'Is the bin number (storage location) mandatory for all items, or optional?',
  ['Mandatory for all items', 'Optional', 'Mandatory for certain zones only', 'Other']));

children.push(pageBreak());

// ══════════════════════════════════════════════════════════════════════════
// SECTION 5: TRANSPORT & EQUIPMENT
// ══════════════════════════════════════════════════════════════════════════
children.push(h1('5. Transport & Equipment'));
children.push(p('Covers job orders, gate passes, fleet management, generators, rental contracts, tools, and yard management.'));
children.push(screenshotPlaceholder('Transport Module Dashboard \u2014 active JOs, fleet status, gate pass activity'));

// ── 5.1 JO ──────────────────────────────────────────────────────────────
children.push(h2('5.1 JO \u2014 Job Orders'));

children.push(h3('Description'));
children.push(p('A Job Order covers transport, equipment rental, maintenance, and scrap collection tasks. Seven distinct types exist, each with specific data fields. Approval is amount-based (4 levels). Insurance is required above SAR 7,000,000.'));

children.push(h3('Seven JO Types'));
children.push(styledTable(
  ['Type', 'Description', 'Key Fields'],
  [
    ['transport', 'Move materials/equipment between locations', 'pickup/delivery location (Maps), load type, weight, # trips'],
    ['equipment', 'Heavy equipment usage', 'Equipment type, hours, operator'],
    ['generator_rental', 'Generator rental for a project', 'KVA capacity, duration, shift times'],
    ['generator_maintenance', 'Generator repair/service', 'Maintenance type, fault description'],
    ['rental_monthly', 'Monthly equipment/vehicle rental', 'Monthly rate, with/without operator, overtime hours'],
    ['rental_daily', 'Daily equipment/vehicle rental', 'Daily rate, with/without operator'],
    ['scrap', 'Scrap collection and transport', 'Scrap type, weight, destination'],
  ],
));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'pending_approval', type: 'active' },
  { label: 'quoted', type: 'active' },
  { label: 'approved', type: 'active' },
  { label: 'assigned', type: 'active' },
  { label: 'in_progress', type: 'active' },
]));
children.push(...flowDiagram([
  { label: 'completed', type: 'active' },
  { label: 'closure_pending', type: 'active' },
  { label: 'closure_approved', type: 'active' },
  { label: 'invoiced', type: 'end' },
]));
children.push(p('  Additional: on_hold \u2194 in_progress, rejected \u2192 draft, cancelled', { italic: true, color: GRAY }));

children.push(spacer(40));
children.push(h3('Approval Levels'));
children.push(styledTable(
  ['Level', 'Amount Range (SAR)', 'Approver', 'SLA'],
  [
    ['1', '0 \u2013 5,000', 'Logistics Coordinator', '4 hours'],
    ['2', '5,000 \u2013 20,000', 'Logistics Manager (Manager)', '8 hours'],
    ['3', '20,000 \u2013 100,000', 'Operations Director (Manager)', '24 hours'],
    ['4', '100,000+', 'CEO (Admin)', '48 hours'],
  ],
));

children.push(spacer(40));
children.push(noteBox(`Insurance Requirement: If the transported material value exceeds SAR 7,000,000 (INSURANCE_THRESHOLD_SAR), insurance documentation is mandatory.`, 'warning'));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['Site Engineer', 'Creates JO for project needs', 'create, read'],
    ['Logistics Coordinator', 'Creates, manages, approves', 'create, read, update, approve'],
    ['Transport Supervisor', 'Creates, manages, approves, tracks execution', 'create, read, update, approve'],
    ['Manager', 'Creates and approves', 'create, read, approve, export'],
  ],
));

children.push(spacer(40));
children.push(screenshotPlaceholder('Job Order Form \u2014 showing type selection, quotation, and execution tracking'));
children.push(spacer(40));

children.push(responseBox(27, 'Are all 7 JO types actively used, or are some theoretical only? Which ones are most common?',
  ['All 7 are used', 'Only some (specify below)', 'Other']));
children.push(spacer(20));
children.push(responseBox(28, 'The insurance threshold is set at SAR 7,000,000. Is this amount correct and current?',
  ['Correct', 'Needs updating to SAR ____', 'Other']));
children.push(spacer(20));
children.push(responseBox(29, 'The 4-level amount-based approval for JOs \u2014 does it need modification?',
  ['Keep as-is', 'Modify levels (specify below)', 'Other']));
children.push(spacer(20));
children.push(responseBox(30, 'The closure workflow (closure_pending \u2192 closure_approved) adds a sign-off step before invoicing. Is this used?',
  ['Yes \u2014 closure approval is required', 'No \u2014 skip directly to invoiced', 'Other']));

children.push(pageBreak());

// ── 5.2 GatePass ────────────────────────────────────────────────────────
children.push(h2('5.2 GatePass'));

children.push(h3('Description'));
children.push(p('Authorizes material/equipment entry or exit from warehouse or site. Records vehicle info, driver details, and guard check-in/out times. Types: Inbound, Outbound, Transfer. SLA: 24 hours.'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'pending', type: 'active' },
  { label: 'approved', type: 'active' },
  { label: 'released', type: 'active' },
  { label: 'returned / expired', type: 'end' },
]));

children.push(spacer(40));
children.push(h3('Key Data'));
children.push(b('Pass type: inbound / outbound / transfer'));
children.push(b('Vehicle plate number, driver name, driver ID'));
children.push(b('Guard check-in time + check-out time'));
children.push(b('Linked document: GRN, MI, or WT (linkedDocumentType + linkedDocumentId)'));
children.push(b('SLA: 24 hours before auto-expiry'));

children.push(spacer(40));
children.push(responseBox(31, 'The code auto-creates an outbound GatePass from MI on issuance. Is this the desired behavior?',
  ['Yes \u2014 auto-create from MI', 'No \u2014 GatePass should always be manual', 'Auto-create but with modifications', 'Other']));
children.push(spacer(20));
children.push(responseBox(32, 'After how many hours should a GatePass expire automatically? Current setting: 24 hours.',
  ['24 hours is fine', 'Change to ____ hours', 'Should not auto-expire', 'Other']));

children.push(pageBreak());

// ── 5.3 Fleet ───────────────────────────────────────────────────────────
children.push(h2('5.3 Fleet Management'));

children.push(h3('Description'));
children.push(p('Tracks company vehicles and equipment. Each vehicle record includes: registration, type, assigned project, maintenance schedule, fuel consumption, and current status (available/in_use/maintenance/retired).'));

children.push(spacer(40));
children.push(h3('Roles'));
children.push(styledTable(
  ['Role', 'Permissions'],
  [
    ['Transport Supervisor', 'read, update'],
    ['Admin', 'create, read, update, delete, export'],
  ],
));

children.push(spacer(40));
children.push(responseBox(33, 'Is the Fleet Management module currently active in your operations?',
  ['Yes \u2014 actively used', 'Not yet \u2014 planned for later', 'No \u2014 not needed', 'Other']));
children.push(spacer(20));
children.push(responseBox(34, 'Do you need vehicle maintenance scheduling integrated with JO?',
  ['Yes \u2014 link maintenance to JO', 'No \u2014 separate system', 'Other']));

children.push(pageBreak());

// ── 5.4 Generators ──────────────────────────────────────────────────────
children.push(h2('5.4 Generator Management'));

children.push(h3('Description'));
children.push(p('Manages generators across projects with three sub-modules: generator registry, fuel log tracking, and maintenance scheduling.'));

children.push(h3('Sub-Modules'));
children.push(styledTable(
  ['Module', 'Description', 'Key Fields'],
  [
    ['Generator Registry', 'List of all generators', 'serialNumber, kvaCapacity, manufacturer, assignedProjectId, status'],
    ['Fuel Log', 'Daily/periodic fuel consumption', 'fuelDate, litresFilled, hoursRun, costPerLitre, litresPerHour'],
    ['Maintenance', 'Scheduled and emergency maintenance', 'maintenanceType, scheduledDate, findings, cost'],
  ],
));

children.push(h3('Maintenance Status Flow'));
children.push(...flowDiagram([
  { label: 'scheduled', type: 'start' },
  { label: 'in_progress', type: 'active' },
  { label: 'completed', type: 'end' },
]));
children.push(p('  overdue \u2192 in_progress (when overdue maintenance is started)', { italic: true, color: GRAY }));

children.push(spacer(40));
children.push(responseBox(35, 'Is fuel logging manual entry or automated (IoT sensors)?',
  ['Manual entry', 'Automated (sensors)', 'Combination', 'Other']));
children.push(spacer(20));
children.push(responseBox(36, 'Should generator maintenance be linked to JO (as generator_maintenance type)?',
  ['Yes \u2014 always through JO', 'No \u2014 standalone maintenance', 'Other']));

children.push(pageBreak());

// ── 5.5 Rental Contracts ────────────────────────────────────────────────
children.push(h2('5.5 Rental Contracts'));

children.push(h3('Description'));
children.push(p('Manages rental agreements for equipment, vehicles, and generators. Tracks contract terms, payment schedule, extensions, and termination.'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'pending_approval', type: 'active' },
  { label: 'active', type: 'active' },
  { label: 'extended / terminated', type: 'end' },
]));
children.push(p('  extended \u2192 active (can return to active after extension)', { italic: true, color: GRAY }));

children.push(spacer(40));
children.push(h3('Key Fields'));
children.push(b('contractType: equipment, vehicle, generator, other'));
children.push(b('startDate, endDate, monthlyRate, paymentTerms'));
children.push(b('vendorId, linkedJobOrderId (optional)'));
children.push(b('autoRenew flag, terminationPenalty'));

children.push(spacer(40));
children.push(responseBox(37, 'Are rental contracts linked to JOs, or are they independent?',
  ['Linked to JO', 'Independent', 'Both options', 'Other']));
children.push(spacer(20));
children.push(responseBox(38, 'Does contract extension require a new approval cycle?',
  ['Yes \u2014 full approval', 'No \u2014 auto-extends', 'Manager approval only', 'Other']));

children.push(pageBreak());

// ── 5.6 Tools ───────────────────────────────────────────────────────────
children.push(h2('5.6 Tool Management'));

children.push(h3('Description'));
children.push(p('Tracks tools/equipment lending to workers. Each tool has a registry entry; tool issues track who has what and when it is due for return.'));

children.push(h3('Tool Issue Status Flow'));
children.push(...flowDiagram([
  { label: 'issued', type: 'start' },
  { label: 'overdue', type: 'reject' },
  { label: 'returned', type: 'end' },
]));

children.push(spacer(40));
children.push(responseBox(39, 'Is the Tool Management module currently active?',
  ['Yes \u2014 actively used', 'Not yet \u2014 planned', 'No \u2014 not needed', 'Other']));

children.push(pageBreak());

// ── 5.7 Yard Management ────────────────────────────────────────────────
children.push(h2('5.7 Yard Management'));

children.push(h3('Description'));
children.push(p('Manages the physical yard/storage area. Tracks warehouse zones (A, B, C, D, Container, Open Yard, Hazardous) with zone types and capacity.'));

children.push(h3('Warehouse Zones'));
children.push(styledTable(
  ['Zone', 'Type', 'Usage'],
  [
    ['A', 'Civil', 'Civil construction materials'],
    ['B', 'Mechanical / Scrap', 'Mechanical parts and scrap'],
    ['C', 'Electrical', 'Electrical components'],
    ['D', 'General', 'General supplies'],
    ['CONTAINER', 'Container Storage', 'Shipping containers'],
    ['OPEN_YARD', 'Open Yard', 'Large/outdoor items'],
    ['HAZARDOUS', 'Hazardous Materials', 'Chemical/hazardous storage'],
  ],
));

children.push(spacer(40));
children.push(responseBox(40, 'Is the Yard Management module currently active in your operations?',
  ['Yes \u2014 actively used', 'Not yet \u2014 planned', 'No \u2014 not needed', 'Other']));
children.push(spacer(20));
children.push(responseBox(41, 'Are IoT devices installed for yard monitoring (sensors, cameras)?',
  ['Yes', 'No \u2014 not planned', 'Planned for future', 'Other']));

children.push(pageBreak());

// ══════════════════════════════════════════════════════════════════════════
// SECTION 6: SCRAP & SURPLUS
// ══════════════════════════════════════════════════════════════════════════
children.push(h1('6. Scrap & Surplus Management'));
children.push(p('Covers scrap identification and disposal, surplus material handling, and the Scrap Sales Committee (SSC) bidding process.'));
children.push(screenshotPlaceholder('Scrap & Surplus Module \u2014 showing pipeline, pending approvals, and SSC bids'));

// ── 6.1 Scrap ───────────────────────────────────────────────────────────
children.push(h2('6.1 Scrap Items'));

children.push(h3('Description'));
children.push(p('Tracks scrap materials from identification through disposal or sale. Requires triple approval (three different approvers in parallel). Material types: cable, mv_cable, hv_cable, aluminum, copper, steel, cable_tray, wood, other.'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'identified', type: 'start' },
  { label: 'reported', type: 'active' },
  { label: 'approved', type: 'active' },
  { label: 'in_ssc', type: 'active' },
]));
children.push(...flowDiagram([
  { label: 'sold / disposed', type: 'active' },
  { label: 'closed', type: 'end' },
]));
children.push(p('  rejected \u2192 identified (return to start)', { italic: true, color: GRAY }));

children.push(spacer(40));
children.push(flowDetailTable([
  { status: 'identified', desc: 'Scrap material discovered and recorded', actor: 'Warehouse Supervisor', system: 'Photos required; location + weight recorded' },
  { status: 'reported', desc: 'Formal report submitted for approval', actor: 'Warehouse Supervisor', system: '\u2014' },
  { status: 'approved', desc: 'Triple approval: QC + WH Supervisor + Manager (parallel)', actor: 'Three approvers', system: 'All 3 must approve (any order)' },
  { status: 'in_ssc', desc: 'Sent to Scrap Sales Committee for bidding', actor: 'System / Admin', system: 'SSC bidding process begins' },
  { status: 'sold', desc: 'Sold to winning bidder', actor: 'SSC', system: 'Buyer must pick up within 10 days (SLA)' },
  { status: 'disposed', desc: 'Disposed of (if unsold)', actor: 'Admin', system: '\u2014' },
  { status: 'closed', desc: 'Process complete', actor: 'System', system: 'Removes from active scrap inventory' },
]));

children.push(spacer(40));
children.push(noteBox('Triple Approval: The code implements parallel approval \u2014 QC Officer, Warehouse Supervisor, and Manager can approve in any order. All three must approve for the item to proceed.', 'info'));

children.push(spacer(40));
children.push(automationBox('Automations & Business Rules', [
  'Photos are required for scrap identification',
  'Triple approval is parallel (any order, all required)',
  'SLA: 10 days for buyer pickup after sale',
  'SLA alerts sent when pickup deadline approaches',
  'Scrap material types are predefined (9 categories)',
]));

children.push(spacer(40));
children.push(responseBox(42, 'Triple approval is parallel in the code (any order). Should it be sequential instead (specific order)?',
  ['Parallel is correct (any order)', 'Sequential (QC \u2192 WH Sup \u2192 Manager)', 'Other']));
children.push(spacer(20));
children.push(responseBox(43, '10-day SLA for scrap buyer pickup \u2014 is this sufficient?',
  ['10 days is fine', 'Too short \u2014 extend to ___ days', 'Too long \u2014 reduce to ___ days', 'Other']));
children.push(spacer(20));
children.push(responseBox(44, 'Is the "smart container" (IoT-enabled scrap bin) feature used or planned?',
  ['Yes \u2014 in use', 'Planned', 'No \u2014 not applicable', 'Other']));

children.push(pageBreak());

// ── 6.2 Surplus ─────────────────────────────────────────────────────────
children.push(h2('6.2 Surplus Materials'));

children.push(h3('Description'));
children.push(p('Handles surplus materials that are no longer needed for their original project. The system enforces a 14-day waiting period before action can be taken, allowing other projects to claim the materials. Can be auto-created from MRN when returnType is "surplus".'));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'identified', type: 'start' },
  { label: 'evaluated', type: 'active' },
  { label: 'approved', type: 'active' },
  { label: 'actioned', type: 'active' },
  { label: 'closed', type: 'end' },
]));
children.push(p('  rejected \u2192 identified', { italic: true, color: GRAY }));

children.push(spacer(40));
children.push(h3('Disposition Options'));
children.push(styledTable(
  ['Disposition', 'Description', 'Auto Action'],
  [
    ['transfer_to_project', 'Send to another project that needs it', 'Creates IMSF'],
    ['return_to_warehouse', 'Return to main warehouse stock', 'Creates MRN'],
    ['convert_to_scrap', 'Material is beyond use \u2014 scrap it', 'Creates Scrap Item'],
    ['sell', 'Sell directly', 'Creates SSC bid process'],
  ],
));

children.push(spacer(40));
children.push(automationBox('Business Rules', [
  '14-day waiting period enforced in code (SLA: surplus_timeout = 336 hours)',
  'During waiting period: other projects can request the surplus material',
  'After 14 days: action is taken based on disposition decision',
  'Auto-creates appropriate documents based on disposition (IMSF, MRN, Scrap, or SSC)',
]));

children.push(spacer(40));
children.push(responseBox(45, 'The 14-day waiting period allows other projects to claim surplus. What happens if no one claims it?',
  ['Auto-convert to scrap', 'Return to warehouse', 'Manager decides', 'Other']));
children.push(spacer(20));
children.push(responseBox(46, 'Can surplus materials be transferred to another project directly, or must they always return to warehouse first?',
  ['Direct transfer (IMSF)', 'Must return to warehouse first', 'Either option', 'Other']));

children.push(pageBreak());

// ── 6.3 SSC ─────────────────────────────────────────────────────────────
children.push(h2('6.3 SSC \u2014 Scrap Sales Committee'));

children.push(h3('Description'));
children.push(p('The Scrap Sales Committee manages the bidding and sale process for scrap materials. Buyers submit bids, the committee evaluates and selects a winner, a formal memo is signed, and finance is notified for payment collection.'));

children.push(h3('Bidding Workflow'));
children.push(...flowDiagram([
  { label: 'submit_bid', type: 'start' },
  { label: 'evaluate', type: 'active' },
  { label: 'accept_bid', type: 'active' },
  { label: 'sign_memo', type: 'active' },
  { label: 'notify_finance', type: 'end' },
]));

children.push(spacer(40));
children.push(flowDetailTable([
  { status: 'submit_bid', desc: 'Buyers submit their bids with amount + conditions', actor: 'Buyers / SSC Admin', system: 'Bid recorded with buyerName, amount, notes' },
  { status: 'evaluate', desc: 'Committee reviews all bids', actor: 'Scrap Committee Members', system: '\u2014' },
  { status: 'accept_bid', desc: 'Best bid selected', actor: 'SSC', system: 'Auto-rejects all other bids' },
  { status: 'sign_memo', desc: 'Formal sale memo signed by committee', actor: 'SSC Members', system: 'Memo document generated' },
  { status: 'notify_finance', desc: 'Finance team notified for payment tracking', actor: 'System', system: 'Payment collection initiated' },
]));

children.push(spacer(40));
children.push(h3('Roles'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['Scrap Committee Member', 'Reviews bids, approves sales', 'create, read, update, approve'],
    ['QC Officer', 'Validates scrap classification', 'read, approve'],
    ['Admin', 'Full SSC management', 'create, read, update, approve'],
  ],
));

children.push(spacer(40));
children.push(automationBox('Automations', [
  'When a bid is accepted: all other bids for the same scrap item are auto-rejected',
  'Memo signing process: committee members sign in sequence',
  'Finance notification is triggered automatically after memo signing',
  'Buyer pickup SLA: 10 days from acceptance',
]));

children.push(spacer(40));
children.push(responseBox(47, 'How many committee members are required for SSC decisions?',
  ['2 members', '3 members', 'Quorum (majority)', 'Other']));
children.push(spacer(20));
children.push(responseBox(48, 'Is there a minimum number of bids required before the committee can accept one?',
  ['No minimum', 'At least 2 bids', 'At least 3 bids', 'Other']));
children.push(spacer(20));
children.push(responseBox(49, 'Finance notification is currently manual. Should it be fully automated with payment tracking integration?',
  ['Yes \u2014 auto-notify with payment tracking', 'Keep manual notification', 'Other']));

children.push(pageBreak());

// ══════════════════════════════════════════════════════════════════════════
// SECTION 7: SHIPPING & CUSTOMS
// ══════════════════════════════════════════════════════════════════════════
children.push(h1('7. Shipping & Customs'));
children.push(p('Covers shipment tracking from supplier to warehouse and customs clearance with government platform integration.'));
children.push(screenshotPlaceholder('Shipping Dashboard \u2014 showing active shipments, milestone tracking, and customs status'));

// ── 7.1 Shipment ────────────────────────────────────────────────────────
children.push(h2('7.1 Shipment Tracking'));

children.push(h3('Description'));
children.push(p('Tracks shipments from supplier origin through transit to warehouse delivery. Supports 5 shipping modes and 11 milestone types. Each shipment can have multiple line items (ShipmentLine) with HS codes.'));

children.push(h3('Shipping Modes'));
children.push(styledTable(
  ['Mode', 'Description', 'Key Tracking Fields'],
  [
    ['sea_fcl', 'Full Container Load (ocean)', 'Container number, BOL number, port of origin/destination'],
    ['sea_lcl', 'Less-than Container Load (shared)', 'Consolidation reference, BOL number'],
    ['air', 'Air freight', 'AWB number, airline, flight number'],
    ['land', 'Ground transportation', 'Truck plate, driver info, border crossing'],
    ['courier', 'Express / parcel courier', 'Tracking number, courier name'],
  ],
));

children.push(h3('Status Flow'));
children.push(...flowDiagram([
  { label: 'draft', type: 'start' },
  { label: 'po_issued', type: 'active' },
  { label: 'in_production', type: 'active' },
  { label: 'ready_to_ship', type: 'active' },
  { label: 'in_transit', type: 'active' },
]));
children.push(...flowDiagram([
  { label: 'at_port', type: 'active' },
  { label: 'customs_clearing', type: 'active' },
  { label: 'cleared', type: 'active' },
  { label: 'in_delivery', type: 'active' },
  { label: 'delivered', type: 'end' },
]));

children.push(spacer(40));
children.push(h3('Milestones (11 types)'));
children.push(styledTable(
  ['Milestone', 'Description'],
  [
    ['booking_confirmed', 'Shipping space/booking confirmed'],
    ['cargo_loaded', 'Cargo loaded on vessel/plane/truck'],
    ['vessel_departed', 'Vessel/vehicle departed origin'],
    ['in_transit', 'Currently in transit'],
    ['arrived_at_port', 'Arrived at destination port'],
    ['customs_clearance', 'Entered customs clearance process'],
    ['saber_registration', 'Registered on SABER platform'],
    ['fasah_customs', 'Processed through FASAH platform'],
    ['sadad_payment', 'SADAD payment completed'],
    ['delivered_to_warehouse', 'Delivered to NIT warehouse'],
    ['advance_shipment_notification', 'ASN sent to receiving warehouse'],
  ],
));

children.push(spacer(40));
children.push(h3('Required Documents'));
children.push(b('BOL (Bill of Lading) / AWB (Air Waybill)'));
children.push(b('Commercial Invoice'));
children.push(b('Packing List'));
children.push(b('Certificate of Origin (COO)'));
children.push(b('Insurance Certificate'));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['Logistics Coordinator', 'Creates and manages shipments', 'create, read, update'],
    ['Freight Forwarder', 'Updates shipment status and milestones', 'read, update'],
    ['Transport Supervisor', 'Monitors shipments', 'read'],
    ['Manager', 'Reviews and exports', 'read, export'],
  ],
));

children.push(spacer(40));
children.push(automationBox('Automations', [
  'On status=delivered: Auto-updates linked GRN (MRRV) to "received" status',
  'This connects the international shipping cycle to warehouse receiving automatically',
  'Milestone timestamps are recorded for tracking and analytics',
]));

children.push(spacer(40));
children.push(screenshotPlaceholder('Shipment Detail Page \u2014 showing milestones timeline, documents, and line items'));
children.push(spacer(40));

children.push(responseBox(50, 'Do all shipments go through customs, or only international ones?',
  ['All shipments', 'Only international', 'Other']));
children.push(spacer(20));
children.push(responseBox(51, 'Does the Freight Forwarder access the system directly, or does someone enter data on their behalf?',
  ['Direct access (own login)', 'Data entered by Logistics Coordinator', 'Both options', 'Other']));
children.push(spacer(20));
children.push(responseBox(52, 'Is the ASN (Advance Shipment Notification) feature active? How does it work in your process?',
  ['Yes \u2014 actively used', 'Not yet \u2014 planned', 'No \u2014 not needed', 'Other']));

children.push(pageBreak());

// ── 7.2 Customs ─────────────────────────────────────────────────────────
children.push(h2('7.2 Customs Tracking'));

children.push(h3('Description'));
children.push(p('Tracks the customs clearance process with 9 stages, inspection types, payment tracking, and integration with Saudi government platforms (SABER, FASAH, SADAD).'));

children.push(h3('Status Flow (9 Stages)'));
children.push(...flowDiagram([
  { label: 'docs_submitted', type: 'start' },
  { label: 'declaration_filed', type: 'active' },
  { label: 'under_inspection', type: 'active' },
  { label: 'awaiting_payment', type: 'active' },
]));
children.push(...flowDiagram([
  { label: 'duties_paid', type: 'active' },
  { label: 'ready_for_release', type: 'active' },
  { label: 'released', type: 'end' },
]));
children.push(p('  Additional statuses: on_hold (detained), rejected', { italic: true, color: GRAY }));

children.push(spacer(40));
children.push(h3('Inspection Types'));
children.push(styledTable(
  ['Type', 'Description', 'Duration'],
  [
    ['document_review', 'Document verification only', 'Fastest'],
    ['xray_scan', 'X-ray scanning of containers', 'Fast'],
    ['physical_inspection', 'Physical opening and inspection', 'Moderate'],
    ['lab_testing', 'Sample sent for laboratory analysis', 'Slowest'],
    ['green_channel', 'No inspection required (pre-approved)', 'Immediate'],
  ],
));

children.push(spacer(40));
children.push(h3('Payment Tracking'));
children.push(styledTable(
  ['Status', 'Description'],
  [
    ['pending_calculation', 'Customs fees being calculated'],
    ['awaiting_payment', 'Fees calculated, awaiting payment'],
    ['paid', 'All duties and fees paid'],
    ['refund_pending', 'Refund being processed'],
  ],
));
children.push(p('Fields: customsFees + vatAmount + totalDuties + paymentReference', { italic: true, color: GRAY }));

children.push(spacer(40));
children.push(h3('Government Platforms'));
children.push(styledTable(
  ['Platform', 'Purpose', 'Integration'],
  [
    ['SABER', 'Product conformity registration', 'Milestone tracking'],
    ['FASAH', 'Customs clearance platform', 'Milestone tracking'],
    ['SADAD', 'Payment system', 'Payment milestone'],
  ],
));

children.push(spacer(40));
children.push(h3('Recorded Data'));
children.push(b('declarationNumber: Customs declaration reference'));
children.push(b('hsCode: Harmonized System code for items'));
children.push(b('Customs fees + VAT + total duties'));
children.push(b('Broker name and contact information'));
children.push(b('Submission date + clearance date'));
children.push(b('Attached documents + inspection notes'));

children.push(spacer(40));
children.push(h3('Roles & Permissions'));
children.push(styledTable(
  ['Role', 'Actions', 'Permissions'],
  [
    ['Logistics Coordinator', 'Creates and manages customs records', 'create, read, update'],
    ['Freight Forwarder', 'Views customs status', 'read'],
    ['Admin', 'Full control', 'create, read, update, delete, export'],
  ],
));

children.push(spacer(40));
children.push(automationBox('Automations', [
  'When shipment is delivered: linked GRN (MRRV) is auto-updated to "received" status',
  'Milestone timestamps recorded for each government platform interaction',
  'Payment status tracked through the full lifecycle',
]));

children.push(spacer(40));
children.push(responseBox(53, 'When a shipment is put "on_hold" by customs, what is the procedure? Is there a specific action in the system?',
  ['Manual resolution \u2014 update status when resolved', 'Needs escalation workflow', 'Other']));
children.push(spacer(20));
children.push(responseBox(54, 'Is there direct API integration with SABER/FASAH/SADAD, or is status updated manually?',
  ['Direct API integration', 'Manual update', 'Planned for future', 'Other']));
children.push(spacer(20));
children.push(responseBox(55, 'The code auto-updates GRN to "received" when a shipment is delivered. Should quality inspection (QCI) happen first before updating GRN?',
  ['Auto-update is fine \u2014 QCI happens after', 'QCI must happen before GRN update', 'Depends on item type', 'Other']));

children.push(pageBreak());

// ══════════════════════════════════════════════════════════════════════════
// SECTION 8: ROLES & PERMISSIONS MATRIX
// ══════════════════════════════════════════════════════════════════════════
children.push(h1('8. Roles & Permissions Summary'));

children.push(p('The system has 10 defined roles. Each role has specific permissions across all modules. The table below provides a comprehensive overview.'));
children.push(spacer(40));

children.push(h3('8.1 Role Definitions'));
children.push(styledTable(
  ['Role', 'Primary Responsibilities', 'Max Approval Level'],
  [
    ['Admin', 'Full system access, settings, user management', 'Level 5 (highest)'],
    ['Manager', 'Approves documents, exports, oversight', 'Level 4'],
    ['Warehouse Supervisor', 'Manages warehouse, approves GRN/MI', 'Level 1'],
    ['Warehouse Staff (Storekeeper)', 'Daily warehouse operations', 'Level 1'],
    ['Logistics Coordinator', 'Shipments, MI, JO coordination', 'Level 2'],
    ['Site Engineer', 'Creates MI, MR, JO requests', 'Level 0 (no approval)'],
    ['QC Officer', 'Quality inspections, scrap approval', 'Level 1'],
    ['Freight Forwarder', 'Updates shipment/customs status', 'Level 0'],
    ['Transport Supervisor', 'Manages JO, GatePass, WT', 'Level 1'],
    ['Scrap Committee Member', 'Scrap approval, SSC bids', 'Level 1'],
  ],
));

children.push(spacer(60));
children.push(h3('8.2 Permission Matrix (Key Modules)'));
children.push(p('C=Create, R=Read, U=Update, D=Delete, A=Approve, E=Export'));
children.push(spacer(20));

const permHeaders = ['Module', 'Admin', 'Manager', 'WH Sup', 'WH Staff', 'Logistics', 'Site Eng', 'QC', 'Freight', 'Transport', 'Scrap Com'];
const permRows = [
  ['GRN', 'CRUDAE', 'RAE', 'CRUA', 'CRU', 'CRU', '-', 'R', '-', 'R', '-'],
  ['QCI', 'CRUDAE', 'RAE', 'CR', 'CR', '-', '-', 'CRUA', '-', '-', '-'],
  ['DR', 'CRUDAE', 'RE', 'CRU', 'CR', '-', '-', 'CRU', '-', '-', '-'],
  ['MR', 'CRUDAE', 'RAE', '-', '-', '-', 'CR', '-', '-', 'R', '-'],
  ['MI', 'CRUDAE', 'RAE', 'RUA', 'RU', 'CRUA', 'CR', '-', '-', 'R', '-'],
  ['MRN', 'CRUDAE', 'RAE', 'CRU', 'CRU', 'CRU', '-', '-', '-', '-', '-'],
  ['WT', 'CRUDAE', 'RAE', 'CRU', 'CR', 'CRU', '-', '-', '-', 'CRUA', '-'],
  ['JO', 'CRUDAE', 'CRAE', '-', '-', 'CRUA', 'CR', '-', '-', 'CRUA', '-'],
  ['GatePass', 'CRUDE', 'RE', 'CRU', 'CRU', 'CRU', '-', '-', 'R', 'CRU', '-'],
  ['Shipment', 'CRUDE', 'RE', '-', '-', 'CRU', '-', '-', 'RU', 'R', '-'],
  ['Customs', 'CRUDE', 'RE', '-', '-', 'CRU', '-', '-', 'R', '-', '-'],
  ['Scrap', 'CRUDAE', '-', 'CR', '-', '-', '-', 'RA', '-', '-', 'RA'],
  ['Surplus', 'CRUDAE', '-', 'CRU', '-', '-', '-', 'R', '-', '-', 'R'],
  ['SSC', 'CRUA', '-', '-', '-', '-', '-', '-', '-', '-', 'CRUA'],
  ['Inventory', 'RUE', 'RE', 'RUE', 'RU', 'RE', 'R', 'R', '-', 'R', 'R'],
];
children.push(styledTable(permHeaders, permRows));

children.push(pageBreak());

// ══════════════════════════════════════════════════════════════════════════
// SECTION 9: ALL QUESTIONS SUMMARY
// ══════════════════════════════════════════════════════════════════════════
children.push(h1('9. Complete Questions Summary'));
children.push(p('Below is a summary of all 55 questions organized by section. Please ensure all questions are addressed.'));
children.push(spacer(40));

const allQuestions = [
  ['Warehouse \u2014 GRN (Q1-Q3)', [
    'How is qciRequired determined?',
    'Do all GRN require quality inspection?',
    'Is over-delivery tolerance unified or per-item?',
  ]],
  ['Warehouse \u2014 QCI (Q4-Q6)', [
    'Is QCI mandatory for every GRN?',
    'Is the 14-day QCI SLA appropriate?',
    'Is completed_conditional status used in practice?',
  ]],
  ['Warehouse \u2014 DR (Q7-Q8)', [
    'Should DR auto-create for all discrepancies (not just damage)?',
    'Is there a minimum threshold for triggering DR?',
  ]],
  ['Warehouse \u2014 MR (Q9-Q11)', [
    'Is MR mandatory before MI?',
    'Which approval model: amount-based or supervisor-only?',
    'Is auto stock-checking the desired behavior?',
  ]],
  ['Warehouse \u2014 MI (Q12-Q16)', [
    'Remove 5-level approval \u2014 supervisor only?',
    'Is stock reservation mechanism needed?',
    'Auto GatePass on MI issuance \u2014 correct?',
    'QC signature (V5) required before issuance?',
    'Is partial issuance used in practice?',
  ]],
  ['Warehouse \u2014 MRN (Q17-Q18)', [
    'Should returns require QCI before restocking?',
    'Auto surplus creation \u2014 correct behavior?',
  ]],
  ['Warehouse \u2014 WT/IMSF (Q19-Q21)', [
    'After merge: all transfers need approval?',
    'Auto GatePass on transfer?',
    'Two-sided confirmation needed?',
  ]],
  ['Warehouse \u2014 Inventory (Q22-Q24)', [
    'Need Cycle Count feature?',
    'Need Stock Adjustments?',
    'Low-stock alerts active? What action?',
  ]],
  ['Warehouse \u2014 BinCard (Q25-Q26)', [
    'BinCard used daily or as audit ledger?',
    'Bin number mandatory or optional?',
  ]],
  ['Transport \u2014 JO (Q27-Q30)', [
    'All 7 JO types actively used?',
    'Insurance threshold SAR 7M correct?',
    '4-level approval needs modification?',
    'Closure workflow used?',
  ]],
  ['Transport \u2014 GatePass (Q31-Q32)', [
    'Auto GatePass from MI \u2014 desired?',
    'Expiry time for GatePass?',
  ]],
  ['Transport \u2014 Fleet (Q33-Q34)', [
    'Fleet module active?',
    'Vehicle maintenance linked to JO?',
  ]],
  ['Transport \u2014 Generators (Q35-Q36)', [
    'Fuel logging: manual or IoT?',
    'Maintenance linked to JO?',
  ]],
  ['Transport \u2014 Rental (Q37-Q38)', [
    'Rental contracts linked to JO?',
    'Extension requires new approval?',
  ]],
  ['Transport \u2014 Tools (Q39)', [
    'Tool management module active?',
  ]],
  ['Transport \u2014 Yard (Q40-Q41)', [
    'Yard management active?',
    'IoT devices installed?',
  ]],
  ['Scrap (Q42-Q44)', [
    'Triple approval: parallel or sequential?',
    '10-day buyer pickup SLA sufficient?',
    'Smart container feature used?',
  ]],
  ['Surplus (Q45-Q46)', [
    '14-day waiting period: what happens after?',
    'Direct inter-project transfer or via warehouse?',
  ]],
  ['SSC (Q47-Q49)', [
    'How many committee members required?',
    'Minimum bids required?',
    'Finance notification: auto or manual?',
  ]],
  ['Shipping (Q50-Q52)', [
    'All shipments through customs or only international?',
    'Freight forwarder direct system access?',
    'ASN feature active?',
  ]],
  ['Customs (Q53-Q55)', [
    'on_hold procedure?',
    'Direct SABER/FASAH/SADAD integration?',
    'GRN auto-update on delivery \u2014 QCI first?',
  ]],
];

let qNum = 1;
for (const [section, questions] of allQuestions) {
  children.push(h3(section));
  for (const q of questions) {
    children.push(b(`Q${qNum}: ${q}`));
    qNum++;
  }
  children.push(spacer(20));
}

children.push(pageBreak());

// ── CLOSING NOTE ────────────────────────────────────────────────────────
children.push(h1('10. Next Steps'));

children.push(p('Dear NIT Team,', { bold: true }));
children.push(spacer(40));
children.push(p('Thank you for taking the time to review this document. Your feedback is essential for ensuring the system accurately serves your operational needs. Here is how we would like to proceed:'));
children.push(spacer(40));

children.push(h3('Requested Actions'));
children.push(b('1. Review each section and validate that the described workflows match your actual operations'));
children.push(b('2. Answer all 55 questions in the designated response areas'));
children.push(b('3. Identify any processes that are missing or need to be added'));
children.push(b('4. Identify any existing features that are unnecessary and can be removed'));
children.push(b('5. Suggest any modifications to approval levels, roles, or permissions'));
children.push(b('6. Highlight any integrations with external systems (ERP, accounting, government platforms)'));

children.push(spacer(40));
children.push(h3('Timeline'));
children.push(styledTable(
  ['Step', 'Action', 'Expected Duration'],
  [
    ['1', 'NIT team reviews this document', '1 week'],
    ['2', 'Idaratech reviews feedback and clarifies', '3 days'],
    ['3', 'Joint workshop to align on final requirements', '1 day'],
    ['4', 'Updated document (V2) with confirmed requirements', '1 week'],
    ['5', 'Implementation begins based on confirmed requirements', '\u2014'],
  ],
));

children.push(spacer(60));
children.push(p('If you have any questions about this document or need clarification on any section, please do not hesitate to contact us.'));
children.push(spacer(40));
children.push(p('Best regards,'));
children.push(p('Idaratech Software Solutions', { bold: true }));
children.push(spacer(100));

children.push(new Paragraph({
  border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' } },
  spacing: { before: 200 },
  children: [new TextRun({ text: `Document generated on ${new Date().toLocaleString('en-GB')} | Version 1.0 | Classification: Confidential`, size: 14, color: GRAY, italics: true, font: 'Calibri' })],
}));

// ══════════════════════════════════════════════════════════════════════════
// BUILD DOCUMENT
// ══════════════════════════════════════════════════════════════════════════
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 20, color: '334155' },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1200, bottom: 1000, left: 1200, right: 1200 },
      },
    },
    children,
  }],
});

async function main() {
  const buffer = await Packer.toBuffer(doc);
  const outPath = '/Users/a.rahman/Projects/V2/NIT_SCS_V2_Operations_Review.docx';
  fs.writeFileSync(outPath, buffer);
  console.log(`\u2705 Document generated: ${outPath}`);
  console.log(`   Total questions: ${qNum - 1}`);
  console.log(`   Sections: 10 (Intro, Overview, Integration, Warehouse, Transport, Scrap, Shipping, Roles, Questions, Next Steps)`);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
