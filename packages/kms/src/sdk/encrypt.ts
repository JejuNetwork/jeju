/**
 * KMS SDK - Encryption utilities and policy builders
 */

import type { Address } from 'viem';
import { getKMS } from '../kms.js';
import { type AccessCondition, type AccessControlPolicy, type EncryptedPayload, ConditionOperator, KMSProviderType } from '../types.js';

// Policy builders
export function timeLockedPolicy(chain: string, unlockTimestamp: number): AccessControlPolicy {
  return { conditions: [{ type: 'timestamp', chain, comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: unlockTimestamp }], operator: 'and' };
}

export function stakeGatedPolicy(registryAddress: Address, chain: string, minStakeUSD: number): AccessControlPolicy {
  return { conditions: [{ type: 'stake', registryAddress, chain, minStakeUSD }], operator: 'and' };
}

export function roleGatedPolicy(registryAddress: Address, chain: string, role: string): AccessControlPolicy {
  return { conditions: [{ type: 'role', registryAddress, chain, role }], operator: 'and' };
}

export function agentOwnerPolicy(registryAddress: Address, chain: string, agentId: number): AccessControlPolicy {
  return { conditions: [{ type: 'agent', registryAddress, chain, agentId }], operator: 'and' };
}

export function tokenGatedPolicy(chain: string, tokenAddress: Address, minBalance: string): AccessControlPolicy {
  return { conditions: [{ type: 'balance', chain, tokenAddress, comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: minBalance }], operator: 'and' };
}

export function combineAnd(...conditions: AccessCondition[]): AccessControlPolicy {
  return { conditions, operator: 'and' };
}

export function combineOr(...conditions: AccessCondition[]): AccessControlPolicy {
  return { conditions, operator: 'or' };
}

// Encryption functions
export async function encryptTimeLocked(data: string, chain: string, unlockTimestamp: number, metadata?: Record<string, string>): Promise<EncryptedPayload> {
  const kms = getKMS();
  await kms.initialize();
  return kms.encrypt({ data, policy: timeLockedPolicy(chain, unlockTimestamp), metadata });
}

export async function encryptForStakers(data: string, registryAddress: Address, chain: string, minStakeUSD: number, metadata?: Record<string, string>): Promise<EncryptedPayload> {
  const kms = getKMS();
  await kms.initialize();
  return kms.encrypt({ data, policy: stakeGatedPolicy(registryAddress, chain, minStakeUSD), metadata });
}

export async function encryptForRole(data: string, registryAddress: Address, chain: string, role: string, metadata?: Record<string, string>): Promise<EncryptedPayload> {
  const kms = getKMS();
  await kms.initialize();
  return kms.encrypt({ data, policy: roleGatedPolicy(registryAddress, chain, role), metadata });
}

export async function encryptForAgent(data: string, registryAddress: Address, chain: string, agentId: number, metadata?: Record<string, string>): Promise<EncryptedPayload> {
  const kms = getKMS();
  await kms.initialize();
  return kms.encrypt({ data, policy: agentOwnerPolicy(registryAddress, chain, agentId), metadata });
}

export async function encryptWithPolicy(data: string, policy: AccessControlPolicy, options?: { keyId?: string; provider?: KMSProviderType; metadata?: Record<string, string> }): Promise<EncryptedPayload> {
  const kms = getKMS();
  await kms.initialize();
  return kms.encrypt({ data, policy, keyId: options?.keyId, metadata: options?.metadata }, options?.provider);
}
