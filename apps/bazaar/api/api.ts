/**
 * Typed API helper functions
 *
 * Provides convenient wrappers for all Bazaar API endpoints with full type safety.
 * These are thin wrappers around the client methods for convenience.
 */

import type { Address } from 'viem'
import { api } from './client'

export async function getHealth() {
  return api.health.get()
}

export async function getTFMMPools() {
  return api.tfmm.getPools()
}

export async function getTFMMPool(poolAddress: Address) {
  return api.tfmm.getPool(poolAddress)
}

export async function getTFMMStrategies() {
  return api.tfmm.getStrategies()
}

export async function getTFMMOracles() {
  return api.tfmm.getOracles()
}

export async function createTFMMPool(params: {
  tokens: Address[]
  initialWeights: number[]
  strategy: string
}) {
  return api.tfmm.createPool(params)
}

export async function updateTFMMStrategy(params: {
  poolAddress: Address
  newStrategy: string
}) {
  return api.tfmm.updateStrategy(params)
}

export async function triggerTFMMRebalance(params: { poolAddress: Address }) {
  return api.tfmm.triggerRebalance(params)
}

export async function getA2AInfo() {
  return api.a2a.getInfo()
}

export async function getAgentCard() {
  return api.a2a.getAgentCard()
}

export async function getMCPInfo() {
  return api.mcp.getInfo()
}
