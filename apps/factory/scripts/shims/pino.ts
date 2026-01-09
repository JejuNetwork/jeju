// Pino logger shim for browser builds
const logger = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  fatal: console.error.bind(console),
  trace: console.trace.bind(console),
  child: () => logger,
  level: 'info',
  levels: {
    values: { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 },
  },
}

export default function pino() {
  return logger
}

export const levels = logger.levels
