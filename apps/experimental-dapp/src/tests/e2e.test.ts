/**
 * End-to-End Tests for Experimental Decentralized Todo App
 * 
 * Tests all decentralized services integration:
 * - REST API
 * - A2A Protocol
 * - MCP Protocol
 * - Database (CQL)
 * - Cache
 * - Storage (IPFS)
 * - KMS
 * - Cron
 * - JNS
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Wallet } from 'ethers';

const API_URL = process.env.API_URL || 'http://localhost:4500';
const TEST_WALLET = Wallet.createRandom();

async function getAuthHeaders(): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();
  const message = `jeju-todo:${timestamp}`;
  const signature = await TEST_WALLET.signMessage(message);

  return {
    'Content-Type': 'application/json',
    'x-jeju-address': TEST_WALLET.address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-signature': signature,
  };
}

describe('Health Check', () => {
  test('should return healthy status', async () => {
    const response = await fetch(`${API_URL}/health`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { status: string; services: Array<{ name: string }> };
    expect(data.status).toBeDefined();
    expect(data.services).toBeInstanceOf(Array);
    expect(data.services.length).toBeGreaterThan(0);
  });
});

describe('REST API', () => {
  let createdTodoId: string;

  test('should create a todo', async () => {
    const headers = await getAuthHeaders();
    
    const response = await fetch(`${API_URL}/api/v1/todos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Test todo',
        description: 'Test description',
        priority: 'high',
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { todo: { id: string; title: string; priority: string } };
    expect(data.todo).toBeDefined();
    expect(data.todo.title).toBe('Test todo');
    expect(data.todo.priority).toBe('high');
    createdTodoId = data.todo.id;
  });

  test('should list todos', async () => {
    const headers = await getAuthHeaders();
    
    const response = await fetch(`${API_URL}/api/v1/todos`, { headers });
    expect(response.ok).toBe(true);

    const data = await response.json() as { todos: Array<{ id: string }>; count: number };
    expect(data.todos).toBeInstanceOf(Array);
    expect(data.count).toBeGreaterThan(0);
  });

  test('should get a specific todo', async () => {
    const headers = await getAuthHeaders();
    
    const response = await fetch(`${API_URL}/api/v1/todos/${createdTodoId}`, { headers });
    expect(response.ok).toBe(true);

    const data = await response.json() as { todo: { id: string; title: string } };
    expect(data.todo.id).toBe(createdTodoId);
    expect(data.todo.title).toBe('Test todo');
  });

  test('should update a todo', async () => {
    const headers = await getAuthHeaders();
    
    const response = await fetch(`${API_URL}/api/v1/todos/${createdTodoId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ completed: true }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { todo: { completed: boolean } };
    expect(data.todo.completed).toBe(true);
  });

  test('should get stats', async () => {
    const headers = await getAuthHeaders();
    
    const response = await fetch(`${API_URL}/api/v1/stats`, { headers });
    expect(response.ok).toBe(true);

    const data = await response.json() as { stats: { total: number; completed: number; pending: number } };
    expect(data.stats.total).toBeGreaterThan(0);
    expect(data.stats.completed).toBeGreaterThan(0);
  });

  test('should delete a todo', async () => {
    const headers = await getAuthHeaders();
    
    const response = await fetch(`${API_URL}/api/v1/todos/${createdTodoId}`, {
      method: 'DELETE',
      headers,
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { success: boolean };
    expect(data.success).toBe(true);
  });
});

describe('A2A Protocol', () => {
  test('should return agent card', async () => {
    const response = await fetch(`${API_URL}/a2a/.well-known/agent-card.json`);
    expect(response.ok).toBe(true);

    const card = await response.json() as { 
      protocolVersion: string; 
      name: string; 
      skills: Array<{ id: string }> 
    };
    expect(card.protocolVersion).toBeDefined();
    expect(card.name).toContain('Todo');
    expect(card.skills).toBeInstanceOf(Array);
    expect(card.skills.length).toBeGreaterThan(0);
  });

  test('should execute list-todos skill', async () => {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_URL}/a2a`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-1',
            parts: [{ kind: 'data', data: { skillId: 'list-todos' } }],
          },
        },
        id: 1,
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { result: { parts: Array<{ kind: string; data?: { todos?: unknown[] } }> } };
    expect(data.result).toBeDefined();
    expect(data.result.parts).toBeInstanceOf(Array);
  });

  test('should execute create-todo skill', async () => {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_URL}/a2a`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-2',
            parts: [{
              kind: 'data',
              data: {
                skillId: 'create-todo',
                title: 'A2A Test Todo',
                priority: 'medium',
              },
            }],
          },
        },
        id: 2,
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { result: { parts: Array<{ kind: string; data?: { created?: boolean } }> } };
    expect(data.result).toBeDefined();
    
    const dataPart = data.result.parts.find(p => p.kind === 'data');
    expect(dataPart?.data?.created).toBe(true);
  });

  test('should execute get-summary skill', async () => {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_URL}/a2a`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-3',
            parts: [{ kind: 'data', data: { skillId: 'get-summary' } }],
          },
        },
        id: 3,
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { result: { parts: Array<{ kind: string; data?: { stats?: { total: number } } }> } };
    const dataPart = data.result.parts.find(p => p.kind === 'data');
    expect(dataPart?.data?.stats).toBeDefined();
  });
});

describe('MCP Protocol', () => {
  test('should return MCP info', async () => {
    const response = await fetch(`${API_URL}/mcp`);
    expect(response.ok).toBe(true);

    const info = await response.json() as { 
      name: string; 
      tools: Array<{ name: string }>; 
      resources: Array<{ uri: string }> 
    };
    expect(info.name).toBe('jeju-todo-mcp');
    expect(info.tools).toBeInstanceOf(Array);
    expect(info.resources).toBeInstanceOf(Array);
  });

  test('should initialize MCP session', async () => {
    const response = await fetch(`${API_URL}/mcp/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { protocolVersion: string; serverInfo: { name: string } };
    expect(data.protocolVersion).toBeDefined();
    expect(data.serverInfo).toBeDefined();
  });

  test('should list MCP tools', async () => {
    const response = await fetch(`${API_URL}/mcp/tools/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { tools: Array<{ name: string; description: string }> };
    expect(data.tools).toBeInstanceOf(Array);
    expect(data.tools.length).toBeGreaterThan(0);
    
    const toolNames = data.tools.map(t => t.name);
    expect(toolNames).toContain('create_todo');
    expect(toolNames).toContain('list_todos');
  });

  test('should call create_todo tool', async () => {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_URL}/mcp/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'create_todo',
        arguments: {
          title: 'MCP Test Todo',
          priority: 'low',
        },
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(data.isError).toBe(false);
    
    const result = JSON.parse(data.content[0].text);
    expect(result.created).toBe(true);
  });

  test('should list MCP resources', async () => {
    const response = await fetch(`${API_URL}/mcp/resources/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { resources: Array<{ uri: string; name: string }> };
    expect(data.resources).toBeInstanceOf(Array);
    
    const uris = data.resources.map(r => r.uri);
    expect(uris).toContain('todo://todos');
    expect(uris).toContain('todo://stats');
  });

  test('should read stats resource', async () => {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_URL}/mcp/resources/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ uri: 'todo://stats' }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { contents: Array<{ uri: string; text: string }> };
    expect(data.contents).toBeInstanceOf(Array);
    expect(data.contents[0].uri).toBe('todo://stats');
  });
});

describe('Authentication', () => {
  test('should reject requests without auth', async () => {
    const response = await fetch(`${API_URL}/api/v1/todos`);
    expect(response.status).toBe(401);
  });

  test('should reject requests with invalid signature', async () => {
    const response = await fetch(`${API_URL}/api/v1/todos`, {
      headers: {
        'x-jeju-address': TEST_WALLET.address,
        'x-jeju-timestamp': Date.now().toString(),
        'x-jeju-signature': '0xinvalid',
      },
    });
    expect(response.status).toBe(401);
  });

  test('should reject requests with expired timestamp', async () => {
    const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString(); // 10 minutes ago
    const message = `jeju-todo:${oldTimestamp}`;
    const signature = await TEST_WALLET.signMessage(message);

    const response = await fetch(`${API_URL}/api/v1/todos`, {
      headers: {
        'x-jeju-address': TEST_WALLET.address,
        'x-jeju-timestamp': oldTimestamp,
        'x-jeju-signature': signature,
      },
    });
    expect(response.status).toBe(401);
  });
});

describe('Bulk Operations', () => {
  let todoIds: string[] = [];

  beforeAll(async () => {
    const headers = await getAuthHeaders();
    
    // Create multiple todos
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${API_URL}/api/v1/todos`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: `Bulk test ${i}`, priority: 'medium' }),
      });
      const data = await response.json() as { todo: { id: string } };
      todoIds.push(data.todo.id);
    }
  });

  test('should bulk complete todos', async () => {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_URL}/api/v1/todos/bulk/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: todoIds }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { completed: number; todos: Array<{ completed: boolean }> };
    expect(data.completed).toBe(3);
    expect(data.todos.every(t => t.completed)).toBe(true);
  });

  test('should bulk delete todos', async () => {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_URL}/api/v1/todos/bulk/delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: todoIds }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { deleted: number };
    expect(data.deleted).toBe(3);
  });
});

// Cleanup
afterAll(async () => {
  // Clean up any remaining test todos
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}/api/v1/todos`, { headers });
  const data = await response.json() as { todos: Array<{ id: string }> };
  
  for (const todo of data.todos) {
    await fetch(`${API_URL}/api/v1/todos/${todo.id}`, {
      method: 'DELETE',
      headers,
    });
  }
});
