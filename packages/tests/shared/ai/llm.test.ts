/**
 * Tests for the LLM abstraction layer
 */

import { describe, expect, test } from 'bun:test'
import { isLLMConfigured, llm, requireLLM } from './llm'

describe('LLM Module', () => {
  test('isLLMConfigured returns boolean based on env vars', () => {
    // Should return true if either key is set
    const result = isLLMConfigured()
    expect(typeof result).toBe('boolean')
  })

  test('llm object has expected methods', () => {
    expect(typeof llm.chat).toBe('function')
    expect(typeof llm.complete).toBe('function')
    expect(typeof llm.isConfigured).toBe('function')
    expect(typeof llm.require).toBe('function')
    expect(typeof llm.describeImage).toBe('function')
    expect(typeof llm.verifyImage).toBe('function')
  })

  test('requireLLM throws if no API key configured', () => {
    // Save current env vars
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    // Clear env vars temporarily
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY

    expect(() => requireLLM()).toThrow('LLM API key required')

    // Restore env vars
    if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey
    if (openaiKey) process.env.OPENAI_API_KEY = openaiKey
  })
})
