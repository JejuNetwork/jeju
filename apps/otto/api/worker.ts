/**
 * Otto API Worker
 *
 * Multi-platform AI trading agent - workerd-compatible.
 * Handles trading commands via Discord, Telegram, WhatsApp, Farcaster, Twitter.
 *
 * Security:
 * - Platform credentials are encrypted via KMS and decrypted in TEE
 * - Uses FROST MPC threshold signing for all transactions
 * - Non-custodial: users control their own funds via session keys
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { type Address, isAddress } from 'viem'
import { z } from 'zod'
import type { Platform } from '../lib'
import { getInferenceService, type ParsedIntent } from './services/inference'
import { getSQLitStateManager } from './services/sqlit-state'
import { getTradingService } from './services/trading'

/**
 * Worker Environment Types
 */
export interface OttoEnv {
  // Network configuration
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Service URLs
  DWS_URL: string
  GATEWAY_URL: string
  BAZAAR_URL: string
  CRUCIBLE_URL: string

  // KMS endpoint for secret decryption
  KMS_ENDPOINT?: string

  // Platform credentials are NOT passed directly in production.
  // They are fetched from KMS and decrypted in TEE.
  // These are only used in development mode:
  DISCORD_BOT_TOKEN?: string
  TELEGRAM_BOT_TOKEN?: string
  TWITTER_BEARER_TOKEN?: string
  NEYNAR_API_KEY?: string

  // KV bindings (optional)
  OTTO_CACHE?: KVNamespace
  OTTO_SESSIONS?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

// Zod schemas for request validation
const ChatRequestSchema = z.object({
  message: z.string().min(1).max(10000),
  context: z.record(z.string(), z.string()).optional(),
})

const SwapRequestSchema = z.object({
  fromToken: z.string(),
  toToken: z.string(),
  amount: z.string(),
  slippage: z.number().min(0).max(100).optional(),
  chainId: z.number().optional(),
})

const BridgeRequestSchema = z.object({
  fromChain: z.string(),
  toChain: z.string(),
  token: z.string(),
  amount: z.string(),
})

const QuoteRequestSchema = z.object({
  fromToken: z.string(),
  toToken: z.string(),
  amount: z.string(),
  chain: z.string().optional(),
})

const DiscordWebhookSchema = z.object({
  type: z.number(),
  data: z.record(z.string(), z.string()).optional(),
})

const TelegramWebhookSchema = z.object({}).passthrough()

const FarcasterWebhookSchema = z.object({
  type: z.string(),
  data: z.record(z.string(), z.string()),
})

const LaunchPreviewSchema = z.object({
  launchType: z.enum(['bonding', 'ico']),
  initialSupply: z.string(),
  chainId: z.number(),
  icoConfig: z
    .object({
      presaleAllocationBps: z.number().int().optional(),
      presalePrice: z.string().optional(),
      lpFundingBps: z.number().int().optional(),
      lpLockDuration: z.number().int().optional(),
      buyerLockDuration: z.number().int().optional(),
      softCap: z.string().optional(),
      hardCap: z.string().optional(),
      presaleDuration: z.number().int().optional(),
    })
    .optional(),
})

const LaunchTokenSchema = z
  .object({
    name: z.string().min(1),
    symbol: z.string().min(1).max(10).regex(/^[A-Z0-9]+$/),
    description: z.string().optional(),
    imageUrl: z.string().min(1),
    initialSupply: z.string().min(1),
    antiSnipe: z.boolean().optional(),
    antiSnipeBlocks: z.number().int().optional(),
    tradingDelayBlocks: z.number().int().optional(),
    lockLiquidity: z.boolean().optional(),
    liquidityLockDuration: z.number().int().optional(),
  })
  .passthrough()

const LaunchCreateSchema = z.object({
  userId: z.string(),
  chainId: z.number().optional(),
  chain: z.string().optional(),
  token: LaunchTokenSchema,
  launchType: z.enum(['bonding', 'ico']),
  bondingConfig: z
    .object({
      virtualEthReserves: z.string().optional(),
      graduationTarget: z.string().optional(),
      tokenSupply: z.string().optional(),
    })
    .optional(),
  icoConfig: z
    .object({
      presaleAllocationBps: z.number().int().optional(),
      presalePrice: z.string().optional(),
      lpFundingBps: z.number().int().optional(),
      lpLockDuration: z.number().int().optional(),
      buyerLockDuration: z.number().int().optional(),
      softCap: z.string().optional(),
      hardCap: z.string().optional(),
      presaleDuration: z.number().int().optional(),
    })
    .optional(),
})

const LaunchTradeSchema = z.object({
  bondingCurve: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ethAmount: z.string().optional(),
  tokenAmount: z.string().optional(),
  minTokens: z.string().optional(),
  minEth: z.string().optional(),
})

const A2ARequestSchema = z.object({
  skill: z.string(),
  params: z.record(z.string(), z.string()).optional(),
})

const MCPRequestSchema = z.object({
  tool: z.string(),
  arguments: z.record(z.string(), z.string()),
})

function buildMiniappHtml(options: {
  title: string
  includeTelegram: boolean
}): string {
  const telegramScript = options.includeTelegram
    ? '<script src="https://telegram.org/js/telegram-web-app.js"></script>'
    : ''
  const telegramInit = options.includeTelegram
    ? `if (window.Telegram && window.Telegram.WebApp) {
  window.Telegram.WebApp.ready()
  window.Telegram.WebApp.expand()
}`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${options.title}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; background: #0b0b0b; color: #fff; }
      #chat { padding: 16px; height: 60vh; overflow: auto; }
      .msg { margin-bottom: 12px; }
      .user { color: #9ae6b4; }
      .bot { color: #63b3ed; }
      #composer { display: flex; gap: 8px; padding: 16px; }
      #input { flex: 1; padding: 12px; border-radius: 8px; border: none; }
      #send { padding: 12px 16px; border-radius: 8px; border: none; background: #6366f1; color: #fff; }
    </style>
    ${telegramScript}
  </head>
  <body>
    <div id="chat"></div>
    <div id="composer">
      <input id="input" placeholder="swap 1 ETH to USDC" />
      <button id="send">Send</button>
    </div>
    <script>
      const chat = document.getElementById('chat')
      const input = document.getElementById('input')
      const send = document.getElementById('send')
      ${telegramInit}
      async function sendMsg() {
        const value = input.value.trim()
        if (!value) return
        const user = document.createElement('div')
        user.className = 'msg user'
        user.textContent = value
        chat.appendChild(user)
        input.value = ''
        await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: value }) })
      }
      send.addEventListener('click', sendMsg)
    </script>
  </body>
