import { describe, expect, it, beforeEach } from 'bun:test'
import { CircuitBreaker, BrokenCircuitError } from './circuit-breaker'

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 100,
      halfOpenRequests: 2,
    })
  })

  it('starts in closed state', () => {
    expect(breaker.getState('test')).toBe('closed')
    expect(breaker.canExecute('test')).toBe(true)
  })

  it('executes successful operations', async () => {
    const result = await breaker.execute('test', async () => 'success')
    expect(result).toBe('success')
    expect(breaker.getState('test')).toBe('closed')
  })

  it('tracks stats per service', async () => {
    await breaker.execute('a', async () => 'ok')
    await breaker.execute('b', async () => 'ok')

    const stats = breaker.getStats()
    expect(stats['a'].state).toBe('closed')
    expect(stats['b'].state).toBe('closed')
  })

  it('opens after consecutive failures', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute('fail', async () => {
          throw new Error('down')
        })
        .catch(() => {})
    }

    expect(breaker.getState('fail')).toBe('open')
    expect(breaker.canExecute('fail')).toBe(false)
  })

  it('throws BrokenCircuitError when open', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute('fail', async () => {
          throw new Error('down')
        })
        .catch(() => {})
    }

    await expect(
      breaker.execute('fail', async () => 'nope'),
    ).rejects.toBeInstanceOf(BrokenCircuitError)
  })

  it('resets state', async () => {
    await breaker.execute('test', async () => 'ok')
    expect(breaker.getStats()['test']).toBeDefined()

    breaker.reset('test')
    expect(breaker.getStats()['test']).toBeUndefined()
  })

  it('transitions to half-open after timeout', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute('timeout', async () => {
          throw new Error('down')
        })
        .catch(() => {})
    }

    expect(breaker.getState('timeout')).toBe('open')

    await new Promise((r) => setTimeout(r, 150))

    const result = await breaker.execute('timeout', async () => 'recovered')
    expect(result).toBe('recovered')
    expect(breaker.getState('timeout')).toBe('closed')
  })

  it('isolates services independently', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute('a', async () => {
          throw new Error('down')
        })
        .catch(() => {})
    }

    await breaker.execute('b', async () => 'ok')

    expect(breaker.getState('a')).toBe('open')
    expect(breaker.getState('b')).toBe('closed')
    expect(breaker.canExecute('a')).toBe(false)
    expect(breaker.canExecute('b')).toBe(true)
  })

  it('resets all breakers', async () => {
    await breaker.execute('a', async () => 'ok')
    await breaker.execute('b', async () => 'ok')

    breaker.resetAll()
    expect(breaker.getStats()).toEqual({})
  })
})
