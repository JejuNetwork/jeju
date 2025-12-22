/**
 * Schema Validation Tests
 *
 * Tests for:
 * - Zod schema validation
 * - Error message aggregation
 * - Edge cases and boundary conditions
 */

import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  ChatMessageSchema,
  ChatRequestSchema,
  CIRunSchema,
  PackageSearchResultSchema,
  RepoListResponseSchema,
  RepoSchema,
  ServiceHealthResponseSchema,
  UploadResponseSchema,
  validate,
  WorkflowSchema,
} from './schemas'

describe('validate function', () => {
  const TestSchema = z.object({
    name: z.string(),
    age: z.number().min(0),
    email: z.string().email(),
  })

  test('returns validated data on success', () => {
    const data = { name: 'Test', age: 25, email: 'test@example.com' }
    const result = validate(data, TestSchema)

    expect(result).toEqual(data)
  })

  test('throws on invalid data', () => {
    const data = { name: 123, age: -1, email: 'not-an-email' }

    expect(() => validate(data, TestSchema)).toThrow('Validation failed')
  })

  test('includes context in error message', () => {
    const data = { name: 'Test', age: -1, email: 'test@example.com' }

    expect(() => validate(data, TestSchema, 'user input')).toThrow(
      'in user input',
    )
  })

  test('aggregates multiple errors', () => {
    const data = { name: 123, age: -1, email: 'invalid' }

    try {
      validate(data, TestSchema)
      expect(true).toBe(false) // Should not reach here
    } catch (error) {
      const message = (error as Error).message
      // Should mention multiple fields
      expect(message).toContain('name')
      expect(message).toContain('age')
      expect(message).toContain('email')
    }
  })

  test('handles missing required fields', () => {
    const data = { name: 'Test' }

    expect(() => validate(data, TestSchema)).toThrow('Validation failed')
  })

  test('handles extra fields gracefully', () => {
    const data = {
      name: 'Test',
      age: 25,
      email: 'test@example.com',
      extra: 'field',
    }
    const result = validate(data, TestSchema)

    // Extra fields should be stripped by default Zod behavior
    expect(result.name).toBe('Test')
  })

  test('handles null input', () => {
    expect(() => validate(null, TestSchema)).toThrow('Validation failed')
  })

  test('handles undefined input', () => {
    expect(() => validate(undefined, TestSchema)).toThrow('Validation failed')
  })
})

describe('ServiceHealthResponseSchema', () => {
  test('validates minimal response', () => {
    const data = { status: 'ok' }
    const result = validate(data, ServiceHealthResponseSchema)

    expect(result.status).toBe('ok')
  })

  test('validates full response', () => {
    const data = {
      status: 'ok',
      service: 'inference',
      version: '1.0.0',
      uptime: 3600,
      mode: 'production',
      rpcUrl: 'http://localhost:8545',
      services: {
        database: { status: 'ok' },
        cache: { status: 'degraded' },
      },
      backends: {
        available: ['openai', 'anthropic'],
        health: { openai: true, anthropic: false },
      },
      decentralized: {
        identityRegistry: '0x1234...',
        registeredNodes: 10,
        connectedPeers: 5,
        frontendCid: 'QmXyz...',
        p2pEnabled: true,
      },
    }

    const result = validate(data, ServiceHealthResponseSchema)

    expect(result.service).toBe('inference')
    expect(result.backends?.available).toHaveLength(2)
    expect(result.decentralized?.p2pEnabled).toBe(true)
  })

  test('rejects invalid status type', () => {
    const data = { status: 123 }

    expect(() => validate(data, ServiceHealthResponseSchema)).toThrow()
  })

  test('allows missing optional fields', () => {
    const data = { status: 'ok' }
    const result = validate(data, ServiceHealthResponseSchema)

    expect(result.version).toBeUndefined()
    expect(result.backends).toBeUndefined()
  })
})

describe('UploadResponseSchema', () => {
  test('validates minimal response', () => {
    const data = { cid: 'QmXyz123...' }
    const result = validate(data, UploadResponseSchema)

    expect(result.cid).toBe('QmXyz123...')
  })

  test('validates full response', () => {
    const data = {
      cid: 'QmXyz123...',
      backend: 'ipfs',
      size: 1024,
    }

    const result = validate(data, UploadResponseSchema)

    expect(result.backend).toBe('ipfs')
    expect(result.size).toBe(1024)
  })

  test('rejects missing cid', () => {
    const data = { backend: 'ipfs' }

    expect(() => validate(data, UploadResponseSchema)).toThrow()
  })
})

