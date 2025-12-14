/**
 * Jeju Proxy SDK
 * Client SDK for interacting with the Jeju decentralized proxy network
 * 
 * @module @jeju/proxy/sdk
 */

import { Contract, JsonRpcProvider, Wallet, parseEther, formatEther } from 'ethers';
import type {
  ProxySDKConfig,
  RegionCode,
  FetchOptions,
  FetchResult,
  RegionInfo,
  Address,
} from '../types';
import { REGION_CODES, hashRegion, SessionStatus } from '../types';

const PROXY_PAYMENT_ABI = [
  'function openSession(bytes32 regionCode) payable returns (bytes32)',
  'function getSession(bytes32 sessionId) view returns (tuple(bytes32 sessionId, address client, address node, bytes32 regionCode, uint256 deposit, uint256 usedAmount, uint256 bytesServed, uint256 createdAt, uint256 closedAt, uint8 status))',
  'function cancelSession(bytes32 sessionId)',
  'function pricePerGb() view returns (uint256)',
  'function estimateCost(uint256 estimatedBytes) view returns (uint256)',
];

interface ActiveSession {
  sessionId: `0x${string}`;
  regionCode: RegionCode;
  deposit: bigint;
  bytesUsed: number;
  createdAt: number;
}

export class JejuProxySDK {
  private config: ProxySDKConfig;
  private provider: JsonRpcProvider | null = null;
  private payment: Contract | null = null;
  private activeSessions: Map<string, ActiveSession> = new Map();

  constructor(config: ProxySDKConfig) {
    this.config = config;

    if (config.rpcUrl && config.paymentAddress) {
      this.provider = new JsonRpcProvider(config.rpcUrl);
      this.payment = new Contract(config.paymentAddress, PROXY_PAYMENT_ABI, this.provider);
    }
  }

  /**
   * Fetch a URL through the Jeju proxy network
   */
  async fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const sessionId = options.sessionId || await this.getOrCreateSession(options.regionCode || 'US');

