/**
 * Jeju Compute SDK
 *
 * Client library for interacting with the Jeju Compute Marketplace
 */

import {
  Contract,
  type ContractTransactionResponse,
  formatEther,
  JsonRpcProvider,
  parseEther,
  Wallet,
} from 'ethers';
import type {
  AuthHeaders,
  Capability,
  CreateDisputeParams,
  CreateRentalParams,
  Dispute,
  DisputeReason,
  GPUType,
  InferenceRequest,
  InferenceResponse,
  Ledger,
  Provider,
  ProviderRecord,
  ProviderResourcesInfo,
  ProviderSubAccount,
  Rental,
  RentalRating,
  RentalStatus,
  ReportAbuseParams,
  SDKConfig,
  Service,
  UserRecord,
} from './types';

// ABI fragments for the contracts - must match packages/contracts/src/compute/*.sol
const REGISTRY_ABI = [
  // Registration
  'function register(string name, string endpoint, bytes32 attestationHash) payable',
  'function registerWithAgent(string name, string endpoint, bytes32 attestationHash, uint256 agentId) payable',
  // Updates
  'function updateEndpoint(string endpoint)',
  'function updateAttestation(bytes32 attestationHash)',
  'function deactivate()',
  'function reactivate()',
  // Staking
  'function addStake() payable',
  'function withdrawStake(uint256 amount)',
  // Capabilities
  'function addCapability(string model, uint256 pricePerInputToken, uint256 pricePerOutputToken, uint256 maxContextLength)',
  'function updateCapability(uint256 index, bool active)',
  // View functions - Provider includes agentId, Capability includes active
  'function getProvider(address provider) view returns (tuple(address owner, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active))',
  'function getCapabilities(address provider) view returns (tuple(string model, uint256 pricePerInputToken, uint256 pricePerOutputToken, uint256 maxContextLength, bool active)[])',
  'function isActive(address provider) view returns (bool)',
  'function getActiveProviders() view returns (address[])',
  'function getProviderStake(address provider) view returns (uint256)',
  'function getProviderCount() view returns (uint256)',
  'function getProviderByAgent(uint256 agentId) view returns (address)',
  'function minProviderStake() view returns (uint256)',
];

const LEDGER_ABI = [
  // User functions
  'function createLedger() payable',
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  'function transferToProvider(address provider, uint256 amount)',
  'function requestRefund(address provider, uint256 amount)',
  'function completeRefund(address provider)',
  'function cancelRefund(address provider)',
  // Provider functions - provider calls to acknowledge user
  'function acknowledgeUser(address user)',
  // View functions
  'function getLedger(address user) view returns (tuple(uint256 totalBalance, uint256 availableBalance, uint256 lockedBalance, uint256 createdAt))',
  'function getSubAccount(address user, address provider) view returns (tuple(uint256 balance, uint256 pendingRefund, uint256 refundUnlockTime, bool acknowledged))',
  'function getAvailableBalance(address user) view returns (uint256)',
  'function getProviderBalance(address user, address provider) view returns (uint256)',
  'function isAcknowledged(address user, address provider) view returns (bool)',
  'function ledgerExists(address user) view returns (bool)',
  'function MIN_DEPOSIT() view returns (uint256)',
];

const INFERENCE_ABI = [
  'function registerService(string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken)',
  'function deactivateService(uint256 serviceIndex)',
  'function setSigner(address signer)',
  'function settle(address provider, bytes32 requestHash, uint256 inputTokens, uint256 outputTokens, uint256 nonce, bytes signature)',
  'function getServices(address provider) view returns (tuple(address provider, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken, bool active)[])',
  'function getActiveServices(address provider) view returns (tuple(address provider, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken, bool active)[])',
  'function getNonce(address user, address provider) view returns (uint256)',
  'function getSigner(address provider) view returns (address)',
  'function calculateFee(address provider, uint256 inputTokens, uint256 outputTokens) view returns (uint256)',
];

