/**
 * Secrets Management for Crucible
 * Provides access to API keys and private keys via env vars or vault
 */

import type { Address, Hex } from 'viem'

const secretCache = new Map<string, string>()

async function getSecret(
  secretName: string,
  envFallback?: string,
): Promise<string | undefined> {
  const cached = secretCache.get(secretName)
  if (cached) return cached

  if (envFallback) {
    const envValue = process.env[envFallback]
    if (envValue) {
      secretCache.set(secretName, envValue)
      return envValue
    }
  }

  return undefined
}

export async function getApiKey(_address: Address): Promise<string | null> {
  const key = await getSecret('api-key', 'API_KEY')
  return key ?? null
}

export async function getPrivateKey(_address: Address): Promise<Hex | null> {
  const key = await getSecret('private-key', 'PRIVATE_KEY')
  if (!key) {
    const devKey = process.env.DEPLOYER_PRIVATE_KEY
    if (devKey) return devKey as Hex
    return null
  }
  return key as Hex
}

export async function getCronSecret(_address: Address): Promise<string | null> {
  const secret = await getSecret('cron-secret', 'CRON_SECRET')
  return secret ?? null
}

export async function getOpenAIKey(): Promise<string | undefined> {
  return getSecret('openai-api-key', 'OPENAI_API_KEY')
}

export async function getAnthropicKey(): Promise<string | undefined> {
  return getSecret('anthropic-api-key', 'ANTHROPIC_API_KEY')
}

export async function getGroqKey(): Promise<string | undefined> {
  return getSecret('groq-api-key', 'GROQ_API_KEY')
}
