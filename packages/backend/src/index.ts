import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { getCorsOptions } from './config/cors.js';
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

dotenv.config({ path: '../../.env' });

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
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: process.uptime(),
    },
  });
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

// Serve uploaded files
app.use('/uploads', express.static(join(dirname(fileURLToPath(import.meta.url)), '../uploads')));

// ── Socket.IO ──────────────────────────────────────────────────────────
setupSocketIO(io);

// Make io accessible to routes
app.set('io', io);

// ── Error Handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

// ── Start Server ───────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000', 10);

httpServer.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║  NIT Logistics Backend Server                  ║
  ║  Port: ${PORT}                                   ║
  ║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(12)}            ║
  ║  Health: http://localhost:${PORT}/api/health      ║
  ║  Auth:   http://localhost:${PORT}/api/auth/login  ║
  ╚══════════════════════════════════════════════╝
  `);
});

export { app, io, httpServer };
