import { z } from 'zod';

// Helper: trim trailing whitespace/newlines that Vercel adds to env vars
const trimmed = z.string().trim();

const envSchema = z.object({
  // Database
  DATABASE_URL: trimmed.url(),

  // Redis — optional in development, recommended in production
  REDIS_URL: trimmed.optional(),

  // JWT — minimum 32 chars for security
  JWT_SECRET: trimmed.min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: trimmed.min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: trimmed.default('15m'),
  JWT_REFRESH_EXPIRES_IN: trimmed.default('7d'),

  // Server
  PORT: z.coerce.number().default(4000),
  NODE_ENV: trimmed.pipe(z.enum(['development', 'production', 'test'])).default('development'),
  CORS_ORIGIN: trimmed.default('http://localhost:3000'),

  // Web Push (VAPID) — optional, auto-generated in development
  VAPID_PUBLIC_KEY: trimmed.optional(),
  VAPID_PRIVATE_KEY: trimmed.optional(),
  VAPID_SUBJECT: trimmed.optional().default('mailto:admin@nit-scs.com'),

  // Email (Resend) — optional in development
  RESEND_API_KEY: trimmed.optional(),
  RESEND_FROM_EMAIL: trimmed.email().optional(),
  RESEND_FROM_NAME: trimmed.optional().default('NIT Logistics'),
  RESEND_WEBHOOK_SECRET: trimmed.optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

// Development-only fallback secrets (random-looking but deterministic for dev)
const DEV_JWT_SECRET = 'nit-scs-dev-only-jwt-secret-2026-do-not-use-in-production!';
const DEV_JWT_REFRESH = 'nit-scs-dev-only-jwt-refresh-2026-do-not-use-in-production!';

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      if (process.env.NODE_ENV?.trim() === 'production') {
        console.error('Environment validation failed:', result.error.format());
        throw new Error('Invalid environment configuration — cannot start in production with invalid env');
      }

      // Development/test fallback
      console.warn('⚠  Using development fallback environment — DO NOT use in production');
      _env = envSchema.parse({
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL || 'postgresql://nit_admin:nit_scs_dev_2026@localhost:5432/nit_scs',
        JWT_SECRET: DEV_JWT_SECRET,
        JWT_REFRESH_SECRET: DEV_JWT_REFRESH,
      });

      return _env;
    }

    _env = result.data;

    // Warn if using the known dev secrets in a non-test environment
    if (_env.NODE_ENV !== 'test') {
      if (_env.JWT_SECRET === DEV_JWT_SECRET || _env.JWT_REFRESH_SECRET === DEV_JWT_REFRESH) {
        console.warn('⚠  WARNING: Using development JWT secrets. Set proper secrets in .env for security.');
      }
    }
  }
  return _env;
}

/** Reset env cache (useful for testing). */
export function resetEnv(): void {
  _env = null;
}