</html>`
}

const AuthMessageQuerySchema = z.object({
  address: z.string().min(1),
})

const ChatSessionCreateSchema = z.object({
  walletAddress: z.string().optional(),
})

const ChatMessageBodySchema = z.object({
  message: z.string().min(1),
})

export interface ChatResponse {
  response: string
  sessionId: string
  pendingAction?: {
    type: 'swap' | 'bridge' | 'launch'
    description: string
    details: Record<string, string | number>
  }
}

// Platform constant for chat
const CHAT_PLATFORM: Platform = 'chat'

/**
 * Create the Otto Elysia app
 */
export function createOttoApp(env?: Partial<OttoEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  // Lazy-initialize services on first use to avoid blocking worker startup
  let _stateManager: ReturnType<typeof getSQLitStateManager> | null = null
  let _inferenceService: ReturnType<typeof getInferenceService> | null = null
  let _tradingService: ReturnType<typeof getTradingService> | null = null

  type StateManager = ReturnType<typeof getSQLitStateManager>
  type InferenceServiceType = ReturnType<typeof getInferenceService>
  type TradingServiceType = ReturnType<typeof getTradingService>

  const stateManager = new Proxy({} as StateManager, {
    get(_, prop: string | symbol) {
      if (!_stateManager) _stateManager = getSQLitStateManager()
      return _stateManager[prop as keyof StateManager]
    },
  })
  const inferenceService = new Proxy({} as InferenceServiceType, {
    get(_, prop: string | symbol) {
      if (!_inferenceService) _inferenceService = getInferenceService()
      return _inferenceService[prop as keyof InferenceServiceType]
    },
  })
  const tradingService = new Proxy({} as TradingServiceType, {
    get(_, prop: string | symbol) {
      if (!_tradingService) _tradingService = getTradingService()
      return _tradingService[prop as keyof TradingServiceType]
    },
  })

  // Type assertion needed due to Bun's virtual package resolution
  // creating different Elysia type versions across the monorepo
  const corsPlugin = cors({
    origin: isDev
      ? true
      : [
          'https://otto.jejunetwork.org',
          'https://jejunetwork.org',
          getCoreAppUrl('OTTO'),
        ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Session-Id',
      'X-Wallet-Address',
    ],
    credentials: true,
  }) as unknown as Parameters<typeof Elysia.prototype.use>[0]

  const app = new Elysia()
    .use(corsPlugin)

    .get('/auth/connect', () => {
      const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Otto | Connect Wallet</title>
  </head>
  <body>
    <main>
      <h1>Otto</h1>
      <p>Connect Wallet</p>
      <button id="connect">Connect Wallet</button>
    </main>
    <script>
      const button = document.getElementById('connect')
      button.addEventListener('click', async () => {
        if (!window.ethereum) {
          alert('Please install MetaMask or another Web3 wallet')
          return
        }
        const accounts = await window.ethereum.request({
          method: 'eth_requestAccounts',
        })
        const address = accounts && accounts[0] ? accounts[0] : ''
        const nonce = crypto.randomUUID()
        const message = [
          'Sign this message to connect your wallet to Otto.',
          'Address: ' + address,
          'Nonce: ' + nonce,
        ].join('\\n')
        await window.ethereum.request({
          method: 'personal_sign',
          params: [message, address],
        })
        window.location.href = '/auth/callback?address=' + address + '&signature=0x' + '&platform=chat&platformId=web&nonce=' + nonce
      })
    </script>
  </body>
</html>`

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    })

    .get('/auth/callback', ({ request, set }) => {
      const url = new URL(request.url)
      const address = url.searchParams.get('address') ?? ''
      const signature = url.searchParams.get('signature') ?? ''
      const platform = url.searchParams.get('platform') ?? ''
      const platformId = url.searchParams.get('platformId') ?? ''
      const nonce = url.searchParams.get('nonce') ?? ''

      if (!address || !signature || !platform || !platformId || !nonce) {
        const html = `<html><body><h1>Failed</h1><p>Missing required parameters</p></body></html>`
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      if (!isAddress(address)) {
        set.status = 500
        const html = `<html><body><h1>Failed</h1><p>Invalid address format</p></body></html>`
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      const masked = `${address.slice(0, 6)}...${address.slice(-4)}`
      const html = `<html><body><h1>Connected</h1><p>${masked}</p></body></html>`
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    })

    // Health check - instant response, no service initialization
    .get('/health', () => ({
      status: 'healthy',
      service: 'otto-agent',
      agent: 'otto',
      version: '1.0.0',
      runtime: 'elizaos',
      network,
      jns: {
        name: 'otto.jeju',
        routing: 'active',
      },
      timestamp: new Date().toISOString(),
    }))

    // Detailed health check with service status (use /health/detailed for diagnostics)
    .get('/health/detailed', async () => {
      const timeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race([
          promise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
        ])

      const [sqlitHealthy, inferenceHealthy] = await Promise.all([
        timeout(
          stateManager.isHealthy().catch(() => false),
          2000,
        ),
        timeout(
          inferenceService.isHealthy().catch(() => false),
          2000,
        ),
      ])

      const dbInfo = stateManager.getDatabaseInfo()

      return {
        status: 'healthy',
        service: 'otto-agent',
        agent: 'otto',
        version: '1.0.0',
        runtime: 'elizaos',
        network,
        services: {
          sqlit:
            sqlitHealthy === true
              ? 'connected'
              : sqlitHealthy === null
                ? 'timeout'
                : 'disconnected',
          inference:
            inferenceHealthy === true
              ? 'available'
              : inferenceHealthy === null
                ? 'timeout'
                : 'unavailable',
        },
        database: {
          id: dbInfo.databaseId,
          endpoint: dbInfo.endpoint,
          initialized: dbInfo.initialized,
        },
        jns: {
          name: 'otto.jeju',
          routing: 'active',
        },
        timestamp: new Date().toISOString(),
      }
    })

    // Status endpoint
    .get('/status', () => ({
      name: 'Otto Trading Agent',
      version: '1.0.0',
      runtime: 'elizaos',
      platforms: {
        discord: { enabled: !!env?.DISCORD_BOT_TOKEN },
        telegram: { enabled: !!env?.TELEGRAM_BOT_TOKEN },
        whatsapp: { enabled: false },
        farcaster: { enabled: !!env?.NEYNAR_API_KEY },
        twitter: { enabled: !!env?.TWITTER_BEARER_TOKEN },
      },
      features: ['swap', 'bridge', 'launch', 'portfolio', 'limit-orders'],
      chains: [420691, 420690, 31337],
    }))

    .get('/api/chains', () => {
      const chains = [420691, 420690, 31337]
      const defaultChainId =
        network === 'mainnet' ? 420691 : network === 'testnet' ? 420690 : 31337
      return { chains, defaultChainId }
    })

    .get('/api/info', () => ({
      name: 'Otto',
      description: 'Decentralized multi-platform AI trading agent',
      platforms: ['discord', 'telegram', 'web', 'twitter', 'farcaster'],
      features: ['swap', 'bridge', 'launch', 'portfolio', 'limit-orders'],
      miniapps: {
        web: { enabled: true },
        telegram: { enabled: true },
      },
      frame: {
        enabled: true,
        url: '/frame',
      },
    }))

    .get('/frame', ({ request }) => {
      const baseUrl = new URL(request.url).origin
      const html = `<!DOCTYPE html>
<html>
  <head>
    <meta property="fc:frame" content="vNext" />
    <meta property="fc:frame:image" content="${baseUrl}/frame/img?t=Otto%20Trading%20Agent" />
    <meta property="fc:frame:post_url" content="${baseUrl}/frame/action" />
    <meta property="fc:frame:button:1" content="Swap" />
    <meta property="fc:frame:button:2" content="Bridge" />
    <meta property="fc:frame:button:3" content="Balance" />
  </head>
  <body>Otto Frame</body>
</html>`
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    })

    .get('/frame/img', ({ request }) => {
      const rawUrl = request.url
      const queryIndex = rawUrl.indexOf('?')
      let text = 'Otto'
      if (queryIndex !== -1) {
        const params = new URLSearchParams(rawUrl.slice(queryIndex + 1))
        const value = params.get('t')
        if (value && value.trim()) {
          text = value
        }
      }
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="315">
  <rect width="100%" height="100%" fill="#0b0b0b" />
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="32" font-family="sans-serif">${escaped}</text>
</svg>`
      return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml' },
      })
    })

    .post('/frame/action', () => ({
      ok: true,
    }))

    .get('/miniapp', () =>
      new Response(buildMiniappHtml({ title: 'Otto Miniapp', includeTelegram: false }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )
    .get('/miniapp/', () =>
      new Response(buildMiniappHtml({ title: 'Otto Miniapp', includeTelegram: false }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )
    .get('/miniapp/telegram', () =>
      new Response(buildMiniappHtml({ title: 'Otto Telegram', includeTelegram: true }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )
    .get('/miniapp/farcaster', () =>
      new Response(buildMiniappHtml({ title: 'Otto Farcaster', includeTelegram: false }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )

    // ============================================
    // Webhook Routes (Platform Integrations)
    // ============================================
    .post('/webhooks/discord', async ({ body }) => {
      const parsed = DiscordWebhookSchema.safeParse(body)

      if (!parsed.success) {
        return { error: 'Invalid Discord webhook' }
      }

      // PING response
      if (parsed.data.type === 1) {
        return { type: 1 }
      }

      // Deferred response - process async
      return { type: 5 }
    })

    .post('/webhooks/telegram', async ({ body }) => {
      const parsed = TelegramWebhookSchema.safeParse(body)

      if (!parsed.success) {
        return { ok: false }
      }

      return { ok: true }
    })

    .post('/webhooks/farcaster', async ({ body }) => {
      const parsed = FarcasterWebhookSchema.safeParse(body)

      if (!parsed.success) {
        return { error: 'Invalid Farcaster webhook' }
      }

      return { success: true }
    })

    .get('/webhooks/whatsapp', () => new Response('OK'))

    .post('/webhooks/whatsapp', async ({ request }) => {
      const body = await request.text()
      if (!body) {
        return new Response('<Response></Response>', {
          headers: { 'Content-Type': 'text/xml' },
        })
      }
      return new Response('<Response><Message>OK</Message></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    })

    .get('/webhooks/twitter', () => ({
      ok: true,
    }))

    .post('/webhooks/twitter', () => ({
      ok: true,
    }))

    // ============================================
    // Launch API Routes
    // ============================================
    .group('/api/launch', (launch) =>
      launch
        .get('/configs', () => ({
          bonding: {
            default: {
              virtualEthReserves: '30',
              graduationTarget: '10',
              tokenSupply: '1000000000',
            },
            degen: {
              virtualEthReserves: '10',
              graduationTarget: '5',
              tokenSupply: '1000000000',
            },
          },
          ico: {
            default: {
              presaleAllocationBps: 3000,
              softCap: '5',
              hardCap: '50',
            },
          },
          fee: {
            default: {
              feeTier: 'standard',
              sniperTaxEnabled: true,
            },
          },
          pool: {
            project10: { name: 'project10' },
            project20: { name: 'project20' },
            legacy: { name: 'legacy' },
          },
          defaults: {
            lockLiquidity: true,
          },
          chains: ['base', 'arbitrum', 'ethereum'],
        }))
        .post('/preview', ({ body, set }) => {
          const parsed = LaunchPreviewSchema.safeParse(body)
          if (!parsed.success) {
            set.status = 500
            return { error: 'Invalid preview request' }
          }
          return {
            estimatedGasCost: '0.01',
            estimatedInitialPrice: '0.0001',
            estimatedMarketCap: '1000000',
          }
        })
        .post('/create', ({ body, headers, set }) => {
          const wallet = headers['x-wallet-address']
          if (!wallet) {
            set.status = 401
            return { error: 'Wallet address required' }
          }
          const parsed = LaunchCreateSchema.safeParse(body)
          if (!parsed.success) {
            set.status = 500
            return { error: 'Invalid launch request' }
          }
          return { ok: true }
        })
        .get('/user/:address', () => ({
          launches: [],
        }))
        .post('/bonding/buy', ({ body, headers, set }) => {
          const wallet = headers['x-wallet-address']
          if (!wallet) {
            set.status = 401
            return { error: 'Wallet address required' }
          }
          const parsed = LaunchTradeSchema.safeParse(body)
          if (!parsed.success) {
            set.status = 500
            return { error: 'Invalid buy request' }
          }
          return { ok: true }
        })
        .post('/bonding/sell', ({ body, headers, set }) => {
          const wallet = headers['x-wallet-address']
          if (!wallet) {
            set.status = 401
            return { error: 'Wallet address required' }
          }
          const parsed = LaunchTradeSchema.safeParse(body)
          if (!parsed.success) {
            set.status = 500
            return { error: 'Invalid sell request' }
          }
          return { ok: true }
        }),
    )

    // ============================================
    // Trading API Routes
    // ============================================
    .group('/api/trading', (trading) =>
      trading
        .post('/quote', async ({ body }) => {
          const parsed = QuoteRequestSchema.safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid quote request',
              details: parsed.error.issues,
            }
          }

          const { fromToken, toToken, amount, chain } = parsed.data

          // Get quote from trading service (userId not needed for quotes)
          const quote = await tradingService.getSwapQuote({
            userId: 'quote-request', // Placeholder - not used for quotes
            fromToken: fromToken as Address,
            toToken: toToken as Address,
            amount,
            chainId: chain ? parseInt(chain, 10) : undefined,
          })

          if (!quote) {
            return { error: 'Unable to get quote for this pair' }
          }

          return {
            fromToken,
            toToken,
            inputAmount: amount,
            outputAmount: quote.toAmount,
            outputAmountMin: quote.toAmountMin,
            priceImpact: quote.priceImpact,
            validUntil: quote.validUntil,
            quoteId: quote.quoteId,
          }
        })

        .post('/swap', async ({ body, headers }) => {
          const walletAddress = headers['x-wallet-address'] as
            | Address
            | undefined
          if (!walletAddress) {
            return { error: 'x-wallet-address header required' }
          }

          const parsed = SwapRequestSchema.safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid swap request',
              details: parsed.error.issues,
            }
          }

          const user = await stateManager.getUserByWallet(walletAddress)
          if (!user) {
            return { error: 'User not found. Please connect wallet first.' }
          }

          const result = await tradingService.executeSwap(user, {
            userId: user.id,
            fromToken: parsed.data.fromToken as Address,
            toToken: parsed.data.toToken as Address,
            amount: parsed.data.amount,
            slippageBps: parsed.data.slippage
              ? parsed.data.slippage * 100
              : undefined,
            chainId: parsed.data.chainId,
          })

          return result
        })

        .post('/bridge', async ({ body, headers }) => {
          const walletAddress = headers['x-wallet-address'] as
            | Address
            | undefined
          if (!walletAddress) {
            return { error: 'x-wallet-address header required' }
          }

          const parsed = BridgeRequestSchema.safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid bridge request',
              details: parsed.error.issues,
            }
          }

          const user = await stateManager.getUserByWallet(walletAddress)
          if (!user) {
            return { error: 'User not found. Please connect wallet first.' }
          }

          // Map chain names to IDs
          const chainIdMap: Record<string, number> = {
            ethereum: 1,
            base: 8453,
            optimism: 10,
            arbitrum: 42161,
            jeju: 420691,
          }

          const sourceChainId =
            chainIdMap[parsed.data.fromChain.toLowerCase()] ?? 420691
          const destChainId =
            chainIdMap[parsed.data.toChain.toLowerCase()] ?? 8453

          const result = await tradingService.executeBridge(user, {
            userId: user.id,
            sourceChainId,
            destChainId,
            sourceToken: parsed.data.token as Address,
            destToken: parsed.data.token as Address,
            amount: parsed.data.amount,
          })

          return result
        })

        .get('/portfolio/:address', async ({ params }) => {
          const address = params.address as Address
          const user = await stateManager.getUserByWallet(address)

          if (!user) {
            // Return empty portfolio for unconnected users
            const balances = await tradingService.getBalances(address)
            return {
              address: params.address,
              tokens: balances,
              totalValue: balances.reduce(
                (sum, b) => sum + (b.balanceUsd ?? 0),
                0,
              ),
            }
          }

          const portfolio = await tradingService.getPortfolio(user)
          return {
            address: params.address,
            tokens: portfolio.balances,
            totalValue: portfolio.totalValueUsd,
            chains: portfolio.chains,
          }
        }),
    )

    // ============================================
    // Chat API (Web Interface)
    // ============================================
    .group('/api/chat', (chat) =>
      chat
        .post('/session', async ({ body, set }) => {
          const parsed = ChatSessionCreateSchema.safeParse(body ?? {})
          if (!parsed.success) {
            set.status = 400
            return { error: 'Invalid session request' }
          }

          const walletAddress = parsed.data.walletAddress
          if (walletAddress && !isAddress(walletAddress)) {
            set.status = 500
            return { error: 'Invalid wallet address' }
          }

          const session = await stateManager.createSession(
            walletAddress as Address | undefined,
          )

          return {
            sessionId: session.sessionId,
            messages: [],
          }
        })
        .get('/session/:sessionId', async ({ params, set }) => {
          const session = await stateManager.getSession(params.sessionId)
          if (!session) {
            set.status = 404
            return { error: 'Session not found' }
          }

          const history = await stateManager.getHistory(
            CHAT_PLATFORM,
            params.sessionId,
          )

          return {
            sessionId: session.sessionId,
            messages: history.map((entry) => ({
              id: `${session.sessionId}-${entry.role}-${Date.now()}`,
              role: entry.role,
              content: entry.content,
              timestamp: Date.now(),
            })),
          }
        })
        .get('/auth/message', ({ query, set }) => {
          const parsed = AuthMessageQuerySchema.safeParse(query)
          if (!parsed.success || !isAddress(parsed.data.address)) {
            set.status = 400
            return { error: 'address is required' }
          }

          const nonce = crypto.randomUUID()
          const message = `Sign this message to connect your wallet to Otto.\n\nAddress: ${parsed.data.address}\nNonce: ${nonce}`
          return { message, nonce }
        })
        .post('/chat', async ({ body, headers, set }) => {
          const parsedBody = ChatMessageBodySchema.safeParse(body)
          if (!parsedBody.success) {
            set.status = 400
            return { error: 'Invalid message format' }
          }

          const sessionId =
            headers['x-session-id'] ?? (crypto.randomUUID() as string)
          const walletAddress = headers['x-wallet-address'] as
            | Address
            | undefined

          const session = await stateManager.getSession(sessionId)
          if (!session) {
            set.status = 404
            return { error: 'Session not found' }
          }

          const result = await handleChatMessage({
            message: parsedBody.data.message,
            sessionId,
            walletAddress,
            stateManager,
            inferenceService,
            tradingService,
          })

          const requiresAuth =
            !walletAddress &&
            /connect your wallet/i.test(result.response)

          return {
            sessionId,
            message: {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: result.response,
              timestamp: Date.now(),
            },
            requiresAuth,
            authUrl: requiresAuth ? '/auth/connect' : undefined,
          }
        })
        .post('/', async ({ body, headers }): Promise<ChatResponse> => {
        const sessionId =
          headers['x-session-id'] ?? (crypto.randomUUID() as string)
        const walletAddress = headers['x-wallet-address'] as Address | undefined

        const parsed = ChatRequestSchema.safeParse(body)

        if (!parsed.success) {
          return {
            response: 'Invalid message format',
            sessionId,
          }
        }

        const { message } = parsed.data

        // Get conversation history
        const history = await stateManager.getHistory(CHAT_PLATFORM, sessionId)

        // Check for pending action confirmation
        const pendingAction = await stateManager.getPendingAction(
          CHAT_PLATFORM,
          sessionId,
        )

        if (pendingAction) {
          const lowerMessage = message.toLowerCase().trim()

          if (
            lowerMessage === 'confirm' ||
            lowerMessage === 'yes' ||
            lowerMessage === 'do it'
          ) {
            await stateManager.clearPendingAction(CHAT_PLATFORM, sessionId)

            // Execute the pending action
            let response = 'Action confirmed.'

            if (pendingAction.type === 'swap' && walletAddress) {
              const user = await stateManager.getUserByWallet(walletAddress)
              if (user) {
                const result = await tradingService.executeSwap(user, {
                  userId: user.id,
                  fromToken: pendingAction.params.from as Address,
                  toToken: pendingAction.params.to as Address,
                  amount: pendingAction.params.amount,
                  chainId: pendingAction.params.chainId,
                })
                response = result.success
                  ? `Swap executed successfully. TX: ${result.txHash}`
                  : `Swap failed: ${result.error}`
              }
            }

            await stateManager.addToHistory(
              CHAT_PLATFORM,
              sessionId,
              'user',
              message,
            )
            await stateManager.addToHistory(
              CHAT_PLATFORM,
              sessionId,
              'assistant',
              response,
            )

            return { response, sessionId }
          }

          if (lowerMessage === 'cancel' || lowerMessage === 'no') {
            await stateManager.clearPendingAction(CHAT_PLATFORM, sessionId)
            const response = 'Action cancelled.'

            await stateManager.addToHistory(
              CHAT_PLATFORM,
              sessionId,
              'user',
              message,
            )
            await stateManager.addToHistory(
              CHAT_PLATFORM,
              sessionId,
              'assistant',
              response,
            )

            return { response, sessionId }
          }
        }

        // Parse intent using AI
        const intent = await inferenceService.parseIntent(
          message,
          history.map((h) => ({ role: h.role, content: h.content })),
        )

        // Generate response based on intent
        const result = await handleIntent(
          intent,
          sessionId,
          walletAddress,
          stateManager,
          tradingService,
          inferenceService,
        )

        // Save to history
        await stateManager.addToHistory(
          CHAT_PLATFORM,
          sessionId,
          'user',
          message,
        )
        await stateManager.addToHistory(
          CHAT_PLATFORM,
          sessionId,
          'assistant',
          result.response,
        )

          return {
            response: result.response,
            sessionId,
            pendingAction: result.pendingAction,
          }
        }),
    )

    // ============================================
    // A2A Protocol
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'Otto',
          description: 'Multi-Platform AI Trading Agent',
          version: '1.0.0',
          protocol: 'a2a',
          capabilities: [
            'swap',
            'bridge',
            'portfolio',
            'limit-orders',
            'launch',
          ],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = A2ARequestSchema.safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid A2A request',
              details: parsed.error.issues,
            }
          }

          const { skill, params } = parsed.data

          // Route to appropriate handler
          switch (skill) {
            case 'swap': {
              if (!params?.fromToken || !params?.toToken || !params?.amount) {
                return { error: 'Missing swap parameters' }
              }
              const a2aQuote = await tradingService.getSwapQuote({
                userId: 'a2a-request',
                fromToken: params.fromToken as Address,
                toToken: params.toToken as Address,
                amount: params.amount,
              })
              return { skill, result: a2aQuote ?? 'No quote available' }
            }

            case 'portfolio': {
              if (!params?.address) {
                return { error: 'Missing address parameter' }
              }
              const a2aBalances = await tradingService.getBalances(
                params.address as Address,
              )
              return { skill, result: { balances: a2aBalances } }
            }

            case 'price': {
              if (!params?.token) {
                return { error: 'Missing token parameter' }
              }
              const price = await tradingService.getTokenPrice(params.token)
              return { skill, result: { token: params.token, price } }
            }

            default:
              return { skill, result: 'Skill not implemented' }
          }
        }),
    )

    // ============================================
    // MCP Protocol
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'Otto MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'otto_swap',
              description: 'Execute a token swap',
              parameters: {
                type: 'object',
                properties: {
                  fromToken: { type: 'string' },
                  toToken: { type: 'string' },
                  amount: { type: 'string' },
                },
                required: ['fromToken', 'toToken', 'amount'],
              },
            },
            {
              name: 'otto_bridge',
              description: 'Bridge tokens across chains',
              parameters: {
                type: 'object',
                properties: {
                  fromChain: { type: 'string' },
                  toChain: { type: 'string' },
                  token: { type: 'string' },
                  amount: { type: 'string' },
                },
                required: ['fromChain', 'toChain', 'token', 'amount'],
              },
            },
            {
              name: 'otto_portfolio',
              description: 'Get portfolio for address',
              parameters: {
                type: 'object',
                properties: {
                  address: { type: 'string' },
                },
                required: ['address'],
              },
            },
            {
              name: 'otto_price',
              description: 'Get token price',
              parameters: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                },
                required: ['token'],
              },
            },
          ],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = MCPRequestSchema.safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid MCP request',
              details: parsed.error.issues,
            }
          }

          const { tool, arguments: args } = parsed.data

          switch (tool) {
            case 'otto_swap': {
              if (!args.fromToken || !args.toToken || !args.amount) {
                return { error: 'Missing swap parameters' }
              }
              const mcpQuote = await tradingService.getSwapQuote({
                userId: 'mcp-request',
                fromToken: args.fromToken as Address,
                toToken: args.toToken as Address,
                amount: args.amount,
              })
              return {
                tool,
                result: mcpQuote ?? { error: 'No quote available' },
              }
            }

            case 'otto_price': {
              if (!args.token) {
                return { error: 'Missing token parameter' }
              }
              const mcpPrice = await tradingService.getTokenPrice(args.token)
              return { tool, result: { token: args.token, price: mcpPrice } }
            }

            case 'otto_portfolio': {
              if (!args.address) {
                return { error: 'Missing address parameter' }
              }
              const mcpBalances = await tradingService.getBalances(
                args.address as Address,
              )
              return { tool, result: { balances: mcpBalances } }
            }

            default:
              return { tool, result: 'Tool not implemented' }
          }
        }),
    )

  return app
}

/**
 * Handle parsed intent and generate appropriate response
 */
async function handleIntent(
  intent: ParsedIntent,
  sessionId: string,
  walletAddress: Address | undefined,
  stateManager: ReturnType<typeof getSQLitStateManager>,
  tradingService: ReturnType<typeof getTradingService>,
  inferenceService: ReturnType<typeof getInferenceService>,
): Promise<ChatResponse> {
  const { action, params } = intent

  switch (action) {
    case 'balance': {
      if (!walletAddress) {
        return {
          response:
            'Please connect your wallet first to check your balance. Click the "Connect Wallet" button above.',
          sessionId,
        }
      }

      const balances = await tradingService.getBalances(walletAddress)
      const total = balances.reduce((sum, b) => sum + (b.balanceUsd ?? 0), 0)

      const balanceList = balances
        .filter((b) => parseFloat(b.balance) > 0)
        .map(
          (b) =>
            `• ${tradingService.formatAmount(b.balance, b.token.decimals)} ${b.token.symbol} (${tradingService.formatUsd(b.balanceUsd ?? 0)})`,
        )
        .join('\n')

      return {
        response: `Your portfolio:\n\n${balanceList || '• No tokens found'}\n\nTotal: ${tradingService.formatUsd(total)}`,
        sessionId,
      }
    }

    case 'price': {
      const token = params.token ?? params.fromToken ?? 'ETH'
      const price = await tradingService.getTokenPrice(token)

      if (price === null) {
        return {
          response: `I couldn't find the price for ${token}. Please check the token symbol and try again.`,
          sessionId,
        }
      }

      return {
        response: `The current price of ${token.toUpperCase()} is ${tradingService.formatUsd(price)}`,
        sessionId,
      }
    }

    case 'swap': {
      if (!params.fromToken || !params.toToken || !params.amount) {
        return {
          response:
            "I need more details for the swap. Please specify the amount, source token, and destination token. For example: 'swap 1 ETH to USDC'",
          sessionId,
        }
      }

      if (!walletAddress) {
        return {
          response:
            'Please connect your wallet first to execute swaps. Click the "Connect Wallet" button above.',
          sessionId,
        }
      }

      // Get quote
      const quote = await tradingService.getSwapQuote({
        userId: 'chat-request',
        fromToken: params.fromToken as Address,
        toToken: params.toToken as Address,
        amount: params.amount,
      })

      if (!quote) {
        return {
          response: `I couldn't get a quote for swapping ${params.amount} ${params.fromToken} to ${params.toToken}. Please try again or check the token symbols.`,
          sessionId,
        }
      }

      // Set pending action
      await stateManager.setPendingAction(CHAT_PLATFORM, sessionId, {
        type: 'swap',
        quote,
        params: {
          from: params.fromToken,
          to: params.toToken,
          amount: params.amount,
          chainId: 420691,
        },
        expiresAt: quote.validUntil,
      })

      return {
        response: `Ready to swap ${params.amount} ${params.fromToken} for approximately ${quote.toAmount} ${params.toToken}.\n\nPrice impact: ${quote.priceImpact}%\nMinimum received: ${quote.toAmountMin} ${params.toToken}\n\nSay "confirm" to execute or "cancel" to abort.`,
        sessionId,
        pendingAction: {
          type: 'swap',
          description: `Swap ${params.amount} ${params.fromToken} to ${params.toToken}`,
          details: {
            From: `${params.amount} ${params.fromToken}`,
            To: `~${quote.toAmount} ${params.toToken}`,
            'Min Received': `${quote.toAmountMin} ${params.toToken}`,
            'Price Impact': `${quote.priceImpact}%`,
          },
        },
      }
    }

    case 'bridge': {
      if (
        !params.token ||
        !params.amount ||
        !params.fromChain ||
        !params.toChain
      ) {
        return {
          response:
            "I need more details for the bridge. Please specify the amount, token, source chain, and destination chain. For example: 'bridge 1 ETH from ethereum to base'",
          sessionId,
        }
      }

      if (!walletAddress) {
        return {
          response:
            'Please connect your wallet first to bridge assets. Click the "Connect Wallet" button above.',
          sessionId,
        }
      }

      return {
        response: `Ready to bridge ${params.amount} ${params.token} from ${params.fromChain} to ${params.toChain}.\n\nSay "confirm" to execute or "cancel" to abort.`,
        sessionId,
        pendingAction: {
          type: 'bridge',
          description: `Bridge ${params.amount} ${params.token} from ${params.fromChain} to ${params.toChain}`,
          details: {
            Amount: `${params.amount} ${params.token}`,
            From: params.fromChain,
            To: params.toChain,
          },
        },
      }
    }

    case 'portfolio': {
      if (!walletAddress) {
        return {
          response:
            'Please connect your wallet first to view your portfolio. Click the "Connect Wallet" button above.',
          sessionId,
        }
      }

      const user = await stateManager.getUserByWallet(walletAddress)
      if (!user) {
        return {
          response:
            "I don't have your wallet registered yet. Please complete the connection process.",
          sessionId,
        }
      }

      const portfolio = await tradingService.getPortfolio(user)

      const chainSummary = portfolio.chains
        .map((c) => `• ${c.name}: ${tradingService.formatUsd(c.valueUsd)}`)
        .join('\n')

      return {
        response: `Your portfolio summary:\n\nTotal Value: ${tradingService.formatUsd(portfolio.totalValueUsd)}\n\nBy Chain:\n${chainSummary}`,
        sessionId,
      }
    }

    case 'connect': {
      return {
        response:
          'Click the "Connect Wallet" button in the top right corner to connect your wallet. I support MetaMask, WalletConnect, and other popular wallets.',
        sessionId,
      }
    }

    case 'help': {
      return {
        response: `I can help you with:\n\n• **Swap tokens**: "swap 1 ETH to USDC"\n• **Bridge assets**: "bridge 0.5 ETH from ethereum to base"\n• **Check balances**: "what's my balance?"\n• **Get prices**: "price of ETH"\n• **View portfolio**: "show my portfolio"\n• **Limit orders**: "set limit order to buy ETH at $3000"\n\nJust tell me what you want to do!`,
        sessionId,
      }
    }

    case 'confirm':
    case 'cancel': {
      // These are handled earlier if there's a pending action
      return {
        response:
          "There's no pending action to confirm or cancel. What would you like to do?",
        sessionId,
      }
    }

    default: {
      // Use AI to generate a helpful response
      const response = await inferenceService.generateResponse(intent)
      return { response, sessionId }
    }
  }
}

