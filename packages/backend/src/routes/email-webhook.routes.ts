import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { log } from '../config/logger.js';

const router = Router();

/**
 * POST /api/webhooks/resend — Resend delivery webhook
 *
 * Resend sends webhook events for: email.sent, email.delivered,
 * email.delivery_delayed, email.complained, email.bounced, email.opened.
 *
 * This endpoint is public but should be verified via Resend's webhook signature.
 * See: https://resend.com/docs/dashboard/webhooks/introduction
 */
router.post('/resend', async (req, res) => {
  try {
    // TODO: Verify Resend webhook signature (svix) in production
    // const svixId = req.headers['svix-id'];
    // const svixTimestamp = req.headers['svix-timestamp'];
    // const svixSignature = req.headers['svix-signature'];

    const { type, data } = req.body as {
      type: string;
      data: { email_id: string; to: string[] };
    };

    if (!type || !data?.email_id) {
      res.status(400).json({ error: 'Invalid webhook payload' });
      return;
    }

    // Map Resend event types to our status values
    const statusMap: Record<string, string> = {
      'email.sent': 'sent',
      'email.delivered': 'delivered',
      'email.bounced': 'bounced',
      'email.complained': 'bounced',
      'email.delivery_delayed': 'sent', // keep as sent
    };

    const newStatus = statusMap[type];
    if (!newStatus) {
      // Event type we don't track (e.g., email.opened)
      res.json({ received: true });
      return;
    }

    // Update the email log by external ID
    const updated = await prisma.emailLog.updateMany({
      where: { externalId: data.email_id },
      data: {
        status: newStatus,
        ...(newStatus === 'delivered' && { deliveredAt: new Date() }),
      },
    });

    log('info', `[Webhook:Resend] ${type} for ${data.email_id} → ${newStatus} (${updated.count} rows)`);
    res.json({ received: true, updated: updated.count });
  } catch (err) {
    log('error', `[Webhook:Resend] Error: ${err}`);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
