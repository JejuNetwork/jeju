/**
 * x402 Payment Protocol - HTTP 402 micropayments
 * @see https://x402.org
 *
 * Two modes of operation:
 * 1. SIGNATURE-ONLY: X402Client - verifies intent, not actual transfer (micropayments)
 * 2. ON-CHAIN: X402SettlementClient - full settlement via X402Facilitator contract
 *
 * Use signature mode for low-value micropayments, on-chain for larger amounts.
 */

import type { Address } from 'viem';
import { Wallet, verifyMessage } from 'ethers';

export type X402Network = 'sepolia' | 'base-sepolia' | 'ethereum' | 'base' | 'jeju' | 'jeju-testnet';

export interface X402NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  blockExplorer: string;
  isTestnet: boolean;
  usdc: Address;
}

export interface X402PaymentRequirement {
  x402Version: number;
  error: string;
  accepts: X402PaymentOption[];
}

export interface X402PaymentOption {
  scheme: 'exact' | 'credit' | 'paymaster' | string;
  network: X402Network | string;
  maxAmountRequired: string;
  asset: Address;
  payTo: Address;
  resource: string;
  description: string;
}

export interface X402PaymentHeader {
  scheme: string;
  network: string;
  payload: string;
  asset: string;
  amount: string;
}

export interface X402Config {
  enabled: boolean;
  recipientAddress: Address;
  network: X402Network;
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
export const CREDITS_PER_DOLLAR = 100;
const JEJU_TOKEN_ADDRESS = (process.env.JEJU_TOKEN_ADDRESS || ZERO_ADDRESS) as Address;

/** USDC may migrate - monitor https://www.circle.com/en/usdc-multichain */
export const X402_NETWORKS: Record<X402Network, X402NetworkConfig> = {
  sepolia: { name: 'Sepolia', chainId: 11155111, rpcUrl: 'https://sepolia.ethereum.org', blockExplorer: 'https://sepolia.etherscan.io', isTestnet: true, usdc: ZERO_ADDRESS },
  'base-sepolia': { name: 'Base Sepolia', chainId: 84532, rpcUrl: 'https://sepolia.base.org', blockExplorer: 'https://sepolia.basescan.org', isTestnet: true, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address },
  ethereum: { name: 'Ethereum', chainId: 1, rpcUrl: 'https://eth.llamarpc.com', blockExplorer: 'https://etherscan.io', isTestnet: false, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address },
  base: { name: 'Base', chainId: 8453, rpcUrl: 'https://mainnet.base.org', blockExplorer: 'https://basescan.org', isTestnet: false, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address },
  jeju: { name: 'Jeju Localnet', chainId: 9545, rpcUrl: 'http://localhost:9545', blockExplorer: '', isTestnet: true, usdc: ZERO_ADDRESS },
  'jeju-testnet': { name: 'Jeju Testnet', chainId: 84532, rpcUrl: 'https://sepolia.base.org', blockExplorer: 'https://sepolia.basescan.org', isTestnet: true, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address },
};

// Derived lookups for convenience
const derive = <T>(f: keyof X402NetworkConfig) => Object.fromEntries(Object.entries(X402_NETWORKS).map(([k, v]) => [k, v[f]])) as Record<X402Network, T>;
export const X402_CHAIN_IDS = derive<number>('chainId');
export const X402_USDC_ADDRESSES = derive<Address>('usdc');

export function getX402Config(): X402Config & { creditsPerDollar: number } {
  return {
    enabled: process.env.X402_ENABLED !== 'false',
    recipientAddress: (process.env.X402_RECIPIENT_ADDRESS || ZERO_ADDRESS) as Address,
    network: (process.env.X402_NETWORK || 'jeju') as X402Network,
    creditsPerDollar: CREDITS_PER_DOLLAR,
  };
}

export function isX402Configured(): boolean {
  const config = getX402Config();
  return config.enabled && config.recipientAddress !== ZERO_ADDRESS;
}

export function getX402NetworkConfig(network?: X402Network): X402NetworkConfig {
  return X402_NETWORKS[network || getX402Config().network];
}

export function parseX402Header(header: string): X402PaymentHeader | null {
  const parts: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [key, value] = part.split('=');
    if (key && value) parts[key.trim()] = value.trim();
  }
  if (!parts.scheme || !parts.network || !parts.payload) return null;
  return { scheme: parts.scheme, network: parts.network, payload: parts.payload, asset: parts.asset || ZERO_ADDRESS, amount: parts.amount || '0' };
}

export async function generateX402PaymentHeader(signer: Wallet, providerAddress: Address, amount: string, network: X402Network = 'jeju'): Promise<string> {
  const signature = await signer.signMessage(`x402:${network}:${providerAddress}:${amount}`);
  return `scheme=exact;network=${network};payload=${signature};asset=${ZERO_ADDRESS};amount=${amount}`;
}

