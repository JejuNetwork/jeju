# Predimarket - Decentralized Prediction Markets

> **Standalone prediction market platform powered by Caliguland oracle and elizaOS**

## 🎯 What is Predimarket?

Predimarket is a decentralized prediction market platform where users bet on real-world outcomes. It's **completely separate** from the Caliguland game but uses its oracle for trustless resolution.

### Key Features

- 🎲 **LMSR Automated Market Maker** - Continuous liquidity, no order books
- 🔐 **TEE Oracle Resolution** - Trustless outcome verification from Caliguland games
- ⚡ **Gasless Trading** - Pay fees in elizaOS via LiquidityPaymaster
- 🤖 **Agent Support** - ElizaOS agents can analyze and bet autonomously
- 📊 **Real-time Updates** - Live price charts and position tracking
- 💰 **Proportional Payouts** - Winners share the pool based on holdings

## 🏗️ Architecture

```
┌─────────────────┐
│ Caliguland Game │ (Separate app)
│  (Oracle source)│
└────────┬────────┘
         │ Publishes outcomes
         ▼
┌─────────────────────┐
│ PredictionOracle.sol│ (On-chain oracle)
└────────┬────────────┘
         │ Events
         ▼
┌─────────────────────┐
│  Predimarket.sol     │ (LMSR market maker)
│  + MarketFactory    │
└────────┬────────────┘
         │
    ┌────┴────┬─────────┬────────┐
    ▼         ▼         ▼        ▼
  Indexer  Frontend  Agents  Paymaster
  (GraphQL) (Next.js) (ElizaOS) (Gasless)
```

## 🚀 Quick Start

```bash
cd apps/predimarket

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with contract addresses

# Run
npm run dev

# Open browser
open http://localhost:4005
```

## 📦 Components

### Smart Contracts

**Predimarket.sol** - Main market contract
- LMSR automated market maker
- Buy/sell shares continuously
- Oracle-based resolution
- Proportional payouts

**MarketFactory.sol** - Market spawner
- Watches oracle events
- Creates markets automatically
- Permissionless market creation

### Frontend (Next.js 14)

- Market browsing with filters
- Trading interface with live prices
- Portfolio view with P&L
- Price charts (recharts)
- Wallet connection (RainbowKit + wagmi)

### Indexer

- GraphQL API for market data
- Real-time event indexing
- Historical price data
- User position tracking

### Agents (ElizaOS)

- Betting-only agents (no gameplay)
- Market analysis strategies
- Autonomous betting
- Paymaster integration

## 🎮 How It Works

### 1. Game Plays (Caliguland)

- Caliguland game runs with NPCs and players
- Game commits outcome hash at start
- Game reveals outcome at end
- Oracle contract stores results on-chain

### 2. Market Trading (Predimarket)

- Factory auto-creates market when oracle commits
- Traders buy YES/NO shares using elizaOS
- LMSR algorithm adjusts prices automatically
- Anyone can trade until oracle resolves

### 3. Resolution & Payouts

- Anyone calls `resolveMarket()` after oracle reveals
- Winners claim proportional share of pool
- Losers get nothing
- 1% platform fee goes to treasury

## 💰 Trading Example

```typescript
// User wants to bet 100 elizaOS on YES

// 1. Approve elizaOS spending
await elizaOS.approve(jejuMarketAddress, maxAmount);

// 2. Buy shares
const tx = await jejuMarket.buy(
  sessionId,      // Oracle session ID
  true,           // YES outcome
  100e18,         // 100 elizaOS
  0               // Min shares (slippage)
);

// 3. Wait for confirmation
await tx.wait();

// 4. After resolution, claim winnings
if (marketResolved && youWon) {
  const payout = await jejuMarket.claimPayout(sessionId);
}
```

## 🤖 Agent Betting

Agents can bet without playing the game:

```typescript
// In ElizaOS agent
import { PredimarketBettingService } from './services/jejuMarketBetting';

// Agent analyzes market
const prices = await betting.getMarketPrices(sessionId);

// Decides to bet
const decision: BetDecision = {
  sessionId,
  outcome: true, // YES
  amount: '250', // elizaOS
  confidence: 0.75
};

// Places bet
const result = await betting.placeBet(decision);
```

## 📊 GraphQL API

Query markets, trades, and positions:

```graphql
query {
  predictionMarkets(orderBy: createdAt_DESC, limit: 20) {
    sessionId
    question
    yesShares
    noShares
    totalVolume
    resolved
    outcome
  }
  
  marketTrades(where: { trader_eq: "0x..." }) {
    market { question }
    outcome
    shares
    cost
    timestamp
  }
}
```

## 🔧 Configuration

### Environment Variables

```bash
# Frontend (.env.local)
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:9545  # L2 - STATIC PORT
NEXT_PUBLIC_GRAPHQL_URL=http://localhost:4350/graphql
NEXT_PUBLIC_PREDIMARKET_ADDRESS=0x...
NEXT_PUBLIC_ELIZA_OS_ADDRESS=0x...
NEXT_PUBLIC_CHAIN_ID=42069

# Agents
AGENT_PRIVATE_KEY=0x...
PREDIMARKET_ADDRESS=0x...
ELIZAOS_ADDRESS=0x...
MAX_BET_PER_MARKET=1000
```

