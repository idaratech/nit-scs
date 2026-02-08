import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { logger } from './config/logger.js';
import { getCorsOptions } from './config/cors.js';
import { getEnv } from './config/env.js';
import { requestId } from './middleware/request-id.js';
import { rateLimiter } from './middleware/rate-limiter.js';
import { errorHandler } from './middleware/error-handler.js';
import { setupSocketIO } from './socket/setup.js';
import authRoutes from './routes/auth.routes.js';
import masterDataRoutes from './routes/master-data.routes.js';
import mrrvRoutes from './routes/mrrv.routes.js';
import mirvRoutes from './routes/mirv.routes.js';
import mrvRoutes from './routes/mrv.routes.js';
import rfimRoutes from './routes/rfim.routes.js';
import osdRoutes from './routes/osd.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import auditRoutes from './routes/audit.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import logisticsRoutes from './routes/logistics.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import permissionsRoutes from './routes/permissions.routes.js';
import taskRoutes from './routes/task.routes.js';
import companyDocumentRoutes from './routes/company-document.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import barcodeRoutes from './routes/barcode.routes.js';
import workflowRoutes from './routes/workflow.routes.js';
import workflowRuleRoutes from './routes/workflow-rule.routes.js';
import { startRuleEngine } from './events/rule-engine.js';
import widgetDataRoutes from './routes/widget-data.routes.js';
import dashboardBuilderRoutes from './routes/dashboard-builder.routes.js';
import savedReportRoutes from './routes/saved-report.routes.js';
import emailTemplateRoutes from './routes/email-template.routes.js';
import emailLogRoutes from './routes/email-log.routes.js';
import emailWebhookRoutes from './routes/email-webhook.routes.js';

dotenv.config({ path: '../../.env' });

// Validate environment on startup (throws in production if vars missing)
getEnv();

const app = express();
const httpServer = createServer(app);

const corsOptions = getCorsOptions();
const io = new SocketIOServer(httpServer, { cors: corsOptions });

// ── Global Middleware ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));
app.use(requestId);
app.use('/api', rateLimiter(200, 60_000));

// ── Health Check ───────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', masterDataRoutes);
app.use('/api/mrrv', mrrvRoutes);
app.use('/api/mirv', mirvRoutes);
app.use('/api/mrv', mrvRoutes);
app.use('/api/rfim', rfimRoutes);
app.use('/api/osd', osdRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', logisticsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/documents', companyDocumentRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/barcodes', barcodeRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/workflows/:workflowId/rules', workflowRuleRoutes);
app.use('/api/widget-data', widgetDataRoutes);
app.use('/api/dashboards', dashboardBuilderRoutes);
app.use('/api/reports/saved', savedReportRoutes);
app.use('/api/email-templates', emailTemplateRoutes);
app.use('/api/email-logs', emailLogRoutes);
app.use('/api/webhooks', emailWebhookRoutes);

// Serve uploaded files
app.use('/uploads', express.static(join(dirname(fileURLToPath(import.meta.url)), '../uploads')));

// ── Socket.IO ──────────────────────────────────────────────────────────
setupSocketIO(io);

// Make io accessible to routes
app.set('io', io);

// ── Error Handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

// ── Production: Serve Frontend ────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const frontendDist = join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('{*path}', (_req, res) => {
    res.sendFile('index.html', { root: frontendDist });
  });
}

// ── Start Server ───────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000', 10);

httpServer.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'NIT Logistics Backend Server started');

  // Start the workflow rule engine after server is listening
  startRuleEngine();
});

// ── Graceful Shutdown ────────────────────────────────────────────────
async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully...`);
  io.close();
  httpServer.close(() => {
    logger.info('HTTP server closed');
    // Prisma disconnect is imported lazily to avoid circular deps
    import('./utils/prisma.js').then(({ prisma }) => {
      prisma.$disconnect().then(() => {
        logger.info('Database disconnected');
        process.exit(0);
      });
    });
  });
  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, io, httpServer };
