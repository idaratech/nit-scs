import jwt, { type SignOptions } from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  systemRole: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'change-me-refresh';

const ACCESS_OPTIONS: SignOptions = { expiresIn: '15m' };
const REFRESH_OPTIONS: SignOptions = { expiresIn: '7d' };

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload as object, JWT_SECRET, ACCESS_OPTIONS);
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload as object, JWT_REFRESH_SECRET, REFRESH_OPTIONS);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as JwtPayload;
}
