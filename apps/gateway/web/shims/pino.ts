/**
 * Pino shim for browser environment
 * Provides a minimal logging interface that works in the browser
 */

const levels = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

type LogLevel = keyof typeof levels

interface Logger {
  level: LogLevel
  trace: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  fatal: (...args: unknown[]) => void
  child: (bindings: Record<string, unknown>) => Logger
}

function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const prefix = bindings.name ? `[${bindings.name}]` : ''

  return {
    level: 'info' as LogLevel,
    trace: (...args) => console.trace(prefix, ...args),
    debug: (...args) => console.debug(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
    fatal: (...args) => console.error(prefix, '[FATAL]', ...args),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  }
}

export default createLogger
export const pino = createLogger
export { levels }
