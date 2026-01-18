/**
 * Crucible API Worker
 *
 * DWS-deployable worker using Elysia with CloudflareAdapter.
 * Compatible with workerd runtime and DWS infrastructure.
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getChainId,
  getContract,
  getCurrentNetwork,
  getLocalhostHost,
  getServicesConfig,
} from '@jejunetwork/config'
import { JsonValueSchema } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  hexToString,
  http,
  parseAbi,
  stringToHex,
} from 'viem'
import { z } from 'zod'
import localnetDeployments from '../../../packages/contracts/deployments/localnet/deployment.json' with {
  type: 'json',
}
import type {
  AgentCharacter,
  AgentDefinition,
  AgentSearchFilter,
  RoomType,
} from '../lib/types'
import { createBotsRouter } from './bots'
import { characters, getCharacter, listCharacters } from './characters'
import { config } from './config'
import {
  AgentCharacterSchema,
  AgentSearchQuerySchema,
  CreateRoomRequestSchema,
  FundAgentRequestSchema,
  parseOrThrow,
  RoomSearchQuerySchema,
} from './schemas'
import { createAgentSDK } from './sdk/agent'
import { createCompute } from './sdk/compute'
import { createExecutorSDK } from './sdk/executor'
import { createKMSSigner } from './sdk/kms-signer'
import { createRoomSDK } from './sdk/room'
import { createStorage } from './sdk/storage'

// Minimal ABI for reading vault balance
const AGENT_VAULT_ABI = parseAbi([
  'function getBalance(uint256 agentId) external view returns (uint256)',
])

const AGENT_VAULT_EVENTS_ABI = parseAbi([
  'event Spent(uint256 indexed agentId, address indexed spender, address recipient, uint256 amount, string reason)',
])

const TRIGGER_REGISTRY_CRON_ABI = parseAbi([
  'function getCronTriggers() external view returns (bytes32[] triggerIds, string[] cronExpressions, string[] endpoints)',
  'function getTrigger(bytes32 triggerId) external view returns (address owner, uint8 triggerType, string name, string endpoint, bool active, uint256 executionCount, uint256 lastExecutedAt, uint256 agentId)',
])

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string tokenURI_) external returns (uint256 agentId)',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function approve(address to, uint256 tokenId) external',
  'function setMetadata(uint256 agentId, string key, bytes value) external',
  'function getMetadata(uint256 agentId, string key) external view returns (bytes)',
  'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)',
])

const AGENT_VAULT_WRITE_ABI = parseAbi([
  'function createVault(uint256 agentId) external payable returns (address vault)',
  'function getVault(uint256 agentId) external view returns (address)',
  'function deposit(uint256 agentId) external payable',
  'function approveSpender(uint256 agentId, address spender) external',
  'function getSpendHistory(uint256 agentId, uint256 limit) external view returns ((uint256 agentId, address spender, address recipient, uint256 amount, string reason, uint256 timestamp)[])',
])

const TX_HASH_SCHEMA = z.string().regex(/^0x[a-fA-F0-9]{64}$/)
const OAUTH3_SESSION_ID_SCHEMA = z.union([
  z.string().uuid(),
  z.string().regex(/^0x[a-fA-F0-9]+$/),
])

const OAUTH3_SESSION_SCHEMA = z.object({
  sessionId: OAUTH3_SESSION_ID_SCHEMA,
  identityId: z.string().min(1),
  smartAccount: z.union([z.string().regex(/^0x[a-fA-F0-9]{40}$/), z.null()]),
  expiresAt: z.number().int().positive(),
})

function normalizeAddress(addr: string): Address {
  const parsed = z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .parse(addr)
  return parsed.toLowerCase() as Address
}

function getSessionSmartAccount(
  session: z.infer<typeof OAUTH3_SESSION_SCHEMA>,
  set: { status?: number | string },
): Address | null {
  if (!session.smartAccount) {
    set.status = 401
    return null
  }
  return normalizeAddress(session.smartAccount)
}

function getBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null
  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

function parsePositiveBigIntParam(value: string, paramName: string): bigint {
  const numeric = z
    .string()
    .min(1)
    .regex(/^\d+$/, `${paramName} must be a numeric string`)
    .parse(value)
  const result = BigInt(numeric)
  if (result <= 0n) {
    throw new Error(`Invalid ${paramName}`)
  }
  return result
}

function parseHex32(value: string, paramName: string): `0x${string}` {
  const parsed = TX_HASH_SCHEMA.parse(value)
  const isHex = (v: string): v is `0x${string}` => /^0x[a-fA-F0-9]+$/.test(v)
  if (!isHex(parsed)) {
    throw new Error(`Invalid ${paramName}`)
  }
  return parsed
}

async function validateOAuth3Session(teeUrl: string, token: string) {
  const response = await fetch(
    `${teeUrl.replace(/\/$/, '')}/session/validate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    },
  )
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Unauthorized: session validation failed (${response.status}) - ${errorText}`,
    )
  }
  return OAUTH3_SESSION_SCHEMA.parse(await response.json())
}

async function sendOAuth3Transaction(args: {
  teeUrl: string
  sessionId: string
  to: Address
  data: Hex
  value?: bigint
  gasLimit?: bigint
}): Promise<Hex> {
  const response = await fetch(
    `${args.teeUrl.replace(/\/$/, '')}/transaction`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: args.sessionId,
        to: args.to,
        value: args.value?.toString(),
        data: args.data,
        gasLimit: args.gasLimit?.toString(),
      }),
    },
  )
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Transaction failed (${response.status}): ${errorText}`)
  }
  const parsed = z
    .object({ txHash: TX_HASH_SCHEMA })
    .parse(await response.json())
  return parsed.txHash as Hex
}

async function registerAgentViaOAuth3(args: {
  ctx: CrucibleRuntimeContext
  sessionId: string
  character: AgentCharacter
  initialFundingWei?: bigint
}): Promise<{
  agentId: bigint
  vaultAddress: Address
  characterCid: string
  stateCid: string
}> {
  const storedCharacterCid = await args.ctx.storage.storeCharacter(
    args.character,
  )
  const initialState = args.ctx.storage.createInitialState(args.character.id)
  const stateCid = await args.ctx.storage.storeAgentState(initialState)
  const tokenUri = `ipfs://${storedCharacterCid}#state=${stateCid}`

  const identityRegistry = args.ctx.contracts.identityRegistry
  const registerTx = await sendOAuth3Transaction({
    teeUrl: args.ctx.teeUrl,
    sessionId: args.sessionId,
    to: identityRegistry,
    data: encodeFunctionData({
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'register',
      args: [tokenUri],
    }),
  })

  const registerReceipt = await args.ctx.publicClient.waitForTransactionReceipt(
    {
      hash: registerTx,
    },
  )

  const registeredEventSchema = z.object({
    eventName: z.literal('Registered'),
    args: z.object({ agentId: z.bigint() }),
  })

  const decoded = registerReceipt.logs
    .filter((l) => normalizeAddress(l.address) === identityRegistry)
    .map((l) => {
      try {
        return decodeEventLog({
          abi: IDENTITY_REGISTRY_ABI,
          data: l.data,
          topics: l.topics,
        })
      } catch {
        return null
      }
    })
    .map((e) => (e ? registeredEventSchema.safeParse(e) : null))
    .find((r) => r?.success === true)?.data

  if (!decoded) {
    throw new Error('Failed to parse Registered event')
  }

  const agentId = decoded.args.agentId
  const funding = args.initialFundingWei ?? 0n

  // Create vault and fund it (optional)
  const agentVault = args.ctx.contracts.agentVault
  const createVaultTx = await sendOAuth3Transaction({
    teeUrl: args.ctx.teeUrl,
    sessionId: args.sessionId,
    to: agentVault,
    data: encodeFunctionData({
      abi: AGENT_VAULT_WRITE_ABI,
      functionName: 'createVault',
      args: [agentId],
    }),
    value: funding,
  })
  await args.ctx.publicClient.waitForTransactionReceipt({ hash: createVaultTx })

  const vaultAddress = normalizeAddress(
    z.string().parse(
      await args.ctx.publicClient.readContract({
        address: agentVault,
        abi: AGENT_VAULT_WRITE_ABI,
        functionName: 'getVault',
        args: [agentId],
      }),
    ),
  )

  // Approve executor as spender for the vault and approve executor on the NFT
  const approveVaultTx = await sendOAuth3Transaction({
    teeUrl: args.ctx.teeUrl,
    sessionId: args.sessionId,
    to: agentVault,
    data: encodeFunctionData({
      abi: AGENT_VAULT_WRITE_ABI,
      functionName: 'approveSpender',
      args: [agentId, args.ctx.executorAddress],
    }),
  })
  await args.ctx.publicClient.waitForTransactionReceipt({
    hash: approveVaultTx,
  })

  const approveIdentityTx = await sendOAuth3Transaction({
    teeUrl: args.ctx.teeUrl,
    sessionId: args.sessionId,
    to: identityRegistry,
    data: encodeFunctionData({
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'approve',
      args: [args.ctx.executorAddress, agentId],
    }),
  })
  await args.ctx.publicClient.waitForTransactionReceipt({
    hash: approveIdentityTx,
  })

  return {
    agentId,
    vaultAddress,
    characterCid: storedCharacterCid,
    stateCid,
  }
}

function toWebAgent(
  agent: AgentDefinition,
  character: AgentCharacter | null,
  tickIntervalMs?: number,
) {
  return {
    agentId: agent.agentId.toString(),
    owner: agent.owner,
    name: agent.name,
    description: character?.description,
    botType: agent.botType,
    characterCid: agent.characterCid,
    stateCid: agent.stateCid,
    vaultAddress: agent.vaultAddress,
    active: agent.active,
    registeredAt: agent.registeredAt,
    lastExecutedAt: agent.lastExecutedAt,
    executionCount: agent.executionCount,
    tickIntervalMs,
  }
}

type CrucibleRuntimeContext = {
  network: 'localnet' | 'testnet' | 'mainnet'
  services: ReturnType<typeof getServicesConfig>
  teeUrl: string
  contracts: {
    agentVault: Address
    roomRegistry: Address
    triggerRegistry: Address
    identityRegistry: Address
    serviceRegistry: Address
  }
  publicClient: ReturnType<typeof createPublicClient>
  kmsSigner: ReturnType<typeof createKMSSigner>
  executorAddress: Address
  storage: ReturnType<typeof createStorage>
  compute: ReturnType<typeof createCompute>
  agentSdk: ReturnType<typeof createAgentSDK>
  roomSdk: ReturnType<typeof createRoomSDK>
  executorSdk: ReturnType<typeof createExecutorSDK>
}

let cachedCtx: CrucibleRuntimeContext | null = null
let cachedCtxHash: string | null = null

async function getCtx(
  env?: Partial<CrucibleEnv>,
): Promise<CrucibleRuntimeContext> {
  const network = (env?.NETWORK ?? getCurrentNetwork()) as
    | 'localnet'
    | 'testnet'
    | 'mainnet'
  const services = getServicesConfig(network)
  const oauth3 = services.oauth3
  if (!oauth3 || !oauth3.tee) {
    throw new Error('OAuth3 TEE service not configured')
  }

  const ctxHash = `${network}:${services.rpc.l2}:${services.indexer.graphql}:${services.storage.api}:${oauth3.tee}:${services.kms.api}`

  if (cachedCtx && cachedCtxHash === ctxHash) {
    return cachedCtx
  }

  const publicClient = createPublicClient({ transport: http(services.rpc.l2) })
  const chainId = getChainId(network)

  const kmsSigner = createKMSSigner(services.rpc.l2, chainId)

  // Initialize KMS signer gracefully - don't fail if KMS is unavailable
  // Read-only endpoints will still work without KMS
  let executorAddress: Address = '0x0000000000000000000000000000000000000000'
  try {
    await kmsSigner.initialize()
    executorAddress = kmsSigner.getAddress()
  } catch (err) {
    console.warn(
      '[Crucible Worker] KMS initialization failed - write operations will be unavailable:',
      err instanceof Error ? err.message : String(err),
    )
  }

  const localnetSchema = z.object({
    crucible: z.object({
      agentVault: z.string(),
      roomRegistry: z.string(),
      triggerRegistry: z.string(),
    }),
    registry: z.object({
      identityRegistry: z.string(),
    }),
    infrastructure: z.object({
      serviceRegistry: z.string(),
    }),
  })

  const localnet =
    network === 'localnet' ? localnetSchema.parse(localnetDeployments) : null

  const agentVault = normalizeAddress(
    env?.AGENT_VAULT_ADDRESS ??
      (localnet
        ? localnet.crucible.agentVault
        : getContract('agents', 'vault', network)),
  )
  const roomRegistry = normalizeAddress(
    env?.ROOM_REGISTRY_ADDRESS ??
      (localnet
        ? localnet.crucible.roomRegistry
        : getContract('agents', 'roomRegistry', network)),
  )
  const identityRegistry = normalizeAddress(
    env?.IDENTITY_REGISTRY_ADDRESS ??
      (localnet
        ? localnet.registry.identityRegistry
        : getContract('registry', 'identity', network)),
  )
  const serviceRegistry = normalizeAddress(
    env?.SERVICE_REGISTRY_ADDRESS ??
      (localnet
        ? localnet.infrastructure.serviceRegistry
        : getContract('cloud', 'serviceRegistry', network)),
  )
  const triggerRegistry = normalizeAddress(
    env?.TRIGGER_REGISTRY_ADDRESS ??
      (localnet
        ? localnet.crucible.triggerRegistry
        : '0x0000000000000000000000000000000000000000'),
  )

  const crucibleConfig = {
    rpcUrl: services.rpc.l2,
    contracts: {
      agentVault,
      roomRegistry,
      triggerRegistry,
      identityRegistry,
      serviceRegistry,
    },
    services: {
      computeMarketplace: services.compute.marketplace,
      storageApi: services.storage.api,
      ipfsGateway: services.storage.ipfsGateway,
      indexerGraphql: services.indexer.graphql,
      sqlitEndpoint: services.sqlit.blockProducer,
    },
    network,
  } as const

  const storage = createStorage({
    apiUrl: services.storage.api,
    ipfsGateway: services.storage.ipfsGateway,
  })
  const compute = createCompute({
    rpcUrl: services.rpc.l2,
    marketplaceUrl: services.dws.api,
  })
  const agentSdk = createAgentSDK({
    crucibleConfig,
    storage,
    compute,
    publicClient,
    kmsSigner,
  })
  const roomSdk = createRoomSDK({
    crucibleConfig,
    storage,
    publicClient,
    kmsSigner,
  })
  const executorSdk = createExecutorSDK({
    crucibleConfig,
    storage,
    compute,
    agentSdk,
    roomSdk,
    publicClient,
    kmsSigner,
    executorAddress,
  })

  cachedCtx = {
    network,
    services,
    teeUrl: oauth3.tee,
    contracts: crucibleConfig.contracts,
    publicClient,
    kmsSigner,
    executorAddress,
    storage,
    compute,
    agentSdk,
    roomSdk,
    executorSdk,
  }
  cachedCtxHash = ctxHash
  return cachedCtx
}

async function loadTickIntervalMs(
  ctx: CrucibleRuntimeContext,
  agentId: bigint,
): Promise<number | undefined> {
  const raw = await ctx.publicClient.readContract({
    address: ctx.contracts.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getMetadata',
    args: [agentId, 'tickIntervalMs'],
  })

  const metadataHex = z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/)
    .parse(raw) as Hex
  if (metadataHex === '0x') return undefined

  const value = hexToString(metadataHex)
  if (!/^\d+$/.test(value)) return undefined
  return Number(value)
}

type ActionsTodayCache = {
  key: string
  updatedAt: number
  value: number
}

let actionsTodayCache: ActionsTodayCache | null = null

async function findFirstBlockAtOrAfterTimestamp(
  publicClient: CrucibleRuntimeContext['publicClient'],
  targetTimestampSec: bigint,
): Promise<bigint> {
  let low = 0n
  let high = await publicClient.getBlockNumber()

  while (low < high) {
    const mid = (low + high) / 2n
    const block = await publicClient.getBlock({ blockNumber: mid })
    if (block.timestamp < targetTimestampSec) {
      low = mid + 1n
    } else {
      high = mid
    }
  }

  return low
}

async function countSpentEventsSince(
  ctx: CrucibleRuntimeContext,
  fromBlock: bigint,
): Promise<number> {
  const latestBlock = await ctx.publicClient.getBlockNumber()
  const step = 25_000n

  let total = 0
  for (let start = fromBlock; start <= latestBlock; start += step) {
    const end = start + step - 1n
    const toBlock = end < latestBlock ? end : latestBlock

    const logs = await ctx.publicClient.getContractEvents({
      address: ctx.contracts.agentVault,
      abi: AGENT_VAULT_EVENTS_ABI,
      eventName: 'Spent',
      fromBlock: start,
      toBlock,
    })
    total += logs.length
  }

  return total
}

async function getActionsToday(ctx: CrucibleRuntimeContext): Promise<number> {
  const now = new Date()
  const dayStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0,
  )
  const dayStartSec = BigInt(Math.floor(dayStartMs / 1000))
  const key = `${ctx.network}:${dayStartSec.toString()}`

  const cacheFreshMs = 30_000
  if (
    actionsTodayCache &&
    actionsTodayCache.key === key &&
    Date.now() - actionsTodayCache.updatedAt < cacheFreshMs
  ) {
    return actionsTodayCache.value
  }

  const fromBlock = await findFirstBlockAtOrAfterTimestamp(
    ctx.publicClient,
    dayStartSec,
  )
  const value = await countSpentEventsSince(ctx, fromBlock)

  actionsTodayCache = { key, updatedAt: Date.now(), value }
  return value
}

let autonomousRunnerRunning = false
let autonomousRunnerInterval: ReturnType<typeof setInterval> | null = null
let autonomousRunnerTicking = false

function cronMatchesNow(cronExpression: string, now: Date): boolean {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  if (dayOfMonth !== '*' || month !== '*') return false

  const utcMinute = now.getUTCMinutes()
  const utcHour = now.getUTCHours()
  const utcDayOfWeek = now.getUTCDay()

  // minute field: "*" | "*/N" | "M"
  if (minute === '*') {
    // ok
  } else {
    const stepMatch = minute.match(/^\*\/(\d+)$/)
    if (stepMatch) {
      const step = Number(stepMatch[1])
      if (!Number.isInteger(step) || step <= 0) return false
      if (utcMinute % step !== 0) return false
    } else {
      if (!/^\d+$/.test(minute)) return false
      const m = Number(minute)
      if (!Number.isInteger(m) || m < 0 || m > 59) return false
      if (utcMinute !== m) return false
    }
  }

  // hour field: "*" | "H"
  if (hour !== '*') {
    if (!/^\d+$/.test(hour)) return false
    const h = Number(hour)
    if (!Number.isInteger(h) || h < 0 || h > 23) return false
    if (utcHour !== h) return false
  }

  // day-of-week field: "*" | "D" | "D1-D2"
  if (dayOfWeek !== '*') {
    const rangeMatch = dayOfWeek.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        start > 6 ||
        end < 0 ||
        end > 6
      )
        return false
      if (utcDayOfWeek < start || utcDayOfWeek > end) return false
    } else {
      if (!/^\d+$/.test(dayOfWeek)) return false
      const d = Number(dayOfWeek)
      if (!Number.isInteger(d) || d < 0 || d > 6) return false
      if (utcDayOfWeek !== d) return false
    }
  }

  return true
}

