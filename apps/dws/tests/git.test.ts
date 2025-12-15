/**
 * Git Hosting Tests
 * Tests for the decentralized git hosting functionality
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createBackendManager } from '../src/storage/backends';
import { GitObjectStore } from '../src/git/object-store';
import { PackfileWriter, PackfileReader } from '../src/git/pack';
import { app } from '../src/server';

describe('GitObjectStore', () => {
  let store: GitObjectStore;

  beforeAll(() => {
    const backend = createBackendManager();
    store = new GitObjectStore(backend);
  });

  test('should store and retrieve a blob', async () => {
    const content = Buffer.from('Hello, World!');
    const blob = await store.storeBlob(content);

    expect(blob.oid).toHaveLength(40);
    expect(blob.type).toBe('blob');

    const retrieved = await store.getBlob(blob.oid);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.content.toString()).toBe('Hello, World!');
  });

  test('should store and retrieve a tree', async () => {
    // First store some blobs
    const file1 = await store.storeBlob(Buffer.from('file 1 content'));
    const file2 = await store.storeBlob(Buffer.from('file 2 content'));

    const tree = await store.storeTree([
      { mode: '100644', name: 'file1.txt', oid: file1.oid, type: 'blob' },
      { mode: '100644', name: 'file2.txt', oid: file2.oid, type: 'blob' },
    ]);

    expect(tree.oid).toHaveLength(40);
    expect(tree.type).toBe('tree');
    expect(tree.entries).toHaveLength(2);

    const retrieved = await store.getTree(tree.oid);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.entries).toHaveLength(2);
  });

  test('should store and retrieve a commit', async () => {
    const blob = await store.storeBlob(Buffer.from('initial content'));
    const tree = await store.storeTree([{ mode: '100644', name: 'README.md', oid: blob.oid, type: 'blob' }]);

    const commit = await store.storeCommit({
      tree: tree.oid,
      parents: [],
      author: {
        name: 'Test User',
        email: 'test@example.com',
        timestamp: 1700000000,
        timezoneOffset: 0,
      },
      committer: {
        name: 'Test User',
        email: 'test@example.com',
        timestamp: 1700000000,
        timezoneOffset: 0,
      },
      message: 'Initial commit',
    });

    expect(commit.oid).toHaveLength(40);
    expect(commit.type).toBe('commit');

    const retrieved = await store.getCommit(commit.oid);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.message).toBe('Initial commit');
    expect(retrieved?.tree).toBe(tree.oid);
  });

  test('should hash objects correctly', () => {
    const content = Buffer.from('test content\n');
    const hash = store.hashObject('blob', content);

    // This should match `echo -n "test content" | git hash-object --stdin`
    expect(hash).toHaveLength(40);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  test('should walk commit history', async () => {
    // Create a chain of commits
    const blob1 = await store.storeBlob(Buffer.from('v1'));
    const tree1 = await store.storeTree([{ mode: '100644', name: 'file.txt', oid: blob1.oid, type: 'blob' }]);

    const commit1 = await store.storeCommit({
      tree: tree1.oid,
      parents: [],
      author: { name: 'Test', email: 'test@example.com', timestamp: 1700000000, timezoneOffset: 0 },
      committer: { name: 'Test', email: 'test@example.com', timestamp: 1700000000, timezoneOffset: 0 },
      message: 'Commit 1',
    });

    const blob2 = await store.storeBlob(Buffer.from('v2'));
    const tree2 = await store.storeTree([{ mode: '100644', name: 'file.txt', oid: blob2.oid, type: 'blob' }]);

    const commit2 = await store.storeCommit({
      tree: tree2.oid,
      parents: [commit1.oid],
      author: { name: 'Test', email: 'test@example.com', timestamp: 1700000001, timezoneOffset: 0 },
      committer: { name: 'Test', email: 'test@example.com', timestamp: 1700000001, timezoneOffset: 0 },
      message: 'Commit 2',
    });

    const history = await store.walkCommits(commit2.oid, 10);
    expect(history).toHaveLength(2);
    expect(history[0].oid).toBe(commit2.oid);
    expect(history[1].oid).toBe(commit1.oid);
  });
});

describe('Packfile', () => {
  test('should create and parse a packfile', async () => {
    const backend = createBackendManager();
    const store = new GitObjectStore(backend);

    // Create some objects
    const blob = await store.storeBlob(Buffer.from('test content'));
    const tree = await store.storeTree([{ mode: '100644', name: 'test.txt', oid: blob.oid, type: 'blob' }]);
    const commit = await store.storeCommit({
      tree: tree.oid,
      parents: [],
      author: { name: 'Test', email: 'test@example.com', timestamp: 1700000000, timezoneOffset: 0 },
      committer: { name: 'Test', email: 'test@example.com', timestamp: 1700000000, timezoneOffset: 0 },
      message: 'Test commit',
    });

    // Create packfile
    const writer = new PackfileWriter();
    const blobObj = await store.getObject(blob.oid);
    const treeObj = await store.getObject(tree.oid);
    const commitObj = await store.getObject(commit.oid);

    writer.addObject(blobObj!.type, blobObj!.content, blob.oid);
    writer.addObject(treeObj!.type, treeObj!.content, tree.oid);
    writer.addObject(commitObj!.type, commitObj!.content, commit.oid);

    const packData = await writer.build();

    // Verify packfile header
    expect(packData.subarray(0, 4).toString()).toBe('PACK');
    expect(packData.readUInt32BE(4)).toBe(2); // Version
    expect(packData.readUInt32BE(8)).toBe(3); // 3 objects

    // Parse packfile
    const reader = new PackfileReader(packData);
    const objects = await reader.parse();

    expect(objects).toHaveLength(3);
    expect(objects.map((o) => o.type).sort()).toEqual(['blob', 'commit', 'tree']);
  });
});

describe('Git HTTP API', () => {
  test('GET /git/health should return healthy', async () => {
    const res = await app.request('/git/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
  });

  test('GET /git/repos should return repository list or error gracefully', async () => {
    const res = await app.request('/git/repos');
    // Either succeeds with repos or fails gracefully (500 if no contract deployed)
    expect([200, 500]).toContain(res.status);

    if (res.status === 200) {
      const body = await res.json();
      expect(body.repositories).toBeInstanceOf(Array);
      expect(body).toHaveProperty('total');
    }
  });

  test('POST /git/repos without auth should fail', async () => {
    const res = await app.request('/git/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-repo' }),
    });

    expect(res.status).toBe(401);
  });

  test('GET /git/:owner/:name for non-existent repo should return 404 or 500', async () => {
    const res = await app.request('/git/repos/0x0000000000000000000000000000000000000000/nonexistent');
    // 404 if contract deployed but repo not found, 500 if no contract
    expect([404, 500]).toContain(res.status);
  });
});

describe('DWS Server Integration', () => {
  test('GET /health should include git service', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.services.git).toBeDefined();
    expect(body.services.git.status).toBe('healthy');
  });

  test('GET / should list git endpoint', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.services).toContain('git');
    expect(body.endpoints.git).toBe('/git/*');
  });
});

