import { Resend } from 'resend';
import Handlebars from 'handlebars';
import { prisma } from '../utils/prisma.js';
import { log } from '../config/logger.js';

// ── Resend Client (lazy init) ───────────────────────────────────────────

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY environment variable is not set');
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

function getFromEmail(): string {
  const name = process.env.RESEND_FROM_NAME || 'NIT Logistics';
  const email = process.env.RESEND_FROM_EMAIL || 'noreply@nit.sa';
  return `${name} <${email}>`;
}

// ── Send Templated Email ────────────────────────────────────────────────

export interface SendTemplatedEmailParams {
  templateCode: string;
  to: string | string[];
  variables?: Record<string, unknown>;
  referenceTable?: string;
  referenceId?: string;
}

/**
 * Send an email using a stored Handlebars template.
 *
 * - `to` can be a direct email, an array of emails, or "role:manager" to resolve
 *   all active employees with that system role.
 * - Creates an EmailLog entry (queued → sent/failed).
 */
export async function sendTemplatedEmail(params: SendTemplatedEmailParams): Promise<void> {
  const { templateCode, variables = {}, referenceTable, referenceId } = params;

  // Resolve template
  const template = await prisma.emailTemplate.findUnique({ where: { code: templateCode } });
  if (!template) {
    log('error', `[Email] Template not found: ${templateCode}`);
    return;
  }
  if (!template.isActive) {
    log('info', `[Email] Template '${templateCode}' is inactive — skipping`);
    return;
  }

  // Resolve recipients
  const recipients = await resolveRecipients(params.to);
  if (recipients.length === 0) {
    log('info', `[Email] No recipients resolved for '${templateCode}'`);
    return;
  }

  // Compile template
  const subjectCompiled = Handlebars.compile(template.subject);
  const bodyCompiled = Handlebars.compile(template.bodyHtml);
  const subject = subjectCompiled(variables);
  const html = bodyCompiled(variables);

  // Send to each recipient
  for (const email of recipients) {
    const emailLog = await prisma.emailLog.create({
      data: {
        templateId: template.id,
        toEmail: email,
        subject,
        status: 'queued',
        referenceTable,
        referenceId,
      },
    });

    try {
      const resend = getResend();
      const result = await resend.emails.send({
        from: getFromEmail(),
        to: email,
        subject,
        html,
      });

      await prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: 'sent',
          externalId: result.data?.id,
          sentAt: new Date(),
        },
      });

      log('info', `[Email] Sent '${templateCode}' to ${email} (id: ${result.data?.id})`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await prisma.emailLog.update({
        where: { id: emailLog.id },
        data: { status: 'failed', error: errorMsg },
      });
      log('error', `[Email] Failed to send '${templateCode}' to ${email}: ${errorMsg}`);
    }
  }
}

/**
 * Process all queued emails (called by the action handler or a scheduled job).
 */
export async function processQueuedEmails(): Promise<number> {
  const queued = await prisma.emailLog.findMany({
    where: { status: 'queued' },
    include: { template: true },
    take: 50,
    orderBy: { createdAt: 'asc' },
  });

  let sent = 0;
  for (const emailLog of queued) {
    if (!emailLog.template) continue;

    try {
      const resend = getResend();
      const result = await resend.emails.send({
        from: getFromEmail(),
        to: emailLog.toEmail,
        subject: emailLog.subject,
        html: emailLog.template.bodyHtml,
      });

      await prisma.emailLog.update({
        where: { id: emailLog.id },
        data: { status: 'sent', externalId: result.data?.id, sentAt: new Date() },
      });
      sent++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await prisma.emailLog.update({
        where: { id: emailLog.id },
        data: { status: 'failed', error: errorMsg },
      });
    }
  }

  return sent;
}

/**
 * Preview a template with sample variables (no email sent).
 */
export function previewTemplate(bodyHtml: string, subject: string, variables: Record<string, unknown>) {
  const subjectCompiled = Handlebars.compile(subject);
  const bodyCompiled = Handlebars.compile(bodyHtml);
  return {
    subject: subjectCompiled(variables),
    html: bodyCompiled(variables),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function resolveRecipients(to: string | string[]): Promise<string[]> {
  if (Array.isArray(to)) return to;

  // Role-based: "role:manager" → all active users with that role
  if (to.startsWith('role:')) {
    const role = to.slice(5);
    const employees = await prisma.employee.findMany({
      where: { systemRole: role, isActive: true },
      select: { email: true },
    });
    return employees.map(e => e.email);
  }

  return [to];
}
