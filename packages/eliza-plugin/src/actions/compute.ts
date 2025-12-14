/**
 * Compute Actions - GPU rentals
 */

import {
  type Action,
  type ActionExample,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import type { Address } from 'viem';
import { JEJU_SERVICE_NAME, type JejuService } from '../service';

function extractRentalParams(text: string): {
  provider?: Address;
  hours?: number;
  gpuType?: string;
} {
  const params: { provider?: Address; hours?: number; gpuType?: string } = {};

  // Extract hours
  const hoursMatch = text.match(/(\d+)\s*hours?/i);
  if (hoursMatch) params.hours = parseInt(hoursMatch[1]);

  // Extract GPU type
  const gpuTypes = ['H100', 'A100', 'RTX4090', 'H200', 'A100_80GB'];
  for (const gpu of gpuTypes) {
    if (text.toUpperCase().includes(gpu)) {
      params.gpuType = gpu.includes('NVIDIA') ? gpu : `NVIDIA_${gpu}`;
      break;
    }
  }

  // Extract provider address
  const addrMatch = text.match(/0x[a-fA-F0-9]{40}/);
  if (addrMatch) params.provider = addrMatch[0] as Address;

  return params;
}

export const rentGpuAction: Action = {
  name: 'RENT_GPU',
  description: 'Rent GPU compute resources on the network Network',
  similes: ['rent gpu', 'rent compute', 'get gpu', 'provision gpu', 'start rental', 'need gpu'],

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService(JEJU_SERVICE_NAME);
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options: Record<string, unknown>,
    callback?: HandlerCallback
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const client = service.getClient();

    const params = extractRentalParams(message.content.text ?? '');
    const hours = params.hours ?? 1;

    // Find a suitable provider
    const providers = await client.compute.listProviders({
      gpuType: (params.gpuType as 'NVIDIA_H100') ?? undefined,
    });

    if (providers.length === 0) {
      callback?.({ text: 'No GPU providers available matching your criteria.' });
      return;
    }

    const provider = params.provider
      ? providers.find((p) => p.address.toLowerCase() === params.provider!.toLowerCase())
      : providers[0];

    if (!provider) {
      callback?.({ text: 'Provider not found.' });
      return;
    }

    // Get quote
    const quote = await client.compute.getQuote(provider.address, hours);

    callback?.({
      text: `Found provider: ${provider.name}
GPU: ${provider.resources?.gpuType} x${provider.resources?.gpuCount}
Price: ${quote.costFormatted} ETH for ${hours} hours

Creating rental...`,
    });

    // Create rental
    const txHash = await client.compute.createRental({
      provider: provider.address,
      durationHours: hours,
    });

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
    });
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Rent an H100 GPU for 2 hours' },
      },
      {
        user: '{{agent}}',
        content: { text: 'GPU rental created successfully. Provider: ComputeNode-1...' },
      },
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'I need GPU compute for training' },
      },
      {
        user: '{{agent}}',
        content: { text: 'Found provider: GPU-Provider-A, GPU: NVIDIA_H100 x4...' },
      },
    ],
  ] as ActionExample[][],
};

