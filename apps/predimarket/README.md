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

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Full flow test (requires localnet)
./test-complete-flow.sh
```

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

