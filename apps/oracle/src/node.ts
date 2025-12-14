import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  keccak256,
  encodePacked,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  FEED_REGISTRY_ABI,
  REPORT_VERIFIER_ABI,
  COMMITTEE_MANAGER_ABI,
  NETWORK_CONNECTOR_ABI,
} from './abis';
import { PriceFetcher, type PriceData } from './price-fetcher';
import type { OracleNodeConfig, PriceReport, NodeMetrics } from './types';

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

export class OracleNode {
  private config: OracleNodeConfig;
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private priceFetcher: PriceFetcher;
  private operatorId: Hex | null = null;
  private running = false;
  private pollInterval?: Timer;
  private heartbeatInterval?: Timer;
  private metrics: NodeMetrics;
  private startTime: number;

  constructor(config: OracleNodeConfig) {
    this.config = config;
    this.startTime = Date.now();

    const account = privateKeyToAccount(config.workerPrivateKey);

    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account,
      transport: http(config.rpcUrl),
    });

    this.priceFetcher = new PriceFetcher(config.rpcUrl, config.priceSources);

    this.metrics = {
      reportsSubmitted: 0,
      reportsAccepted: 0,
      reportsRejected: 0,
      lastReportTime: 0,
      lastHeartbeat: 0,
      feedPrices: new Map(),
      uptime: 0,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;

    console.log('[OracleNode] Starting...');

    // Check if operator is registered
    await this.ensureRegistered();

    this.running = true;

    // Start price polling
    await this.pollAndSubmit();
    this.pollInterval = setInterval(
      () => this.pollAndSubmit(),
      this.config.pollIntervalMs
    );

    // Start heartbeat
    this.heartbeatInterval = setInterval(
      () => this.sendHeartbeat(),
      this.config.heartbeatIntervalMs
    );

    console.log('[OracleNode] Started successfully');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pollInterval && clearInterval(this.pollInterval);
    this.heartbeatInterval && clearInterval(this.heartbeatInterval);
    console.log('[OracleNode] Stopped');
  }

  private async ensureRegistered(): Promise<void> {
    const workerAddress = this.walletClient.account!.address;

    const existingOperatorId = await this.publicClient.readContract({
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'workerToOperator',
      args: [workerAddress],
    });

    if (existingOperatorId !== ZERO_BYTES32) {
      this.operatorId = existingOperatorId;
      console.log(`[OracleNode] Registered as operator: ${this.operatorId}`);
      return;
    }

    console.log('[OracleNode] Registering new operator...');
    const operatorAccount = privateKeyToAccount(this.config.operatorPrivateKey);
    const operatorClient = createWalletClient({
      account: operatorAccount,
      transport: http(this.config.rpcUrl),
    });

    const hash = await operatorClient.writeContract({
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'registerOperator',
      args: [ZERO_BYTES32, 0n, workerAddress],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    this.operatorId = await this.publicClient.readContract({
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'workerToOperator',
      args: [workerAddress],
    });
    console.log(`[OracleNode] Operator ID: ${this.operatorId}`);
  }

  private async pollAndSubmit(): Promise<void> {
    if (!this.running) return;

    console.log('[OracleNode] Polling prices...');

    // Get active feeds
    const feedIds = await this.publicClient.readContract({
      address: this.config.feedRegistry,
      abi: FEED_REGISTRY_ABI,
      functionName: 'getActiveFeeds',
    });

    // Fetch prices for all feeds we have sources for
    const prices = await this.priceFetcher.fetchAllPrices();

    // Submit reports for each feed
    for (const feedId of feedIds) {
      const priceData = prices.get(feedId as Hex);
      if (!priceData) continue;

      // Check if we're a committee member for this feed
      const isMember = await this.isCommitteeMember(feedId as Hex);
      if (!isMember) {
        console.log(`[OracleNode] Not a committee member for ${feedId}, skipping`);
        continue;
      }

      await this.submitReport(feedId as Hex, priceData);
    }
  }

  private async isCommitteeMember(feedId: Hex): Promise<boolean> {
    const workerAddress = this.walletClient.account!.address;

    return this.publicClient.readContract({
      address: this.config.committeeManager,
      abi: COMMITTEE_MANAGER_ABI,
      functionName: 'isCommitteeMember',
      args: [feedId, workerAddress],
    });
  }

  private async submitReport(feedId: Hex, priceData: PriceData): Promise<void> {
    // Get current round
    const currentRound = await this.publicClient.readContract({
      address: this.config.reportVerifier,
      abi: REPORT_VERIFIER_ABI,
      functionName: 'getCurrentRound',
      args: [feedId],
    });

    const newRound = currentRound + 1n;

    // Build report
    const report: PriceReport = {
      feedId,
      price: priceData.price,
      confidence: priceData.confidence,
      timestamp: priceData.timestamp,
      round: newRound,
      sourcesHash: this.priceFetcher.computeSourcesHash([priceData.source]),
    };

    // Sign the report
    const reportHash = this.computeReportHash(report);
    const signature = await this.signReport(reportHash);

    // Submit
    console.log(`[OracleNode] Submitting report for ${feedId}: price=${report.price}, round=${report.round}`);

    this.metrics.reportsSubmitted++;

    const hash = await this.walletClient.writeContract({
      address: this.config.reportVerifier,
      abi: REPORT_VERIFIER_ABI,
      functionName: 'submitReport',
      args: [
        {
          report: {
            feedId: report.feedId,
            price: report.price,
            confidence: report.confidence,
            timestamp: report.timestamp,
            round: report.round,
            sourcesHash: report.sourcesHash,
          },
          signatures: [signature],
        },
      ],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      console.log(`[OracleNode] Report accepted for ${feedId}`);
      this.metrics.reportsAccepted++;
      this.metrics.lastReportTime = Date.now();
      this.metrics.feedPrices.set(feedId, priceData.price);
    } else {
      console.log(`[OracleNode] Report rejected for ${feedId}`);
      this.metrics.reportsRejected++;
    }
  }

  private computeReportHash(report: PriceReport): Hex {
    return keccak256(
      encodePacked(
        ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
        [
          report.feedId,
          report.price,
          report.confidence,
          report.timestamp,
          report.round,
          report.sourcesHash,
        ]
      )
    );
  }

  private async signReport(reportHash: Hex): Promise<Hex> {
    return this.walletClient.signMessage({ message: { raw: toBytes(reportHash) } });
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.running || !this.operatorId) return;

    console.log('[OracleNode] Sending heartbeat...');

    const hash = await this.walletClient.writeContract({
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'recordHeartbeat',
      args: [this.operatorId],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    this.metrics.lastHeartbeat = Date.now();
    console.log('[OracleNode] Heartbeat sent');
  }

  getMetrics(): NodeMetrics {
    this.metrics.uptime = Date.now() - this.startTime;
    return { ...this.metrics };
  }

  getOperatorId(): Hex | null {
    return this.operatorId;
  }
}

// Default config from environment
export function createNodeConfig(): OracleNodeConfig {
  const zeroAddress = '0x0000000000000000000000000000000000000000' as Address;

  return {
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    chainId: parseInt(process.env.CHAIN_ID || '1337'),
    operatorPrivateKey: (process.env.OPERATOR_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex,
    workerPrivateKey: (process.env.WORKER_PRIVATE_KEY || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') as Hex,

    feedRegistry: (process.env.FEED_REGISTRY_ADDRESS || zeroAddress) as Address,
    reportVerifier: (process.env.REPORT_VERIFIER_ADDRESS || zeroAddress) as Address,
    committeeManager: (process.env.COMMITTEE_MANAGER_ADDRESS || zeroAddress) as Address,
    feeRouter: (process.env.FEE_ROUTER_ADDRESS || zeroAddress) as Address,
    networkConnector: (process.env.NETWORK_CONNECTOR_ADDRESS || zeroAddress) as Address,

    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '60000'),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '300000'),
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),

    priceSources: [],
  };
}

// CLI entrypoint
if (import.meta.main) {
  const config = createNodeConfig();
  const node = new OracleNode(config);

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await node.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await node.stop();
    process.exit(0);
  });

  node.start().catch((err) => {
    console.error('Failed to start node:', err);
    process.exit(1);
  });
}

