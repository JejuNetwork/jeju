/**
 * @fileoverview Compute Solver - Handles compute rental and inference intents
 * 
 * Extends the base solver to recognize and fill compute-specific intents:
 * - ComputeRental: Creates hourly GPU/CPU rentals for users
 * - ComputeInference: Executes AI inference requests
 */

import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Chain, encodeFunctionData, parseAbi, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism, sepolia } from 'viem/chains';
import type { IntentEvent } from './monitor';

// Order type constants (must match IOIF.sol)
const COMPUTE_RENTAL_ORDER_TYPE = keccak256(toHex('ComputeRental'));
const COMPUTE_INFERENCE_ORDER_TYPE = keccak256(toHex('ComputeInference'));

// Custom Jeju chain definition
const jeju: Chain = {
  id: 420691,
  name: 'Jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.JEJU_RPC_URL || 'http://localhost:8545'] },
  },
};

interface ComputeRentalOrderData {
  provider: `0x${string}`;
  durationHours: bigint;
  sshPublicKey: string;
  containerImage: string;
  startupScript: string;
}

interface ComputeInferenceOrderData {
  provider: `0x${string}`;
  model: string;
  prompt: `0x${string}`;
  maxInputTokens: bigint;
  maxOutputTokens: bigint;
}

interface ComputeIntentEvent extends IntentEvent {
  orderType: `0x${string}`;
  rentalData?: ComputeRentalOrderData;
  inferenceData?: ComputeInferenceOrderData;
}

interface ComputeSolverConfig {
  chains: Array<{ chainId: number; name: string; rpcUrl: string }>;
  computeChainId: number; // Chain where compute contracts are deployed
  minProfitBps: number;
  maxGasPrice: bigint;
}

const COMPUTE_OUTPUT_SETTLER_ABI = parseAbi([
  'function fillComputeRental(bytes32 orderId, (address provider, uint256 durationHours, string sshPublicKey, string containerImage, string startupScript) data, address user, uint256 payment) returns (bytes32)',
  'function fillComputeInference(bytes32 orderId, (address provider, string model, bytes prompt, uint256 maxInputTokens, uint256 maxOutputTokens) data, address user, uint256 payment)',
  'function depositETH() payable',
  'function solverETH(address) view returns (uint256)',
]);

export class ComputeSolver {
  private config: ComputeSolverConfig;
  private clients: Map<number, { public: PublicClient; wallet?: WalletClient }> = new Map();
  private running = false;
  private pendingFills: Set<string> = new Set();
  private computeProviders: Map<string, ProviderInfo> = new Map();

  constructor(config: ComputeSolverConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.log('🖥️  Starting Compute Solver...');

    // Initialize clients
    for (const chain of this.config.chains) {
      const chainDef = this.getChainDef(chain.chainId);
      const publicClient = createPublicClient({
        chain: chainDef,
        transport: http(chain.rpcUrl),
      });

      const privateKey = process.env.SOLVER_PRIVATE_KEY;
      let walletClient: WalletClient | undefined;
      if (privateKey) {
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        walletClient = createWalletClient({
          account,
          chain: chainDef,
          transport: http(chain.rpcUrl),
        });
      }

      this.clients.set(chain.chainId, { public: publicClient, wallet: walletClient });
      console.log(`   ✓ Connected to ${chain.name}`);
    }

    // Load compute providers from registry
    await this.loadComputeProviders();

    this.running = true;
    console.log('✅ Compute Solver running');
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log('Compute Solver stopped');
  }

  /**
   * Check if an intent is a compute intent
   */
  isComputeIntent(event: IntentEvent): boolean {
    const orderType = event.orderType as `0x${string}` | undefined;
    return orderType === COMPUTE_RENTAL_ORDER_TYPE || orderType === COMPUTE_INFERENCE_ORDER_TYPE;
  }

  /**
   * Handle a compute intent
   */
  async handleComputeIntent(event: ComputeIntentEvent): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const { orderId, orderType } = event;

    if (this.pendingFills.has(orderId)) {
      return { success: false, error: 'Already processing' };
    }

    console.log(`\n🖥️  Compute Intent: ${orderId.slice(0, 10)}...`);
    console.log(`   Type: ${orderType === COMPUTE_RENTAL_ORDER_TYPE ? 'Rental' : 'Inference'}`);

    this.pendingFills.add(orderId);

    let result: { success: boolean; txHash?: string; error?: string };

    if (orderType === COMPUTE_RENTAL_ORDER_TYPE && event.rentalData) {
      result = await this.fillRentalIntent(orderId, event.rentalData, event.user, event.inputAmount);
    } else if (orderType === COMPUTE_INFERENCE_ORDER_TYPE && event.inferenceData) {
      result = await this.fillInferenceIntent(orderId, event.inferenceData, event.user, event.inputAmount);
    } else {
      result = { success: false, error: 'Invalid compute intent data' };
    }

