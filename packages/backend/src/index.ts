// ── Traditional Server Entry Point ───────────────────────────────────────────
// Imports the Express app from app.ts and adds server-only concerns:
// Socket.IO, Redis, background scheduler, .listen(), and graceful shutdown.
// For Vercel serverless, only app.ts is imported (via api/index.ts).
// ---------------------------------------------------------------------------

import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

import { app } from './app.js';
import { logger } from './config/logger.js';
import { getCorsOptions } from './config/cors.js';
import { getRedis, disconnectRedis } from './config/redis.js';
import { setupSocketIO } from './socket/setup.js';
import { startScheduler, stopScheduler } from './services/scheduler.service.js';

const httpServer = createServer(app);
const corsOptions = getCorsOptions();
const io = new SocketIOServer(httpServer, { cors: corsOptions });

// ── Socket.IO ─────────────────────────────────────────────────────────────
setupSocketIO(io);
app.set('io', io); // Override the null placeholder from app.ts

// ── Production: Serve Frontend SPA ────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const frontendDist = join(currentDir, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('{*path}', (_req, res) => {
    res.sendFile('index.html', { root: frontendDist });
  });
}

// ── Initialise Redis (non-blocking) ───────────────────────────────────────
getRedis(); // Starts connection attempt; failures are non-fatal in dev

// ── Start Server ──────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000', 10);

httpServer.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'NIT-SCS Backend started');
  startScheduler(io);
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────
async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully...`);

  stopScheduler();
  io.close();
  httpServer.close(async () => {
    logger.info('HTTP server closed');
    try {
      await disconnectRedis();
      const { prisma } = await import('./utils/prisma.js');
      await prisma.$disconnect();
      logger.info('All connections closed');
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
    }
    process.exit(0);
  });

  // Force exit after 10 s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, io, httpServer };
