/**
 * @fileoverview Event Types
 *
 * Generic event handler and event type definitions for consistent event handling
 * across the Jeju ecosystem. Includes Zod schemas for runtime validation.
 */

import { z } from 'zod'
import type { ErrorDetail } from './api'

// ============================================================================
// Generic Event Handler Types
// ============================================================================

/**
 * Generic event handler function type
 * Consolidates all event handler definitions across the codebase
 *
 * @template TEvent - The event type that this handler processes
 */
export type EventHandler<TEvent> = (event: TEvent) => void | Promise<void>

/**
 * Event listener (alias for EventHandler)
 * Provides semantic clarity when registering listeners
 */
export type EventListener<TEvent> = EventHandler<TEvent>

/**
 * Event callback function type
 * Alternative naming for event handlers
 */
export type EventCallback<TEvent> = EventHandler<TEvent>

// ============================================================================
// Event Base Schemas
// ============================================================================

/**
 * Base event schema that all events should extend
 */
export const BaseEventSchema = z.object({
  /** Event type identifier */
  type: z.string(),
  /** Timestamp when event occurred */
  timestamp: z.number(),
  /** Optional event ID for tracking */
  id: z.string().optional(),
  /** Optional source/service that emitted the event */
  source: z.string().optional(),
})
export type BaseEvent = z.infer<typeof BaseEventSchema>

/**
 * Error information schema for error events
 */
export const EventErrorInfoSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  /** Structured error details (not unknown) */
  details: z
    .union([
      z.string(),
      z.array(z.string()),
      z.array(z.object({ field: z.string(), message: z.string() })),
      z.array(z.object({ path: z.array(z.string()), message: z.string() })),
    ])
    .optional(),
})
export type EventErrorInfo = z.infer<typeof EventErrorInfoSchema>

/**
 * Error event schema
 */
export const ErrorEventSchema = BaseEventSchema.extend({
  type: z.literal('error'),
  error: EventErrorInfoSchema,
})

/**
 * Event with error information
 */
export interface ErrorEvent extends BaseEvent {
  type: 'error'
  error: {
    message: string
    code?: string
    /** Strongly typed error details */
    details?: ErrorDetail
  }
}

// ============================================================================
// Common Event Data Schemas
// ============================================================================

/**
 * Blockchain event data schema
 */
export const BlockchainEventDataSchema = z.object({
  blockNumber: z.number().int().nonnegative(),
  transactionHash: z.string(),
  logIndex: z.number().int().nonnegative().optional(),
})
export type BlockchainEventData = z.infer<typeof BlockchainEventDataSchema>

/**
 * Transaction event schema
 */
export const TransactionEventSchema = BaseEventSchema.extend({
  type: z.literal('transaction'),
  data: BlockchainEventDataSchema.extend({
    from: z.string(),
    to: z.string().optional(),
    value: z.string(),
    status: z.enum(['pending', 'confirmed', 'failed']),
  }),
})
export type TransactionEvent = z.infer<typeof TransactionEventSchema>

/**
 * State change event schema
 */
export const StateChangeEventSchema = BaseEventSchema.extend({
  type: z.literal('state_change'),
  data: z.object({
    previousState: z.string(),
    newState: z.string(),
    reason: z.string().optional(),
  }),
})
export type StateChangeEvent = z.infer<typeof StateChangeEventSchema>

// ============================================================================
// Event Emitter Interface
// ============================================================================

/**
 * Generic event emitter interface
 * Can be implemented by services that emit events
 */
export interface EventEmitter<TEvent extends BaseEvent = BaseEvent> {
  /**
   * Register an event handler
   */
  on(eventType: TEvent['type'], handler: EventHandler<TEvent>): void

  /**
   * Unregister an event handler
   */
  off(eventType: TEvent['type'], handler: EventHandler<TEvent>): void

  /**
   * Emit an event
   */
  emit(event: TEvent): void | Promise<void>

  /**
   * Register a one-time event handler
   */
  once?(eventType: TEvent['type'], handler: EventHandler<TEvent>): void
}
