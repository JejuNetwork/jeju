import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import { decryptAesGcm } from '@jejunetwork/shared'
import { keccak256, toBytes } from 'viem'
import { getConfiguredProviders, type APIProvider } from '../api-marketplace'
import { PROVIDERS_BY_ID } from '../api-marketplace/providers'
import { z } from 'zod'
import {
  getModelHintsForProvider,
  inferenceNodes,
  registerNode,
  updateNodeHeartbeat,
} from './inference-node'

const LOCAL_PROVIDER_PREFIX = 'local-provider:'
const HEARTBEAT_INTERVAL_MS = 30000
const SERVICE_ID = 'dws'
const SQLIT_DATABASE_ID = process.env.SQLIT_DATABASE_ID ?? 'dws'

const OPENAI_COMPATIBLE_PROVIDERS = [
  'openai',
  'groq',
  'together',
  'openrouter',
  'fireworks',
  'mistral',
  'deepseek',
  'cerebras',
  'perplexity',
  'sambanova',
  'ai21',
]

let providersInitialized = false
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
const heartbeatAddresses: string[] = []
const providerKeyCache = new Map<string, string>()
const envVarToProviderId = new Map<string, string>(
  Array.from(PROVIDERS_BY_ID.values()).map((provider) => [
    provider.envVar,
    provider.id,
  ]),
)

const VaultRevealSchema = z.object({
  value: z.string(),
})

interface SecretRow {
  id: string
  encrypted_value: string
  expires_at: number | null
}

let sqlitClient: SQLitClient | null = null

function isProviderSupported(provider: APIProvider): boolean {
  if (provider.id === 'anthropic') return true
  return OPENAI_COMPATIBLE_PROVIDERS.includes(provider.id)
}
export function getProviderKey(providerId: string): string | null {
  const provider = PROVIDERS_BY_ID.get(providerId)
  if (!provider) return null
  const envValue = process.env[provider.envVar]
  if (envValue) return envValue
  return (
    providerKeyCache.get(providerId) ??
    providerKeyCache.get(provider.envVar) ??
    null
  )
}

export function hasProviderKey(providerId: string): boolean {
  return getProviderKey(providerId) !== null
}

async function getSQLitClient(): Promise<SQLitClient> {
  if (!sqlitClient) {
    sqlitClient = getSQLit({
      databaseId: SQLIT_DATABASE_ID,
      timeoutMs: 30000,
      debug: process.env.NODE_ENV !== 'production',
    })
    const healthy = await sqlitClient.isHealthy()
    if (!healthy) {
      throw new Error('[Inference] SQLit is required for vault secrets')
    }
  }
  return sqlitClient
}

function getServiceOwner(serviceId: string): string {
  const hash = keccak256(toBytes(serviceId))
  return `0x${hash.slice(-40)}`.toLowerCase()
}

async function decryptVaultSecret(
  id: string,
  encryptedValue: string,
): Promise<string> {
  const data = new Uint8Array(
    atob(encryptedValue)
      .split('')
      .map((c) => c.charCodeAt(0)),
  )
  const iv = data.subarray(0, 12)
  const authTag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)
  const derivedKey = new Uint8Array(
    Buffer.from(keccak256(toBytes(id)).slice(2), 'hex'),
  )
  const decryptedBytes = await decryptAesGcm(
    ciphertext,
    derivedKey,
    iv,
    authTag,
  )
  return new TextDecoder().decode(decryptedBytes)
}

async function fetchSecretByNameLocal(name: string): Promise<string | null> {
  const client = await getSQLitClient()
  const owner = getServiceOwner(SERVICE_ID)
  const rows = await client.query<SecretRow>(
    'SELECT id, encrypted_value, expires_at FROM kms_secrets WHERE name = ? AND owner = ? ORDER BY updated_at DESC LIMIT 1',
    [name, owner],
    SQLIT_DATABASE_ID,
  )
  const secret = rows.rows[0]
  if (!secret) return null
  if (secret.expires_at && secret.expires_at < Date.now()) return null
  return decryptVaultSecret(secret.id, secret.encrypted_value)
}


function buildNodeAddress(providerId: string): string {
  return `${LOCAL_PROVIDER_PREFIX}${providerId}`
}

function normalizeBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith('/')) {
    return baseUrl.slice(0, -1)
  }
  return baseUrl
}

function startHeartbeats(): void {
  if (heartbeatTimer !== null) return
  heartbeatTimer = setInterval(() => {
    for (const address of heartbeatAddresses) {
      updateNodeHeartbeat(address, 0)
    }
  }, HEARTBEAT_INTERVAL_MS)
}

async function fetchSecretByName(
  baseUrl: string,
  name: string,
): Promise<string | null> {
  try {
    const localValue = await fetchSecretByNameLocal(name)
    if (localValue) return localValue
  } catch {
    // Fall through to HTTP fetch
  }
  const url = new URL('/kms/vault/secrets/reveal', baseUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-id': SERVICE_ID,
    },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) return null
  const revealed = VaultRevealSchema.parse(await response.json())
  return revealed.value
}

async function hydrateProviderEnvFromVault(baseUrl: string): Promise<number> {
  let loaded = 0

  for (const [envVar, providerId] of envVarToProviderId.entries()) {
    if (process.env[envVar]) continue
    const value = await fetchSecretByName(baseUrl, `dws:${envVar}`)
    if (!value) continue
    process.env[envVar] = value
    providerKeyCache.set(envVar, value)
    providerKeyCache.set(providerId, value)
    loaded += 1
  }

  return loaded
}

export async function registerConfiguredInferenceProviders(
  baseUrl: string,
): Promise<number> {
  if (providersInitialized && heartbeatAddresses.length > 0) return 0

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  await hydrateProviderEnvFromVault(normalizedBaseUrl)
  const configured = getConfiguredProviders()
  let registeredCount = 0

  for (const provider of configured) {
    if (!provider.categories.includes('inference')) continue
    if (!isProviderSupported(provider)) continue
    if (!hasProviderKey(provider.id)) continue

    const address = buildNodeAddress(provider.id)
    const addressLower = address.toLowerCase()

    if (!inferenceNodes.has(addressLower)) {
      registerNode({
        address,
        name: provider.name,
        endpoint: `${normalizedBaseUrl}/compute/providers/${provider.id}`,
        capabilities: ['inference'],
        models: getModelHintsForProvider(provider.id),
        provider: provider.id,
        region: 'local',
        gpuTier: 0,
        maxConcurrent: 20,
        isActive: true,
      })
      registeredCount += 1
    }

    if (!heartbeatAddresses.includes(address)) {
      heartbeatAddresses.push(address)
    }
  }

  if (heartbeatAddresses.length > 0) {
    startHeartbeats()
  }

  providersInitialized = true
  return registeredCount
}
