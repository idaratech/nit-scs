import type { Server as SocketIOServer } from 'socket.io';
import { createDocumentRouter } from '../utils/document-factory.js';
import { mrfCreateSchema, mrfUpdateSchema } from '../schemas/logistics.schema.js';
import { emitToAll } from '../socket/setup.js';
import * as mrfService from '../services/mrf.service.js';

const WRITE_ROLES = ['admin', 'manager', 'site_engineer', 'warehouse_supervisor'];
const APPROVE_ROLES = ['admin', 'manager', 'warehouse_supervisor'];

export default createDocumentRouter({
  docType: 'mrf',
  tableName: 'material_requisitions',

  list: mrfService.list,
  getById: mrfService.getById,

  createSchema: mrfCreateSchema,
  createRoles: WRITE_ROLES,
  create: (body, userId) => {
    const { lines, ...headerData } = body;
    return mrfService.create(headerData, lines as Record<string, unknown>[], userId);
  },

  updateSchema: mrfUpdateSchema,
  updateRoles: WRITE_ROLES,
  update: mrfService.update,

  actions: [
    {
      path: 'submit',
      roles: WRITE_ROLES,
      handler: id => mrfService.submit(id),
      socketEvent: 'mrf:submitted',
      socketData: () => ({ status: 'submitted' }),
    },
    {
      path: 'review',
      roles: APPROVE_ROLES,
      handler: (id, req) => mrfService.review(id, req.user!.userId),
      socketEvent: 'mrf:under_review',
      socketData: () => ({ status: 'under_review' }),
    },
    {
      path: 'approve',
      roles: APPROVE_ROLES,
      handler: (id, req) => mrfService.approve(id, req.user!.userId),
      socketEvent: 'mrf:approved',
      socketData: () => ({ status: 'approved' }),
    },
    {
      path: 'check-stock',
      roles: APPROVE_ROLES,
      handler: id => mrfService.checkStock(id),
      socketEvent: 'mrf:stock_checked',
      socketData: r => {
        const res = r as { stockResults: unknown };
        return { status: 'checking_stock', stockResults: res.stockResults };
      },
    },
    {
      path: 'convert-mirv',
      roles: APPROVE_ROLES,
      handler: async (id, req) => {
        const { warehouseId } = req.body as { warehouseId?: string };
        const result = await mrfService.convertToMirv(id, req.user!.userId, warehouseId);
        if (result.mirv) {
          const io = req.app.get('io') as SocketIOServer | undefined;
          if (io) {
            emitToAll(io, 'mirv:created', { id: result.mirv.id, mirvNumber: result.mirv.mirvNumber });
            emitToAll(io, 'entity:created', { entity: 'mirv' });
          }
        }
        return result;
      },
      socketEvent: 'mrf:mirv_created',
      socketData: r => {
        const res = r as { status: string; mirv: { id: string; mirvNumber: string } | null };
        return { status: res.status, mirv: res.mirv };
      },
    },
    {
      path: 'fulfill',
      roles: APPROVE_ROLES,
      handler: id => mrfService.fulfill(id),
      socketEvent: 'mrf:fulfilled',
      socketData: () => ({ status: 'fulfilled' }),
    },
    {
      path: 'reject',
      roles: APPROVE_ROLES,
      handler: id => mrfService.reject(id),
      socketEvent: 'mrf:rejected',
      socketData: () => ({ status: 'rejected' }),
    },
    {
      path: 'cancel',
      roles: ['admin', 'manager'],
      handler: id => mrfService.cancel(id),
      socketEvent: 'mrf:cancelled',
      socketData: () => ({ status: 'cancelled' }),
    },
  ],
});
