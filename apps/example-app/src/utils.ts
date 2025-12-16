/**
 * Utility functions for the Decentralized App Template
 */

import type { TodoPriority } from './types';

// Authentication message construction
export function constructAuthMessage(timestamp: number): string {
  return `jeju-dapp:${timestamp}`;
}

// Timestamp validation (5 minute window)
const TIMESTAMP_WINDOW = 5 * 60 * 1000; // 5 minutes

export function isValidTimestamp(timestamp: number): boolean {
  const now = Date.now();
  const age = now - timestamp;
  
  // Reject future timestamps
  if (timestamp > now) return false;
  
  // Reject timestamps older than the window
  return age <= TIMESTAMP_WINDOW;
}

// ID generation
export function generateId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  const id = `${timestamp}-${random}`;
  
  return prefix ? `${prefix}-${id}` : id;
}

// Priority sorting
const PRIORITY_ORDER: Record<TodoPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortByPriority<T extends { priority: TodoPriority }>(items: T[]): T[] {
  return [...items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
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
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

// Safe JSON parse
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
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

