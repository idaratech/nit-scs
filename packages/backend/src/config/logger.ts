export function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  switch (level) {
    case 'error':
      console.error(prefix, message, data ?? '');
      break;
    case 'warn':
      console.warn(prefix, message, data ?? '');
      break;
    case 'debug':
      if (process.env.NODE_ENV === 'development') {
        console.debug(prefix, message, data ?? '');
      }
      break;
    default:
      console.log(prefix, message, data ?? '');
  }
}
