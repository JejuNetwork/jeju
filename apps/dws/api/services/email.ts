/**
 * Jeju Email Service Provisioner for DWS
 *
 * Deploys decentralized email infrastructure:
 * - Relay service (core MTA)
 * - IMAP server for retrieval
 * - SMTP submission server
 * - Web2 bridge for legacy email
 *
 * Features:
 * - JNS-based email addresses (@*.jeju)
 * - DKIM signing and verification
 * - Decentralized storage on IPFS
 * - Rate limiting based on stake level
 * - AI-powered content moderation
 *
 * Replaces: packages/deployment/kubernetes/helm/email
 */

import type { Address } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import type { HardwareSpec } from '../containers/provisioner'
import {
  getStatefulProvisioner,
  type StatefulService,
  type StatefulServiceConfig,
} from '../containers/stateful-provisioner'
import {
  deregisterService,
  registerTypedService,
  type ServiceEndpoint,
} from './discovery'

// ============================================================================
// Types
// ============================================================================

export type StakeTier = 'free' | 'staked' | 'premium'

export interface RateLimits {
  emailsPerDay: number
  emailsPerHour: number
  maxRecipients: number
  maxAttachmentSizeMb: number
}

export interface EmailConfig {
  name: string
  namespace: string
  emailDomain: string
  relay: {
    replicas: number
    rateLimits: Record<StakeTier, RateLimits>
  }
  imap: {
    enabled: boolean
    replicas: number
  }
  smtp: {
    enabled: boolean
    replicas: number
  }
  bridge: {
    enabled: boolean
    replicas: number
    sesRegion?: string
  }
  moderation: {
    enabled: boolean
    aiModelEndpoint?: string
  }
  dws: {
    endpoint: string
    rpcUrl: string
    emailRegistryAddress: Address
  }
  hardware?: Partial<HardwareSpec>
}

export const EmailConfigSchema = z.object({
  name: z.string().default('jeju-email'),
  namespace: z.string().default('default'),
  emailDomain: z.string().default('jeju.mail'),
  relay: z.object({
    replicas: z.number().min(1).max(10).default(3),
    rateLimits: z.record(
      z.enum(['free', 'staked', 'premium']),
      z.object({
        emailsPerDay: z.number(),
        emailsPerHour: z.number(),
        maxRecipients: z.number(),
        maxAttachmentSizeMb: z.number(),
      }),
    ),
  }),
  imap: z.object({
    enabled: z.boolean().default(true),
    replicas: z.number().min(1).max(5).default(2),
  }),
  smtp: z.object({
    enabled: z.boolean().default(true),
    replicas: z.number().min(1).max(5).default(2),
  }),
  bridge: z.object({
    enabled: z.boolean().default(true),
    replicas: z.number().min(1).max(5).default(2),
    sesRegion: z.string().optional(),
  }),
  moderation: z.object({
    enabled: z.boolean().default(true),
    aiModelEndpoint: z.string().optional(),
  }),
  dws: z.object({
    endpoint: z.string().url(),
    rpcUrl: z.string().url(),
    emailRegistryAddress: z.string(),
  }),
  hardware: z
    .object({
      cpuCores: z.number().optional(),
      memoryMb: z.number().optional(),
    })
    .optional(),
})

// Email Service State
export interface EmailService {
  id: string
  name: string
  namespace: string
  owner: Address
  emailDomain: string
  components: {
    relay: StatefulService
    imap?: StatefulService
    smtp?: StatefulService
    bridge?: StatefulService
  }
  endpoints: {
    relay: string
    imap?: string
    smtp?: string
    api: string
  }
  status: 'creating' | 'ready' | 'degraded' | 'failed'
  createdAt: number
}

// ============================================================================
// Service Defaults
// ============================================================================

const RELAY_IMAGE = 'ghcr.io/jejunetwork/jeju-email-relay'
const IMAP_IMAGE = 'ghcr.io/jejunetwork/jeju-email-imap'
const SMTP_IMAGE = 'ghcr.io/jejunetwork/jeju-email-smtp'
const BRIDGE_IMAGE = 'ghcr.io/jejunetwork/jeju-email-bridge'
const IMAGE_TAG = 'latest'

