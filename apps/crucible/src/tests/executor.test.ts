/**
 * Executor SDK Tests - Action Parsing and Execution Logic
 */

import { describe, it, expect } from 'bun:test';

describe('Executor Logic', () => {
  describe('Action Parsing', () => {
    // Test the action parsing regex
    function parseActions(response: string): Array<{ type: string; params?: Record<string, unknown> }> {
      const actions: Array<{ type: string; params?: Record<string, unknown> }> = [];
      const actionRegex = /\[ACTION:\s*(\w+)(?:\s*\|\s*(.+?))?\]/g;
      
      let match;
      while ((match = actionRegex.exec(response)) !== null) {
        const params: Record<string, unknown> = {};
        if (match[2]) {
          const pairs = match[2].split(',');
          for (const pair of pairs) {
            const [key, value] = pair.split('=').map(s => s?.trim());
            if (key && value) {
              params[key] = value;
            }
          }
        }
        actions.push({
          type: match[1] ?? 'unknown',
          params: Object.keys(params).length > 0 ? params : undefined,
        });
      }
      
      return actions;
    }

    it('should parse single action', () => {
      const response = 'I will help you [ACTION: POST_TO_ROOM | content=Hello]';
      const actions = parseActions(response);
      
      expect(actions.length).toBe(1);
      expect(actions[0].type).toBe('POST_TO_ROOM');
      expect(actions[0].params?.content).toBe('Hello');
    });

    it('should parse multiple actions', () => {
      const response = `
        First I'll remember this [ACTION: REMEMBER | content=Important fact]
        Then I'll post [ACTION: POST_TO_ROOM | content=Update]
        Finally update score [ACTION: UPDATE_SCORE | delta=10]
      `;
      const actions = parseActions(response);
      
      expect(actions.length).toBe(3);
      expect(actions[0].type).toBe('REMEMBER');
      expect(actions[1].type).toBe('POST_TO_ROOM');
      expect(actions[2].type).toBe('UPDATE_SCORE');
    });

    it('should parse action without parameters', () => {
      const response = '[ACTION: NOOP]';
      const actions = parseActions(response);
      
      expect(actions.length).toBe(1);
      expect(actions[0].type).toBe('NOOP');
      expect(actions[0].params).toBeUndefined();
    });

    it('should parse action with multiple parameters', () => {
      const response = '[ACTION: COMPLEX | param1=value1, param2=value2, param3=value3]';
      const actions = parseActions(response);
      
      expect(actions.length).toBe(1);
      expect(actions[0].params?.param1).toBe('value1');
      expect(actions[0].params?.param2).toBe('value2');
      expect(actions[0].params?.param3).toBe('value3');
    });

    it('should handle response with no actions', () => {
      const response = 'This is just a regular response with no special formatting.';
      const actions = parseActions(response);
      
      expect(actions.length).toBe(0);
    });

    it('should handle malformed action tags', () => {
      const response = '[ACTION:] [ACTION] [ACTION: | param=value]';
      const actions = parseActions(response);
      
      // Should not match malformed tags
      expect(actions.length).toBe(0);
    });

    it('should handle whitespace variations', () => {
      const response = '[ACTION:REMEMBER|content=test] [ACTION:  POST_TO_ROOM  |  content = test2  ]';
      const actions = parseActions(response);
      
      expect(actions.length).toBe(2);
      expect(actions[0].type).toBe('REMEMBER');
      expect(actions[1].type).toBe('POST_TO_ROOM');
    });
  });

  describe('State Updates', () => {
    function buildStateUpdates(
      response: string,
      actions: Array<{ type: string; success: boolean }>,
    ): Record<string, unknown> {
      return {
        lastResponse: response,
        lastActions: actions,
        actionSuccessRate: actions.filter(a => a.success).length / Math.max(actions.length, 1),
      };
    }

    it('should calculate 100% success rate', () => {
      const updates = buildStateUpdates('Response', [
        { type: 'A', success: true },
        { type: 'B', success: true },
      ]);
      expect(updates.actionSuccessRate).toBe(1);
    });

    it('should calculate 50% success rate', () => {
      const updates = buildStateUpdates('Response', [
        { type: 'A', success: true },
        { type: 'B', success: false },
      ]);
      expect(updates.actionSuccessRate).toBe(0.5);
    });

    it('should calculate 0% success rate', () => {
      const updates = buildStateUpdates('Response', [
        { type: 'A', success: false },
        { type: 'B', success: false },
      ]);
      expect(updates.actionSuccessRate).toBe(0);
    });

    it('should handle empty actions array', () => {
      const updates = buildStateUpdates('Response', []);
      expect(updates.actionSuccessRate).toBe(0);
    });
  });

  describe('Cost Estimation', () => {
    function estimateExecutionCost(maxTokens: number = 2048): bigint {
      const baseCost = 100000000000000n;
      const tokenCost = BigInt(maxTokens) * 1000000000n;
      return baseCost + tokenCost;
    }

    it('should estimate default cost', () => {
      const cost = estimateExecutionCost();
      expect(cost).toBe(100000000000000n + 2048n * 1000000000n);
    });

    it('should estimate cost with custom tokens', () => {
      const cost = estimateExecutionCost(1000);
      expect(cost).toBe(100000000000000n + 1000n * 1000000000n);
    });

    it('should estimate minimum cost', () => {
      const cost = estimateExecutionCost(1);
      expect(cost).toBe(100000000000000n + 1000000000n);
    });
  });

  describe('Trigger Type Conversion', () => {
    function numberToTriggerType(num: number): 'cron' | 'webhook' | 'event' | 'room_message' {
      const map: ('cron' | 'webhook' | 'event' | 'room_message')[] = ['cron', 'webhook', 'event', 'room_message'];
      return map[num] ?? 'cron';
    }

    it('should convert 0 to cron', () => {
      expect(numberToTriggerType(0)).toBe('cron');
    });

    it('should convert 1 to webhook', () => {
      expect(numberToTriggerType(1)).toBe('webhook');
    });

    it('should convert 2 to event', () => {
      expect(numberToTriggerType(2)).toBe('event');
    });

    it('should convert 3 to room_message', () => {
      expect(numberToTriggerType(3)).toBe('room_message');
    });

    it('should default to cron for invalid number', () => {
      expect(numberToTriggerType(99)).toBe('cron');
      expect(numberToTriggerType(-1)).toBe('cron');
    });
  });

  describe('Trigger Endpoint Parsing', () => {
    function parseAgentIdFromEndpoint(endpoint: string): bigint | null {
      const match = endpoint.match(/agent:\/\/(\d+)/);
      if (!match) return null;
      return BigInt(match[1] ?? '0');
    }

    it('should parse valid agent endpoint', () => {
      const agentId = parseAgentIdFromEndpoint('agent://123');
      expect(agentId).toBe(123n);
    });

    it('should parse large agent ID', () => {
      const agentId = parseAgentIdFromEndpoint('agent://999999999999999');
      expect(agentId).toBe(999999999999999n);
    });

    it('should return null for invalid endpoint', () => {
      expect(parseAgentIdFromEndpoint('http://example.com')).toBeNull();
      expect(parseAgentIdFromEndpoint('agent://')).toBeNull();
      expect(parseAgentIdFromEndpoint('')).toBeNull();
    });

    it('should handle endpoint with path', () => {
      const agentId = parseAgentIdFromEndpoint('agent://456/execute');
      expect(agentId).toBe(456n);
    });
  });
});

