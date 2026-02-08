import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { ZodSchema } from 'zod';
import { prisma } from './prisma.js';
import { sendSuccess, sendCreated, sendNoContent, sendError } from './response.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { paginate } from '../middleware/pagination.js';
import { validate } from '../middleware/validate.js';
import { createAuditLog } from '../services/audit.service.js';
import { emitToAll } from '../socket/setup.js';
import { clientIp } from './helpers.js';

type PrismaDelegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  findUnique: (args: unknown) => Promise<unknown>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
};

interface CrudConfig {
  modelName: string; // e.g., 'region', 'project'
  tableName: string; // for audit log
  createSchema: ZodSchema;
  updateSchema: ZodSchema;
  searchFields?: string[]; // fields to search with LIKE
  includes?: Record<string, unknown>; // Prisma include for list/get
  defaultSort?: string;
  allowedRoles?: string[]; // if specified, restrict write ops
}

function getDelegate(modelName: string): PrismaDelegate {
  return (prisma as unknown as Record<string, PrismaDelegate>)[modelName];
}

/** Extract entity name from route base URL (e.g. '/api/regions' → 'regions') */
function entityFromUrl(req: Request): string {
  const segments = req.baseUrl.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export function createCrudRouter(config: CrudConfig): Router {
  const router = Router();
  const delegate = getDelegate(config.modelName);

  // GET / - List with pagination, search, sort
  router.get(
    '/',
    authenticate,
    paginate(config.defaultSort || 'id'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { skip, pageSize, sortBy, sortDir, search, page } = req.pagination!;

        const where: Record<string, unknown> = {};
        if (search && config.searchFields?.length) {
          where.OR = config.searchFields.map(f => ({ [f]: { contains: search, mode: 'insensitive' } }));
        }

        // Apply query filters
        for (const [key, value] of Object.entries(req.query)) {
          if (['page', 'pageSize', 'sortBy', 'sortDir', 'search'].includes(key)) continue;
          if (value && typeof value === 'string') {
            where[key] = value;
          }
        }

        const [data, total] = await Promise.all([
          delegate.findMany({
            where,
            orderBy: { [sortBy]: sortDir },
            skip,
            take: pageSize,
            ...(config.includes ? { include: config.includes } : {}),
          }),
          delegate.count({ where }),
        ]);

        sendSuccess(res, data, { page, pageSize, total });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /:id - Get by ID
  router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await delegate.findUnique({
        where: { id: req.params.id as string },
        ...(config.includes ? { include: config.includes } : {}),
      });
      if (!record) {
        sendError(res, 404, 'Record not found');
        return;
      }
      sendSuccess(res, record);
    } catch (err) {
      next(err);
    }
  });

  // Build write middleware chain (authenticate + optional RBAC)
  const writeMw = config.allowedRoles?.length ? [authenticate, requireRole(...config.allowedRoles)] : [authenticate];

  // POST / - Create
  router.post(
    '/',
    ...writeMw,
    validate(config.createSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const record = (await delegate.create({ data: req.body })) as { id: string };

        await createAuditLog({
          tableName: config.tableName,
          recordId: record.id,
          action: 'create',
          newValues: req.body,
          performedById: req.user!.userId,
          ipAddress: clientIp(req),
        });

        const io = req.app.get('io') as SocketIOServer | undefined;
        if (io) {
          emitToAll(io, 'entity:created', { entity: entityFromUrl(req) });
        }

        sendCreated(res, record);
      } catch (err) {
        next(err);
      }
    },
  );

  // PUT /:id - Update
  router.put(
    '/:id',
    ...writeMw,
    validate(config.updateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const old = await delegate.findUnique({ where: { id: req.params.id as string } });
        if (!old) {
          sendError(res, 404, 'Record not found');
          return;
        }

        const record = await delegate.update({
          where: { id: req.params.id as string },
          data: req.body,
        });

        await createAuditLog({
          tableName: config.tableName,
          recordId: req.params.id as string,
          action: 'update',
          oldValues: old as Record<string, unknown>,
          newValues: req.body,
          performedById: req.user!.userId,
          ipAddress: clientIp(req),
        });

        const io = req.app.get('io') as SocketIOServer | undefined;
        if (io) {
          emitToAll(io, 'entity:updated', { entity: entityFromUrl(req) });
        }

        sendSuccess(res, record);
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE /:id - Delete
  router.delete('/:id', ...writeMw, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await delegate.delete({ where: { id: req.params.id as string } });

      await createAuditLog({
        tableName: config.tableName,
        recordId: req.params.id as string,
        action: 'delete',
        performedById: req.user!.userId,
        ipAddress: clientIp(req),
      });

      const io = req.app.get('io') as SocketIOServer | undefined;
      if (io) {
        emitToAll(io, 'entity:deleted', { entity: entityFromUrl(req) });
      }

      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
