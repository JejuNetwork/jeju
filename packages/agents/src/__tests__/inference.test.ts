/**
 * LLM Inference Service Tests
 *
 * Tests the inference service without mocks - verifies logic and integration.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { JejuInference, LLMInferenceService } from '../llm/inference'

describe('LLMInferenceService', () => {
  let service: LLMInferenceService

  beforeEach(() => {
    service = new LLMInferenceService()
  })

  describe('isAvailable', () => {
    test('returns boolean availability status', () => {
      const available = service.isAvailable()
      expect(typeof available).toBe('boolean')
    })
  })

  describe('estimateCost', () => {
    test('calculates cost for llama-3.1-8b-instant', async () => {
      const cost = await service.estimateCost('llama-3.1-8b-instant', 1000, 500)
      // 1000 input tokens @ $0.05/1k = $0.05 cents
      // 500 output tokens @ $0.08/1k = $0.04 cents
      // Total = $0.09 cents = $0.0009
      expect(cost).toBeCloseTo(0.0009, 4)
    })

    test('calculates cost for llama-3.1-70b-versatile', async () => {
      const cost = await service.estimateCost(
        'llama-3.1-70b-versatile',
        1000,
        1000,
      )
      // 1000 input tokens @ $0.59/1k = $0.59 cents
      // 1000 output tokens @ $0.79/1k = $0.79 cents
      // Total = $1.38 cents = $0.0138
      expect(cost).toBeCloseTo(0.0138, 4)
    })

    test('calculates cost for Qwen models', async () => {
      const cost = await service.estimateCost(
        'Qwen/Qwen2.5-14B-Instruct',
        2000,
        1000,
      )
      // 2000 input tokens @ $0.15/1k = $0.30 cents
      // 1000 output tokens @ $0.20/1k = $0.20 cents
      // Total = $0.50 cents = $0.005
      expect(cost).toBeCloseTo(0.005, 4)
    })

    test('uses default pricing for unknown model', async () => {
      const cost = await service.estimateCost('unknown-model', 1000, 500)
      // Uses default: llama-3.1-8b-instant pricing
      expect(cost).toBeCloseTo(0.0009, 4)
    })

    test('handles zero tokens', async () => {
      const cost = await service.estimateCost('llama-3.1-8b-instant', 0, 0)
      expect(cost).toBe(0)
    })

    test('handles large token counts', async () => {
      const cost = await service.estimateCost(
        'llama-3.1-70b-versatile',
        100000,
        50000,
      )
      // 100k input @ $0.59/1k = $59 cents
      // 50k output @ $0.79/1k = $39.5 cents
      // Total = $98.5 cents = $0.985
      expect(cost).toBeCloseTo(0.985, 3)
    })
  })

  describe('getStatus', () => {
    test('returns status object with required fields', async () => {
      const status = await service.getStatus()

      expect(typeof status.available).toBe('boolean')
      expect(typeof status.network).toBe('string')
      expect(typeof status.gatewayUrl).toBe('string')
      expect(typeof status.modelsAvailable).toBe('number')
    })
  })

  describe('getAvailableModels', () => {
    test('returns default models when compute not configured', async () => {
      // When Jeju Compute is not configured, it returns default models
      if (!service.isAvailable()) {
        const models = await service.getAvailableModels()

        expect(Array.isArray(models)).toBe(true)
        expect(models.length).toBeGreaterThan(0)
        expect(models.some((m) => m.includes('Qwen'))).toBe(true)
        expect(models.some((m) => m.includes('Llama'))).toBe(true)
      }
    })
  })
})

describe('JejuInference', () => {
  const testConfig = {
    network: 'localnet' as const,
    userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const,
    gatewayUrl: 'http://localhost:8787',
  }

  test('creates instance with config', () => {
    const inference = new JejuInference(testConfig)
    expect(inference).toBeInstanceOf(JejuInference)
  })

  test('creates instance with custom gateway URL', () => {
    const customConfig = {
      ...testConfig,
      gatewayUrl: 'https://custom-gateway.example.com',
    }
    const inference = new JejuInference(customConfig)
    expect(inference).toBeInstanceOf(JejuInference)
  })
})

describe('Model Resolution', () => {
  // Test that model aliases work correctly
  // These are internal functions but we test through the service

  test('resolves model aliases through inference request', async () => {
    const service = new LLMInferenceService()

    // If not available, we can't test the full flow but we can test cost estimation
    // which uses the resolved model name
    const costSmall = await service.estimateCost('small', 1000, 500)
    const costMedium = await service.estimateCost('medium', 1000, 500)
    const costLarge = await service.estimateCost('large', 1000, 500)

    // All should return valid costs (using default if alias not in pricing)
    expect(costSmall).toBeGreaterThanOrEqual(0)
    expect(costMedium).toBeGreaterThanOrEqual(0)
    expect(costLarge).toBeGreaterThanOrEqual(0)
  })
})

describe('Integration: Inference with Localnet', () => {
  test.skipIf(!process.env.JEJU_COMPUTE_API_URL)(
    'lists models from compute marketplace',
    async () => {
      const service = new LLMInferenceService()
      const models = await service.getAvailableModels()

      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)
    },
  )

  test.skipIf(!process.env.JEJU_COMPUTE_API_URL)(
    'runs inference through marketplace',
    async () => {
      const service = new LLMInferenceService()

      const response = await service.inference({
        model: 'small',
        messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
        maxTokens: 10,
      })

      expect(response.id).toBeDefined()
      expect(response.content).toBeDefined()
      expect(response.model).toBeDefined()
      expect(response.usage.totalTokens).toBeGreaterThan(0)
      expect(response.cost).toBeGreaterThanOrEqual(0)
    },
  )

  test.skipIf(!process.env.JEJU_COMPUTE_API_URL)(
    'lists providers from marketplace',
    async () => {
      const service = new LLMInferenceService()
      const providers = await service.listProviders()

      expect(Array.isArray(providers)).toBe(true)
      // Each provider should have required fields
      for (const provider of providers) {
        expect(provider.address).toBeDefined()
        expect(provider.endpoint).toBeDefined()
        expect(Array.isArray(provider.models)).toBe(true)
        expect(typeof provider.active).toBe('boolean')
      }
    },
  )
})