// Rental contract ABI - for hourly/session-based compute rentals with SSH/Docker
const RENTAL_ABI = [
  // Provider management
  'function setProviderResources(tuple(uint8 gpuType, uint8 gpuCount, uint16 gpuVram, uint16 cpuCores, uint32 memory, uint32 storage, uint32 bandwidth, bool teeCapable) resources, tuple(uint256 pricePerHour, uint256 pricePerGpuHour, uint256 minimumRentalHours, uint256 maximumRentalHours) pricing, uint256 maxConcurrent, string[] supportedImages, bool sshEnabled, bool dockerEnabled)',
  'function linkProviderAgent(uint256 agentId)',
  // Rental creation
  'function createRental(address provider, uint256 durationHours, string sshPublicKey, string containerImage, string startupScript) payable returns (bytes32)',
  // Provider actions
  'function startRental(bytes32 rentalId, string sshHost, uint16 sshPort, string containerId)',
  'function completeRental(bytes32 rentalId)',
  // User actions
  'function cancelRental(bytes32 rentalId)',
  'function extendRental(bytes32 rentalId, uint256 additionalHours) payable',
  // Rating
  'function rateRental(bytes32 rentalId, uint8 score, string comment)',
  // Disputes
  'function createDispute(bytes32 rentalId, uint8 reason, string evidenceUri) payable returns (bytes32)',
  'function resolveDispute(bytes32 disputeId, bool inFavorOfInitiator, uint256 slashAmount)',
  // Abuse reporting
  'function reportAbuse(bytes32 rentalId, uint8 reason, string evidenceUri)',
  // View functions
  'function getRental(bytes32 rentalId) view returns (tuple(bytes32 rentalId, address user, address provider, uint8 status, uint256 startTime, uint256 endTime, uint256 totalCost, uint256 paidAmount, uint256 refundedAmount, string sshPublicKey, string containerImage, string startupScript, string sshHost, uint16 sshPort))',
  'function getProviderResources(address provider) view returns (tuple(uint8 gpuType, uint8 gpuCount, uint16 gpuVram, uint16 cpuCores, uint32 memory, uint32 storage, uint32 bandwidth, bool teeCapable), tuple(uint256 pricePerHour, uint256 pricePerGpuHour, uint256 minimumRentalHours, uint256 maximumRentalHours), uint256 maxConcurrent, uint256 active, bool sshEnabled, bool dockerEnabled)',
  'function getUserRentals(address user) view returns (bytes32[])',
  'function getProviderRentals(address provider) view returns (bytes32[])',
  'function calculateRentalCost(address provider, uint256 durationHours) view returns (uint256)',
  'function isRentalActive(bytes32 rentalId) view returns (bool)',
  'function getRemainingTime(bytes32 rentalId) view returns (uint256)',
  // Reputation view functions
  'function getUserRecord(address user) view returns (tuple(uint256 totalRentals, uint256 completedRentals, uint256 cancelledRentals, uint256 disputedRentals, uint256 abuseReports, bool banned, uint256 bannedAt, string banReason))',
  'function getProviderRecord(address provider) view returns (tuple(uint256 totalRentals, uint256 completedRentals, uint256 failedRentals, uint256 totalEarnings, uint256 avgRating, uint256 ratingCount, bool banned))',
  'function getDispute(bytes32 disputeId) view returns (tuple(bytes32 disputeId, bytes32 rentalId, address initiator, address defendant, uint8 reason, string evidenceUri, uint256 createdAt, uint256 resolvedAt, bool resolved, bool inFavorOfInitiator, uint256 slashAmount))',
  'function getRentalRating(bytes32 rentalId) view returns (tuple(uint8 score, string comment, uint256 ratedAt))',
  'function isUserBanned(address user) view returns (bool)',
  'function isProviderBanned(address provider) view returns (bool)',
  'function getProviderByAgent(uint256 agentId) view returns (address)',
  'function disputeBond() view returns (uint256)',
];

// Helper to call contract methods safely
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

import {
  ComputePaymentClient,
  createPaymentClient,
  type PaymasterOption,
  type CreditBalance,
  type PaymentResult,
  ZERO_ADDRESS,
} from './payment';
import type { Address } from 'viem';

/**
 * Jeju Compute SDK
 */
export class JejuComputeSDK {
  private rpcProvider: JsonRpcProvider;
  private signer: Wallet | null;
  private registry: Contract;
  private ledger: Contract;
  private inferenceContract: Contract;
  private rentalContract: Contract | null;
  private paymentClient: ComputePaymentClient | null;

  constructor(config: SDKConfig) {
    this.rpcProvider = new JsonRpcProvider(config.rpcUrl);
    this.signer = config.signer
      ? config.signer.connect(this.rpcProvider)
      : null;

    // Initialize contracts
    const signerOrProvider = this.signer || this.rpcProvider;
    this.registry = new Contract(
      config.contracts.registry,
      REGISTRY_ABI,
      signerOrProvider
    );
    this.ledger = new Contract(
      config.contracts.ledger,
      LEDGER_ABI,
      signerOrProvider
    );
    this.inferenceContract = new Contract(
      config.contracts.inference,
      INFERENCE_ABI,
      signerOrProvider
    );
    
    // Optional rental contract
    this.rentalContract = config.contracts.rental
      ? new Contract(config.contracts.rental, RENTAL_ABI, signerOrProvider)
      : null;

    // Initialize payment client for multi-token paymaster support
    this.paymentClient = config.contracts.creditManager
      ? createPaymentClient({
          rpcUrl: config.rpcUrl,
          creditManagerAddress: config.contracts.creditManager as Address,
          paymasterFactoryAddress: (config.contracts.paymasterFactory || ZERO_ADDRESS) as Address,
          ledgerManagerAddress: config.contracts.ledger as Address,
          tokenRegistryAddress: (config.contracts.tokenRegistry || ZERO_ADDRESS) as Address,
          entryPointAddress: (config.contracts.entryPoint || '0x0000000071727De22E5E9d8BAf0edAc6f37da032') as Address,
        })
      : null;
  }

  // ============ Registry Functions ============

