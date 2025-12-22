/**
 * Compute Actions - GPU rentals
 */

import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import type { Address } from 'viem'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  getMessageText,
  validateProvider,
  validateServiceExists,
} from '../validation'

function extractRentalParams(text: string): {
  provider?: Address
  hours?: number
  gpuType?: string
} {
  const params: { provider?: Address; hours?: number; gpuType?: string } = {}

  // Extract hours
  const hoursMatch = text.match(/(\d+)\s*hours?/i)
  if (hoursMatch) params.hours = parseInt(hoursMatch[1], 10)

  // Extract GPU type
  const gpuTypes = ['H100', 'A100', 'RTX4090', 'H200', 'A100_80GB']
  for (const gpu of gpuTypes) {
    if (text.toUpperCase().includes(gpu)) {
      params.gpuType = gpu.includes('NVIDIA') ? gpu : `NVIDIA_${gpu}`
      break
    }
  }

  // Extract provider address
  const addrMatch = text.match(/0x[a-fA-F0-9]{40}/)
  if (addrMatch) params.provider = addrMatch[0] as Address

  return params
}

export const rentGpuAction: Action = {
  name: 'RENT_GPU',
  description: 'Rent GPU compute resources on the network Network',
  similes: [
    'rent gpu',
    'rent compute',
    'get gpu',
    'provision gpu',
    'start rental',
    'need gpu',
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    const params = extractRentalParams(getMessageText(message))

    if (!params.hours) {
      callback?.({
        text: "Please specify how many hours you need the GPU. Example: 'Rent an H100 GPU for 2 hours'",
      })
      return
    }
    const hours = params.hours

    // Find a suitable provider
    const providers = await client.compute.listProviders({
      gpuType: params.gpuType as 'NVIDIA_H100' | undefined,
    })

    if (providers.length === 0) {
      callback?.({
        text: 'No GPU providers available matching your criteria.',
      })
      return
    }

    const targetAddress = params.provider
    const provider = targetAddress
      ? providers.find(
          (p: { address: string }) =>
            p.address.toLowerCase() === targetAddress.toLowerCase(),
        )
      : providers[0]

    if (!provider) {
      callback?.({ text: 'Provider not found.' })
      return
    }

    // Validate provider has required fields
    const validatedProvider = validateProvider(provider)

    // Get quote
    const quote = await client.compute.getQuote(provider.address, hours)

    callback?.({
      text: `Found provider: ${validatedProvider.name}
GPU: ${validatedProvider.resources.gpuType} x${validatedProvider.resources.gpuCount}
Price: ${quote.costFormatted} ETH for ${hours} hours

Creating rental...`,
    })

    // Create rental
    const txHash = await client.compute.createRental({
      provider: provider.address,
      durationHours: hours,
    })

    callback?.({
      text: `GPU rental created successfully.
Transaction: ${txHash}
Provider: ${provider.name}
Duration: ${hours} hours
Cost: ${quote.costFormatted} ETH

The rental will be active shortly. Use 'check my rentals' to see SSH access details.`,
      content: {
        txHash,
        provider: provider.address,
        hours,
        cost: quote.cost.toString(),
      },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Rent an H100 GPU for 2 hours' },
      },
      {
        name: 'agent',
        content: {
          text: 'GPU rental created successfully. Provider: ComputeNode-1...',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'I need GPU compute for training' },
      },
      {
        name: 'agent',
        content: {
          text: 'Found provider: GPU-Provider-A, GPU: NVIDIA_H100 x4...',
        },
      },
    ],
  ],
}
