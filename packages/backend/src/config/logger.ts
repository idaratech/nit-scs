import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

/** Backwards-compatible log function for existing callsites */
export function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown) {
  if (data) {
    logger[level]({ data }, message);
  } else {
    logger[level](message);
  }
}
