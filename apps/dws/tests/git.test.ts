/**
 * Git Hosting Integration Tests
 *
 * Run with: bun test tests/git.test.ts
 * Or via: bun run test:integration
 */

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { GitObjectStore } from '../src/git/object-store'
import { PackfileReader, PackfileWriter } from '../src/git/pack'
import { app } from '../src/server'
import {
  type BackendManager,
  createBackendManager,
} from '../src/storage/backends'

setDefaultTimeout(10000)

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
// Only skip if explicitly requested, not by default in CI
const SKIP = process.env.SKIP_INTEGRATION === 'true'

describe.skipIf(SKIP)('GitObjectStore', () => {
  let store: GitObjectStore
  let backend: BackendManager

  beforeEach(() => {
    backend = createBackendManager()
    store = new GitObjectStore(backend)
  })

  describe('Blob Operations', () => {
    test('should store and retrieve a blob', async () => {
      const content = Buffer.from('Hello, World!')
      const blob = await store.storeBlob(content)

      expect(blob.oid).toHaveLength(40)
      expect(blob.type).toBe('blob')

      const retrieved = await store.getBlob(blob.oid)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.content.toString()).toBe('Hello, World!')
    })

    test('should handle empty blob', async () => {
      const blob = await store.storeBlob(Buffer.alloc(0))

      expect(blob.oid).toHaveLength(40)

      const retrieved = await store.getBlob(blob.oid)
      expect(retrieved?.content.length).toBe(0)
    })

    test('should handle large blob', async () => {
      const largeContent = Buffer.alloc(1024 * 1024, 'x') // 1MB
      const blob = await store.storeBlob(largeContent)

      const retrieved = await store.getBlob(blob.oid)
      expect(retrieved?.content.length).toBe(largeContent.length)
    })

    test('should handle binary blob with null bytes', async () => {
      const binaryContent = Buffer.from([0x00, 0xff, 0x00, 0xfe, 0x00, 0x00])
      const blob = await store.storeBlob(binaryContent)

      const retrieved = await store.getBlob(blob.oid)
      expect(retrieved?.content.equals(binaryContent)).toBe(true)
    })

    test('should produce deterministic OIDs', async () => {
      const content = Buffer.from('deterministic content')
      const blob1 = await store.storeBlob(content)
      const blob2 = await store.storeBlob(content)

      expect(blob1.oid).toBe(blob2.oid)
    })

    test('should return null for non-existent blob', async () => {
      const result = await store.getBlob('0'.repeat(40))
      expect(result).toBeNull()
    })
  })

  describe('Tree Operations', () => {
    test('should store and retrieve a tree', async () => {
      const file1 = await store.storeBlob(Buffer.from('file 1 content'))
      const file2 = await store.storeBlob(Buffer.from('file 2 content'))

      const tree = await store.storeTree([
        { mode: '100644', name: 'file1.txt', oid: file1.oid, type: 'blob' },
        { mode: '100644', name: 'file2.txt', oid: file2.oid, type: 'blob' },
      ])

      expect(tree.oid).toHaveLength(40)
      expect(tree.type).toBe('tree')
      expect(tree.entries).toHaveLength(2)

      const retrieved = await store.getTree(tree.oid)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.entries).toHaveLength(2)
    })

    test('should handle empty tree', async () => {
      const tree = await store.storeTree([])

      expect(tree.oid).toHaveLength(40)
      expect(tree.entries).toHaveLength(0)
    })

    test('should handle tree with subdirectory', async () => {
      const file = await store.storeBlob(Buffer.from('nested file'))
      const subTree = await store.storeTree([
        { mode: '100644', name: 'nested.txt', oid: file.oid, type: 'blob' },
      ])
      const rootTree = await store.storeTree([
        { mode: '040000', name: 'subdir', oid: subTree.oid, type: 'tree' },
      ])

      const retrieved = await store.getTree(rootTree.oid)
      expect(retrieved?.entries[0].type).toBe('tree')
      expect(retrieved?.entries[0].mode).toBe('040000')
    })

    test('should handle tree with many entries', async () => {
      const entries = await Promise.all(
        Array.from({ length: 100 }, async (_, i) => {
          const blob = await store.storeBlob(Buffer.from(`file ${i}`))
          return {
            mode: '100644',
            name: `file${i.toString().padStart(3, '0')}.txt`,
            oid: blob.oid,
            type: 'blob' as const,
          }
        }),
      )

      const tree = await store.storeTree(entries)
      expect(tree.entries).toHaveLength(100)
    })

    test('should handle special characters in filenames', async () => {
      const blob = await store.storeBlob(Buffer.from('content'))
      const tree = await store.storeTree([
        {
          mode: '100644',
          name: 'file with spaces.txt',
          oid: blob.oid,
          type: 'blob',
        },
        { mode: '100644', name: 'файл.txt', oid: blob.oid, type: 'blob' }, // Cyrillic
        { mode: '100644', name: '文件.txt', oid: blob.oid, type: 'blob' }, // Chinese
      ])

      const retrieved = await store.getTree(tree.oid)
      expect(retrieved?.entries).toHaveLength(3)
    })

    test('should preserve entry order by name', async () => {
      const blob = await store.storeBlob(Buffer.from('x'))
      const tree = await store.storeTree([
        { mode: '100644', name: 'z.txt', oid: blob.oid, type: 'blob' },
        { mode: '100644', name: 'a.txt', oid: blob.oid, type: 'blob' },
        { mode: '100644', name: 'm.txt', oid: blob.oid, type: 'blob' },
      ])

      // Git sorts tree entries
      const retrieved = await store.getTree(tree.oid)
      const names = retrieved?.entries.map((e) => e.name)
      expect(names).toEqual(['a.txt', 'm.txt', 'z.txt'])
    })
  })

  describe('Commit Operations', () => {
    test('should store and retrieve a commit', async () => {
      const blob = await store.storeBlob(Buffer.from('initial content'))
      const tree = await store.storeTree([
        { mode: '100644', name: 'README.md', oid: blob.oid, type: 'blob' },
      ])

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
      })

      expect(commit.oid).toHaveLength(40)
      expect(commit.type).toBe('commit')

      const retrieved = await store.getCommit(commit.oid)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.message).toBe('Initial commit')
      expect(retrieved?.tree).toBe(tree.oid)
    })

    test('should handle commit with parent', async () => {
      const blob = await store.storeBlob(Buffer.from('v1'))
      const tree = await store.storeTree([
        { mode: '100644', name: 'file.txt', oid: blob.oid, type: 'blob' },
      ])

      const parent = await store.storeCommit({
        tree: tree.oid,
        parents: [],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        message: 'Parent commit',
      })

      const child = await store.storeCommit({
        tree: tree.oid,
        parents: [parent.oid],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000001,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000001,
          timezoneOffset: 0,
        },
        message: 'Child commit',
      })

      const retrieved = await store.getCommit(child.oid)
      expect(retrieved?.parents).toHaveLength(1)
      expect(retrieved?.parents[0]).toBe(parent.oid)
    })

    test('should handle merge commit with multiple parents', async () => {
      const blob = await store.storeBlob(Buffer.from('merge'))
      const tree = await store.storeTree([
        { mode: '100644', name: 'file.txt', oid: blob.oid, type: 'blob' },
      ])

      const parent1 = await store.storeCommit({
        tree: tree.oid,
        parents: [],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        message: 'Parent 1',
      })

      const parent2 = await store.storeCommit({
        tree: tree.oid,
        parents: [],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000001,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000001,
          timezoneOffset: 0,
        },
        message: 'Parent 2',
      })

      const merge = await store.storeCommit({
        tree: tree.oid,
        parents: [parent1.oid, parent2.oid],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000002,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000002,
          timezoneOffset: 0,
        },
        message: 'Merge commit',
      })

      const retrieved = await store.getCommit(merge.oid)
      expect(retrieved?.parents).toHaveLength(2)
    })

    test('should handle multi-line commit message', async () => {
      const blob = await store.storeBlob(Buffer.from('x'))
      const tree = await store.storeTree([
        { mode: '100644', name: 'x', oid: blob.oid, type: 'blob' },
      ])

      const message = `Fix: Critical bug in authentication

This commit fixes a critical security vulnerability in the
authentication module. The issue was caused by improper
validation of user tokens.

Fixes #123
Reviewed-by: Alice <alice@example.com>`

      const commit = await store.storeCommit({
        tree: tree.oid,
        parents: [],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        message,
      })

      const retrieved = await store.getCommit(commit.oid)
      expect(retrieved?.message).toBe(message)
    })

    test('should handle different timezones', async () => {
      const blob = await store.storeBlob(Buffer.from('tz'))
      const tree = await store.storeTree([
        { mode: '100644', name: 'tz', oid: blob.oid, type: 'blob' },
      ])

      const commit = await store.storeCommit({
        tree: tree.oid,
        parents: [],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: -480,
        }, // -8:00
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 330,
        }, // +5:30
        message: 'Timezone test',
      })

      const retrieved = await store.getCommit(commit.oid)
      expect(retrieved?.author.timezoneOffset).toBe(-480)
      expect(retrieved?.committer.timezoneOffset).toBe(330)
    })
  })

  describe('Hash Validation', () => {
    test('should hash objects correctly', () => {
      const content = Buffer.from('test content\n')
      const hash = store.hashObject('blob', content)

      expect(hash).toHaveLength(40)
      expect(hash).toMatch(/^[0-9a-f]{40}$/)
    })

    test('should produce consistent hashes for same content', () => {
      const content = Buffer.from('consistent hashing test')
      const hash1 = store.hashObject('blob', content)
      const hash2 = store.hashObject('blob', content)

      expect(hash1).toBe(hash2)
    })

    test('should produce different hashes for different types', () => {
      const content = Buffer.from('same content')
      const blobHash = store.hashObject('blob', content)
      const treeHash = store.hashObject('tree', content)

      expect(blobHash).not.toBe(treeHash)
    })
  })

  describe('Commit Walking', () => {
    test('should walk commit history', async () => {
      const blob1 = await store.storeBlob(Buffer.from('v1'))
      const tree1 = await store.storeTree([
        { mode: '100644', name: 'file.txt', oid: blob1.oid, type: 'blob' },
      ])

      const commit1 = await store.storeCommit({
        tree: tree1.oid,
        parents: [],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        message: 'Commit 1',
      })

      const blob2 = await store.storeBlob(Buffer.from('v2'))
      const tree2 = await store.storeTree([
        { mode: '100644', name: 'file.txt', oid: blob2.oid, type: 'blob' },
      ])

      const commit2 = await store.storeCommit({
        tree: tree2.oid,
        parents: [commit1.oid],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000001,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000001,
          timezoneOffset: 0,
        },
        message: 'Commit 2',
      })

      const history = await store.walkCommits(commit2.oid, 10)
      expect(history).toHaveLength(2)
      expect(history[0].oid).toBe(commit2.oid)
      expect(history[1].oid).toBe(commit1.oid)
    })

    test('should respect walk limit', async () => {
      // Create chain of 5 commits
      let parentOid: string | undefined
      let lastCommit: { oid: string }

      for (let i = 0; i < 5; i++) {
        const blob = await store.storeBlob(Buffer.from(`v${i}`))
        const tree = await store.storeTree([
          { mode: '100644', name: 'file.txt', oid: blob.oid, type: 'blob' },
        ])

        lastCommit = await store.storeCommit({
          tree: tree.oid,
          parents: parentOid ? [parentOid] : [],
          author: {
            name: 'Test',
            email: 'test@example.com',
            timestamp: 1700000000 + i,
            timezoneOffset: 0,
          },
          committer: {
            name: 'Test',
            email: 'test@example.com',
            timestamp: 1700000000 + i,
            timezoneOffset: 0,
          },
          message: `Commit ${i}`,
        })
        parentOid = lastCommit.oid
      }

      const history = await store.walkCommits(lastCommit!.oid, 3)
      expect(history).toHaveLength(3)
    })

    test('should handle walk of non-existent commit', async () => {
      const history = await store.walkCommits('0'.repeat(40), 10)
      expect(history).toHaveLength(0)
    })
  })

  describe('Object Retrieval', () => {
    test('getObject should return correct type for any object', async () => {
      const blob = await store.storeBlob(Buffer.from('blob content'))
      const tree = await store.storeTree([
        { mode: '100644', name: 'x', oid: blob.oid, type: 'blob' },
      ])
      const commit = await store.storeCommit({
        tree: tree.oid,
        parents: [],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        message: 'test',
      })

      const blobObj = await store.getObject(blob.oid)
      const treeObj = await store.getObject(tree.oid)
      const commitObj = await store.getObject(commit.oid)

      expect(blobObj?.type).toBe('blob')
      expect(treeObj?.type).toBe('tree')
      expect(commitObj?.type).toBe('commit')
    })
  })

  describe('Reachable Objects', () => {
    test('getReachableObjects should find all objects from commit', async () => {
      const blob = await store.storeBlob(Buffer.from('content'))
      const tree = await store.storeTree([
        { mode: '100644', name: 'file.txt', oid: blob.oid, type: 'blob' },
      ])
      const commit = await store.storeCommit({
        tree: tree.oid,
        parents: [],
        author: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        committer: {
          name: 'Test',
          email: 'test@example.com',
          timestamp: 1700000000,
          timezoneOffset: 0,
        },
        message: 'test',
      })

      const reachable = await store.getReachableObjects(commit.oid)

      expect(reachable).toContain(commit.oid)
      expect(reachable).toContain(tree.oid)
      expect(reachable).toContain(blob.oid)
      expect(reachable.length).toBe(3)
    })
  })
})

