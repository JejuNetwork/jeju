/**
 * Security API Routes
 *
 * REST API for security services (WAF, access control, audit)
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import {
  CreateAPIKeySchema,
  CreateRoleSchema,
  getAccessControl,
} from './access-control'
import { getAuditLogger } from './audit-logger'
import { CreateSecretSchema, getSecretsManager } from './secrets-manager'
import { getWAF, type ThreatType } from './waf'

export function createSecurityRoutes() {
  const waf = getWAF()
  const accessControl = getAccessControl()
  const secretsManager = getSecretsManager()
  const auditLogger = getAuditLogger()

  return (
    new Elysia({ prefix: '/security' })

      // =========================================================================
      // WAF Routes
      // =========================================================================
      .group('/waf', (app) =>
        app
          // WAF stats
          .get('/stats', () => {
            return waf.getStats()
          })

          // List WAF rules
          .get('/rules', () => {
            return { rules: waf.listRules() }
          })

          // Add WAF rule
          .post(
            '/rules',
            async ({ body, headers }) => {
              const owner = headers['x-wallet-address'] as Address
              if (!owner) {
                return { error: 'Unauthorized' }
              }

              const rule = waf.addRule(
                body as Parameters<typeof waf.addRule>[0],
              )

              auditLogger.logAdmin(
                { type: 'user', id: owner, address: owner },
                'policy_updated',
                { type: 'waf_rule', id: rule.ruleId, name: rule.name },
                'success',
                { ipAddress: headers['x-forwarded-for'] as string },
                { action: 'create' },
              )

              return { rule }
            },
            {
              body: t.Object({
                name: t.String(),
                description: t.String(),
                enabled: t.Boolean(),
                mode: t.Union([t.Literal('detect'), t.Literal('block')]),
                priority: t.Number(),
                conditions: t.Array(
                  t.Object({
                    field: t.String(),
                    operator: t.String(),
                    value: t.Union([t.String(), t.Array(t.String())]),
                    negated: t.Optional(t.Boolean()),
                  }),
                ),
                action: t.Union([
                  t.Literal('allow'),
                  t.Literal('block'),
                  t.Literal('challenge'),
                  t.Literal('log'),
                  t.Literal('rate_limit'),
                ]),
              }),
            },
          )

          // Delete WAF rule
          .delete('/rules/:ruleId', async ({ params, headers }) => {
            const owner = headers['x-wallet-address'] as Address
            if (!owner) {
              return { error: 'Unauthorized' }
            }

            waf.removeRule(params.ruleId)

            auditLogger.logAdmin(
              { type: 'user', id: owner, address: owner },
              'policy_updated',
              { type: 'waf_rule', id: params.ruleId },
              'success',
              {},
              { action: 'delete' },
            )

            return { success: true }
          })

          // Block IP
          .post(
            '/block-ip',
            async ({ body, headers }) => {
              const owner = headers['x-wallet-address'] as Address
              if (!owner) {
                return { error: 'Unauthorized' }
              }

              waf.blockIP(body.ip, body.duration)

              auditLogger.logSecurity(
                { type: 'user', id: owner, address: owner },
                'threat_detected',
                'success',
                'medium',
                {},
                { ip: body.ip, action: 'blocked', duration: body.duration },
              )

              return { success: true }
            },
            {
              body: t.Object({
                ip: t.String(),
                duration: t.Optional(t.Number()),
              }),
            },
          )

          // Unblock IP
          .post(
            '/unblock-ip',
            async ({ body, headers }) => {
              const owner = headers['x-wallet-address'] as Address
              if (!owner) {
                return { error: 'Unauthorized' }
              }

              waf.unblockIP(body.ip)

              return { success: true }
            },
            {
              body: t.Object({
                ip: t.String(),
              }),
            },
          )

          // Get security events
          .get('/events', ({ query }) => {
            const q = (query ?? {}) as Record<string, string | undefined>
            const events = waf.getEvents({
              ip: q.ip,
              threatType: q.threatType as ThreatType | undefined,
              limit: q.limit ? parseInt(q.limit, 10) : 100,
            })
            return { events }
          })

          // Get IP reputation
          .get('/reputation/:ip', ({ params }) => {
            const reputation = waf.getIPReputation(params.ip)
            return { reputation }
          }),
      )

      // =========================================================================
      // Access Control Routes
      // =========================================================================
      .group('/access', (app) =>
        app
          // Get current user
          .get('/me', ({ headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const user = accessControl.getUserByAddress(address)
            return { user }
          })

          // List roles
          .get('/roles', () => {
            return { roles: accessControl.listRoles() }
          })

          // Create role
          .post(
            '/roles',
            async ({ body, headers }) => {
              const owner = headers['x-wallet-address'] as Address
              if (!owner) {
                return { error: 'Unauthorized' }
              }

              const params = CreateRoleSchema.parse(body)
              const role = accessControl.createRole(params)

              auditLogger.logAdmin(
                { type: 'user', id: owner, address: owner },
                'policy_updated',
                { type: 'role', id: role.roleId, name: role.name },
                'success',
                {},
                { action: 'create' },
              )

              return { role }
            },
            {
              body: t.Object({
                name: t.String(),
                description: t.Optional(t.String()),
                permissions: t.Array(
                  t.Object({
                    resource: t.String(),
                    actions: t.Array(t.String()),
                    conditions: t.Optional(
                      t.Array(
                        t.Object({
                          attribute: t.String(),
                          operator: t.String(),
                          value: t.Union([t.String(), t.Array(t.String())]),
                        }),
                      ),
                    ),
                  }),
                ),
                inherits: t.Optional(t.Array(t.String())),
              }),
            },
          )

          // Delete role
          .delete('/roles/:roleId', async ({ params, headers }) => {
            const owner = headers['x-wallet-address'] as Address
            if (!owner) {
              return { error: 'Unauthorized' }
            }

            const success = accessControl.deleteRole(params.roleId)

            if (success) {
              auditLogger.logAdmin(
                { type: 'user', id: owner, address: owner },
                'policy_updated',
                { type: 'role', id: params.roleId },
                'success',
                {},
                { action: 'delete' },
              )
            }

            return { success }
          })

          // Assign role to user
          .post(
            '/users/:userId/roles',
            async ({ params, body, headers }) => {
              const owner = headers['x-wallet-address'] as Address
              if (!owner) {
                return { error: 'Unauthorized' }
              }

              accessControl.assignRole(params.userId, body.roleId)

              auditLogger.logAccess(
                { type: 'user', id: owner, address: owner },
                'role_assigned',
                { type: 'user', id: params.userId },
                'success',
                {},
                { roleId: body.roleId },
              )

              return { success: true }
            },
            {
              body: t.Object({
                roleId: t.String(),
              }),
            },
          )

          // Remove role from user
          .delete(
            '/users/:userId/roles/:roleId',
            async ({ params, headers }) => {
              const owner = headers['x-wallet-address'] as Address
              if (!owner) {
                return { error: 'Unauthorized' }
              }

              accessControl.removeRole(params.userId, params.roleId)

              auditLogger.logAccess(
                { type: 'user', id: owner, address: owner },
                'role_removed',
                { type: 'user', id: params.userId },
                'success',
                {},
                { roleId: params.roleId },
              )

              return { success: true }
            },
          )

          // Check access
          .post(
            '/check',
            async ({ body, headers }) => {
              const address = headers['x-wallet-address'] as Address
              if (!address) {
                return { error: 'Unauthorized' }
              }

              const user = accessControl.getUserByAddress(address)
              if (!user) {
                return { allowed: false, reason: 'User not found' }
              }

              const decision = accessControl.checkAccess(
                user.userId,
                body.resource as Parameters<
                  typeof accessControl.checkAccess
                >[1],
                body.action as Parameters<typeof accessControl.checkAccess>[2],
                body.resourceId,
                body.context,
              )

              return decision
            },
            {
              body: t.Object({
                resource: t.String(),
                action: t.String(),
                resourceId: t.Optional(t.String()),
                context: t.Optional(t.Record(t.String(), t.String())),
              }),
            },
          )

          // Create API key
          .post(
            '/api-keys',
            async ({ body, headers }) => {
              const address = headers['x-wallet-address'] as Address
              if (!address) {
                return { error: 'Unauthorized' }
              }

              const user = accessControl.getOrCreateUser(address)
              const params = CreateAPIKeySchema.parse(body)
              const { key, apiKey } = accessControl.createAPIKey(
                user.userId,
                params,
              )

              auditLogger.logAuth(
                { type: 'user', id: user.userId, address },
                'api_key_created',
                'success',
                { ipAddress: headers['x-forwarded-for'] as string },
                { keyId: apiKey.keyId, name: apiKey.name },
              )

              return { key, apiKey }
            },
            {
              body: t.Object({
                name: t.String(),
                scopes: t.Array(t.String()),
                resourceFilter: t.Optional(
                  t.Object({
                    type: t.String(),
                    ids: t.Array(t.String()),
                  }),
                ),
                rateLimit: t.Optional(t.Number()),
                expiresInDays: t.Optional(t.Number()),
              }),
            },
          )

          // List API keys (metadata only)
          .get('/api-keys', ({ headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const user = accessControl.getUserByAddress(address)
            if (!user) {
              return { apiKeys: [] }
            }

            // Return without key hash
            const apiKeys = user.apiKeys.map((k) => ({
              keyId: k.keyId,
              name: k.name,
              prefix: k.prefix,
              scopes: k.scopes,
              rateLimit: k.rateLimit,
              expiresAt: k.expiresAt,
              createdAt: k.createdAt,
              lastUsedAt: k.lastUsedAt,
              usageCount: k.usageCount,
              revokedAt: k.revokedAt,
            }))

            return { apiKeys }
          })

          // Revoke API key
          .delete('/api-keys/:keyId', async ({ params, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const user = accessControl.getUserByAddress(address)
            if (!user) {
              return { error: 'User not found' }
            }

            accessControl.revokeAPIKey(user.userId, params.keyId)

            auditLogger.logAuth(
              { type: 'user', id: user.userId, address },
              'api_key_revoked',
              'success',
              {},
              { keyId: params.keyId },
            )

            return { success: true }
          })

          // List organizations
          .get('/organizations', ({ headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const user = accessControl.getUserByAddress(address)
            if (!user) {
              return { organizations: [] }
            }

            const organizations = accessControl.getUserOrganizations(
              user.userId,
            )
            return { organizations }
          })

          // Create organization
          .post(
            '/organizations',
            async ({ body, headers }) => {
              const address = headers['x-wallet-address'] as Address
              if (!address) {
                return { error: 'Unauthorized' }
              }

              const org = accessControl.createOrganization(
                body.name,
                body.slug,
                address,
              )

              auditLogger.logAdmin(
                { type: 'user', id: address, address },
                'org_created',
                { type: 'organization', id: org.orgId, name: org.name },
                'success',
                {},
                {},
              )

              return { organization: org }
            },
            {
              body: t.Object({
                name: t.String(),
                slug: t.String(),
              }),
            },
          ),
      )

      // =========================================================================
      // Secrets Routes
      // =========================================================================
      .group('/secrets', (app) =>
        app
          // List secrets (metadata only)
          .get('/', ({ headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const secrets = secretsManager.listSecrets(address)
            return { secrets }
          })

          // Create secret
          .post(
            '/',
            async ({ body, headers }) => {
              const address = headers['x-wallet-address'] as Address
              if (!address) {
                return { error: 'Unauthorized' }
              }

              const params = CreateSecretSchema.parse(body)
              const secret = await secretsManager.createSecret(address, params)

              auditLogger.logResource(
                { type: 'user', id: address, address },
                'created',
                { type: 'secret', id: secret.secretId, name: secret.name },
                'success',
                {},
                { scope: secret.scope },
              )

              // Return without shares
              const { ...metadata } = secretsManager.getSecretMetadata(
                secret.secretId,
              )
              return { secret: metadata }
            },
            {
              body: t.Object({
                name: t.String(),
                value: t.String(),
                scope: t.Union([
                  t.Literal('user'),
                  t.Literal('project'),
                  t.Literal('environment'),
                  t.Literal('global'),
                ]),
                scopeId: t.String(),
                expirationDays: t.Optional(t.Number()),
              }),
            },
          )

          // Get secret value
          .get('/:secretId', async ({ params, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const value = await secretsManager.getSecret(
              params.secretId,
              address,
            )
            if (!value) {
              return { error: 'Secret not found or unauthorized' }
            }

            return { value: value.value, version: value.version }
          })

          // Rotate secret
          .post('/:secretId/rotate', async ({ params, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const secret = await secretsManager.rotateSecret(
              params.secretId,
              address,
            )
            if (!secret) {
              return { error: 'Secret not found or unauthorized' }
            }

            auditLogger.logResource(
              { type: 'user', id: address, address },
              'updated',
              { type: 'secret', id: secret.secretId, name: secret.name },
              'success',
              {},
              { action: 'rotate', version: secret.version },
            )

            const metadata = secretsManager.getSecretMetadata(secret.secretId)
            return { secret: metadata }
          })

          // Delete secret
          .delete('/:secretId', async ({ params, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const success = await secretsManager.deleteSecret(
              params.secretId,
              address,
            )

            if (success) {
              auditLogger.logResource(
                { type: 'user', id: address, address },
                'deleted',
                { type: 'secret', id: params.secretId },
                'success',
              )
            }

            return { success }
          })

          // Get environment secrets (for worker injection)
          .get('/env/:scopeId', async ({ params, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const env = await secretsManager.getEnvironmentSecrets(
              params.scopeId,
              address,
            )
            return { env }
          }),
      )

      // =========================================================================
      // Audit Routes
      // =========================================================================
      .group('/audit', (app) =>
        app
          // Query audit logs
          .get('/logs', ({ query, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            // Check if user has audit read permission
            const user = accessControl.getUserByAddress(address)
            if (!user) {
              return { error: 'Unauthorized' }
            }

            const decision = accessControl.checkAccess(
              user.userId,
              'audit',
              'read',
            )
            if (!decision.allowed) {
              return { error: 'Forbidden' }
            }

            const q = query ?? {}
            type CategoryType = Parameters<
              typeof auditLogger.query
            >[0]['category']
            type OutcomeType = Parameters<
              typeof auditLogger.query
            >[0]['outcome']
            const result = auditLogger.query({
              actorId: q.actorId as string | undefined,
              category: q.category ? ([q.category] as CategoryType) : undefined,
              outcome: q.outcome ? ([q.outcome] as OutcomeType) : undefined,
              startTime: q.startTime
                ? parseInt(q.startTime as string, 10)
                : undefined,
              endTime: q.endTime
                ? parseInt(q.endTime as string, 10)
                : undefined,
              search: q.search as string | undefined,
              limit: q.limit ? parseInt(q.limit as string, 10) : 100,
              offset: q.offset ? parseInt(q.offset as string, 10) : 0,
            })

            return result
          })

          // Get single audit event
          .get('/logs/:eventId', ({ params, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const event = auditLogger.getEvent(params.eventId)
            return { event }
          })

          // Get audit stats
          .get('/stats', ({ headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            return auditLogger.getStats()
          })

          // Verify audit integrity
          .get('/verify', ({ query, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const result = auditLogger.verifyIntegrity(
              query.startEventId as string,
              query.endEventId as string,
            )

            return result
          })

          // Generate compliance report
          .post(
            '/reports',
            async ({ body, headers }) => {
              const address = headers['x-wallet-address'] as Address
              if (!address) {
                return { error: 'Unauthorized' }
              }

              const report = auditLogger.generateComplianceReport(
                body.type as Parameters<
                  typeof auditLogger.generateComplianceReport
                >[0],
                body.startTime,
                body.endTime,
              )

              auditLogger.logAdmin(
                { type: 'user', id: address, address },
                'backup_created',
                { type: 'compliance_report', id: report.reportId },
                'success',
                {},
                { type: body.type },
              )

              return { report }
            },
            {
              body: t.Object({
                type: t.Union([
                  t.Literal('soc2'),
                  t.Literal('gdpr'),
                  t.Literal('hipaa'),
                  t.Literal('pci'),
                  t.Literal('custom'),
                ]),
                startTime: t.Number(),
                endTime: t.Number(),
              }),
            },
          )

          // Export audit logs
          .get('/export', ({ query, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            const format = (query.format as 'json' | 'csv') ?? 'json'
            const data = auditLogger.export(
              {
                startTime: query.startTime
                  ? parseInt(query.startTime as string, 10)
                  : undefined,
                endTime: query.endTime
                  ? parseInt(query.endTime as string, 10)
                  : undefined,
                limit: query.limit ? parseInt(query.limit as string, 10) : 1000,
              },
              format,
            )

            const contentType =
              format === 'json' ? 'application/json' : 'text/csv'
            const filename = `audit-logs-${Date.now()}.${format}`

            return new Response(data, {
              headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${filename}"`,
              },
            })
          }),
      )

      // SPA fallback for frontend routes like /security/keys, /security/secrets, /security/oauth3
      // These are frontend pages that conflict with the /security API prefix
      .get('/*', async ({ set }) => {
        // Serve index.html for frontend SPA routing
        const file = Bun.file('./dist/index.html')
        if (await file.exists()) {
          const html = await file.text()
          return new Response(html, {
            headers: {
              'Content-Type': 'text/html',
              'X-DWS-Source': 'local',
            },
          })
        }

        set.status = 404
        return { error: 'Frontend not available' }
      })
  )
}
