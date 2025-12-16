/**
 * NPM Registry Tests
 * 
 * Tests the JejuPkg NPM registry API without requiring IPFS/Arweave storage.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createNPMRegistryRouter } from './npm-registry';

describe('NPM Registry', () => {
  let server: ReturnType<typeof Bun.serve>;
  const baseUrl = 'http://localhost:4098';

  beforeAll(async () => {
    // Mock the global fetch for IPFS calls - intercept before creating app
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      
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
      
      // Mock arweave info endpoint
      if (url.includes('/info')) {
        return new Response(JSON.stringify({ height: 1234567 }), { status: 200 });
      }
      
      // Use original fetch for localhost (our test server)
      if (url.includes('localhost:4098')) {
        return originalFetch(input, init);
      }
      
      // Pass through other requests
      return originalFetch(input, init);
    };
    
    const app = createNPMRegistryRouter({
      storageBackend: 'ipfs',
      ipfsUrl: 'http://localhost:5001',
      arweaveUrl: 'https://arweave.net',
      allowPublicDownloads: true,
      allowFreePublish: true, // Enable free publish for testing
      upstreamRegistry: '', // Disable upstream for testing
    });

    server = Bun.serve({
      port: 4098,
      fetch: app.fetch,
    });
  });

  afterAll(() => {
    server.stop();
  });

  test('health check returns status', async () => {
    const response = await fetch(`${baseUrl}/-/registry/health`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { status: string };
    expect(data.status).toBeDefined();
  });

  test('registry root returns metadata', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { db_name: string; doc_count: number };
    expect(data.db_name).toBe('jeju-registry');
    expect(typeof data.doc_count).toBe('number');
  });

  test('search returns empty results initially', async () => {
    const response = await fetch(`${baseUrl}/-/v1/search?text=test`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { objects: unknown[]; total: number };
    expect(data.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.objects)).toBe(true);
  });

  test('get nonexistent package returns 404', async () => {
    const response = await fetch(`${baseUrl}/nonexistent-package`);
    expect(response.status).toBe(404);
  });

  test('publish package without auth returns 402', async () => {
    const response = await fetch(`${baseUrl}/test-package`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _id: 'test-package',
        name: 'test-package',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'test-package',
            version: '1.0.0',
            dist: { shasum: '', tarball: '' },
          },
        },
        _attachments: {},
      }),
    });

    expect(response.status).toBe(402);
  });

  test('publish package with auth succeeds', async () => {
    const tarball = Buffer.from('test tarball content');
    const tarballBase64 = tarball.toString('base64');

    const response = await fetch(`${baseUrl}/my-test-package`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
      body: JSON.stringify({
        _id: 'my-test-package',
        name: 'my-test-package',
        description: 'A test package',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'my-test-package',
            version: '1.0.0',
            description: 'A test package',
            dist: { shasum: '', tarball: '' },
          },
        },
        _attachments: {
          'my-test-package-1.0.0.tgz': {
            content_type: 'application/octet-stream',
            data: tarballBase64,
            length: tarball.length,
          },
        },
      }),
    });

    expect(response.status).toBe(201);

    const data = await response.json() as { ok: boolean; id: string };
    expect(data.ok).toBe(true);
    expect(data.id).toBe('my-test-package');
  });

  test('get published package succeeds', async () => {
    const response = await fetch(`${baseUrl}/my-test-package`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { name: string; 'dist-tags': { latest: string } };
    expect(data.name).toBe('my-test-package');
    expect(data['dist-tags'].latest).toBe('1.0.0');
  });

  test('search finds published package', async () => {
    const response = await fetch(`${baseUrl}/-/v1/search?text=my-test`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { objects: Array<{ package: { name: string } }>; total: number };
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.objects.some(o => o.package.name === 'my-test-package')).toBe(true);
  });

  test('login returns token', async () => {
    const response = await fetch(`${baseUrl}/-/user/org.couchdb.user:testuser`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'testuser',
        password: 'testpass',
      }),
    });

    expect(response.status).toBe(201);

    const data = await response.json() as { ok: boolean; token: string };
    expect(data.ok).toBe(true);
    expect(data.token).toBeDefined();
  });

  test('whoami returns username', async () => {
    const response = await fetch(`${baseUrl}/-/whoami`, {
      headers: {
        'Authorization': 'Bearer testuser',
      },
    });

    expect(response.ok).toBe(true);

    const data = await response.json() as { username: string };
    expect(data.username).toBe('testuser');
  });

  test('whoami without auth returns 401', async () => {
    const response = await fetch(`${baseUrl}/-/whoami`);
    expect(response.status).toBe(401);
  });

  test('publish scoped package', async () => {
    const tarball = Buffer.from('scoped tarball content');
    const tarballBase64 = tarball.toString('base64');

    const response = await fetch(`${baseUrl}/@jeju/scoped-pkg`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer scopeuser',
      },
      body: JSON.stringify({
        _id: '@jeju/scoped-pkg',
        name: '@jeju/scoped-pkg',
        description: 'A scoped package',
        'dist-tags': { latest: '0.1.0' },
        versions: {
          '0.1.0': {
            name: '@jeju/scoped-pkg',
            version: '0.1.0',
            description: 'A scoped package',
            dist: { shasum: '', tarball: '' },
          },
        },
        _attachments: {
          'scoped-pkg-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            data: tarballBase64,
            length: tarball.length,
          },
        },
      }),
    });

    expect(response.status).toBe(201);
  });

  test('get publisher account info', async () => {
    // First do something that creates an account
    await fetch(`${baseUrl}/-/user/org.couchdb.user:accountuser`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'accountuser', password: 'pass' }),
    });

    const response = await fetch(`${baseUrl}/-/registry/accounts/accountuser`);
    expect(response.ok).toBe(true);

    const data = await response.json() as { address: string };
    expect(data.address).toBe('accountuser');
  });
});
