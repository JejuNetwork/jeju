import { generateId as sharedGenerateId } from '@jejunetwork/shared'
import pRetry from 'p-retry'
import type { Todo } from './schemas'
import type { TodoPriority } from './types'

export const AUTH_MESSAGE_PREFIX = 'jeju-dapp'
export const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

export function constructAuthMessage(timestamp: number): string {
  return `${AUTH_MESSAGE_PREFIX}:${timestamp}`
}

export function isValidTimestamp(timestamp: number): boolean {
  const now = Date.now()
  const age = now - timestamp
  if (timestamp > now) return false
  return age <= TIMESTAMP_WINDOW_MS
}

export function validateTimestamp(timestamp: number): {
  valid: boolean
  age: number
  maxAge: number
} {
  const now = Date.now()
  const age = Math.abs(now - timestamp)
  return {
    valid: isValidTimestamp(timestamp),
    age,
    maxAge: TIMESTAMP_WINDOW_MS,
  }
}

/**
 * Generate a unique ID with optional prefix
 */
export function generateId(prefix?: string): string {
  const id = sharedGenerateId(16)
  return prefix ? `${prefix}-${id}` : id
}

const PRIORITY_ORDER: Record<TodoPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export function sortByPriority<T extends { priority: TodoPriority }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  )
}

export function prioritizeTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const aWeight = PRIORITY_ORDER[a.priority]
    const bWeight = PRIORITY_ORDER[b.priority]

    if (aWeight !== bWeight) return aWeight - bWeight

    if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate
    if (a.dueDate) return -1
    if (b.dueDate) return 1

    return 0
  })
}

export function filterOverdue(todos: Todo[]): Todo[] {
  const now = Date.now()
  return todos.filter(
    (t) => !t.completed && t.dueDate !== null && t.dueDate < now,
  )
}

export function getTopPriorities(todos: Todo[], count = 5): Todo[] {
  const incomplete = todos.filter((t) => !t.completed)
  const prioritized = prioritizeTodos(incomplete)
  return prioritized.slice(0, count)
}

export function getNextMidnight(): number {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  return tomorrow.getTime()
}

export function isOverdue(dueDate: number): boolean {
  return dueDate < Date.now()
}

export function normalizeJNSName(name: string): string {
  const lower = name.toLowerCase()
  return lower.endsWith('.jeju') ? lower : `${lower}.jeju`
}

export function isValidJNSName(name: string): boolean {
  if (!name || name.length === 0) return false
  const label = name.toLowerCase().replace(/\.jeju$/, '')
  if (!/^[a-z0-9-]+$/.test(label)) return false
  if (label.startsWith('-') || label.endsWith('-')) return false
  return true
}

export function formatAddress(address: string, chars = 4): string {
  if (!address || address.length === 0) {
    throw new Error('Address is required for formatting')
  }
  if (!address.startsWith('0x') || address.length !== 42) {
    throw new Error(`Invalid address format: ${address}`)
  }
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
): Promise<T> {
  return pRetry(fn, {
    retries: maxRetries,
    minTimeout: baseDelay,
    factor: 2,
  })
}