async function runAutonomousCronTick(
  ctx: CrucibleRuntimeContext,
): Promise<void> {
  if (autonomousRunnerTicking) return
  autonomousRunnerTicking = true
  try {
    const triggerRegistry = ctx.contracts.triggerRegistry
    if (triggerRegistry === '0x0000000000000000000000000000000000000000') return

    const now = new Date()
    const minuteStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
        0,
        0,
      ),
    )
    const minuteStartSec = Math.floor(minuteStart.getTime() / 1000)

    const raw = await ctx.publicClient.readContract({
      address: triggerRegistry,
      abi: TRIGGER_REGISTRY_CRON_ABI,
      functionName: 'getCronTriggers',
      args: [],
    })

    const [triggerIds, cronExpressions] = z
      .tuple([z.array(z.string()), z.array(z.string()), z.array(z.string())])
      .parse(raw)

    if (triggerIds.length !== cronExpressions.length) {
      throw new Error(
        'TriggerRegistry.getCronTriggers returned mismatched arrays',
      )
    }

    for (let i = 0; i < triggerIds.length; i++) {
      const triggerId = triggerIds[i]
      const cronExpression = cronExpressions[i]

      if (!cronMatchesNow(cronExpression, now)) continue

      const triggerIdHex = parseHex32(triggerId, 'triggerId')
      const trigger = (await ctx.publicClient.readContract({
        address: triggerRegistry,
        abi: TRIGGER_REGISTRY_CRON_ABI,
        functionName: 'getTrigger',
        args: [triggerIdHex],
      })) as readonly [
        Address,
        number,
        string,
        string,
        boolean,
        bigint,
        bigint,
        bigint,
      ]

      const lastExecutedAt = trigger[6]
      if (Number(lastExecutedAt) >= minuteStartSec) continue

      await ctx.executorSdk.executeTrigger(triggerId)
    }
  } finally {
    autonomousRunnerTicking = false
  }
}

