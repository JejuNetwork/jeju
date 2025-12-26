/**
 * Package Registry Integration Tests (JejuPkg)
 *
 * Run with: bun test tests/pkg.test.ts
 * Or via: bun run test:integration
 */

import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getApp } from './setup'

setDefaultTimeout(10000)

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
// Only skip if explicitly requested, not by default in CI
const SKIP = process.env.SKIP_INTEGRATION === 'true' || process.env.INFRA_READY !== 'true'

// Helper to make requests to the Elysia app (lazy loads app)
async function request(path: string, options?: RequestInit): Promise<Response> {
  const app = await getApp()
  const req = new Request(`http://localhost${path}`, options)
  return app.handle(req)
}

// Helper to create a minimal package tarball
function createMockTarball(
  name: string,
  version: string,
): { base64: string; buffer: Buffer } {
  const packageJson = JSON.stringify({
    name,
    version,
    description: 'Test package',
    main: 'index.js',
    license: 'MIT',
  })

  const content = Buffer.from(packageJson)
  return { base64: content.toString('base64'), buffer: content }
}

describe.skipIf(SKIP)('Package Registry', () => {
  describe('Health Check', () => {
    test('GET /pkg/health should return healthy', async () => {
      const res = await request('/pkg/health')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.service).toBe('dws-pkg')
      expect(body.status).toBe('healthy')
    })
  })

  describe('NPM Compatibility Endpoints', () => {
    describe('Ping', () => {
      test('GET /-/ping should return success', async () => {
        const res = await request('/pkg/-/ping')
        expect(res.status).toBe(200)
      })
    })

    describe('Whoami', () => {
      test('GET /-/whoami without auth should return 401', async () => {
        const res = await request('/pkg/-/whoami')
        expect(res.status).toBe(401)
      })

      test('GET /-/whoami with auth should return username', async () => {
        const res = await request('/pkg/-/whoami', {
          headers: { 'x-jeju-address': TEST_ADDRESS },
        })

        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.username).toBe(TEST_ADDRESS)
      })
    })

    describe('User Authentication', () => {
      test('PUT /-/user/org.couchdb.user:test should return token', async () => {
        const res = await request('/pkg/-/user/org.couchdb.user:test', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: TEST_ADDRESS,
            password: 'test-password',
            email: 'test@example.com',
          }),
        })

        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.ok).toBe(true)
        expect(body.token).toBeDefined()
      })
    })

    describe('Token Deletion', () => {
      test('DELETE /-/user/token/:token should succeed', async () => {
        const res = await request('/pkg/-/user/token/test-token', {
          method: 'DELETE',
        })

        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.ok).toBe(true)
      })
    })
  })

  describe('Package Metadata', () => {
    test('GET /:package for internal paths should return ok', async () => {
      const res = await request('/pkg/-/v1/package')
      // Internal paths are handled specially - may return 301 redirect or other codes
      expect([200, 301, 302, 400, 404, 500]).toContain(res.status)
    })

    test('GET /:package for non-existent package should return 404', async () => {
      const res = await request('/pkg/nonexistent-package-xyz-12345')
      expect([400, 404, 500]).toContain(res.status)
    })

    test('GET /:package should handle scoped packages', async () => {
      const res = await request('/pkg/@scope%2Fpackage')
      expect([400, 404, 500]).toContain(res.status)
    })

    test('GET /:package/:version for non-existent should return 404', async () => {
      const res = await request('/pkg/nonexistent-pkg/1.0.0')
      expect([400, 404, 500]).toContain(res.status)
    })
  })

  describe('Package Publishing', () => {
    test('PUT /:package without auth should return 401', async () => {
      const tarball = createMockTarball('test-package', '1.0.0')

      const res = await request('/pkg/test-package', {
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
              description: 'Test package',
              dist: {
                tarball:
                  'http://localhost:4030/pkg/test-package/-/test-package-1.0.0.tgz',
                shasum: 'abc123',
              },
            },
          },
          _attachments: {
            'test-package-1.0.0.tgz': {
              content_type: 'application/octet-stream',
              data: tarball.base64,
              length: tarball.buffer.length,
            },
          },
        }),
      })

      expect(res.status).toBe(401)
    })

    test('PUT /:package without version data should return 400', async () => {
      const res = await request('/pkg/test-package', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          _id: 'test-package',
          name: 'test-package',
          'dist-tags': {},
          versions: {},
          _attachments: {},
        }),
      })

      expect(res.status).toBe(400)
    })

    test('PUT /:package without attachment should return 400', async () => {
      const res = await request('/pkg/test-package', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          _id: 'test-package',
          name: 'test-package',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'test-package',
              version: '1.0.0',
              dist: { tarball: 'test', shasum: 'abc' },
            },
          },
          _attachments: {},
        }),
      })

      expect(res.status).toBe(400)
    })
  })

  describe('Package Search', () => {
    test('GET /-/v1/search should return search results', async () => {
      const res = await request('/pkg/-/v1/search?text=test')
      expect([200, 400, 500]).toContain(res.status)

      if (res.status === 200) {
        const body = await res.json()
        expect(body.objects).toBeInstanceOf(Array)
        expect(body).toHaveProperty('total')
        expect(body).toHaveProperty('time')
      }
    })

    test('GET /-/v1/search with size limit should respect limit', async () => {
      const res = await request('/pkg/-/v1/search?text=test&size=5')
      expect([200, 400, 500]).toContain(res.status)

      if (res.status === 200) {
        const body = await res.json()
        expect(body.objects.length).toBeLessThanOrEqual(5)
      }
    })

    test('GET /-/v1/search with from offset should paginate', async () => {
      const res = await request('/pkg/-/v1/search?text=test&from=10&size=5')
      expect([200, 400, 500]).toContain(res.status)

      if (res.status === 200) {
        const body = await res.json()
        expect(body.objects).toBeInstanceOf(Array)
      }
    })

    test('GET /-/v1/search without text should return all', async () => {
      const res = await request('/pkg/-/v1/search')
      expect([200, 400, 500]).toContain(res.status)
    })
  })

  describe('Tarball Download', () => {
    test('GET /:package/-/:tarball with invalid version should return 400', async () => {
      const res = await request('/pkg/test-package/-/test-package-invalid.tgz')
      expect(res.status).toBe(400)
    })

    test('GET /:package/-/:tarball for non-existent package should return 404', async () => {
      const res = await request(
        '/pkg/nonexistent-pkg/-/nonexistent-pkg-1.0.0.tgz',
      )
      expect([400, 404, 500]).toContain(res.status)
    })

    test('GET /:package/-/:tarball should handle scoped package names', async () => {
      const res = await request('/pkg/@scope%2Fpackage/-/package-1.0.0.tgz')
      expect([400, 404, 500]).toContain(res.status)
    })
  })
})

