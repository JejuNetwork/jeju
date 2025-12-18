# Otto - Decentralized Multi-Platform Trading Agent

Otto is a fully decentralized AI trading agent built on Jeju Network. It enables users to trade, bridge, and launch tokens across multiple chains via Discord, Telegram, and WhatsApp.

## Features

- **Multi-Platform Support**: Discord, Telegram, WhatsApp
- **Cross-Chain Trading**: Swap tokens on Jeju, Ethereum, Base, Optimism, Arbitrum, Solana
- **Intent-Based Bridging**: Bridge tokens between chains using Jeju's cross-chain infrastructure
- **Token Launches**: Clanker-style token creation with automatic liquidity
- **Limit Orders**: Create and manage limit orders
- **Portfolio Tracking**: View balances across all supported chains
- **Account Abstraction**: Session keys for seamless trading without constant signing
- **Non-Custodial**: Users always control their own funds

## Quick Start

```bash
# Install dependencies
bun install

# Start the server (API-only mode)
bun run dev

# Start with Discord
DISCORD_BOT_TOKEN=xxx DISCORD_APPLICATION_ID=xxx bun run dev

# Start with Telegram
TELEGRAM_BOT_TOKEN=xxx bun run dev

# Start with all platforms
DISCORD_BOT_TOKEN=xxx DISCORD_APPLICATION_ID=xxx TELEGRAM_BOT_TOKEN=xxx bun run dev:all
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
| `AI_MODEL_ENDPOINT` | AI model endpoint for natural language | Optional |
| `AI_MODEL_API_KEY` | AI model API key | Optional |

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `help` | Show available commands | `/otto help` |
| `balance` | Check token balances | `/otto balance ETH` |
| `price` | Get token price | `/otto price ETH` |
| `swap` | Swap tokens | `/otto swap 1 ETH to USDC` |
| `bridge` | Bridge tokens | `/otto bridge 1 ETH from ethereum to base` |
| `send` | Send tokens | `/otto send 1 ETH to vitalik.eth` |
| `launch` | Launch a token | `/otto launch "Moon" MOON` |
| `portfolio` | View portfolio | `/otto portfolio` |
| `limit` | Create limit order | `/otto limit 1 ETH at 4000 USDC` |
| `orders` | View open orders | `/otto orders` |
| `cancel` | Cancel order | `/otto cancel order123` |
| `connect` | Connect wallet | `/otto connect` |
| `settings` | Manage settings | `/otto settings slippage 1%` |

## API Endpoints

### Health & Status
- `GET /health` - Health check
- `GET /status` - Detailed status with platform info
- `GET /api/info` - Agent information
- `GET /api/chains` - Supported chains

### Webhooks
- `POST /webhooks/discord` - Discord interactions
- `POST /webhooks/telegram` - Telegram updates
- `POST /webhooks/whatsapp` - Twilio WhatsApp

### Auth
- `GET /auth/callback` - OAuth3 wallet connection callback

## Architecture

```
apps/otto/
├── src/
│   ├── agent/           # Agent logic and command handling
│   ├── platforms/       # Platform adapters (Discord, Telegram, WhatsApp)
│   ├── services/        # Trading and wallet services
│   ├── eliza/           # ElizaOS plugin and character
│   ├── tests/           # Unit tests
│   ├── config.ts        # Configuration
│   ├── types.ts         # TypeScript types
│   └── server.ts        # HTTP server
├── tests/               # Integration and e2e tests
└── wallet-setup/        # Synpress wallet setup
```

## Development

```bash
# Run unit tests
bun test src/

# Run API tests
bunx playwright test tests/api.test.ts

# Run integration tests
bunx playwright test tests/integration.test.ts

# Type check
bun run typecheck
```

## ElizaOS Integration

Otto includes an ElizaOS plugin for integration with the Eliza agent framework:

```typescript
import { ottoPlugin, ottoCharacter } from '@jejunetwork/otto/eliza';

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

