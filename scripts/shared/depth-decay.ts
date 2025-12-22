/**
 * @module scripts/shared/depth-decay
 * @description Shared depth decay calculation for dependency funding weights
 * Used by both TypeScript services and matches Solidity implementation
 */

import { MAX_BPS, DEPTH_DECAY_BPS } from '../../types/funding';

/**
 * Apply depth decay to a weight value
 * Dependencies of dependencies get progressively less weight
 * 
 * Formula: weight * (1 - decayRate)^depth
 * 
 * With 20% decay:
 * - Depth 0: 100% of weight
 * - Depth 1: 80% of weight
 * - Depth 2: 64% of weight
 * - Depth 3: 51.2% of weight
 * 
 * @param weight - Base weight value
 * @param depth - Dependency depth (0 = direct, 1+ = transitive)
 * @param decayBps - Decay rate in basis points (default: 2000 = 20%)
 * @returns Adjusted weight after decay
 */
export function applyDepthDecay(
  weight: number,
  depth: number,
  decayBps: number = DEPTH_DECAY_BPS
): number {
  if (depth === 0) return weight;
  if (depth < 0) throw new Error('Depth cannot be negative');
  if (weight < 0) throw new Error('Weight cannot be negative');

  let decayFactor = MAX_BPS;
  for (let i = 0; i < depth; i++) {
    decayFactor = Math.floor((decayFactor * (MAX_BPS - decayBps)) / MAX_BPS);
  }

  return Math.floor((weight * decayFactor) / MAX_BPS);
}

/**
 * Calculate the decay factor for a given depth
 * Returns a value between 0 and MAX_BPS
 */
export function getDecayFactor(depth: number, decayBps: number = DEPTH_DECAY_BPS): number {
  if (depth === 0) return MAX_BPS;
  if (depth < 0) throw new Error('Depth cannot be negative');

  let factor = MAX_BPS;
  for (let i = 0; i < depth; i++) {
    factor = Math.floor((factor * (MAX_BPS - decayBps)) / MAX_BPS);
  }
  return factor;
}

/**
 * Get the effective weight percentage at a given depth
 * Returns a value between 0 and 100
 */
export function getEffectivePercentage(depth: number, decayBps: number = DEPTH_DECAY_BPS): number {
  return (getDecayFactor(depth, decayBps) / MAX_BPS) * 100;
}

/**
 * Calculate what depth would be needed to reach a target percentage
 */
export function depthForPercentage(
  targetPercentage: number,
  decayBps: number = DEPTH_DECAY_BPS
): number {
  if (targetPercentage >= 100) return 0;
  if (targetPercentage <= 0) return Infinity;

  const targetFactor = (targetPercentage / 100) * MAX_BPS;
  let depth = 0;
  let factor = MAX_BPS;

  while (factor > targetFactor) {
    factor = Math.floor((factor * (MAX_BPS - decayBps)) / MAX_BPS);
    depth++;
    if (depth > 100) break; // Safety limit
  }

  return depth;
}

/**
 * Normalize an array of weights to sum to MAX_BPS
 */
export function normalizeWeights(weights: number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total === 0) return weights.map(() => 0);

  return weights.map(w => Math.floor((w * MAX_BPS) / total));
}

/**
 * Batch apply depth decay to multiple weights
 */
export function batchApplyDepthDecay(
  items: Array<{ weight: number; depth: number }>,
  decayBps: number = DEPTH_DECAY_BPS
): number[] {
  return items.map(item => applyDepthDecay(item.weight, item.depth, decayBps));
}

