/**
 * x402 Payment Protocol - HTTP 402 micropayments
 * @see https://x402.org
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

export const X402_NETWORKS: Record<X402Network, X402NetworkConfig> = {
  sepolia: { name: 'Sepolia', chainId: 11155111, rpcUrl: 'https://sepolia.ethereum.org', blockExplorer: 'https://sepolia.etherscan.io', isTestnet: true, usdc: ZERO_ADDRESS },
  'base-sepolia': { name: 'Base Sepolia', chainId: 84532, rpcUrl: 'https://sepolia.base.org', blockExplorer: 'https://sepolia.basescan.org', isTestnet: true, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address },
  ethereum: { name: 'Ethereum', chainId: 1, rpcUrl: 'https://eth.llamarpc.com', blockExplorer: 'https://etherscan.io', isTestnet: false, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address },
  base: { name: 'Base', chainId: 8453, rpcUrl: 'https://mainnet.base.org', blockExplorer: 'https://basescan.org', isTestnet: false, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address },
  jeju: { name: 'Jeju Localnet', chainId: 9545, rpcUrl: 'http://localhost:9545', blockExplorer: '', isTestnet: true, usdc: ZERO_ADDRESS },
  'jeju-testnet': { name: 'Jeju Testnet', chainId: 84532, rpcUrl: 'https://sepolia.base.org', blockExplorer: 'https://sepolia.basescan.org', isTestnet: true, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address },
};

export const X402_NETWORK_CONFIGS = X402_NETWORKS;
export const X402_CHAIN_IDS: Record<X402Network, number> = Object.fromEntries(Object.entries(X402_NETWORKS).map(([k, v]) => [k, v.chainId])) as Record<X402Network, number>;
export const X402_USDC_ADDRESSES: Record<X402Network, Address> = Object.fromEntries(Object.entries(X402_NETWORKS).map(([k, v]) => [k, v.usdc])) as Record<X402Network, Address>;
export const X402_RPC_URLS: Record<X402Network, string> = Object.fromEntries(Object.entries(X402_NETWORKS).map(([k, v]) => [k, v.rpcUrl])) as Record<X402Network, string>;

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

export const parseX402PaymentHeader = parseX402Header;

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

export function formatPriceUSD(amountWei: bigint, ethPrice = 3000): string {
  return `$${(Number(amountWei) / 1e18 * ethPrice).toFixed(4)}`;
}

export function formatPriceETH(amountWei: bigint): string {
  const eth = Number(amountWei) / 1e18;
  return eth < 0.0001 ? `${(Number(amountWei) / 1e9).toFixed(2)} gwei` : `${eth.toFixed(6)} ETH`;
}

export function getDetailedPriceEstimate(modelType: PricingModelType, units: number): { amount: bigint; currency: 'ETH'; breakdown: { basePrice: bigint; unitCount: number; unitType: string } } {
  const amount = estimatePrice(modelType, units);
  return { amount, currency: 'ETH', breakdown: { basePrice: amount, unitCount: units, unitType: modelType } };
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

export const estimateInferencePrice = (_model: string, tokens?: number, modelType: PricingModelType = 'llm') => estimatePrice(modelType, tokens);
export const createX402PaymentRequirement = (p: { network: X402Network; recipient: Address; amount: bigint; resource: string; description: string }) => createPaymentRequirement(p.resource, p.amount, p.recipient, p.description, p.network);
