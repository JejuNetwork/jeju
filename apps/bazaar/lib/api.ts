/**
 * Typed API helper functions
 *
 * Provides convenient wrappers for all Bazaar API endpoints with full type safety.
 * These are thin wrappers around the client methods for convenience.
 */

import type { Address } from 'viem'
import { api } from './client'

// =============================================================================
// Health Check
// =============================================================================

/**
 * Check API health status
 */
export async function getHealth() {
  return api.health.get()
}

// =============================================================================
// Faucet API
// =============================================================================

/**
 * Get faucet info (amount per claim, cooldown, etc.)
 */
export async function getFaucetInfo() {
  return api.faucet.getInfo()
}

/**
 * Get faucet status for an address (eligibility, cooldown remaining)
 */
export async function getFaucetStatus(address: Address) {
  return api.faucet.getStatus(address)
}

/**
 * Claim tokens from the faucet
 */
export async function claimFaucet(address: Address) {
  return api.faucet.claim(address)
}

// =============================================================================
// TFMM API
// =============================================================================

/**
 * Get all TFMM pools with stats
 */
export async function getTFMMPools() {
  return api.tfmm.getPools()
}

/**
 * Get a specific TFMM pool by address
 */
export async function getTFMMPool(poolAddress: Address) {
  return api.tfmm.getPool(poolAddress)
}

/**
 * Get available TFMM strategies
 */
export async function getTFMMStrategies() {
  return api.tfmm.getStrategies()
}

/**
 * Get TFMM oracle status
 */
export async function getTFMMOracles() {
  return api.tfmm.getOracles()
}

/**
 * Create a new TFMM pool
 */
export async function createTFMMPool(params: {
  tokens: Address[]
  initialWeights: number[]
  strategy: string
}) {
  return api.tfmm.createPool(params)
}

/**
 * Update a TFMM pool's strategy
 */
export async function updateTFMMStrategy(params: {
  poolAddress: Address
  newStrategy: string
}) {
  return api.tfmm.updateStrategy(params)
}

/**
 * Trigger rebalance for a TFMM pool
 */
export async function triggerTFMMRebalance(params: { poolAddress: Address }) {
  return api.tfmm.triggerRebalance(params)
}

// =============================================================================
// A2A API
// =============================================================================

/**
 * Get A2A service info
 */
export async function getA2AInfo() {
  return api.a2a.getInfo()
}

/**
 * Get agent card
 */
export async function getAgentCard() {
  return api.a2a.getAgentCard()
}

// =============================================================================
// MCP API
// =============================================================================

/**
 * Get MCP server info
 */
export async function getMCPInfo() {
  return api.mcp.getInfo()
}
