/**
 * x402 Payment Client SDK
 * 
 * Complete client library for x402 payments:
 * - Payment payload creation and signing
 * - Facilitator discovery via ERC-8004
 * - On-chain settlement
 * - Wallet integration (viem/ethers)
 * 
 * @example
 * ```typescript
 * import { X402Client, discoverFacilitator } from './x402-client';
 * 
 * // Discover facilitator from ERC-8004 registry
 * const facilitator = await discoverFacilitator(provider, 420691);
 * 
 * // Create client
 * const client = new X402Client({
 *   facilitatorAddress: facilitator.address,
 *   chainId: 420691,
 *   signer: wallet,
 * });
 * 
 * // Make a payment
 * const result = await client.pay({
 *   recipient: serviceAddress,
 *   amount: parseUnits('1', 6), // $1 USDC
 *   resource: '/api/premium',
 * });
 * ```
 */

import { 
  Address, 
  createPublicClient, 
  createWalletClient, 
  http, 
  keccak256,
  toHex,
  stringToBytes,
  Hex,
  Chain,
  PublicClient,
  WalletClient,
  Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============ Types ============

export interface X402ClientConfig {
  facilitatorAddress: Address;
  chainId: number;
  rpcUrl?: string;
  signer?: `0x${string}` | Account;
}

export interface PaymentParams {
  recipient: Address;
  token?: Address;
  amount: bigint;
  resource: string;
}

export interface PaymentResult {
  success: boolean;
  paymentId: Hex;
  txHash: Hex;
  payer: Address;
  recipient: Address;
  amount: bigint;
  protocolFee: bigint;
  timestamp: number;
}

export interface SignedPayment {
  payer: Address;
  recipient: Address;
  token: Address;
  amount: bigint;
  resource: string;
  nonce: string;
  timestamp: number;
  signature: Hex;
}

export interface FacilitatorInfo {
  address: Address;
  name: string;
  chainId: number;
  supportedTokens: Address[];
  protocolFeeBps: number;
  totalSettlements: bigint;
  totalVolumeUSD: bigint;
}

// ============ ABIs ============

const X402_FACILITATOR_ABI = [
  {
    type: 'function',
    name: 'settle',
    inputs: [
      { name: 'payer', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'resource', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'paymentId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'hashPayment',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'resource', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isNonceUsed',
    inputs: [
      { name: 'payer', type: 'address' },
      { name: 'nonce', type: 'string' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'supportedTokens',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getStats',
    inputs: [],
    outputs: [
      { name: 'settlements', type: 'uint256' },
      { name: 'volumeUSD', type: 'uint256' },
      { name: 'feeBps', type: 'uint256' },
      { name: 'feeAddr', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'domainSeparator',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'PaymentSettled',
    inputs: [
      { name: 'paymentId', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'protocolFee', type: 'uint256', indexed: false },
      { name: 'resource', type: 'string', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

const IDENTITY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getMetadata',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'agentExists',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

// ============ Constants ============

export const CHAIN_CONFIGS: Record<number, { name: string; rpcUrl: string; usdc: Address }> = {
  420691: {
    name: 'Jeju',
    rpcUrl: process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    usdc: '0x0165878A594ca255338adfa4d48449f69242Eb8F' as Address,
  },
  420690: {
    name: 'Jeju Testnet',
    rpcUrl: 'https://testnet-rpc.jeju.network',
    usdc: '0x0000000000000000000000000000000000000000' as Address,
  },
  11155111: {
    name: 'Sepolia',
    rpcUrl: 'https://sepolia.ethereum.org',
    usdc: '0x0000000000000000000000000000000000000000' as Address,
  },
  1: {
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
  },
};

// EIP-712 types for x402 payments
const PAYMENT_TYPES = {
  Payment: [
    { name: 'scheme', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'asset', type: 'address' },
    { name: 'payTo', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'resource', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const;

// ============ X402 Client ============

export class X402Client {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private config: X402ClientConfig;
  private account: Account | null = null;

  constructor(config: X402ClientConfig) {
    this.config = config;
    const chainConfig = CHAIN_CONFIGS[config.chainId];
    const rpcUrl = config.rpcUrl || chainConfig?.rpcUrl || 'http://127.0.0.1:9545';

    const chain: Chain = {
      id: config.chainId,
      name: chainConfig?.name || 'Unknown',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    };

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    if (config.signer) {
      if (typeof config.signer === 'string') {
        this.account = privateKeyToAccount(config.signer);
      } else {
        this.account = config.signer;
      }

      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(rpcUrl),
      });
    }
  }

  /**
   * Get facilitator info
   */
  async getFacilitatorInfo(): Promise<FacilitatorInfo> {
    const stats = await this.publicClient.readContract({
      address: this.config.facilitatorAddress,
      abi: X402_FACILITATOR_ABI,
      functionName: 'getStats',
    });

    const [settlements, volumeUSD, feeBps] = stats as [bigint, bigint, bigint, Address];

    return {
      address: this.config.facilitatorAddress,
      name: 'x402 Facilitator',
      chainId: this.config.chainId,
      supportedTokens: [CHAIN_CONFIGS[this.config.chainId]?.usdc || '0x0000000000000000000000000000000000000000' as Address],
      protocolFeeBps: Number(feeBps),
      totalSettlements: settlements,
      totalVolumeUSD: volumeUSD,
    };
  }

  /**
   * Check if token is supported
   */
  async isTokenSupported(token: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.config.facilitatorAddress,
      abi: X402_FACILITATOR_ABI,
      functionName: 'supportedTokens',
      args: [token],
    }) as Promise<boolean>;
  }

  /**
   * Check if a nonce has been used
   */
  async isNonceUsed(payer: Address, nonce: string): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.config.facilitatorAddress,
      abi: X402_FACILITATOR_ABI,
      functionName: 'isNonceUsed',
      args: [payer, nonce],
    }) as Promise<boolean>;
  }

  /**
   * Generate a unique nonce
   */
  generateNonce(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Create and sign a payment payload
   */
  async createSignedPayment(params: PaymentParams): Promise<SignedPayment> {
    if (!this.account || !this.walletClient) {
      throw new Error('Wallet not connected');
    }

    const token = params.token || CHAIN_CONFIGS[this.config.chainId]?.usdc;
    if (!token) throw new Error('No token specified and no default USDC for chain');

    const nonce = this.generateNonce();
    const timestamp = Math.floor(Date.now() / 1000);
    const payer = this.account.address;

    const domain = {
      name: 'x402 Payment Protocol',
      version: '1',
      chainId: this.config.chainId,
      verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
    };

    const message = {
      scheme: 'exact',
      network: 'jeju',
      asset: token,
      payTo: params.recipient,
      amount: params.amount,
      resource: params.resource,
      nonce,
      timestamp: BigInt(timestamp),
    };

    const signature = await this.walletClient.signTypedData({
      account: this.account,
      domain,
      types: PAYMENT_TYPES,
      primaryType: 'Payment',
      message,
    });

    return {
      payer,
      recipient: params.recipient,
      token,
      amount: params.amount,
      resource: params.resource,
      nonce,
      timestamp,
      signature,
    };
  }

  /**
   * Ensure token approval for facilitator
   */
  async ensureApproval(token: Address, amount: bigint): Promise<Hex | null> {
    if (!this.account || !this.walletClient) {
      throw new Error('Wallet not connected');
    }

    const currentAllowance = await this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [this.account.address, this.config.facilitatorAddress],
    }) as bigint;

    if (currentAllowance >= amount) {
      return null; // Already approved
    }

    const hash = await this.walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [this.config.facilitatorAddress, amount],
      account: this.account,
      chain: this.publicClient.chain,
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Execute a payment
   */
  async pay(params: PaymentParams): Promise<PaymentResult> {
    if (!this.account || !this.walletClient) {
      throw new Error('Wallet not connected');
    }

    const token = params.token || CHAIN_CONFIGS[this.config.chainId]?.usdc;
    if (!token) throw new Error('No token specified');

    // Ensure approval
    await this.ensureApproval(token, params.amount);

    // Create signed payment
    const signedPayment = await this.createSignedPayment(params);

    // Submit to facilitator
    const hash = await this.walletClient.writeContract({
      address: this.config.facilitatorAddress,
      abi: X402_FACILITATOR_ABI,
      functionName: 'settle',
      args: [
        signedPayment.payer,
        signedPayment.recipient,
        signedPayment.token,
        signedPayment.amount,
        signedPayment.resource,
        signedPayment.nonce,
        BigInt(signedPayment.timestamp),
        signedPayment.signature,
      ],
      account: this.account,
      chain: this.publicClient.chain,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    // Parse PaymentSettled event
    const settledLog = receipt.logs.find(log => {
      const topic = log.topics[0];
      return topic === keccak256(stringToBytes('PaymentSettled(bytes32,address,address,address,uint256,uint256,string,uint256)'));
    });

    const info = await this.getFacilitatorInfo();
    const protocolFee = (params.amount * BigInt(info.protocolFeeBps)) / 10000n;

    return {
      success: receipt.status === 'success',
      paymentId: (settledLog?.topics[1] || '0x') as Hex,
      txHash: hash,
      payer: signedPayment.payer,
      recipient: signedPayment.recipient,
      amount: signedPayment.amount,
      protocolFee,
      timestamp: signedPayment.timestamp,
    };
  }

  /**
   * Get token balance
   */
  async getBalance(token: Address): Promise<{ balance: bigint; symbol: string; decimals: number }> {
    if (!this.account) throw new Error('Wallet not connected');

    const [balance, symbol, decimals] = await Promise.all([
      this.publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.account.address],
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'symbol',
      }) as Promise<string>,
      this.publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'decimals',
      }) as Promise<number>,
    ]);

    return { balance, symbol, decimals };
  }
}

// ============ Discovery Functions ============

/**
 * Discover x402 facilitator from ERC-8004 registry
 */
export async function discoverFacilitator(
  registryAddress: Address,
  agentId: bigint,
  rpcUrl: string
): Promise<{ address: Address; endpoint: string } | null> {
  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  const exists = await client.readContract({
    address: registryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'agentExists',
    args: [agentId],
  }) as boolean;

  if (!exists) return null;

  const [facilitatorData, endpointData] = await Promise.all([
    client.readContract({
      address: registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getMetadata',
      args: [agentId, 'x402.facilitator'],
    }) as Promise<Hex>,
    client.readContract({
      address: registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getMetadata',
      args: [agentId, 'x402.endpoint'],
    }) as Promise<Hex>,
  ]);

  if (!facilitatorData || facilitatorData === '0x') return null;

  // Decode address from bytes
  const address = ('0x' + facilitatorData.slice(26)) as Address;
  const endpoint = new TextDecoder().decode(Buffer.from(endpointData.slice(2), 'hex'));

  return { address, endpoint };
}

/**
 * Register as x402 payment provider in ERC-8004
 */
export async function registerAsPaymentProvider(
  registryAddress: Address,
  facilitatorAddress: Address,
  endpoint: string,
  walletClient: WalletClient,
  account: Account
): Promise<Hex> {
  const REGISTRY_ABI = [
    {
      type: 'function',
      name: 'setMetadata',
      inputs: [
        { name: 'agentId', type: 'uint256' },
        { name: 'key', type: 'string' },
        { name: 'value', type: 'bytes' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ] as const;

  // Set facilitator address
  await walletClient.writeContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'setMetadata',
    args: [
      1n, // Agent ID (would be dynamic)
      'x402.facilitator',
      facilitatorAddress as Hex,
    ],
    account,
    chain: walletClient.chain,
  });

  // Set endpoint
  const hash2 = await walletClient.writeContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'setMetadata',
    args: [
      1n,
      'x402.endpoint',
      toHex(new TextEncoder().encode(endpoint)),
    ],
    account,
    chain: walletClient.chain,
  });

  return hash2;
}

// ============ HTTP Header Utilities ============

/**
 * Encode signed payment as x402 header
 */
export function encodePaymentHeader(payment: SignedPayment): string {
  const payload = {
    scheme: 'exact',
    network: 'jeju',
    asset: payment.token,
    payTo: payment.recipient,
    amount: payment.amount.toString(),
    resource: payment.resource,
    nonce: payment.nonce,
    timestamp: payment.timestamp,
    signature: payment.signature,
  };
  
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Decode x402 header to payment
 */
export function decodePaymentHeader(header: string): SignedPayment | null {
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString());
    return {
      payer: decoded.from || '0x0000000000000000000000000000000000000000',
      recipient: decoded.payTo,
      token: decoded.asset,
      amount: BigInt(decoded.amount),
      resource: decoded.resource,
      nonce: decoded.nonce,
      timestamp: decoded.timestamp,
      signature: decoded.signature,
    };
  } catch {
    return null;
  }
}

// ============ Factory ============

export function createX402Client(config: Partial<X402ClientConfig> & { chainId: number }): X402Client {
  const facilitatorAddress = (process.env.X402_FACILITATOR_ADDRESS || 
    '0x0000000000000000000000000000000000000000') as Address;
  
  return new X402Client({
    facilitatorAddress: config.facilitatorAddress || facilitatorAddress,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    signer: config.signer,
  });
}

