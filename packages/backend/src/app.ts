// ── Express App (serverless-safe) ────────────────────────────────────────────
// This module creates and configures the Express app WITHOUT starting a server,
// connecting Redis, Socket.IO, or background schedulers.
// Used by: Vercel serverless (api/index.ts) and the traditional server (index.ts).
// ---------------------------------------------------------------------------

// Sentry must be imported before all other modules to properly instrument them
import { Sentry } from './config/sentry.js';

import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import swaggerUi from 'swagger-ui-express';

import { getCorsOptions } from './config/cors.js';
import { getEnv } from './config/env.js';
import { swaggerSpec } from './config/swagger.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { startRuleEngine } from './events/rule-engine.js';
import apiRoutes from './routes/index.js';
import { healthCheck } from './routes/health.routes.js';

// ── Bootstrap ───────────────────────────────────────────────────────────────
dotenv.config({ path: '../../.env' }); // No-op on Vercel (env vars injected by platform)
getEnv(); // Validate environment on startup (throws in production if vars missing)

const app = express();
const corsOptions = getCorsOptions();

// ── Trust proxy (needed for correct IP behind reverse proxy / Vercel) ──────
app.set('trust proxy', 1);

// Socket.IO placeholder — set to null so req.app.get('io') returns null
// instead of undefined. Code using io?.emit() will safely no-op.
// The traditional server (index.ts) overrides this with the real instance.
app.set('io', null);

// ── Global Middleware ─────────────────────────────────────────────────────
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(compression());
app.use(cookieParser());
app.use(sanitizeInput());
app.use(requestId);
// Structured request logging (replaces morgan in production, used alongside in dev)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}
app.use(requestLogger);

// ── Swagger / OpenAPI Docs ─────────────────────────────────────────────────
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'NIT SCS API Docs',
  }),
);
app.get('/api/docs.json', (_req, res) => {
  res.json(swaggerSpec);
});

// ── API Routes (versioned) ────────────────────────────────────────────────
app.use('/api/v1', apiRoutes);

// Backward-compatible redirect: /api/* → /api/v1/*
app.use('/api', (req, res, _next) => {
  // Health check shortcut (no redirect needed)
  if (req.path === '/health') {
    healthCheck(req, res);
    return;
  }
  res.redirect(302, `/api/v1${req.url}`);
});

// ── Sentry Error Handler (captures errors before our handler) ─────────────
if (Sentry.isInitialized()) {
  Sentry.setupExpressErrorHandler(app);
}

// ── Error Handler (must be last middleware) ────────────────────────────────
app.use(errorHandler);

// ── Rule Engine (in-memory event listener — safe for serverless) ──────────
startRuleEngine();

export { app };
