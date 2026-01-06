/**
 * DWS Services Router
 *
 * API routes for DWS-native service provisioning. All services are deployed
 * via the DWS control plane rather than K8s.
 *
 * Services:
 * - OAuth3 (MPC-enabled auth with 2-of-3 threshold)
 * - Data Availability (IPFS-backed with KZG/Keccak commitments)
 * - Email (decentralized email infrastructure)
 * - Farcaster Hubble (permissionless hub nodes)
 * - Workers (x402, RPC Gateway, SQLit Adapter)
 */

import { Elysia } from 'elysia'

/**
 * Serialize an object for JSON, converting BigInts to strings
 */
function serializeForJSON<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  ) as T
}

import type { Address, Hex } from 'viem'
import { z } from 'zod'
import { getStatefulProvisioner } from '../../containers/stateful-provisioner'
import {
  type DAConfig,
  deployDA,
  getDAService,
  getDAStats,
  getTestnetDAConfig,
  listDAServices,
  retrieveBlob,
  scaleDA,
  submitBlob,
  terminateDA,
} from '../../services/data-availability'
import {
  deployEmail,
  type EmailConfig,
  getEmailService,
  getTestnetEmailConfig,
  listEmailServices,
  terminateEmail,
} from '../../services/email'
import {
  deployHubble,
  getHubbleService,
  getHubbleStats,
  getTestnetHubbleConfig,
  type HubbleConfig,
  listHubbleServices,
  queryCastsByFid,
  scaleHubble,
  terminateHubble,
} from '../../services/hubble'
import {
  deployOAuth3,
  getOAuth3MPCStatus,
  getOAuth3Service,
  listOAuth3Services,
  type OAuth3Config,
  requestThresholdSignature,
  rotateOAuth3MPCKeys,
  scaleOAuth3,
  terminateOAuth3,
} from '../../services/oauth3'
import {
  deployRPCGateway,
  deploySQLitAdapter,
  deployX402Facilitator,
  getTestnetRPCGatewayConfig,
  getTestnetSQLitAdapterConfig,
  getTestnetX402Config,
  getWorkerService,
  listWorkerServices,
  type RPCGatewayConfig,
  type SQLitAdapterConfig,
  scaleWorker,
  terminateWorker,
  type WorkerService,
  type X402FacilitatorConfig,
} from '../../services/workers'

// ============================================================================
// Request Schemas
// ============================================================================

const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/) as z.ZodType<Address>

const OAuth3ProvisionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  namespace: z.string().default('default'),
  replicas: z.number().int().min(3).max(9).default(3),
  chainId: z.string().default('420690'),
  rpcUrl: z.string().url().default('https://testnet.jejunetwork.org'),
  dwsUrl: z.string().url().default('https://dws.testnet.jejunetwork.org'),
  jnsGateway: z.string().url().default('https://jns.testnet.jejunetwork.org'),
  teeMode: z.enum(['simulated', 'dstack', 'phala']).default('simulated'),
  mpcThreshold: z.number().int().min(2).max(5).default(2),
  providers: z
    .array(
      z.object({
        type: z.enum(['google', 'github', 'twitter', 'discord', 'farcaster']),
        clientId: z.string(),
        clientSecret: z.string(),
      }),
    )
    .default([]),
})

const DAProvisionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  namespace: z.string().default('default'),
  replicas: z.number().int().min(1).max(10).default(3),
})

const EmailProvisionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  namespace: z.string().default('default'),
  emailDomain: z.string().min(1).max(253).default('jeju.mail'),
})

const HubbleProvisionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  namespace: z.string().default('default'),
  replicas: z.number().int().min(1).max(10).default(1),
})

const WorkerProvisionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  namespace: z.string().default('default'),
  type: z.enum(['x402-facilitator', 'rpc-gateway', 'sqlit-adapter']),
  replicas: z.number().int().min(1).max(20).default(2),
})

const ScaleSchema = z.object({
  replicas: z.number().int().min(0).max(20),
})

const BlobSubmitSchema = z.object({
  data: z.string(), // Base64 encoded
})

