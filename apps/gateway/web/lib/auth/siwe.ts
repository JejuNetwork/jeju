import type { Address } from 'viem'

export interface SIWEMessage {
  domain: string
  address: Address
  statement: string
  uri: string
  version: string
  chainId: number
  nonce: string
  issuedAt: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Create a SIWE message object
 */
export function createSIWEMessage(params: {
  domain: string
  address: Address
  uri: string
  chainId: number
  statement?: string
  nonce?: string
  expirationMinutes?: number
  resources?: string[]
}): SIWEMessage {
  const now = new Date()
  const nonce = params.nonce || generateNonce()

  const expirationTime = params.expirationMinutes
    ? new Date(
        now.getTime() + params.expirationMinutes * 60 * 1000,
      ).toISOString()
    : undefined

  return {
    domain: params.domain,
    address: params.address,
    statement: params.statement || 'Sign in with Ethereum to authenticate.',
    uri: params.uri,
    version: '1',
    chainId: params.chainId,
    nonce,
    issuedAt: now.toISOString(),
    expirationTime,
    resources: params.resources,
  }
}

/**
 * Format SIWE message for signing (EIP-4361 format)
 */
export function formatSIWEMessage(message: SIWEMessage): string {
  const lines = [
    `${message.domain} wants you to sign in with your Ethereum account:`,
    message.address,
    '',
    message.statement,
    '',
    `URI: ${message.uri}`,
    `Version: ${message.version}`,
    `Chain ID: ${message.chainId}`,
    `Nonce: ${message.nonce}`,
    `Issued At: ${message.issuedAt}`,
  ]

  if (message.expirationTime) {
    lines.push(`Expiration Time: ${message.expirationTime}`)
  }
  if (message.notBefore) {
    lines.push(`Not Before: ${message.notBefore}`)
  }
  if (message.requestId) {
    lines.push(`Request ID: ${message.requestId}`)
  }
  if (message.resources && message.resources.length > 0) {
    lines.push('Resources:')
    for (const resource of message.resources) {
      lines.push(`- ${resource}`)
    }
  }

  return lines.join('\n')
}
