import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';
import GoalsPlugin from '../index';
import { type IAgentRuntime, logger } from '@elizaos/core';

// Simplified TestSuite implementation for local use
class TestSuite {
  constructor(
    private name: string,
    private config: any
  ) {}

  addTest(test: any) {
    it(test.name, async () => {
      const context = this.config.beforeEach ? this.config.beforeEach() : {};
      await test.fn(context);
    });
  }

  run() {
    // No-op, bun:test handles execution
  }
}

const createUnitTest = (config: { name: string; fn: (context?: any) => Promise<void> | void }) =>
  config;

describe('GoalsPlugin', () => {
  const goalsPluginSuite = new TestSuite('GoalsPlugin', {});

  goalsPluginSuite.addTest(
    createUnitTest({
      name: 'should export GoalsPlugin with correct structure',
      fn: () => {
        expect(GoalsPlugin).toBeDefined();
        expect(GoalsPlugin.name).toBe('goals');
        expect(GoalsPlugin.description).toBe(
          'Provides goal management functionality for tracking and achieving objectives.'
        );
        expect(GoalsPlugin.providers).toHaveLength(1);
        expect(GoalsPlugin.actions).toHaveLength(5); // 5 actions
        expect(GoalsPlugin.services).toHaveLength(1); // 1 service: goal data service
        expect(GoalsPlugin.routes).toBeDefined();
        expect(GoalsPlugin.init).toBeInstanceOf(Function);
      },
    })
  );

  goalsPluginSuite.addTest(
    createUnitTest({
      name: 'should have all required actions',
      fn: () => {
        const actionNames = GoalsPlugin.actions?.map((action) => action.name) || [];
        expect(actionNames).toContain('CREATE_GOAL');
        expect(actionNames).toContain('COMPLETE_GOAL');
        expect(actionNames).toContain('CONFIRM_GOAL');
        expect(actionNames).toContain('UPDATE_GOAL');
        expect(actionNames).toContain('CANCEL_GOAL');
      },
    })
  );

  goalsPluginSuite.addTest(
    createUnitTest({
      name: 'should initialize without errors when database is available',
      fn: async () => {
        const mockRuntime: IAgentRuntime = {
          agentId: 'test-agent' as any,
          db: {
            execute: mock(() => Promise.resolve({ rows: [] })),
          },
        } as any;

        const config = {};

        // Should not throw when database is available
        await expect(GoalsPlugin.init!(config, mockRuntime)).resolves.toBeUndefined();
      },
    })
  );

  goalsPluginSuite.addTest(
    createUnitTest({
      name: 'should handle missing database gracefully',
      fn: async () => {
        const mockRuntime: IAgentRuntime = {
          agentId: 'test-agent' as any,
          db: null, // No database available
        } as any;

        const config = {};

        // Should not throw when no database is available
        await expect(GoalsPlugin.init!(config, mockRuntime)).resolves.toBeUndefined();
      },
    })
  );

  goalsPluginSuite.run();
});
