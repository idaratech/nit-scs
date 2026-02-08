import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(10),
  JWT_REFRESH_SECRET: z.string().min(10),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Email (Resend) — optional in development
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  RESEND_FROM_NAME: z.string().optional().default('NIT Logistics'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Environment validation failed:', result.error.format());
      // Use defaults in development
      if (process.env.NODE_ENV !== 'production') {
        _env = envSchema.parse({
          DATABASE_URL: process.env.DATABASE_URL || 'postgresql://nit_admin:nit_scs_dev_2026@localhost:5432/nit_scs',
          JWT_SECRET: process.env.JWT_SECRET || 'nit-scs-dev-jwt-secret-2026',
          JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'nit-scs-dev-jwt-refresh-2026',
          ...process.env,
        });
        return _env;
      }
      throw new Error('Invalid environment configuration');
    }
    _env = result.data;
  }
  return _env;
}
