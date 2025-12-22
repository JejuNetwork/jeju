/**
 * Proof-of-Cloud Module
 */

export { getPoCMetrics, PoCMetrics } from './metrics'
export { PoCMonitor } from './monitor'
// Core
export {
  checkTCBStatus,
  extractPlatformInfo,
  hashHardwareId,
  parseQuote,
  verifyQuote,
} from './quote-parser'
export {
  createRegistryClient,
  MockPoCRegistryClient,
  PoCRegistryClient,
} from './registry-client'
// Types
export * from './types'
export {
  getLevelTag,
  getPlatformTag,
  isQuoteFresh,
  PoCVerifier,
} from './verifier'

// High-Level API

import type { Hex } from 'viem'
import { PoCMetrics } from './metrics'
import { PoCMonitor } from './monitor'
import type {
  AgentPoCStatus,
  PoCEventListener,
  PoCVerificationResult,
} from './types'
import { PoCVerifier } from './verifier'

let verifierInstance: PoCVerifier | null = null
let monitorInstance: PoCMonitor | null = null
let metricsInstance: PoCMetrics | null = null

export function initializePoCSystem(): void {
  if (!process.env.POC_SIGNER_KEY) {
    console.warn('[PoC] POC_SIGNER_KEY not set, PoC verification disabled')
    return
  }
  verifierInstance = PoCVerifier.fromEnv()
  monitorInstance = PoCMonitor.fromEnv(verifierInstance)

  const metricsPort = Number(process.env.POC_METRICS_PORT) || 9091
  metricsInstance = new PoCMetrics(metricsPort)

  // Wire up event listeners to metrics
  verifierInstance.addEventListener((e) =>
    metricsInstance?.recordVerification(e),
  )
  monitorInstance.addEventListener((e) =>
    metricsInstance?.recordVerification(e),
  )

  console.log('[PoC] System initialized')
}

export async function startPoCMonitor(): Promise<void> {
  if (!monitorInstance) {
    console.warn('[PoC] Monitor not initialized')
    return
  }
  await monitorInstance.start()
  await metricsInstance?.start()
}

export function stopPoCMonitor(): void {
  monitorInstance?.stop()
}

export async function verifyAgentAttestation(
  agentId: bigint,
  quote: Hex,
  expectedMeasurement?: Hex,
): Promise<PoCVerificationResult> {
  if (!verifierInstance) throw new Error('PoC verifier not initialized')
  return verifierInstance.verifyAttestation(agentId, quote, expectedMeasurement)
}

export async function getAgentPoCStatus(
  agentId: bigint,
): Promise<AgentPoCStatus> {
  if (!verifierInstance) throw new Error('PoC verifier not initialized')
  return verifierInstance.getAgentStatus(agentId)
}

export async function isAgentPoCVerified(agentId: bigint): Promise<boolean> {
  if (!verifierInstance) return false
  return verifierInstance.isAgentVerified(agentId)
}

export async function agentNeedsReverification(
  agentId: bigint,
): Promise<boolean> {
  if (!verifierInstance) return true
  return verifierInstance.needsReverification(agentId)
}

export function subscribeToPoCEvents(listener: PoCEventListener): () => void {
  const unsubs: Array<() => void> = []
  if (verifierInstance) unsubs.push(verifierInstance.addEventListener(listener))
  if (monitorInstance) unsubs.push(monitorInstance.addEventListener(listener))
  return () => unsubs.forEach((fn) => fn())
}

export function getPoCSystemStatus(): {
  initialized: boolean
  monitorRunning: boolean
  monitorStats: ReturnType<PoCMonitor['getStats']> | null
} {
  return {
    initialized: verifierInstance !== null,
    monitorRunning: monitorInstance !== null,
    monitorStats: monitorInstance?.getStats() ?? null,
  }
}

export function getVerifier(): PoCVerifier | null {
  return verifierInstance
}

export function getMonitor(): PoCMonitor | null {
  return monitorInstance
}

export function shutdownPoCSystem(): void {
  metricsInstance?.stop()
  metricsInstance = null
  monitorInstance?.stop()
  monitorInstance = null
  verifierInstance = null
  console.log('[PoC] System shutdown')
}
