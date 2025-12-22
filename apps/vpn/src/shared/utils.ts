/**
 * Shared utility functions for VPN app
 */

import type { VPNNode } from '../api/schemas'

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * Format seconds to human-readable duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

/**
 * Calculate node score for sorting (lower is better)
 * Combines latency and load into a single score
 */
export function calculateNodeScore(node: VPNNode): number {
  return node.latency_ms + node.load * 10
}

/**
 * Find the best node from an array (lowest score)
 */
export function findBestClientNode(nodes: VPNNode[]): VPNNode {
  if (nodes.length === 0) {
    throw new Error('No nodes available')
  }
  return nodes.reduce((best, current) =>
    calculateNodeScore(current) < calculateNodeScore(best) ? current : best,
  )
}