  /**
   * Register as a compute provider
   */
  async registerProvider(
    name: string,
    endpoint: string,
    attestationHash: string,
    stakeAmount: bigint
  ): Promise<string> {
    const signer = this.requireSigner();
    const tx = await sendContract(
      this.registry,
      'register',
      name,
      endpoint,
      attestationHash,
      { value: stakeAmount }
    );
    await tx.wait();
    return signer.address;
  }

  /**
   * Register as a compute provider with ERC-8004 agent ID
   * 
   * This links the compute provider to an existing ERC-8004 agent identity,
   * enabling cross-protocol discovery and reputation tracking.
   * 
   * Prerequisites:
   * - Caller must own the agentId (registered via IdentityRegistry)
   * - agentId must not already be linked to another provider
   * 
   * @param name Provider display name
   * @param endpoint API endpoint URL
   * @param attestationHash TEE attestation hash (or zero bytes for permissionless)
   * @param stakeAmount Amount to stake (in wei)
   * @param agentId ERC-8004 agent ID from IdentityRegistry
   * @returns Provider address
   */
  async registerWithAgent(
    name: string,
    endpoint: string,
    attestationHash: string,
    stakeAmount: bigint,
    agentId: bigint
  ): Promise<string> {
    const signer = this.requireSigner();
    const tx = await sendContract(
      this.registry,
      'registerWithAgent',
      name,
      endpoint,
      attestationHash,
      agentId,
      { value: stakeAmount }
    );
    await tx.wait();
    return signer.address;
  }

  /**
   * Get provider address by ERC-8004 agent ID
   * 
   * @param agentId ERC-8004 agent ID
   * @returns Provider address or zero address if not linked
   */
  async getProviderByAgent(agentId: bigint): Promise<string> {
    return callContract<string>(this.registry, 'getProviderByAgent', agentId);
  }

  /**
   * Get the ERC-8004 agent ID linked to a provider
   * 
   * @param address Provider address
   * @returns Agent ID (0 if not linked to an agent)
   */
  async getProviderAgentId(address: string): Promise<bigint> {
    const provider = await this.getProvider(address);
    return BigInt(provider.agentId);
  }

  /**
   * Get provider info
   */
  async getProvider(address: string): Promise<Provider> {
    const result = await callContract<{
      owner: string;
      name: string;
      endpoint: string;
      attestationHash: string;
      stake: bigint;
      registeredAt: bigint;
      agentId: bigint;
      active: boolean;
    }>(this.registry, 'getProvider', address);
    return {
      address,
      name: result.name,
      endpoint: result.endpoint,
      attestationHash: result.attestationHash,
      stake: result.stake,
      registeredAt: Number(result.registeredAt),
      agentId: Number(result.agentId),
      active: result.active,
    };
  }

  /**
   * Get provider capabilities
   */
  async getCapabilities(address: string): Promise<Capability[]> {
    const result = await callContract<Array<{
      model: string;
      pricePerInputToken: bigint;
      pricePerOutputToken: bigint;
      maxContextLength: bigint;
      active: boolean;
    }>>(
      this.registry,
      'getCapabilities',
      address
    );
    return result.map((c) => ({
      model: c.model,
      pricePerInputToken: c.pricePerInputToken,
      pricePerOutputToken: c.pricePerOutputToken,
      maxContextLength: Number(c.maxContextLength),
      active: c.active,
    }));
  }

  /**
   * Get all active providers
   */
  async getActiveProviders(): Promise<string[]> {
    return callContract<string[]>(this.registry, 'getActiveProviders');
  }

  /**
   * Check if provider is active
   */
  async isProviderActive(address: string): Promise<boolean> {
    return callContract<boolean>(this.registry, 'isActive', address);
  }

  /**
   * Register as a provider
   * @param name Provider name
   * @param endpoint API endpoint URL
   * @param stake Amount to stake (in wei)
   * @param attestationHash Optional TEE attestation hash
   */
  async register(
    name: string,
    endpoint: string,
    stake: bigint,
    attestationHash = '0x0000000000000000000000000000000000000000000000000000000000000000'
  ): Promise<void> {
    this.requireSigner(); // Ensure we have a signer

    const tx = await sendContract(
      this.registry,
      'register',
      name,
      endpoint,
      attestationHash,
      { value: stake }
    );
    await tx.wait();
  }

  /**
   * Register an inference service
   * @param model Model name
   * @param endpoint Service endpoint
   * @param pricePerInputToken Price per input token (wei)
   * @param pricePerOutputToken Price per output token (wei)
   */
  async registerService(
    model: string,
    endpoint: string,
    pricePerInputToken: bigint,
    pricePerOutputToken: bigint
  ): Promise<void> {
    this.requireSigner(); // Ensure we have a signer

    const tx = await sendContract(
      this.inferenceContract,
      'registerService',
      model,
      endpoint,
      pricePerInputToken,
      pricePerOutputToken
    );
    await tx.wait();
  }

  // ============ Service Discovery ============

