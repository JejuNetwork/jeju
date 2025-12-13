/**
 * Concurrent & Async Behavior Tests
 * 
 * Tests race conditions, parallel execution, and async handling.
 */

import { test, expect } from '@playwright/test';

const COUNCIL_URL = 'http://localhost:8010';

const sendA2A = async (
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  skillId: string,
  params?: Record<string, unknown>
) => {
  const response = await request.post(`${COUNCIL_URL}/a2a`, {
    data: {
      jsonrpc: '2.0',
      id: Date.now() + Math.random(),
      method: 'message/send',
      params: {
        message: {
          messageId: `conc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          parts: [{ kind: 'data', data: { skillId, params: params ?? {} } }]
        }
      }
    }
  });
  return response.json();
};

test.describe('Parallel Request Handling', () => {
  test('handles 20 concurrent health checks', async ({ request }) => {
    const requests = Array.from({ length: 20 }, () => 
      request.get(`${COUNCIL_URL}/health`)
    );
    
    const responses = await Promise.all(requests);
    
    // All should succeed
    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.status).toBe('ok');
    }
  });

  test('handles 10 concurrent A2A requests', async ({ request }) => {
    const requests = Array.from({ length: 10 }, (_, i) => 
      sendA2A(request, 'get-governance-stats')
    );
    
    const results = await Promise.all(requests);
    
    // All should return valid data
    for (const result of results) {
      expect(result.result).toBeDefined();
      const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
      expect(data.totalProposals).toBeDefined();
    }
  });

  test('handles mixed concurrent operations', async ({ request }) => {
    const operations = [
      sendA2A(request, 'get-governance-stats'),
      sendA2A(request, 'get-council-status'),
      sendA2A(request, 'get-ceo-status'),
      request.get(`${COUNCIL_URL}/health`),
      request.post(`${COUNCIL_URL}/mcp/tools/list`),
      sendA2A(request, 'assess-proposal', {
        title: 'Concurrent Test',
        summary: 'Testing concurrent operations',
        description: 'This proposal is used for concurrency testing.'
      }),
    ];
    
    const results = await Promise.all(operations);
    
    // All should complete without errors
    expect(results.length).toBe(6);
    for (const result of results) {
      // Each result should be defined (either Response or JSON)
      expect(result).toBeDefined();
    }
  });

  test('parallel deliberations do not interfere', async ({ request }) => {
    // Start 2 deliberations simultaneously (reduced for stability with LLM)
    const proposals = Array.from({ length: 2 }, (_, i) => ({
      proposalId: `PARALLEL-${Date.now()}-${i}`,
      title: `Parallel Test Proposal ${i}`,
      description: `Testing parallel deliberation ${i}`,
      proposalType: 'GENERAL',
      submitter: `0x${i}${i}${i}`
    }));
    
    const deliberations = proposals.map(p => sendA2A(request, 'deliberate', p));
    const results = await Promise.all(deliberations);
    
    // Each should return a result (either votes if Ollama is up, or error if not)
    for (let i = 0; i < results.length; i++) {
      expect(results[i].result).toBeDefined();
      const data = results[i].result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
      expect(data).toBeDefined();
      
      // If Ollama is unavailable, we get an error; otherwise we get votes
      if (data.error) {
        expect(data.error).toContain('Ollama');
      } else {
        expect(data.proposalId).toBe(proposals[i].proposalId);
        expect(data.votes).toBeDefined();
        expect(data.votes.length).toBe(5);
      }
    }
  });
});

test.describe('Rapid Sequential Requests', () => {
  test('handles 50 rapid sequential A2A calls', async ({ request }) => {
    const results: unknown[] = [];
    
    for (let i = 0; i < 50; i++) {
      const result = await sendA2A(request, 'get-council-status');
      results.push(result);
    }
    
    // All should succeed
    expect(results.length).toBe(50);
    for (const result of results as Array<{ result: { parts: Array<{ kind: string; data: unknown }> } }>) {
      expect(result.result).toBeDefined();
    }
  });

  test('vote submissions in rapid succession', async ({ request }) => {
    const baseProposalId = `RAPID-VOTE-${Date.now()}`;
    const agents = ['treasury', 'code', 'community', 'security', 'legal'];
    
    // Submit votes as fast as possible
    for (let i = 0; i < 20; i++) {
      const agent = agents[i % agents.length];
      const vote = i % 3 === 0 ? 'APPROVE' : i % 3 === 1 ? 'REJECT' : 'ABSTAIN';
      
      const result = await sendA2A(request, 'submit-vote', {
        proposalId: `${baseProposalId}-${i}`,
        agentId: agent,
        vote,
        reasoning: `Rapid vote ${i}`,
        confidence: 50 + (i % 50)
      });
      
      expect(result.result).toBeDefined();
    }
  });

  test('alternating read/write operations', async ({ request }) => {
    const proposalId = `RW-${Date.now()}`;
    
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        // Write operation
        await sendA2A(request, 'add-commentary', {
          proposalId,
          content: `Comment ${i}`,
          sentiment: 'neutral'
        });
      } else {
        // Read operation
        await sendA2A(request, 'get-governance-stats');
      }
    }
    
    // Final read should work
    const result = await sendA2A(request, 'get-governance-stats');
    expect(result.result).toBeDefined();
  });
});

test.describe('Timeout & Long-Running Operations', () => {
  test('deliberation completes within reasonable time', async ({ request }) => {
    const startTime = Date.now();
    
    const result = await sendA2A(request, 'deliberate', {
      proposalId: `TIMING-${Date.now()}`,
      title: 'Timing Test Proposal',
      description: 'Testing that deliberation completes in reasonable time.',
      proposalType: 'GENERAL',
      submitter: '0x1234'
    });
    
    const duration = Date.now() - startTime;
    
    expect(result.result).toBeDefined();
    // Should complete within 2 minutes (LLM can be slow with 5 agent calls)
    expect(duration).toBeLessThan(120000);
    
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    // Either we get votes (Ollama available) or error (Ollama unavailable)
    if (data.error) {
      expect(data.error).toContain('Ollama');
    } else {
      expect(data.votes.length).toBe(5);
    }
  });

  test('assess-proposal with large content completes', async ({ request }) => {
    const largeDescription = 'X'.repeat(10000);
    const startTime = Date.now();
    
    const result = await sendA2A(request, 'assess-proposal', {
      title: 'Large Content Test',
      summary: 'A'.repeat(500),
      description: largeDescription
    });
    
    const duration = Date.now() - startTime;
    
    expect(result.result).toBeDefined();
    // Should still complete quickly even with large content
    expect(duration).toBeLessThan(5000);
  });

  test('chat response returns within timeout', async ({ request }) => {
    const startTime = Date.now();
    
    const result = await sendA2A(request, 'chat', {
      message: 'What is your opinion on decentralized governance?',
      agent: 'ceo'
    });
    
    const duration = Date.now() - startTime;
    
    expect(result.result).toBeDefined();
    // Chat should respond within 30 seconds (with LLM) or 5 seconds (heuristic)
    expect(duration).toBeLessThan(30000);
  });
});

test.describe('Request Ordering & Consistency', () => {
  test('responses correspond to correct requests', async ({ request }) => {
    // Send requests with unique identifiers
    const requests = Array.from({ length: 10 }, (_, i) => ({
      id: `ORDER-${i}-${Date.now()}`,
      index: i
    }));
    
    const promises = requests.map(r => 
      sendA2A(request, 'add-commentary', {
        proposalId: r.id,
        content: `Content for ${r.id}`,
        sentiment: r.index % 2 === 0 ? 'positive' : 'negative'
      })
    );
    
    const results = await Promise.all(promises);
    
    // Each response should match its request
    for (let i = 0; i < results.length; i++) {
      const data = results[i].result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
      expect(data.proposalId).toBe(requests[i].id);
      expect(data.content).toBe(`Content for ${requests[i].id}`);
    }
  });

  test('JSON-RPC ids are returned correctly', async ({ request }) => {
    const ids = [1, 42, 999, 'string-id', 'uuid-12345'];
    
    const promises = ids.map(id => 
      request.post(`${COUNCIL_URL}/a2a`, {
        data: {
          jsonrpc: '2.0',
          id,
          method: 'message/send',
          params: {
            message: {
              messageId: `id-test-${id}`,
              parts: [{ kind: 'data', data: { skillId: 'get-governance-stats' } }]
            }
          }
        }
      })
    );
    
    const responses = await Promise.all(promises);
    const results = await Promise.all(responses.map(r => r.json()));
    
    // Each response should have the same id as request
    for (let i = 0; i < results.length; i++) {
      expect(results[i].id).toBe(ids[i]);
    }
  });
});

test.describe('Error Recovery', () => {
  test('server recovers after invalid request', async ({ request }) => {
    // Send invalid request
    await request.post(`${COUNCIL_URL}/a2a`, {
      data: 'not valid json at all {'
    }).catch(() => {});
    
    // Server should still respond to valid requests
    const result = await sendA2A(request, 'get-governance-stats');
    expect(result.result).toBeDefined();
  });

  test('server handles request with missing fields gracefully', async ({ request }) => {
    // Send malformed request
    const badResponse = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send'
        // Missing params
      }
    });
    
    // Should return error but not crash
    expect(badResponse.status()).toBeLessThan(500);
    
    // Next request should work
    const goodResult = await sendA2A(request, 'get-council-status');
    expect(goodResult.result).toBeDefined();
  });

  test('handles burst of invalid followed by valid requests', async ({ request }) => {
    // Send 5 invalid requests
    const invalidPromises = Array.from({ length: 5 }, () =>
      request.post(`${COUNCIL_URL}/a2a`, { data: {} }).catch(() => null)
    );
    await Promise.all(invalidPromises);
    
    // Then 5 valid requests
    const validPromises = Array.from({ length: 5 }, () =>
      sendA2A(request, 'get-governance-stats')
    );
    const results = await Promise.all(validPromises);
    
    // All valid requests should succeed
    for (const result of results) {
      expect(result.result).toBeDefined();
    }
  });
});

test.describe('Memory & Resource Handling', () => {
  test('handles 100 requests without degradation', async ({ request }) => {
    const durations: number[] = [];
    
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      await sendA2A(request, 'get-council-status');
      durations.push(Date.now() - start);
    }
    
    // First 10 and last 10 should have similar average duration
    const firstTen = durations.slice(0, 10);
    const lastTen = durations.slice(-10);
    
    const avgFirst = firstTen.reduce((a, b) => a + b, 0) / 10;
    const avgLast = lastTen.reduce((a, b) => a + b, 0) / 10;
    
    // Last requests should not be significantly slower (< 3x slower)
    expect(avgLast).toBeLessThan(avgFirst * 3);
  });

  test('large batch of assessments does not exhaust resources', async ({ request }) => {
    const assessments = Array.from({ length: 20 }, (_, i) =>
      sendA2A(request, 'assess-proposal', {
        title: `Batch proposal ${i}`,
        summary: `Summary for batch proposal ${i}`,
        description: `Description for batch proposal ${i} with some content.`
      })
    );
    
    const results = await Promise.all(assessments);
    
    // All should complete successfully
    for (const result of results) {
      expect(result.result).toBeDefined();
      const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
      expect(data.overallScore).toBeDefined();
    }
  });
});

