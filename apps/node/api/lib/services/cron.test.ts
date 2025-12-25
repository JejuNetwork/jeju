import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

// Trigger Schema for validation
const TriggerSchema = z.object({
  triggerId: z.bigint(),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  endpoint: z.string().url(),
  interval: z.bigint(),
  nextExecution: z.bigint(),
  bounty: z.bigint(),
  active: z.boolean(),
})

type Trigger = z.infer<typeof TriggerSchema>

// Cron Service State Schema
const CronServiceStateSchema = z.object({
  activeTriggers: z.array(TriggerSchema),
  executionsCompleted: z.number().int().nonnegative(),
  earningsWei: z.bigint(),
})

type CronServiceState = z.infer<typeof CronServiceStateSchema>

function validateTrigger(data: unknown): Trigger {
  return TriggerSchema.parse(data)
}

function validateCronServiceState(data: unknown): CronServiceState {
  return CronServiceStateSchema.parse(data)
}

// SSRF Protection
function isInternalUrl(url: string): boolean {
  const urlObj = new URL(url)
  const hostname = urlObj.hostname.toLowerCase()

  // Block localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return true
  }

  // Block internal IP ranges
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  const match = hostname.match(ipv4Regex)
  if (match) {
    const [, a, b, _c] = match.map(Number)
    // 10.x.x.x
    if (a === 10) return true
    // 172.16.x.x - 172.31.x.x
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.x.x
    if (a === 192 && b === 168) return true
    // 169.254.x.x (link-local)
    if (a === 169 && b === 254) return true
  }

  // Block metadata endpoints
  if (hostname === '169.254.169.254') return true
  if (hostname.includes('metadata')) return true
  if (hostname.includes('internal')) return true

  return false
}

