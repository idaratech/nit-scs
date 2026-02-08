import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      sendError(res, 401, 'Authentication required');
      return;
    }

    const userRole = req.user.systemRole;
    if (!allowedRoles.includes(userRole) && userRole !== 'admin') {
      sendError(res, 403, `Access denied. Required roles: ${allowedRoles.join(', ')}`);
      return;
    }

    next();
  };
}

export function requireAnyRole(...allowedRoles: string[]) {
  return requireRole(...allowedRoles);
}
