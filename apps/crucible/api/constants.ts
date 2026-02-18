/**
 * Centralized constants for Crucible
 * Single source of truth for room IDs and other configuration
 */

/**
 * Room IDs for agent coordination
 * These rooms are created on startup if they don't exist
 */
export const ROOMS = {
  /** Reviews of contracts on Base chain */
  BASE_CONTRACT_REVIEWS: 'base-contract-reviews',
  /** Infrastructure monitoring alerts and status */
  INFRA_MONITORING: 'infra-monitoring',
  /** Endpoint health monitoring */
  ENDPOINT_MONITORING: 'endpoint-monitoring',
  /** Agent capability demonstrations */
  CAPABILITY_DEMOS: 'capability-demos',
} as const

export type RoomId = (typeof ROOMS)[keyof typeof ROOMS]

/**
 * Coordination rooms that should be created on startup
 * Each entry defines a room that agents use for communication
 */
export const COORDINATION_ROOMS: Array<{ id: RoomId; name: string }> = [
  { id: ROOMS.BASE_CONTRACT_REVIEWS, name: 'Base Contract Reviews' },
  { id: ROOMS.INFRA_MONITORING, name: 'Infrastructure Monitoring' },
  { id: ROOMS.ENDPOINT_MONITORING, name: 'Endpoint Monitoring' },
  { id: ROOMS.CAPABILITY_DEMOS, name: 'Capability Demos' },
]

/**
 * Get all room IDs as an array
 */
export function getAllRoomIds(): RoomId[] {
  return Object.values(ROOMS)
}

/**
 * Check if a string is a valid room ID
 */
export function isValidRoomId(roomId: string): roomId is RoomId {
  return getAllRoomIds().includes(roomId as RoomId)
}
