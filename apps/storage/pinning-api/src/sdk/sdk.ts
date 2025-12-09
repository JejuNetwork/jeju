/**
 * Jeju Storage SDK
 *
 * Client library for interacting with the decentralized storage marketplace:
 * - JejuStorageSDK: Upload, pin, and retrieve files with on-chain settlement
 * - Multi-provider support: IPFS, Cloud, Arweave
 * - Automatic best provider selection via StorageRouter
 * - ERC-4337 multi-token payments
 * - x402 micropayment integration
 */

import {
  Contract,
  type ContractTransactionResponse,
  formatEther,
  JsonRpcProvider,
  parseEther,
  Wallet,
  keccak256,
  toUtf8Bytes,
} from 'ethers';
import type {
  AuthHeaders,
  CreateStorageDealParams,
  ProviderRecord,
  StorageDeal,
  StorageDealStatus,
  StorageLedger,
  StorageProvider,
  StorageProviderInfo,
  StorageQuote,
  StorageSDKConfig,
  StorageStats,
  StorageTier,
  UploadParams,
  UploadResult,
  UserRecord,
  PinStatus,
  ProviderSubAccount,
} from './types';
import {
  StoragePaymentClient,
  createStoragePaymentClient,
  type PaymentResult,
  type CreditBalance,
  type PaymasterOption,
  ZERO_ADDRESS,
} from './payment';
import {
  StorageRouter,
  createStorageRouter,
  createBackendForProvider,
} from './router';
import type { Address } from 'viem';

// ============================================================================
// Contract ABIs
// ============================================================================

const REGISTRY_ABI = [
  // Registration
  'function register(string name, string endpoint, uint8 providerType, bytes32 attestationHash) payable',
  'function registerWithAgent(string name, string endpoint, uint8 providerType, bytes32 attestationHash, uint256 agentId) payable',
  // Updates
  'function updateEndpoint(string endpoint)',
  'function updateCapacity(uint256 totalCapacityGB, uint256 usedCapacityGB)',
  'function updatePricing(uint256 pricePerGBMonth, uint256 retrievalPricePerGB, uint256 uploadPricePerGB)',
  'function deactivate()',
  'function reactivate()',
  // ERC-8004 Agent Linking
  'function linkAgent(uint256 agentId)',
  'function hasValidAgent(address provider) view returns (bool)',
  'function getAgentLinkedProviders() view returns (address[])',
  // Staking
  'function addStake() payable',
  'function withdrawStake(uint256 amount)',
  // View functions
  'function getProvider(address provider) view returns (tuple(address owner, string name, string endpoint, uint8 providerType, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active, bool verified))',
  'function getProviderInfo(address provider) view returns (tuple(tuple(address owner, string name, string endpoint, uint8 providerType, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active, bool verified) provider, tuple(uint256 totalCapacityGB, uint256 usedCapacityGB, uint256 availableCapacityGB, uint256 reservedCapacityGB) capacity, tuple(uint256 pricePerGBMonth, uint256 minStoragePeriodDays, uint256 maxStoragePeriodDays, uint256 retrievalPricePerGB, uint256 uploadPricePerGB) pricing, uint8[] supportedTiers, uint256 replicationFactor, string ipfsGateway, uint256 healthScore, uint256 avgLatencyMs))',
  'function isActive(address provider) view returns (bool)',
  'function getActiveProviders() view returns (address[])',
  'function getProviderStake(address provider) view returns (uint256)',
  'function getProviderCount() view returns (uint256)',
  'function getProviderByAgent(uint256 agentId) view returns (address)',
  'function minProviderStake() view returns (uint256)',
];