export function verifyX402Payment(payment: X402PaymentHeader, providerAddress: Address, expectedUserAddress: Address): boolean {
  if (payment.scheme !== 'exact') return false;
  const recovered = verifyMessage(`x402:${payment.network}:${providerAddress}:${payment.amount}`, payment.payload);
  return recovered.toLowerCase() === expectedUserAddress.toLowerCase();
}

export function createPaymentRequirement(resource: string, amountWei: bigint, payTo: Address, description: string, network: X402Network = 'jeju'): X402PaymentRequirement {
  const usdc = X402_NETWORKS[network].usdc;
  return {
    x402Version: 1,
    error: 'Payment required to access compute service',
    accepts: [
      { scheme: 'exact', network, maxAmountRequired: amountWei.toString(), asset: usdc, payTo, resource, description },
      { scheme: 'credit', network, maxAmountRequired: amountWei.toString(), asset: ZERO_ADDRESS, payTo, resource, description: 'Pay from prepaid credit balance' },
    ],
  };
}

export const DEFAULT_PRICING = {
  LLM_PER_1K_INPUT: 10000000000000n,
  LLM_PER_1K_OUTPUT: 30000000000000n,
  IMAGE_1024: 300000000000000n,
  VIDEO_PER_SECOND: 1000000000000000n,
  AUDIO_PER_SECOND: 50000000000000n,
  STT_PER_MINUTE: 20000000000000n,
  TTS_PER_1K_CHARS: 50000000000000n,
  EMBEDDING_PER_1K: 3000000000000n,
  MIN_FEE: 10000000000000n,
} as const;

export type PricingModelType = 'llm' | 'image' | 'video' | 'audio' | 'stt' | 'tts' | 'embedding';

export function estimatePrice(modelType: PricingModelType, units = 1000): bigint {
  switch (modelType) {
    case 'llm': return (DEFAULT_PRICING.LLM_PER_1K_INPUT + DEFAULT_PRICING.LLM_PER_1K_OUTPUT / 2n) * BigInt(units) / 1000n;
    case 'image': return DEFAULT_PRICING.IMAGE_1024;
    case 'video': return DEFAULT_PRICING.VIDEO_PER_SECOND * BigInt(units);
    case 'audio': return DEFAULT_PRICING.AUDIO_PER_SECOND * BigInt(units);
    case 'stt': return DEFAULT_PRICING.STT_PER_MINUTE * BigInt(Math.ceil(units / 60));
    case 'tts': return DEFAULT_PRICING.TTS_PER_1K_CHARS * BigInt(units) / 1000n;
    case 'embedding': return DEFAULT_PRICING.EMBEDDING_PER_1K * BigInt(units) / 1000n;
  }
}

// ETH_PRICE_USD should be set in production for accurate pricing
const DEFAULT_ETH_PRICE = parseInt(process.env.ETH_PRICE_USD ?? '3000', 10);

export function getEthPrice(): number {
  if (!process.env.ETH_PRICE_USD && process.env.NODE_ENV === 'production') {
    console.warn('[x402] ETH_PRICE_USD not set - using $3000 default. Set ETH_PRICE_USD for accurate pricing.');
  }
  return DEFAULT_ETH_PRICE;
}

export function formatPriceUSD(amountWei: bigint, ethPrice = getEthPrice()): string {
  return `$${(Number(amountWei) / 1e18 * ethPrice).toFixed(4)}`;
}

export function formatPriceETH(amountWei: bigint): string {
  const eth = Number(amountWei) / 1e18;
  return eth < 0.0001 ? `${(Number(amountWei) / 1e9).toFixed(2)} gwei` : `${eth.toFixed(6)} ETH`;
}

export class X402Client {
  constructor(private signer: Wallet, private network: X402Network = getX402Config().network) {}

  async generatePayment(providerAddress: Address, amount: string): Promise<string> {
    return generateX402PaymentHeader(this.signer, providerAddress, amount, this.network);
  }

  verifyPayment(payment: X402PaymentHeader, providerAddress: Address): boolean {
    return verifyX402Payment(payment, providerAddress, this.signer.address as Address);
  }

  async paidFetch(url: string, options: RequestInit, providerAddress: Address, amount: string): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set('X-Payment', await this.generatePayment(providerAddress, amount));
    headers.set('x-jeju-address', this.signer.address);
    return fetch(url, { ...options, headers });
  }

  async handlePaymentRequired(response: Response, url: string, options: RequestInit): Promise<Response> {
    if (response.status !== 402) return response;
    const req = await response.json() as X402PaymentRequirement;
    const exact = req.accepts.find(a => a.scheme === 'exact');
    if (!exact) throw new Error('No exact payment scheme');
    return this.paidFetch(url, options, exact.payTo, exact.maxAmountRequired);
  }

  getAddress(): Address { return this.signer.address as Address; }
  getNetworkConfig(): X402NetworkConfig { return X402_NETWORKS[this.network]; }
}

