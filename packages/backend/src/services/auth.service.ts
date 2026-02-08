import { prisma } from '../utils/prisma.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, type JwtPayload } from '../utils/jwt.js';

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
    throw new Error('Invalid email or password');
  }

  if (!employee.isActive) {
    throw new Error('Account is deactivated');
  }

  const valid = await comparePassword(password, employee.passwordHash);
  if (!valid) {
    throw new Error('Invalid email or password');
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
    throw new Error('User not found or deactivated');
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
    throw new Error('User not found');
  }

  const valid = await comparePassword(currentPassword, employee.passwordHash);
  if (!valid) {
    throw new Error('Current password is incorrect');
  }

  const newHash = await hashPassword(newPassword);
  await prisma.employee.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });
}

// ── Forgot / Reset Password ─────────────────────────────────────────────

const resetCodes = new Map<string, { code: string; expiresAt: Date }>();

export async function forgotPassword(email: string): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { email } });

  // Generate code regardless (don't reveal user existence)
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  if (employee) {
    resetCodes.set(email.toLowerCase(), { code, expiresAt });
    console.log(`[RESET CODE] ${email}: ${code}`);
  }
}

export async function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
  const entry = resetCodes.get(email.toLowerCase());
  if (!entry) {
    throw new Error('Invalid or expired reset code');
  }

  if (entry.code !== code) {
    throw new Error('Invalid or expired reset code');
  }

  if (new Date() > entry.expiresAt) {
    resetCodes.delete(email.toLowerCase());
    throw new Error('Invalid or expired reset code');
  }

  const employee = await prisma.employee.findUnique({ where: { email } });
  if (!employee) {
    throw new Error('Invalid or expired reset code');
  }

  const newHash = await hashPassword(newPassword);
  await prisma.employee.update({
    where: { id: employee.id },
    data: { passwordHash: newHash },
  });

  resetCodes.delete(email.toLowerCase());
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
  if (!employee) throw new Error('User not found');
  return employee;
}
