import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../utils/prisma.js';
import { createAuditLog } from './audit.service.js';
import { emitToRole, emitToDocument } from '../socket/setup.js';
import { log } from '../config/logger.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface RequiredApproval {
  approverRole: string;
  slaHours: number;
}

// ── Lookup required approval level ──────────────────────────────────────

export async function getRequiredApproval(
  documentType: string,
  amount: number,
): Promise<RequiredApproval | null> {
  const workflow = await prisma.approvalWorkflow.findFirst({
    where: {
      documentType,
      minAmount: { lte: amount },
      OR: [
        { maxAmount: null },
        { maxAmount: { gte: amount } },
      ],
    },
    orderBy: { minAmount: 'desc' },
  });

  if (!workflow) return null;

  return {
    approverRole: workflow.approverRole,
    slaHours: workflow.slaHours,
  };
}

// ── Submit document for approval ────────────────────────────────────────

export async function submitForApproval(params: {
  documentType: string;
  documentId: string;
  amount: number;
  submittedById: string;
  io?: SocketIOServer;
}): Promise<RequiredApproval> {
  const { documentType, documentId, amount, submittedById, io } = params;

  const approval = await getRequiredApproval(documentType, amount);

  if (!approval) {
    throw new Error(`No approval workflow configured for ${documentType} with amount ${amount}`);
  }

  // Calculate SLA due date
  const slaDueDate = new Date();
  slaDueDate.setHours(slaDueDate.getHours() + approval.slaHours);

  // Update document status based on type
  const modelName = getModelName(documentType);
  const delegate = getPrismaDelegate(modelName);

  await delegate.update({
    where: { id: documentId },
    data: {
      status: 'pending_approval',
      slaDueDate,
    },
  });

  // Audit log
  await createAuditLog({
    tableName: documentType,
    recordId: documentId,
    action: 'update',
    newValues: {
      status: 'pending_approval',
      slaDueDate: slaDueDate.toISOString(),
      requiredApproverRole: approval.approverRole,
    },
    performedById: submittedById,
  });

  // Socket events
  if (io) {
    emitToRole(io, approval.approverRole, 'approval:requested', {
      documentType,
      documentId,
      amount,
      approverRole: approval.approverRole,
      slaDueDate: slaDueDate.toISOString(),
    });
    emitToDocument(io, documentId, 'document:status', {
      documentType,
      documentId,
      status: 'pending_approval',
    });
  }

  log('info', `[Approval] ${documentType} ${documentId} submitted for approval (role: ${approval.approverRole})`);

  return approval;
}

// ── Process approval or rejection ───────────────────────────────────────

export async function processApproval(params: {
  documentType: string;
  documentId: string;
  action: 'approve' | 'reject';
  processedById: string;
  comments?: string;
  io?: SocketIOServer;
}): Promise<void> {
  const { documentType, documentId, action, processedById, comments, io } = params;

  const modelName = getModelName(documentType);
  const delegate = getPrismaDelegate(modelName);

  if (action === 'approve') {
    await delegate.update({
      where: { id: documentId },
      data: {
        status: 'approved',
        approvedById: processedById,
        approvedDate: new Date(),
      },
    });

    await createAuditLog({
      tableName: documentType,
      recordId: documentId,
      action: 'update',
      newValues: {
        status: 'approved',
        approvedById: processedById,
        comments,
      },
      performedById: processedById,
    });

    if (io) {
      emitToDocument(io, documentId, 'approval:approved', {
        documentType,
        documentId,
        approvedById: processedById,
        comments,
      });
    }

    log('info', `[Approval] ${documentType} ${documentId} approved by ${processedById}`);
  } else {
    await delegate.update({
      where: { id: documentId },
      data: {
        status: 'rejected',
        rejectionReason: comments || 'Rejected',
      },
    });

    await createAuditLog({
      tableName: documentType,
      recordId: documentId,
      action: 'update',
      newValues: {
        status: 'rejected',
        rejectionReason: comments || 'Rejected',
      },
      performedById: processedById,
    });

    if (io) {
      emitToDocument(io, documentId, 'approval:rejected', {
        documentType,
        documentId,
        rejectedById: processedById,
        reason: comments,
      });
    }

    log('info', `[Approval] ${documentType} ${documentId} rejected by ${processedById}`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

type PrismaUpdateDelegate = {
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
};

function getModelName(documentType: string): string {
  const map: Record<string, string> = {
    mirv: 'mirv',
    jo: 'jobOrder',
  };
  return map[documentType] || documentType;
}

function getPrismaDelegate(modelName: string): PrismaUpdateDelegate {
  return (prisma as unknown as Record<string, PrismaUpdateDelegate>)[modelName];
}
