/**
 * Prompt Builder Tests
 *
 * Tests the prompt building utilities for LLM interactions.
 */

import { describe, expect, test } from 'bun:test'
import {
  buildPrompt,
  buildSafePrompt,
  countTokensSync,
  getModelTokenLimit,
  type PromptSection,
  truncateToTokenLimitSync,
  willPromptFit,
} from '../utils/prompt-builder'

describe('countTokensSync', () => {
  test('counts tokens in simple text', () => {
    const count = countTokensSync('Hello, world!')
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(10) // Simple text should be small
  })

  test('counts tokens in empty string', () => {
    const count = countTokensSync('')
    expect(count).toBe(0)
  })

  test('counts tokens in long text', () => {
    const longText = 'This is a test sentence. '.repeat(100)
    const count = countTokensSync(longText)
    expect(count).toBeGreaterThan(100)
  })

  test('handles unicode characters', () => {
    const count = countTokensSync('こんにちは世界 🎉')
    expect(count).toBeGreaterThan(0)
  })

  test('handles code blocks', () => {
    const code = `
function hello() {
  console.log("Hello, World!");
}
`
    const count = countTokensSync(code)
    expect(count).toBeGreaterThan(5)
  })
})

describe('getModelTokenLimit', () => {
  test('returns limit for known models', () => {
    const limits = [
      getModelTokenLimit('gpt-4o'),
      getModelTokenLimit('gpt-4-turbo'),
      getModelTokenLimit('claude-3-5-sonnet'),
      getModelTokenLimit('meta-llama/Llama-3.1-70B-Instruct'),
    ]

    for (const limit of limits) {
      expect(limit).toBeGreaterThan(4000)
    }
  })

  test('returns default limit for unknown models', () => {
    const limit = getModelTokenLimit('unknown-model-xyz')
    expect(limit).toBeGreaterThan(0)
    expect(limit).toBe(32768) // Default limit
  })
})

describe('willPromptFit', () => {
  test('returns object with fits=true for small prompt within limits', () => {
    const result = willPromptFit('Hello, world!')
    expect(result.fits).toBe(true)
    expect(result.tokens).toBeGreaterThan(0)
    expect(result.limit).toBeGreaterThan(0)
  })

  test('returns object with fits=false for prompt exceeding limits', () => {
    // Create a very long text that exceeds even the model limit
    const longText = 'word '.repeat(100000)
    const result = willPromptFit(longText)
    expect(result.fits).toBe(false)
    expect(result.tokens).toBeGreaterThan(result.limit)
  })

  test('returns correct structure', () => {
    const result = willPromptFit('test')
    expect(typeof result.fits).toBe('boolean')
    expect(typeof result.tokens).toBe('number')
    expect(typeof result.limit).toBe('number')
  })
})

describe('truncateToTokenLimitSync', () => {
  test('returns original text if within limit', () => {
    const text = 'Hello, world!'
    const result = truncateToTokenLimitSync(text, 1000)
    expect(result.text).toBe(text)
    expect(result.truncated).toBe(false)
    expect(result.tokens).toBeGreaterThan(0)
  })

  test('truncates text exceeding limit', () => {
    const longText = 'This is a test sentence. '.repeat(1000)
    const result = truncateToTokenLimitSync(longText, 100)

    expect(result.text.length).toBeLessThan(longText.length)
    expect(result.truncated).toBe(true)
    expect(result.tokens).toBeLessThanOrEqual(100)
  })

  test('handles empty string', () => {
    const result = truncateToTokenLimitSync('', 100)
    expect(result.text).toBe('')
    expect(result.truncated).toBe(false)
    expect(result.tokens).toBe(0)
  })

  test('handles limit of 0', () => {
    const result = truncateToTokenLimitSync('Hello, world!', 0)
    expect(result.text).toBe('')
    expect(result.truncated).toBe(true)
    expect(result.tokens).toBe(0)
  })

  test('adds ellipsis when requested', () => {
    const longText = 'word '.repeat(1000)
    const result = truncateToTokenLimitSync(longText, 50, { ellipsis: true })

    expect(result.truncated).toBe(true)
    expect(result.text.endsWith('...')).toBe(true)
  })
})

