/**
 * Event types for consistent event handling across the ecosystem.
 */

import { z } from 'zod'
import type { ErrorDetail } from './api'

export type EventHandler<TEvent> = (event: TEvent) => void | Promise<void>
export type EventListener<TEvent> = EventHandler<TEvent>
export type EventCallback<TEvent> = EventHandler<TEvent>

export const BaseEventSchema = z.object({
  type: z.string(),
  timestamp: z.number(),
  id: z.string().optional(),
  source: z.string().optional(),
})
export type BaseEvent = z.infer<typeof BaseEventSchema>

export const EventErrorInfoSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
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

export const ErrorEventSchema = BaseEventSchema.extend({
  type: z.literal('error'),
  error: EventErrorInfoSchema,
})

export interface ErrorEvent extends BaseEvent {
  type: 'error'
  error: {
    message: string
    code?: string
    details?: ErrorDetail
  }
}

export const BlockchainEventDataSchema = z.object({
  blockNumber: z.number().int().nonnegative(),
  transactionHash: z.string(),
  logIndex: z.number().int().nonnegative().optional(),
})
export type BlockchainEventData = z.infer<typeof BlockchainEventDataSchema>

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

export const StateChangeEventSchema = BaseEventSchema.extend({
  type: z.literal('state_change'),
  data: z.object({
    previousState: z.string(),
    newState: z.string(),
    reason: z.string().optional(),
  }),
})
export type StateChangeEvent = z.infer<typeof StateChangeEventSchema>

export interface EventEmitter<TEvent extends BaseEvent = BaseEvent> {
  on(eventType: TEvent['type'], handler: EventHandler<TEvent>): void
  off(eventType: TEvent['type'], handler: EventHandler<TEvent>): void
  emit(event: TEvent): void | Promise<void>
  once?(eventType: TEvent['type'], handler: EventHandler<TEvent>): void
}
