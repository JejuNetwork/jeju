/** Shared utility functions for VPN app */

import type { VPNNode } from './schemas'

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

export function calculateNodeScore(node: VPNNode): number {
  return node.latency_ms + node.load * 10
}

export function findBestClientNode(nodes: VPNNode[]): VPNNode {
  if (nodes.length === 0) {
    throw new Error('No nodes available')
  }
  return nodes.reduce((best, current) =>
    calculateNodeScore(current) < calculateNodeScore(best) ? current : best,
  )
}
