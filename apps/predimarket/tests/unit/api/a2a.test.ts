import { describe, it, expect, mock } from 'bun:test';
import { POST } from '@/app/api/a2a/route';

// Mock fetch for GraphQL requests
global.fetch = mock((url: string, options?: any) => {
  if (url.includes('graphql')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: {
          predimarkets: [
            {
              id: '1',
              sessionId: '0x1234',
              question: 'Will it rain?',
              yesOdds: 60,
              noOdds: 40,
              totalVolume: '10000000000000000000',
              resolved: false,
              outcome: null,
            },
          ],
        },
      }),
    } as Response);
  }
  return Promise.reject(new Error('Unknown URL'));
});

describe('A2A API Route', () => {
  it('should respond to list-markets skill', async () => {
    const request = new Request('http://localhost/api/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'msg-1',
            parts: [
              {
                kind: 'data',
                data: { skillId: 'list-markets' },
              },
            ],
          },
        },
        id: 1,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(1);
    expect(data.result).toBeTruthy();
    expect(data.result.parts).toHaveLength(2);
    expect(data.result.parts[0].text).toContain('Found');
    expect(data.result.parts[1].data.markets).toBeTruthy();
  });

  it('should return error for invalid method', async () => {
    const request = new Request('http://localhost/api/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'invalid/method',
        params: {},
        id: 2,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.error).toBeTruthy();
    expect(data.error.code).toBe(-32601);
    expect(data.error.message).toBe('Method not found');
  });

  it('should return error when no skillId provided', async () => {
    const request = new Request('http://localhost/api/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'msg-3',
            parts: [
              {
                kind: 'data',
                data: {},
              },
            ],
          },
        },
        id: 3,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.error).toBeTruthy();
    expect(data.error.code).toBe(-32602);
    expect(data.error.message).toBe('No skillId specified');
  });

  it('should handle CORS preflight requests', async () => {
    const { OPTIONS } = await import('@/app/api/a2a/route');
    const response = await OPTIONS();

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('should return appropriate response for get-market-odds', async () => {
    const request = new Request('http://localhost/api/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'msg-4',
            parts: [
              {
                kind: 'data',
                data: { skillId: 'get-market-odds' },
              },
            ],
          },
        },
        id: 4,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.result.parts[0].text).toContain('requires market ID');
  });
});