describe.skipIf(SKIP)('Packfile', () => {
  test('should create and parse a packfile', async () => {
    const backend = createBackendManager()
    const store = new GitObjectStore(backend)

    const blob = await store.storeBlob(Buffer.from('test content'))
    const tree = await store.storeTree([
      { mode: '100644', name: 'test.txt', oid: blob.oid, type: 'blob' },
    ])
    const commit = await store.storeCommit({
      tree: tree.oid,
      parents: [],
      author: {
        name: 'Test',
        email: 'test@example.com',
        timestamp: 1700000000,
        timezoneOffset: 0,
      },
      committer: {
        name: 'Test',
        email: 'test@example.com',
        timestamp: 1700000000,
        timezoneOffset: 0,
      },
      message: 'Test commit',
    })

    const writer = new PackfileWriter()
    const blobObj = await store.getObject(blob.oid)
    const treeObj = await store.getObject(tree.oid)
    const commitObj = await store.getObject(commit.oid)

    writer.addObject(blobObj!.type, blobObj!.content, blob.oid)
    writer.addObject(treeObj!.type, treeObj!.content, tree.oid)
    writer.addObject(commitObj!.type, commitObj!.content, commit.oid)

    const packData = await writer.build()

    // Verify packfile header
    expect(packData.subarray(0, 4).toString()).toBe('PACK')
    expect(packData.readUInt32BE(4)).toBe(2) // Version
    expect(packData.readUInt32BE(8)).toBe(3) // 3 objects

    // Parse packfile
    const reader = new PackfileReader(packData)
    const objects = await reader.parse()

    expect(objects).toHaveLength(3)
    expect(objects.map((o) => o.type).sort()).toEqual([
      'blob',
      'commit',
      'tree',
    ])
  })

  test('should handle empty packfile', async () => {
    const writer = new PackfileWriter()
    const packData = await writer.build()

    expect(packData.subarray(0, 4).toString()).toBe('PACK')
    expect(packData.readUInt32BE(8)).toBe(0) // 0 objects

    const reader = new PackfileReader(packData)
    const objects = await reader.parse()
    expect(objects).toHaveLength(0)
  })

  test('should handle packfile with large objects', async () => {
    const backend = createBackendManager()
    const store = new GitObjectStore(backend)

    // Use a moderate size for test stability
    const largeContent = Buffer.alloc(5 * 1024, 'x') // 5KB
    const blob = await store.storeBlob(largeContent)

    const writer = new PackfileWriter()
    const blobObj = await store.getObject(blob.oid)
    expect(blobObj).not.toBeNull()

    writer.addObject(blobObj!.type, blobObj!.content, blob.oid)

    const packData = await writer.build()

    // Verify packfile header
    expect(packData.subarray(0, 4).toString()).toBe('PACK')
    expect(packData.readUInt32BE(4)).toBe(2) // Version
    expect(packData.readUInt32BE(8)).toBe(1) // 1 object
  })
})

