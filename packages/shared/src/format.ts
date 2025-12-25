/**
 * Formatting Utilities
 *
 * Import from @jejunetwork/shared for consistent formatting across all apps.
 */

import { type ClassValue, clsx } from 'clsx'
import { nanoid } from 'nanoid'
import prettyBytes from 'pretty-bytes'
import prettyMs from 'pretty-ms'
import { twMerge } from 'tailwind-merge'
import { format as timeagoFormat } from 'timeago.js'

// Byte Formatting (pretty-bytes)

/**
 * Format bytes to human-readable string
 * @example formatBytes(1024) // "1 kB"
 * @example formatBytes(1234567) // "1.23 MB"
 */
export function formatBytes(bytes: number): string {
  return prettyBytes(bytes)
}

/**
 * Format bytes with binary units (KiB, MiB, etc.)
 * @example formatBytesBinary(1024) // "1 KiB"
 */
export function formatBytesBinary(bytes: number): string {
  return prettyBytes(bytes, { binary: true })
}

// Duration Formatting (pretty-ms)

/**
 * Format milliseconds to human-readable duration
 * @example formatMs(123456) // "2m 3s"
 * @example formatMs(3600000) // "1h"
 */
export function formatMs(ms: number): string {
  return prettyMs(ms, { compact: true })
}

/**
 * Format seconds to human-readable duration
 * @example formatDuration(90) // "1m 30s"
 * @example formatDuration(3600) // "1h"
 */
export function formatDuration(seconds: number): string {
  return prettyMs(seconds * 1000, { compact: true })
}

/**
 * Format duration with verbose output
 * @example formatDurationVerbose(90) // "1 minute 30 seconds"
 */
export function formatDurationVerbose(seconds: number): string {
  return prettyMs(seconds * 1000, { verbose: true })
}

// Time Ago Formatting (timeago.js)

/**
 * Format timestamp to relative time (e.g., "3 hours ago")
 * @param timestamp - Unix timestamp in milliseconds or Date
 * @example formatTimeAgo(Date.now() - 3600000) // "1 hour ago"
 */
export function formatTimeAgo(timestamp: number | Date): string {
  return timeagoFormat(timestamp)
}

/**
 * Format Unix timestamp (seconds) to relative time
 * @param unixTimestamp - Unix timestamp in seconds
 * @example formatTimestamp(Date.now() / 1000 - 3600) // "1 hour ago"
 */
export function formatTimestamp(unixTimestamp: number): string {
  return timeagoFormat(unixTimestamp * 1000)
}

// Number Formatting (Intl.NumberFormat)

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Format number with compact notation (K, M, B)
 * @example formatNumber(1234567) // "1.2M"
 */
export function formatNumber(num: number): string {
  return compactFormatter.format(num)
}

/**
 * Format number as USD currency
 * @example formatUsd(1234.56) // "$1,234.56"
 */
export function formatUsd(amount: number): string {
  return currencyFormatter.format(amount)
}

/**
 * Format number as percentage
 * @example formatPercent(0.1234) // "12.34%"
 */
export function formatPercent(value: number): string {
  return percentFormatter.format(value)
}

// Address Formatting (Domain-specific)

/**
 * Shorten an Ethereum address for display
 * @example formatAddress("0x1234...abcd", 4) // "0x1234...abcd"
 */
export function formatAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) return address
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

/**
 * Alias for formatAddress
 */
export const shortenAddress = formatAddress

// ETH/Wei Formatting (Domain-specific)

/**
 * Format wei to ETH with specified decimals
 * @example formatEth(1000000000000000000n) // "1.0000 ETH"
 */
export function formatEth(wei: bigint | string, decimals = 4): string {
  const weiValue = typeof wei === 'string' ? BigInt(wei) : wei
  const eth = Number(weiValue) / 1e18
  return `${eth.toFixed(decimals)} ETH`
}

/**
 * Format gas amount
 * @example formatGas(21000) // "21K gas"
 */
export function formatGas(gas: number): string {
  return `${formatNumber(gas)} gas`
}

/**
 * Format gas price in gwei
 * @example formatGasPrice(25.5) // "25.50 gwei"
 */
export function formatGasPrice(gwei: number): string {
  return `${gwei.toFixed(2)} gwei`
}

