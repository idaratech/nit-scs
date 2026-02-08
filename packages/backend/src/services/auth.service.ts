import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, type JwtPayload } from '../utils/jwt.js';
import { AuthenticationError, NotFoundError, RateLimitError, BusinessRuleError } from '@nit-scs/shared';

export interface LoginResult {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    systemRole: string;
    department: string;
  };
  accessToken: string;
  refreshToken: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const employee = await prisma.employee.findUnique({ where: { email } });
  if (!employee || !employee.passwordHash) {
    throw new AuthenticationError('Invalid email or password');
  }

  if (!employee.isActive) {
    throw new AuthenticationError('Account is deactivated');
  }

  const valid = await comparePassword(password, employee.passwordHash);
  if (!valid) {
    throw new AuthenticationError('Invalid email or password');
  }

  const payload: JwtPayload = {
    userId: employee.id,
    email: employee.email,
    role: employee.role,
    systemRole: employee.systemRole,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  // Update last login
  await prisma.employee.update({
    where: { id: employee.id },
    data: { lastLogin: new Date() },
  });

  return {
    user: {
      id: employee.id,
      email: employee.email,
      fullName: employee.fullName,
      role: employee.role,
      systemRole: employee.systemRole,
      department: employee.department,
    },
    accessToken,
    refreshToken,
  };
}

export async function refreshTokens(token: string): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = verifyRefreshToken(token);

  // Verify user still exists and is active
  const employee = await prisma.employee.findUnique({ where: { id: payload.userId } });
  if (!employee || !employee.isActive) {
    throw new AuthenticationError('User not found or deactivated');
  }

  const newPayload: JwtPayload = {
    userId: employee.id,
    email: employee.email,
    role: employee.role,
    systemRole: employee.systemRole,
  };

  return {
    accessToken: signAccessToken(newPayload),
    refreshToken: signRefreshToken(newPayload),
  };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { id: userId } });
  if (!employee || !employee.passwordHash) {
    throw new NotFoundError('User');
  }

  const valid = await comparePassword(currentPassword, employee.passwordHash);
  if (!valid) {
    throw new BusinessRuleError('Current password is incorrect');
  }

  const newHash = await hashPassword(newPassword);
  await prisma.employee.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });
}

// ── Forgot / Reset Password ─────────────────────────────────────────────

const MAX_RESET_CODES_PER_HOUR = 3;

export async function forgotPassword(email: string): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { email } });

  // Generate code regardless (don't reveal user existence)
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  if (employee) {
    // Rate limit: max 3 reset codes per email per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await prisma.passwordResetCode.count({
      where: {
        email: email.toLowerCase(),
        createdAt: { gte: oneHourAgo },
      },
    });

    if (recentCount >= MAX_RESET_CODES_PER_HOUR) {
      throw new RateLimitError('Too many reset code requests. Please try again later.');
    }

    // Store in database
    await prisma.passwordResetCode.create({
      data: {
        email: email.toLowerCase(),
        code,
        expiresAt,
      },
    });

    // TODO: send email with code — for now it's only stored in DB
  }
}

export async function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
  const entry = await prisma.passwordResetCode.findFirst({
    where: {
      email: email.toLowerCase(),
      code,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!entry) {
    throw new BusinessRuleError('Invalid or expired reset code');
  }

  const employee = await prisma.employee.findUnique({ where: { email } });
  if (!employee) {
    throw new BusinessRuleError('Invalid or expired reset code');
  }

  const newHash = await hashPassword(newPassword);
  await prisma.employee.update({
    where: { id: employee.id },
    data: { passwordHash: newHash },
  });

  // Clean up all reset codes for this email
  await prisma.passwordResetCode.deleteMany({
    where: { email: email.toLowerCase() },
  });
}

export async function getMe(userId: string) {
  const employee = await prisma.employee.findUnique({
    where: { id: userId },
    select: {
      id: true,
      employeeIdNumber: true,
      fullName: true,
      fullNameAr: true,
      email: true,
      phone: true,
      department: true,
      role: true,
      systemRole: true,
      isActive: true,
    },
  });
  if (!employee) throw new NotFoundError('User');
  return employee;
}
