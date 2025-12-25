# Otto - Decentralized Multi-Platform Trading Agent

Otto is a fully decentralized AI trading agent built on Jeju Network. It enables users to trade, bridge, and launch tokens across multiple chains via Discord, Telegram, WhatsApp, Farcaster, and Twitter/X.

## Features

- **Multi-Platform Support**: Discord, Telegram, WhatsApp, Farcaster, Twitter/X, Web
- **Cross-Chain Trading**: Swap tokens on Jeju, Ethereum, Base, Optimism, Arbitrum, Solana
- **Intent-Based Bridging**: Bridge tokens between chains using Jeju's cross-chain infrastructure
- **Token Launches**: Clanker-style token creation with automatic liquidity
- **Limit Orders**: Create and manage limit orders
- **Portfolio Tracking**: View balances across all supported chains
- **Account Abstraction**: Session keys for seamless trading without constant signing
- **Non-Custodial**: Users always control their own funds
- **Farcaster Frames**: Native frame support for interactive trading
- **Telegram Miniapps**: Native miniapp for Telegram

## Quick Start

```bash
# Install dependencies
bun install

# Start the server (API-only mode)
bun run dev

# Start with Discord
bun run dev:discord

# Start with Telegram
bun run dev:telegram

# Start with all platforms
bun run dev:all
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_BOT_TOKEN` | Discord bot token | For Discord |
| `DISCORD_APPLICATION_ID` | Discord application ID | For Discord |
| `DISCORD_PUBLIC_KEY` | Discord public key for webhook verification | Optional |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | For Telegram |
| `TELEGRAM_WEBHOOK_URL` | Telegram webhook URL | Optional |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook secret | Optional |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | For WhatsApp |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | For WhatsApp |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp number | For WhatsApp |
| `NEYNAR_API_KEY` | Neynar API key | For Farcaster |
| `FARCASTER_BOT_FID` | Farcaster bot FID | For Farcaster |
| `FARCASTER_SIGNER_UUID` | Farcaster signer UUID | For Farcaster |
| `TWITTER_BEARER_TOKEN` | Twitter bearer token | For Twitter/X |
| `TWITTER_API_KEY` | Twitter API key | For Twitter/X |
| `TWITTER_API_SECRET` | Twitter API secret | For Twitter/X |
| `AI_MODEL_ENDPOINT` | AI model endpoint for natural language | Optional |
| `AI_MODEL_API_KEY` | AI model API key | Optional |

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `help` | Show available commands | `otto help` |
| `balance` | Check token balances | `otto balance ETH` |
| `price` | Get token price | `otto price ETH` |
| `swap` | Swap tokens | `otto swap 1 ETH to USDC` |
| `bridge` | Bridge tokens | `otto bridge 1 ETH from ethereum to base` |
| `send` | Send tokens | `otto send 1 ETH to vitalik.eth` |
| `launch` | Launch a token | `otto launch "Moon" MOON` |
| `portfolio` | View portfolio | `otto portfolio` |
| `limit` | Create limit order | `otto limit 1 ETH at 4000 USDC` |
| `orders` | View open orders | `otto orders` |
| `cancel` | Cancel order | `otto cancel order123` |
| `connect` | Connect wallet | `otto connect` |
| `settings` | Manage settings | `otto settings slippage 1%` |

## API Endpoints

### Health & Status
- `GET /health` - Health check
- `GET /status` - Detailed status with platform info
- `GET /api/info` - Agent information
- `GET /api/chains` - Supported chains

### Chat API
- `POST /api/chat/session` - Create chat session
- `GET /api/chat/session/:id` - Get session
- `POST /api/chat/chat` - Send message
- `GET /api/chat/auth/message` - Get auth message

### Webhooks
- `POST /webhooks/discord` - Discord interactions
- `POST /webhooks/telegram` - Telegram updates
- `POST /webhooks/whatsapp` - Twilio WhatsApp
- `POST /webhooks/farcaster` - Farcaster frame actions
- `POST /webhooks/twitter` - Twitter/X events

### Miniapps & Frames
- `GET /miniapp` - Web miniapp
- `GET /miniapp/telegram` - Telegram miniapp
- `GET /miniapp/farcaster` - Farcaster miniapp
- `GET /frame` - Farcaster frame
- `POST /frame/action` - Frame action handler

### Auth
- `GET /auth/connect` - Wallet connection page
- `GET /auth/callback` - OAuth3 wallet connection callback

## Architecture

```
apps/otto/
├── api/                 # API and server code
│   ├── eliza/          # ElizaOS plugin and character
│   ├── hooks/          # React hooks for client
│   ├── platforms/      # Platform adapters (Discord, Telegram, etc.)
│   ├── services/       # Trading and wallet services
│   ├── utils/          # Utilities
│   ├── web/            # Web endpoints (chat, miniapp, frame)
│   ├── config.ts       # Configuration
│   ├── schemas.ts      # Zod schemas
│   ├── server.ts       # Elysia HTTP server
│   └── types.ts        # TypeScript types
├── lib/                # Shared exports
├── tests/              # Tests
│   ├── e2e/           # Playwright e2e tests
│   ├── synpress/      # Synpress wallet tests
│   └── unit/          # Unit tests
├── playwright.config.ts
├── synpress.config.ts
└── package.json
```

## Development

```bash
# Run unit tests
bun run test

# Run e2e tests (starts server automatically)
bun run test:e2e

# Run wallet tests
bun run test:synpress

# Type check
bun run typecheck

# Lint
bun run lint

# Build for production
bun run build

# Run production server
bun run start
```

## ElizaOS Integration

Otto includes an ElizaOS plugin for integration with the Eliza agent framework:

```typescript
import { ottoPlugin, ottoCharacter } from '@jejunetwork/otto';

// Use plugin in Eliza agent
const agent = new ElizaAgent({
  character: ottoCharacter,
  plugins: [ottoPlugin],
});
```

## Security

- **Non-Custodial**: Otto never holds user funds
- **Session Keys**: Time-limited permissions for automated trading
- **Signature Verification**: All wallet connections require signature
- **No API Key Storage**: Platform credentials stored in secure KMS

## License

MIT
