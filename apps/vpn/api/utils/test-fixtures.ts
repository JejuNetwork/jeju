/** Test fixtures with properly typed values for VPN tests */

import type { Address } from 'viem'
import { getAddress } from 'viem'
import type {
  ContributionState,
  VPNNodeState,
  VPNSessionState,
} from '../schemas'
import type { VPNServiceContext } from '../types'

/**
 * Convert an address to a different case variation for testing case-insensitive comparison.
 * Uses getAddress to convert to proper checksummed format first, which differs from
 * the original constant case in TEST_ADDRESSES.
 */
export function toAlternateCaseAddress(addr: Address): Address {
  // getAddress returns a checksummed address which has mixed case
  // This is different from our test constants, so it tests case-insensitive comparison
  return getAddress(addr.toLowerCase())
}

// Pre-validated test addresses (these are valid checksummed addresses)
export const TEST_ADDRESSES = {
  user1:
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const satisfies Address,
  user2:
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const satisfies Address,
  operator1:
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const satisfies Address,
  operator2:
    '0xabcdef1234567890abcdef1234567890abcdef12' as const satisfies Address,
  registry:
    '0x1234567890123456789012345678901234567890' as const satisfies Address,
  billing:
    '0x2234567890123456789012345678901234567890' as const satisfies Address,
  facilitator:
    '0x3234567890123456789012345678901234567890' as const satisfies Address,
  paymentRecipient:
    '0x4234567890123456789012345678901234567890' as const satisfies Address,
  token:
    '0x5234567890123456789012345678901234567890' as const satisfies Address,
} as const

/**
 * Create a test VPN node with proper types
 */
export function createTestNode(
  overrides: Partial<VPNNodeState> = {},
): VPNNodeState {
  return {
    nodeId: 'node-1',
    operator: TEST_ADDRESSES.operator1,
    countryCode: 'US',
    region: 'us-east-1',
    endpoint: 'vpn1.jeju.network:51820',
    wireguardPubKey: 'abc123pubkey',
    status: 'online',
    activeConnections: 5,
    maxConnections: 100,
    latencyMs: 25,
    ...overrides,
  }
}

/**
 * Create a test VPN service context with proper types
 */
export function createTestContext(
  nodes: VPNNodeState[] = [],
): VPNServiceContext {
  const ctx: VPNServiceContext = {
    config: {
      publicUrl: 'https://vpn.jeju.network',
      port: 3000,
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      coordinatorUrl: 'https://coordinator.jeju.network',
      contracts: {
        vpnRegistry: TEST_ADDRESSES.registry,
        vpnBilling: TEST_ADDRESSES.billing,
        x402Facilitator: TEST_ADDRESSES.facilitator,
      },
      paymentRecipient: TEST_ADDRESSES.paymentRecipient,
      pricing: {
        pricePerGB: '1000000000000000',
        pricePerHour: '100000000000000',
        pricePerRequest: '10000000000000',
        supportedTokens: [TEST_ADDRESSES.token],
      },
    },
    nodes: new Map(),
    sessions: new Map(),
    contributions: new Map(),
  }
  for (const node of nodes) {
    ctx.nodes.set(node.nodeId, node)
  }
  return ctx
}

/**
 * Create a test VPN session with proper types
 */
export function createTestSession(
  overrides: Partial<VPNSessionState> = {},
): VPNSessionState {
  return {
    sessionId: 'sess-test-123',
    clientAddress: TEST_ADDRESSES.user1,
    nodeId: 'node-1',
    protocol: 'wireguard',
    startTime: Date.now(),
    bytesUp: BigInt(0),
    bytesDown: BigInt(0),
    isPaid: false,
    paymentAmount: BigInt(0),
    ...overrides,
  }
}

/**
 * Create a test contribution state with proper types
 */
export function createTestContribution(
  overrides: Partial<ContributionState> = {},
): ContributionState {
  const now = Date.now()
  return {
    address: TEST_ADDRESSES.user1,
    bytesUsed: BigInt(0),
    bytesContributed: BigInt(0),
    cap: BigInt(0),
    periodStart: now,
    periodEnd: now + 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  }
}
