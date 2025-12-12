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
  payload: string; // Signature or payment proof
  asset: string;
  amount: string;
}

export interface X402Config {
  enabled: boolean;
  recipientAddress: Address;
  network: X402Network;
  creditsPerDollar: number;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/** JEJU token address */
const JEJU_TOKEN_ADDRESS = (process.env.JEJU_TOKEN_ADDRESS || ZERO_ADDRESS) as Address;

export const X402_CHAIN_IDS: Record<X402Network, number> = {
  sepolia: 11155111,
  'base-sepolia': 84532,
  ethereum: 1,
  base: 8453,
  jeju: 9545, // Jeju localnet
  'jeju-testnet': 84532, // Uses Base Sepolia
};

export const X402_USDC_ADDRESSES: Record<X402Network, Address> = {
  sepolia: ZERO_ADDRESS, // No official USDC on Sepolia
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  jeju: ZERO_ADDRESS, // Native ETH on localnet
  'jeju-testnet': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

export const X402_RPC_URLS: Record<X402Network, string> = {
  sepolia: 'https://sepolia.ethereum.org',
  'base-sepolia': 'https://sepolia.base.org',
  ethereum: 'https://eth.llamarpc.com',
  base: 'https://mainnet.base.org',
  jeju: 'http://localhost:9545',
  'jeju-testnet': 'https://sepolia.base.org',
};

export const X402_NETWORK_CONFIGS: Record<X402Network, X402NetworkConfig> = {
  sepolia: {
    name: 'Sepolia',
    chainId: 11155111,
    rpcUrl: 'https://sepolia.ethereum.org',
    blockExplorer: 'https://sepolia.etherscan.io',
    isTestnet: true,
    usdc: ZERO_ADDRESS,
  },
  'base-sepolia': {
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    blockExplorer: 'https://sepolia.basescan.org',
    isTestnet: true,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
  },
  ethereum: {
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    blockExplorer: 'https://etherscan.io',
    isTestnet: false,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
  },
  base: {
    name: 'Base Mainnet',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    isTestnet: false,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
  },
  jeju: {
    name: 'Jeju Localnet',
    chainId: 9545,
    rpcUrl: 'http://localhost:9545',
    blockExplorer: '',
    isTestnet: true,
    usdc: ZERO_ADDRESS,
  },
  'jeju-testnet': {
    name: 'Jeju Testnet (Base Sepolia)',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    blockExplorer: 'https://sepolia.basescan.org',
    isTestnet: true,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
  },
};

export const CREDITS_PER_DOLLAR = 100;

export function getX402Config(): X402Config {
  const enabled = process.env.X402_ENABLED !== 'false';
  const recipientAddress = (process.env.X402_RECIPIENT_ADDRESS || ZERO_ADDRESS) as Address;
  const network = (process.env.X402_NETWORK || 'jeju') as X402Network;

  return {
    enabled,
    recipientAddress,
    network,
    creditsPerDollar: CREDITS_PER_DOLLAR,
  };
}

export function isX402Configured(): boolean {
  const config = getX402Config();
  return config.enabled && config.recipientAddress !== ZERO_ADDRESS;
}

export function getX402NetworkConfig(network?: X402Network): X402NetworkConfig {
  return X402_NETWORK_CONFIGS[network || getX402Config().network];
}

export function parseX402Header(header: string): X402PaymentHeader | null {
  const parts = header.split(';').reduce(
    (acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    },
    {} as Record<string, string>
  );

  if (!parts.scheme || !parts.network || !parts.payload) {
    return null;
  }

  return {
    scheme: parts.scheme,
    network: parts.network,
    payload: parts.payload,
    asset: parts.asset || ZERO_ADDRESS,
    amount: parts.amount || '0',
  };
}

export async function generateX402PaymentHeader(
  signer: Wallet,
  providerAddress: Address,
  amount: string,
  network: X402Network = 'jeju'
): Promise<string> {
  const message = `x402:${network}:${providerAddress}:${amount}`;
  const signature = await signer.signMessage(message);

  return [
    `scheme=exact`,
    `network=${network}`,
    `payload=${signature}`,
    `asset=${ZERO_ADDRESS}`,
    `amount=${amount}`,
  ].join(';');
}

export const parseX402PaymentHeader = parseX402Header;

export function verifyX402Payment(
  payment: X402PaymentHeader,
  providerAddress: Address,
  expectedUserAddress: Address
): boolean {
  if (payment.scheme !== 'exact') return false;

  const message = `x402:${payment.network}:${providerAddress}:${payment.amount}`;
  const recoveredAddress = verifyMessage(message, payment.payload);

  return recoveredAddress.toLowerCase() === expectedUserAddress.toLowerCase();
}

export function createPaymentRequirement(
  resource: string,
  amountWei: bigint,
  payTo: Address,
  description: string,
  network: X402Network = 'jeju'
): X402PaymentRequirement {
  const netConfig = getX402NetworkConfig(network);

  return {
    x402Version: 1,
    error: 'Payment required to access compute service',
    accepts: [
      {
        scheme: 'exact',
        network,
        maxAmountRequired: amountWei.toString(),
        asset: netConfig.usdc,
        payTo,
        resource,
        description,
      },
      {
        scheme: 'credit',
        network,
        maxAmountRequired: amountWei.toString(),
        asset: ZERO_ADDRESS,
        payTo,
        resource,
        description: 'Pay from prepaid credit balance',
      },
    ],
  };
}

export function createMultiAssetPaymentRequirement(
  resource: string,
  amountWei: bigint,
  payTo: Address,
  description: string,
  network: X402Network = 'jeju',
  supportedAssets: Array<{ address: Address; symbol: string; decimals: number }> = []
): X402PaymentRequirement {
  const accepts: X402PaymentOption[] = [];

  if (JEJU_TOKEN_ADDRESS !== ZERO_ADDRESS) {
    accepts.push({
      scheme: 'paymaster',
      network,
      maxAmountRequired: amountWei.toString(),
      asset: JEJU_TOKEN_ADDRESS,
      payTo,
      resource,
      description: `${description} (JEJU)`,
    });
  }

  // Native ETH
  accepts.push({
    scheme: 'exact',
    network,
    maxAmountRequired: amountWei.toString(),
    asset: ZERO_ADDRESS,
    payTo,
    resource,
    description: `${description} (ETH)`,
  });

  // Credit balance
  accepts.push({
    scheme: 'credit',
    network,
    maxAmountRequired: amountWei.toString(),
    asset: ZERO_ADDRESS,
    payTo,
    resource,
    description: 'Pay from prepaid credit balance',
  });

  // Add other supported ERC-20 tokens
  for (const asset of supportedAssets) {
    // Skip JEJU as it's already first
    if (asset.symbol === 'JEJU') continue;
    accepts.push({
      scheme: 'paymaster',
      network,
      maxAmountRequired: amountWei.toString(),
      asset: asset.address,
      payTo,
      resource,
      description: `${description} (${asset.symbol} via paymaster)`,
    });
  }

  return {
    x402Version: 1,
    error: 'Payment required to access compute service',
    accepts,
  };
}

export type PricingModelType = 
  | 'llm'
  | 'image-generation'
  | 'video-generation'
  | 'audio-generation'
  | 'speech-to-text'
  | 'text-to-speech'
  | 'embedding';

export const DEFAULT_PRICING = {
  LLM_PER_1K_INPUT: 10000000000000n,
  LLM_PER_1K_OUTPUT: 30000000000000n,
  IMAGE_512: 100000000000000n,
  IMAGE_1024: 300000000000000n,
  IMAGE_HD: 500000000000000n,
  VIDEO_PER_SECOND: 1000000000000000n,
  AUDIO_GEN_PER_SECOND: 50000000000000n,
  STT_PER_MINUTE: 20000000000000n,
  TTS_PER_1K_CHARS: 50000000000000n,
  EMBEDDING_PER_1K: 3000000000000n,
  MIN_FEE: 10000000000000n,
} as const;

export interface InferencePriceEstimate {
  amount: bigint;
  currency: 'ETH';
  breakdown: {
    basePrice: bigint;
    unitCount: number;
    unitType: string;
  };
}

export function estimateInferencePrice(
  _model: string,
  tokens?: number,
  modelType: PricingModelType = 'llm'
): bigint {
  switch (modelType) {
    case 'llm': {
      const inputTokens = tokens ?? 1000;
      const outputTokens = Math.floor(inputTokens * 0.5); // Estimate output as 50% of input
      const inputCost = (DEFAULT_PRICING.LLM_PER_1K_INPUT * BigInt(inputTokens)) / 1000n;
      const outputCost = (DEFAULT_PRICING.LLM_PER_1K_OUTPUT * BigInt(outputTokens)) / 1000n;
      return inputCost + outputCost > DEFAULT_PRICING.MIN_FEE 
        ? inputCost + outputCost 
        : DEFAULT_PRICING.MIN_FEE;
    }
    
    case 'image-generation':
      return DEFAULT_PRICING.IMAGE_1024;
    
    case 'video-generation': {
      const seconds = tokens ?? 5; // Default 5 seconds
      return DEFAULT_PRICING.VIDEO_PER_SECOND * BigInt(seconds);
    }
    
    case 'audio-generation': {
      const seconds = tokens ?? 10; // Default 10 seconds
      return DEFAULT_PRICING.AUDIO_GEN_PER_SECOND * BigInt(seconds);
    }
    
    case 'speech-to-text': {
      const minutes = Math.ceil((tokens ?? 60) / 60); // Assume tokens is seconds
      return DEFAULT_PRICING.STT_PER_MINUTE * BigInt(minutes);
    }
    
    case 'text-to-speech': {
      const chars = tokens ?? 1000;
      return (DEFAULT_PRICING.TTS_PER_1K_CHARS * BigInt(chars)) / 1000n;
    }
    
    case 'embedding': {
      const inputTokens = tokens ?? 1000;
      return (DEFAULT_PRICING.EMBEDDING_PER_1K * BigInt(inputTokens)) / 1000n;
    }
    
    default:
      return DEFAULT_PRICING.MIN_FEE;
  }
}

export function getDetailedPriceEstimate(
  modelType: PricingModelType,
  units: number
): InferencePriceEstimate {
  const amount = estimateInferencePrice('', units, modelType);
  
  const unitTypes: Record<PricingModelType, string> = {
    'llm': 'tokens',
    'image-generation': 'images',
    'video-generation': 'seconds',
    'audio-generation': 'seconds',
    'speech-to-text': 'seconds',
    'text-to-speech': 'characters',
    'embedding': 'tokens',
  };
  
  return {
    amount,
    currency: 'ETH',
    breakdown: {
      basePrice: amount,
      unitCount: units,
      unitType: unitTypes[modelType],
    },
  };
}

export function formatPriceUSD(amountWei: bigint, ethPriceUSD: number = 3000): string {
  const ethAmount = Number(amountWei) / 1e18;
  return `$${(ethAmount * ethPriceUSD).toFixed(4)}`;
}

export function formatPriceETH(amountWei: bigint): string {
  const ethAmount = Number(amountWei) / 1e18;
  if (ethAmount < 0.0001) {
    const gweiAmount = Number(amountWei) / 1e9;
    return `${gweiAmount.toFixed(2)} gwei`;
  }
  return `${ethAmount.toFixed(6)} ETH`;
}

export interface X402PaymentRequirementParams {
  network: X402Network;
  recipient: Address;
  amount: bigint;
  asset?: Address;
  resource: string;
  description: string;
}

export function createX402PaymentRequirement(
  params: X402PaymentRequirementParams
): X402PaymentRequirement {
  const { network, recipient, amount, resource, description, asset } = params;
  const netConfig = getX402NetworkConfig(network);
  
  const accepts: X402PaymentOption[] = [];
  
  // JEJU token first (preferred)
  if (JEJU_TOKEN_ADDRESS !== ZERO_ADDRESS) {
    accepts.push({
      scheme: 'paymaster',
      network,
      maxAmountRequired: amount.toString(),
      asset: JEJU_TOKEN_ADDRESS,
      payTo: recipient,
      resource,
      description: `${description} (pay with JEJU)`,
    });
  }
  
  // Credit balance (zero-latency)
  accepts.push({
    scheme: 'credit',
    network,
    maxAmountRequired: amount.toString(),
    asset: ZERO_ADDRESS,
    payTo: recipient,
    resource,
    description: `${description} (prepaid credits)`,
  });
  
  // Native ETH
  accepts.push({
    scheme: 'exact',
    network,
    maxAmountRequired: amount.toString(),
    asset: ZERO_ADDRESS,
    payTo: recipient,
    resource,
    description: `${description} (ETH)`,
  });
  
  // USDC if available on network
  if (netConfig.usdc !== ZERO_ADDRESS) {
    accepts.push({
      scheme: 'exact',
      network,
      maxAmountRequired: amount.toString(),
      asset: asset ?? netConfig.usdc,
      payTo: recipient,
      resource,
      description: `${description} (USDC)`,
    });
  }
  
  return {
    x402Version: 1,
    error: 'Payment required',
    accepts,
  };
}

export class X402Client {
  private signer: Wallet;
  private network: X402Network;

  constructor(signer: Wallet, network?: X402Network) {
    this.signer = signer;
    this.network = network || getX402Config().network;
  }

  async generatePayment(providerAddress: Address, amount: string): Promise<string> {
    return generateX402PaymentHeader(this.signer, providerAddress, amount, this.network);
  }

  verifyPayment(payment: X402PaymentHeader, providerAddress: Address): boolean {
    return verifyX402Payment(payment, providerAddress, this.signer.address as Address);
  }

  async paidFetch(url: string, options: RequestInit, providerAddress: Address, amount: string): Promise<Response> {
    const paymentHeader = await this.generatePayment(providerAddress, amount);
    const headers = new Headers(options.headers);
    headers.set('X-Payment', paymentHeader);
    headers.set('x-jeju-address', this.signer.address);
    return fetch(url, { ...options, headers });
  }

  async handlePaymentRequired(response: Response, url: string, options: RequestInit): Promise<Response> {
    if (response.status !== 402) return response;
    const requirement = (await response.json()) as X402PaymentRequirement;
    const exactPayment = requirement.accepts.find((a) => a.scheme === 'exact');
    if (!exactPayment) throw new Error('No exact payment scheme available');
    return this.paidFetch(url, options, exactPayment.payTo, exactPayment.maxAmountRequired);
  }

  getNetworkConfig(): X402NetworkConfig { return getX402NetworkConfig(this.network); }
  getAddress(): Address { return this.signer.address as Address; }
}

import type { Context, Next } from 'hono';

export function createX402Middleware(config: X402Config) {
  return async (c: Context, next: Next) => {
    if (!config.enabled) {
      return next();
    }

    const paymentHeader = c.req.header('X-Payment');
    if (!paymentHeader) {
      return c.json({
        x402Version: 1,
        error: 'Payment required',
        accepts: [{
          scheme: 'exact',
          network: config.network,
          asset: ZERO_ADDRESS,
          payTo: config.recipientAddress || ZERO_ADDRESS,
          resource: c.req.path,
          description: 'API access payment required',
        }],
      }, 402);
    }

    const parsed = parseX402Header(paymentHeader);
    if (!parsed) {
      return c.json({ error: 'Invalid payment header' }, 400);
    }

    c.set('x402Payment', parsed);
    return next();
  };
}

export { ZERO_ADDRESS };