describe('Cron Parser', () => {
  function parseCronExpression(cron: string): { minute: number; hour: number; dayOfMonth: number; month: number; dayOfWeek: number } | null {
    const parts = cron.split(' ');
    if (parts.length !== 5) return null;

    const parseField = (field: string): number => {
      if (field === '*') return -1;
      return parseInt(field, 10);
    };

    return {
      minute: parseField(parts[0]!),
      hour: parseField(parts[1]!),
      dayOfMonth: parseField(parts[2]!),
      month: parseField(parts[3]!),
      dayOfWeek: parseField(parts[4]!),
    };
  }

  it('should parse every minute cron', () => {
    const cron = parseCronExpression('* * * * *');
    expect(cron?.minute).toBe(-1);
    expect(cron?.hour).toBe(-1);
    expect(cron?.dayOfMonth).toBe(-1);
    expect(cron?.month).toBe(-1);
    expect(cron?.dayOfWeek).toBe(-1);
  });

  it('should parse specific time cron', () => {
    const cron = parseCronExpression('30 9 * * *');
    expect(cron?.minute).toBe(30);
    expect(cron?.hour).toBe(9);
  });

  it('should parse weekday cron', () => {
    const cron = parseCronExpression('0 9 * * 1');
    expect(cron?.minute).toBe(0);
    expect(cron?.hour).toBe(9);
    expect(cron?.dayOfWeek).toBe(1);
  });

  it('should return null for invalid cron', () => {
    expect(parseCronExpression('')).toBeNull();
    expect(parseCronExpression('* * *')).toBeNull();
    expect(parseCronExpression('* * * * * *')).toBeNull();
  });
});