function validateEndpointUrl(endpoint: string): void {
  const url = new URL(endpoint)

  // Must be HTTPS in production
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Invalid protocol: ${url.protocol}`)
  }

  // Block internal URLs
  if (isInternalUrl(endpoint)) {
    throw new Error('Internal URLs are not allowed')
  }
}

describe('Cron Service Validation', () => {
  describe('validateTrigger', () => {
    test('validates valid trigger', () => {
      const trigger: Trigger = {
        triggerId: 1n,
        owner: '0x1234567890123456789012345678901234567890',
        endpoint: 'https://api.example.com/webhook',
        interval: 3600n,
        nextExecution: BigInt(Date.now()),
        bounty: 1000000000000000n,
        active: true,
      }

      const result = validateTrigger(trigger)
      expect(result.triggerId).toBe(1n)
      expect(result.active).toBe(true)
    })

    test('validates inactive trigger', () => {
      const trigger: Trigger = {
        triggerId: 1n,
        owner: '0x1234567890123456789012345678901234567890',
        endpoint: 'https://api.example.com/webhook',
        interval: 3600n,
        nextExecution: BigInt(Date.now()),
        bounty: 0n,
        active: false,
      }

      const result = validateTrigger(trigger)
      expect(result.active).toBe(false)
    })

    test('rejects invalid owner address', () => {
      const trigger = {
        triggerId: 1n,
        owner: 'invalid-address',
        endpoint: 'https://api.example.com/webhook',
        interval: 3600n,
        nextExecution: BigInt(Date.now()),
        bounty: 0n,
        active: true,
      }

      expect(() => validateTrigger(trigger)).toThrow()
    })

    test('rejects invalid endpoint URL', () => {
      const trigger = {
        triggerId: 1n,
        owner: '0x1234567890123456789012345678901234567890',
        endpoint: 'not-a-url',
        interval: 3600n,
        nextExecution: BigInt(Date.now()),
        bounty: 0n,
        active: true,
      }

      expect(() => validateTrigger(trigger)).toThrow()
    })
  })

  describe('validateCronServiceState', () => {
    test('validates valid state with triggers', () => {
      const state: CronServiceState = {
        activeTriggers: [
          {
            triggerId: 1n,
            owner: '0x1234567890123456789012345678901234567890',
            endpoint: 'https://api.example.com/webhook',
            interval: 3600n,
            nextExecution: BigInt(Date.now()),
            bounty: 1000000000000000n,
            active: true,
          },
        ],
        executionsCompleted: 100,
        earningsWei: 100000000000000000n,
      }

      const result = validateCronServiceState(state)
      expect(result.activeTriggers.length).toBe(1)
      expect(result.executionsCompleted).toBe(100)
    })

    test('validates empty state', () => {
      const state: CronServiceState = {
        activeTriggers: [],
        executionsCompleted: 0,
        earningsWei: 0n,
      }

      const result = validateCronServiceState(state)
      expect(result.activeTriggers.length).toBe(0)
    })

    test('rejects negative executions count', () => {
      const state = {
        activeTriggers: [],
        executionsCompleted: -1,
        earningsWei: 0n,
      }

      expect(() => validateCronServiceState(state)).toThrow()
    })
  })
})

describe('SSRF Protection', () => {
  test('blocks localhost', () => {
    expect(isInternalUrl('http://localhost/api')).toBe(true)
    expect(isInternalUrl('http://127.0.0.1/api')).toBe(true)
  })

  test('blocks private IP ranges', () => {
    // 10.x.x.x
    expect(isInternalUrl('http://10.0.0.1/api')).toBe(true)
    expect(isInternalUrl('http://10.255.255.255/api')).toBe(true)

    // 172.16.x.x - 172.31.x.x
    expect(isInternalUrl('http://172.16.0.1/api')).toBe(true)
    expect(isInternalUrl('http://172.31.255.255/api')).toBe(true)
    expect(isInternalUrl('http://172.15.0.1/api')).toBe(false)
    expect(isInternalUrl('http://172.32.0.1/api')).toBe(false)

    // 192.168.x.x
    expect(isInternalUrl('http://192.168.0.1/api')).toBe(true)
    expect(isInternalUrl('http://192.168.255.255/api')).toBe(true)
  })

  test('blocks link-local addresses', () => {
    expect(isInternalUrl('http://169.254.0.1/api')).toBe(true)
    expect(isInternalUrl('http://169.254.169.254/api')).toBe(true)
  })

  test('blocks metadata endpoints', () => {
    expect(isInternalUrl('http://metadata.google.internal/api')).toBe(true)
    expect(isInternalUrl('http://internal.service/api')).toBe(true)
  })

  test('allows public URLs', () => {
    expect(isInternalUrl('https://api.example.com/webhook')).toBe(false)
    expect(isInternalUrl('https://8.8.8.8/api')).toBe(false)
  })
})

describe('Endpoint URL Validation', () => {
  test('allows HTTPS URLs', () => {
    expect(() =>
      validateEndpointUrl('https://api.example.com/webhook'),
    ).not.toThrow()
  })

  test('allows HTTP URLs (for development)', () => {
    expect(() =>
      validateEndpointUrl('http://api.example.com/webhook'),
    ).not.toThrow()
  })

  test('blocks internal URLs', () => {
    expect(() => validateEndpointUrl('http://localhost/webhook')).toThrow(
      'Internal URLs are not allowed',
    )
    expect(() => validateEndpointUrl('http://10.0.0.1/webhook')).toThrow(
      'Internal URLs are not allowed',
    )
  })

  test('blocks invalid protocols', () => {
    expect(() => validateEndpointUrl('ftp://api.example.com/webhook')).toThrow(
      'Invalid protocol',
    )
    expect(() => validateEndpointUrl('file:///etc/passwd')).toThrow(
      'Invalid protocol',
    )
  })
})

describe('Interval Calculations', () => {
  function calculateNextExecution(
    lastExecution: bigint,
    interval: bigint,
  ): bigint {
    return lastExecution + interval
  }

  function isDue(nextExecution: bigint, now: bigint): boolean {
    return now >= nextExecution
  }

  test('calculates next execution correctly', () => {
    const lastExecution = 1000n
    const interval = 3600n

    const next = calculateNextExecution(lastExecution, interval)
    expect(next).toBe(4600n)
  })

  test('detects due triggers', () => {
    const nextExecution = 1000n
    expect(isDue(nextExecution, 1000n)).toBe(true)
    expect(isDue(nextExecution, 1001n)).toBe(true)
    expect(isDue(nextExecution, 999n)).toBe(false)
  })
})
