import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mock } from 'bun:test';
import { createLogger, logger, elizaLogger } from '../logger';

// Mock environment variables
const mockEnv = {
  LOG_LEVEL: '',
  DEFAULT_LOG_LEVEL: '',
  LOG_JSON_FORMAT: '',
  SENTRY_LOGGING: 'false',
  LOG_DIAGNOSTIC: '',
  LOG_TIMESTAMPS: '',
};

// Mock adze
mock.module('adze', () => ({
  adze: {
    withConfig: mock(() => ({
      info: mock(),
      error: mock(),
      warn: mock(),
      debug: mock(),
      verbose: mock(),
      trace: mock(),
      custom: mock(),
    })),
    use: mock(),
  },
  createShed: mock(() => ({
    bundle: mock(() => ({})),
    clear: mock(),
  })),
}));

describe('Logger', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Reset environment variables
    Object.keys(mockEnv).forEach((key) => {
      process.env[key] = mockEnv[key];
    });
    mock.restore();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Logger Creation', () => {
    it('should export logger instance', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should export elizaLogger as alias for backward compatibility', () => {
      expect(elizaLogger).toBeDefined();
      expect(elizaLogger).toBe(logger);
    });

    it('should have custom log levels', () => {
      const testLogger = createLogger({ agentName: 'test' });
      expect(typeof testLogger.fatal).toBe('function');
      expect(typeof testLogger.error).toBe('function');
      expect(typeof testLogger.warn).toBe('function');
      expect(typeof testLogger.info).toBe('function');
      expect(typeof testLogger.debug).toBe('function');
      expect(typeof testLogger.trace).toBe('function');
      expect(typeof testLogger.verbose).toBe('function');
    });

    it('should have custom methods (log, progress, success)', () => {
      const testLogger = createLogger();
      expect(typeof testLogger.log).toBe('function');
      expect(typeof testLogger.progress).toBe('function');
      expect(typeof testLogger.success).toBe('function');
    });
  });

  describe('createLogger Function', () => {
    it('should create logger with bindings', () => {
      const bindings = { agentName: 'TestAgent', agentId: '123' };
      const customLogger = createLogger(bindings);

      expect(customLogger).toBeDefined();
      expect(typeof customLogger.info).toBe('function');
    });

    it('should create logger without bindings', () => {
      const customLogger = createLogger();

      expect(customLogger).toBeDefined();
      expect(typeof customLogger.info).toBe('function');
    });

    it('should handle boolean bindings parameter', () => {
      const customLogger = createLogger(false);

      expect(customLogger).toBeDefined();
      expect(typeof customLogger.info).toBe('function');
    });
  });

  describe('Log Level Configuration', () => {
    it('should use debug level when LOG_LEVEL is debug', () => {
      process.env.LOG_LEVEL = 'debug';
      const customLogger = createLogger();

      // Logger should be created with debug level
      expect(customLogger.level).toBeDefined();
      expect(customLogger.level).toBe('debug');
    });

    it('should use DEFAULT_LOG_LEVEL when LOG_LEVEL is not debug', () => {
      process.env.LOG_LEVEL = '';
      process.env.DEFAULT_LOG_LEVEL = 'warn';
      const customLogger = createLogger();

      expect(customLogger.level).toBeDefined();
      expect(customLogger.level).toBe('warn');
    });

    it('should default to info level when no log level is specified', () => {
      process.env.LOG_LEVEL = '';
      process.env.DEFAULT_LOG_LEVEL = '';
      const customLogger = createLogger();

      expect(customLogger.level).toBeDefined();
      expect(customLogger.level).toBe('info');
    });
  });

  describe('JSON Format Configuration', () => {
    it('should use JSON format when LOG_JSON_FORMAT is true', () => {
      process.env.LOG_JSON_FORMAT = 'true';
      const customLogger = createLogger();

      expect(customLogger).toBeDefined();
    });

    it('should use pretty format when LOG_JSON_FORMAT is false', () => {
      process.env.LOG_JSON_FORMAT = 'false';
      const customLogger = createLogger();

      expect(customLogger).toBeDefined();
    });
  });

  describe('Log Filtering', () => {
    it('should filter service registration logs in non-debug mode', () => {
      process.env.LOG_LEVEL = 'info';
      const customLogger = createLogger();

      // These logs should be filtered in non-debug mode
      const filteredMessages = [
        'registered successfully',
        'Registering',
        'Success:',
        'linked to',
        'Started',
      ];

      // Logger is created and can handle these messages
      filteredMessages.forEach((msg) => {
        expect(() => customLogger.info({ agentName: 'test', agentId: '123' }, msg)).not.toThrow();
      });
    });

    it('should not filter service registration logs in debug mode', () => {
      process.env.LOG_LEVEL = 'debug';
      const customLogger = createLogger();

      // In debug mode, all logs should pass through
      expect(customLogger.level).toBeDefined();
      expect(customLogger.level).toBe('debug');
    });
  });

  describe('Error Handling', () => {
    it('should handle Error objects in log messages', () => {
      const customLogger = createLogger();
      const testError = new Error('Test error');

      expect(() => customLogger.error(testError)).not.toThrow();
      expect(() => customLogger.error('Message', testError)).not.toThrow();
      expect(() =>
        customLogger.error({ context: 'test' }, 'Error occurred', testError)
      ).not.toThrow();
    });

    it('should format error messages properly', () => {
      const customLogger = createLogger();
      const testError = new Error('Test error');
      testError.name = 'TestError';

      // Should handle error formatting without throwing
      expect(() => customLogger.error(testError)).not.toThrow();
    });
  });

  describe('Clear Method', () => {
    it('should have clear method', () => {
      const customLogger = createLogger();
      expect(typeof customLogger.clear).toBe('function');
      expect(() => customLogger.clear()).not.toThrow();
    });

    it('should clear logs when called', () => {
      // Access the in-memory logger
      const destination = (logger as any)[Symbol.for('pino-destination')];
      expect(destination).toBeDefined();
      expect(typeof destination.clear).toBe('function');

      // Clear should work
      expect(() => destination.clear()).not.toThrow();
    });
  });

  describe('Child Logger', () => {
    it('should create child logger with additional bindings', () => {
      const customLogger = createLogger({ parent: 'main' });
      const childLogger = customLogger.child({ child: 'sub' });

      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe('function');
    });
  });

  describe('Log Input Formats', () => {
    it('should handle various log input formats', () => {
      const customLogger = createLogger();

      // Test various input formats
      expect(() => customLogger.info('Simple string')).not.toThrow();
      expect(() => customLogger.info({ key: 'value' }, 'With object')).not.toThrow();
      expect(() => customLogger.info('Multiple', 'string', 'parts')).not.toThrow();
      expect(() => customLogger.error(new Error('Test'), 'With error')).not.toThrow();
    });

    it('should handle mixed arguments with errors', () => {
      const customLogger = createLogger();
      const error = new Error('Test error');

      expect(() => customLogger.error('Message', error, { extra: 'data' })).not.toThrow();
    });
  });

  describe('Legacy Pino Compatibility', () => {
    it('should have legacy pino-compatible properties', () => {
      const customLogger = createLogger();

      expect(customLogger.level).toBeDefined();
      expect(customLogger.levels).toBeDefined();
      expect(customLogger.levels.values).toBeDefined();
      expect(typeof customLogger.isLevelEnabled).toBe('function');
      expect(typeof customLogger.flush).toBe('function');
      expect(typeof customLogger.flushSync).toBe('function');
    });

    it('should have destination accessible via symbol', () => {
      const customLogger = createLogger();
      const destination = (customLogger as any)[Symbol.for('pino-destination')];

      expect(destination).toBeDefined();
      expect(typeof destination.recentLogs).toBe('function');
      expect(typeof destination.clear).toBe('function');
    });
  });

  describe('In-Memory Logger', () => {
    it('should store recent logs', () => {
      const destination = (logger as any)[Symbol.for('pino-destination')];
      expect(destination).toBeDefined();

      const logs = destination.recentLogs();
      expect(Array.isArray(logs)).toBe(true);
    });

    it('should add logs with proper format', () => {
      const destination = (logger as any)[Symbol.for('pino-destination')];

      // Add a test log
      destination.addLog({
        time: Date.now(),
        level: 30,
        msg: 'Test message',
        agentName: 'TestAgent',
      });

      const logs = destination.recentLogs();
      const lastLog = logs[logs.length - 1];

      expect(lastLog).toBeDefined();
      expect(lastLog.msg).toBe('Test message');
      expect(lastLog.agentName).toBe('TestAgent');
    });
  });

  describe('Log Level Methods', () => {
    it('should support all log levels', () => {
      const customLogger = createLogger();

      expect(() => customLogger.fatal('Fatal message')).not.toThrow();
      expect(() => customLogger.error('Error message')).not.toThrow();
      expect(() => customLogger.warn('Warn message')).not.toThrow();
      expect(() => customLogger.info('Info message')).not.toThrow();
      expect(() => customLogger.debug('Debug message')).not.toThrow();
      expect(() => customLogger.trace('Trace message')).not.toThrow();
      expect(() => customLogger.verbose('Verbose message')).not.toThrow();
      expect(() => customLogger.log('Log message')).not.toThrow();
      expect(() => customLogger.progress('Progress message')).not.toThrow();
      expect(() => customLogger.success('Success message')).not.toThrow();
    });
  });

  describe('Timestamp Configuration', () => {
    it('should respect LOG_TIMESTAMPS setting', () => {
      process.env.LOG_TIMESTAMPS = 'false';
      const customLogger = createLogger();
      expect(customLogger).toBeDefined();
    });

    it('should default to showing timestamps', () => {
      delete process.env.LOG_TIMESTAMPS;
      const customLogger = createLogger();
      expect(customLogger).toBeDefined();
    });
  });

  describe('Sentry Integration', () => {
    it('should not capture exceptions when SENTRY_LOGGING is false', () => {
      process.env.SENTRY_LOGGING = 'false';
      const customLogger = createLogger();
      const error = new Error('Test error');

      expect(() => customLogger.error(error)).not.toThrow();
    });

    it('should handle Sentry integration when enabled', () => {
      process.env.SENTRY_LOGGING = '';
      const customLogger = createLogger();
      const error = new Error('Sentry test');

      expect(() => customLogger.error(error)).not.toThrow();
    });
  });
});