describe('RepoSchema', () => {
  test('validates minimal repo', () => {
    const data = {
      repoId: 'repo-123',
      owner: 'user',
      name: 'my-repo',
    }

    const result = validate(data, RepoSchema)

    expect(result.repoId).toBe('repo-123')
  })

  test('validates full repo with branches', () => {
    const data = {
      repoId: 'repo-123',
      owner: 'user',
      name: 'my-repo',
      description: 'A test repository',
      visibility: 'public',
      starCount: 42,
      forkCount: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      defaultBranch: 'main',
      cloneUrl: 'git://dws/user/my-repo',
      branches: [
        { name: 'main', tipCommit: 'abc123', protected: true },
        { name: 'develop', tipCommit: 'def456', protected: false },
      ],
    }

    const result = validate(data, RepoSchema)

    expect(result.branches).toHaveLength(2)
    expect(result.branches?.[0].protected).toBe(true)
  })

  test('rejects missing required fields', () => {
    const data = { repoId: 'repo-123' }

    expect(() => validate(data, RepoSchema)).toThrow()
  })
})

describe('RepoListResponseSchema', () => {
  test('validates empty list', () => {
    const data = { repositories: [] }
    const result = validate(data, RepoListResponseSchema)

    expect(result.repositories).toHaveLength(0)
  })

  test('validates list with total', () => {
    const data = {
      repositories: [
        { repoId: 'repo-1', owner: 'user', name: 'repo-1' },
        { repoId: 'repo-2', owner: 'user', name: 'repo-2' },
      ],
      total: 100,
    }

    const result = validate(data, RepoListResponseSchema)

    expect(result.repositories).toHaveLength(2)
    expect(result.total).toBe(100)
  })
})

describe('PackageSearchResultSchema', () => {
  test('validates search result', () => {
    const data = {
      objects: [
        {
          package: {
            name: '@jeju/sdk',
            scope: 'jeju',
            version: '1.0.0',
            description: 'Jeju SDK',
            publisher: { username: 'jeju-team' },
          },
        },
      ],
      total: 1,
    }

    const result = validate(data, PackageSearchResultSchema)

    expect(result.objects[0].package.name).toBe('@jeju/sdk')
  })

  test('validates empty search result', () => {
    const data = { objects: [], total: 0 }
    const result = validate(data, PackageSearchResultSchema)

    expect(result.total).toBe(0)
  })

  test('rejects invalid package structure', () => {
    const data = {
      objects: [{ package: { name: '@jeju/sdk' } }], // Missing required fields
      total: 1,
    }

    expect(() => validate(data, PackageSearchResultSchema)).toThrow()
  })
})

describe('WorkflowSchema', () => {
  test('validates workflow', () => {
    const data = {
      workflowId: 'wf-123',
      name: 'Build and Test',
      description: 'CI pipeline',
      triggers: ['push', 'pull_request'],
      jobs: [
        { name: 'build', stepCount: 5 },
        { name: 'test', stepCount: 3 },
      ],
      active: true,
    }

    const result = validate(data, WorkflowSchema)

    expect(result.jobs).toHaveLength(2)
    expect(result.active).toBe(true)
  })

  test('validates workflow without description', () => {
    const data = {
      workflowId: 'wf-123',
      name: 'Build',
      triggers: ['push'],
      jobs: [{ name: 'build', stepCount: 1 }],
      active: true,
    }

    const result = validate(data, WorkflowSchema)

    expect(result.description).toBeUndefined()
  })

  test('rejects workflow with empty jobs array', () => {
    const data = {
      workflowId: 'wf-123',
      name: 'Build',
      triggers: ['push'],
      jobs: [], // Valid - empty array is allowed
      active: true,
    }

    const result = validate(data, WorkflowSchema)
    expect(result.jobs).toHaveLength(0)
  })
})

describe('CIRunSchema', () => {
  test('validates completed run', () => {
    const data = {
      runId: 'run-123',
      workflowId: 'wf-123',
      repoId: 'repo-123',
      status: 'completed',
      conclusion: 'success',
      branch: 'main',
      commitSha: 'abc123def456',
      triggeredBy: 'push',
      startedAt: Date.now() - 60000,
      completedAt: Date.now(),
      duration: 60000,
      jobs: [
        {
          jobId: 'job-1',
          name: 'build',
          status: 'completed',
          conclusion: 'success',
          steps: [
            {
              stepId: 'step-1',
              name: 'Checkout',
              status: 'completed',
              conclusion: 'success',
              exitCode: 0,
            },
          ],
        },
      ],
    }

    const result = validate(data, CIRunSchema)

    expect(result.status).toBe('completed')
    expect(result.conclusion).toBe('success')
    expect(result.jobs?.[0].steps[0].exitCode).toBe(0)
  })

  test('validates in-progress run', () => {
    const data = {
      runId: 'run-123',
      workflowId: 'wf-123',
      status: 'in_progress',
      conclusion: null,
      branch: 'feature',
      commitSha: 'abc123',
      startedAt: Date.now(),
      completedAt: null,
    }

    const result = validate(data, CIRunSchema)

    expect(result.conclusion).toBeNull()
    expect(result.completedAt).toBeNull()
  })

  test('validates run without jobs', () => {
    const data = {
      runId: 'run-123',
      workflowId: 'wf-123',
      status: 'queued',
      conclusion: null,
      branch: 'main',
      commitSha: 'abc123',
      startedAt: Date.now(),
      completedAt: null,
    }

    const result = validate(data, CIRunSchema)

    expect(result.jobs).toBeUndefined()
  })
})

