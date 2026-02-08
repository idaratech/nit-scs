import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../schemas/auth.schema.js';
import * as authService from '../services/auth.service.js';
import { sendSuccess, sendError } from '../utils/response.js';

const router = Router();

// POST /api/auth/login
router.post('/login', validate(loginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    sendSuccess(res, result);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Invalid')) {
      sendError(res, 401, err.message);
      return;
    }
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', validate(refreshSchema), async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    const tokens = await authService.refreshTokens(refreshToken);
    sendSuccess(res, tokens);
  } catch {
    sendError(res, 401, 'Invalid refresh token');
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getMe(req.user!.userId);
    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/change-password
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;
      await authService.changePassword(req.user!.userId, currentPassword, newPassword);
      sendSuccess(res, { message: 'Password changed successfully' });
    } catch (err) {
      if (err instanceof Error && err.message.includes('incorrect')) {
        sendError(res, 400, err.message);
        return;
      }
      next(err);
    }
  },
);

// POST /api/auth/forgot-password
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      await authService.forgotPassword(email);
      sendSuccess(res, { message: 'If an account with that email exists, a reset code has been sent.' });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/reset-password
router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, code, newPassword } = req.body;
      await authService.resetPassword(email, code, newPassword);
      sendSuccess(res, { message: 'Password has been reset successfully.' });
    } catch (err) {
      if (err instanceof Error && err.message.includes('Invalid or expired')) {
        sendError(res, 400, err.message);
        return;
      }
      next(err);
    }
  },
);

// POST /api/auth/logout (client-side token deletion, server just acknowledges)
router.post('/logout', authenticate, (_req: Request, res: Response) => {
  sendSuccess(res, { message: 'Logged out successfully' });
});

export default router;
