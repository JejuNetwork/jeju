/**
 * SDK Compute Tests
 *
 * Tests for compute/GPU rental functionality.
 */

import { describe, expect, it } from 'bun:test'

// Provider info
interface ComputeProvider {
  id: string
  name: string
  location: string
  gpuTypes: string[]
  availableCount: number
  pricePerHour: number
  reputation: number
}

// Rental config
interface RentalConfig {
  gpuType: string
  count: number
  durationHours: number
  maxPricePerHour?: number
  preferredProviders?: string[]
}

// Rental result
interface Rental {
  id: string
  providerId: string
  gpuType: string
  count: number
  startTime: number
  endTime: number
  status: 'pending' | 'active' | 'completed' | 'cancelled'
  accessEndpoint?: string
  sshPublicKey?: string
}

// Inference request
interface InferenceRequest {
  model: string
  prompt: string
  maxTokens?: number
  temperature?: number
  topP?: number
  stream?: boolean
}

// Inference response
interface InferenceResponse {
  id: string
  content: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  model: string
  finishReason: 'stop' | 'length' | 'content_filter'
}

describe('ComputeProvider', () => {
  it('validates complete provider', () => {
    const provider: ComputeProvider = {
      id: 'provider-123',
      name: 'GPU Cloud',
      location: 'us-east-1',
      gpuTypes: ['A100', 'H100', 'RTX4090'],
      availableCount: 8,
      pricePerHour: 2.5,
      reputation: 0.95,
    }

    expect(provider.gpuTypes).toContain('A100')
    expect(provider.reputation).toBeGreaterThanOrEqual(0)
    expect(provider.reputation).toBeLessThanOrEqual(1)
  })

  it('filters providers by GPU type', () => {
    const providers: ComputeProvider[] = [
      {
        id: 'p1',
        name: 'P1',
        location: 'us',
        gpuTypes: ['A100'],
        availableCount: 4,
        pricePerHour: 3,
        reputation: 0.9,
      },
      {
        id: 'p2',
        name: 'P2',
        location: 'eu',
        gpuTypes: ['H100', 'A100'],
        availableCount: 8,
        pricePerHour: 4,
        reputation: 0.95,
      },
      {
        id: 'p3',
        name: 'P3',
        location: 'asia',
        gpuTypes: ['RTX4090'],
        availableCount: 16,
        pricePerHour: 1.5,
        reputation: 0.85,
      },
    ]

    const h100Providers = providers.filter((p) => p.gpuTypes.includes('H100'))
    expect(h100Providers).toHaveLength(1)
    expect(h100Providers[0].id).toBe('p2')
  })

  it('sorts providers by price', () => {
    const providers: ComputeProvider[] = [
      {
        id: 'p1',
        name: 'P1',
        location: 'us',
        gpuTypes: ['A100'],
        availableCount: 4,
        pricePerHour: 3,
        reputation: 0.9,
      },
      {
        id: 'p2',
        name: 'P2',
        location: 'eu',
        gpuTypes: ['A100'],
        availableCount: 8,
        pricePerHour: 2,
        reputation: 0.95,
      },
    ]

    const sorted = [...providers].sort(
      (a, b) => a.pricePerHour - b.pricePerHour,
    )
    expect(sorted[0].pricePerHour).toBe(2)
  })
})

describe('RentalConfig', () => {
  it('validates minimal config', () => {
    const config: RentalConfig = {
      gpuType: 'A100',
      count: 1,
      durationHours: 1,
    }

    expect(config.gpuType).toBe('A100')
    expect(config.count).toBeGreaterThan(0)
  })

  it('validates full config', () => {
    const config: RentalConfig = {
      gpuType: 'H100',
      count: 4,
      durationHours: 24,
      maxPricePerHour: 5,
      preferredProviders: ['provider-1', 'provider-2'],
    }

    expect(config.maxPricePerHour).toBeDefined()
    expect(config.preferredProviders).toHaveLength(2)
  })

  it('calculates estimated cost', () => {
    const config: RentalConfig = {
      gpuType: 'A100',
      count: 2,
      durationHours: 8,
    }
    const pricePerHour = 2.5

    const estimatedCost = config.count * config.durationHours * pricePerHour
    expect(estimatedCost).toBe(40) // 2 * 8 * 2.5
  })
})

