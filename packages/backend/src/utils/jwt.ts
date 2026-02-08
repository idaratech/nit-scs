import jwt, { type SignOptions } from 'jsonwebtoken';
import { getEnv } from '../config/env.js';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  systemRole: string;
}

function getSecrets() {
  const env = getEnv();
  return { secret: env.JWT_SECRET, refreshSecret: env.JWT_REFRESH_SECRET };
}

const ACCESS_OPTIONS: SignOptions = { expiresIn: '15m' };
const REFRESH_OPTIONS: SignOptions = { expiresIn: '7d' };

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload as object, getSecrets().secret, ACCESS_OPTIONS);
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload as object, getSecrets().refreshSecret, REFRESH_OPTIONS);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, getSecrets().secret) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, getSecrets().refreshSecret) as JwtPayload;
}
