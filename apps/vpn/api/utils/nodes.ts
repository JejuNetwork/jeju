/** Node selection and filtering utilities */

import { expectTrue } from '@jejunetwork/types'
import type { VPNNodeState, VPNServiceContext } from '../types'

const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/

export function validateCountryCode(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) {
    throw new Error(
      `Invalid country code: ${countryCode}. Must be 2 characters`,
    )
  }
  const upper = countryCode.toUpperCase()
  if (!COUNTRY_CODE_REGEX.test(upper)) {
    throw new Error(`Invalid country code format: ${countryCode}`)
  }
  return upper
}

export function filterNodesByCountry(
  nodes: VPNNodeState[],
  countryCode: string,
): VPNNodeState[] {
  const validatedCode = validateCountryCode(countryCode)
  return nodes.filter((n) => n.countryCode === validatedCode)
}

export function filterNodesByStatus(
  nodes: VPNNodeState[],
  status: 'online' | 'busy' | 'offline' = 'online',
): VPNNodeState[] {
  return nodes.filter((n) => n.status === status)
}

export function sortNodesByStatusAndLoad(
  nodes: VPNNodeState[],
): VPNNodeState[] {
  return [...nodes].sort((a, b) => {
    if (a.status === 'online' && b.status !== 'online') return -1
    if (a.status !== 'online' && b.status === 'online') return 1
    return a.activeConnections - b.activeConnections
  })
}

export function sortNodesByLoad(nodes: VPNNodeState[]): VPNNodeState[] {
  return [...nodes].sort((a, b) => {
    const loadA = a.activeConnections / a.maxConnections
    const loadB = b.activeConnections / b.maxConnections

    if (Number.isNaN(loadA) || Number.isNaN(loadB)) {
      throw new Error('Invalid node load calculation')
    }

    return loadA - loadB
  })
}

export function findBestNode(
  ctx: VPNServiceContext,
  countryCode?: string,
): VPNNodeState | undefined {
  let nodes = Array.from(ctx.nodes.values())
  nodes = filterNodesByStatus(nodes, 'online')

  if (countryCode) {
    nodes = filterNodesByCountry(nodes, countryCode)
  }

  if (nodes.length === 0) {
    return undefined
  }

  const sorted = sortNodesByLoad(nodes)
  return sorted[0]
}

export function getNodesByCountry(ctx: VPNServiceContext): Map<string, number> {
  const countries = new Map<string, number>()

  for (const node of ctx.nodes.values()) {
    const count = countries.get(node.countryCode) ?? 0
    countries.set(node.countryCode, count + 1)
  }

  return countries
}

export function calculateNodeLoad(node: VPNNodeState): number {
  if (node.maxConnections === 0) {
    return 100 // Full if max is 0
  }
  const load = Math.round((node.activeConnections / node.maxConnections) * 100)
  expectTrue(load >= 0 && load <= 100, `Invalid load calculation: ${load}`)
  return load
}

export function getNodeById(
  ctx: VPNServiceContext,
  nodeId: string,
): VPNNodeState {
  const node = ctx.nodes.get(nodeId)
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`)
  }
  return node
}
