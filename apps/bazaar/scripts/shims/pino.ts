// Browser-safe pino shim for client-side builds
// Provides a minimal console-based logger interface

const noop = () => {}

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

const createLogger = () => ({
  trace: noop,
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  fatal: console.error.bind(console),
  child: () => createLogger(),
  level: 'info',
  isLevelEnabled: () => true,
  levels,
})

export default createLogger
export const pino = createLogger
