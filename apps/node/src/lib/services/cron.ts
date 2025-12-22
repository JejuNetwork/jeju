import type { Address } from 'viem'
import { z } from 'zod'
import { TRIGGER_REGISTRY_ABI } from '../abis'
import { getChain, type NodeClient } from '../contracts'

const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((val) => val as Address)

/** SSRF protection - validate endpoint URL is not targeting internal networks */
function validateEndpointUrl(endpoint: string): void {
  const url = new URL(endpoint)

  // Only allow http(s) protocols
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(
      `Invalid protocol: ${url.protocol}. Only http and https allowed.`,
    )
  }

  const hostname = url.hostname.toLowerCase()

  // Block localhost and loopback
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    throw new Error('SSRF protection: localhost not allowed')
  }

  // Block private IPv4 ranges
  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  )
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number)
    const [a, b] = octets
    // 10.0.0.0/8
    if (a === 10)
      throw new Error('SSRF protection: private network 10.0.0.0/8 not allowed')
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31)
      throw new Error(
        'SSRF protection: private network 172.16.0.0/12 not allowed',
      )
    // 192.168.0.0/16
    if (a === 192 && b === 168)
      throw new Error(
        'SSRF protection: private network 192.168.0.0/16 not allowed',
      )
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254)
      throw new Error('SSRF protection: link-local 169.254.0.0/16 not allowed')
    // 0.0.0.0
    if (a === 0) throw new Error('SSRF protection: 0.0.0.0/8 not allowed')
  }

  // Block common internal hostnames
  const blockedPatterns = [
    'internal',
    'intranet',
    'corp',
    'private',
    'metadata',
    'instance-data',
  ]
  for (const pattern of blockedPatterns) {
    if (hostname.includes(pattern)) {
      throw new Error(
        `SSRF protection: hostname containing '${pattern}' not allowed`,
      )
    }
  }

  // Block AWS/GCP/Azure metadata endpoints
  const metadataHosts = [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.internal',
  ]
  if (metadataHosts.includes(hostname)) {
    throw new Error('SSRF protection: cloud metadata endpoint not allowed')
  }
}

const TriggerSchema = z.object({
  id: z.bigint(),
  owner: AddressSchema,
  triggerType: z.number().int().nonnegative(),
  endpoint: z.string().url(),
  schedule: z.string().min(1),
  pricePerExecution: z.bigint(),
})

export interface Trigger {
  id: bigint
  owner: Address
  triggerType: number
  endpoint: string
  schedule: string
  pricePerExecution: bigint
}

const CronServiceStateSchema = z.object({
  activeTriggers: z.array(TriggerSchema),
  executionsCompleted: z.number().int().nonnegative(),
  earningsWei: z.bigint(),
})

export interface CronServiceState {
  activeTriggers: Trigger[]
  executionsCompleted: number
  earningsWei: bigint
}

export function validateTrigger(data: unknown): Trigger {
  return TriggerSchema.parse(data)
}

export function validateCronServiceState(data: unknown): CronServiceState {
  return CronServiceStateSchema.parse(data)
}

export class CronService {
  private client: NodeClient
  private executionsCompleted = 0
  private earningsWei = 0n

  constructor(client: NodeClient) {
    this.client = client
  }

  async getActiveTriggers(): Promise<Trigger[]> {
    const triggers = await this.client.publicClient.readContract({
      address: this.client.addresses.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'getActiveTriggers',
    })

    return triggers.map(
      (t: {
        id: bigint
        owner: Address
        triggerType: number
        endpoint: string
        schedule: string
        pricePerExecution: bigint
      }) => {
        const trigger = {
          id: t.id,
          owner: t.owner as `0x${string}`,
          triggerType: t.triggerType,
          endpoint: t.endpoint,
          schedule: t.schedule,
          pricePerExecution: t.pricePerExecution,
        }
        return validateTrigger(trigger)
      },
    )
  }

  async executeTrigger(
    triggerId: bigint,
  ): Promise<{ success: boolean; txHash: string }> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    // Get trigger info
    const triggers = await this.getActiveTriggers()
    const trigger = triggers.find((t) => t.id === triggerId)
    if (!trigger) {
      throw new Error(`Trigger ${triggerId} not found`)
    }

    // Validate endpoint URL to prevent SSRF attacks
    validateEndpointUrl(trigger.endpoint)

    // Execute the trigger endpoint
    const response = await fetch(trigger.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerId: triggerId.toString() }),
    })
    const success = response.ok

    // Record execution on-chain
    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'recordExecution',
      args: [triggerId, success],
    })

    if (success) {
      this.executionsCompleted++
      // Executor gets 10% of price
      this.earningsWei += (trigger.pricePerExecution * 10n) / 100n
    }

    return { success, txHash: hash }
  }

  async getState(): Promise<CronServiceState> {
    const triggers = await this.getActiveTriggers()
    const rawState = {
      activeTriggers: triggers,
      executionsCompleted: this.executionsCompleted,
      earningsWei: this.earningsWei,
    }
    return validateCronServiceState(rawState)
  }
}

export function createCronService(client: NodeClient): CronService {
  return new CronService(client)
}
