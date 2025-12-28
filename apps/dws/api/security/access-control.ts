import { createHash, randomBytes } from 'node:crypto'
import type { Address } from 'viem'
import { z } from 'zod'

export type Permission =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'deploy'
  | 'manage'
  | 'admin'
  | '*' // Wildcard

export type ResourceType =
  | 'project'
  | 'deployment'
  | 'worker'
  | 'database'
  | 'secret'
  | 'domain'
  | 'certificate'
  | 'team'
  | 'organization'
  | 'billing'
  | 'audit'

export interface Role {
  roleId: string
  name: string
  description: string
  permissions: ResourcePermission[]
  inherits?: string[] // Other role IDs
  isBuiltIn: boolean
  createdAt: number
  updatedAt: number
}

export interface ResourcePermission {
  resource: ResourceType | '*'
  actions: Permission[]
  conditions?: PermissionCondition[]
}

export interface PermissionCondition {
  attribute: string
  operator:
    | 'equals'
    | 'not_equals'
    | 'in'
    | 'not_in'
    | 'contains'
    | 'starts_with'
  value: string | string[]
}

export interface User {
  userId: string
  address: Address
  email?: string
  name?: string

  // Access
  roles: string[] // Role IDs
  directPermissions: ResourcePermission[]

  // Organization
  organizations: OrganizationMembership[]

  // Auth
  apiKeys: APIKey[]
  sessions: Session[]

  // Status
  active: boolean
  verified: boolean
  mfaEnabled: boolean

  createdAt: number
  updatedAt: number
  lastLoginAt?: number
}

export interface OrganizationMembership {
  orgId: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  teams: string[]
  joinedAt: number
}

export interface Organization {
  orgId: string
  name: string
  slug: string
  owner: Address

  // Members
  members: Array<{ userId: string; role: string; joinedAt: number }>

  // Teams
  teams: Team[]

  // Settings
  settings: {
    defaultRole: string
    requireMFA: boolean
    allowedDomains: string[]
    ssoEnabled: boolean
    ssoProvider?: string
  }

  createdAt: number
  updatedAt: number
}

export interface Team {
  teamId: string
  name: string
  description: string
  members: string[] // User IDs
  roles: string[] // Roles inherited by all members
  createdAt: number
}

export interface APIKey {
  keyId: string
  name: string
  keyHash: string // Hashed key
  prefix: string // First 8 chars for identification

  // Permissions
  scopes: Permission[]
  resourceFilter?: {
    type: ResourceType
    ids: string[]
  }

  // Limits
  rateLimit?: number // Requests per hour
  expiresAt?: number

  // Usage
  lastUsedAt?: number
  usageCount: number

  createdAt: number
  revokedAt?: number
}

export interface Session {
  sessionId: string
  userId: string

  // Auth info
  ipAddress: string
  userAgent: string
  method: 'wallet' | 'oauth' | 'api_key'

  // Timing
  createdAt: number
  expiresAt: number
  lastActivityAt: number

  // Status
  active: boolean
  revokedAt?: number
}

export interface AccessDecision {
  allowed: boolean
  reason: string
  matchedRole?: string
  matchedPermission?: ResourcePermission
}

// ============================================================================
// Schemas
// ============================================================================

export const CreateRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(
    z.object({
      resource: z.string(),
      actions: z.array(z.string()),
      conditions: z
        .array(
          z.object({
            attribute: z.string(),
            operator: z.enum([
              'equals',
              'not_equals',
              'in',
              'not_in',
              'contains',
              'starts_with',
            ]),
            value: z.union([z.string(), z.array(z.string())]),
          }),
        )
        .optional(),
    }),
  ),
  inherits: z.array(z.string()).optional(),
})

export const CreateAPIKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()),
  resourceFilter: z
    .object({
      type: z.string(),
      ids: z.array(z.string()),
    })
    .optional(),
  rateLimit: z.number().min(1).max(100000).optional(),
  expiresInDays: z.number().min(1).max(365).optional(),
})

// ============================================================================
// Access Control Manager
// ============================================================================