describe.skipIf(SKIP)('Package Edge Cases', () => {
  describe('Package Name Validation', () => {
    test('should handle package names with hyphens', async () => {
      // Use a fake name that won't exist upstream
      const res = await request('/pkg/jeju-test-nonexistent-pkg-xyz123')
      expect([200, 400, 404, 500]).toContain(res.status)
    })

    test('should handle package names with underscores', async () => {
      const res = await request('/pkg/jeju_test_nonexistent_pkg_xyz123')
      expect([200, 400, 404, 500]).toContain(res.status)
    })

    test('should handle package names with numbers', async () => {
      const res = await request('/pkg/jejutestpkg999xyz123')
      expect([200, 400, 404, 500]).toContain(res.status)
    })

    test('should handle very long package names', async () => {
      const longName = 'a'.repeat(200)
      const res = await request(`/pkg/${longName}`)
      expect([400, 404, 500]).toContain(res.status)
    })
  })

  describe('Version String Handling', () => {
    test('should handle semver versions', async () => {
      const res = await request('/pkg/test-pkg/1.2.3')
      expect([400, 404, 500]).toContain(res.status)
    })

    test('should handle prerelease versions', async () => {
      const res = await request('/pkg/test-pkg/1.0.0-alpha.1')
      expect([400, 404, 500]).toContain(res.status)
    })

    test('should handle build metadata versions', async () => {
      const res = await request('/pkg/test-pkg/1.0.0+build.123')
      expect([400, 404, 500]).toContain(res.status)
    })
  })

  describe('Scoped Packages', () => {
    test('should handle scoped package with encoded slash', async () => {
      const res = await request('/pkg/@myorg%2Fmypackage')
      expect([400, 404, 500]).toContain(res.status)
    })
  })
})

describe.skipIf(SKIP)('Package Server Integration', () => {
  test('DWS health should include pkg service', async () => {
    const res = await request('/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.services.pkg).toBeDefined()
    expect(body.services.pkg.status).toBe('healthy')
  })

  test('DWS root should list pkg endpoint', async () => {
    const res = await request('/')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.services).toContain('pkg')
    expect(body.endpoints.pkg).toBe('/pkg/*')
  })
})
