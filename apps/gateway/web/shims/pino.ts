// Browser shim for pino logger
// Pino is server-only, use console for browser
const createLogger = () => ({
  info: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  debug: (...args: unknown[]) => console.debug(...args),
  trace: (...args: unknown[]) => console.trace(...args),
  fatal: (...args: unknown[]) => console.error(...args),
  child: () => createLogger(),
})

const logger = createLogger()

// Export levels object (used by @walletconnect/logger)
export const levels = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

export default logger