const RELAY_PORT = 3300
const IMAP_PORT = 993
const SMTP_PORT = 587

const DEFAULT_HARDWARE: HardwareSpec = {
  cpuCores: 1,
  cpuArchitecture: 'amd64',
  memoryMb: 512,
  storageMb: 10240,
  storageType: 'ssd',
  gpuType: 'none',
  gpuCount: 0,
  networkBandwidthMbps: 1000,
  publicIp: false,
  teePlatform: 'none',
}

const DEFAULT_RATE_LIMITS: Record<StakeTier, RateLimits> = {
  free: {
    emailsPerDay: 50,
    emailsPerHour: 10,
    maxRecipients: 5,
    maxAttachmentSizeMb: 5,
  },
  staked: {
    emailsPerDay: 500,
    emailsPerHour: 100,
    maxRecipients: 50,
    maxAttachmentSizeMb: 25,
  },
  premium: {
    emailsPerDay: 5000,
    emailsPerHour: 1000,
    maxRecipients: 500,
    maxAttachmentSizeMb: 100,
  },
}

// ============================================================================
// Email Service Registry
// ============================================================================

const emailServices = new Map<string, EmailService>()

// ============================================================================
// Email Provisioner
// ============================================================================

/**
 * Deploy Jeju Email service on DWS
 */
