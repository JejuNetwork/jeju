import { describe, expect, it } from 'bun:test'
import {
  VendorCommandsSchema,
  VendorHealthCheckSchema,
  MonorepoDependencySchema,
  VendorManifestSchema,
  VendorAppSchema,
  VendorDiscoveryResultSchema,
  validateManifest,
  isValidManifest,
} from '../vendor'

describe('Vendor Types', () => {
  describe('VendorCommandsSchema', () => {
    it('validates vendor commands', () => {
      const commands = {
        dev: 'bun run dev',
        build: 'bun run build',
        test: 'bun test',
        start: 'bun run start',
      }
      expect(() => VendorCommandsSchema.parse(commands)).not.toThrow()
    })

    it('validates partial commands', () => {
      const commands = {
        dev: 'bun run dev',
      }
      expect(() => VendorCommandsSchema.parse(commands)).not.toThrow()
    })

    it('validates empty commands', () => {
      const commands = {}
      expect(() => VendorCommandsSchema.parse(commands)).not.toThrow()
    })
  })

  describe('VendorHealthCheckSchema', () => {
    it('validates health check config', () => {
      const config = {
        url: 'http://localhost:3000/health',
        interval: 30000,
      }
      expect(() => VendorHealthCheckSchema.parse(config)).not.toThrow()
    })

    it('validates minimal health check', () => {
      const config = {
        url: 'http://localhost:8080/api/health',
      }
      expect(() => VendorHealthCheckSchema.parse(config)).not.toThrow()
    })
  })

  describe('MonorepoDependencySchema', () => {
    it('validates all monorepo dependencies', () => {
      const deps = ['contracts', 'config', 'shared', 'scripts']
      for (const dep of deps) {
        expect(MonorepoDependencySchema.parse(dep)).toBe(dep)
      }
    })
  })

  describe('VendorManifestSchema', () => {
    it('validates complete manifest', () => {
      const manifest = {
        name: 'my-app',
        displayName: 'My Application',
        version: '1.0.0',
        description: 'A sample vendor application',
        commands: {
          dev: 'bun run dev',
          build: 'bun run build',
          test: 'bun test',
          start: 'bun run start',
        },
        ports: {
          http: 3000,
          ws: 3001,
        },
        dependencies: ['contracts', 'shared'],
        optional: false,
        enabled: true,
        tags: ['web', 'api'],
        healthCheck: {
          url: 'http://localhost:3000/health',
          interval: 30000,
        },
      }
      expect(() => VendorManifestSchema.parse(manifest)).not.toThrow()
    })

    it('validates minimal manifest', () => {
      const manifest = {
        name: 'simple-app',
        version: '0.1.0',
      }
      const result = VendorManifestSchema.parse(manifest)
      expect(result.name).toBe('simple-app')
      expect(result.version).toBe('0.1.0')
      expect(result.optional).toBe(false)
      expect(result.enabled).toBe(true)
      expect(result.tags).toEqual([])
    })

    it('validates kebab-case name', () => {
      expect(() =>
        VendorManifestSchema.parse({ name: 'valid-name', version: '1.0.0' })
      ).not.toThrow()

      expect(() =>
        VendorManifestSchema.parse({ name: 'also-valid-123', version: '1.0.0' })
      ).not.toThrow()

      expect(() =>
        VendorManifestSchema.parse({ name: 'Invalid_Name', version: '1.0.0' })
      ).toThrow()

      expect(() =>
        VendorManifestSchema.parse({ name: 'InvalidCamelCase', version: '1.0.0' })
      ).toThrow()
    })

    it('validates semver version', () => {
      expect(() =>
        VendorManifestSchema.parse({ name: 'app', version: '1.0.0' })
      ).not.toThrow()

      expect(() =>
        VendorManifestSchema.parse({ name: 'app', version: '1.2.3-alpha.1' })
      ).not.toThrow()

      expect(() =>
        VendorManifestSchema.parse({ name: 'app', version: '0.0.1-beta' })
      ).not.toThrow()

      expect(() =>
        VendorManifestSchema.parse({ name: 'app', version: 'invalid' })
      ).toThrow()

      expect(() =>
        VendorManifestSchema.parse({ name: 'app', version: '1.0' })
      ).toThrow()
    })
  })

  describe('VendorAppSchema', () => {
    it('validates vendor app', () => {
      const app = {
        name: 'my-app',
        path: '/home/user/projects/jeju/apps/my-app',
        manifest: {
          name: 'my-app',
          version: '1.0.0',
          description: 'My app',
        },
        exists: true,
      }
      expect(() => VendorAppSchema.parse(app)).not.toThrow()
    })

    it('validates non-existent app', () => {
      const app = {
        name: 'missing-app',
        path: '/home/user/projects/jeju/apps/missing-app',
        manifest: {
          name: 'missing-app',
          version: '0.0.1',
        },
        exists: false,
      }
      expect(() => VendorAppSchema.parse(app)).not.toThrow()
    })
  })

  describe('VendorDiscoveryResultSchema', () => {
    it('validates discovery result', () => {
      const result = {
        apps: [
          {
            name: 'app1',
            path: '/path/to/app1',
            manifest: { name: 'app1', version: '1.0.0' },
            exists: true,
          },
          {
            name: 'app2',
            path: '/path/to/app2',
            manifest: { name: 'app2', version: '2.0.0', enabled: false },
            exists: true,
          },
        ],
        availableApps: [
          {
            name: 'app1',
            path: '/path/to/app1',
            manifest: { name: 'app1', version: '1.0.0' },
            exists: true,
          },
        ],
        missingApps: [],
        disabledApps: [
          {
            name: 'app2',
            path: '/path/to/app2',
            manifest: { name: 'app2', version: '2.0.0', enabled: false },
            exists: true,
          },
        ],
      }
      expect(() => VendorDiscoveryResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('validateManifest', () => {
    it('returns parsed manifest for valid input', () => {
      const manifest = {
        name: 'test-app',
        version: '1.0.0',
      }
      const result = validateManifest(manifest)
      expect(result.name).toBe('test-app')
      expect(result.version).toBe('1.0.0')
    })

    it('throws for invalid input', () => {
      const invalid = {
        name: 'Invalid Name',
        version: 'not-semver',
      }
      expect(() => validateManifest(invalid)).toThrow()
    })
  })

  describe('isValidManifest', () => {
    it('returns true for valid manifest', () => {
      const manifest = {
        name: 'valid-app',
        version: '2.0.0',
      }
      expect(isValidManifest(manifest)).toBe(true)
    })

    it('returns false for invalid manifest', () => {
      const invalid = {
        name: 'Invalid Name',
        version: '1.0.0',
      }
      expect(isValidManifest(invalid)).toBe(false)
    })

    it('returns false for missing required fields', () => {
      const missing = {
        name: 'app',
      }
      expect(isValidManifest(missing)).toBe(false)
    })

    it('returns false for non-object input', () => {
      expect(isValidManifest('string')).toBe(false)
      expect(isValidManifest(null)).toBe(false)
      expect(isValidManifest(undefined)).toBe(false)
      expect(isValidManifest(123)).toBe(false)
    })
  })
})