  /**
   * Get services for a provider
   */
  async getProviderServices(provider: string): Promise<Service[]> {
    const result = await callContract<
      Array<{
        provider: string;
        model: string;
        endpoint: string;
        pricePerInputToken: bigint;
        pricePerOutputToken: bigint;
        active: boolean;
      }>
    >(this.inferenceContract, 'getServices', provider);

    return result.map((s) => ({
      provider: s.provider,
      model: s.model,
      endpoint: s.endpoint,
      pricePerInputToken: s.pricePerInputToken,
      pricePerOutputToken: s.pricePerOutputToken,
      active: s.active,
    }));
  }

  /**
   * Get active services for a provider
   */
  async getActiveServices(provider: string): Promise<Service[]> {
    const result = await callContract<
      Array<{
        provider: string;
        model: string;
        endpoint: string;
        pricePerInputToken: bigint;
        pricePerOutputToken: bigint;
        active: boolean;
      }>
    >(this.inferenceContract, 'getActiveServices', provider);

    return result.map((s) => ({
      provider: s.provider,
      model: s.model,
      endpoint: s.endpoint,
      pricePerInputToken: s.pricePerInputToken,
      pricePerOutputToken: s.pricePerOutputToken,
      active: s.active,
    }));
  }

  /**
   * Discover all active providers with their services
   * Returns a list of providers with their info and available services
   */
  async discoverProviders(): Promise<
    Array<{
      provider: Provider;
      services: Service[];
    }>
  > {
    const activeProviders = await this.getActiveProviders();

    const results = await Promise.all(
      activeProviders.map(async (address) => {
        const provider = await this.getProvider(address);
        const services = await this.getActiveServices(address);
        return { provider, services };
      })
    );

    // Only return providers that have active services
    return results.filter((r) => r.services.length > 0);
  }

  /**
   * Find providers offering a specific model
   */
  async findProvidersForModel(
    modelName: string
  ): Promise<Array<{ provider: Provider; service: Service }>> {
    const discoveries = await this.discoverProviders();

    const matches: Array<{ provider: Provider; service: Service }> = [];

    for (const { provider, services } of discoveries) {
      const service = services.find(
        (s) => s.model.toLowerCase() === modelName.toLowerCase() && s.active
      );
      if (service) {
        matches.push({ provider, service });
      }
    }

    return matches;
  }

  // ============ Ledger Functions ============

  /**
   * Create and deposit to ledger
   */
  async deposit(amount: bigint): Promise<void> {
    const signer = this.requireSigner();
    const exists = await callContract<boolean>(
      this.ledger,
      'ledgerExists',
      signer.address
    );

    if (!exists) {
      const tx = await sendContract(this.ledger, 'createLedger', {
        value: amount,
      });
      await tx.wait();
    } else {
      const tx = await sendContract(this.ledger, 'deposit', { value: amount });
      await tx.wait();
    }
  }

