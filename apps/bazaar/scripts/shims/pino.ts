/**
 * Browser shim for pino
 */

export const levels = {
  values: {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    debug: 20,
    trace: 10,
    silent: Infinity,
  },
  labels: {
    60: 'fatal',
    50: 'error',
    40: 'warn',
    30: 'info',
    20: 'debug',
    10: 'trace',
  },
}

interface PinoLogger {
  level: string
  child: (bindings?: Record<string, unknown>) => PinoLogger
  debug: (msg: unknown, ...args: unknown[]) => void
  info: (msg: unknown, ...args: unknown[]) => void
  warn: (msg: unknown, ...args: unknown[]) => void
  error: (msg: unknown, ...args: unknown[]) => void
  fatal: (msg: unknown, ...args: unknown[]) => void
  trace: (msg: unknown, ...args: unknown[]) => void
}

function createLogger(): PinoLogger {
  const logger: PinoLogger = {
    level: 'info',
    child: () => createLogger(),
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    trace: () => {},
  }
  return logger
}

export function pino(_opts?: unknown): PinoLogger {
  return createLogger()
}

export default pino