const LEDGER_ABI = [
  'function createLedger() payable',
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  'function transferToProvider(address provider, uint256 amount)',
  'function requestRefund(address provider, uint256 amount)',
  'function acknowledgeUser(address user)',
  'function getLedger(address user) view returns (tuple(uint256 totalBalance, uint256 availableBalance, uint256 lockedBalance, uint256 createdAt))',
  'function getSubAccount(address user, address provider) view returns (tuple(uint256 balance, uint256 pendingRefund, uint256 refundUnlockTime, bool acknowledged))',
  'function getAvailableBalance(address user) view returns (uint256)',
  'function ledgerExists(address user) view returns (bool)',
];

const MARKET_ABI = [
  // Deal creation
  'function createDeal(address provider, string cid, uint256 sizeBytes, uint256 durationDays, uint8 tier, uint256 replicationFactor) payable returns (bytes32)',
  'function extendDeal(bytes32 dealId, uint256 additionalDays) payable',
  'function terminateDeal(bytes32 dealId)',
  // Provider actions
  'function confirmDeal(bytes32 dealId)',
  'function completeDeal(bytes32 dealId)',
  'function failDeal(bytes32 dealId, string reason)',
  // View functions
  'function getDeal(bytes32 dealId) view returns (tuple(bytes32 dealId, address user, address provider, uint8 status, string cid, uint256 sizeBytes, uint8 tier, uint256 startTime, uint256 endTime, uint256 totalCost, uint256 paidAmount, uint256 refundedAmount, uint256 replicationFactor, uint256 retrievalCount))',
  'function getUserDeals(address user) view returns (bytes32[])',
  'function getProviderDeals(address provider) view returns (bytes32[])',
  'function calculateDealCost(address provider, uint256 sizeBytes, uint256 durationDays, uint8 tier) view returns (uint256)',
  'function getQuote(address provider, uint256 sizeBytes, uint256 durationDays, uint8 tier) view returns (tuple(address provider, uint256 sizeBytes, uint256 durationDays, uint8 tier, uint256 cost, tuple(uint256 storage, uint256 bandwidth, uint256 retrieval) costBreakdown, uint256 expiresAt))',
  'function isDealActive(bytes32 dealId) view returns (bool)',
  // Reputation
  'function getUserRecord(address user) view returns (tuple(uint256 totalDeals, uint256 activeDeals, uint256 completedDeals, uint256 disputedDeals, uint256 totalStoredGB, uint256 totalSpent, bool banned))',
  'function getProviderRecord(address provider) view returns (tuple(uint256 totalDeals, uint256 activeDeals, uint256 completedDeals, uint256 failedDeals, uint256 totalStoredGB, uint256 totalEarnings, uint256 avgRating, uint256 ratingCount, uint256 uptimePercent, bool banned))',
  'function rateDeal(bytes32 dealId, uint8 score, string comment)',
];

// ============================================================================
// Helper Functions
// ============================================================================

async function callContract<T>(
  contract: Contract,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const fn = contract.getFunction(method);
  return fn(...args) as Promise<T>;
}

async function sendContract(
  contract: Contract,
  method: string,
  ...args: unknown[]
): Promise<ContractTransactionResponse> {
  const fn = contract.getFunction(method);
  return fn(...args) as Promise<ContractTransactionResponse>;
}

// ============================================================================
// Jeju Storage SDK
// ============================================================================

export class JejuStorageSDK {
  private rpcProvider: JsonRpcProvider;
  private signer: Wallet | null;
  private registry: Contract;
  private ledger: Contract;
  private market: Contract;
  private paymentClient: StoragePaymentClient | null;
  private router: StorageRouter;