// X402 Facilitator ABI for on-chain settlement
const X402_FACILITATOR_ABI = [
  'function settle(address payer, address recipient, address token, uint256 amount, string resource, string nonce, uint256 timestamp, bytes signature) returns (bytes32)',
  'function isNonceUsed(address payer, string nonce) view returns (bool)',
  'function hashPayment(address token, address recipient, uint256 amount, string resource, string nonce, uint256 timestamp) view returns (bytes32)',
  'function domainSeparator() view returns (bytes32)',
];

// EIP-712 domain and types for X402 payment signing
const X402_EIP712_DOMAIN = {
  name: 'x402 Payment Protocol',
  version: '1',
} as const;

const X402_EIP712_TYPES = {
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
};

export interface OnChainSettlementConfig {
  facilitatorAddress: Address;
  rpcUrl: string;
}

/**
 * X402 On-Chain Settlement Client
 * Settles x402 payments via the X402Facilitator contract
 */
export class X402SettlementClient {
  private network: X402Network;

  constructor(
    private signer: Wallet,
    private config: OnChainSettlementConfig,
    network: X402Network = 'jeju'
  ) {
    this.network = network;
  }

  getNetwork(): X402Network { return this.network; }

  private async getFacilitator(signed = false) {
    const { Contract, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(this.config.rpcUrl);
    const signerOrProvider = signed ? this.signer.connect(provider) : provider;
    return new Contract(this.config.facilitatorAddress, X402_FACILITATOR_ABI, signerOrProvider);
  }

  async signPayment(params: {
    token: Address;
    recipient: Address;
    amount: bigint;
    resource: string;
    nonce?: string;
    timestamp?: number;
  }): Promise<{ signature: string; nonce: string; timestamp: number }> {
    const nonce = params.nonce ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
    const networkConfig = getX402NetworkConfig(this.network);

    const domain = {
      ...X402_EIP712_DOMAIN,
      chainId: networkConfig.chainId,
      verifyingContract: this.config.facilitatorAddress,
    };

    const value = {
      scheme: 'exact',
      network: 'jeju',
      asset: params.token,
      payTo: params.recipient,
      amount: params.amount,
      resource: params.resource,
      nonce,
      timestamp,
    };

    const signature = await this.signer.signTypedData(domain, X402_EIP712_TYPES, value);
    return { signature, nonce, timestamp };
  }

  async settle(params: {
    payer: Address;
    recipient: Address;
    token: Address;
    amount: bigint;
    resource: string;
    nonce: string;
    timestamp: number;
    signature: string;
  }): Promise<string> {
    const facilitator = await this.getFacilitator(true);
    const tx = await facilitator.settle(
      params.payer, params.recipient, params.token, params.amount,
      params.resource, params.nonce, params.timestamp, params.signature
    );
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async isNonceUsed(payer: Address, nonce: string): Promise<boolean> {
    const facilitator = await this.getFacilitator();
    return facilitator.isNonceUsed(payer, nonce);
  }
}

export function createX402SettlementClient(signer: Wallet, config: OnChainSettlementConfig, network?: X402Network): X402SettlementClient {
  return new X402SettlementClient(signer, config, network ?? getX402Config().network);
}

import type { Context, Next } from 'hono';

export function createX402Middleware(config: X402Config) {
  return async (c: Context, next: Next) => {
    if (!config.enabled) return next();

    const header = c.req.header('X-Payment');
    if (!header) {
      return c.json({
        x402Version: 1,
        error: 'Payment required',
        accepts: [{ scheme: 'exact', network: config.network, asset: ZERO_ADDRESS, payTo: config.recipientAddress, resource: c.req.path, description: 'API access' }],
      }, 402);
    }

    const parsed = parseX402Header(header);
    if (!parsed) return c.json({ error: 'Invalid payment header' }, 400);

    c.set('x402Payment', parsed);
    return next();
  };
}

export function createMultiAssetPaymentRequirement(
  resource: string, amountWei: bigint, payTo: Address, description: string,
  network: X402Network = 'jeju', supportedAssets: Array<{ address: Address; symbol: string; decimals: number }> = []
): X402PaymentRequirement {
  const accepts: X402PaymentOption[] = [];
  if (JEJU_TOKEN_ADDRESS !== ZERO_ADDRESS) accepts.push({ scheme: 'paymaster', network, maxAmountRequired: amountWei.toString(), asset: JEJU_TOKEN_ADDRESS, payTo, resource, description: `${description} (JEJU)` });
  accepts.push({ scheme: 'exact', network, maxAmountRequired: amountWei.toString(), asset: ZERO_ADDRESS, payTo, resource, description: `${description} (ETH)` });
  accepts.push({ scheme: 'credit', network, maxAmountRequired: amountWei.toString(), asset: ZERO_ADDRESS, payTo, resource, description: 'Pay from prepaid credit balance' });
  for (const asset of supportedAssets) {
    if (asset.symbol === 'JEJU') continue;
    accepts.push({ scheme: 'paymaster', network, maxAmountRequired: amountWei.toString(), asset: asset.address, payTo, resource, description: `${description} (${asset.symbol} via paymaster)` });
  }
  return { x402Version: 1, error: 'Payment required to access compute service', accepts };
}

