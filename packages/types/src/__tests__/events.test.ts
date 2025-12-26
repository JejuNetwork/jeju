/**
 * @fileoverview Comprehensive tests for events.ts
 *
 * Tests cover:
 * - BaseEventSchema: Base event structure validation
 * - EventErrorInfoSchema: Error info validation
 * - ErrorEventSchema: Error event validation
 * - BlockchainEventDataSchema: Blockchain event data validation
 * - TransactionEventSchema: Transaction event validation
 * - StateChangeEventSchema: State change event validation
 * - EventEmitter interface verification
 */

import { describe, expect, test } from 'bun:test'
import {
  type BaseEvent,
  BaseEventSchema,
  BlockchainEventDataSchema,
  type ErrorEvent,
  ErrorEventSchema,
  type EventCallback,
  type EventEmitter,
  EventErrorInfoSchema,
  type EventHandler,
  type EventListener,
  StateChangeEventSchema,
  TransactionEventSchema,
} from '../events'

describe('BaseEventSchema', () => {
  test('accepts minimal base event', () => {
    const event = {
      type: 'test',
      timestamp: Date.now(),
    }

    const result = BaseEventSchema.safeParse(event)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('test')
    }
  })

  test('accepts full base event with optional fields', () => {
    const event: BaseEvent = {
      type: 'test',
      timestamp: Date.now(),
      id: 'event-123',
      source: 'test-module',
    }

    const result = BaseEventSchema.safeParse(event)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('event-123')
      expect(result.data.source).toBe('test-module')
    }
  })

  test('rejects missing required fields', () => {
    const event = { type: 'test' }
    expect(BaseEventSchema.safeParse(event).success).toBe(false)

    const event2 = { timestamp: Date.now() }
    expect(BaseEventSchema.safeParse(event2).success).toBe(false)
  })
})

describe('EventErrorInfoSchema', () => {
  test('accepts minimal error info', () => {
    const error = { message: 'Something went wrong' }
    const result = EventErrorInfoSchema.safeParse(error)
    expect(result.success).toBe(true)
  })

  test('accepts error with code', () => {
    const error = {
      message: 'Something went wrong',
      code: 'ERR_VALIDATION',
    }
    const result = EventErrorInfoSchema.safeParse(error)
    expect(result.success).toBe(true)
  })

  test('accepts error with string details', () => {
    const error = {
      message: 'Validation failed',
      details: 'Field X is required',
    }
    const result = EventErrorInfoSchema.safeParse(error)
    expect(result.success).toBe(true)
  })

  test('accepts error with string array details', () => {
    const error = {
      message: 'Validation failed',
      details: ['Field X is required', 'Field Y must be a number'],
    }
    const result = EventErrorInfoSchema.safeParse(error)
    expect(result.success).toBe(true)
  })

  test('accepts error with field error details', () => {
    const error = {
      message: 'Validation failed',
      details: [
        { field: 'email', message: 'Invalid email format' },
        { field: 'password', message: 'Too short' },
      ],
    }
    const result = EventErrorInfoSchema.safeParse(error)
    expect(result.success).toBe(true)
  })

  test('accepts error with path error details', () => {
    const error = {
      message: 'Validation failed',
      details: [
        { path: ['user', 'email'], message: 'Invalid email' },
        { path: ['user', 'profile', 'name'], message: 'Required' },
      ],
    }
    const result = EventErrorInfoSchema.safeParse(error)
    expect(result.success).toBe(true)
  })
})

describe('ErrorEventSchema', () => {
  test('accepts valid error event', () => {
    const event = {
      type: 'error',
      timestamp: Date.now(),
      error: {
        message: 'Something went wrong',
        code: 'ERR_INTERNAL',
      },
    }

    const result = ErrorEventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })

  test('rejects non-error type', () => {
    const event = {
      type: 'not-error',
      timestamp: Date.now(),
      error: {
        message: 'Something went wrong',
      },
    }
    expect(ErrorEventSchema.safeParse(event).success).toBe(false)
  })
})

describe('ErrorEvent interface', () => {
  test('has correct structure', () => {
    const event: ErrorEvent = {
      type: 'error',
      timestamp: Date.now(),
      error: {
        message: 'Something went wrong',
        code: 'ERR_INTERNAL',
        details: ['Detail 1', 'Detail 2'],
      },
    }

    expect(event.type).toBe('error')
    expect(event.error.message).toBe('Something went wrong')
    expect(event.error.code).toBe('ERR_INTERNAL')
  })
})

