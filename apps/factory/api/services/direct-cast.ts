import { getFarcasterHubUrl } from '@jejunetwork/config'
import {
  createDirectCastClient,
  type DCClientState,
  type DirectCast,
  type DirectCastClient,
  type DirectCastConversation,
} from '@jejunetwork/messaging'
import { createLogger } from '@jejunetwork/shared'
import type { Hex } from 'viem'
import { getFactoryConfig } from '../config'
import type { FarcasterSignerRow } from '../db/client'
import { getActiveSigner, getSignerPrivateKey } from './signer'

const log = createLogger('dc-service')

const HUB_URL = getFarcasterHubUrl()
const config = getFactoryConfig()
const DC_RELAY_URL = config.dcRelayUrl

/**
 * Client cache - one DC client per user session
 */
const clientCache = new Map<number, DirectCastClient>()

/**
 * Get or create a Direct Cast client for a user
 */
async function getOrCreateClient(
  signer: FarcasterSignerRow,
): Promise<DirectCastClient> {
  const cached = clientCache.get(signer.fid)
  if (cached) {
    return cached
  }

  const signerPrivateKey = getSignerPrivateKey(signer)

  const client = await createDirectCastClient({
    fid: signer.fid,
    signerPrivateKey,
    hubUrl: HUB_URL,
    relayUrl: DC_RELAY_URL,
    persistenceEnabled: false, // Use DB storage instead
  })

  clientCache.set(signer.fid, client)
  log.info('Created DC client', { fid: signer.fid })

  return client
}

/**
 * Get DC client for a user address
 */
export async function getClientForAddress(
  address: string,
): Promise<DirectCastClient | null> {
  const signer = getActiveSigner(address as `0x${string}`)
  if (!signer || signer.key_state !== 'active') {
    return null
  }

  return getOrCreateClient(signer)
}

/**
 * Send a direct message
 */
export async function sendDirectMessage(
  address: string,
  recipientFid: number,
  text: string,
  options?: {
    embeds?: Array<{ url: string }>
    replyTo?: string
  },
): Promise<DirectCast> {
  const client = await getClientForAddress(address)
  if (!client) {
    throw new Error(
      'No active signer found. Please connect your Farcaster account.',
    )
  }

  // Map simple embeds to DirectCastEmbed format
  const mappedEmbeds = options?.embeds?.map((e) => ({
    type: 'url' as const,
    url: e.url,
  }))

  return client.send({
    recipientFid,
    text,
    embeds: mappedEmbeds,
    replyTo: options?.replyTo,
  })
}

/**
 * Get all conversations for a user
 */
export async function getConversations(
  address: string,
): Promise<DirectCastConversation[]> {
  const client = await getClientForAddress(address)
  if (!client) {
    return []
  }

  return client.getConversations()
}

/**
 * Get messages in a conversation
 */
export async function getMessages(
  address: string,
  recipientFid: number,
  options?: {
    before?: string
    after?: string
    limit?: number
  },
): Promise<DirectCast[]> {
  const client = await getClientForAddress(address)
  if (!client) {
    return []
  }

  return client.getMessages(recipientFid, options)
}

/**
 * Get or create a conversation with a user
 */
export async function getConversation(
  address: string,
  recipientFid: number,
): Promise<DirectCastConversation | null> {
  const client = await getClientForAddress(address)
  if (!client) {
    return null
  }

  return client.getConversation(recipientFid)
}

/**
 * Mark a conversation as read
 */
export async function markConversationAsRead(
  address: string,
  recipientFid: number,
): Promise<void> {
  const client = await getClientForAddress(address)
  if (!client) {
    return
  }

  await client.markAsRead(recipientFid)
}

/**
 * Archive a conversation
 */
export async function archiveConversation(
  address: string,
  recipientFid: number,
): Promise<void> {
  const client = await getClientForAddress(address)
  if (!client) {
    return
  }

  await client.archiveConversation(recipientFid)
}

/**
 * Mute/unmute a conversation
 */
export async function setConversationMuted(
  address: string,
  recipientFid: number,
  muted: boolean,
): Promise<void> {
  const client = await getClientForAddress(address)
  if (!client) {
    return
  }

  await client.muteConversation(recipientFid, muted)
}

/**
 * Get client state (connection status, unread count, etc.)
 */
export async function getClientState(
  address: string,
): Promise<DCClientState | null> {
  const client = await getClientForAddress(address)
  if (!client) {
    return null
  }

  return client.getState()
}

/**
 * Subscribe to new messages for a user
 */
export function subscribeToMessages(
  address: string,
  handler: (message: DirectCast) => void,
): (() => void) | null {
  const signer = getActiveSigner(address as `0x${string}`)
  if (!signer || signer.key_state !== 'active') {
    return null
  }

  const client = clientCache.get(signer.fid)
  if (!client) {
    return null
  }

  client.onMessage(handler)

  return () => {
    client.offMessage(handler)
  }
}

/**
 * Force reconnect DC client by recreating it
 */
export async function reconnectClient(address: string): Promise<void> {
  const signer = getActiveSigner(address as `0x${string}`)
  if (!signer || signer.key_state !== 'active') {
    return
  }

  // Close existing client
  const existingClient = clientCache.get(signer.fid)
  if (existingClient) {
    await existingClient.shutdown()
    clientCache.delete(signer.fid)
  }

  // Create new client (will auto-connect)
  await getOrCreateClient(signer)
}

/**
 * Close and remove a client from cache
 */
export async function closeClient(address: string): Promise<void> {
  const signer = getActiveSigner(address as `0x${string}`)
  if (!signer) return

  const client = clientCache.get(signer.fid)
  if (client) {
    await client.shutdown()
    clientCache.delete(signer.fid)
    log.info('Closed DC client', { fid: signer.fid })
  }
}

/**
 * Shutdown all DC clients
 */
export async function shutdownAllClients(): Promise<void> {
  const clients = Array.from(clientCache.values())
  await Promise.all(clients.map((c) => c.shutdown()))
  clientCache.clear()
  log.info('Shutdown all DC clients')
}

/**
 * Get encryption public key for a user
 */
export function getEncryptionPublicKey(address: string): Hex | null {
  const signer = getActiveSigner(address as `0x${string}`)
  if (!signer) return null

  const client = clientCache.get(signer.fid)
  if (!client) return null

  return client.getEncryptionPublicKey()
}

/**
 * Publish encryption key to hub (for discovery)
 */
export async function publishEncryptionKey(address: string): Promise<void> {
  const client = await getClientForAddress(address)
  if (!client) {
    throw new Error('No active signer found')
  }

  await client.publishEncryptionKey()
}
