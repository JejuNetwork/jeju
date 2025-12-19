/**
 * Proof-of-Cloud Module
 * 
 * TEE attestation verification against Proof-of-Cloud registry
 * for ensuring hardware runs in verified secure cloud facilities.
 * 
 * @module poc
 */

// Types
export * from './types';

// Quote Parsing
export {
  parseQuote,
  verifyQuote,
  hashHardwareId,
  extractPlatformInfo,
  parseDCAPQuote,
  parseSEVSNPQuote,
  parseDCAPHeader,
  parseTDXReportBody,
  extractCertChain,
  verifyCertificateChain,
  verifyQuoteSignature,
  checkTCBStatus,
} from './quote-parser';

// Verifier Service
export {
  PoCVerifier,
  isQuoteFresh,
  getPlatformTag,
  getLevelTag,
} from './verifier';

// Registry Client
export {
  PoCRegistryClient,
  MockPoCRegistryClient,
  createRegistryClient,
} from './registry-client';

// Monitor
export {
  PoCMonitor,
} from './monitor';

// ============================================================================
// High-Level API
// ============================================================================

import type { Address, Hex } from 'viem';
import { PoCVerifier } from './verifier';
import { PoCMonitor } from './monitor';
import { createRegistryClient } from './registry-client';
import type { 
  AgentPoCStatus, 
  PoCVerificationResult,
  PoCVerificationEvent,
  PoCEventListener,
} from './types';

let verifierInstance: PoCVerifier | null = null;
let monitorInstance: PoCMonitor | null = null;

/**
 * Initialize the PoC system
 */
export function initializePoCSystem(): void {
  if (!process.env.POC_SIGNER_KEY) {
    console.warn('[PoC] POC_SIGNER_KEY not set, PoC verification disabled');
    return;
  }

  verifierInstance = PoCVerifier.fromEnv();
  monitorInstance = PoCMonitor.fromEnv(verifierInstance);
  
  console.log('[PoC] System initialized');
}

/**
 * Start the PoC monitor
 */
export async function startPoCMonitor(): Promise<void> {
  if (!monitorInstance) {
    console.warn('[PoC] Monitor not initialized');
    return;
  }

  await monitorInstance.start();
}

/**
 * Stop the PoC monitor
 */
export function stopPoCMonitor(): void {
  monitorInstance?.stop();
}

/**
 * Verify an attestation for an agent
 */
export async function verifyAgentAttestation(
  agentId: bigint,
  quote: Hex,
  expectedMeasurement?: Hex,
): Promise<PoCVerificationResult> {
  if (!verifierInstance) {
    throw new Error('PoC verifier not initialized');
  }

  return verifierInstance.verifyAttestation(agentId, quote, expectedMeasurement);
}

/**
 * Get PoC status for an agent
 */
export async function getAgentPoCStatus(agentId: bigint): Promise<AgentPoCStatus> {
  if (!verifierInstance) {
    throw new Error('PoC verifier not initialized');
  }

  return verifierInstance.getAgentStatus(agentId);
}

/**
 * Check if an agent has PoC-verified hardware
 */
export async function isAgentPoCVerified(agentId: bigint): Promise<boolean> {
  if (!verifierInstance) {
    return false;
  }

  return verifierInstance.isAgentVerified(agentId);
}

/**
 * Check if an agent needs re-verification
 */
export async function agentNeedsReverification(agentId: bigint): Promise<boolean> {
  if (!verifierInstance) {
    return true;
  }

  return verifierInstance.needsReverification(agentId);
}

/**
 * Subscribe to PoC events
 */
export function subscribeToPoCEvents(listener: PoCEventListener): () => void {
  const unsubscribers: Array<() => void> = [];

  if (verifierInstance) {
    unsubscribers.push(verifierInstance.addEventListener(listener));
  }

  if (monitorInstance) {
    unsubscribers.push(monitorInstance.addEventListener(listener));
  }

  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
  };
}

/**
 * Get PoC system status
 */
export function getPoCSystemStatus(): {
  initialized: boolean;
  monitorRunning: boolean;
  monitorStats: ReturnType<PoCMonitor['getStats']> | null;
} {
  return {
    initialized: verifierInstance !== null,
    monitorRunning: monitorInstance !== null,
    monitorStats: monitorInstance?.getStats() ?? null,
  };
}

/**
 * Get the verifier instance (for advanced usage)
 */
export function getVerifier(): PoCVerifier | null {
  return verifierInstance;
}

/**
 * Get the monitor instance (for advanced usage)
 */
export function getMonitor(): PoCMonitor | null {
  return monitorInstance;
}

/**
 * Shutdown the PoC system
 */
export function shutdownPoCSystem(): void {
  monitorInstance?.stop();
  monitorInstance = null;
  verifierInstance = null;
  console.log('[PoC] System shutdown');
}