  /**
   * Withdraw from ledger
   */
  async withdraw(amount: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.ledger, 'withdraw', amount);
    await tx.wait();
  }

  /**
   * Transfer to provider sub-account
   */
  async transferToProvider(provider: string, amount: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(
      this.ledger,
      'transferToProvider',
      provider,
      amount
    );
    await tx.wait();
  }

  /**
   * Provider acknowledges a user (enables settlements for that user)
   * 
   * This must be called BY THE PROVIDER after a user transfers funds to their sub-account.
   * Once acknowledged, the provider can sign settlements for this user.
   * 
   * @param user The user address to acknowledge
   */
  async acknowledgeUser(user: string): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.ledger, 'acknowledgeUser', user);
    await tx.wait();
  }

  /**
   * Get ledger balance
   */
  async getLedger(address?: string): Promise<Ledger> {
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

  /**
   * Get provider sub-account
   */
  async getSubAccount(
    user: string,
    provider: string
  ): Promise<ProviderSubAccount> {
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

  /**
   * Check if provider is acknowledged
   */
  async isAcknowledged(user: string, provider: string): Promise<boolean> {
    return callContract<boolean>(this.ledger, 'isAcknowledged', user, provider);
  }

  // ============ Multi-Token Payment Functions ============
  // These functions enable payment with ANY registered token via ERC-4337 paymasters
  // Users can pay with elizaOS, USDC, VIRTUAL, etc. - no bridging required

  /**
   * Check if multi-token payments are enabled
   */
  isPaymasterEnabled(): boolean {
    return this.paymentClient !== null;
  }

  /**
   * Get credit balances across all supported tokens
   * Credits enable zero-latency operations (no blockchain tx needed)
   */
  async getCreditBalances(address?: string): Promise<CreditBalance | null> {
    if (!this.paymentClient) return null;
    const addr = address || this.signer?.address;
    if (!addr) throw new Error('Address required');
    return this.paymentClient.getCreditBalances(addr);
  }

  /**
   * Get available paymasters (tokens that can sponsor gas)
   * @param estimatedGas Gas estimate for the operation (use estimateGasForOperation)
   */
  async getAvailablePaymasters(estimatedGas: bigint): Promise<PaymasterOption[]> {
    if (!this.paymentClient) return [];
    return this.paymentClient.getAvailablePaymasters(estimatedGas);
  }

  /**
   * Select optimal paymaster based on user's token balances
   * Returns the cheapest paymaster that the user can afford
   */
  async selectOptimalPaymaster(estimatedGas: bigint): Promise<PaymasterOption | null> {
    if (!this.paymentClient || !this.signer) return null;
    return this.paymentClient.selectOptimalPaymaster(this.signer.address, estimatedGas);
  }

  /**
   * Deposit credits for future compute usage
   * Credits enable zero-latency operations - no blockchain tx needed per request
   * 
   * @param tokenAddress Token to deposit (ZERO_ADDRESS for ETH)
   * @param amount Amount to deposit
   */
  async depositCredits(tokenAddress: string, amount: bigint): Promise<string> {
    if (!this.paymentClient) throw new Error('Payment client not configured');
    const signer = this.requireSigner();
    return this.paymentClient.depositCredits(signer, tokenAddress, amount);
  }

  /**
   * Pay for compute using the optimal method:
   * 1. Credits (zero latency, if available)
   * 2. Paymaster-sponsored tx (any token)
   * 3. Direct ETH payment (fallback)
   * 
   * @param amount Amount required in wei
   * @param preferredToken Optional preferred token for payment
   */
  async payForCompute(amount: bigint, preferredToken?: string): Promise<PaymentResult> {
    if (!this.paymentClient) {
      throw new Error('Payment client not configured - use deposit() for ETH-only payments');
    }
    const signer = this.requireSigner();
    return this.paymentClient.payForCompute(signer, amount, preferredToken);
  }

  /**
   * Check if user has sufficient balance in any payment method
   * Returns the best payment option available
   */
  async checkPaymentOptions(
    amount: bigint
  ): Promise<{
    credits: CreditBalance | null;
    ledgerBalance: bigint;
    paymasters: PaymasterOption[];
    canPay: boolean;
  }> {
    this.requireSigner(); // Ensure user has a signer for payment options
    const [credits, ledger, paymasters] = await Promise.all([
      this.getCreditBalances(),
      this.getLedger().then((l) => l.availableBalance),
      this.getAvailablePaymasters(amount),
    ]);

    const canPayWithCredits = credits ? credits.total >= amount : false;
    const canPayWithLedger = ledger >= amount;
    const canPayWithPaymaster = paymasters.some((p) => p.isAvailable);

    return {
      credits,
      ledgerBalance: ledger,
      paymasters,
      canPay: canPayWithCredits || canPayWithLedger || canPayWithPaymaster,
    };
  }

  // ============ Inference Functions ============

  /**
   * Get services for a provider
   */
  async getServices(provider: string): Promise<Service[]> {
    const result = await callContract<Service[]>(
      this.inferenceContract,
      'getActiveServices',
      provider
    );
    return result.map((s) => ({
      provider: s.provider,
      model: s.model,
      endpoint: s.endpoint,
      pricePerInputToken: s.pricePerInputToken,
      pricePerOutputToken: s.pricePerOutputToken,
      active: s.active,
    }));
  }

  /**
   * Calculate fee for a request
   */
  async calculateFee(
    provider: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<bigint> {
    return callContract<bigint>(
      this.inferenceContract,
      'calculateFee',
      provider,
      inputTokens,
      outputTokens
    );
  }

  /**
   * Get current nonce for user-provider pair
   */
  async getNonce(user: string, provider: string): Promise<number> {
    const nonce = await callContract<bigint>(
      this.inferenceContract,
      'getNonce',
      user,
      provider
    );
    return Number(nonce);
  }

  /**
   * Generate auth headers for inference request
   * Includes the user's current on-chain nonce for settlement
   */
  async generateAuthHeaders(
    provider: string
  ): Promise<AuthHeaders & { 'x-jeju-settlement-nonce': string }> {
    const signer = this.requireSigner();

    const nonce = crypto.randomUUID();
    const timestamp = Date.now().toString();
    const message = `${signer.address}:${nonce}:${timestamp}:${provider}`;
    const signature = await signer.signMessage(message);

    // Get the current on-chain nonce for settlement
    const settlementNonce = await this.getNonce(signer.address, provider);

    return {
      'x-jeju-address': signer.address,
      'x-jeju-nonce': nonce,
      'x-jeju-signature': signature,
      'x-jeju-timestamp': timestamp,
      'x-jeju-settlement-nonce': settlementNonce.toString(),
    };
  }

  /**
   * Make an inference request to a provider
   */
  async sendInference(
    provider: string,
    request: InferenceRequest
  ): Promise<InferenceResponse> {
    // Get provider info
    const providerInfo = await this.getProvider(provider);
    if (!providerInfo.active) {
      throw new Error('Provider is not active');
    }

    // Generate auth headers
    const headers = await this.generateAuthHeaders(provider);

    // Make request
    const response = await fetch(
      `${providerInfo.endpoint}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Inference failed: ${error}`);
    }

    return response.json() as Promise<InferenceResponse>;
  }

  /**
   * Settle an inference request using settlement data from the response
   * The provider must have signed the settlement data correctly
   */
  async settle(
    provider: string,
    requestHash: string,
    inputTokens: number,
    outputTokens: number,
    signature: string
  ): Promise<void> {
    const signer = this.requireSigner();

    const nonce = await this.getNonce(signer.address, provider);
    const tx = await sendContract(
      this.inferenceContract,
      'settle',
      provider,
      requestHash,
      inputTokens,
      outputTokens,
      nonce,
      signature
    );
    await tx.wait();
  }

  /**
   * Settle from an inference response
   * Convenience method that extracts settlement data from the response
   */
  async settleFromResponse(response: InferenceResponse): Promise<void> {
    if (!response.settlement) {
      throw new Error(
        'Response does not contain settlement data. Was the request authenticated with settlement nonce?'
      );
    }

    const {
      provider,
      requestHash,
      inputTokens,
      outputTokens,
      nonce,
      signature,
    } = response.settlement;

    // Verify the nonce matches our current on-chain nonce
    const signer = this.requireSigner();
    const currentNonce = await this.getNonce(signer.address, provider);

    if (nonce !== currentNonce) {
      throw new Error(
        `Settlement nonce mismatch: response has ${nonce}, chain has ${currentNonce}. ` +
          `Did another settlement happen in between?`
      );
    }

    await this.settle(
      provider,
      requestHash,
      inputTokens,
      outputTokens,
      signature
    );
  }

  // ============ Utility Functions ============

  private requireSigner(): Wallet {
    if (!this.signer) {
      throw new Error('Signer required for this operation');
    }
    return this.signer;
  }

  /**
   * Get signer address
   */
  getAddress(): string | null {
    return this.signer?.address || null;
  }

  /**
   * Format wei to ETH
   */
  formatEther(wei: bigint): string {
    return formatEther(wei);
  }

  /**
   * Parse ETH to wei
   */
  parseEther(eth: string): bigint {
    return parseEther(eth);
  }

  // ============ Rental Functions ============

  private requireRentalContract(): Contract {
    if (!this.rentalContract) {
      throw new Error('Rental contract not configured');
    }
    return this.rentalContract;
  }

  /**
   * Create a new compute rental
   * Returns the rental ID
   */
  async createRental(params: CreateRentalParams): Promise<string> {
    this.requireSigner();
    const rental = this.requireRentalContract();

    // Calculate cost
    const cost = await this.calculateRentalCost(params.provider, params.durationHours);

    const tx = await sendContract(
      rental,
      'createRental',
      params.provider,
      params.durationHours,
      params.sshPublicKey,
      params.containerImage ?? '',
      params.startupScript ?? '',
      { value: cost }
    );
    
    const receipt = await tx.wait();
    
    // Extract rental ID from event
    const event = receipt?.logs.find((log) => {
      const parsed = rental.interface.parseLog({ 
        topics: log.topics as string[], 
        data: log.data 
      });
      return parsed?.name === 'RentalCreated';
    });
    
    if (event) {
      const parsed = rental.interface.parseLog({ 
        topics: event.topics as string[], 
        data: event.data 
      });
      return parsed?.args[0] as string;
    }
    
    throw new Error('Failed to get rental ID from transaction');
  }

  /**
   * Get rental details
   */
  async getRental(rentalId: string): Promise<Rental> {
    const rental = this.requireRentalContract();
    const data = await callContract<{
      rentalId: string;
      user: string;
      provider: string;
      status: number;
      startTime: bigint;
      endTime: bigint;
      totalCost: bigint;
      paidAmount: bigint;
      refundedAmount: bigint;
      sshPublicKey: string;
      containerImage: string;
      startupScript: string;
      sshHost: string;
      sshPort: number;
    }>(rental, 'getRental', rentalId);

    return {
      rentalId: data.rentalId,
      user: data.user,
      provider: data.provider,
      status: data.status as RentalStatus,
      startTime: Number(data.startTime),
      endTime: Number(data.endTime),
      totalCost: data.totalCost,
      paidAmount: data.paidAmount,
      refundedAmount: data.refundedAmount,
      sshPublicKey: data.sshPublicKey,
      containerImage: data.containerImage,
      startupScript: data.startupScript,
      sshHost: data.sshHost,
      sshPort: data.sshPort,
    };
  }

  /**
   * Get provider resources and pricing
   */
  async getProviderResources(provider: string): Promise<ProviderResourcesInfo> {
    const rental = this.requireRentalContract();
    const data = await callContract<{
      resources: {
        gpuType: number;
        gpuCount: number;
        gpuVram: number;
        cpuCores: number;
        memory: number;
        storage: number;
        bandwidth: number;
        teeCapable: boolean;
      };
      pricing: {
        pricePerHour: bigint;
        pricePerGpuHour: bigint;
        minimumRentalHours: bigint;
        maximumRentalHours: bigint;
      };
      maxConcurrent: bigint;
      active: bigint;
      sshEnabled: boolean;
      dockerEnabled: boolean;
    }>(rental, 'getProviderResources', provider);

    return {
      resources: {
        gpuType: data.resources.gpuType as GPUType,
        gpuCount: data.resources.gpuCount,
        gpuVram: data.resources.gpuVram,
        cpuCores: data.resources.cpuCores,
        memory: data.resources.memory,
        storage: data.resources.storage,
        bandwidth: data.resources.bandwidth,
        teeCapable: data.resources.teeCapable,
      },
      pricing: {
        pricePerHour: data.pricing.pricePerHour,
        pricePerGpuHour: data.pricing.pricePerGpuHour,
        minimumRentalHours: Number(data.pricing.minimumRentalHours),
        maximumRentalHours: Number(data.pricing.maximumRentalHours),
      },
      maxConcurrentRentals: Number(data.maxConcurrent),
      activeRentals: Number(data.active),
      sshEnabled: data.sshEnabled,
      dockerEnabled: data.dockerEnabled,
    };
  }

  /**
   * Calculate rental cost for given duration
   */
  async calculateRentalCost(provider: string, durationHours: number): Promise<bigint> {
    const rental = this.requireRentalContract();
    return callContract<bigint>(rental, 'calculateRentalCost', provider, durationHours);
  }

  /**
   * Get user's rental IDs
   */
  async getUserRentals(user: string): Promise<string[]> {
    const rental = this.requireRentalContract();
    return callContract<string[]>(rental, 'getUserRentals', user);
  }

  /**
   * Get provider's rental IDs
   */
  async getProviderRentals(provider: string): Promise<string[]> {
    const rental = this.requireRentalContract();
    return callContract<string[]>(rental, 'getProviderRentals', provider);
  }

  /**
   * Check if rental is currently active
   */
  async isRentalActive(rentalId: string): Promise<boolean> {
    const rental = this.requireRentalContract();
    return callContract<boolean>(rental, 'isRentalActive', rentalId);
  }

  /**
   * Get remaining time on rental (seconds)
   */
  async getRemainingTime(rentalId: string): Promise<number> {
    const rental = this.requireRentalContract();
    const time = await callContract<bigint>(rental, 'getRemainingTime', rentalId);
    return Number(time);
  }

  /**
   * Cancel a pending rental (user only, full refund)
   */
  async cancelRental(rentalId: string): Promise<void> {
    this.requireSigner();
    const rental = this.requireRentalContract();
    const tx = await sendContract(rental, 'cancelRental', rentalId);
    await tx.wait();
  }

  /**
   * Extend an active rental
   */
  async extendRental(rentalId: string, additionalHours: number): Promise<void> {
    this.requireSigner();
    const rental = this.requireRentalContract();
    
    // Get current rental to know provider
    const rentalData = await this.getRental(rentalId);
    const additionalCost = await this.calculateRentalCost(rentalData.provider, additionalHours);
    
    const tx = await sendContract(
      rental,
      'extendRental',
      rentalId,
      additionalHours,
      { value: additionalCost }
    );
    await tx.wait();
  }

  /**
   * Provider: Start a rental with connection details
   */
  async startRental(
    rentalId: string,
    sshHost: string,
    sshPort: number,
    containerId?: string
  ): Promise<void> {
    this.requireSigner();
    const rental = this.requireRentalContract();
    const tx = await sendContract(
      rental,
      'startRental',
      rentalId,
      sshHost,
      sshPort,
      containerId ?? ''
    );
    await tx.wait();
  }

  /**
   * Provider: Complete a rental
   */
  async completeRental(rentalId: string): Promise<void> {
    this.requireSigner();
    const rental = this.requireRentalContract();
    const tx = await sendContract(rental, 'completeRental', rentalId);
    await tx.wait();
  }

  // ============ Rating Functions ============

  /**
   * Rate a completed rental
   * @param rentalId The rental to rate
   * @param score Score from 0-100
   * @param comment Optional comment
   */
  async rateRental(rentalId: string, score: number, comment?: string): Promise<void> {
    this.requireSigner();
    const rental = this.requireRentalContract();
    const tx = await sendContract(rental, 'rateRental', rentalId, score, comment ?? '');
    await tx.wait();
  }

  /**
   * Get rating for a rental
   */
  async getRentalRating(rentalId: string): Promise<RentalRating> {
    const rental = this.requireRentalContract();
    const data = await callContract<{
      score: number;
      comment: string;
      ratedAt: bigint;
    }>(rental, 'getRentalRating', rentalId);

    return {
      score: data.score,
      comment: data.comment,
      ratedAt: Number(data.ratedAt),
    };
  }

  // ============ Dispute Functions ============

  /**
   * Create a dispute for a rental
   * Requires disputeBond to be sent with the transaction
   */
  async createDispute(params: CreateDisputeParams): Promise<string> {
    this.requireSigner();
    const rental = this.requireRentalContract();
    
    const bond = await this.getDisputeBond();
    
    const tx = await sendContract(
      rental,
      'createDispute',
      params.rentalId,
      params.reason,
      params.evidenceUri,
      { value: bond }
    );
    
    const receipt = await tx.wait();
    
    // Extract dispute ID from event
    const event = receipt?.logs.find((log) => {
      const parsed = rental.interface.parseLog({ 
        topics: log.topics as string[], 
        data: log.data 
      });
      return parsed?.name === 'DisputeCreated';
    });
    
    if (event) {
      const parsed = rental.interface.parseLog({ 
        topics: event.topics as string[], 
        data: event.data 
      });
      return parsed?.args[0] as string;
    }
    
    throw new Error('Failed to get dispute ID from transaction');
  }

  /**
   * Get dispute details
   */
  async getDispute(disputeId: string): Promise<Dispute> {
    const rental = this.requireRentalContract();
    const data = await callContract<{
      disputeId: string;
      rentalId: string;
      initiator: string;
      defendant: string;
      reason: number;
      evidenceUri: string;
      createdAt: bigint;
      resolvedAt: bigint;
      resolved: boolean;
      inFavorOfInitiator: boolean;
      slashAmount: bigint;
    }>(rental, 'getDispute', disputeId);

    return {
      disputeId: data.disputeId,
      rentalId: data.rentalId,
      initiator: data.initiator,
      defendant: data.defendant,
      reason: data.reason as DisputeReason,
      evidenceUri: data.evidenceUri,
      createdAt: Number(data.createdAt),
      resolvedAt: Number(data.resolvedAt),
      resolved: data.resolved,
      inFavorOfInitiator: data.inFavorOfInitiator,
      slashAmount: data.slashAmount,
    };
  }

  /**
   * Get the current dispute bond amount
   */
  async getDisputeBond(): Promise<bigint> {
    const rental = this.requireRentalContract();
    return callContract<bigint>(rental, 'disputeBond');
  }

  // ============ Abuse Reporting ============

  /**
   * Report user abuse (providers only)
   * @param params The abuse report parameters
   */
  async reportAbuse(params: ReportAbuseParams): Promise<void> {
    this.requireSigner();
    const rental = this.requireRentalContract();
    const tx = await sendContract(
      rental,
      'reportAbuse',
      params.rentalId,
      params.reason,
      params.evidenceUri
    );
    await tx.wait();
  }

  // ============ Reputation Functions ============

  /**
   * Get user reputation record
   */
  async getUserRecord(user: string): Promise<UserRecord> {
    const rental = this.requireRentalContract();
    const data = await callContract<{
      totalRentals: bigint;
      completedRentals: bigint;
      cancelledRentals: bigint;
      disputedRentals: bigint;
      abuseReports: bigint;
      banned: boolean;
      bannedAt: bigint;
      banReason: string;
    }>(rental, 'getUserRecord', user);

    return {
      totalRentals: Number(data.totalRentals),
      completedRentals: Number(data.completedRentals),
      cancelledRentals: Number(data.cancelledRentals),
      disputedRentals: Number(data.disputedRentals),
      abuseReports: Number(data.abuseReports),
      banned: data.banned,
      bannedAt: Number(data.bannedAt),
      banReason: data.banReason,
    };
  }

  /**
   * Get provider reputation record
   */
  async getProviderRecord(provider: string): Promise<ProviderRecord> {
    const rental = this.requireRentalContract();
    const data = await callContract<{
      totalRentals: bigint;
      completedRentals: bigint;
      failedRentals: bigint;
      totalEarnings: bigint;
      avgRating: bigint;
      ratingCount: bigint;
      banned: boolean;
    }>(rental, 'getProviderRecord', provider);

    return {
      totalRentals: Number(data.totalRentals),
      completedRentals: Number(data.completedRentals),
      failedRentals: Number(data.failedRentals),
      totalEarnings: data.totalEarnings,
      avgRating: Number(data.avgRating),
      ratingCount: Number(data.ratingCount),
      banned: data.banned,
    };
  }

  /**
   * Check if a user is banned
   */
  async isUserBanned(user: string): Promise<boolean> {
    const rental = this.requireRentalContract();
    return callContract<boolean>(rental, 'isUserBanned', user);
  }

  /**
   * Check if a provider is banned
   */
  async isProviderBanned(provider: string): Promise<boolean> {
    const rental = this.requireRentalContract();
    return callContract<boolean>(rental, 'isProviderBanned', provider);
  }

  /**
   * Get provider address by ERC-8004 agent ID (from rental contract)
   */
  async getProviderByAgentRental(agentId: bigint): Promise<string> {
    const rental = this.requireRentalContract();
    return callContract<string>(rental, 'getProviderByAgent', agentId);
  }

  /**
   * Link provider to ERC-8004 agent
   */
  async linkProviderAgent(agentId: bigint): Promise<void> {
    this.requireSigner();
    const rental = this.requireRentalContract();
    const tx = await sendContract(rental, 'linkProviderAgent', agentId);
    await tx.wait();
  }

  /**
   * Check if rental contract is available
   */
  hasRentalContract(): boolean {
    return this.rentalContract !== null;
  }
}

/**
 * Create SDK from environment
 */
export function createSDK(config: {
  rpcUrl: string;
  privateKey?: string;
  registryAddress: string;
  ledgerAddress: string;
  inferenceAddress: string;
  rentalAddress?: string;
}): JejuComputeSDK {
  return new JejuComputeSDK({
    rpcUrl: config.rpcUrl,
    signer: config.privateKey ? new Wallet(config.privateKey) : undefined,
    contracts: {
      registry: config.registryAddress,
      ledger: config.ledgerAddress,
      inference: config.inferenceAddress,
      rental: config.rentalAddress,
    },
  });
}
