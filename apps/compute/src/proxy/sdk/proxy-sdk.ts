/**
 * Jeju Proxy SDK
 * Client SDK for interacting with the Jeju decentralized proxy network
 * 
 * MODES:
 * - On-chain: Sessions are created on ProxyPayment contract with deposits
 * - Coordinator-only: Session management delegated to coordinator (testing/development)
 * 
 * @module @jeju/proxy/sdk
 */

import { Contract, JsonRpcProvider, Wallet, parseEther, formatEther, Interface } from 'ethers';
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
  'event SessionOpened(bytes32 indexed sessionId, address indexed client, bytes32 regionCode, uint256 deposit)',
];

const paymentInterface = new Interface(PROXY_PAYMENT_ABI);

interface ActiveSession {
  sessionId: `0x${string}`;
  regionCode: RegionCode;
  deposit: bigint;
  bytesUsed: number;
  createdAt: number;
  isOnChain: boolean;
}

type SDKMode = 'on-chain' | 'coordinator-only';

export class JejuProxySDK {
  private config: ProxySDKConfig;
  private provider: JsonRpcProvider | null = null;
  private payment: Contract | null = null;
  private activeSessions: Map<string, ActiveSession> = new Map();
  private mode: SDKMode;

  constructor(config: ProxySDKConfig) {
    this.config = config;

    if (config.rpcUrl && config.paymentAddress) {
      this.provider = new JsonRpcProvider(config.rpcUrl);
      this.payment = new Contract(config.paymentAddress, PROXY_PAYMENT_ABI, this.provider);
      this.mode = 'on-chain';
    } else {
      this.mode = 'coordinator-only';
      console.warn('[JejuProxy] No RPC/payment configured - running in coordinator-only mode');
    }
  }

  /** Get current SDK mode */
  getMode(): SDKMode {
    return this.mode;
  }

  /**
   * Fetch a URL through the Jeju proxy network
   */
  async fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const regionCode = options.regionCode || 'US';
    
    // Require explicit session for on-chain mode
    if (this.mode === 'on-chain' && !options.sessionId) {
      throw new Error(
        'On-chain mode requires a sessionId. Call openSession() first, or pass sessionId in options.'
      );
    }

    // For coordinator-only mode, create a session via coordinator API
    const sessionId = options.sessionId || await this.createCoordinatorSession(regionCode);