  constructor(config: StorageSDKConfig) {
    this.rpcProvider = new JsonRpcProvider(config.rpcUrl);
    this.signer = config.signer ? config.signer.connect(this.rpcProvider) : null;

    const signerOrProvider = this.signer || this.rpcProvider;
    this.registry = new Contract(config.contracts.registry, REGISTRY_ABI, signerOrProvider);
    this.ledger = new Contract(config.contracts.ledger, LEDGER_ABI, signerOrProvider);
    this.market = new Contract(config.contracts.market, MARKET_ABI, signerOrProvider);

    this.paymentClient = config.contracts.creditManager
      ? createStoragePaymentClient({
          rpcUrl: config.rpcUrl,
          creditManagerAddress: config.contracts.creditManager as Address,
          paymasterFactoryAddress: (config.contracts.paymasterFactory || ZERO_ADDRESS) as Address,
          ledgerManagerAddress: config.contracts.ledger as Address,
          tokenRegistryAddress: (config.contracts.tokenRegistry || ZERO_ADDRESS) as Address,
          entryPointAddress: (config.contracts.entryPoint || '0x0000000071727De22E5E9d8BAf0edAc6f37da032') as Address,
        })
      : null;

    this.router = createStorageRouter();
  }

  // ============ Provider Registry ============

  async registerProvider(
    name: string,
    endpoint: string,
    providerType: number,
    stakeAmount: bigint,
    attestationHash: string = '0x0000000000000000000000000000000000000000000000000000000000000000'
  ): Promise<string> {
    const signer = this.requireSigner();
    const tx = await sendContract(
      this.registry,
      'register',
      name,
      endpoint,
      providerType,
      attestationHash,
      { value: stakeAmount }
    );
    await tx.wait();
    return signer.address;
  }

  async registerWithAgent(
    name: string,
    endpoint: string,
    providerType: number,
    stakeAmount: bigint,
    agentId: bigint,
    attestationHash: string = '0x0000000000000000000000000000000000000000000000000000000000000000'
  ): Promise<string> {
    const signer = this.requireSigner();
    const tx = await sendContract(
      this.registry,
      'registerWithAgent',
      name,
      endpoint,
      providerType,
      attestationHash,
      agentId,
      { value: stakeAmount }
    );
    await tx.wait();
    return signer.address;
  }

  async getProvider(address: string): Promise<StorageProvider> {
    const result = await callContract<{
      owner: string;
      name: string;
      endpoint: string;
      providerType: number;
      attestationHash: string;
      stake: bigint;
      registeredAt: bigint;
      agentId: bigint;
      active: boolean;
      verified: boolean;
    }>(this.registry, 'getProvider', address);

    return {
      address,
      name: result.name,
      endpoint: result.endpoint,
      providerType: result.providerType,
      stake: result.stake,
      registeredAt: Number(result.registeredAt),
      agentId: Number(result.agentId),
      active: result.active,
      verified: result.verified,
    };
  }

  async getProviderInfo(address: string): Promise<StorageProviderInfo> {
    const result = await callContract<{
      provider: {
        owner: string;
        name: string;
        endpoint: string;
        providerType: number;
        attestationHash: string;
        stake: bigint;
        registeredAt: bigint;
        agentId: bigint;
        active: boolean;
        verified: boolean;
      };
      capacity: {
        totalCapacityGB: bigint;
        usedCapacityGB: bigint;
        availableCapacityGB: bigint;
        reservedCapacityGB: bigint;
      };
      pricing: {
        pricePerGBMonth: bigint;
        minStoragePeriodDays: bigint;
        maxStoragePeriodDays: bigint;
        retrievalPricePerGB: bigint;
        uploadPricePerGB: bigint;
      };
      supportedTiers: number[];
      replicationFactor: bigint;
      ipfsGateway: string;
      healthScore: bigint;
      avgLatencyMs: bigint;
    }>(this.registry, 'getProviderInfo', address);

    return {
      provider: {
        address,
        name: result.provider.name,
        endpoint: result.provider.endpoint,
        providerType: result.provider.providerType,
        stake: result.provider.stake,
        registeredAt: Number(result.provider.registeredAt),
        agentId: Number(result.provider.agentId),
        active: result.provider.active,
        verified: result.provider.verified,
      },
      capacity: {
        totalCapacityGB: Number(result.capacity.totalCapacityGB),
        usedCapacityGB: Number(result.capacity.usedCapacityGB),
        availableCapacityGB: Number(result.capacity.availableCapacityGB),
        reservedCapacityGB: Number(result.capacity.reservedCapacityGB),
      },
      pricing: {
        pricePerGBMonth: result.pricing.pricePerGBMonth,
        minStoragePeriodDays: Number(result.pricing.minStoragePeriodDays),
        maxStoragePeriodDays: Number(result.pricing.maxStoragePeriodDays),
        retrievalPricePerGB: result.pricing.retrievalPricePerGB,
        uploadPricePerGB: result.pricing.uploadPricePerGB,
      },
      supportedTiers: result.supportedTiers as StorageTier[],
      replicationFactor: Number(result.replicationFactor),
      ipfsGateway: result.ipfsGateway,
      healthScore: Number(result.healthScore),
      avgLatencyMs: Number(result.avgLatencyMs),
    };
  }