// ID Generation (nanoid)

/**
 * Generate a unique ID
 * @param size - Length of the ID (default: 21)
 * @example generateId() // "V1StGXR8_Z5jdHi6B-myT"
 */
export function generateId(size?: number): string {
  return nanoid(size)
}

/**
 * Generate a prefixed unique ID
 * @example generatePrefixedId("user") // "user_V1StGXR8_Z5jdHi6B"
 */
export function generatePrefixedId(prefix: string, size = 16): string {
  return `${prefix}_${nanoid(size)}`
}

// CSS Class Utilities (clsx)

/**
 * Merge CSS class names conditionally with Tailwind CSS class conflict resolution
 * @example cn("p-4 px-2") // "p-4 px-2" → "px-2" (px-2 overrides p-4's horizontal padding)
 * @example cn("text-red-500", isActive && "text-blue-500") // Conditionally applies blue
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Merge CSS class names conditionally (alias for cn without Tailwind merge)
 * @example classNames("btn", isActive && "btn-active", "btn-lg")
 */
export function classNames(...inputs: ClassValue[]): string {
  return clsx(inputs)
}

// Utility Functions

/**
 * Delay execution for specified milliseconds
 * @example await delay(1000) // waits 1 second
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Chunk an array into smaller arrays
 * @example chunk([1,2,3,4,5], 2) // [[1,2], [3,4], [5]]
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

// Date/Time Formatting

/**
 * Format date to readable date string
 * @example formatDate(new Date()) // "Jan 16, 2025"
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format date to readable time string
 * @example formatTime(new Date()) // "3:45 PM"
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Format relative time in compact form (e.g., "5m", "2h", "3d")
 * Falls back to formatted date for dates older than 7 days.
 * @example formatRelativeTime(new Date(Date.now() - 300000)) // "5m"
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return `${seconds}s`
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return formatDate(d)
}

/**
 * Format number as simple percentage (integer)
 * @example formatPercentageSimple(50) // "50%"
 */
export function formatPercentageSimple(value: number): string {
  return `${Math.round(value)}%`
}

/**
 * Format currency with configurable decimals
 * @example formatCurrency(123.456) // "$123.46"
 * @example formatCurrency(1000, 0) // "$1000"
 */
export function formatCurrency(amount: number, decimals = 2): string {
  return `$${amount.toFixed(decimals)}`
}

/**
 * Clamp number between min and max values
 * @example clamp(150, 0, 100) // 100
 * @example clamp(-10, 0, 100) // 0
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Sanitize ID for use in file paths
 * Converts to lowercase, replaces spaces with hyphens, removes special characters.
 * @example sanitizeId("My User ID!") // "my-user-id"
 */
export function sanitizeId(id: string | undefined | null): string {
  if (!id) {
    return 'unknown'
  }
  return id
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .trim()
}

/**
 * Decimal-like value type that supports toString conversion
 */
type DecimalLike =
  | string
  | number
  | bigint
  | null
  | undefined
  | { toString: () => string }

/**
 * Safely convert a value to a string representation
 * Handles numbers, strings, bigints, null, undefined, and objects with toString.
 * @example toSafeString(123.45) // "123.45"
 * @example toSafeString(null) // "0"
 */
export function toSafeString(
  value: DecimalLike,
  defaultValue: string = '0',
): string {
  if (value === null || value === undefined) {
    return defaultValue
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }
  if (typeof value === 'object' && typeof value.toString === 'function') {
    return value.toString()
  }
  return defaultValue
}

/**
 * Safely convert a value to a number
 * Handles numbers, strings, bigints, null, undefined, and objects with toString.
 * @example toSafeNumber('123.45') // 123.45
 * @example toSafeNumber(null) // 0
 */
export function toSafeNumber(
  value: DecimalLike,
  defaultValue: number = 0,
): number {
  if (value === null || value === undefined) {
    return defaultValue
  }
  if (typeof value === 'number') {
    return Number.isNaN(value) ? defaultValue : value
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }

  const str =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'object' && typeof value.toString === 'function'
        ? value.toString()
        : String(value)

  const parsed = Number(str)
  return Number.isNaN(parsed) ? defaultValue : parsed
}
