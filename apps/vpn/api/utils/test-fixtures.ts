/** Test fixtures for VPN API utility tests */

import type { Address } from 'viem'
import type {
  ContributionState,
  VPNNodeState,
  VPNSessionState,
} from '../schemas'
import type { VPNServiceContext } from '../types'

/** Convert address to alternating case for case-sensitivity testing */
export function toAlternateCaseAddress(address: Address): Address {
  const chars = address.split('')
  return chars
    .map((char, i) => (i % 2 === 0 ? char.toUpperCase() : char.toLowerCase()))
    .join('') as Address
}

/** Test addresses */
export const TEST_ADDRESSES = {
  user1: '0x1111111111111111111111111111111111111111' as Address,
  user2: '0x2222222222222222222222222222222222222222' as Address,
  node1: '0x3333333333333333333333333333333333333333' as Address,
  node2: '0x4444444444444444444444444444444444444444' as Address,
  payment: '0x5555555555555555555555555555555555555555' as Address,
  token: '0x6666666666666666666666666666666666666666' as Address,
  vpnRegistry: '0x7777777777777777777777777777777777777777' as Address,
  vpnBilling: '0x8888888888888888888888888888888888888888' as Address,
  x402Facilitator: '0x9999999999999999999999999999999999999999' as Address,
}

/** Create a test contribution state with optional overrides */
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

/** Create a test session state with optional overrides */
export function createTestSession(
  overrides: Partial<VPNSessionState> = {},
): VPNSessionState {
  return {
    sessionId: `session-${crypto.randomUUID()}`,
    clientAddress: TEST_ADDRESSES.user1,
    nodeId: `node-${crypto.randomUUID()}`,
    protocol: 'wireguard',
    startTime: Date.now(),
    bytesUp: BigInt(0),
    bytesDown: BigInt(0),
    isPaid: false,
    paymentAmount: BigInt(0),
    ...overrides,
  }
}

/** Create a test VPN node state with optional overrides */
export function createTestNode(
  overrides: Partial<VPNNodeState> = {},
): VPNNodeState {
  return {
    nodeId: 'node-1', // Default to 'node-1' for tests that expect this
    operator: TEST_ADDRESSES.node1,
    countryCode: 'US',
    region: 'us-east-1',
    endpoint: '1.2.3.4:51820',
    wireguardPubKey: 'dGVzdC1wdWJsaWMta2V5LWZvci10ZXN0aW5n',
    status: 'online',
    activeConnections: 0,
    maxConnections: 100,
    latencyMs: 25,
    ...overrides,
  }
}

/** Create a test service context with optional nodes array or overrides */
export function createTestContext(
  nodesOrOverrides: VPNNodeState[] | Partial<VPNServiceContext> = {},
): VPNServiceContext {
  // Handle nodes array input
  let nodesMap: Map<string, VPNNodeState> = new Map()
  let overrides: Partial<VPNServiceContext> = {}

  if (Array.isArray(nodesOrOverrides)) {
    for (const node of nodesOrOverrides) {
      nodesMap.set(node.nodeId, node)
    }
  } else {
    overrides = nodesOrOverrides
    nodesMap = overrides.nodes ?? new Map()
  }

  return {
    config: {
      publicUrl: 'http://localhost:4021',
      port: 4021,
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
      coordinatorUrl: 'https://vpn-coordinator.jejunetwork.org',
      contracts: {
        vpnRegistry: TEST_ADDRESSES.vpnRegistry,
        vpnBilling: TEST_ADDRESSES.vpnBilling,
        x402Facilitator: TEST_ADDRESSES.x402Facilitator,
      },
      paymentRecipient: TEST_ADDRESSES.payment,
      pricing: {
        pricePerGB: '1000000000000000',
        pricePerHour: '100000000000000',
        pricePerRequest: '10000000000000',
        supportedTokens: [TEST_ADDRESSES.token],
      },
    },
    nodes: nodesMap,
    sessions: new Map(),
    contributions: new Map(),
    ...overrides,
  }
}
