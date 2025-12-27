/**
 * Otto Configuration
 */

import { expectValid } from '@jejunetwork/types'
import { type OttoConfig, OttoConfigSchema } from '../lib'

export const DEFAULT_CHAIN_ID = 420691 // Jeju Network
export const DEFAULT_SLIPPAGE_BPS = 50 // 0.5%
export const MAX_SLIPPAGE_BPS = 1000 // 10%
export const PENDING_ACTION_TTL = 5 * 60 * 1000 // 5 minutes

export const SUPPORTED_CHAINS = [
  { chainId: 420691, name: 'Jeju', symbol: 'JEJU', isDefault: true },
  { chainId: 1, name: 'Ethereum', symbol: 'ETH' },
  { chainId: 8453, name: 'Base', symbol: 'ETH' },
  { chainId: 10, name: 'Optimism', symbol: 'ETH' },
  { chainId: 42161, name: 'Arbitrum', symbol: 'ETH' },
  { chainId: 101, name: 'Solana', symbol: 'SOL', isSolana: true },
] as const

export const CHAIN_ID_MAP: Record<string, number> = {
  jeju: 420691,
  ethereum: 1,
  eth: 1,
  base: 8453,
  optimism: 10,
  op: 10,
  arbitrum: 42161,
  arb: 42161,
  solana: 101,
  sol: 101,
}

export const OTTO_COMMANDS = {
  help: {
    description: 'Show available commands',
    usage: '/otto help',
    examples: ['/otto help', '/otto help swap'],
  },
  balance: {
    description: 'Check your token balances',
    usage: '/otto balance [token] [chain]',
    examples: ['/otto balance', '/otto balance ETH', '/otto balance USDC base'],
  },
  price: {
    description: 'Get token price',
    usage: '/otto price <token> [chain]',
    examples: ['/otto price ETH', '/otto price PEPE base'],
  },
  swap: {
    description: 'Swap tokens',
    usage: '/otto swap <amount> <from> to <to> [on <chain>]',
    examples: [
      '/otto swap 1 ETH to USDC',
      '/otto swap 100 USDC to ETH on base',
    ],
  },
  bridge: {
    description: 'Bridge tokens across chains',
    usage: '/otto bridge <amount> <token> from <chain> to <chain>',
    examples: [
      '/otto bridge 1 ETH from ethereum to base',
      '/otto bridge 100 USDC from base to jeju',
    ],
  },
  send: {
    description: 'Send tokens to an address or ENS/JNS name',
    usage: '/otto send <amount> <token> to <address>',
    examples: [
      '/otto send 1 ETH to vitalik.eth',
      '/otto send 100 USDC to 0x...',
    ],
  },
  launch: {
    description: 'Launch a new token with bonding curve or ICO',
    usage: '/otto launch <name> <symbol> [supply] [liquidity]',
    examples: [
      '/otto launch "My Token" MTK',
      '/otto launch "Moon Coin" MOON 1000000 10ETH',
    ],
  },
  portfolio: {
    description: 'View your portfolio summary',
    usage: '/otto portfolio [chain]',
    examples: ['/otto portfolio', '/otto portfolio base'],
  },
  limit: {
    description: 'Create a limit order',
    usage: '/otto limit <amount> <from> at <price> <to>',
    examples: ['/otto limit 1 ETH at 4000 USDC'],
  },
  orders: {
    description: 'View your open orders',
    usage: '/otto orders',
    examples: ['/otto orders'],
  },
  cancel: {
    description: 'Cancel a limit order',
    usage: '/otto cancel <order_id>',
    examples: ['/otto cancel abc123'],
  },
  connect: {
    description: 'Connect your wallet',
    usage: '/otto connect',
    examples: ['/otto connect'],
  },
  disconnect: {
    description: 'Disconnect your wallet',
    usage: '/otto disconnect',
    examples: ['/otto disconnect'],
  },
  settings: {
    description: 'View or update settings',
    usage: '/otto settings [key] [value]',
    examples: [
      '/otto settings',
      '/otto settings slippage 1%',
      '/otto settings chain base',
    ],
  },
} as const

export function getConfig(): OttoConfig {
  const port = parseInt(process.env.OTTO_PORT ?? '4040', 10)
  const webhookPort = parseInt(process.env.OTTO_WEBHOOK_PORT ?? '4041', 10)

  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${process.env.OTTO_PORT}`)
  }

  if (Number.isNaN(webhookPort) || webhookPort <= 0 || webhookPort > 65535) {
    throw new Error(`Invalid webhook port: ${process.env.OTTO_WEBHOOK_PORT}`)
  }

  const baseUrl = process.env.OTTO_BASE_URL ?? 'http://localhost:4040'
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    throw new Error(`Invalid base URL: ${baseUrl}`)
  }

  const config = {
    port,
    webhookPort,
    baseUrl,

    discord: {
      enabled: !!process.env.DISCORD_BOT_TOKEN,
      token: process.env.DISCORD_BOT_TOKEN,
      applicationId: process.env.DISCORD_APPLICATION_ID,
      publicKey: process.env.DISCORD_PUBLIC_KEY,
    },

    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      token: process.env.TELEGRAM_BOT_TOKEN,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    },

    whatsapp: {
      enabled:
        !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN,
      twilioSid: process.env.TWILIO_ACCOUNT_SID,
      twilioToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_WHATSAPP_NUMBER,
    },

    farcaster: {
      enabled: !!process.env.NEYNAR_API_KEY && !!process.env.FARCASTER_BOT_FID,
      apiKey: process.env.NEYNAR_API_KEY,
      botFid: parseInt(process.env.FARCASTER_BOT_FID ?? '0', 10),
      signerUuid: process.env.FARCASTER_SIGNER_UUID,
    },

    twitter: {
      enabled: !!process.env.TWITTER_BEARER_TOKEN,
      apiKey: process.env.TWITTER_API_KEY,
      apiSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
      bearerToken: process.env.TWITTER_BEARER_TOKEN,
      botUsername: process.env.TWITTER_BOT_USERNAME ?? 'otto_agent',
    },

    trading: {
      defaultChainId: DEFAULT_CHAIN_ID,
      defaultSlippageBps: DEFAULT_SLIPPAGE_BPS,
      maxSlippageBps: MAX_SLIPPAGE_BPS,
      supportedChains: SUPPORTED_CHAINS.map((c) => c.chainId),
    },

    ai: {
      enabled: !!process.env.AI_MODEL_ENDPOINT,
      modelEndpoint: process.env.AI_MODEL_ENDPOINT,
      modelApiKey: process.env.AI_MODEL_API_KEY,
    },
  }

  return expectValid(OttoConfigSchema, config, 'Otto config')
}

export function getChainName(chainId: number): string {
  const chain = SUPPORTED_CHAINS.find((c) => c.chainId === chainId)
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`)
  }
  return chain.name
}

export function getChainId(name: string): number | null {
  const normalized = name.toLowerCase().trim()
  return CHAIN_ID_MAP[normalized] ?? null
}

export function isChainSupported(chainId: number): boolean {
  return SUPPORTED_CHAINS.some((c) => c.chainId === chainId)
}

export function isSolanaChain(chainId: number): boolean {
  const chain = SUPPORTED_CHAINS.find((c) => c.chainId === chainId)
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`)
  }
  return 'isSolana' in chain && chain.isSolana === true
}
