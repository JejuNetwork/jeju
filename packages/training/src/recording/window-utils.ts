/**
 * Window ID Utilities
 *
 * Time window management for training data organization.
 * Windows are 1-hour periods used to group trajectories for GRPO training.
 *
 * Window ID format: YYYY-MM-DDTHH:00 (e.g., 2024-01-15T14:00)
 *
 * @packageDocumentation
 */

/**
 * Parsed window ID components
 */
export interface ParsedWindowId {
  year: number
  month: number
  day: number
  hour: number
  date: Date
}

/**
 * Window range with start and end timestamps
 */
export interface WindowRange {
  windowId: string
  start: Date
  end: Date
}

/**
 * Get the current window ID
 *
 * @returns Window ID for the current hour (e.g., "2024-01-15T14:00")
 */
export function getCurrentWindowId(): string {
  return getWindowIdForTimestamp(Date.now())
}

/**
 * Get the window ID for N hours ago
 *
 * @param hoursAgo - Number of hours in the past
 * @returns Window ID for the specified hour
 */
export function getPreviousWindowId(hoursAgo = 1): string {
  const timestamp = Date.now() - hoursAgo * 60 * 60 * 1000
  return getWindowIdForTimestamp(timestamp)
}

/**
 * Get window ID for a specific timestamp
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Window ID (format: YYYY-MM-DDTHH:00)
 */
export function getWindowIdForTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')

  return `${year}-${month}-${day}T${hour}:00`
}

/**
 * Parse a window ID into its components
 *
 * @param windowId - Window ID string (format: YYYY-MM-DDTHH:00)
 * @returns Parsed components
 */
export function parseWindowId(windowId: string): ParsedWindowId {
  const match = windowId.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00$/)
  if (!match || !match[1] || !match[2] || !match[3] || !match[4]) {
    throw new Error(`Invalid window ID format: ${windowId}`)
  }

  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  const day = parseInt(match[3], 10)
  const hour = parseInt(match[4], 10)

  return {
    year,
    month,
    day,
    hour,
    date: new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0)),
  }
}

/**
 * Get the time range for a window
 *
 * @param windowId - Window ID string
 * @returns Start and end times for the window
 */
export function getWindowRange(windowId: string): WindowRange {
  const parsed = parseWindowId(windowId)
  const start = parsed.date
  const end = new Date(start.getTime() + 60 * 60 * 1000) // 1 hour later

  return { windowId, start, end }
}

/**
 * Check if a timestamp falls within a window
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param windowId - Window ID to check against
 * @returns True if timestamp is within the window
 */
export function isTimestampInWindow(
  timestamp: number,
  windowId: string,
): boolean {
  const range = getWindowRange(windowId)
  return timestamp >= range.start.getTime() && timestamp < range.end.getTime()
}

/**
 * Check if a window is complete (past the end time)
 *
 * @param windowId - Window ID to check
 * @returns True if the window has ended
 */
export function isWindowComplete(windowId: string): boolean {
  const range = getWindowRange(windowId)
  return Date.now() >= range.end.getTime()
}

/**
 * Generate window IDs for a range of hours
 *
 * @param count - Number of windows to generate
 * @param startingFrom - Optional starting timestamp (defaults to now)
 * @returns Array of window IDs, from most recent to oldest
 */
export function generateWindowIds(
  count: number,
  startingFrom?: number,
): string[] {
  const windows: string[] = []
  const baseTime = startingFrom ?? Date.now()

  for (let i = 0; i < count; i++) {
    const timestamp = baseTime - i * 60 * 60 * 1000
    windows.push(getWindowIdForTimestamp(timestamp))
  }

  return windows
}
