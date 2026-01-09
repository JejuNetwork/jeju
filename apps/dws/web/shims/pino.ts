/**
 * Pino shim for browser environments
 * Provides a console-based logger implementation
 */

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

interface Logger {
  level: LogLevel
  fatal: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  trace: (...args: unknown[]) => void
  child: (bindings: Record<string, unknown>) => Logger
}

// Pino log levels (numeric values)
export const levels = {
  values: {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    debug: 20,
    trace: 10,
  },
  labels: {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
  },
}

function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const prefix = bindings.name ? `[${bindings.name}]` : ''

  return {
    level: 'info',
    fatal: (...args) => console.error(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    debug: (...args) => console.debug(prefix, ...args),
    trace: (...args) => console.debug(prefix, ...args),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  }
}

export default function pino(
  _options?: Record<string, unknown>,
  _stream?: unknown,
): Logger {
  return createLogger()
}

export { pino }
