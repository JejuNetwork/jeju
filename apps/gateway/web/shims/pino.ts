/**
 * Browser shim for pino logger
 * Provides a minimal console-based logger for browser environments
 */

export const levels = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

const pino = () => ({
  trace: console.trace,
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
  fatal: console.error,
  level: 'info',
  child: () => pino(),
})

export default pino
