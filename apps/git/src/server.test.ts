/**
 * JejuGit Server Tests
 * 
 * Tests the JejuGit API without requiring IPFS/Arweave storage.
 * Storage operations return mock CIDs in test mode.
 */

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { createJejuGitRouter } from './server';

describe('JejuGit Server', () => {
  let server: ReturnType<typeof Bun.serve>;
  const baseUrl = 'http://localhost:4099';

  beforeAll(async () => {
    // Mock fetch for IPFS calls to avoid connection errors
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      
      // Mock IPFS add endpoint
      if (url.includes('/api/v0/add')) {
        return new Response(JSON.stringify({ Hash: `Qm${Date.now()}` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Mock IPFS cat endpoint
      if (url.includes('/api/v0/cat')) {
        return new Response(new ArrayBuffer(0), { status: 200 });
      }
      
      // Mock IPFS id endpoint (health check)
      if (url.includes('/api/v0/id')) {
        return new Response(JSON.stringify({ ID: 'mock-peer-id' }), { status: 200 });
      }
      
      // Pass through other requests
      return originalFetch(input, init);
    };
    
    const app = createJejuGitRouter({
      storageBackend: 'ipfs',
      ipfsUrl: 'http://localhost:5001',
      arweaveUrl: 'https://arweave.net',
    });

    server = Bun.serve({
      port: 4099,
      fetch: app.fetch,
    });
  });

  afterAll(() => {
    server.stop();
  });

  test('health check returns status', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { status: string };
    expect(data.status).toBeDefined();
  });

  test('list repositories returns empty initially', async () => {
    const response = await fetch(`${baseUrl}/api/v1/repos`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { total_count: number; items: unknown[] };
    expect(data.total_count).toBe(0);
    expect(data.items).toEqual([]);
  });

  test('create repository without auth returns 401', async () => {
    const response = await fetch(`${baseUrl}/api/v1/repos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test-repo',
        description: 'A test repository',
        visibility: 'public',
      }),
    });

    expect(response.status).toBe(401);
  });

  test('create repository with auth succeeds', async () => {
    const response = await fetch(`${baseUrl}/api/v1/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
      body: JSON.stringify({
        name: 'test-repo',
        description: 'A test repository',
        visibility: 'public',
      }),
    });

    expect(response.status).toBe(201);

    const data = await response.json() as { name: string; full_name: string };
    expect(data.name).toBe('test-repo');
    expect(data.full_name).toContain('test-repo');
  });

  test('get repository returns created repo', async () => {
    // First create a repo
    await fetch(`${baseUrl}/api/v1/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer testuser',
      },
      body: JSON.stringify({
        name: 'get-test-repo',
        description: 'Test',
        visibility: 'public',
      }),
    });

    const response = await fetch(`${baseUrl}/api/v1/repos/testuser/get-test-repo`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { name: string };
    expect(data.name).toBe('get-test-repo');
  });

  test('search repositories works', async () => {
    const response = await fetch(`${baseUrl}/api/v1/search/repositories?q=test`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { total_count: number; items: unknown[] };
    expect(data.total_count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.items)).toBe(true);
  });

  test('create issue on repository', async () => {
    // First create a repo
    await fetch(`${baseUrl}/api/v1/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer issueuser',
      },
      body: JSON.stringify({
        name: 'issue-repo',
        description: 'For issue testing',
        visibility: 'public',
      }),
    });

    // Create an issue
    const response = await fetch(`${baseUrl}/api/v1/repos/issueuser/issue-repo/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer issueuser',
      },
      body: JSON.stringify({
        title: 'Test Issue',
        body: 'This is a test issue',
      }),
    });

    expect(response.status).toBe(201);

    const data = await response.json() as { number: number; title: string };
    expect(data.number).toBe(1);
    expect(data.title).toBe('Test Issue');
  });

  test('list issues on repository', async () => {
    const response = await fetch(`${baseUrl}/api/v1/repos/issueuser/issue-repo/issues`);
    expect(response.ok).toBe(true);

    const data = await response.json() as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });

  test('star repository', async () => {
    const response = await fetch(`${baseUrl}/api/v1/repos/testuser/get-test-repo/star`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer staruser',
      },
    });

    expect(response.ok).toBe(true);

    const data = await response.json() as { starred: boolean };
    expect(data.starred).toBe(true);
  });

  test('fork repository', async () => {
    const response = await fetch(`${baseUrl}/api/v1/repos/testuser/get-test-repo/fork`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer forkuser',
      },
    });

    expect(response.status).toBe(201);

    const data = await response.json() as { owner: { login: string }; forked_from: string };
    expect(data.owner.login).toBe('forkuser');
    expect(data.forked_from).toContain('get-test-repo');
  });

  test('get user', async () => {
    const response = await fetch(`${baseUrl}/api/v1/users/testuser`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { login: string };
    expect(data.login).toBe('testuser');
  });

  test('get user repositories', async () => {
    const response = await fetch(`${baseUrl}/api/v1/users/testuser/repos`);
    expect(response.ok).toBe(true);

    const data = await response.json() as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });
});