async function setAgentAutonomousOnChain(args: {
  ctx: CrucibleRuntimeContext
  agentId: bigint
  enabled: boolean
  tickIntervalMs?: number
}): Promise<{ enabled: boolean; tickIntervalMs: number }> {
  if (!config.autonomousEnabled) {
    throw new Error('Autonomous is disabled (set AUTONOMOUS_ENABLED=true)')
  }

  if (
    args.ctx.contracts.triggerRegistry ===
    '0x0000000000000000000000000000000000000000'
  ) {
    throw new Error('Autonomous triggers not deployed on this network')
  }

  const currentTick = await loadTickIntervalMs(args.ctx, args.agentId)
  const requestedTickIntervalMs = args.enabled
    ? (args.tickIntervalMs ??
      (currentTick && currentTick > 0 ? currentTick : 60000))
    : 0

  const tickIntervalMinutes = args.enabled
    ? Math.max(1, Math.ceil(requestedTickIntervalMs / 60000))
    : 0
  const tickIntervalMs = args.enabled ? tickIntervalMinutes * 60000 : 0
  const cronExpression = args.enabled
    ? tickIntervalMinutes === 1
      ? '* * * * *'
      : `*/${tickIntervalMinutes} * * * *`
    : '* * * * *'

  const triggers = await args.ctx.executorSdk.getAgentTriggers(args.agentId)
  const cronTriggers = triggers.filter((t) => t.type === 'cron')

  if (args.enabled) {
    if (cronTriggers.length === 0) {
      await args.ctx.executorSdk.registerCronTrigger(
        args.agentId,
        `Autonomous Agent ${args.agentId.toString()}`,
        cronExpression,
      )
    } else {
      for (const t of cronTriggers) {
        await args.ctx.executorSdk.setTriggerActive(t.triggerId, true)
      }
    }
  } else {
    for (const t of cronTriggers) {
      await args.ctx.executorSdk.setTriggerActive(t.triggerId, false)
    }
  }

  const metadataValue = stringToHex(String(tickIntervalMs))
  const txHash = await args.ctx.kmsSigner.signContractWrite({
    address: args.ctx.contracts.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setMetadata',
    args: [args.agentId, 'tickIntervalMs', metadataValue],
  })
  await args.ctx.publicClient.waitForTransactionReceipt({ hash: txHash })

  return { enabled: args.enabled, tickIntervalMs }
}

// Worker Environment Types
export interface CrucibleEnv {
  // Standard workerd bindings
  TEE_MODE?: 'real' | 'simulated'
  TEE_PLATFORM?: string
  TEE_REGION?: string
  NETWORK?: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL?: string

  // Service URLs
  DWS_URL?: string
  GATEWAY_URL?: string

  // Database config
  SQLIT_NODES?: string
  SQLIT_DATABASE_ID?: string
  SQLIT_PRIVATE_KEY?: string

  // Optional contract overrides
  AGENT_VAULT_ADDRESS?: string
  ROOM_REGISTRY_ADDRESS?: string
  TRIGGER_REGISTRY_ADDRESS?: string
  IDENTITY_REGISTRY_ADDRESS?: string
  SERVICE_REGISTRY_ADDRESS?: string
}