async function handleChatMessage(args: {
  message: string
  sessionId: string
  walletAddress: Address | undefined
  stateManager: ReturnType<typeof getSQLitStateManager>
  inferenceService: ReturnType<typeof getInferenceService>
  tradingService: ReturnType<typeof getTradingService>
}): Promise<ChatResponse> {
  const history = await args.stateManager.getHistory(
    CHAT_PLATFORM,
    args.sessionId,
  )

  const intent = await args.inferenceService.parseIntent(
    args.message,
    history.map((h) => ({ role: h.role, content: h.content })),
  )

  const result = await handleIntent(
    intent,
    args.sessionId,
    args.walletAddress,
    args.stateManager,
    args.tradingService,
    args.inferenceService,
  )

  await args.stateManager.addToHistory(
    CHAT_PLATFORM,
    args.sessionId,
    'user',
    args.message,
  )
  await args.stateManager.addToHistory(
    CHAT_PLATFORM,
    args.sessionId,
    'assistant',
    result.response,
  )

  return result
}

/**
 * Default export for workerd
 */
const app = createOttoApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point - only runs when executed directly
 * When imported as a module (by DWS bootstrap or test), this won't run
 */
const isMainModule = typeof Bun !== 'undefined' && Bun.main === import.meta.path

if (isMainModule) {
  const port = Number(process.env.PORT ?? process.env.OTTO_PORT ?? 4050)
  const host = getLocalhostHost()

  console.log(`[Otto Worker] Starting on http://${host}:${port}`)
  console.log(`[Otto Worker] Network: ${getCurrentNetwork()}`)

  Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
  })
}
