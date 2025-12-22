/**
 * Shared utility functions for VPN app
 */

import type { VPNNode } from '../api/schemas';

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Calculate node score for sorting (lower is better)
 * Combines latency and load into a single score
 */
export function calculateNodeScore(node: VPNNode): number {
  return node.latency_ms + node.load * 10;
}

/**
 * Find the best node from an array (lowest score)
 */
export function findBestClientNode(nodes: VPNNode[]): VPNNode {
  if (nodes.length === 0) {
    throw new Error('No nodes available');
  }
  return nodes.reduce((best, current) => 
    calculateNodeScore(current) < calculateNodeScore(best) ? current : best
  );
}