// Create Elysia App
export function createCrucibleApp(env?: Partial<CrucibleEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  // SECURITY: Strict CORS in production
  const allowedOrigins: string[] | true = isDev
    ? true
    : [
        'https://crucible.jejunetwork.org',
        'https://crucible.testnet.jejunetwork.org',
        'https://dws.jejunetwork.org',
        'https://dws.testnet.jejunetwork.org',
      ]

  const app = new Elysia()
    .onError(({ code, error, path, set }) => {
      const message = error instanceof Error ? error.message : String(error)
      const lower = message.toLowerCase()
      console.error(`[Crucible Error] ${path}:`, message)

      if (code === 'NOT_FOUND') set.status = 404
      else if (code === 'VALIDATION') set.status = 422
      else if (code === 'PARSE') set.status = 400
      else if (lower.includes('unauthorized')) set.status = 401
      else if (lower.includes('forbidden')) set.status = 403
      else if (
        lower.includes('invalid') ||
        lower.includes('required') ||
        lower.includes('expected')
      )
        set.status = 400
      else set.status = 500

      return { error: message, code, path }
    })
    .use(
      cors({
        origin: (request) => {
          if (allowedOrigins === true) return true
          const origin = request.headers.get('origin')
          // Allow same-origin requests (no origin header)
          if (!origin) return true
          // Check against allowed origins
          if (allowedOrigins.includes(origin)) return true
          // Allow any *.jejunetwork.org domain (JNS-resolved)
          if (origin.endsWith('.jejunetwork.org')) return true
          return false
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-API-Key',
          'X-Jeju-Address',
          'X-Jeju-Signature',
          'X-Jeju-Timestamp',
        ],
        credentials: true,
      }),
    )

    // Root info endpoint
    .get('/', () => ({
      service: 'crucible',
      version: '1.0.0',
      description: 'Decentralized agent orchestration platform',
      docs: '/api/v1',
      endpoints: {
        health: '/health',
        info: '/info',
        characters: '/api/v1/characters',
        chat: '/api/v1/chat/:characterId',
        agents: '/api/v1/agents',
        rooms: '/api/v1/rooms',
      },
    }))

    // Health check - matches server.ts format for frontend compatibility
    .get('/health', () => ({
      status: 'healthy',
      service: 'crucible',
      network,
      timestamp: new Date().toISOString(),
    }))

    // Info endpoint
    .get('/info', async () => {
      const ctx = await getCtx(env)
      const rooms = await ctx.publicClient.readContract({
        address: ctx.contracts.roomRegistry,
        abi: parseAbi([
          'function totalActiveRooms() external view returns (uint256)',
        ]),
        functionName: 'totalActiveRooms',
        args: [],
      })
      const actionsToday = await getActionsToday(ctx)

      return {
        service: 'crucible',
        version: '1.0.0',
        network,
        hasSigner: true,
        dwsAvailable: true,
        runtimes: Object.keys(characters).length,
        rooms: Number(rooms),
        actionsToday,
      }
    })

    // ============================================
    // Character Templates API
    // ============================================
    .get('/api/v1/characters', () => {
      const characterList = listCharacters()
        .map((id) => {
          const char = getCharacter(id)
          return char
            ? { id: char.id, name: char.name, description: char.description }
            : null
        })
        .filter(Boolean)
      return { characters: characterList }
    })

    .get('/api/v1/characters/:id', ({ params }) => {
      const id = params.id
      const character = getCharacter(id)
      if (!character) {
        return { error: `Character not found: ${id}` }
      }
      return { character }
    })

    // Chat characters (with runtime status)
    .get('/api/v1/chat/characters', () => {
      const characterList = listCharacters().map((id) => {
        const char = getCharacter(id)
        return {
          id,
          name: char?.name ?? id,
          description: char?.description ?? '',
          hasRuntime: true, // In worker mode, all characters are available
        }
      })
      return { characters: characterList }
    })

    // ============================================
    // Agent Routes
    // ============================================
    .group('/api/v1/agents', (agents) =>
      agents
        .get('/', async ({ query }) => {
          const ctx = await getCtx(env)
          const parsed = AgentSearchQuerySchema.safeParse(query)
          const limit = parsed.success ? parsed.data.limit : 20
          const offset = parsed.success ? parsed.data.offset : 0

          const result = await ctx.agentSdk.searchAgents({
            limit,
            offset,
          })

          const agentsWithCharacter = await Promise.all(
            result.items.map(async (a) => {
              const character = a.characterCid
                ? await ctx.storage.loadCharacter(a.characterCid)
                : null
              const tickIntervalMs = await loadTickIntervalMs(ctx, a.agentId)
              return toWebAgent(a, character, tickIntervalMs)
            }),
          )

          return {
            agents: agentsWithCharacter,
            total: result.total,
            hasMore: result.hasMore,
          }
        })
        .get('/:agentId', async ({ params, set }) => {
          const ctx = await getCtx(env)
          const agentId = parsePositiveBigIntParam(params.agentId, 'agentId')

          const agent = await ctx.agentSdk.getAgent(agentId)
          if (!agent) {
            set.status = 404
            return { error: 'Agent not found', agentId: params.agentId }
          }

          const character = agent.characterCid
            ? await ctx.storage.loadCharacter(agent.characterCid)
            : null

          const tickIntervalMs = await loadTickIntervalMs(ctx, agent.agentId)
          return { agent: toWebAgent(agent, character, tickIntervalMs) }
        })
        .get('/:agentId/actions', async ({ params, query }) => {
          const ctx = await getCtx(env)
          const agentId = parsePositiveBigIntParam(params.agentId, 'agentId')

          const parsedQuery = z
            .object({
              limit: z.coerce.number().int().positive().max(50).default(10),
            })
            .parse(query)

          const agentVault = ctx.contracts.agentVault
          const history = await ctx.publicClient.readContract({
            address: agentVault,
            abi: AGENT_VAULT_WRITE_ABI,
            functionName: 'getSpendHistory',
            args: [agentId, BigInt(parsedQuery.limit)],
          })

          const spendRecordSchema = z.object({
            agentId: z.bigint(),
            spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
            recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
            amount: z.bigint(),
            reason: z.string(),
            timestamp: z.bigint(),
          })

          const records = z.array(spendRecordSchema).parse(history)
          const actions = records
            .slice()
            .reverse()
            .map((r) => ({
              id: `spend-${r.timestamp.toString()}-${r.spender}-${r.amount.toString()}`,
              action: r.reason,
              timestamp: Number(r.timestamp) * 1000,
              success: true,
            }))

          return { actions }
        })
        .post(
          '/:agentId/autonomous',
          async ({ params, body, request, set }) => {
            const ctx = await getCtx(env)
            const agentId = parsePositiveBigIntParam(params.agentId, 'agentId')

            const authToken = getBearerToken(
              request.headers.get('authorization'),
            )
            if (!authToken) {
              set.status = 401
              return { error: 'Unauthorized: login required' }
            }

            const session = await validateOAuth3Session(ctx.teeUrl, authToken)
            const smartAccount = getSessionSmartAccount(session, set)
            if (!smartAccount) {
              return { error: 'Unauthorized: wallet address missing' }
            }
            const headerAddress = request.headers.get('x-jeju-address')
            const expectedHeaderAddress = headerAddress
              ? normalizeAddress(headerAddress)
              : null
            if (
              expectedHeaderAddress &&
              expectedHeaderAddress !== smartAccount
            ) {
              set.status = 401
              return {
                error: 'Unauthorized: address header does not match session',
              }
            }

            const toggleSchema = z.object({
              enabled: z.boolean(),
              tickIntervalMs: z
                .number()
                .int()
                .positive()
                .max(3_600_000)
                .optional(),
            })
            const parsed = parseOrThrow(
              toggleSchema,
              body,
              'autonomous toggle request',
            )

            const exists = z.boolean().parse(
              await ctx.publicClient.readContract({
                address: ctx.contracts.identityRegistry,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: 'agentExists',
                args: [agentId],
              }),
            )
            if (!exists) {
              set.status = 404
              return { error: 'Agent not found', agentId: agentId.toString() }
            }

            const owner = normalizeAddress(
              z.string().parse(
                await ctx.publicClient.readContract({
                  address: ctx.contracts.identityRegistry,
                  abi: IDENTITY_REGISTRY_ABI,
                  functionName: 'ownerOf',
                  args: [agentId],
                }),
              ),
            )
            if (owner !== smartAccount) {
              set.status = 403
              return { error: 'Forbidden: not agent owner' }
            }

            if (!config.autonomousEnabled) {
              set.status = 403
              return {
                error: 'Autonomous is disabled (set AUTONOMOUS_ENABLED=true)',
              }
            }

            if (
              ctx.contracts.triggerRegistry ===
              '0x0000000000000000000000000000000000000000'
            ) {
              set.status = 501
              return {
                error: 'Autonomous triggers not deployed on this network',
              }
            }

            const result = await setAgentAutonomousOnChain({
              ctx,
              agentId,
              enabled: parsed.enabled,
              tickIntervalMs: parsed.tickIntervalMs,
            })

            return {
              success: true,
              enabled: result.enabled,
              tickIntervalMs: result.enabled ? result.tickIntervalMs : 0,
            }
          },
        )
        .post('/', async ({ body, request, set }) => {
          const ctx = await getCtx(env)

          const authToken = getBearerToken(request.headers.get('authorization'))
          const headerAddress = request.headers.get('x-jeju-address')

          const parsedBody = parseOrThrow(
            z.object({
              name: z.string().optional(),
              characterCid: z.string().optional(),
              character: AgentCharacterSchema.optional(),
              initialFunding: z
                .string()
                .regex(/^\d+$/, 'initialFunding must be wei string')
                .optional(),
            }),
            body,
            'register agent request',
          )

          // Localnet-only: allow seeding via characterCid without OAuth3 session
          if (!authToken) {
            if (ctx.network !== 'localnet') {
              set.status = 401
              return { error: 'Unauthorized: login required' }
            }
            if (!parsedBody.characterCid) {
              set.status = 400
              return { error: 'characterCid is required for localnet seeding' }
            }

            const character = await ctx.storage.loadCharacter(
              parsedBody.characterCid,
            )
            const initialFunding = parsedBody.initialFunding
              ? BigInt(parsedBody.initialFunding)
              : undefined

            const result = await ctx.agentSdk.registerAgent(character, {
              initialFunding,
            })

            return {
              agentId: result.agentId.toString(),
              vaultAddress: result.vaultAddress,
              characterCid: result.characterCid,
              stateCid: result.stateCid,
            }
          }

          // OAuth3-backed user registration
          const session = await validateOAuth3Session(ctx.teeUrl, authToken)
          const smartAccount = getSessionSmartAccount(session, set)
          if (!smartAccount) {
            return { error: 'Unauthorized: wallet address missing' }
          }
          const expectedHeaderAddress = headerAddress
            ? normalizeAddress(headerAddress)
            : null
          if (expectedHeaderAddress && expectedHeaderAddress !== smartAccount) {
            set.status = 401
            return {
              error: 'Unauthorized: address header does not match session',
            }
          }

          const character = parsedBody.character
          if (!character) {
            set.status = 400
            return { error: 'character is required' }
          }

          const funding =
            parsedBody.initialFunding && parsedBody.initialFunding.length > 0
              ? BigInt(parsedBody.initialFunding)
              : 0n
          const result = await registerAgentViaOAuth3({
            ctx,
            sessionId: session.sessionId,
            character,
            initialFundingWei: funding,
          })

          return {
            agentId: result.agentId.toString(),
            vaultAddress: result.vaultAddress,
            characterCid: result.characterCid,
            stateCid: result.stateCid,
          }
        })
        .get('/:agentId/balance', async ({ params }) => {
          const ctx = await getCtx(env)
          const agentId = parsePositiveBigIntParam(params.agentId, 'agentId')

          const agentVault = ctx.contracts.agentVault
          const balance = await ctx.publicClient.readContract({
            address: agentVault,
            abi: AGENT_VAULT_ABI,
            functionName: 'getBalance',
            args: [agentId],
          })
          return { balance: balance.toString() }
        })
        .post('/:agentId/fund', async ({ params, body, request, set }) => {
          const ctx = await getCtx(env)
          const agentId = parsePositiveBigIntParam(params.agentId, 'agentId')

          const authToken = getBearerToken(request.headers.get('authorization'))
          if (!authToken) {
            set.status = 401
            return { error: 'Unauthorized: login required' }
          }

          const session = await validateOAuth3Session(ctx.teeUrl, authToken)
          const smartAccount = getSessionSmartAccount(session, set)
          if (!smartAccount) {
            return { error: 'Unauthorized: wallet address missing' }
          }
          const headerAddress = request.headers.get('x-jeju-address')
          const expectedHeaderAddress = headerAddress
            ? normalizeAddress(headerAddress)
            : null
          if (expectedHeaderAddress && expectedHeaderAddress !== smartAccount) {
            set.status = 401
            return {
              error: 'Unauthorized: address header does not match session',
            }
          }

          const parsed = parseOrThrow(
            FundAgentRequestSchema,
            body,
            'fund request',
          )
          const amount = BigInt(parsed.amount)
          if (amount <= 0n) {
            set.status = 400
            return { error: 'Amount must be greater than 0' }
          }

          const agentVault = ctx.contracts.agentVault
          const txHash = await sendOAuth3Transaction({
            teeUrl: ctx.teeUrl,
            sessionId: session.sessionId,
            to: agentVault,
            data: encodeFunctionData({
              abi: AGENT_VAULT_WRITE_ABI,
              functionName: 'deposit',
              args: [agentId],
            }),
            value: amount,
          })

          return { txHash }
        }),
    )

    // ============================================
    // Search API
    // ============================================
    .get('/api/v1/search/agents', async ({ query }) => {
      const ctx = await getCtx(env)
      const parsed = parseOrThrow(
        AgentSearchQuerySchema,
        query,
        'agent search query',
      )
      const result = await ctx.agentSdk.searchAgents({
        name: parsed.name,
        owner: parsed.owner ? normalizeAddress(parsed.owner) : undefined,
        active: parsed.active,
        limit: parsed.limit,
        offset: parsed.offset,
      } satisfies AgentSearchFilter)

      const agentsWithCharacter = await Promise.all(
        result.items.map(async (a) => {
          const character = a.characterCid
            ? await ctx.storage.loadCharacter(a.characterCid)
            : null
          const tickIntervalMs = await loadTickIntervalMs(ctx, a.agentId)
          return toWebAgent(a, character, tickIntervalMs)
        }),
      )

      return {
        agents: agentsWithCharacter,
        total: result.total,
        hasMore: result.hasMore,
      }
    })

    // ============================================
    // Activity API
    // ============================================
    .get('/api/v1/activity', async ({ query }) => {
      const ctx = await getCtx(env)
      const parsedQuery = z
        .object({
          limit: z.coerce.number().int().positive().max(50).default(10),
        })
        .parse(query)

      const gqlQuery = `
        query RecentAgents($limit: Int!) {
          registeredAgents(limit: $limit, orderBy: registeredAt_DESC) {
            agentId
            registeredAt
            owner { id }
          }
        }
      `

      const response = await fetch(ctx.services.indexer.graphql, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: gqlQuery,
          variables: { limit: parsedQuery.limit },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Indexer request failed (${response.status}): ${errorText}`,
        )
      }

      const raw: unknown = await response.json()
      const parsed = z
        .object({
          data: z.object({
            registeredAgents: z.array(
              z.object({
                agentId: z.string().regex(/^\d+$/),
                registeredAt: z.string().regex(/^\d+$/),
                owner: z.object({ id: z.string() }),
              }),
            ),
          }),
          errors: z
            .array(
              z.object({
                message: z.string(),
              }),
            )
            .optional(),
        })
        .parse(raw)

      if (parsed.errors && parsed.errors.length > 0) {
        throw new Error(`GraphQL error: ${parsed.errors[0].message}`)
      }

      const events = parsed.data.registeredAgents.map((a) => {
        const ts = Number(a.registeredAt)
        const timestampMs = ts < 1_000_000_000_000 ? ts * 1000 : ts
        return {
          id: `agent-${a.agentId}-${a.registeredAt}`,
          type: 'agent_created' as const,
          actor: a.owner.id,
          description: `Agent #${a.agentId} registered`,
          timestamp: timestampMs,
        }
      })

      return { events }
    })

    // ============================================
    // Execution API
    // ============================================
    .post('/api/v1/execute', async ({ body, request, set }) => {
      const ctx = await getCtx(env)

      const authToken = getBearerToken(request.headers.get('authorization'))
      if (!authToken) {
        set.status = 401
        return { error: 'Unauthorized: login required' }
      }

      const session = await validateOAuth3Session(ctx.teeUrl, authToken)
      const smartAccount = getSessionSmartAccount(session, set)
      if (!smartAccount) {
        return { error: 'Unauthorized: wallet address missing' }
      }
      const headerAddress = request.headers.get('x-jeju-address')
      const expectedHeaderAddress = headerAddress
        ? normalizeAddress(headerAddress)
        : null
      if (expectedHeaderAddress && expectedHeaderAddress !== smartAccount) {
        set.status = 401
        return { error: 'Unauthorized: address header does not match session' }
      }

      const executeBodySchema = z.object({
        agentId: z
          .string()
          .regex(/^\d+$/, 'agentId must be numeric string')
          .transform((v) => BigInt(v)),
        triggerId: z.string().optional(),
        input: z
          .object({
            message: z.string().optional(),
            roomId: z.string().optional(),
            userId: z.string().optional(),
            context: z.record(z.string(), JsonValueSchema).optional(),
          })
          .optional(),
        options: z
          .object({
            maxTokens: z.number().int().positive().max(100000).optional(),
            temperature: z.number().min(0).max(2).optional(),
            requireTee: z.boolean().optional(),
            maxCost: z
              .string()
              .regex(/^\d+$/, 'maxCost must be numeric string')
              .transform((v) => BigInt(v))
              .optional(),
            timeout: z.number().int().positive().max(300).optional(),
          })
          .optional(),
      })

      const parsed = parseOrThrow(executeBodySchema, body, 'execute request')
      const agentId = parsed.agentId

      // Verify agent exists and requester is the on-chain owner
      const identityRegistry = ctx.contracts.identityRegistry
      const exists = z.boolean().parse(
        await ctx.publicClient.readContract({
          address: identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'agentExists',
          args: [agentId],
        }),
      )
      if (!exists) {
        set.status = 404
        return { error: 'Agent not found', agentId: agentId.toString() }
      }

      const owner = normalizeAddress(
        z.string().parse(
          await ctx.publicClient.readContract({
            address: identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'ownerOf',
            args: [agentId],
          }),
        ),
      )

      if (owner !== smartAccount) {
        set.status = 403
        return { error: 'Forbidden: not agent owner' }
      }

      const message =
        parsed.input?.message && parsed.input.message.length > 0
          ? parsed.input.message
          : 'Manual execution'

      const result = await ctx.executorSdk.execute({
        agentId,
        triggerId: parsed.triggerId,
        input: {
          message,
          roomId: parsed.input?.roomId ?? null,
          userId: parsed.input?.userId ?? null,
          context: parsed.input?.context ?? null,
        },
        options: parsed.options
          ? {
              maxTokens: parsed.options.maxTokens ?? null,
              temperature: parsed.options.temperature ?? null,
              requireTee: parsed.options.requireTee ?? null,
              maxCost: parsed.options.maxCost ?? null,
              timeout: parsed.options.timeout ?? null,
            }
          : undefined,
      })

      return {
        result: {
          executionId: result.executionId,
          status: result.status,
          output: result.output?.response
            ? { response: result.output.response }
            : undefined,
        },
      }
    })

    // ============================================
    // Autonomous Routes (TriggerRegistry-backed)
    // ============================================
    .group('/api/v1/autonomous', (autonomous) =>
      autonomous
        .get('/status', async () => {
          const ctx = await getCtx(env)

          if (!config.autonomousEnabled) {
            return {
              enabled: false,
              running: false,
              agentCount: 0,
              agents: [],
              message: 'Autonomous is disabled (set AUTONOMOUS_ENABLED=true)',
            }
          }

          if (
            ctx.contracts.triggerRegistry ===
            '0x0000000000000000000000000000000000000000'
          ) {
            return {
              enabled: false,
              running: false,
              agentCount: 0,
              agents: [],
              message: 'TriggerRegistry not deployed on this network',
            }
          }

          const raw = await ctx.publicClient.readContract({
            address: ctx.contracts.triggerRegistry,
            abi: TRIGGER_REGISTRY_CRON_ABI,
            functionName: 'getCronTriggers',
            args: [],
          })

          const [triggerIds, , endpoints] = z
            .tuple([
              z.array(z.string()),
              z.array(z.string()),
              z.array(z.string()),
            ])
            .parse(raw)

          const agents = await Promise.all(
            triggerIds.map(async (triggerId, idx) => {
              const triggerIdHex = parseHex32(triggerId, 'triggerId')
              const trigger = (await ctx.publicClient.readContract({
                address: ctx.contracts.triggerRegistry,
                abi: TRIGGER_REGISTRY_CRON_ABI,
                functionName: 'getTrigger',
                args: [triggerIdHex],
              })) as readonly [
                Address,
                number,
                string,
                string,
                boolean,
                bigint,
                bigint,
                bigint,
              ]

              const endpoint = endpoints[idx] ?? trigger[3]
              const active = trigger[4]
              const executionCount = trigger[5]
              const lastExecutedAt = trigger[6]
              const agentId = trigger[7]

              return {
                id: triggerId,
                agentId: agentId.toString(),
                character: endpoint.includes('agent://')
                  ? `agent:${agentId.toString()}`
                  : endpoint,
                lastTick: Number(lastExecutedAt) * 1000,
                tickCount: Number(executionCount),
                enabled: active,
              }
            }),
          )

          return {
            enabled: true,
            running: autonomousRunnerRunning,
            agentCount: agents.length,
            agents,
          }
        })
        .post('/start', async ({ set }) => {
          if (!config.autonomousEnabled) {
            set.status = 403
            return {
              success: false,
              running: false,
              error: 'Autonomous is disabled (set AUTONOMOUS_ENABLED=true)',
            }
          }

          if (autonomousRunnerRunning) {
            return { success: true, running: true }
          }

          autonomousRunnerRunning = true
          if (!autonomousRunnerInterval) {
            autonomousRunnerInterval = setInterval(() => {
              if (!autonomousRunnerRunning) return
              void (async () => {
                const ctx = await getCtx(env)
                await runAutonomousCronTick(ctx)
              })().catch((error: Error) => {
                console.error('[Autonomous Runner] Tick failed:', error.message)
              })
            }, 10_000)
          }

          return { success: true, running: true }
        })
        .post('/stop', async () => {
          autonomousRunnerRunning = false
          if (autonomousRunnerInterval) {
            clearInterval(autonomousRunnerInterval)
            autonomousRunnerInterval = null
          }
          return { success: true, running: false }
        })
        .post('/agents', async ({ body, request, set }) => {
          const ctx = await getCtx(env)

          if (!config.autonomousEnabled) {
            set.status = 403
            return {
              error: 'Autonomous is disabled (set AUTONOMOUS_ENABLED=true)',
            }
          }

          const authToken = getBearerToken(request.headers.get('authorization'))
          if (!authToken) {
            set.status = 401
            return { error: 'Unauthorized: login required' }
          }

          const session = await validateOAuth3Session(ctx.teeUrl, authToken)
          const smartAccount = getSessionSmartAccount(session, set)
          if (!smartAccount) {
            return { error: 'Unauthorized: wallet address missing' }
          }
          const headerAddress = request.headers.get('x-jeju-address')
          const expectedHeaderAddress = headerAddress
            ? normalizeAddress(headerAddress)
            : null
          if (expectedHeaderAddress && expectedHeaderAddress !== smartAccount) {
            set.status = 401
            return {
              error: 'Unauthorized: address header does not match session',
            }
          }

          const registerSchema = z.object({
            agentId: z
              .string()
              .regex(/^\d+$/, 'agentId must be numeric string')
              .transform((v) => BigInt(v)),
            tickIntervalMs: z
              .number()
              .int()
              .positive()
              .max(3_600_000)
              .optional(),
          })
          const parsed = parseOrThrow(
            registerSchema,
            body,
            'autonomous register request',
          )
          const agentId = parsed.agentId

          const exists = z.boolean().parse(
            await ctx.publicClient.readContract({
              address: ctx.contracts.identityRegistry,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: 'agentExists',
              args: [agentId],
            }),
          )
          if (!exists) {
            set.status = 404
            return { error: 'Agent not found', agentId: agentId.toString() }
          }

          const owner = normalizeAddress(
            z.string().parse(
              await ctx.publicClient.readContract({
                address: ctx.contracts.identityRegistry,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: 'ownerOf',
                args: [agentId],
              }),
            ),
          )
          if (owner !== smartAccount) {
            set.status = 403
            return { error: 'Forbidden: not agent owner' }
          }

          const result = await setAgentAutonomousOnChain({
            ctx,
            agentId,
            enabled: true,
            tickIntervalMs: parsed.tickIntervalMs,
          })

          return {
            success: true,
            agentId: agentId.toString(),
            enabled: result.enabled,
            tickIntervalMs: result.tickIntervalMs,
          }
        })
        .delete('/agents/:agentId', async ({ params, request, set }) => {
          const ctx = await getCtx(env)
          const agentId = parsePositiveBigIntParam(params.agentId, 'agentId')

          if (!config.autonomousEnabled) {
            set.status = 403
            return {
              error: 'Autonomous is disabled (set AUTONOMOUS_ENABLED=true)',
            }
          }

          const authToken = getBearerToken(request.headers.get('authorization'))
          if (!authToken) {
            set.status = 401
            return { error: 'Unauthorized: login required' }
          }

          const session = await validateOAuth3Session(ctx.teeUrl, authToken)
          const smartAccount = getSessionSmartAccount(session, set)
          if (!smartAccount) {
            return { error: 'Unauthorized: wallet address missing' }
          }
          const headerAddress = request.headers.get('x-jeju-address')
          const expectedHeaderAddress = headerAddress
            ? normalizeAddress(headerAddress)
            : null
          if (expectedHeaderAddress && expectedHeaderAddress !== smartAccount) {
            set.status = 401
            return {
              error: 'Unauthorized: address header does not match session',
            }
          }

          const exists = z.boolean().parse(
            await ctx.publicClient.readContract({
              address: ctx.contracts.identityRegistry,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: 'agentExists',
              args: [agentId],
            }),
          )
          if (!exists) {
            set.status = 404
            return { error: 'Agent not found', agentId: agentId.toString() }
          }

          const owner = normalizeAddress(
            z.string().parse(
              await ctx.publicClient.readContract({
                address: ctx.contracts.identityRegistry,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: 'ownerOf',
                args: [agentId],
              }),
            ),
          )
          if (owner !== smartAccount) {
            set.status = 403
            return { error: 'Forbidden: not agent owner' }
          }

          const result = await setAgentAutonomousOnChain({
            ctx,
            agentId,
            enabled: false,
          })

          return {
            success: true,
            agentId: agentId.toString(),
            enabled: result.enabled,
            tickIntervalMs: result.tickIntervalMs,
          }
        }),
    )

    // ============================================
    // Room Routes
    // ============================================
    .group('/api/v1/rooms', (rooms) =>
      rooms
        .get('/', async ({ query }) => {
          const ctx = await getCtx(env)
          const parsed = parseOrThrow(
            RoomSearchQuerySchema,
            query,
            'room search query',
          )

          const result = await ctx.roomSdk.searchRooms({
            name: parsed.name,
            roomType: parsed.roomType,
            active: parsed.active,
            limit: parsed.limit,
            offset: parsed.offset,
          })

          return {
            rooms: result.items.map((room) => ({
              ...room,
              roomId: room.roomId.toString(),
              members: room.members.map((m) => ({
                ...m,
                agentId: m.agentId.toString(),
              })),
            })),
            total: result.total,
            hasMore: result.hasMore,
          }
        })
        .get('/:roomId', async ({ params, set }) => {
          const ctx = await getCtx(env)
          const roomId = parsePositiveBigIntParam(params.roomId, 'roomId')

          const room = await ctx.roomSdk.getRoom(roomId)
          if (!room) {
            set.status = 404
            return { error: 'Room not found', roomId: params.roomId }
          }

          return {
            room: {
              ...room,
              roomId: room.roomId.toString(),
              members: room.members.map((m) => ({
                ...m,
                agentId: m.agentId.toString(),
              })),
            },
          }
        })
        .get('/:roomId/messages', async ({ params, query }) => {
          const ctx = await getCtx(env)
          const roomId = parsePositiveBigIntParam(params.roomId, 'roomId')

          const parsedQuery = z
            .object({
              limit: z.coerce.number().int().positive().max(1000).optional(),
            })
            .parse(query)

          const messages = await ctx.roomSdk.getMessages(
            roomId,
            parsedQuery.limit,
          )
          return { messages }
        })
        .post('/', async ({ body }) => {
          const ctx = await getCtx(env)
          const parsed = parseOrThrow(
            CreateRoomRequestSchema,
            body,
            'create room request',
          )

          const roomConfig = parsed.config ?? {
            maxMembers: 10,
            turnBased: false,
            visibility: 'public' as const,
          }

          const result = await ctx.roomSdk.createRoom(
            parsed.name,
            parsed.description ?? '',
            parsed.roomType,
            {
              maxMembers: roomConfig.maxMembers,
              turnBased: roomConfig.turnBased,
              turnTimeout: roomConfig.turnTimeout,
              visibility: roomConfig.visibility,
            },
          )

          return {
            roomId: result.roomId.toString(),
            stateCid: result.stateCid,
          }
        })
        .post('/:roomId/join', async ({ params, body }) => {
          const ctx = await getCtx(env)
          const roomId = parsePositiveBigIntParam(params.roomId, 'roomId')

          const joinSchema = z.object({
            agentId: z
              .string()
              .regex(/^\d+$/, 'agentId must be numeric string')
              .transform((v) => BigInt(v)),
            role: z.enum([
              'participant',
              'moderator',
              'red_team',
              'blue_team',
              'observer',
            ]),
          })
          const parsed = parseOrThrow(joinSchema, body, 'join room request')
          await ctx.roomSdk.joinRoom(roomId, parsed.agentId, parsed.role)
          return { success: true }
        })
        .post('/:roomId/messages', async ({ params, body }) => {
          const ctx = await getCtx(env)
          const roomId = parsePositiveBigIntParam(params.roomId, 'roomId')

          const messageSchema = z.object({
            agentId: z
              .string()
              .regex(/^\d+$/, 'agentId must be numeric string'),
            content: z.string().min(1).max(10000),
            action: z.string().optional(),
          })
          const parsed = parseOrThrow(
            messageSchema,
            body,
            'post message request',
          )
          const message = await ctx.roomSdk.postMessage(
            roomId,
            parsed.agentId,
            parsed.content,
            parsed.action,
          )
          return { message }
        })
        // Backwards compatibility for older client paths
        .post('/:roomId/message', async ({ params, body }) => {
          const ctx = await getCtx(env)
          const roomId = parsePositiveBigIntParam(params.roomId, 'roomId')

          const messageSchema = z.object({
            agentId: z
              .string()
              .regex(/^\d+$/, 'agentId must be numeric string'),
            content: z.string().min(1).max(10000),
            action: z.string().optional(),
          })
          const parsed = parseOrThrow(
            messageSchema,
            body,
            'post message request',
          )
          const message = await ctx.roomSdk.postMessage(
            roomId,
            parsed.agentId,
            parsed.content,
            parsed.action,
          )
          return { message }
        }),
    )

    // ============================================
    // Chat API (Compute-backed)
    // ============================================
    .post('/api/v1/chat/:characterId', async ({ params, body, set }) => {
      const ctx = await getCtx(env)
      const characterId = params.characterId
      const character = getCharacter(characterId)

      if (!character) {
        set.status = 404
        return { error: `Character not found: ${characterId}` }
      }

      const requestSchema = z
        .object({
          text: z.string().min(1).max(10000).optional(),
          message: z.string().min(1).max(10000).optional(),
          userId: z.string().optional(),
          roomId: z.string().optional(),
        })
        .refine((v) => v.text !== undefined || v.message !== undefined, {
          message: 'Either text or message is required',
        })

      const parsed = parseOrThrow(requestSchema, body, 'chat request')
      const userMessage =
        parsed.text !== undefined ? parsed.text : parsed.message
      if (userMessage === undefined) {
        throw new Error('Invalid chat request: missing message')
      }

      const inference = await ctx.compute.runInference(
        character,
        userMessage,
        {
          recentMessages: [],
          memories: [],
          roomContext: parsed.roomId ? `room:${parsed.roomId}` : undefined,
        },
        undefined,
      )

      return {
        text: inference.content,
        action: null,
        actions: [],
        character: characterId,
      }
    })

    // ============================================
    // A2A Protocol
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'Crucible',
          description: 'Agent Orchestration Platform',
          version: '1.0.0',
          protocol: 'a2a',
          capabilities: ['agents', 'rooms', 'triggers', 'execution'],
        }))
        .post('/invoke', async ({ body, request, set }) => {
          const ctx = await getCtx(env)
          const parsed = z
            .object({
              skill: z.string(),
              params: z.record(z.string(), JsonValueSchema).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            set.status = 422
            return {
              error: 'Invalid A2A request',
              details: parsed.error.issues,
            }
          }

          const skill = parsed.data.skill
          const params = parsed.data.params ? parsed.data.params : {}

          switch (skill) {
            case 'agents.search': {
              const schema = z.object({
                name: z.string().optional(),
                owner: z.string().optional(),
                active: z.boolean().optional(),
                limit: z.coerce.number().int().positive().max(100).optional(),
                offset: z.coerce.number().int().min(0).optional(),
              })
              const p = parseOrThrow(schema, params, 'agents.search params')
              const owner = p.owner ? normalizeAddress(p.owner) : undefined
              const result = await ctx.agentSdk.searchAgents({
                name: p.name,
                owner,
                active: p.active,
                limit: p.limit ?? 20,
                offset: p.offset ?? 0,
              })

              const agents = await Promise.all(
                result.items.map(async (a) => {
                  const character = a.characterCid
                    ? await ctx.storage.loadCharacter(a.characterCid)
                    : null
                  const tickIntervalMs = await loadTickIntervalMs(
                    ctx,
                    a.agentId,
                  )
                  return toWebAgent(a, character, tickIntervalMs)
                }),
              )

              return {
                skill,
                result: {
                  agents,
                  total: result.total,
                  hasMore: result.hasMore,
                },
              }
            }
            case 'agents.get': {
              const schema = z.object({
                agentId: z
                  .string()
                  .regex(/^\d+$/, 'agentId must be numeric string')
                  .transform((v) => BigInt(v)),
              })
              const p = parseOrThrow(schema, params, 'agents.get params')
              const agent = await ctx.agentSdk.getAgent(p.agentId)
              if (!agent) {
                set.status = 404
                return {
                  error: 'Agent not found',
                  agentId: p.agentId.toString(),
                }
              }
              const character = agent.characterCid
                ? await ctx.storage.loadCharacter(agent.characterCid)
                : null
              const tickIntervalMs = await loadTickIntervalMs(
                ctx,
                agent.agentId,
              )
              return {
                skill,
                result: { agent: toWebAgent(agent, character, tickIntervalMs) },
              }
            }
            case 'rooms.search': {
              const schema = z.object({
                name: z.string().optional(),
                roomType: z
                  .enum([
                    'collaboration',
                    'adversarial',
                    'debate',
                    'board',
                    'chat',
                    'coordination',
                    'dao',
                    'marketplace',
                  ])
                  .optional(),
                active: z.boolean().optional(),
                limit: z.coerce.number().int().positive().max(100).optional(),
                offset: z.coerce.number().int().min(0).optional(),
              })
              const p = parseOrThrow(schema, params, 'rooms.search params')

              const roomType: RoomType | undefined = (() => {
                if (!p.roomType) return undefined
                if (
                  p.roomType === 'collaboration' ||
                  p.roomType === 'adversarial' ||
                  p.roomType === 'debate' ||
                  p.roomType === 'board'
                ) {
                  return p.roomType
                }
                if (p.roomType === 'dao') return 'board'
                return 'collaboration'
              })()

              const result = await ctx.roomSdk.searchRooms({
                name: p.name,
                roomType,
                active: p.active,
                limit: p.limit ?? 20,
                offset: p.offset ?? 0,
              })
              return {
                skill,
                result: {
                  rooms: result.items.map((room) => ({
                    ...room,
                    roomId: room.roomId.toString(),
                    members: room.members.map((m) => ({
                      ...m,
                      agentId: m.agentId.toString(),
                    })),
                  })),
                  total: result.total,
                  hasMore: result.hasMore,
                },
              }
            }
            case 'rooms.get': {
              const schema = z.object({
                roomId: z
                  .string()
                  .regex(/^\d+$/, 'roomId must be numeric string')
                  .transform((v) => BigInt(v)),
              })
              const p = parseOrThrow(schema, params, 'rooms.get params')
              const room = await ctx.roomSdk.getRoom(p.roomId)
              if (!room) {
                set.status = 404
                return { error: 'Room not found', roomId: p.roomId.toString() }
              }
              return {
                skill,
                result: {
                  room: {
                    ...room,
                    roomId: room.roomId.toString(),
                    members: room.members.map((m) => ({
                      ...m,
                      agentId: m.agentId.toString(),
                    })),
                  },
                },
              }
            }
            case 'rooms.messages': {
              const schema = z.object({
                roomId: z
                  .string()
                  .regex(/^\d+$/, 'roomId must be numeric string')
                  .transform((v) => BigInt(v)),
                limit: z.coerce.number().int().positive().max(200).optional(),
              })
              const p = parseOrThrow(schema, params, 'rooms.messages params')
              const messages = await ctx.roomSdk.getMessages(
                p.roomId,
                p.limit ?? 50,
              )
              return { skill, result: { messages } }
            }
            case 'execute': {
              const schema = z.object({
                agentId: z
                  .string()
                  .regex(/^\d+$/, 'agentId must be numeric string')
                  .transform((v) => BigInt(v)),
                message: z.string().min(1).max(10000),
              })
              const p = parseOrThrow(schema, params, 'execute params')

              const authToken = getBearerToken(
                request.headers.get('authorization'),
              )
              if (!authToken) {
                set.status = 401
                return { error: 'Unauthorized: login required' }
              }
              const session = await validateOAuth3Session(ctx.teeUrl, authToken)
              const smartAccount = getSessionSmartAccount(session, set)
              if (!smartAccount) {
                return { error: 'Unauthorized: wallet address missing' }
              }
              const headerAddress = request.headers.get('x-jeju-address')
              const expectedHeaderAddress = headerAddress
                ? normalizeAddress(headerAddress)
                : null
              if (
                expectedHeaderAddress &&
                expectedHeaderAddress !== smartAccount
              ) {
                set.status = 401
                return {
                  error: 'Unauthorized: address header does not match session',
                }
              }

              const exists = z.boolean().parse(
                await ctx.publicClient.readContract({
                  address: ctx.contracts.identityRegistry,
                  abi: IDENTITY_REGISTRY_ABI,
                  functionName: 'agentExists',
                  args: [p.agentId],
                }),
              )
              if (!exists) {
                set.status = 404
                return {
                  error: 'Agent not found',
                  agentId: p.agentId.toString(),
                }
              }

              const owner = normalizeAddress(
                z.string().parse(
                  await ctx.publicClient.readContract({
                    address: ctx.contracts.identityRegistry,
                    abi: IDENTITY_REGISTRY_ABI,
                    functionName: 'ownerOf',
                    args: [p.agentId],
                  }),
                ),
              )
              if (owner !== smartAccount) {
                set.status = 403
                return { error: 'Forbidden: not agent owner' }
              }

              const result = await ctx.executorSdk.execute({
                agentId: p.agentId,
                input: {
                  message: p.message,
                  roomId: null,
                  userId: null,
                  context: null,
                },
                options: undefined,
              })

              return {
                skill,
                result: {
                  executionId: result.executionId,
                  status: result.status,
                  output: result.output?.response
                    ? { response: result.output.response }
                    : undefined,
                },
              }
            }
            default:
              set.status = 400
              return { error: `Unknown skill: ${skill}` }
          }
        }),
    )

    // ============================================
    // MCP Protocol
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'Crucible MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'crucible_list_characters',
              description: 'List available character templates',
              parameters: { type: 'object', properties: {} },
            },
            {
              name: 'crucible_create_agent',
              description: 'Create a new agent',
              parameters: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  characterId: { type: 'string' },
                },
                required: ['characterId'],
              },
            },
            {
              name: 'crucible_chat',
              description: 'Chat with an agent',
              parameters: {
                type: 'object',
                properties: {
                  characterId: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['characterId', 'message'],
              },
            },
          ],
        }))
        .post('/invoke', async ({ body, request, set }) => {
          const ctx = await getCtx(env)
          const parsed = z
            .object({
              tool: z.string(),
              arguments: z.record(z.string(), JsonValueSchema).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            set.status = 422
            return {
              error: 'Invalid MCP request',
              details: parsed.error.issues,
            }
          }

          const { tool, arguments: args } = parsed.data
          const params = args ? args : {}

          switch (tool) {
            case 'crucible_list_characters':
              return { tool, result: listCharacters() }
            case 'crucible_create_agent': {
              const schema = z.object({
                characterId: z.string().min(1),
                name: z.string().min(1).optional(),
                initialFunding: z
                  .string()
                  .regex(/^\d+$/, 'initialFunding must be wei string')
                  .optional(),
              })
              const parsedArgs = parseOrThrow(
                schema,
                params,
                'mcp crucible_create_agent arguments',
              )

              const template = getCharacter(parsedArgs.characterId)
              if (!template) {
                set.status = 404
                return {
                  error: `Character not found: ${parsedArgs.characterId}`,
                }
              }

              const character: AgentCharacter = parsedArgs.name
                ? { ...template, name: parsedArgs.name }
                : template

              const initialFundingWei = parsedArgs.initialFunding
                ? BigInt(parsedArgs.initialFunding)
                : 0n

              const authToken = getBearerToken(
                request.headers.get('authorization'),
              )

              if (authToken) {
                const session = await validateOAuth3Session(
                  ctx.teeUrl,
                  authToken,
                )
                const smartAccount = getSessionSmartAccount(session, set)
                if (!smartAccount) {
                  return { error: 'Unauthorized: wallet address missing' }
                }
                const headerAddress = request.headers.get('x-jeju-address')
                const expectedHeaderAddress = headerAddress
                  ? normalizeAddress(headerAddress)
                  : null
                if (
                  expectedHeaderAddress &&
                  expectedHeaderAddress !== smartAccount
                ) {
                  set.status = 401
                  return {
                    error:
                      'Unauthorized: address header does not match session',
                  }
                }

                const result = await registerAgentViaOAuth3({
                  ctx,
                  sessionId: session.sessionId,
                  character,
                  initialFundingWei,
                })

                return {
                  tool,
                  result: {
                    agentId: result.agentId.toString(),
                    vaultAddress: result.vaultAddress,
                    characterCid: result.characterCid,
                    stateCid: result.stateCid,
                  },
                }
              }

              if (ctx.network === 'localnet') {
                const result = await ctx.agentSdk.registerAgent(character, {
                  initialFunding: initialFundingWei,
                })
                return {
                  tool,
                  result: {
                    agentId: result.agentId.toString(),
                    vaultAddress: result.vaultAddress,
                    characterCid: result.characterCid,
                    stateCid: result.stateCid,
                  },
                }
              }

              set.status = 401
              return { error: 'Unauthorized: login required' }
            }
            case 'crucible_chat': {
              const schema = z.object({
                characterId: z.string().min(1),
                message: z.string().min(1).max(10000),
              })
              const parsedArgs = parseOrThrow(
                schema,
                params,
                'mcp crucible_chat arguments',
              )
              const character = getCharacter(parsedArgs.characterId)
              if (!character) {
                set.status = 404
                return {
                  error: `Character not found: ${parsedArgs.characterId}`,
                }
              }

              const inference = await ctx.compute.runInference(
                character,
                parsedArgs.message,
                { recentMessages: [], memories: [] },
                undefined,
              )

              return {
                tool,
                result: {
                  text: inference.content,
                  action: null,
                  actions: [],
                  character: parsedArgs.characterId,
                },
              }
            }
            default:
              set.status = 400
              return { error: `Unknown tool: ${tool}` }
          }
        }),
    )

  // API v1 routes
  app.group('/api/v1', (apiGroup) => {
    // Bots routes
    apiGroup.use(createBotsRouter())

    return apiGroup
  })

  return app
}

