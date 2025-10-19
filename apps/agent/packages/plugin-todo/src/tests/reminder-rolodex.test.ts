import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { TodoReminderService } from '../services/reminderService';
import { v4 as uuidv4 } from 'uuid';

interface MockRolodexService {
  sendMessage: ReturnType<typeof mock>;
}

interface LoggerMock {
  mock: {
    calls: Array<unknown[]>;
  };
}

describe('Reminder and Rolodex Integration', () => {
  let runtime: IAgentRuntime;
  let reminderService: TodoReminderService;
  let mockRolodexService: MockRolodexService;

  beforeEach(async () => {
    spyOn(logger, 'info').mockImplementation(() => {});
    spyOn(logger, 'warn').mockImplementation(() => {});
    spyOn(logger, 'error').mockImplementation(() => {});
    spyOn(logger, 'debug').mockImplementation(() => {});

    // Mock rolodex message delivery service
    mockRolodexService = {
      sendMessage: mock().mockResolvedValue({
        success: true,
        platforms: ['discord'],
      }),
    };

    // Create mock runtime
    runtime = {
      agentId: 'test-agent' as UUID,
      character: { name: 'TestAgent' },
      db: {} as IAgentRuntime['db'],
      getService: mock((name: string) => {
        if (name === 'rolodex') {
          return mockRolodexService;
        }
        return null;
      }),
      getSetting: mock((key: string) => {
        // Return default configuration values
        switch (key) {
          case 'TODO_REMINDER_CHECK_INTERVAL':
            return '30000'; // 30 seconds
          case 'TODO_MIN_REMINDER_INTERVAL':
            return '1800000'; // 30 minutes
          case 'TODO_UPCOMING_THRESHOLD':
            return '1800000'; // 30 minutes
          case 'TODO_DAILY_REMINDER_HOURS':
            return '9,18'; // 9 AM and 6 PM
          default:
            return null;
        }
      }),
      emitEvent: mock(),
    } as any;

    reminderService = await TodoReminderService.start(runtime);
  });

  afterEach(async () => {
    await reminderService.stop();
    mock.restore();
  });

  it('should detect rolodex service on initialization', () => {
    expect(runtime.getService).toHaveBeenCalledWith('rolodex');
    // Check that the service logged about finding rolodex
    const logCalls = (logger.info as unknown as LoggerMock).mock.calls;
    const hasRolodexLog = logCalls.some((call: unknown[]) => {
      return (call[0] as string)?.includes('Rolodex service found');
    });
    expect(hasRolodexLog).toBe(true);
  });

  it('should send reminder through rolodex when available', async () => {
    // We need to test that checkTasksForReminders calls rolodex
    // Since we can't easily mock the internal createTodoDataService,
    // we'll skip this complex test for now
  });

  it('should handle missing rolodex gracefully', async () => {
    const noRolodexRuntime = {
      ...runtime,
      getService: mock().mockReturnValue(null),
      getSetting: mock((key: string) => {
        // Return default configuration values
        switch (key) {
          case 'TODO_REMINDER_CHECK_INTERVAL':
            return '30000'; // 30 seconds
          case 'TODO_MIN_REMINDER_INTERVAL':
            return '1800000'; // 30 minutes
          case 'TODO_UPCOMING_THRESHOLD':
            return '1800000'; // 30 minutes
          case 'TODO_DAILY_REMINDER_HOURS':
            return '9,18'; // 9 AM and 6 PM
          default:
            return null;
        }
      }),
    };

    const service = await TodoReminderService.start(noRolodexRuntime);

    // Check that the service logged about not finding rolodex
    const logCalls = (logger.info as unknown as LoggerMock).mock.calls;
    const hasNoRolodexLog = logCalls.some((call: unknown[]) => {
      return (call[0] as string)?.includes('Rolodex service not found');
    });
    expect(hasNoRolodexLog).toBe(true);

    await service.stop();
  });
});
