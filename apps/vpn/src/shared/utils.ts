/**
 * Shared utility functions for VPN app
 */

import { formatBytes, formatDuration } from '@jejunetwork/shared'
import type { VPNNode } from '../api/schemas'

// Re-export formatting utilities
export { formatBytes, formatDuration }

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
