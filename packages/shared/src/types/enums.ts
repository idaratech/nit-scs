// ── Enums ─────────────────────────────────────────────────────────────────

export enum UserRole {
  ADMIN = 'Admin',
  WAREHOUSE = 'Warehouse Staff',
  TRANSPORT = 'Transport Staff',
  ENGINEER = 'Engineer',
  MANAGER = 'Manager',
  LOGISTICS_COORDINATOR = 'Logistics Coordinator',
  QC_OFFICER = 'QC Officer',
  SITE_ENGINEER = 'Site Engineer',
}

export enum JobStatus {
  NEW = 'New',
  ASSIGNING = 'Assigning',
  QUOTE_REQUESTED = 'Quote Requested',
  QUOTE_RECEIVED = 'Quote Received',
  PENDING_APPROVAL = 'Pending Approval',
  APPROVED = 'Approved',
  IN_PROGRESS = 'In Progress',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled',
}

export type DocumentStatus =
  | 'Draft'
  | 'Pending Approval'
  | 'Approved'
  | 'Rejected'
  | 'Issued'
  | 'Completed'
  | 'Cancelled'
  | 'Inspected'
  | 'Pending QC'
  | 'In Transit'
  | 'Stored';

export type ApprovalAction = 'approve' | 'reject' | 'escalate' | 'return';

export type JOType =
  | 'Transport'
  | 'Equipment'
  | 'Generator_Rental'
  | 'Generator_Maintenance'
  | 'Rental_Monthly'
  | 'Rental_Daily'
  | 'Scrap';
