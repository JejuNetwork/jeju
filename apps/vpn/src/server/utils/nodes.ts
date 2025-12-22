/**
 * Node selection and filtering utilities
 * 
 * Shared business logic for VPN node operations
 */

import type { VPNServiceContext, VPNNodeState } from '../types';
import { expect } from '../schemas';

/**
 * Country code validation schema
 */
const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;

/**
 * Validate country code format
 */
export function validateCountryCode(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) {
    throw new Error(`Invalid country code: ${countryCode}. Must be 2 characters`);
  }
  const upper = countryCode.toUpperCase();
  if (!COUNTRY_CODE_REGEX.test(upper)) {
    throw new Error(`Invalid country code format: ${countryCode}`);
  }
  return upper;
}

/**
 * Filter nodes by country code
 */
export function filterNodesByCountry(
  nodes: VPNNodeState[],
  countryCode: string
): VPNNodeState[] {
  const validatedCode = validateCountryCode(countryCode);
  return nodes.filter(n => n.countryCode === validatedCode);
}

/**
 * Filter nodes by status
 */
export function filterNodesByStatus(
  nodes: VPNNodeState[],
  status: 'online' | 'busy' | 'offline' = 'online'
): VPNNodeState[] {
  return nodes.filter(n => n.status === status);
}

/**
 * Sort nodes by status (online first) and load
 */
export function sortNodesByStatusAndLoad(nodes: VPNNodeState[]): VPNNodeState[] {
  return [...nodes].sort((a, b) => {
    // Online nodes first
    if (a.status === 'online' && b.status !== 'online') return -1;
    if (a.status !== 'online' && b.status === 'online') return 1;
    
    // Then by active connections
    return a.activeConnections - b.activeConnections;
  });
}

/**
 * Sort nodes by load (lowest first)
 */
export function sortNodesByLoad(nodes: VPNNodeState[]): VPNNodeState[] {
  return [...nodes].sort((a, b) => {
    const loadA = a.activeConnections / a.maxConnections;
    const loadB = b.activeConnections / b.maxConnections;
    
    if (isNaN(loadA) || isNaN(loadB)) {
      throw new Error('Invalid node load calculation');
    }
    
    return loadA - loadB;
  });
}

/**
 * Find best node based on criteria
 */
export function findBestNode(
  ctx: VPNServiceContext,
  countryCode?: string
): VPNNodeState | undefined {
  let nodes = Array.from(ctx.nodes.values());
  
  // Filter by status
  nodes = filterNodesByStatus(nodes, 'online');
  
  // Filter by country if provided
  if (countryCode) {
    nodes = filterNodesByCountry(nodes, countryCode);
  }
  
  if (nodes.length === 0) {
    return undefined;
  }
  
  // Sort by load and return best
  const sorted = sortNodesByLoad(nodes);
  return sorted[0];
}

/**
 * Get nodes grouped by country
 */
export function getNodesByCountry(ctx: VPNServiceContext): Map<string, number> {
  const countries = new Map<string, number>();
  
  for (const node of ctx.nodes.values()) {
    const count = countries.get(node.countryCode) ?? 0;
    countries.set(node.countryCode, count + 1);
  }
  
  return countries;
}

/**
 * Calculate node load percentage
 */
export function calculateNodeLoad(node: VPNNodeState): number {
  if (node.maxConnections === 0) {
    return 100; // Full if max is 0
  }
  const load = Math.round((node.activeConnections / node.maxConnections) * 100);
  expect(load >= 0 && load <= 100, `Invalid load calculation: ${load}`);
  return load;
}

/**
 * Get node by ID
 */
export function getNodeById(
  ctx: VPNServiceContext,
  nodeId: string
): VPNNodeState {
  const node = ctx.nodes.get(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return node;
}