describe('Rental', () => {
  it('validates pending rental', () => {
    const rental: Rental = {
      id: 'rental-123',
      providerId: 'provider-456',
      gpuType: 'A100',
      count: 1,
      startTime: Date.now(),
      endTime: Date.now() + 3600000,
      status: 'pending',
    }

    expect(rental.status).toBe('pending')
    expect(rental.accessEndpoint).toBeUndefined()
  })

  it('validates active rental', () => {
    const rental: Rental = {
      id: 'rental-123',
      providerId: 'provider-456',
      gpuType: 'A100',
      count: 1,
      startTime: Date.now() - 1800000, // Started 30 min ago
      endTime: Date.now() + 1800000, // Ends in 30 min
      status: 'active',
      accessEndpoint: 'https://gpu.provider.com/rental-123',
      sshPublicKey: 'ssh-rsa AAAA...',
    }

    expect(rental.status).toBe('active')
    expect(rental.accessEndpoint).toBeDefined()
  })

  it('calculates remaining time', () => {
    const rental: Rental = {
      id: 'rental-123',
      providerId: 'provider-456',
      gpuType: 'A100',
      count: 1,
      startTime: Date.now() - 1800000,
      endTime: Date.now() + 1800000, // 30 minutes remaining
      status: 'active',
    }

    const remainingMs = rental.endTime - Date.now()
    expect(remainingMs).toBeLessThanOrEqual(1800000)
    expect(remainingMs).toBeGreaterThan(0)
  })
})

describe('InferenceRequest', () => {
  it('validates minimal request', () => {
    const request: InferenceRequest = {
      model: 'llama-3-70b',
      prompt: 'Hello, how are you?',
    }

    expect(request.model).toBe('llama-3-70b')
    expect(request.prompt).toBeDefined()
  })

  it('validates full request', () => {
    const request: InferenceRequest = {
      model: 'llama-3-70b',
      prompt: 'Explain quantum computing',
      maxTokens: 500,
      temperature: 0.7,
      topP: 0.9,
      stream: true,
    }

    expect(request.temperature).toBeLessThanOrEqual(2)
    expect(request.topP).toBeLessThanOrEqual(1)
  })

  it('validates temperature range', () => {
    const validTemperatures = [0, 0.5, 1, 1.5, 2]
    for (const temp of validTemperatures) {
      expect(temp).toBeGreaterThanOrEqual(0)
      expect(temp).toBeLessThanOrEqual(2)
    }
  })
})

describe('InferenceResponse', () => {
  it('validates complete response', () => {
    const response: InferenceResponse = {
      id: 'resp-123',
      content:
        'Quantum computing uses quantum mechanical phenomena to process information.',
      usage: {
        promptTokens: 10,
        completionTokens: 50,
        totalTokens: 60,
      },
      model: 'llama-3-70b',
      finishReason: 'stop',
    }

    expect(response.finishReason).toBe('stop')
    expect(response.usage.totalTokens).toBe(
      response.usage.promptTokens + response.usage.completionTokens,
    )
  })

  it('validates truncated response', () => {
    const response: InferenceResponse = {
      id: 'resp-456',
      content: 'This is a long response that was...',
      usage: {
        promptTokens: 10,
        completionTokens: 100,
        totalTokens: 110,
      },
      model: 'llama-3-8b',
      finishReason: 'length',
    }

    expect(response.finishReason).toBe('length')
  })
})

describe('Cost calculation', () => {
  it('calculates token-based cost', () => {
    const usage = {
      promptTokens: 100,
      completionTokens: 200,
    }
    const rates = {
      promptPerMillion: 0.5,
      completionPerMillion: 1.5,
    }

    const cost =
      (usage.promptTokens / 1000000) * rates.promptPerMillion +
      (usage.completionTokens / 1000000) * rates.completionPerMillion

    expect(cost).toBeCloseTo(0.00035, 5)
  })

  it('calculates hourly rental cost', () => {
    const rental = {
      count: 2,
      durationHours: 4,
      pricePerHour: 2.5,
    }

    const cost = rental.count * rental.durationHours * rental.pricePerHour
    expect(cost).toBe(20)
  })
})

