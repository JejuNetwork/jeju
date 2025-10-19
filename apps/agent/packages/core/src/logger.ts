import adze from 'adze';
import { Sentry } from './sentry/instrument';

// Local utility function to avoid circular dependency
function parseBooleanFromText(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * Interface representing a log entry.
 */
interface LogEntry {
  time?: number;
  level?: string | number;
  msg?: string;
  message?: string;
  agentName?: string;
  agentId?: string;
  [key: string]: unknown;
}

// Custom in-memory logger class that maintains recent logs
class InMemoryLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  addLog(entry: LogEntry) {
    // Add timestamp if not present
    if (!entry.time) {
      entry.time = Date.now();
    }

    // Filter out service registration logs unless in debug mode
    const isDebugMode = (process?.env?.LOG_LEVEL || '').toLowerCase() === 'debug';

    if (!isDebugMode && entry.agentName && entry.agentId) {
      const msg = entry.msg || entry.message || '';
      if (
        typeof msg === 'string' &&
        (msg.includes('registered successfully') ||
          msg.includes('Registering') ||
          msg.includes('Success:') ||
          msg.includes('linked to') ||
          msg.includes('Started'))
      ) {
        return; // Skip service registration logs
      }
    }

    this.logs.push(entry);

    // Maintain buffer size
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  recentLogs(): LogEntry[] {
    return this.logs;
  }

  clear(): void {
    this.logs = [];
  }
}

// Create global in-memory logger instance
const inMemoryLogger = new InMemoryLogger();

// Custom levels mapping
const customLevels = {
  fatal: 6,
  error: 5,
  warn: 4,
  info: 3,
  log: 3,
  progress: 3,
  success: 3,
  debug: 2,
  trace: 1,
  verbose: 0,
};

// Map adze levels to numeric values for compatibility
const levelValues = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  log: 29,
  progress: 28,
  success: 27,
  debug: 20,
  trace: 10,
  verbose: 0,
};

const raw = parseBooleanFromText(process?.env?.LOG_JSON_FORMAT) || false;
const isDebugMode = (process?.env?.LOG_LEVEL || '').toLowerCase() === 'debug';
const effectiveLogLevel = isDebugMode ? 'debug' : process?.env?.DEFAULT_LOG_LEVEL || 'info';

// Check if user wants timestamps in logs (default: true)
const showTimestamps =
  process?.env?.LOG_TIMESTAMPS !== undefined
    ? parseBooleanFromText(process?.env?.LOG_TIMESTAMPS)
    : true;

// Basic adze setup (no configuration needed for this version)

// Helper function to capture logs to in-memory storage
function captureLogEntry(level: string, args: any[]) {
  const [message, ...context] = args;

  // Create log entry
  const entry: LogEntry = {
    time: Date.now(),
    level: levelValues[level as keyof typeof levelValues] || 30,
    msg: typeof message === 'string' ? message : JSON.stringify(message),
  };

  // Extract context data
  if (context.length > 0) {
    const contextObj = context[0];
    if (typeof contextObj === 'object' && contextObj !== null) {
      Object.assign(entry, contextObj);
    }
  }

  // Add to in-memory logger
  inMemoryLogger.addLog(entry);

  // Capture errors in Sentry if enabled
  if (process.env.SENTRY_LOGGING !== 'false') {
    for (const item of args) {
      if (item instanceof Error) {
        Sentry.captureException(item);
      }
    }
  }
}

// Create the main logger instance with custom methods
class ElizaLogger {
  private context: any;

  constructor(config?: any) {
    this.context = config?.context || {};

    // Bind all standard methods
    this.fatal = this.fatal.bind(this);
    this.error = this.error.bind(this);
    this.warn = this.warn.bind(this);
    this.info = this.info.bind(this);
    this.debug = this.debug.bind(this);
    this.trace = this.trace.bind(this);
    this.verbose = this.verbose.bind(this);
  }

  // Custom level methods
  log(...args: any[]) {
    this.info(...args);
  }

  progress(...args: any[]) {
    this.info('[PROGRESS]', ...args);
  }

  success(...args: any[]) {
    this.info('[SUCCESS]', ...args);
  }

  // Standard adze methods
  fatal(...args: any[]) {
    if (this.isLevelEnabled('fatal')) {
      const formattedArgs = this.formatArgs(args);
      captureLogEntry('fatal', formattedArgs);
      adze.error(formattedArgs[0], ...formattedArgs.slice(1)); // Use error level for fatal
    }
  }

