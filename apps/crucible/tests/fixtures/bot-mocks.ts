/**
 * Bot Test Fixtures
 *
 * Provides properly typed mock factories for bot tests.
 */

import { mock } from 'bun:test'
import type { Address } from 'viem'
import type { AgentSDK } from '../../api/sdk/agent'
import type { AgentCharacter } from '../../lib/types'

/**
 * Return type from AgentSDK.registerAgent
 */
export interface AgentRegistrationResult {
  agentId: bigint
  vaultAddress: Address
  characterCid: string
  stateCid: string
}

/**
 * Minimal interface for testing code that only needs registerAgent.
 * Use this instead of mocking the full AgentSDK class.
 */
export interface AgentSDKRegisterOnly {
  registerAgent: AgentSDK['registerAgent']
}

/**
 * Creates a mock AgentSDK that only implements registerAgent.
 * The mock returns predictable values for testing.
 */
export function createMockAgentSDK(
  overrides?: Partial<{
    registerAgent: AgentSDK['registerAgent']
  }>,
): AgentSDKRegisterOnly {
  const defaultRegisterAgent = mock(
    (
      _character: AgentCharacter,
      _options?: {
        initialFunding?: bigint
        botType?: 'ai_agent' | 'trading_bot' | 'org_tool'
      },
    ) =>
      Promise.resolve<AgentRegistrationResult>({
        agentId: 1n,
        vaultAddress: '0x1111111111111111111111111111111111111111' as Address,
        characterCid: 'QmTestCharacter',
        stateCid: 'QmTestState',
      }),
  )

  return {
    registerAgent: overrides?.registerAgent ?? defaultRegisterAgent,
  }
}

/**
 * Creates a mock AgentSDK that fails on registerAgent.
 * Useful for testing error handling.
 */
export function createFailingMockAgentSDK(
  errorMessage = 'Registration failed',
): AgentSDKRegisterOnly {
  return {
    registerAgent: mock(() => Promise.reject(new Error(errorMessage))),
  }
}

/**
 * Creates a mock AgentSDK with sequential agent IDs.
 * Each call to registerAgent returns an incrementing agentId.
 */
export function createSequentialMockAgentSDK(): AgentSDKRegisterOnly {
  let nextAgentId = 1n

  return {
    registerAgent: mock(
      (
        _character: AgentCharacter,
        _options?: {
          initialFunding?: bigint
          botType?: 'ai_agent' | 'trading_bot' | 'org_tool'
        },
      ) =>
        Promise.resolve<AgentRegistrationResult>({
          agentId: nextAgentId++,
          vaultAddress: `0x${'1'.repeat(40)}` as Address,
          characterCid: 'QmTestCharacter',
          stateCid: 'QmTestState',
        }),
    ),
  }
}

/**
 * Test chain IDs that are known to not be in DEFAULT_CHAINS.
 * These are valid positive integers (satisfying ChainId schema) but not configured.
 */
export const TEST_CHAIN_IDS = {
  /** A valid but unconfigured chain ID for testing missing chain handling */
  UNCONFIGURED: 999999,
  /** Another unconfigured chain for variety */
  UNCONFIGURED_2: 888888,
} as const

/**
 * Creates a mock KMS signer for testing.
 * The mock returns predictable values and is marked as initialized.
 */
export function createMockKMSSigner(initialized = true): {
  isInitialized: () => boolean
  getAddress: () => Promise<Address>
  signTransaction: () => Promise<`0x${string}`>
  signMessage: () => Promise<`0x${string}`>
} {
  const address = '0x1234567890123456789012345678901234567890' as Address
  return {
    isInitialized: () => initialized,
    getAddress: async () => address,
    signTransaction: async () => '0x1234' as `0x${string}`,
    signMessage: async () => '0x5678' as `0x${string}`,
  }
}