    this.pendingFills.delete(orderId);
    return result;
  }

  /**
   * Fill a compute rental intent
   */
  private async fillRentalIntent(
    orderId: string,
    data: ComputeRentalOrderData,
    user: string,
    paymentAmount: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const client = this.clients.get(this.config.computeChainId);
    if (!client?.wallet) {
      return { success: false, error: 'No wallet for compute chain' };
    }

    const outputSettler = this.getComputeOutputSettler();
    if (!outputSettler) {
      return { success: false, error: 'ComputeOutputSettler not configured' };
    }

    // Check provider is available
    const providerInfo = this.computeProviders.get(data.provider.toLowerCase());
    if (!providerInfo?.isActive) {
      return { success: false, error: `Provider ${data.provider} not available` };
    }

    console.log(`   Provider: ${data.provider.slice(0, 10)}...`);
    console.log(`   Duration: ${data.durationHours}h`);
    console.log(`   Payment: ${paymentAmount}`);

    // Ensure we have enough ETH deposited
    const solverBalance = await client.public.readContract({
      address: outputSettler,
      abi: COMPUTE_OUTPUT_SETTLER_ABI,
      functionName: 'solverETH',
      args: [client.wallet.account!.address],
    });

    const chainDef = this.getChainDef(this.config.computeChainId);
    const payment = BigInt(paymentAmount);
    if (solverBalance < payment) {
      // Deposit more ETH
      const depositAmount = payment - solverBalance + BigInt(1e17); // Extra buffer
      console.log(`   Depositing ${depositAmount} wei to settler...`);
      
      const depositHash = await client.wallet.writeContract({
        chain: chainDef,
        account: client.wallet.account!,
        address: outputSettler,
        abi: COMPUTE_OUTPUT_SETTLER_ABI,
        functionName: 'depositETH',
        value: depositAmount,
      });
      await client.public.waitForTransactionReceipt({ hash: depositHash });
    }

    // Execute fill
    const fillHash = await client.wallet.writeContract({
      chain: chainDef,
      account: client.wallet.account!,
      address: outputSettler,
      abi: COMPUTE_OUTPUT_SETTLER_ABI,
      functionName: 'fillComputeRental',
      args: [
        orderId as `0x${string}`,
        {
          provider: data.provider,
          durationHours: data.durationHours,
          sshPublicKey: data.sshPublicKey,
          containerImage: data.containerImage,
          startupScript: data.startupScript,
        },
        user as `0x${string}`,
        payment,
      ],
    });

    console.log(`   📝 Fill tx: ${fillHash}`);

    const receipt = await client.public.waitForTransactionReceipt({ hash: fillHash });
    
    if (receipt.status === 'reverted') {
      return { success: false, error: 'Transaction reverted' };
    }

    return { success: true, txHash: fillHash };
  }

  /**
   * Fill an inference intent
   */
  private async fillInferenceIntent(
    orderId: string,
    data: ComputeInferenceOrderData,
    user: string,
    paymentAmount: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const client = this.clients.get(this.config.computeChainId);
    if (!client?.wallet) {
      return { success: false, error: 'No wallet for compute chain' };
    }

    const outputSettler = this.getComputeOutputSettler();
    if (!outputSettler) {
      return { success: false, error: 'ComputeOutputSettler not configured' };
    }

    console.log(`   Model: ${data.model}`);
    console.log(`   Max tokens: ${data.maxInputTokens}/${data.maxOutputTokens}`);

    // For inference, we need to actually run the inference off-chain
    // This is a simplified version - real implementation would:
    // 1. Call the inference endpoint
    // 2. Get the response
    // 3. Submit the response to the settler
    
    const chainDef = this.getChainDef(this.config.computeChainId);
    const payment = BigInt(paymentAmount);

    const fillHash = await client.wallet.writeContract({
      chain: chainDef,
      account: client.wallet.account!,
      address: outputSettler,
      abi: COMPUTE_OUTPUT_SETTLER_ABI,
      functionName: 'fillComputeInference',
      args: [
        orderId as `0x${string}`,
        {
          provider: data.provider,
          model: data.model,
          prompt: data.prompt,
          maxInputTokens: data.maxInputTokens,
          maxOutputTokens: data.maxOutputTokens,
        },
        user as `0x${string}`,
        payment,
      ],
    });

    const receipt = await client.public.waitForTransactionReceipt({ hash: fillHash });
    
    if (receipt.status === 'reverted') {
      return { success: false, error: 'Transaction reverted' };
    }

    return { success: true, txHash: fillHash };
  }

  /**
   * Load available compute providers from registry
   */
  private async loadComputeProviders(): Promise<void> {
    const client = this.clients.get(this.config.computeChainId);
    if (!client) return;

    const registryAddress = process.env.COMPUTE_REGISTRY_ADDRESS as `0x${string}` | undefined;
    if (!registryAddress) {
      console.log('   ⚠️  COMPUTE_REGISTRY_ADDRESS not set');
      return;
    }

    const registryAbi = parseAbi([
      'function getActiveProviders() view returns (address[])',
      'function getProvider(address) view returns ((address owner, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active))',
    ]);

    const providers = await client.public.readContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: 'getActiveProviders',
    });

    for (const addr of providers) {
      const info = await client.public.readContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: 'getProvider',
        args: [addr],
      });

      this.computeProviders.set(addr.toLowerCase(), {
        address: addr,
        name: info.name,
        endpoint: info.endpoint,
        stake: info.stake,
        isActive: info.active,
      });
    }

    console.log(`   Loaded ${this.computeProviders.size} compute providers`);
  }

  private getComputeOutputSettler(): `0x${string}` | undefined {
    const addr = process.env.COMPUTE_OUTPUT_SETTLER_ADDRESS;
    if (addr && addr.startsWith('0x') && addr.length === 42) {
      return addr as `0x${string}`;
    }
    return undefined;
  }

  private getChainDef(chainId: number): Chain {
    switch (chainId) {
      case 1: return mainnet;
      case 42161: return arbitrum;
      case 10: return optimism;
      case 420691: return jeju;
      case 11155111: return sepolia;
      default: return mainnet;
    }
  }
}

interface ProviderInfo {
  address: `0x${string}`;
  name: string;
  endpoint: string;
  stake: bigint;
  isActive: boolean;
}

// Export for use in main solver
export { COMPUTE_RENTAL_ORDER_TYPE, COMPUTE_INFERENCE_ORDER_TYPE };
export type { ComputeIntentEvent, ComputeRentalOrderData, ComputeInferenceOrderData };