  error(...args: any[]) {
    if (this.isLevelEnabled('error')) {
      const formattedArgs = this.formatArgs(args);
      captureLogEntry('error', formattedArgs);
      adze.error(formattedArgs[0], ...formattedArgs.slice(1));
    }
  }

  warn(...args: any[]) {
    if (this.isLevelEnabled('warn')) {
      const formattedArgs = this.formatArgs(args);
      captureLogEntry('warn', formattedArgs);
      adze.warn(formattedArgs[0], ...formattedArgs.slice(1));
    }
  }

  info(...args: any[]) {
    if (this.isLevelEnabled('info')) {
      const formattedArgs = this.formatArgs(args);
      captureLogEntry('info', formattedArgs);
      adze.info(formattedArgs[0], ...formattedArgs.slice(1));
    }
  }

  debug(...args: any[]) {
    if (this.isLevelEnabled('debug')) {
      const formattedArgs = this.formatArgs(args);
      captureLogEntry('debug', formattedArgs);
      adze.debug(formattedArgs[0], ...formattedArgs.slice(1));
    }
  }

  trace(...args: any[]) {
    if (this.isLevelEnabled('trace')) {
      const formattedArgs = this.formatArgs(args);
      captureLogEntry('trace', formattedArgs);
      adze.verbose(formattedArgs[0], ...formattedArgs.slice(1)); // Use verbose for trace
    }
  }

  verbose(...args: any[]) {
    if (this.isLevelEnabled('verbose')) {
      const formattedArgs = this.formatArgs(args);
      captureLogEntry('verbose', formattedArgs);
      adze.verbose(formattedArgs[0], ...formattedArgs.slice(1));
    }
  }

  // Helper method to format arguments
  private formatArgs(args: any[]): any[] {
    if (args.length === 0) return args;

    const [first, ...rest] = args;

    // Handle Error objects
    if (first instanceof Error) {
      return [`(${first.name}) ${first.message}`, { error: first, stack: first.stack }, ...rest];
    }

    // Handle object as first argument (context)
    if (typeof first === 'object' && first !== null && !(first instanceof Error)) {
      // Combine with message
      const message = rest.filter((arg) => typeof arg === 'string').join(' ');
      return [message || 'Log', first];
    }

    // Add context if available
    if (Object.keys(this.context).length > 0) {
      return [...args, this.context];
    }

    return args;
  }

  // Check if level is enabled
  private isLevelEnabled(level: string): boolean {
    const isDebugMode = (process?.env?.LOG_LEVEL || '').toLowerCase() === 'debug';
    const effectiveLevel = isDebugMode ? 'debug' : process?.env?.DEFAULT_LOG_LEVEL || 'info';
    const currentLevel =
      customLevels[effectiveLevel as keyof typeof customLevels] || customLevels.info;
    const requestedLevel = customLevels[level as keyof typeof customLevels];
    return requestedLevel >= currentLevel;
  }

  // Pino compatibility methods
  child(bindings: any): ElizaLogger {
    const childConfig = {
      context: { ...this.context, ...bindings },
    };
    return new ElizaLogger(childConfig);
  }

  // Add clear method for compatibility
  clear() {
    inMemoryLogger.clear();
  }

  // Pino compatibility properties
  get level() {
    const isDebugMode = (process?.env?.LOG_LEVEL || '').toLowerCase() === 'debug';
    return isDebugMode ? 'debug' : process?.env?.DEFAULT_LOG_LEVEL || 'info';
  }

  set level(newLevel: string) {
    // Note: In adze, we can't change level dynamically per instance
    // This is here for compatibility only
  }

  get levels() {
    return { values: levelValues };
  }

  // Add pino-compatible flush methods
  flush(): Promise<void> {
    return Promise.resolve();
  }

  flushSync(): void {
    // No-op for compatibility
  }
}

// Add symbol for accessing in-memory logger (for compatibility with logging router)
(ElizaLogger.prototype as any)[Symbol.for('pino-destination')] = inMemoryLogger;

// Create logger factory function
const createLogger = (bindings: any | boolean = false) => {
  const config = bindings === true ? {} : { context: bindings || {} };
  const logger = new ElizaLogger(config);

  // Add in-memory logger access
  (logger as any)[Symbol.for('pino-destination')] = inMemoryLogger;

  return logger as any;
};

// Create default logger instance
const logger = createLogger();

// Add in-memory logger access to default logger
(logger as any)[Symbol.for('pino-destination')] = inMemoryLogger;

export { createLogger, logger };

// for backward compatibility
export const elizaLogger = logger;

export default logger;
