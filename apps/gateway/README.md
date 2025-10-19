# Gateway Portal - Protocol Infrastructure Hub

**Bring your tokens. Power the chain. Run the network.**

Gateway is the **one-stop protocol infrastructure hub** for Jeju. Bridge tokens, deploy paymasters, provide liquidity, run nodes, and earn protocol power. Any token with paymaster + ETH liquidity = equal protocol power.

## Features

### Protocol Token Infrastructure
- ⚡ **Multi-Token Gas Payments** - Pay gas with elizaOS (native), CLANKER, VIRTUAL, CLANKERMON, or any protocol token
- 🌉 **Bridge from Base** - Bridge CLANKER, VIRTUAL, CLANKERMON, or ANY ERC20 from Base (elizaOS native - no bridging needed)
- 💳 **Deploy Paymasters** - Turn any token into a protocol token with gas payment power
- 💧 **Provide ETH Liquidity** - Add liquidity to earn fees and give tokens protocol power

### Node Operator Network
- 🖥️ **Register Nodes** - Stake ANY protocol token and run a Jeju RPC node
- 🏆 **Earn Multi-Token Rewards** - Earn in your chosen protocol token (elizaOS, CLANKER, VIRTUAL, CLANKERMON)
- 🌍 **Geographic Diversity** - Bonus rewards for underserved regions (Africa, South America +50%)
- 📊 **Performance Tracking** - Real-time uptime, requests, response time monitoring
- ⚖️ **Equal Protocol Power** - Any token with paymaster + ETH liquidity = equal node rewards

### Portfolio Management
- 📊 **Track Everything** - LP positions, node stakes, fees earned, rewards claimed across all tokens
- 💰 **Unified Dashboard** - One interface for all protocol-level activities

## Supported Protocol Tokens

All tokens with deployed paymasters are eligible for LP rewards and can be used to pay for gas:

### Native Jeju Token
- **elizaOS** - Native Jeju token ($0.10) 🏝️
  - Already on Jeju - no bridging needed
  - Primary gas payment token
  - Earn fees by providing ETH liquidity

### Bridged from Base
- **CLANKER** - AI agent token from Base ($26.14)
- **VIRTUAL** - Virtuals Protocol token ($1.85)
- **CLANKERMON** - Gaming token ($0.15)

### Custom Tokens
- Bridge ANY ERC20 token from Base
- Register and deploy paymaster for your token
- Earn LP rewards on any registered token

Each token has its own paymaster, vault, and LP reward pool. elizaOS is the primary protocol token of Jeju.

## Quick Start

The Paymaster Dashboard **starts automatically** when you run the main dev environment:

```bash
# From the repo root - starts everything including paymaster dashboard
bun run dev

# Dashboard will be available at:
http://localhost:4001
```

To run the dashboard standalone:

```bash
# From this directory
bun run dev
```

## How It Works

### For Projects

1. **Register Your Token**
   - Enter token address and oracle
   - Choose fee range (0-5%)
   - Pay 0.1 ETH registration fee

2. **Deploy Paymaster**
   - Click "Deploy" for your token
   - Factory deploys vault + distributor + paymaster
   - Takes ~30 seconds

3. **Add Liquidity**
   - Deposit ETH for gas sponsorship
   - Optional: Add your tokens for diversification

4. **Done**
   - Users can now pay gas with your token
   - You earn fees (if configured)
   - LPs earn rewards

### For LPs

1. **Browse Registered Tokens**
   - See all tokens with paymasters
   - Check fee rates, volume, liquidity

2. **Add Liquidity**
   - Choose a token/paymaster
   - Deposit ETH (earns 70% of LP fees)
   - Or deposit tokens (earns 30% of LP fees)

3. **Earn Rewards**
   - Proportional to your share
   - Claim anytime
   - No lock-up period

## Architecture

### Contracts

- `TokenRegistry`: Register tokens, set fee ranges
- `PaymasterFactory`: Deploy paymaster instances
- `PriceOracle`: Multi-token pricing
- Per-token instances:
  - `LiquidityVault`: ETH + token pools
  - `FeeDistributor`: Fee splits (app vs LPs)
  - `LiquidityPaymaster`: ERC-4337 gas sponsorship

### Frontend Stack

- React + TypeScript
- Viem + Wagmi (blockchain interaction)
- RainbowKit (wallet connection)
- TanStack Query (state management)
- Recharts (analytics)

## Development

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Build for production
bun run build
```

## Auto-Start with Dev Environment

✅ **This app automatically starts** when you run `bun run dev` from the repo root.

The startup script (`scripts/dev.ts`) will:

1. Auto-install dependencies if needed
2. Connect to L2 localnet RPC (`http://localhost:9545`)
3. Load deployed contract addresses from `.env.local`
4. Start the dashboard on port 4001
5. Display status in the unified dashboard

No manual setup required - just run `bun run dev` from the root!

### MetaMask Configuration

**STATIC PORT - Never Changes:**

- **Network Name:** Jeju Localnet
- **RPC URL:** `http://127.0.0.1:9545` ← **L2 - Use this!**
- **Chain ID:** `1337`
- **Currency:** ETH

The dev environment automatically forwards port 9545 to Kurtosis, so you **never** need to update your wallet!

## Contract Integration

Contracts are deployed via `scripts/deploy-paymaster-system.ts`:

```bash
# Deploy all contracts
bun run scripts/deploy-paymaster-system.ts

# This creates .env.local with addresses
```

The dashboard automatically reads from `.env.local` to connect to contracts.

## Screenshots

### Token List
Browse all registered tokens, see their fee ranges, volume, and deployment status.

### Deploy Paymaster
One-click deployment for any registered token. Factory handles all the complexity.

### LP Dashboard  
Track your liquidity positions across all paymasters. Claim fees anytime.

## License

MIT