  async getActiveProviders(): Promise<string[]> {
    return callContract<string[]>(this.registry, 'getActiveProviders');
  }

  async discoverProviders(): Promise<StorageProviderInfo[]> {
    const addresses = await this.getActiveProviders();
    const providers = await Promise.all(addresses.map(addr => this.getProviderInfo(addr)));
    this.router.updateProviders(providers);
    return providers;
  }

  // ============ ERC-8004 Agent Integration ============

  /**
   * Link an existing provider to an ERC-8004 agent ID
   * Verifies agent ownership on-chain via IdentityRegistry
   */
  async linkAgent(agentId: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.registry, 'linkAgent', agentId);
    await tx.wait();
  }

  /**
   * Get provider address by ERC-8004 agent ID
   */
  async getProviderByAgent(agentId: bigint): Promise<string | null> {
    const address = await callContract<string>(this.registry, 'getProviderByAgent', agentId);
    return address === '0x0000000000000000000000000000000000000000' ? null : address;
  }

  /**
   * Check if a provider has a valid ERC-8004 agent linked
   */
  async hasValidAgent(provider: string): Promise<boolean> {
    return callContract<boolean>(this.registry, 'hasValidAgent', provider);
  }

  /**
   * Get all providers with ERC-8004 agents linked
   */
  async getAgentLinkedProviders(): Promise<string[]> {
    return callContract<string[]>(this.registry, 'getAgentLinkedProviders');
  }

  /**
   * Discover only providers with verified ERC-8004 agent identities
   */
  async discoverVerifiedProviders(): Promise<StorageProviderInfo[]> {
    const addresses = await this.getAgentLinkedProviders();
    const providers = await Promise.all(addresses.map(addr => this.getProviderInfo(addr)));
    // Filter to only active and verified
    return providers.filter(p => p.provider.active && p.provider.agentId > 0);
  }

  // ============ Ledger Functions ============

  async deposit(amount: bigint): Promise<void> {
    const signer = this.requireSigner();
    const exists = await callContract<boolean>(this.ledger, 'ledgerExists', signer.address);

    if (!exists) {
      const tx = await sendContract(this.ledger, 'createLedger', { value: amount });
      await tx.wait();
    } else {
      const tx = await sendContract(this.ledger, 'deposit', { value: amount });
      await tx.wait();
    }
  }

  async withdraw(amount: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.ledger, 'withdraw', amount);
    await tx.wait();
  }

  async transferToProvider(provider: string, amount: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.ledger, 'transferToProvider', provider, amount);
    await tx.wait();
  }

  async getLedger(address?: string): Promise<StorageLedger> {
    const addr = address || this.signer?.address;
    if (!addr) throw new Error('Address required');

    const result = await callContract<{
      totalBalance: bigint;
      availableBalance: bigint;
      lockedBalance: bigint;
      createdAt: bigint;
    }>(this.ledger, 'getLedger', addr);

    return {
      totalBalance: result.totalBalance,
      availableBalance: result.availableBalance,
      lockedBalance: result.lockedBalance,
      createdAt: Number(result.createdAt),
    };
  }

  async getSubAccount(user: string, provider: string): Promise<ProviderSubAccount> {
    const result = await callContract<{
      balance: bigint;
      pendingRefund: bigint;
      refundUnlockTime: bigint;
      acknowledged: boolean;
    }>(this.ledger, 'getSubAccount', user, provider);

    return {
      balance: result.balance,
      pendingRefund: result.pendingRefund,
      refundUnlockTime: Number(result.refundUnlockTime),
      acknowledged: result.acknowledged,
    };
  }

  // ============ Multi-Token Payment Functions ============

  isPaymasterEnabled(): boolean {
    return this.paymentClient !== null;
  }

  async getCreditBalances(address?: string): Promise<CreditBalance | null> {
    if (!this.paymentClient) return null;
    const addr = address || this.signer?.address;
    if (!addr) throw new Error('Address required');
    return this.paymentClient.getCreditBalances(addr);
  }

  async getAvailablePaymasters(estimatedGas: bigint): Promise<PaymasterOption[]> {
    if (!this.paymentClient) return [];
    return this.paymentClient.getAvailablePaymasters(estimatedGas);
  }

  async depositCredits(tokenAddress: string, amount: bigint): Promise<string> {
    if (!this.paymentClient) throw new Error('Payment client not configured');
    const signer = this.requireSigner();
    return this.paymentClient.depositCredits(signer, tokenAddress, amount);
  }

  async payForStorage(amount: bigint, preferredToken?: string): Promise<PaymentResult> {
    if (!this.paymentClient) {
      throw new Error('Payment client not configured - use deposit() for ETH-only payments');
    }
    const signer = this.requireSigner();
    return this.paymentClient.payForStorage(signer, amount, preferredToken);
  }

  // ============ Storage Deals ============

  async getQuote(
    provider: string,
    sizeBytes: bigint,
    durationDays: number,
    tier: StorageTier = 1
  ): Promise<StorageQuote> {
    const result = await callContract<{
      provider: string;
      sizeBytes: bigint;
      durationDays: bigint;
      tier: number;
      cost: bigint;
      costBreakdown: { storage: bigint; bandwidth: bigint; retrieval: bigint };
      expiresAt: bigint;
    }>(this.market, 'getQuote', provider, sizeBytes, durationDays, tier);

    return {
      provider: result.provider,
      sizeBytes: result.sizeBytes,
      durationDays: Number(result.durationDays),
      tier: result.tier as StorageTier,
      cost: result.cost,
      costBreakdown: {
        storage: result.costBreakdown.storage,
        bandwidth: result.costBreakdown.bandwidth,
        retrieval: result.costBreakdown.retrieval,
      },
      expiresAt: new Date(Number(result.expiresAt) * 1000),
    };
  }

  async createDeal(params: CreateStorageDealParams): Promise<string> {
    this.requireSigner();
    const cost = await callContract<bigint>(
      this.market,
      'calculateDealCost',
      params.provider,
      params.sizeBytes,
      params.durationDays,
      params.tier ?? 1
    );

    const tx = await sendContract(
      this.market,
      'createDeal',
      params.provider,
      params.cid ?? '',
      params.sizeBytes,
      params.durationDays,
      params.tier ?? 1,
      params.replicationFactor ?? 1,
      { value: cost }
    );

    const receipt = await tx.wait();
    const event = receipt?.logs.find((log) => {
      const parsed = this.market.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      return parsed?.name === 'DealCreated';
    });

    if (event) {
      const parsed = this.market.interface.parseLog({
        topics: event.topics as string[],
        data: event.data,
      });
      return parsed?.args[0] as string;
    }

    throw new Error('Failed to get deal ID from transaction');
  }

  async getDeal(dealId: string): Promise<StorageDeal> {
    const result = await callContract<{
      dealId: string;
      user: string;
      provider: string;
      status: number;
      cid: string;
      sizeBytes: bigint;
      tier: number;
      startTime: bigint;
      endTime: bigint;
      totalCost: bigint;
      paidAmount: bigint;
      refundedAmount: bigint;
      replicationFactor: bigint;
      retrievalCount: bigint;
    }>(this.market, 'getDeal', dealId);

    return {
      dealId: result.dealId,
      user: result.user,
      provider: result.provider,
      status: result.status as StorageDealStatus,
      cid: result.cid,
      sizeBytes: result.sizeBytes,
      tier: result.tier as StorageTier,
      startTime: Number(result.startTime),
      endTime: Number(result.endTime),
      totalCost: result.totalCost,
      paidAmount: result.paidAmount,
      refundedAmount: result.refundedAmount,
      replicationFactor: Number(result.replicationFactor),
      retrievalCount: Number(result.retrievalCount),
    };
  }

  async getUserDeals(user?: string): Promise<string[]> {
    const addr = user || this.signer?.address;
    if (!addr) throw new Error('Address required');
    return callContract<string[]>(this.market, 'getUserDeals', addr);
  }

  async getProviderDeals(provider: string): Promise<string[]> {
    return callContract<string[]>(this.market, 'getProviderDeals', provider);
  }

  // ============ High-Level Upload API ============

  async upload(params: UploadParams): Promise<UploadResult> {
    this.requireSigner();

    // Convert content to Buffer
    let buffer: Buffer;
    if (params.content instanceof Buffer) {
      buffer = params.content;
    } else if (params.content instanceof Blob) {
      buffer = Buffer.from(await params.content.arrayBuffer());
    } else {
      buffer = Buffer.from(await (params.content as File).arrayBuffer());
    }

    const sizeBytes = BigInt(buffer.length);
    const durationDays = params.durationDays ?? 30;
    const tier = params.tier ?? 1;
    const replicationFactor = params.replicationFactor ?? 1;

    // Auto-select providers if not specified
    let selectedProviders: StorageProviderInfo[];
    if (params.providers?.length) {
      selectedProviders = await Promise.all(
        params.providers.map(addr => this.getProviderInfo(addr))
      );
    } else {
      await this.discoverProviders();
      selectedProviders = this.router.selectProvidersForReplication(
        sizeBytes,
        durationDays,
        replicationFactor,
        {
          tier,
          permanentStorage: params.permanent,
        }
      );
    }

    if (selectedProviders.length === 0) {
      throw new Error('No suitable storage providers found');
    }

    const primaryProvider = selectedProviders[0]!;
    const backend = createBackendForProvider(primaryProvider);

    // Upload to storage backend
    const { cid, url } = await backend.upload(buffer, { filename: params.filename });

    // Create on-chain deal
    const dealId = await this.createDeal({
      provider: primaryProvider.provider.address,
      cid,
      sizeBytes,
      durationDays,
      tier,
      replicationFactor,
      metadata: params.metadata,
    });

    // Get deal to confirm cost
    const deal = await this.getDeal(dealId);

    return {
      dealId,
      cid,
      url,
      ipfsGatewayUrl: primaryProvider.ipfsGateway ? `${primaryProvider.ipfsGateway}/ipfs/${cid}` : undefined,
      arweaveUrl: params.permanent ? `https://arweave.net/${cid}` : undefined,
      size: buffer.length,
      provider: primaryProvider.provider.address,
      cost: deal.totalCost,
      tier,
      expiresAt: params.permanent ? undefined : new Date(deal.endTime * 1000),
      permanent: params.permanent ?? false,
    };
  }

  // ============ Retrieval ============

  async retrieve(cid: string, preferredProvider?: string): Promise<Buffer> {
    let providerInfo: StorageProviderInfo | undefined;

    if (preferredProvider) {
      providerInfo = await this.getProviderInfo(preferredProvider);
    } else {
      const providers = this.router.getActiveProviders();
      providerInfo = providers[0];
    }

    if (!providerInfo) {
      throw new Error('No storage provider available for retrieval');
    }

    const backend = createBackendForProvider(providerInfo);
    return backend.download(cid);
  }

  // ============ Reputation Functions ============

  async getUserRecord(user?: string): Promise<UserRecord> {
    const addr = user || this.signer?.address;
    if (!addr) throw new Error('Address required');

    const result = await callContract<{
      totalDeals: bigint;
      activeDeals: bigint;
      completedDeals: bigint;
      disputedDeals: bigint;
      totalStoredGB: bigint;
      totalSpent: bigint;
      banned: boolean;
    }>(this.market, 'getUserRecord', addr);

    return {
      totalDeals: Number(result.totalDeals),
      activeDeals: Number(result.activeDeals),
      completedDeals: Number(result.completedDeals),
      disputedDeals: Number(result.disputedDeals),
      totalStoredGB: Number(result.totalStoredGB),
      totalSpent: result.totalSpent,
      banned: result.banned,
    };
  }

  async getProviderRecord(provider: string): Promise<ProviderRecord> {
    const result = await callContract<{
      totalDeals: bigint;
      activeDeals: bigint;
      completedDeals: bigint;
      failedDeals: bigint;
      totalStoredGB: bigint;
      totalEarnings: bigint;
      avgRating: bigint;
      ratingCount: bigint;
      uptimePercent: bigint;
      banned: boolean;
    }>(this.market, 'getProviderRecord', provider);

    return {
      totalDeals: Number(result.totalDeals),
      activeDeals: Number(result.activeDeals),
      completedDeals: Number(result.completedDeals),
      failedDeals: Number(result.failedDeals),
      totalStoredGB: Number(result.totalStoredGB),
      totalEarnings: result.totalEarnings,
      avgRating: Number(result.avgRating),
      ratingCount: Number(result.ratingCount),
      uptimePercent: Number(result.uptimePercent),
      banned: result.banned,
    };
  }

  async rateDeal(dealId: string, score: number, comment?: string): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.market, 'rateDeal', dealId, score, comment ?? '');
    await tx.wait();
  }

  // ============ Utility Functions ============

  private requireSigner(): Wallet {
    if (!this.signer) {
      throw new Error('Signer required for this operation');
    }
    return this.signer;
  }

  getAddress(): string | null {
    return this.signer?.address || null;
  }

  formatEther(wei: bigint): string {
    return formatEther(wei);
  }

  parseEther(eth: string): bigint {
    return parseEther(eth);
  }

  getRouter(): StorageRouter {
    return this.router;
  }

  async generateAuthHeaders(provider: string): Promise<AuthHeaders> {
    const signer = this.requireSigner();

    const nonce = crypto.randomUUID();
    const timestamp = Date.now().toString();
    const message = `${signer.address}:${nonce}:${timestamp}:${provider}`;
    const signature = await signer.signMessage(message);

    return {
      'x-jeju-address': signer.address,
      'x-jeju-nonce': nonce,
      'x-jeju-signature': signature,
      'x-jeju-timestamp': timestamp,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createStorageSDK(config: {
  rpcUrl: string;
  privateKey?: string;
  registryAddress: string;
  ledgerAddress: string;
  marketAddress: string;
  creditManagerAddress?: string;
  paymasterFactoryAddress?: string;
  tokenRegistryAddress?: string;
}): JejuStorageSDK {
  return new JejuStorageSDK({
    rpcUrl: config.rpcUrl,
    signer: config.privateKey ? new Wallet(config.privateKey) : undefined,
    contracts: {
      registry: config.registryAddress,
      ledger: config.ledgerAddress,
      market: config.marketAddress,
      creditManager: config.creditManagerAddress,
      paymasterFactory: config.paymasterFactoryAddress,
      tokenRegistry: config.tokenRegistryAddress,
    },
  });
}

// ============================================================================
// Legacy Alias
// ============================================================================

export { JejuStorageSDK as StorageSDK };