### Contract Deployment

```bash
cd ../../contracts

# Deploy Predimarket system
forge script script/DeployPredimarket.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify

# Addresses saved to: deployments/predimarket.json
```

## 🧪 Testing

### Quick Start
```bash
# Run all tests (unit + e2e)
bun run test

# Unit tests only (fast - ~800ms)
bun run test:unit

# E2E tests (requires dev server running)
bun run test:e2e

# Type checking
bun run lint
```

### Test Results ✅
- **Unit Tests**: 36/36 passing (100%)
- **E2E Tests**: 17/17 passing (100%)
- **Total**: 53 tests passing
- **Coverage**: Hooks, components, API routes, user flows

### Test Files
```
Unit Tests (36 tests):
- hooks/__tests__/*.test.ts (14 tests)
- tests/unit/components/*.test.tsx (17 tests)
- tests/unit/api/*.test.ts (5 tests)

E2E Tests (20 tests):
- tests/e2e/01-homepage.spec.ts (6 tests)
- tests/e2e/02-market-filters.spec.ts (4 tests)
- tests/e2e/03-portfolio.spec.ts (4 tests)
- tests/e2e/04-responsive.spec.ts (3 tests)
- tests/e2e/complete-flow.spec.ts (3 tests)
- tests/e2e/05-wallet-connection.spec.ts (3 tests - needs contracts)
- tests/e2e/06-trading-flow.spec.ts (5 tests - needs contracts)
- tests/e2e/07-market-resolution.spec.ts (4 tests - needs contracts)
```

### Wallet Tests
```bash
# Wallet tests (requires deployed contracts + headful mode)
bun run test:e2e:wallet
```

### Watch Mode
```bash
# Auto-run tests on file changes
bun run test:watch
```

See `README_TESTING.md` for comprehensive testing documentation.

## 🎯 Use Cases

### 1. Pure Predictors

- Watch Caliguland games
- Bet on outcomes
- Never play the game
- Just profit from predictions

### 2. Game Players

- Play in Caliguland game
- Also bet on Predimarket
- Double exposure (gameplay + betting)
- Can bet against own team (!)

### 3. Betting-Only Agents

- Analyze market signals
- No gameplay required
- Automated strategies
- 24/7 market making

### 4. Spectators

- Watch games
- Small bets for entertainment
- Follow leaderboards
- Social engagement

## 🔧 Troubleshooting

### "Can't resolve '@react-native-async-storage/async-storage'"

This is resolved via webpack configuration in `next.config.mjs`. The MetaMask SDK includes React Native dependencies that are automatically excluded for web builds.

### WalletConnect Project ID 403 Error

The app works without a WalletConnect project ID. To enable WalletConnect features:

1. Get a free project ID at https://cloud.walletconnect.com
2. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in your environment
3. Restart the dev server

Without a project ID, WalletConnect-specific features are disabled but MetaMask and other injected wallets work fine.

## 🔐 Security

- **Oracle Trust**: Caliguland oracle is TEE-attested (Dstack)
- **No Admin Keys**: Resolution controlled by oracle only
- **Pausable**: Emergency circuit breaker
- **Reentrancy Guards**: All value transfer functions
- **Tested**: 100+ unit tests, full E2E coverage

## 📈 Market Mechanics (LMSR)

### Price Formula

```
P(YES) = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
```

Where:
- `q_yes` = outstanding YES shares
- `q_no` = outstanding NO shares
- `b` = liquidity parameter (controls price sensitivity)

### Cost Function

```
C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
```

### Features

- Prices always sum to 100%
- More liquidity = less slippage
- Continuous trading (no order matching)
- Market maker never runs out of shares

## 🚀 Deployment Checklist

- [ ] Deploy PredictionOracle.sol (from Caliguland)
- [ ] Deploy ElizaOSToken.sol
- [ ] Deploy LiquidityPaymaster system
- [ ] Deploy Predimarket.sol
- [ ] Deploy MarketFactory.sol
- [ ] Start indexer
- [ ] Deploy frontend
- [ ] Configure agents
- [ ] Run E2E tests

## 🤝 Integration with Caliguland

Predimarket is **intentionally decentralized** from Caliguland:

- ✅ Separate codebase
- ✅ Separate deployment
- ✅ Connected only via on-chain oracle
- ✅ Can have many oracle sources
- ✅ Caliguland doesn't know about Predimarket
- ✅ Predimarket doesn't know about Caliguland internals

This enables:
- Multiple betting platforms on same oracle
- Multiple oracles (not just Caliguland games)
- Composability and extensibility
- True decentralization

## 📝 License

Apache-2.0

---

**Built with**: Next.js, TypeScript, Tailwind CSS, wagmi, RainbowKit, Subsquid, Solidity, elizaOS