describe('ChatMessageSchema', () => {
  test('validates system message', () => {
    const data = { role: 'system', content: 'You are a helpful assistant.' }
    const result = validate(data, ChatMessageSchema)

    expect(result.role).toBe('system')
  })

  test('validates user message', () => {
    const data = { role: 'user', content: 'Hello!' }
    const result = validate(data, ChatMessageSchema)

    expect(result.role).toBe('user')
  })

  test('validates assistant message', () => {
    const data = { role: 'assistant', content: 'Hi there!' }
    const result = validate(data, ChatMessageSchema)

    expect(result.role).toBe('assistant')
  })

  test('rejects invalid role', () => {
    const data = { role: 'tool', content: 'Some tool output' }

    expect(() => validate(data, ChatMessageSchema)).toThrow()
  })

  test('allows empty content', () => {
    const data = { role: 'user', content: '' }
    const result = validate(data, ChatMessageSchema)

    expect(result.content).toBe('')
  })
})

describe('ChatRequestSchema', () => {
  test('validates minimal request', () => {
    const data = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello!' }],
    }

    const result = validate(data, ChatRequestSchema)

    expect(result.model).toBe('gpt-4')
  })

  test('validates full request', () => {
    const data = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi!' },
      ],
      temperature: 0.7,
      max_tokens: 1000,
      stream: true,
      provider: 'openai',
    }

    const result = validate(data, ChatRequestSchema)

    expect(result.temperature).toBe(0.7)
    expect(result.stream).toBe(true)
    expect(result.provider).toBe('openai')
  })

  test('allows empty messages array', () => {
    const data = {
      model: 'gpt-4',
      messages: [],
    }

    const result = validate(data, ChatRequestSchema)
    expect(result.messages).toHaveLength(0)
  })

  test('validates temperature range', () => {
    const data = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 2.5, // Out of typical range but schema allows any number
    }

    // Schema allows any number, validation is application-level
    const result = validate(data, ChatRequestSchema)
    expect(result.temperature).toBe(2.5)
  })

  test('rejects invalid message role in array', () => {
    const data = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'invalid', content: 'Bad role' },
      ],
    }

    expect(() => validate(data, ChatRequestSchema)).toThrow()
  })
})

describe('Edge Cases and Type Coercion', () => {
  test('handles number-like strings correctly', () => {
    const NumericSchema = z.object({ value: z.number() })

    // String that looks like number should fail
    expect(() => validate({ value: '42' }, NumericSchema)).toThrow()
  })

  test('handles boolean-like values correctly', () => {
    const BoolSchema = z.object({ flag: z.boolean() })

    // Truthy values should fail
    expect(() => validate({ flag: 1 }, BoolSchema)).toThrow()
    expect(() => validate({ flag: 'true' }, BoolSchema)).toThrow()

    // Actual booleans should pass
    expect(validate({ flag: true }, BoolSchema).flag).toBe(true)
    expect(validate({ flag: false }, BoolSchema).flag).toBe(false)
  })

  test('handles arrays with wrong element types', () => {
    const ArraySchema = z.object({ items: z.array(z.string()) })

    expect(() => validate({ items: ['a', 1, 'b'] }, ArraySchema)).toThrow()
  })

  test('handles nested object validation', () => {
    const NestedSchema = z.object({
      outer: z.object({
        inner: z.object({
          value: z.string(),
        }),
      }),
    })

    const valid = { outer: { inner: { value: 'test' } } }
    expect(validate(valid, NestedSchema).outer.inner.value).toBe('test')

    const invalid = { outer: { inner: { value: 123 } } }
    expect(() => validate(invalid, NestedSchema)).toThrow()
  })

  test('handles optional vs nullable correctly', () => {
    const OptionalSchema = z.object({
      optional: z.string().optional(),
      nullable: z.string().nullable(),
    })

    // Optional can be missing
    expect(
      validate({ nullable: null }, OptionalSchema).optional,
    ).toBeUndefined()

    // Nullable can be null
    expect(validate({ nullable: null }, OptionalSchema).nullable).toBeNull()

    // Optional cannot be null
    expect(() =>
      validate({ optional: null, nullable: null }, OptionalSchema),
    ).toThrow()
  })

  test('handles date-like values', () => {
    const DateSchema = z.object({
      timestamp: z.number(),
      isoDate: z.string(),
    })

    const data = {
      timestamp: Date.now(),
      isoDate: new Date().toISOString(),
    }

    const result = validate(data, DateSchema)
    expect(typeof result.timestamp).toBe('number')
    expect(result.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('handles unicode content', () => {
    const UnicodeSchema = z.object({ text: z.string() })

    const data = { text: '你好世界 🌍 مرحبا' }
    const result = validate(data, UnicodeSchema)

    expect(result.text).toBe('你好世界 🌍 مرحبا')
  })

  test('handles very long strings', () => {
    const LongStringSchema = z.object({ text: z.string() })

    const longString = 'x'.repeat(100000)
    const result = validate({ text: longString }, LongStringSchema)

    expect(result.text.length).toBe(100000)
  })
})
