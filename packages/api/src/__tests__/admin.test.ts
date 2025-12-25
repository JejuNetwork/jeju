import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import {
  createAdminConfig,
  createAdminConfigFromEnv,
  hasPermission,
  isSuperAdmin,
  requireAdmin,
  requireRole,
  validateAdmin,
} from '../admin/core'
import { type AdminConfig, AdminRole, ROLE_HIERARCHY } from '../admin/types'
import { AuthError, AuthMethod } from '../auth/types'

describe('Admin Core', () => {
  const testConfig: AdminConfig = {
    admins: new Map([
      [
        '0x1111111111111111111111111111111111111111' as Address,
        AdminRole.SUPER_ADMIN,
      ],
      [
        '0x2222222222222222222222222222222222222222' as Address,
        AdminRole.ADMIN,
      ],
      [
        '0x3333333333333333333333333333333333333333' as Address,
        AdminRole.MODERATOR,
      ],
    ]),
  }

  describe('validateAdmin', () => {
    test('validates super admin', () => {
      const result = validateAdmin(
        {
          address: '0x1111111111111111111111111111111111111111' as Address,
          method: AuthMethod.OAUTH3,
        },
        testConfig,
      )

      expect(result.valid).toBe(true)
      if (!result.valid || !result.admin) {
        throw new Error('Expected valid admin result')
      }
      expect(result.admin.role).toBe(AdminRole.SUPER_ADMIN)
    })

    test('validates regular admin', () => {
      const result = validateAdmin(
        {
          address: '0x2222222222222222222222222222222222222222' as Address,
          method: AuthMethod.OAUTH3,
        },
        testConfig,
      )

      expect(result.valid).toBe(true)
      if (!result.valid || !result.admin) {
        throw new Error('Expected valid admin result')
      }
      expect(result.admin.role).toBe(AdminRole.ADMIN)
    })

    test('validates moderator', () => {
      const result = validateAdmin(
        {
          address: '0x3333333333333333333333333333333333333333' as Address,
          method: AuthMethod.OAUTH3,
        },
        testConfig,
      )

      expect(result.valid).toBe(true)
      if (!result.valid || !result.admin) {
        throw new Error('Expected valid admin result')
      }
      expect(result.admin.role).toBe(AdminRole.MODERATOR)
    })

    test('rejects non-admin', () => {
      const result = validateAdmin(
        {
          address: '0x4444444444444444444444444444444444444444' as Address,
          method: AuthMethod.OAUTH3,
        },
        testConfig,
      )

      expect(result.valid).toBe(false)
      expect(result.error).toBe('User is not an admin')
    })

    test('checks required role', () => {
      const configWithRole: AdminConfig = {
        ...testConfig,
        requiredRole: AdminRole.ADMIN,
      }

      // Super admin should pass
      const superResult = validateAdmin(
        {
          address: '0x1111111111111111111111111111111111111111' as Address,
          method: AuthMethod.OAUTH3,
        },
        configWithRole,
      )
      expect(superResult.valid).toBe(true)

      // Admin should pass
      const adminResult = validateAdmin(
        {
          address: '0x2222222222222222222222222222222222222222' as Address,
          method: AuthMethod.OAUTH3,
        },
        configWithRole,
      )
      expect(adminResult.valid).toBe(true)

      // Moderator should fail
      const modResult = validateAdmin(
        {
          address: '0x3333333333333333333333333333333333333333' as Address,
          method: AuthMethod.OAUTH3,
        },
        configWithRole,
      )
      expect(modResult.valid).toBe(false)
      expect(modResult.error).toContain('Insufficient permissions')
    })
  })

  describe('hasPermission', () => {
    test('super admin has all permissions', () => {
      expect(hasPermission(AdminRole.SUPER_ADMIN, AdminRole.SUPER_ADMIN)).toBe(
        true,
      )
      expect(hasPermission(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)).toBe(true)
      expect(hasPermission(AdminRole.SUPER_ADMIN, AdminRole.MODERATOR)).toBe(
        true,
      )
    })

    test('admin has admin and moderator permissions', () => {
      expect(hasPermission(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)).toBe(false)
      expect(hasPermission(AdminRole.ADMIN, AdminRole.ADMIN)).toBe(true)
      expect(hasPermission(AdminRole.ADMIN, AdminRole.MODERATOR)).toBe(true)
    })

    test('moderator only has moderator permission', () => {
      expect(hasPermission(AdminRole.MODERATOR, AdminRole.SUPER_ADMIN)).toBe(
        false,
      )
      expect(hasPermission(AdminRole.MODERATOR, AdminRole.ADMIN)).toBe(false)
      expect(hasPermission(AdminRole.MODERATOR, AdminRole.MODERATOR)).toBe(true)
    })
  })

  describe('requireAdmin', () => {
    test('returns admin for valid admin', () => {
      const admin = requireAdmin(
        {
          address: '0x2222222222222222222222222222222222222222' as Address,
          method: AuthMethod.OAUTH3,
        },
        testConfig,
      )

      expect(admin.address).toBe('0x2222222222222222222222222222222222222222')
      expect(admin.role).toBe(AdminRole.ADMIN)
    })

    test('throws for non-admin', () => {
      expect(() =>
        requireAdmin(
          {
            address: '0x4444444444444444444444444444444444444444' as Address,
            method: AuthMethod.OAUTH3,
          },
          testConfig,
        ),
      ).toThrow(AuthError)
    })
  })

  describe('requireRole', () => {
    test('returns admin for sufficient role', () => {
      const admin = requireRole(
        {
          address: '0x1111111111111111111111111111111111111111' as Address,
          method: AuthMethod.OAUTH3,
        },
        testConfig,
        AdminRole.ADMIN,
      )

      expect(admin.role).toBe(AdminRole.SUPER_ADMIN)
    })

    test('throws for insufficient role', () => {
      expect(() =>
        requireRole(
          {
            address: '0x3333333333333333333333333333333333333333' as Address,
            method: AuthMethod.OAUTH3,
          },
          testConfig,
          AdminRole.ADMIN,
        ),
      ).toThrow(AuthError)
    })
  })

  describe('isSuperAdmin', () => {
    test('returns true for super admin', () => {
      expect(
        isSuperAdmin(
          '0x1111111111111111111111111111111111111111' as Address,
          testConfig,
        ),
      ).toBe(true)
    })

    test('returns false for regular admin', () => {
      expect(
        isSuperAdmin(
          '0x2222222222222222222222222222222222222222' as Address,
          testConfig,
        ),
      ).toBe(false)
    })

    test('returns false for non-admin', () => {
      expect(
        isSuperAdmin(
          '0x4444444444444444444444444444444444444444' as Address,
          testConfig,
        ),
      ).toBe(false)
    })
  })

  describe('createAdminConfig', () => {
    test('creates config from array', () => {
      const config = createAdminConfig([
        {
          address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as Address,
          role: AdminRole.SUPER_ADMIN,
        },
        {
          address: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as Address,
          role: AdminRole.ADMIN,
        },
      ])

      expect(config.admins.size).toBe(2)
      expect(
        config.admins.get(
          '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as Address,
        ),
      ).toBe(AdminRole.SUPER_ADMIN)
    })

    test('creates config with required role', () => {
      const config = createAdminConfig([], AdminRole.ADMIN)
      expect(config.requiredRole).toBe(AdminRole.ADMIN)
    })
  })

  describe('createAdminConfigFromEnv', () => {
    test('parses valid env string', () => {
      const config = createAdminConfigFromEnv(
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:super_admin,0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:admin',
      )

      expect(config.admins.size).toBe(2)
      expect(
        config.admins.get(
          '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as Address,
        ),
      ).toBe(AdminRole.SUPER_ADMIN)
      expect(
        config.admins.get(
          '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as Address,
        ),
      ).toBe(AdminRole.ADMIN)
    })

    test('handles empty string', () => {
      const config = createAdminConfigFromEnv('')
      expect(config.admins.size).toBe(0)
    })

    test('ignores invalid entries', () => {
      const config = createAdminConfigFromEnv(
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:super_admin,invalid,0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:invalid_role',
      )

      expect(config.admins.size).toBe(1)
    })
  })

  describe('ROLE_HIERARCHY', () => {
    test('super admin has highest level', () => {
      expect(ROLE_HIERARCHY[AdminRole.SUPER_ADMIN]).toBeGreaterThan(
        ROLE_HIERARCHY[AdminRole.ADMIN],
      )
      expect(ROLE_HIERARCHY[AdminRole.SUPER_ADMIN]).toBeGreaterThan(
        ROLE_HIERARCHY[AdminRole.MODERATOR],
      )
    })

    test('admin is higher than moderator', () => {
      expect(ROLE_HIERARCHY[AdminRole.ADMIN]).toBeGreaterThan(
        ROLE_HIERARCHY[AdminRole.MODERATOR],
      )
    })
  })
})