    try {
      const response = await fetch(`${this.config.coordinatorUrl}/v1/proxy/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
   * Create a coordinator-managed session (for testing/development)
   * This does NOT create an on-chain session
   */
  private async createCoordinatorSession(regionCode: RegionCode): Promise<`0x${string}`> {
    try {
      const response = await fetch(`${this.config.coordinatorUrl}/v1/proxy/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regionCode }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create coordinator session: ${response.status}`);
      }
      
      const result = await response.json() as { sessionId: string };
      const sessionId = result.sessionId as `0x${string}`;
      
      this.activeSessions.set(sessionId, {
        sessionId,
        regionCode,
        deposit: 0n,
        bytesUsed: 0,
        createdAt: Date.now(),
        isOnChain: false,
      });
      
      return sessionId;
    } catch (err) {
      throw new Error(`Coordinator session creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Get available regions
   */
  async getAvailableRegions(): Promise<RegionInfo[]> {
    const response = await fetch(`${this.config.coordinatorUrl}/v1/proxy/regions`);
    if (!response.ok) {
      throw new Error(`Failed to fetch regions: ${response.status}`);
    }
    const result = await response.json() as { regions: RegionInfo[] };
    return result.regions;
  }

  /**
   * Get coordinator stats
   */
  async getStats(): Promise<{
    connectedNodes: number;
    availableRegions: string[];
    pricePerGb: string;
  }> {
    const response = await fetch(`${this.config.coordinatorUrl}/v1/proxy/stats`);
    if (!response.ok) {
      throw new Error(`Failed to fetch stats: ${response.status}`);
    }
    return await response.json() as {
      connectedNodes: number;
      availableRegions: string[];
      pricePerGb: string;
    };
  }

  /**
   * Get session details from coordinator
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
      // Connection failed or session not found
      return null;
    }
  }

  /**
   * Open a new proxy session on-chain
   * @param regionCode Region for proxy routing
   * @param depositEth Amount of ETH to deposit
   * @param signer Wallet to sign the transaction
   * @returns sessionId from the blockchain
   */
  async openSession(
    regionCode: RegionCode,
    depositEth: string,
    signer: Wallet
  ): Promise<`0x${string}`> {
    if (!this.payment) {
      throw new Error('Payment contract not configured. Set rpcUrl and paymentAddress in config.');
    }

    const connectedSigner = signer.connect(this.provider!);
    const paymentWithSigner = this.payment.connect(connectedSigner);
    const regionHash = hashRegion(regionCode);
    const deposit = parseEther(depositEth);

    console.log(`[JejuProxy] Opening session for region ${regionCode}, deposit ${depositEth} ETH`);
    
    const tx = await paymentWithSigner.openSession(regionHash, { value: deposit });
    const receipt = await tx.wait();
    
    if (!receipt) {
      throw new Error('Transaction failed - no receipt');
    }

    // Parse SessionOpened event from logs
    const sessionId = this.parseSessionOpenedEvent(receipt.logs);
    if (!sessionId) {
      throw new Error(
        `Failed to parse SessionOpened event from transaction ${receipt.hash}. ` +
        `Logs: ${JSON.stringify(receipt.logs.map((l: { topics: string[] }) => l.topics))}`
      );
    }

    console.log(`[JejuProxy] Session opened: ${sessionId}`);

    this.activeSessions.set(sessionId, {
      sessionId,
      regionCode,
      deposit,
      bytesUsed: 0,
      createdAt: Date.now(),
      isOnChain: true,
    });

    return sessionId;
  }

  /**
   * Parse SessionOpened event from transaction logs
   */
  private parseSessionOpenedEvent(logs: Array<{ topics: string[]; data: string }>): `0x${string}` | null {
    const eventSignature = paymentInterface.getEvent('SessionOpened')!.topicHash;
    
    for (const log of logs) {
      if (log.topics[0] === eventSignature) {
        // SessionOpened has indexed sessionId as first topic after signature
        const sessionId = log.topics[1];
        if (sessionId && sessionId.length === 66) { // 0x + 64 hex chars
          return sessionId as `0x${string}`;
        }
      }
    }
    
    return null;
  }

  /**
   * Cancel a pending session and get refund
   */
  async cancelSession(sessionId: `0x${string}`, signer: Wallet): Promise<void> {
    if (!this.payment) {
      throw new Error('Payment contract not configured');
    }

    const session = this.activeSessions.get(sessionId);
    if (session && !session.isOnChain) {
      // Just remove from local tracking for coordinator sessions
      this.activeSessions.delete(sessionId);
      return;
    }

    const connectedSigner = signer.connect(this.provider!);
    const paymentWithSigner = this.payment.connect(connectedSigner);
    
    console.log(`[JejuProxy] Cancelling session: ${sessionId}`);
    const tx = await paymentWithSigner.cancelSession(sessionId);
    await tx.wait();
    
    console.log(`[JejuProxy] Session cancelled`);
    this.activeSessions.delete(sessionId);
  }

  /**
   * Estimate cost for bytes
   */
  async estimateCost(bytes: number): Promise<bigint> {
    if (!this.payment) {
      // Fallback: ~0.001 ETH per GB (1e9 bytes)
      // This is explicit fallback pricing, not production pricing
      return (BigInt(bytes) * parseEther('0.001')) / BigInt(1e9);
    }

    return await this.payment.estimateCost(bytes);
  }

  /**
   * Get price per GB from contract or fallback
   */
  async getPricePerGb(): Promise<bigint> {
    if (!this.payment) {
      // Explicit fallback - document this is not real pricing
      return parseEther('0.001'); // 0.001 ETH per GB
    }
    return await this.payment.pricePerGb();
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
  
  /**
   * Check if SDK is configured for on-chain mode
   */
  isOnChainEnabled(): boolean {
    return this.payment !== null;
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