export async function deployEmail(
  owner: Address,
  config: EmailConfig,
): Promise<EmailService> {
  const validatedConfig = EmailConfigSchema.parse(config)

  console.log(
    `[EmailService] Deploying ${validatedConfig.name} for domain ${validatedConfig.emailDomain}`,
  )

  const statefulProvisioner = getStatefulProvisioner()
  const serviceId = `email-${keccak256(toBytes(`${validatedConfig.name}-${owner}-${Date.now()}`)).slice(2, 18)}`

  // Build hardware spec
  const hardware: HardwareSpec = {
    ...DEFAULT_HARDWARE,
    ...validatedConfig.hardware,
  }

  // Common environment
  const commonEnv = {
    EMAIL_DOMAIN: validatedConfig.emailDomain,
    JEJU_RPC_URL: validatedConfig.dws.rpcUrl,
    DWS_ENDPOINT: validatedConfig.dws.endpoint,
    EMAIL_REGISTRY_ADDRESS: validatedConfig.dws.emailRegistryAddress,
    CONTENT_SCREENING_ENABLED: String(validatedConfig.moderation.enabled),
  }

  if (validatedConfig.moderation.aiModelEndpoint) {
    ;(commonEnv as Record<string, string>).AI_MODEL_ENDPOINT =
      validatedConfig.moderation.aiModelEndpoint
  }

  // Deploy Relay service
  const relayConfig: StatefulServiceConfig = {
    name: `${validatedConfig.name}-relay`,
    namespace: validatedConfig.namespace,
    replicas: validatedConfig.relay.replicas,
    image: RELAY_IMAGE,
    tag: IMAGE_TAG,
    env: {
      ...commonEnv,
      RELAY_PORT: String(RELAY_PORT),
      RATE_LIMITS_FREE: JSON.stringify(
        validatedConfig.relay.rateLimits.free ?? DEFAULT_RATE_LIMITS.free,
      ),
      RATE_LIMITS_STAKED: JSON.stringify(
        validatedConfig.relay.rateLimits.staked ?? DEFAULT_RATE_LIMITS.staked,
      ),
      RATE_LIMITS_PREMIUM: JSON.stringify(
        validatedConfig.relay.rateLimits.premium ?? DEFAULT_RATE_LIMITS.premium,
      ),
    },
    ports: [{ name: 'relay', containerPort: RELAY_PORT, protocol: 'tcp' }],
    hardware,
    volumes: [],
    healthCheck: {
      path: '/health',
      port: RELAY_PORT,
      intervalSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
      successThreshold: 1,
    },
    labels: { 'dws.service.type': 'email', 'dws.email.component': 'relay' },
    annotations: {},
    terminationGracePeriodSeconds: 30,
  }

  const relayService = await statefulProvisioner.create(owner, relayConfig)

  const components: EmailService['components'] = { relay: relayService }
  const endpoints: EmailService['endpoints'] = {
    relay: `http://${validatedConfig.name}-relay.${validatedConfig.namespace}.svc.jeju:${RELAY_PORT}`,
    api: `https://${validatedConfig.name}.${validatedConfig.namespace}.svc.jeju`,
  }

  // Deploy IMAP service if enabled
  if (validatedConfig.imap.enabled) {
    const imapConfig: StatefulServiceConfig = {
      name: `${validatedConfig.name}-imap`,
      namespace: validatedConfig.namespace,
      replicas: validatedConfig.imap.replicas,
      image: IMAP_IMAGE,
      tag: IMAGE_TAG,
      env: {
        ...commonEnv,
        IMAP_PORT: String(IMAP_PORT),
        SSL_MIN_PROTOCOL: 'TLSv1.2',
        AUTH_MECHANISMS: 'oauthbearer xoauth2',
      },
      ports: [{ name: 'imap', containerPort: IMAP_PORT, protocol: 'tcp' }],
      hardware: { ...hardware, publicIp: true },
      volumes: [
        {
          name: 'maildir',
          sizeMb: 102400, // 100GB for mail storage
          tier: 'ssd',
          mountPath: '/var/mail',
          backup: {
            enabled: true,
            intervalSeconds: 3600,
            retentionCount: 24,
            ipfsPin: true,
          },
        },
      ],
      healthCheck: {
        path: '/health',
        port: IMAP_PORT,
        intervalSeconds: 10,
        timeoutSeconds: 5,
        failureThreshold: 3,
        successThreshold: 1,
      },
      labels: { 'dws.service.type': 'email', 'dws.email.component': 'imap' },
      annotations: {},
      terminationGracePeriodSeconds: 30,
    }

    components.imap = await statefulProvisioner.create(owner, imapConfig)
    endpoints.imap = `imaps://${validatedConfig.name}-imap.${validatedConfig.namespace}.svc.jeju:${IMAP_PORT}`
  }

  // Deploy SMTP service if enabled
  if (validatedConfig.smtp.enabled) {
    const smtpConfig: StatefulServiceConfig = {
      name: `${validatedConfig.name}-smtp`,
      namespace: validatedConfig.namespace,
      replicas: validatedConfig.smtp.replicas,
      image: SMTP_IMAGE,
      tag: IMAGE_TAG,
      env: {
        ...commonEnv,
        SMTP_PORT: String(SMTP_PORT),
        DKIM_SELECTOR: 'default',
      },
      ports: [{ name: 'smtp', containerPort: SMTP_PORT, protocol: 'tcp' }],
      hardware: { ...hardware, publicIp: true },
      volumes: [],
      healthCheck: {
        path: '/health',
        port: SMTP_PORT,
        intervalSeconds: 10,
        timeoutSeconds: 5,
        failureThreshold: 3,
        successThreshold: 1,
      },
      labels: { 'dws.service.type': 'email', 'dws.email.component': 'smtp' },
      annotations: {},
      terminationGracePeriodSeconds: 30,
    }

    components.smtp = await statefulProvisioner.create(owner, smtpConfig)
    endpoints.smtp = `smtps://${validatedConfig.name}-smtp.${validatedConfig.namespace}.svc.jeju:${SMTP_PORT}`
  }

  // Deploy Bridge service if enabled
  if (validatedConfig.bridge.enabled) {
    const bridgeEnv: Record<string, string> = {
      ...commonEnv,
    }
    if (validatedConfig.bridge.sesRegion) {
      bridgeEnv.SES_REGION = validatedConfig.bridge.sesRegion
    }

    const bridgeConfig: StatefulServiceConfig = {
      name: `${validatedConfig.name}-bridge`,
      namespace: validatedConfig.namespace,
      replicas: validatedConfig.bridge.replicas,
      image: BRIDGE_IMAGE,
      tag: IMAGE_TAG,
      env: bridgeEnv,
      ports: [{ name: 'bridge', containerPort: 3400, protocol: 'tcp' }],
      hardware,
      volumes: [],
      healthCheck: {
        path: '/health',
        port: 3400,
        intervalSeconds: 10,
        timeoutSeconds: 5,
        failureThreshold: 3,
        successThreshold: 1,
      },
      labels: { 'dws.service.type': 'email', 'dws.email.component': 'bridge' },
      annotations: {},
      terminationGracePeriodSeconds: 30,
    }

    components.bridge = await statefulProvisioner.create(owner, bridgeConfig)
  }

  // Register main relay with service discovery
  const relayEndpoints: ServiceEndpoint[] = relayService.replicas.map((r) => ({
    ordinal: r.ordinal,
    podName: r.podName,
    ip: extractIp(r.endpoint),
    port: RELAY_PORT,
    nodeId: r.nodeId,
    role: r.role,
    healthy: r.healthStatus === 'healthy',
    weight: 100,
  }))

  registerTypedService(
    serviceId,
    validatedConfig.name,
    validatedConfig.namespace,
    'email',
    owner,
    relayEndpoints,
    {
      'email.domain': validatedConfig.emailDomain,
      'email.imap.enabled': String(validatedConfig.imap.enabled),
      'email.smtp.enabled': String(validatedConfig.smtp.enabled),
    },
  )

  // Build email service object
  const emailService: EmailService = {
    id: serviceId,
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    owner,
    emailDomain: validatedConfig.emailDomain,
    components,
    endpoints,
    status: 'ready',
    createdAt: Date.now(),
  }

  emailServices.set(serviceId, emailService)

  console.log(
    `[EmailService] Deployed ${validatedConfig.name} for @${validatedConfig.emailDomain}`,
  )

  return emailService
}