const MPCSignSchema = z.object({
  message: z.string(), // Hex encoded message to sign
})

// ============================================================================
// Helper Functions
// ============================================================================

function getOwnerFromRequest(request: Request): Address {
  const ownerHeader = request.headers.get('x-jeju-address')
  if (!ownerHeader) {
    throw new Error('x-jeju-address header required')
  }
  const parsed = AddressSchema.safeParse(ownerHeader)
  if (!parsed.success) {
    throw new Error('Invalid x-jeju-address format')
  }
  return parsed.data
}

// ============================================================================
// Router
// ============================================================================

export function createDWSServicesRouter() {
  return (
    new Elysia({ prefix: '/dws-services' })
      // ========================================================================
      // Health & Status
      // ========================================================================
      .get('/health', () => {
        const provisioner = getStatefulProvisioner()
        return {
          status: 'healthy',
          service: 'dws-services',
          provisioner: provisioner ? 'initialized' : 'not-initialized',
        }
      })

      .get('/testnet-configs', () => {
        // Return example configs for testnet (without sensitive data)
        return {
          oauth3: {
            name: 'oauth3',
            namespace: 'default',
            replicas: 3,
            mpcThreshold: 2,
            mpcParties: 3,
          },
          da: getTestnetDAConfig(),
          email: getTestnetEmailConfig(),
          hubble: getTestnetHubbleConfig(),
          workers: {
            x402: getTestnetX402Config(),
            rpcGateway: getTestnetRPCGatewayConfig(),
            sqlitAdapter: getTestnetSQLitAdapterConfig(),
          },
        }
      })

      // ========================================================================
      // OAuth3 Service
      // ========================================================================
      .group('/oauth3', (oauth3) =>
        oauth3
          .get('/', ({ query }) => {
            const owner = query.owner as Address | undefined
            const services = listOAuth3Services(owner)
            return { services }
          })

          .post('/', async ({ body, request, set }) => {
            const parsed = OAuth3ProvisionSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const owner = getOwnerFromRequest(request)
            const config: OAuth3Config = {
              name: parsed.data.name,
              namespace: parsed.data.namespace,
              replicas: parsed.data.replicas,
              chainId: parsed.data.chainId,
              rpcUrl: parsed.data.rpcUrl,
              dwsUrl: parsed.data.dwsUrl,
              jnsGateway: parsed.data.jnsGateway,
              teeMode: parsed.data.teeMode,
              mpc: {
                threshold: parsed.data.mpcThreshold,
                totalParties: parsed.data.replicas,
              },
              providers: parsed.data.providers,
            }

            const service = await deployOAuth3(owner, config)

            set.status = 201
            return { service }
          })

          .get('/:id', async ({ params, set }) => {
            const service = getOAuth3Service(params.id)
            if (!service) {
              set.status = 404
              return { error: 'Service not found' }
            }
            return { service }
          })

          .post('/:id/scale', async ({ params, body, request, set }) => {
            const parsed = ScaleSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const owner = getOwnerFromRequest(request)
            await scaleOAuth3(params.id, owner, parsed.data.replicas)
            return { status: 'scaled', replicas: parsed.data.replicas }
          })

          .delete('/:id', async ({ params, request }) => {
            const owner = getOwnerFromRequest(request)
            await terminateOAuth3(params.id, owner)
            return { status: 'terminated' }
          })

          .get('/:id/mpc-status', async ({ params, set }) => {
            const status = await getOAuth3MPCStatus(params.id)
            if (!status) {
              set.status = 404
              return { error: 'Service not found' }
            }
            return status
          })

          .post('/:id/mpc/sign', async ({ params, body, set }) => {
            const parsed = MPCSignSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const signature = await requestThresholdSignature(
              params.id,
              parsed.data.message as Hex,
            )
            return { signature }
          })

          .post('/:id/mpc/rotate-keys', async ({ params, request }) => {
            const owner = getOwnerFromRequest(request)
            await rotateOAuth3MPCKeys(params.id, owner)
            return { status: 'key-rotation-initiated' }
          }),
      )

      // ========================================================================
      // Data Availability Service
      // ========================================================================
      .group('/da', (da) =>
        da
          .get('/', ({ query }) => {
            const owner = query.owner as Address | undefined
            const services = listDAServices(owner)
            return { services }
          })

          .post('/', async ({ body, request, set }) => {
            const parsed = DAProvisionSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const owner = getOwnerFromRequest(request)
            // Use testnet config as base and override with request params
            const baseConfig = getTestnetDAConfig()
            const config: DAConfig = {
              ...baseConfig,
              name: parsed.data.name,
              namespace: parsed.data.namespace,
              replicas: parsed.data.replicas,
            }

            const service = await deployDA(owner, config)

            set.status = 201
            return { service }
          })

          .get('/:id', async ({ params, set }) => {
            const service = getDAService(params.id)
            if (!service) {
              set.status = 404
              return { error: 'Service not found' }
            }
            return { service }
          })

          .get('/:id/stats', async ({ params, set }) => {
            const stats = await getDAStats(params.id)
            if (!stats) {
              set.status = 404
              return { error: 'Service not found' }
            }
            return stats
          })

          .post('/:id/scale', async ({ params, body, request, set }) => {
            const parsed = ScaleSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const owner = getOwnerFromRequest(request)
            await scaleDA(params.id, owner, parsed.data.replicas)
            return { status: 'scaled', replicas: parsed.data.replicas }
          })

          .delete('/:id', async ({ params, request }) => {
            const owner = getOwnerFromRequest(request)
            await terminateDA(params.id, owner)
            return { status: 'terminated' }
          })

          .post('/:id/blobs', async ({ params, body, request, set }) => {
            const parsed = BlobSubmitSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            // Validate owner has permission (service checks internally)
            getOwnerFromRequest(request)
            const buffer = Buffer.from(parsed.data.data, 'base64')
            const data = buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength,
            )
            const result = await submitBlob(params.id, data)

            set.status = 201
            return result
          })

          .get('/:id/blobs/:commitment', async ({ params, set }) => {
            const blob = await retrieveBlob(params.id, params.commitment as Hex)
            if (!blob) {
              set.status = 404
              return { error: 'Blob not found' }
            }
            return {
              data: Buffer.from(blob).toString('base64'),
              commitment: params.commitment,
            }
          }),
      )

      // ========================================================================
      // Email Service
      // ========================================================================
      .group('/email', (email) =>
        email
          .get('/', ({ query }) => {
            const owner = query.owner as Address | undefined
            const services = listEmailServices(owner)
            return { services }
          })

          .post('/', async ({ body, request, set }) => {
            const parsed = EmailProvisionSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const owner = getOwnerFromRequest(request)
            // Use testnet config as base and override with request params
            const baseConfig = getTestnetEmailConfig()
            const config: EmailConfig = {
              ...baseConfig,
              name: parsed.data.name,
              namespace: parsed.data.namespace,
              emailDomain: parsed.data.emailDomain,
            }

            const service = await deployEmail(owner, config)

            set.status = 201
            return { service }
          })

          .get('/:id', async ({ params, set }) => {
            const service = getEmailService(params.id)
            if (!service) {
              set.status = 404
              return { error: 'Service not found' }
            }
            return { service }
          })

          .delete('/:id', async ({ params, request }) => {
            const owner = getOwnerFromRequest(request)
            await terminateEmail(params.id, owner)
            return { status: 'terminated' }
          }),
      )

      // ========================================================================
      // Farcaster Hubble Service
      // ========================================================================
      .group('/hubble', (hubble) =>
        hubble
          .get('/', ({ query }) => {
            const owner = query.owner as Address | undefined
            const services = listHubbleServices(owner)
            return { services }
          })

          .post('/', async ({ body, request, set }) => {
            const parsed = HubbleProvisionSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const owner = getOwnerFromRequest(request)
            // Use testnet config as base and override with request params
            const baseConfig = getTestnetHubbleConfig()
            const config: HubbleConfig = {
              ...baseConfig,
              name: parsed.data.name,
              namespace: parsed.data.namespace,
              replicas: parsed.data.replicas,
            }

            const service = await deployHubble(owner, config)

            set.status = 201
            return { service }
          })

          .get('/:id', async ({ params, set }) => {
            const service = getHubbleService(params.id)
            if (!service) {
              set.status = 404
              return { error: 'Service not found' }
            }
            return { service }
          })

          .get('/:id/stats', async ({ params, set }) => {
            const stats = await getHubbleStats(params.id)
            if (!stats) {
              set.status = 404
              return { error: 'Service not found' }
            }
            return stats
          })

          .post('/:id/scale', async ({ params, body, request, set }) => {
            const parsed = ScaleSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const owner = getOwnerFromRequest(request)
            await scaleHubble(params.id, owner, parsed.data.replicas)
            return { status: 'scaled', replicas: parsed.data.replicas }
          })

          .delete('/:id', async ({ params, request }) => {
            const owner = getOwnerFromRequest(request)
            await terminateHubble(params.id, owner)
            return { status: 'terminated' }
          })

          .get('/:id/casts/:fid', async ({ params, set }) => {
            const fid = parseInt(params.fid, 10)
            if (Number.isNaN(fid)) {
              set.status = 400
              return { error: 'Invalid FID' }
            }

            const casts = await queryCastsByFid(params.id, fid)
            return { casts }
          }),
      )

      // ========================================================================
      // Workers (x402, RPC Gateway, SQLit Adapter)
      // ========================================================================
      .group('/workers', (workers) =>
        workers
          .get('/', ({ query }) => {
            const owner = query.owner as Address | undefined
            const type = query.type as
              | 'x402-facilitator'
              | 'rpc-gateway'
              | 'sqlit-adapter'
              | undefined
            const services = listWorkerServices(owner, type)
            // Serialize to handle BigInt in container data
            return serializeForJSON({ services })
          })

          .post('/', async ({ body, request, set }) => {
            const parsed = WorkerProvisionSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const owner = getOwnerFromRequest(request)
            let service: WorkerService | undefined

            switch (parsed.data.type) {
              case 'x402-facilitator': {
                const baseConfig = getTestnetX402Config()
                const config: X402FacilitatorConfig = {
                  ...baseConfig,
                  name: parsed.data.name,
                  namespace: parsed.data.namespace,
                  replicas: parsed.data.replicas,
                }
                service = await deployX402Facilitator(owner, config)
                break
              }
              case 'rpc-gateway': {
                const baseConfig = getTestnetRPCGatewayConfig()
                const config: RPCGatewayConfig = {
                  ...baseConfig,
                  name: parsed.data.name,
                  namespace: parsed.data.namespace,
                  replicas: parsed.data.replicas,
                }
                service = await deployRPCGateway(owner, config)
                break
              }
              case 'sqlit-adapter': {
                const baseConfig = getTestnetSQLitAdapterConfig()
                const config: SQLitAdapterConfig = {
                  ...baseConfig,
                  name: parsed.data.name,
                  namespace: parsed.data.namespace,
                  replicas: parsed.data.replicas,
                }
                service = await deploySQLitAdapter(owner, config)
                break
              }
            }

            set.status = 201
            return { service }
          })

          .get('/:id', async ({ params, set }) => {
            const service = getWorkerService(params.id)
            if (!service) {
              set.status = 404
              return { error: 'Service not found' }
            }
            return { service }
          })

          .post('/:id/scale', async ({ params, body, request, set }) => {
            const parsed = ScaleSchema.safeParse(body)
            if (!parsed.success) {
              set.status = 400
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const owner = getOwnerFromRequest(request)
            await scaleWorker(params.id, owner, parsed.data.replicas)
            return { status: 'scaled', replicas: parsed.data.replicas }
          })

          .delete('/:id', async ({ params, request }) => {
            const owner = getOwnerFromRequest(request)
            await terminateWorker(params.id, owner)
            return { status: 'terminated' }
          }),
      )
  )
}