describe('buildSafePrompt', () => {
  test('builds prompt from sections', () => {
    const sections: PromptSection[] = [
      {
        name: 'system',
        content: 'You are a helpful assistant.',
        priority: 100,
      },
      {
        name: 'context',
        content: 'The user is asking about weather.',
        priority: 50,
      },
      {
        name: 'query',
        content: 'What is the weather like today?',
        priority: 80,
      },
    ]

    const result = buildSafePrompt(sections)

    expect(result.prompt).toContain('You are a helpful assistant.')
    expect(result.prompt).toContain('The user is asking about weather.')
    expect(result.prompt).toContain('What is the weather like today?')
    expect(result.truncated).toBe(false)
  })

  test('handles empty sections array', () => {
    const result = buildSafePrompt([])
    expect(result.prompt).toBe('')
    expect(result.truncated).toBe(false)
  })

  test('handles sections with empty content', () => {
    const sections: PromptSection[] = [
      { name: 'system', content: '', priority: 100 },
      { name: 'query', content: 'Hello', priority: 80 },
    ]

    const result = buildSafePrompt(sections)
    expect(result.prompt).toContain('Hello')
  })

  test('respects section priority (high priority first)', () => {
    const sections: PromptSection[] = [
      { name: 'low', content: 'Low priority', priority: 1 },
      { name: 'high', content: 'High priority', priority: 10 },
      { name: 'medium', content: 'Medium priority', priority: 5 },
    ]

    const result = buildSafePrompt(sections)
    // High priority should come first in the output
    const highIndex = result.prompt.indexOf('High priority')
    const mediumIndex = result.prompt.indexOf('Medium priority')
    const lowIndex = result.prompt.indexOf('Low priority')

    expect(highIndex).toBeLessThan(mediumIndex)
    expect(mediumIndex).toBeLessThan(lowIndex)
  })
})

describe('buildPrompt', () => {
  test('builds prompt from system and user prompts', () => {
    const prompt = buildPrompt('System instructions', 'User query')

    expect(prompt).toContain('System instructions')
    expect(prompt).toContain('User query')
  })

  test('handles empty system prompt', () => {
    const prompt = buildPrompt('', 'User query')
    expect(prompt).toContain('User query')
  })

  test('handles empty user prompt', () => {
    const prompt = buildPrompt('System instructions', '')
    expect(prompt).toContain('System instructions')
  })
})

describe('Prompt Builder Edge Cases', () => {
  test('handles very long single section', () => {
    const longContent = 'word '.repeat(50000)
    const sections: PromptSection[] = [
      { name: 'long', content: longContent, priority: 100 },
    ]

    const result = buildSafePrompt(sections)
    // Should truncate if exceeds model limit
    expect(result.finalTokens).toBeLessThanOrEqual(
      getModelTokenLimit('default'),
    )
  })

  test('handles special characters in content', () => {
    const sections: PromptSection[] = [
      {
        name: 'special',
        content: '`code` **bold** _italic_ \n\n---',
        priority: 100,
      },
    ]

    const result = buildSafePrompt(sections)
    expect(result.prompt).toContain('`code`')
    expect(result.prompt).toContain('**bold**')
  })

  test('handles JSON in content', () => {
    const jsonContent = JSON.stringify({
      key: 'value',
      nested: { array: [1, 2, 3] },
    })

    const sections: PromptSection[] = [
      { name: 'json', content: jsonContent, priority: 100 },
    ]

    const result = buildSafePrompt(sections)
    expect(result.prompt).toContain('"key":"value"')
  })

  test('handles code blocks', () => {
    const sections: PromptSection[] = [
      {
        name: 'code',
        content: '```typescript\nconst x = 1;\n```',
        priority: 100,
      },
    ]

    const result = buildSafePrompt(sections)
    expect(result.prompt).toContain('```typescript')
    expect(result.prompt).toContain('const x = 1')
  })
})