// Worker Export (for DWS/workerd)

/**
 * Workerd/Cloudflare Workers execution context
 */
interface ExecutionContext {
  waitUntil<T>(promise: Promise<T>): void
  passThroughOnException(): void
}

/**
 * Cached app instance for worker reuse
 * Compiled once, reused across requests for better performance
 */
let cachedApp: ReturnType<typeof createCrucibleApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: CrucibleEnv): ReturnType<typeof createCrucibleApp> {
  // Create a simple hash of the env to detect changes
  const envHash = `${env.NETWORK}-${env.TEE_MODE}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createCrucibleApp(env).compile()
  cachedEnvHash = envHash
  return cachedApp
}

/**
 * Default export for workerd/Cloudflare Workers.
 * Uses CloudflareAdapter via build script for optimal performance.
 */
export default {
  async fetch(
    request: Request,
    env: CrucibleEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Health check bypasses app initialization for fast response
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          service: 'crucible',
          version: '1.0.0',
          runtime: 'workerd',
          network: env.NETWORK ?? 'testnet',
          features: ['agents', 'rooms', 'orchestration'],
          timestamp: new Date().toISOString(),
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

// Standalone Server (for local dev)
const isMainModule = typeof Bun !== 'undefined' && import.meta.main

if (isMainModule) {
  const port = Number(
    process.env.PORT ??
      process.env.CRUCIBLE_PORT ??
      CORE_PORTS.CRUCIBLE_API.get(),
  )
  const host = getLocalhostHost()
  const network = getCurrentNetwork()

  const app = createCrucibleApp({
    NETWORK: network,
    TEE_MODE: 'simulated',
  })

  console.log(`[Crucible] API server running on http://${host}:${port}`)
  console.log(`[Crucible] Network: ${network}`)
  console.log(`[Crucible] Health: http://${host}:${port}/health`)

  Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
  })
}

// Export app for testing
export { createCrucibleApp as app }
