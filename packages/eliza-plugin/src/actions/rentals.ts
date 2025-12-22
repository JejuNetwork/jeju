/**
 * Rental Actions - Extended compute rental management
 */

import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  getMessageText,
  getOptionalMessageText,
  validateProvider,
  validateServiceExists,
} from '../validation'

export const listMyRentalsAction: Action = {
  name: 'LIST_MY_RENTALS',
  description: 'List my active compute rentals',
  similes: ['my rentals', 'list rentals', 'active rentals', 'show rentals'],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    const rentals = await client.compute.listMyRentals()

    if (rentals.length === 0) {
      callback?.({ text: 'You have no active rentals.' })
      return
    }

    const rentalList = rentals
      .map(
        (r: { rentalId: string; status: string; provider: string }) =>
          `• Rental ${r.rentalId.slice(0, 10)}... - Status: ${r.status} - Provider: ${r.provider.slice(0, 10)}...`,
      )
      .join('\n')

    callback?.({
      text: `Your Active Rentals (${rentals.length}):
${rentalList}

Use 'get ssh access [rentalId]' for connection details.`,
      content: { rentals },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Show my rentals' } },
      {
        name: 'agent',
        content: { text: 'Your Active Rentals (2): • Rental 0x1234...' },
      },
    ],
  ],
}

export const getSshAccessAction: Action = {
  name: 'GET_SSH_ACCESS',
  description: 'Get SSH access details for a rental',
  similes: ['ssh access', 'get ssh', 'connect to rental', 'ssh details'],

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
    const text = getMessageText(message)

    const rentalIdMatch = text.match(/0x[a-fA-F0-9]+/)

    if (!rentalIdMatch) {
      callback?.({ text: 'Please provide a rental ID.' })
      return
    }

    const rental = await client.compute.getRental(
      rentalIdMatch[0] as `0x${string}`,
    )

    if (!rental) {
      callback?.({ text: 'Rental not found.' })
      return
    }

    callback?.({
      text: `SSH Access Details:
Host: ${rental.sshHost}
Port: ${rental.sshPort}
Command: ssh -p ${rental.sshPort} root@${rental.sshHost}

Status: ${rental.status}
Ends: ${new Date(Number(rental.endTime) * 1000).toLocaleString()}`,
      content: rental,
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Get SSH access for rental 0x1234...' },
      },
      {
        name: 'agent',
        content: {
          text: 'SSH Access Details: Host: compute-1.jejunetwork.org...',
        },
      },
    ],
  ],
}

export const listProvidersAction: Action = {
  name: 'LIST_PROVIDERS',
  description: 'List available compute providers',
  similes: [
    'list providers',
    'show providers',
    'compute providers',
    'gpu providers',
    'available gpus',
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
    const text = getOptionalMessageText(message) // GPU filter is optional

    // Extract optional GPU type filter
    const gpuTypes = ['H100', 'A100', 'RTX4090', 'H200']
    let gpuType: string | undefined
    for (const gpu of gpuTypes) {
      if (text.toUpperCase().includes(gpu)) {
        gpuType = `NVIDIA_${gpu}`
        break
      }
    }

    const providers = await client.compute.listProviders({
      gpuType: gpuType as 'NVIDIA_H100',
    })

    if (providers.length === 0) {
      callback?.({ text: 'No providers available matching your criteria.' })
      return
    }

    const providerList = providers
      .slice(0, 10)
      .map(
        (p: {
          name: string
          address: string
          resources?: { gpuType?: string; gpuCount?: number }
          pricing?: {
            pricePerHour?: bigint | number
            pricePerHourFormatted?: string
          }
        }) => {
          const validated = validateProvider(p)
          return `• ${validated.name} - ${validated.resources.gpuType} x${validated.resources.gpuCount} - $${(Number(validated.pricing.pricePerHour) / 1e18).toFixed(4)}/hr`
        },
      )
      .join('\n')

    callback?.({
      text: `Available Providers (${providers.length}):
${providerList}

Use 'rent from [provider]' to create a rental.`,
      content: { providers },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Show H100 providers' } },
      {
        name: 'agent',
        content: { text: 'Available Providers (5): • GPU-Node-1 - H100 x8...' },
      },
    ],
  ],
}

export const listModelsAction: Action = {
  name: 'LIST_MODELS',
  description: 'List available AI models for inference',
  similes: ['list models', 'available models', 'ai models', 'inference models'],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    const models = await client.compute.listModels()

    if (models.length === 0) {
      callback?.({ text: 'No AI models available at this time.' })
      return
    }

    const modelList = models
      .slice(0, 15)
      .map(
        (m: {
          modelId: string
          provider: string
          pricePerToken: number | string
        }) =>
          `• ${m.modelId} - ${m.provider.slice(0, 10)}... - $${m.pricePerToken}/token`,
      )
      .join('\n')

    callback?.({
      text: `Available AI Models (${models.length}):
${modelList}

Use 'run inference with [model]' to execute.`,
      content: { models },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'What AI models are available?' } },
      {
        name: 'agent',
        content: { text: 'Available AI Models (12): • llama-3-70b...' },
      },
    ],
  ],
}