describe('BlockchainEventDataSchema', () => {
  test('accepts valid blockchain event data', () => {
    const data = {
      blockNumber: 12345678,
      transactionHash: `0x${'a'.repeat(64)}`,
    }

    const result = BlockchainEventDataSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  test('accepts data with logIndex', () => {
    const data = {
      blockNumber: 12345678,
      transactionHash: `0x${'a'.repeat(64)}`,
      logIndex: 5,
    }

    const result = BlockchainEventDataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.logIndex).toBe(5)
    }
  })

  test('rejects negative block number', () => {
    const data = {
      blockNumber: -1,
      transactionHash: `0x${'a'.repeat(64)}`,
    }
    expect(BlockchainEventDataSchema.safeParse(data).success).toBe(false)
  })

  test('rejects non-integer block number', () => {
    const data = {
      blockNumber: 123.5,
      transactionHash: `0x${'a'.repeat(64)}`,
    }
    expect(BlockchainEventDataSchema.safeParse(data).success).toBe(false)
  })
})

describe('TransactionEventSchema', () => {
  test('accepts valid transaction event', () => {
    const event = {
      type: 'transaction',
      timestamp: Date.now(),
      data: {
        blockNumber: 12345678,
        transactionHash: `0x${'a'.repeat(64)}`,
        from: '0x1234567890123456789012345678901234567890',
        to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        value: '1000000000000000000',
        status: 'confirmed',
      },
    }

    const result = TransactionEventSchema.safeParse(event)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data.status).toBe('confirmed')
    }
  })

  test('accepts pending transaction', () => {
    const event = {
      type: 'transaction',
      timestamp: Date.now(),
      data: {
        blockNumber: 0,
        transactionHash: `0x${'a'.repeat(64)}`,
        from: '0x1234567890123456789012345678901234567890',
        value: '0',
        status: 'pending',
      },
    }

    const result = TransactionEventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })

  test('rejects invalid status', () => {
    const event = {
      type: 'transaction',
      timestamp: Date.now(),
      data: {
        blockNumber: 12345678,
        transactionHash: `0x${'a'.repeat(64)}`,
        from: '0x1234567890123456789012345678901234567890',
        value: '0',
        status: 'invalid',
      },
    }
    expect(TransactionEventSchema.safeParse(event).success).toBe(false)
  })
})

describe('StateChangeEventSchema', () => {
  test('accepts valid state change event', () => {
    const event = {
      type: 'state_change',
      timestamp: Date.now(),
      data: {
        previousState: 'idle',
        newState: 'loading',
      },
    }

    const result = StateChangeEventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })

  test('accepts state change with reason', () => {
    const event = {
      type: 'state_change',
      timestamp: Date.now(),
      data: {
        previousState: 'active',
        newState: 'paused',
        reason: 'User requested pause',
      },
    }

    const result = StateChangeEventSchema.safeParse(event)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data.reason).toBe('User requested pause')
    }
  })
})

describe('EventHandler/EventListener/EventCallback types', () => {
  test('EventHandler type works with sync handlers', () => {
    const handler: EventHandler<BaseEvent> = (event) => {
      console.log(event.type)
    }
    expect(typeof handler).toBe('function')
  })

  test('EventHandler type works with async handlers', () => {
    const handler: EventHandler<BaseEvent> = async (event) => {
      await Promise.resolve()
      console.log(event.type)
    }
    expect(typeof handler).toBe('function')
  })

  test('EventListener is alias for EventHandler', () => {
    const listener: EventListener<BaseEvent> = (event) => {
      console.log(event.type)
    }
    expect(typeof listener).toBe('function')
  })

  test('EventCallback is alias for EventHandler', () => {
    const callback: EventCallback<BaseEvent> = (event) => {
      console.log(event.type)
    }
    expect(typeof callback).toBe('function')
  })
})

describe('EventEmitter interface', () => {
  test('interface has correct methods', () => {
    class TestEmitter implements EventEmitter<BaseEvent> {
      private handlers: Map<string, EventHandler<BaseEvent>[]> = new Map()

      on(eventType: string, handler: EventHandler<BaseEvent>): void {
        const handlers = this.handlers.get(eventType) || []
        handlers.push(handler)
        this.handlers.set(eventType, handlers)
      }

      off(eventType: string, handler: EventHandler<BaseEvent>): void {
        const handlers = this.handlers.get(eventType) || []
        const index = handlers.indexOf(handler)
        if (index > -1) {
          handlers.splice(index, 1)
        }
      }

      emit(event: BaseEvent): void {
        const handlers = this.handlers.get(event.type) || []
        for (const handler of handlers) {
          handler(event)
        }
      }

      once(eventType: string, handler: EventHandler<BaseEvent>): void {
        const onceHandler: EventHandler<BaseEvent> = (event) => {
          handler(event)
          this.off(eventType, onceHandler)
        }
        this.on(eventType, onceHandler)
      }
    }

    const emitter = new TestEmitter()
    let received: BaseEvent | null = null

    emitter.on('test', (event) => {
      received = event
    })

    const testEvent: BaseEvent = {
      type: 'test',
      timestamp: Date.now(),
    }

    emitter.emit(testEvent)
    expect(received).not.toBeNull()
    expect(received!.type).toBe('test')
  })
})
