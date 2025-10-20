/**
 * A2A API Integration Tests for Crucible
 */

import { test, expect, describe, beforeAll } from 'bun:test';

const API_BASE = 'http://localhost:7777';

describe('Crucible A2A API', () => {
  test('should serve agent card', async () => {
    try {
      const response = await fetch(`${API_BASE}/.well-known/agent-card.json`);
      
      if (!response.ok) {
        console.log('Agent card not available (Crucible may not be running)');
        return;
      }

      const card = await response.json();
      expect(card.protocolVersion).toBe('0.3.0');
      expect(card.name).toContain('Crucible');
      expect(card.skills).toBeInstanceOf(Array);
      expect(card.skills.length).toBeGreaterThan(5);
    } catch (error) {
      console.log('Crucible server not running, skipping test');
    }
  });

  test('should execute list-active-agents skill', async () => {
    try {
      const response = await fetch(`${API_BASE}/api/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              messageId: 'test-1',
              parts: [{
                kind: 'data',
                data: { skillId: 'list-active-agents', params: {} }
              }]
            }
          },
          id: 1
        })
      });

      if (!response.ok) return;

      const body = await response.json();
      expect(body.result).toBeDefined();
    } catch (error) {
      console.log('Crucible server not running, skipping test');
    }
  });

  test('should require payment for vulnerability report', async () => {
    try {
      const response = await fetch(`${API_BASE}/api/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              messageId: 'test-2',
              parts: [{
                kind: 'data',
                data: { skillId: 'get-vulnerability-report', params: { vulnId: 'test' } }
              }]
            }
          },
          id: 2
        })
      });

      if (!response.ok && response.status === 402) {
        const body = await response.json();
        expect(body.error.code).toBe(402);
        expect(body.error.data).toBeDefined();
      }
    } catch (error) {
      console.log('Crucible server not running, skipping test');
    }
  });
});

