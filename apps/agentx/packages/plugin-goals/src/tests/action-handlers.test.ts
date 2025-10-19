import type { HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { asUUID } from '@elizaos/core';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { completeGoalAction } from '../actions/completeGoal';
import { createGoalAction } from '../actions/createGoal';

describe('Goal Action Handlers', () => {
  let mockRuntime: IAgentRuntime;
  let mockMessage: Memory;
  let mockState: State;
  let mockCallback: HandlerCallback;

  beforeEach(() => {
    mock.restore();

    // Create mock runtime manually
    mockRuntime = {
      agentId: asUUID('12345678-1234-1234-1234-123456789012'),
      character: {
        id: asUUID('12345678-1234-1234-1234-123456789012'),
        name: 'TestAgent',
      },
      useModel: mock(),
      composeState: mock().mockResolvedValue({
        data: { messages: [], entities: [] },
        values: {},
        text: '',
      }),
      getService: mock().mockReturnValue(null),
      getSetting: mock().mockReturnValue(undefined),
    } as unknown as IAgentRuntime;

    // Create mock memory manually
    mockMessage = {
      id: asUUID('12345678-1234-1234-1234-123456789013'),
      entityId: asUUID('12345678-1234-1234-1234-123456789014'),
      roomId: asUUID('12345678-1234-1234-1234-123456789015'),
      agentId: asUUID('12345678-1234-1234-1234-123456789012'),
      content: {
        text: 'test message',
        source: 'test',
      },
      createdAt: Date.now(),
    } as Memory;

    // Create mock state manually
    mockState = {
      data: { messages: [], entities: [] },
      values: {},
      text: '',
    } as State;

    mockCallback = mock().mockResolvedValue([]);
  });

  describe('createGoalAction', () => {
    it('should have correct action properties', () => {
      expect(createGoalAction.name).toBe('CREATE_GOAL');
      expect(createGoalAction.similes).toContain('ADD_GOAL');
      expect(createGoalAction.similes).toContain('NEW_GOAL');
      expect(createGoalAction.description).toBeDefined();
      expect(createGoalAction.examples).toBeDefined();
      expect(createGoalAction.examples).toHaveLength(5);
    });

    it('should validate based on service availability', async () => {
      // Without service, validation should fail
      const result = await createGoalAction.validate(mockRuntime, mockMessage);
      expect(result).toBe(false);
    });

    it('should handle missing database gracefully', async () => {
      // Mock useModel to return invalid XML
      mockRuntime.useModel = mock().mockResolvedValue('Invalid response');

      const result = await createGoalAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(result).toBeDefined();
      expect(typeof result).not.toBe('boolean');

      // Type-safe result checking
      if (result && typeof result === 'object' && 'values' in result && result.values) {
        expect(result.values.success).toBe(false);
        expect(result.values.error).toBe('Goal tracking is not available at the moment.');
      } else {
        throw new Error('Expected result to have values property');
      }
    });
  });

  describe('completeGoalAction', () => {
    it('should have correct action properties', () => {
      expect(completeGoalAction.name).toBe('COMPLETE_GOAL');
      expect(completeGoalAction.similes).toContain('FINISH_GOAL');
      expect(completeGoalAction.similes).toContain('CHECK_OFF_GOAL');
      expect(completeGoalAction.description).toBeDefined();
    });

    it('should validate based on database availability', async () => {
      // Without database, should return false
      const result = await completeGoalAction.validate(mockRuntime, mockMessage);
      expect(result).toBe(false);

      const resultWithDb = await completeGoalAction.validate(mockRuntime, mockMessage);
      expect(resultWithDb).toBe(false); // Still false because no goal data service
    });
  });
});