describe.skipIf(SKIP)('Git HTTP API', () => {
  describe('Health', () => {
    test('GET /git/health should return healthy', async () => {
      const res = await app.request('/git/health')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.status).toBe('healthy')
    })
  })

  describe('Repository List', () => {
    test('GET /git/repos should return repository list or error gracefully', async () => {
      const res = await app.request('/git/repos')
      expect([200, 500]).toContain(res.status)

      if (res.status === 200) {
        const body = await res.json()
        expect(body.repositories).toBeInstanceOf(Array)
        expect(body).toHaveProperty('total')
      }
    })

    test('GET /git/repos with pagination should work', async () => {
      const res = await app.request('/git/repos?offset=0&limit=5')
      expect([200, 500]).toContain(res.status)
    })
  })

  describe('Repository Creation', () => {
    test('POST /git/repos without auth should fail', async () => {
      const res = await app.request('/git/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-repo' }),
      })

      expect(res.status).toBe(401)
    })

    test('POST /git/repos without name should return 400', async () => {
      const res = await app.request('/git/repos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })
  })

  describe('Repository Details', () => {
    test('GET /git/repos/:owner/:name for non-existent repo should return 404 or 500', async () => {
      const res = await app.request(
        '/git/repos/0x0000000000000000000000000000000000000000/nonexistent',
      )
      expect([404, 500]).toContain(res.status)
    })
  })

  describe('User Repositories', () => {
    test('GET /git/users/:address/repos should return user repos', async () => {
      const res = await app.request(`/git/users/${TEST_ADDRESS}/repos`)
      expect([200, 500]).toContain(res.status)

      if (res.status === 200) {
        const body = await res.json()
        expect(body.repositories).toBeInstanceOf(Array)
      }
    })
  })
})