export class AccessControlManager {
  private users = new Map<string, User>()
  private usersByAddress = new Map<Address, string>() // address -> userId
  private organizations = new Map<string, Organization>()
  private roles = new Map<string, Role>()
  private sessions = new Map<string, Session>()
  private apiKeysByHash = new Map<string, { userId: string; key: APIKey }>()

  constructor() {
    this.initializeBuiltInRoles()
  }

  private initializeBuiltInRoles(): void {
    // Super Admin
    this.roles.set('super_admin', {
      roleId: 'super_admin',
      name: 'Super Admin',
      description: 'Full access to everything',
      permissions: [{ resource: '*', actions: ['*'] }],
      isBuiltIn: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    // Organization Admin
    this.roles.set('org_admin', {
      roleId: 'org_admin',
      name: 'Organization Admin',
      description: 'Full access to organization resources',
      permissions: [
        {
          resource: 'project',
          actions: ['create', 'read', 'update', 'delete', 'manage'],
        },
        {
          resource: 'deployment',
          actions: ['create', 'read', 'update', 'delete', 'deploy'],
        },
        {
          resource: 'worker',
          actions: ['create', 'read', 'update', 'delete', 'deploy'],
        },
        {
          resource: 'database',
          actions: ['create', 'read', 'update', 'delete', 'manage'],
        },
        { resource: 'secret', actions: ['create', 'read', 'update', 'delete'] },
        {
          resource: 'team',
          actions: ['create', 'read', 'update', 'delete', 'manage'],
        },
        { resource: 'billing', actions: ['read', 'update'] },
        { resource: 'audit', actions: ['read'] },
      ],
      isBuiltIn: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    // Developer
    this.roles.set('developer', {
      roleId: 'developer',
      name: 'Developer',
      description: 'Can deploy and manage applications',
      permissions: [
        { resource: 'project', actions: ['read', 'update'] },
        {
          resource: 'deployment',
          actions: ['create', 'read', 'update', 'deploy'],
        },
        { resource: 'worker', actions: ['create', 'read', 'update', 'deploy'] },
        { resource: 'database', actions: ['read'] },
        { resource: 'secret', actions: ['read'] },
      ],
      isBuiltIn: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    // Viewer
    this.roles.set('viewer', {
      roleId: 'viewer',
      name: 'Viewer',
      description: 'Read-only access',
      permissions: [
        { resource: 'project', actions: ['read'] },
        { resource: 'deployment', actions: ['read'] },
        { resource: 'worker', actions: ['read'] },
        { resource: 'database', actions: ['read'] },
      ],
      isBuiltIn: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }

  // =========================================================================
  // User Management
  // =========================================================================

  createUser(
    address: Address,
    options?: { email?: string; name?: string },
  ): User {
    const userId = createHash('sha256')
      .update(`${address}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const user: User = {
      userId,
      address,
      email: options?.email,
      name: options?.name,
      roles: [],
      directPermissions: [],
      organizations: [],
      apiKeys: [],
      sessions: [],
      active: true,
      verified: false,
      mfaEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.users.set(userId, user)
    this.usersByAddress.set(address, userId)

    return user
  }

  getUserByAddress(address: Address): User | undefined {
    const userId = this.usersByAddress.get(address)
    return userId ? this.users.get(userId) : undefined
  }

  getOrCreateUser(address: Address): User {
    const existing = this.getUserByAddress(address)
    if (existing) return existing
    return this.createUser(address)
  }

  updateUser(
    userId: string,
    updates: Partial<Pick<User, 'email' | 'name' | 'mfaEnabled'>>,
  ): User | null {
    const user = this.users.get(userId)
    if (!user) return null

    if (updates.email !== undefined) user.email = updates.email
    if (updates.name !== undefined) user.name = updates.name
    if (updates.mfaEnabled !== undefined) user.mfaEnabled = updates.mfaEnabled
    user.updatedAt = Date.now()

    return user
  }

  assignRole(userId: string, roleId: string): void {
    const user = this.users.get(userId)
    if (!user) throw new Error(`User not found: ${userId}`)
    if (!this.roles.has(roleId)) throw new Error(`Role not found: ${roleId}`)

    if (!user.roles.includes(roleId)) {
      user.roles.push(roleId)
      user.updatedAt = Date.now()
    }
  }

  removeRole(userId: string, roleId: string): void {
    const user = this.users.get(userId)
    if (!user) throw new Error(`User not found: ${userId}`)

    user.roles = user.roles.filter((r) => r !== roleId)
    user.updatedAt = Date.now()
  }

  // =========================================================================
  // Role Management
  // =========================================================================

  createRole(params: z.infer<typeof CreateRoleSchema>): Role {
    const roleId = createHash('sha256')
      .update(`${params.name}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const role: Role = {
      roleId,
      name: params.name,
      description: params.description ?? '',
      permissions: params.permissions as ResourcePermission[],
      inherits: params.inherits,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.roles.set(roleId, role)

    return role
  }

  updateRole(
    roleId: string,
    updates: Partial<Omit<Role, 'roleId' | 'isBuiltIn' | 'createdAt'>>,
  ): Role | null {
    const role = this.roles.get(roleId)
    if (!role || role.isBuiltIn) return null

    Object.assign(role, updates)
    role.updatedAt = Date.now()

    return role
  }

  deleteRole(roleId: string): boolean {
    const role = this.roles.get(roleId)
    if (!role || role.isBuiltIn) return false

    this.roles.delete(roleId)

    // Remove from all users
    for (const user of this.users.values()) {
      user.roles = user.roles.filter((r) => r !== roleId)
    }

    return true
  }

  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId)
  }

  listRoles(): Role[] {
    return Array.from(this.roles.values())
  }

  // =========================================================================
  // Organization Management
  // =========================================================================

  createOrganization(name: string, slug: string, owner: Address): Organization {
    const orgId = createHash('sha256')
      .update(`${slug}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    // Get or create owner user
    const ownerUser = this.getOrCreateUser(owner)

    const org: Organization = {
      orgId,
      name,
      slug,
      owner,
      members: [
        { userId: ownerUser.userId, role: 'owner', joinedAt: Date.now() },
      ],
      teams: [],
      settings: {
        defaultRole: 'viewer',
        requireMFA: false,
        allowedDomains: [],
        ssoEnabled: false,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.organizations.set(orgId, org)

    // Add org to owner's memberships
    ownerUser.organizations.push({
      orgId,
      role: 'owner',
      teams: [],
      joinedAt: Date.now(),
    })

    return org
  }

  addOrgMember(
    orgId: string,
    userId: string,
    role: 'admin' | 'member' | 'viewer',
  ): void {
    const org = this.organizations.get(orgId)
    if (!org) throw new Error(`Organization not found: ${orgId}`)

    const user = this.users.get(userId)
    if (!user) throw new Error(`User not found: ${userId}`)

    // Check if already member
    if (org.members.some((m) => m.userId === userId)) {
      throw new Error('User is already a member')
    }

    org.members.push({ userId, role, joinedAt: Date.now() })
    user.organizations.push({ orgId, role, teams: [], joinedAt: Date.now() })
  }

  removeOrgMember(orgId: string, userId: string): void {
    const org = this.organizations.get(orgId)
    if (!org) throw new Error(`Organization not found: ${orgId}`)

    const user = this.users.get(userId)
    if (!user) return

    org.members = org.members.filter((m) => m.userId !== userId)
    user.organizations = user.organizations.filter((o) => o.orgId !== orgId)
  }

  createTeam(orgId: string, name: string, description: string): Team {
    const org = this.organizations.get(orgId)
    if (!org) throw new Error(`Organization not found: ${orgId}`)

    const team: Team = {
      teamId: createHash('sha256')
        .update(`${orgId}-${name}-${Date.now()}`)
        .digest('hex')
        .slice(0, 16),
      name,
      description,
      members: [],
      roles: [],
      createdAt: Date.now(),
    }

    org.teams.push(team)

    return team
  }

  // =========================================================================
  // API Keys
  // =========================================================================

  createAPIKey(
    userId: string,
    params: z.infer<typeof CreateAPIKeySchema>,
  ): { key: string; apiKey: APIKey } {
    const user = this.users.get(userId)
    if (!user) throw new Error(`User not found: ${userId}`)

    // Generate key
    const rawKey = `dws_${randomBytes(32).toString('hex')}`
    const keyHash = createHash('sha256').update(rawKey).digest('hex')
    const prefix = rawKey.slice(0, 12)

    const apiKey: APIKey = {
      keyId: createHash('sha256')
        .update(`${userId}-${Date.now()}`)
        .digest('hex')
        .slice(0, 16),
      name: params.name,
      keyHash,
      prefix,
      scopes: params.scopes as Permission[],
      resourceFilter: params.resourceFilter as APIKey['resourceFilter'],
      rateLimit: params.rateLimit,
      expiresAt: params.expiresInDays
        ? Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000
        : undefined,
      usageCount: 0,
      createdAt: Date.now(),
    }

    user.apiKeys.push(apiKey)
    this.apiKeysByHash.set(keyHash, { userId, key: apiKey })

    return { key: rawKey, apiKey }
  }

  validateAPIKey(rawKey: string): {
    valid: boolean
    userId?: string
    apiKey?: APIKey
  } {
    const keyHash = createHash('sha256').update(rawKey).digest('hex')
    const entry = this.apiKeysByHash.get(keyHash)

    if (!entry) {
      return { valid: false }
    }

    const { userId, key } = entry

    // Check if revoked
    if (key.revokedAt) {
      return { valid: false }
    }

    // Check expiration
    if (key.expiresAt && key.expiresAt < Date.now()) {
      return { valid: false }
    }

    // Update usage
    key.lastUsedAt = Date.now()
    key.usageCount++

    return { valid: true, userId, apiKey: key }
  }

  revokeAPIKey(userId: string, keyId: string): void {
    const user = this.users.get(userId)
    if (!user) return

    const key = user.apiKeys.find((k) => k.keyId === keyId)
    if (key) {
      key.revokedAt = Date.now()
      this.apiKeysByHash.delete(key.keyHash)
    }
  }

  // =========================================================================
  // Sessions
  // =========================================================================

  createSession(
    userId: string,
    ipAddress: string,
    userAgent: string,
    method: Session['method'],
  ): Session {
    const sessionId = randomBytes(32).toString('hex')

    const session: Session = {
      sessionId,
      userId,
      ipAddress,
      userAgent,
      method,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      lastActivityAt: Date.now(),
      active: true,
    }

    this.sessions.set(sessionId, session)

    const user = this.users.get(userId)
    if (user) {
      user.sessions.push(session)
      user.lastLoginAt = Date.now()
    }

    return session
  }

  validateSession(sessionId: string): {
    valid: boolean
    userId?: string
    session?: Session
  } {
    const session = this.sessions.get(sessionId)

    if (!session) {
      return { valid: false }
    }

    if (!session.active || session.revokedAt) {
      return { valid: false }
    }

    if (session.expiresAt < Date.now()) {
      session.active = false
      return { valid: false }
    }

    // Update activity
    session.lastActivityAt = Date.now()

    return { valid: true, userId: session.userId, session }
  }

  revokeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.active = false
      session.revokedAt = Date.now()
    }
  }

  revokeAllSessions(userId: string): void {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        session.active = false
        session.revokedAt = Date.now()
      }
    }
  }

  // =========================================================================
  // Access Control
  // =========================================================================

  checkAccess(
    userId: string,
    resource: ResourceType,
    action: Permission,
    _resourceId?: string,
    context?: Record<string, string>,
  ): AccessDecision {
    const user = this.users.get(userId)
    if (!user) {
      return { allowed: false, reason: 'User not found' }
    }

    if (!user.active) {
      return { allowed: false, reason: 'User is inactive' }
    }

    // Check direct permissions first
    for (const perm of user.directPermissions) {
      if (this.matchesPermission(perm, resource, action, context)) {
        return {
          allowed: true,
          reason: 'Direct permission',
          matchedPermission: perm,
        }
      }
    }

    // Check role permissions
    const allRoles = this.expandRoles(user.roles)
    for (const roleId of allRoles) {
      const role = this.roles.get(roleId)
      if (!role) continue

      for (const perm of role.permissions) {
        if (this.matchesPermission(perm, resource, action, context)) {
          return {
            allowed: true,
            reason: 'Role permission',
            matchedRole: roleId,
            matchedPermission: perm,
          }
        }
      }
    }

    // Check organization roles
    for (const membership of user.organizations) {
      const org = this.organizations.get(membership.orgId)
      if (!org) continue

      // Organization owners have full access to their org
      if (membership.role === 'owner') {
        return { allowed: true, reason: 'Organization owner' }
      }

      // Map org role to permissions
      const orgRolePerms = this.getOrgRolePermissions(membership.role)
      for (const perm of orgRolePerms) {
        if (this.matchesPermission(perm, resource, action, context)) {
          return {
            allowed: true,
            reason: `Organization ${membership.role}`,
            matchedPermission: perm,
          }
        }
      }
    }

    return { allowed: false, reason: 'No matching permission' }
  }

  private matchesPermission(
    perm: ResourcePermission,
    resource: ResourceType,
    action: Permission,
    context?: Record<string, string>,
  ): boolean {
    // Check resource match
    if (perm.resource !== '*' && perm.resource !== resource) {
      return false
    }

    // Check action match
    if (!perm.actions.includes('*') && !perm.actions.includes(action)) {
      return false
    }

    // Check conditions
    if (perm.conditions) {
      for (const condition of perm.conditions) {
        const contextValue = context?.[condition.attribute]
        if (!contextValue) return false

        let matches = false
        switch (condition.operator) {
          case 'equals':
            matches = contextValue === condition.value
            break
          case 'not_equals':
            matches = contextValue !== condition.value
            break
          case 'in':
            matches = (condition.value as string[]).includes(contextValue)
            break
          case 'not_in':
            matches = !(condition.value as string[]).includes(contextValue)
            break
          case 'contains':
            matches = contextValue.includes(condition.value as string)
            break
          case 'starts_with':
            matches = contextValue.startsWith(condition.value as string)
            break
        }

        if (!matches) return false
      }
    }

    return true
  }

  private expandRoles(roleIds: string[]): string[] {
    const expanded = new Set<string>()

    const expand = (id: string) => {
      if (expanded.has(id)) return
      expanded.add(id)

      const role = this.roles.get(id)
      if (role?.inherits) {
        for (const inheritId of role.inherits) {
          expand(inheritId)
        }
      }
    }

    for (const id of roleIds) {
      expand(id)
    }

    return Array.from(expanded)
  }

  private getOrgRolePermissions(
    role: 'owner' | 'admin' | 'member' | 'viewer',
  ): ResourcePermission[] {
    switch (role) {
      case 'owner':
        return [{ resource: '*', actions: ['*'] }]
      case 'admin':
        return this.roles.get('org_admin')?.permissions ?? []
      case 'member':
        return this.roles.get('developer')?.permissions ?? []
      case 'viewer':
        return this.roles.get('viewer')?.permissions ?? []
    }
  }

  // =========================================================================
  // Queries
  // =========================================================================

  getUser(userId: string): User | undefined {
    return this.users.get(userId)
  }

  listUsers(): User[] {
    return Array.from(this.users.values())
  }

  getOrganization(orgId: string): Organization | undefined {
    return this.organizations.get(orgId)
  }

  listOrganizations(): Organization[] {
    return Array.from(this.organizations.values())
  }

  getUserOrganizations(userId: string): Organization[] {
    const user = this.users.get(userId)
    if (!user) return []

    return user.organizations
      .map((m) => this.organizations.get(m.orgId))
      .filter((o): o is Organization => o !== undefined)
  }
}

// ============================================================================
// Factory
// ============================================================================

let accessControl: AccessControlManager | null = null

export function getAccessControl(): AccessControlManager {
  if (!accessControl) {
    accessControl = new AccessControlManager()
  }
  return accessControl
}
