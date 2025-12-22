/**
 * Utility functions for the Decentralized App Template
 * 
 * Shared business logic and helpers used across routes and services.
 */

import type { TodoPriority, Todo } from './types';

// ============================================================================
// Authentication Utilities
// ============================================================================

// Authentication message construction
export const AUTH_MESSAGE_PREFIX = 'jeju-dapp';
export const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function constructAuthMessage(timestamp: number): string {
  return `${AUTH_MESSAGE_PREFIX}:${timestamp}`;
}

// Timestamp validation (5 minute window)
export function isValidTimestamp(timestamp: number): boolean {
  const now = Date.now();
  const age = now - timestamp;
  
  // Reject future timestamps
  if (timestamp > now) return false;
  
  // Reject timestamps older than the window
  return age <= TIMESTAMP_WINDOW_MS;
}

// Validate timestamp and return details for error reporting
export function validateTimestamp(timestamp: number): { valid: boolean; age: number; maxAge: number } {
  const now = Date.now();
  const age = Math.abs(now - timestamp);
  return {
    valid: isValidTimestamp(timestamp),
    age,
    maxAge: TIMESTAMP_WINDOW_MS,
  };
}

// ID generation
export function generateId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  const id = `${timestamp}-${random}`;
  
  return prefix ? `${prefix}-${id}` : id;
}

// ============================================================================
// Todo Prioritization & Filtering
// ============================================================================

// Priority sorting weights (high = 0 for highest priority)
const PRIORITY_ORDER: Record<TodoPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function sortByPriority<T extends { priority: TodoPriority }>(items: T[]): T[] {
  return [...items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

/**
 * Smart prioritization for todos based on priority level and due date.
 * Returns todos sorted by priority (high first) and then by due date (soonest first).
 */
export function prioritizeTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const aWeight = PRIORITY_ORDER[a.priority];
    const bWeight = PRIORITY_ORDER[b.priority];
    
    if (aWeight !== bWeight) return aWeight - bWeight;
    
    // Then by due date (earlier dates first, null dates last)
    if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    
    return 0;
  });
}

/**
 * Filter todos to only include overdue items.
 */
export function filterOverdue(todos: Todo[]): Todo[] {
  const now = Date.now();
  return todos.filter(t => !t.completed && t.dueDate !== null && t.dueDate < now);
}

/**
 * Get top N prioritized todos for quick task focus.
 */
export function getTopPriorities(todos: Todo[], count = 5): Todo[] {
  const incomplete = todos.filter(t => !t.completed);
  const prioritized = prioritizeTodos(incomplete);
  return prioritized.slice(0, count);
}

// Date helpers
export function getNextMidnight(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
}

export function isOverdue(dueDate: number): boolean {
  return dueDate < Date.now();
}

// JNS name normalization
export function normalizeJNSName(name: string): string {
  const lower = name.toLowerCase();
  
  if (lower.endsWith('.jeju')) {
    return lower;
  }
  
  return `${lower}.jeju`;
}

// JNS name validation
export function isValidJNSName(name: string): boolean {
  if (!name || name.length === 0) return false;
  
  // Remove .jeju suffix for validation
  const label = name.toLowerCase().replace(/\.jeju$/, '');
  
  // Must contain only alphanumeric and hyphens
  if (!/^[a-z0-9-]+$/.test(label)) return false;
  
  // Cannot start or end with hyphen
  if (label.startsWith('-') || label.endsWith('-')) return false;
  
  return true;
}

// Format address for display
export function formatAddress(address: string, chars = 4): string {
  if (!address || address.length === 0) {
    throw new Error('Address is required for formatting');
  }
  if (!address.startsWith('0x') || address.length !== 42) {
    throw new Error(`Invalid address format: ${address}`);
  }
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

// Delay utility
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry with exponential backoff
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await delay(baseDelay * Math.pow(2, i));
      }
    }
  }
  
  throw lastError;
}

// Chunk array
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