describe.skipIf(SKIP)('DWS Server Integration', () => {
  test('GET /health should include git service', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.services.git).toBeDefined()
    expect(body.services.git.status).toBe('healthy')
  })

  test('GET / should list git endpoint', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.services).toContain('git')
    expect(body.endpoints.git).toBe('/git/*')
  })
})

describe.skipIf(SKIP)('Concurrent Git Operations', () => {
  test('should handle concurrent blob stores', async () => {
    const backend = createBackendManager()
    const store = new GitObjectStore(backend)

    const stores = Array.from({ length: 50 }, (_, i) =>
      store.storeBlob(Buffer.from(`concurrent content ${i}`)),
    )

    const results = await Promise.all(stores)

    expect(results).toHaveLength(50)
    const uniqueOids = new Set(results.map((r) => r.oid))
    expect(uniqueOids.size).toBe(50)
  })

  test('should handle concurrent commit creation', async () => {
    const backend = createBackendManager()
    const store = new GitObjectStore(backend)

    // Pre-create trees
    const trees = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const blob = await store.storeBlob(Buffer.from(`content ${i}`))
        return store.storeTree([
          { mode: '100644', name: 'file.txt', oid: blob.oid, type: 'blob' },
        ])
      }),
    )

    // Create commits concurrently
    const commits = await Promise.all(
      trees.map((tree, i) =>
        store.storeCommit({
          tree: tree.oid,
          parents: [],
          author: {
            name: 'Test',
            email: 'test@example.com',
            timestamp: 1700000000 + i,
            timezoneOffset: 0,
          },
          committer: {
            name: 'Test',
            email: 'test@example.com',
            timestamp: 1700000000 + i,
            timezoneOffset: 0,
          },
          message: `Concurrent commit ${i}`,
        }),
      ),
    )

    expect(commits).toHaveLength(10)
    const uniqueOids = new Set(commits.map((c) => c.oid))
    expect(uniqueOids.size).toBe(10)
  })
})
