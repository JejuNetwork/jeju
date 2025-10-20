/**
 * @fileoverview AGGRESSIVE tests for logger utility
 * @module scripts/shared/logger.test
 * 
 * These tests VERIFY actual behavior, not just "doesn't throw".
 * Every test checks REAL output and FAILS if broken.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Logger } from './logger';

describe('Logger - AGGRESSIVE BEHAVIORAL TESTS', () => {
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let loggedMessages: string[];
  let warnedMessages: string[];
  let erroredMessages: string[];

  beforeEach(() => {
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    
    loggedMessages = [];
    warnedMessages = [];
    erroredMessages = [];
    
    console.log = mock((...args: any[]) => {
      loggedMessages.push(args.join(' '));
    });
    console.warn = mock((...args: any[]) => {
      warnedMessages.push(args.join(' '));
    });
    console.error = mock((...args: any[]) => {
      erroredMessages.push(args.join(' '));
    });
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  describe('Basic Logging - VERIFY OUTPUT', () => {
    it('should log info with info emoji', () => {
      const logger = new Logger({ timestamp: false });
      logger.info('Test message');
      
      // ASSERT: Actually logged
      expect(loggedMessages.length).toBe(1);
      
      // ASSERT: Contains info emoji
      expect(loggedMessages[0]).toContain('ℹ️');
      expect(loggedMessages[0]).toContain('Test message');
    });

    it('should log success with success emoji', () => {
      const logger = new Logger({ timestamp: false });
      logger.success('Operation completed');
      
      // ASSERT: Actually logged
      expect(loggedMessages.length).toBe(1);
      
      // ASSERT: Contains success emoji
      expect(loggedMessages[0]).toContain('✅');
      expect(loggedMessages[0]).toContain('Operation completed');
    });

    it('should warn with warning emoji to console.warn', () => {
      const logger = new Logger({ timestamp: false });
      logger.warn('Warning message');
      
      // ASSERT: Used console.warn, not console.log
      expect(warnedMessages.length).toBe(1);
      expect(loggedMessages.length).toBe(0);
      
      // ASSERT: Contains warning emoji
      expect(warnedMessages[0]).toContain('⚠️');
      expect(warnedMessages[0]).toContain('Warning message');
    });

    it('should error with error emoji to console.error', () => {
      const logger = new Logger({ timestamp: false });
      logger.error('Error message');
      
      // ASSERT: Used console.error, not console.log
      expect(erroredMessages.length).toBe(1);
      expect(loggedMessages.length).toBe(0);
      
      // ASSERT: Contains error emoji
      expect(erroredMessages[0]).toContain('❌');
      expect(erroredMessages[0]).toContain('Error message');
    });
  });

  describe('Log Level Filtering - MUST ACTUALLY FILTER', () => {
    it('should NOT log debug when level is info', () => {
      const logger = new Logger({ level: 'info', timestamp: false });
      
      logger.debug('Debug message');
      
      // ASSERT: Nothing logged
      expect(loggedMessages.length).toBe(0);
      expect(warnedMessages.length).toBe(0);
      expect(erroredMessages.length).toBe(0);
    });

    it('should log info when level is info', () => {
      const logger = new Logger({ level: 'info', timestamp: false });
      
      logger.info('Info message');
      
      // ASSERT: Message logged
      expect(loggedMessages.length).toBe(1);
    });

    it('should NOT log info when level is warn', () => {
      const logger = new Logger({ level: 'warn', timestamp: false });
      
      logger.info('Info message');
      logger.debug('Debug message');
      
      // ASSERT: Nothing logged
      expect(loggedMessages.length).toBe(0);
    });

    it('should ONLY log errors when level is error', () => {
      const logger = new Logger({ level: 'error', timestamp: false });
      
      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warning');
      logger.error('Error');
      
      // ASSERT: Only error was logged
      expect(loggedMessages.length).toBe(0);
      expect(warnedMessages.length).toBe(0);
      expect(erroredMessages.length).toBe(1);
    });
  });

  describe('Prefix Support - VERIFY ACTUAL PREFIX', () => {
    it('should include prefix in output', () => {
      const logger = new Logger({ prefix: 'TEST-PREFIX', timestamp: false });
      logger.info('Message');
      
      // ASSERT: Prefix is in output
      expect(loggedMessages[0]).toContain('[TEST-PREFIX]');
      expect(loggedMessages[0]).toContain('Message');
    });

    it('should support nested prefixes via child logger', () => {
      const logger = new Logger({ prefix: 'PARENT', timestamp: false });
      const child = logger.child('CHILD');
      
      child.info('Child message');
      
      // ASSERT: Combined prefix format [PARENT:CHILD]
      expect(loggedMessages[0]).toContain('[PARENT:CHILD]');
      expect(loggedMessages[0]).toContain('Child message');
      
      // ASSERT: Has info emoji
      expect(loggedMessages[0]).toContain('ℹ️');
    });
  });

  describe('Timestamp Support - VERIFY FORMAT', () => {
    it('should include ISO timestamp when enabled', () => {
      const logger = new Logger({ timestamp: true });
      logger.info('Message');
      
      // ASSERT: Contains ISO 8601 timestamp
      expect(loggedMessages[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    it('should NOT include timestamp when disabled', () => {
      const logger = new Logger({ timestamp: false });
      logger.info('Message');
      
      // ASSERT: No timestamp pattern
      expect(loggedMessages[0]).not.toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('Helper Methods - VERIFY ACTUAL OUTPUT', () => {
    it('should create separator of exact length', () => {
      const logger = new Logger({ timestamp: false });
      logger.separator('=', 60);
      
      // ASSERT: Exact length
      expect(loggedMessages[0]).toBe('='.repeat(60));
    });

    it('should create box with borders', () => {
      const logger = new Logger({ timestamp: false });
      logger.box('Test\nMessage');
      
      // ASSERT: Three lines (top, content, bottom)
      expect(loggedMessages.length).toBe(4); // Top, 2 content lines, bottom
      
      // ASSERT: Has box characters
      expect(loggedMessages[0]).toContain('╔');
      expect(loggedMessages[0]).toContain('╗');
    });
  });

  describe('Additional Arguments - VERIFY PASSED THROUGH', () => {
    it('should pass additional arguments to console', () => {
      const logger = new Logger({ timestamp: false });
      const data = { key: 'value' };
      
      logger.info('Message', data);
      
      // ASSERT: Called with multiple arguments
      expect(console.log).toHaveBeenCalled();
      const calls = (console.log as any).mock.calls;
      expect(calls[0].length).toBeGreaterThan(1);
    });
  });

  describe('Color Codes - VERIFY APPLIED', () => {
    it('should apply color codes to output', () => {
      const logger = new Logger({ timestamp: false });
      
      logger.info('Info');
      // ASSERT: Contains ANSI color codes
      expect(loggedMessages[0]).toContain('\x1b[');
      
      logger.success('Success');
      // ASSERT: Contains reset code
      expect(loggedMessages[1]).toContain('\x1b[0m');
    });
  });
});