/**
 * Get email service by ID
 */
export function getEmailService(serviceId: string): EmailService | null {
  return emailServices.get(serviceId) ?? null
}

/**
 * List all email services
 */
export function listEmailServices(owner?: Address): EmailService[] {
  const services = [...emailServices.values()]
  if (owner) {
    return services.filter((s) => s.owner.toLowerCase() === owner.toLowerCase())
  }
  return services
}

/**
 * Terminate email service
 */
export async function terminateEmail(
  serviceId: string,
  owner: Address,
): Promise<void> {
  const service = emailServices.get(serviceId)
  if (!service) {
    throw new Error(`Email service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to terminate this email service')
  }

  const statefulProvisioner = getStatefulProvisioner()

  // Terminate all components
  await statefulProvisioner.terminate(service.components.relay.id, owner)
  if (service.components.imap) {
    await statefulProvisioner.terminate(service.components.imap.id, owner)
  }
  if (service.components.smtp) {
    await statefulProvisioner.terminate(service.components.smtp.id, owner)
  }
  if (service.components.bridge) {
    await statefulProvisioner.terminate(service.components.bridge.id, owner)
  }

  deregisterService(serviceId)
  emailServices.delete(serviceId)

  console.log(`[EmailService] Terminated ${service.name}`)
}

// ============================================================================
// Helpers
// ============================================================================

function extractIp(endpoint: string): string {
  const match = endpoint.match(/https?:\/\/([^:]+)/)
  return match ? match[1] : '127.0.0.1'
}

// ============================================================================
// Default Testnet Configuration
// ============================================================================

/**
 * Get default testnet email config
 */
export function getTestnetEmailConfig(): EmailConfig {
  return {
    name: 'jeju-email',
    namespace: 'default',
    emailDomain: 'jeju.mail',
    relay: {
      replicas: 3,
      rateLimits: DEFAULT_RATE_LIMITS,
    },
    imap: {
      enabled: true,
      replicas: 2,
    },
    smtp: {
      enabled: true,
      replicas: 2,
    },
    bridge: {
      enabled: true,
      replicas: 2,
    },
    moderation: {
      enabled: true,
    },
    dws: {
      endpoint: 'https://dws.testnet.jejunetwork.org',
      rpcUrl: 'https://testnet.jejunetwork.org',
      emailRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
    },
  }
}