    try {
      const response = await fetch(`${this.config.coordinatorUrl}/v1/proxy/fetch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          url,
          method: options.method || 'GET',
          headers: options.headers,
          body: options.body,
          timeout: options.timeout,
        }),
      });

      const result = await response.json() as {
        success: boolean;
        data?: {
          statusCode: number;
          statusText: string;
          headers: Record<string, string>;
          body: string;
          bytesTransferred: number;
          latencyMs: number;
          nodeAddress?: Address;
        };
        error?: string;
      };

      if (!result.success || !result.data) {
        return {
          success: false,
          statusCode: 0,
          headers: {},
          body: '',
          bytesTransferred: 0,
          latencyMs: 0,
          sessionId,
          cost: 0n,
          error: result.error || 'Request failed',
        };
      }

      // Update session tracking
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.bytesUsed += result.data.bytesTransferred;
      }

      // Estimate cost
      const cost = await this.estimateCost(result.data.bytesTransferred);

      return {
        success: true,
        statusCode: result.data.statusCode,
        headers: result.data.headers,
        body: result.data.body,
        bytesTransferred: result.data.bytesTransferred,
        latencyMs: result.data.latencyMs,
        nodeAddress: result.data.nodeAddress,
        sessionId,
        cost,
      };
    } catch (err) {
      return {
        success: false,
        statusCode: 0,
        headers: {},
        body: '',
        bytesTransferred: 0,
        latencyMs: 0,
        sessionId,
        cost: 0n,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Get available regions
   */
  async getAvailableRegions(): Promise<RegionInfo[]> {
    try {
      const response = await fetch(`${this.config.coordinatorUrl}/v1/proxy/regions`);
      const result = await response.json() as { regions: RegionInfo[] };
      return result.regions;
    } catch {
      return [];
    }
  }

  /**
   * Get coordinator stats
   */
  async getStats(): Promise<{
    connectedNodes: number;
    availableRegions: string[];
    pricePerGb: string;
  }> {
    try {
      const response = await fetch(`${this.config.coordinatorUrl}/v1/proxy/stats`);
      return await response.json() as {
        connectedNodes: number;
        availableRegions: string[];
        pricePerGb: string;
      };
    } catch {
      return {
        connectedNodes: 0,
        availableRegions: [],
        pricePerGb: '0',
      };
    }
  }

  /**
   * Get session details
   */
  async getSession(sessionId: `0x${string}`): Promise<{
    sessionId: string;
    client: string;
    node: string;
    deposit: string;
    usedAmount: string;
    bytesServed: number;
    status: string;
    createdAt: number;
  } | null> {
    try {
      const response = await fetch(`${this.config.coordinatorUrl}/v1/proxy/sessions/${sessionId}`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Open a new proxy session on-chain
   * Requires a signer to be configured
   */
  async openSession(
    regionCode: RegionCode,
    depositEth: string,
    signer: Wallet
  ): Promise<`0x${string}`> {
    if (!this.payment) {
      throw new Error('Payment contract not configured');
    }

    const paymentWithSigner = this.payment.connect(signer);
    const regionHash = hashRegion(regionCode);
    const deposit = parseEther(depositEth);

    const tx = await paymentWithSigner.openSession(regionHash, { value: deposit });
    const receipt = await tx.wait();

    // Parse session ID from logs
    // For now, return a mock ID - in production, parse from receipt.logs
    const sessionId = receipt.logs[0]?.topics[1] as `0x${string}` || '0x0' as `0x${string}`;

    this.activeSessions.set(sessionId, {
      sessionId,
      regionCode,
      deposit,
      bytesUsed: 0,
      createdAt: Date.now(),
    });

    return sessionId;
  }

  /**
   * Cancel a pending session and get refund
   */
  async cancelSession(sessionId: `0x${string}`, signer: Wallet): Promise<void> {
    if (!this.payment) {
      throw new Error('Payment contract not configured');
    }

    const paymentWithSigner = this.payment.connect(signer);
    const tx = await paymentWithSigner.cancelSession(sessionId);
    await tx.wait();

    this.activeSessions.delete(sessionId);
  }

  /**
   * Estimate cost for bytes
   */
  async estimateCost(bytes: number): Promise<bigint> {
    if (!this.payment) {
      // Fallback: ~0.001 ETH per GB
      return (BigInt(bytes) * parseEther('0.001')) / BigInt(1e9);
    }

    return await this.payment.estimateCost(bytes);
  }

  /**
   * Get price per GB
   */
  async getPricePerGb(): Promise<bigint> {
    if (!this.payment) {
      return parseEther('0.001');
    }
    return await this.payment.pricePerGb();
  }

  /**
   * Get or create a session for a region
   */
  private async getOrCreateSession(regionCode: RegionCode): Promise<`0x${string}`> {
    // Check for existing active session
    for (const [id, session] of this.activeSessions) {
      if (session.regionCode === regionCode) {
        return session.sessionId;
      }
    }

    // If we have a signer, create a new session on-chain
    if (this.config.signer && this.payment) {
      const signer = new Wallet(this.config.signer.address); // Would need private key
      return this.openSession(regionCode, '0.01', signer);
    }

    // Return a placeholder - coordinator will handle payment
    const mockSessionId = ('0x' + crypto.randomUUID().replace(/-/g, '')) as `0x${string}`;
    this.activeSessions.set(mockSessionId, {
      sessionId: mockSessionId,
      regionCode,
      deposit: 0n,
      bytesUsed: 0,
      createdAt: Date.now(),
    });

    return mockSessionId;
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): ActiveSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Clear a session from local tracking
   */
  clearSession(sessionId: `0x${string}`): void {
    this.activeSessions.delete(sessionId);
  }
}

/**
 * Create SDK from environment
 */
export function createProxySDK(overrides?: Partial<ProxySDKConfig>): JejuProxySDK {
  return new JejuProxySDK({
    coordinatorUrl: process.env.PROXY_COORDINATOR_URL || 'http://localhost:4020',
    rpcUrl: process.env.JEJU_RPC_URL,
    paymentAddress: process.env.PROXY_PAYMENT_ADDRESS as Address | undefined,
    ...overrides,
  });
}

