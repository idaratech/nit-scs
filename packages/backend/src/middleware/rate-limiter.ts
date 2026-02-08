import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function rateLimiter(maxRequests = 100, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();

    const entry = requestCounts.get(key);

    if (!entry || now > entry.resetAt) {
      requestCounts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;

    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      sendError(res, 429, 'Too many requests. Please try again later.');
      return;
    }

    next();
  };
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of requestCounts.entries()) {
    if (now > entry.resetAt) {
      requestCounts.delete(key);
    }
  }
}, 60_000);
