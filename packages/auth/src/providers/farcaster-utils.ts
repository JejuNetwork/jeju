/**
 * Browser-safe Farcaster utilities
 *
 * These functions don't require KMS and can be safely used in browser bundles.
 */

import type { Address } from 'viem'

export interface FarcasterAuthMessage {
  domain: string
  address: Address
  uri: string
  version: string
  nonce: string
  issuedAt: string
  expirationTime?: string
  notBefore?: string
  resources?: string[]
  fid?: number
  custody?: Address
}

export interface GenerateSignInMessageParams {
  domain: string
  address: Address
  fid: number
  custody: Address
  nonce?: string
  expirationMinutes?: number
  resources?: string[]
}

/**
 * Format a Farcaster auth message (SIWF format)
 */
function formatSignInMessage(msg: FarcasterAuthMessage): string {
  let message = `${msg.domain} wants you to sign in with your Ethereum account:\n`
  message += `${msg.address}\n\n`
  message += `Sign in with Farcaster\n\n`
  message += `URI: ${msg.uri}\n`
  message += `Version: ${msg.version}\n`
  message += `Chain ID: 1\n`
  message += `Nonce: ${msg.nonce}\n`
  message += `Issued At: ${msg.issuedAt}\n`

  if (msg.expirationTime) {
    message += `Expiration Time: ${msg.expirationTime}\n`
  }

  if (msg.fid) {
    message += `FID: ${msg.fid}\n`
  }

  if (msg.custody) {
    message += `Custody: ${msg.custody}\n`
  }

  if (msg.resources && msg.resources.length > 0) {
    message += `Resources:\n`
    for (const resource of msg.resources) {
      message += `- ${resource}\n`
    }
  }

  return message
}

/**
 * Generate a Sign In With Farcaster (SIWF) message
 *
 * This is browser-safe and doesn't require any KMS functionality.
 */
export function generateFarcasterSignInMessage(
  params: GenerateSignInMessageParams,
): string {
  const now = new Date()
  const nonce = params.nonce ?? crypto.randomUUID()
  const expirationTime = new Date(
    now.getTime() + (params.expirationMinutes ?? 60) * 60 * 1000,
  )

  const message: FarcasterAuthMessage = {
    domain: params.domain,
    address: params.address,
    uri: `https://${params.domain}`,
    version: '1',
    nonce,
    issuedAt: now.toISOString(),
    expirationTime: expirationTime.toISOString(),
    fid: params.fid,
    custody: params.custody,
    resources: params.resources,
  }

  return formatSignInMessage(message)
}

/**
 * Parse a SIWF message back into components
 */
export function parseFarcasterSignInMessage(
  message: string,
): FarcasterAuthMessage {
  const lines = message.split('\n')
  const result: Partial<FarcasterAuthMessage> = {}

  for (const line of lines) {
    if (line.startsWith('URI: ')) result.uri = line.slice(5)
    else if (line.startsWith('Version: ')) result.version = line.slice(9)
    else if (line.startsWith('Nonce: ')) result.nonce = line.slice(7)
    else if (line.startsWith('Issued At: ')) result.issuedAt = line.slice(11)
    else if (line.startsWith('Expiration Time: '))
      result.expirationTime = line.slice(17)
    else if (line.startsWith('FID: ')) result.fid = parseInt(line.slice(5), 10)
    else if (line.startsWith('Custody: '))
      result.custody = line.slice(9) as Address
    else if (line.match(/^0x[a-fA-F0-9]{40}$/)) result.address = line as Address
    else if (line.includes(' wants you to sign in')) {
      result.domain = line.split(' wants you to sign in')[0]
    }
  }

  return result as FarcasterAuthMessage
}
