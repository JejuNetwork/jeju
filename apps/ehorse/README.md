# 🐴 eHorse Racing

> **The simplest possible prediction game**

A minimal horse racing game designed to demonstrate prediction markets without the complexity of Caliguland.

## 🎯 What It Does

1. **4 horses race** every 90 seconds (Thunder, Lightning, Storm, Blaze)
2. **Random winner** is selected
3. **Results published on-chain** via PredictionOracle
4. **Agents predict winners** and bet on Predimarket
5. **That's it!** No social feed, no NPCs, no complexity

## 🚀 Quick Start

```bash
cd apps/ehorse

# Install dependencies
bun install

# Run server (standalone mode - no blockchain)
bun run dev

# Open browser
open http://localhost:5700
```

The game will:
- ✅ Start races automatically every 90 seconds
- ✅ Show current race status
- ✅ Display race history
- ✅ Provide A2A interface for agents

## 🔗 With Blockchain (Optional)

### 1. Start Local Blockchain

```bash
# In a separate terminal
anvil
```

### 2. Deploy Contracts

```bash
# Deploy all contracts with one command
bun run deploy
```

This will:
- Deploy PredictionOracle
- Deploy Predimarket
- Deploy MarketFactory
- Configure everything automatically
- Save addresses to `.env`

### 3. Run with Oracle Integration

```bash
# Load environment
source .env

# Start eHorse
bun run dev
```

Now race results will be published on-chain automatically!

## 🤖 Agent Integration

### A2A Discovery

Agents can discover the game via ERC-8004 registry or direct connection:

```bash
# Fetch Agent Card
curl http://localhost:5700/.well-known/agent-card.json
```

Agent Card includes 3 skills:
- `get-race-status` - Current race info
- `get-horses` - List of horses
- `get-race-history` - Past race results

### Example Agent (TypeScript)

```typescript
// Minimal prediction agent
const agentCard = await fetch('http://localhost:5700/.well-known/agent-card.json');
const skills = agentCard.skills;

// Get current race
const statusSkill = skills.find(s => s.id === 'get-race-status');
const raceStatus = await callA2ASkill(statusSkill.id);

// If race is pending, make prediction
if (raceStatus.race.status === 'pending') {
  // Pick random horse (or use strategy)
  const prediction = Math.floor(Math.random() * 4) + 1;
  
  // Bet on Predimarket
  await predimarket.buy(raceStatus.race.id, prediction, amount);
}
```

## 📊 Integration with Predimarket

### How It Works

```
Race Starts (pending)
  ↓
Oracle commits outcome
  ↓
Predimarket creates market automatically
  ↓
Agents place bets (60 seconds)
  ↓
Race finishes
  ↓
Oracle reveals winner
  ↓
Predimarket resolves market
  ↓
Winners claim payouts
```

### Binary Mapping

Since PredictionOracle uses binary outcomes:
- **Horse 1-2 wins** → `outcome = false` (NO)
- **Horse 3-4 wins** → `outcome = true` (YES)

Agents should bet:
- Thunder or Lightning → Bet NO on Predimarket
- Storm or Blaze → Bet YES on Predimarket

## 🎮 For Agents

### Using Caliguland Generic Agents

The Caliguland generic agents can play eHorse with ZERO code changes:

```bash
cd ../caliguland/caliguland-agents

# Point to eHorse server
export GAME_SERVER_URL=http://localhost:5700

# Start agents
bun run dev
```

Agents will:
1. Discover eHorse via Agent Card
2. Load the 3 skills dynamically
3. Query race status
4. Make predictions on Predimarket automatically

### Custom Prediction Agent

```bash
# Set up environment
export PREDIMARKET_ADDRESS=0x...       # From .env
export ELIZAOS_ADDRESS=0x...          # From .env
export AGENT_PRIVATE_KEY=0x...         # Your agent's private key
export RPC_URL=http://localhost:8545

# Run the example agent
bun run agent
```

The example agent will:
1. Connect to eHorse and monitor races
2. Automatically bet on random horses (Storm or Blaze)
3. Approve elizaOS spending for Predimarket
4. Place bets when markets are created
5. Show results in console

See `scripts/example-agent.ts` for the full implementation.

## 📁 Project Structure

```
apps/ehorse/
├── src/
│   ├── index.ts          # Main server
│   ├── game.ts           # Race engine
│   ├── a2a.ts            # A2A interface
│   ├── oracle.ts         # Oracle publisher
│   ├── registry.ts       # ERC-8004 registration
│   └── market-creator.ts # Auto-create markets
├── scripts/
│   ├── deploy.ts         # Deploy contracts
│   ├── example-agent.ts  # Example betting agent
│   ├── test.ts           # Quick tests
│   ├── setup-test-env.ts # E2E test setup
│   └── run-complete-test.sh # Full test suite
├── tests/e2e/           # Playwright E2E tests
├── public/
│   ├── index.html       # Race viewer UI
│   └── state-panel.html # On-chain state viewer
├── package.json
├── jeju-manifest.json
└── README.md
```

**Total: ~2,000 lines** (vs Caliguland's 15,000+ lines!)

## 🔧 Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| `EHORSE_PORT` | Server port | No (default: 5700) |
| `RPC_URL` | Blockchain RPC | No |
| `PRIVATE_KEY` | Deployer key | No |
| `PREDICTION_ORACLE_ADDRESS` | Oracle contract | No |

## 🎯 Design Goals

### What We REMOVED vs Caliguland:
- ❌ No social feed
- ❌ No NPCs with AI personalities
- ❌ No information asymmetry
- ❌ No alliances or betrayals
- ❌ No direct messages
- ❌ No complex game phases
- ❌ No LMSR market maker (use Predimarket instead)
- ❌ No scenario generation
- ❌ No clue distribution

### What We KEPT:
- ✅ ERC-8004 compatibility
- ✅ A2A protocol support
- ✅ Oracle integration
- ✅ Agent discovery
- ✅ Predimarket integration

## 📈 Comparison

| Feature | Caliguland | eHorse |
|---------|-----------|---------|
| Lines of code | 15,000+ | ~630 |
| Game duration | 60 minutes | 1 minute |
| Complexity | High | Minimal |
| Features | 50+ | 3 |
| NPCs | 8+ with AI | 0 |
| Outcomes | Binary | 4 horses → Binary |
| Setup time | 30 min | 2 min |

## 🧪 Testing

### Quick Test

```bash
# Start eHorse
bun run dev

# In another terminal, run quick tests
bun run test
```

### Complete E2E Test Suite

```bash
# Start anvil (separate terminal)
anvil

# Run complete test suite (deploys contracts, starts server, runs all tests)
bun run test:complete
```

This will:
- ✅ Deploy all contracts
- ✅ Fund test wallets
- ✅ Start eHorse server
- ✅ Run full E2E test suite with Playwright
- ✅ Test multi-token betting
- ✅ Verify on-chain state
- ✅ Clean up automatically

### Manual Testing

```bash
# Check server is running
curl http://localhost:5700/health

# Get current race
curl http://localhost:5700/api/race

# Check A2A interface
curl http://localhost:5700/.well-known/agent-card.json
```

## 🚢 Deployment

### Localnet

```bash
# 1. Start anvil
anvil

# 2. Deploy contracts (in another terminal)
cd apps/ehorse
bun run deploy

# 3. Start eHorse
source .env
bun run dev

# 4. (Optional) Run agent
bun run agent

# 5. Open browser
open http://localhost:5700
```

### Production

```bash
# Build
bun run build

# Deploy contracts on production chain
RPC_URL=https://... \
PRIVATE_KEY=0x... \
bun run deploy

# Start server
source .env
bun run start
```

## 🎲 How Betting Works

1. **Race starts** (pending status)
2. **Oracle commits** outcome hash on-chain
3. **Predimarket** auto-creates market for this race
4. **Agents bet** on which horse will win (mapped to YES/NO)
5. **Race finishes** after 60 seconds
6. **Oracle reveals** winner on-chain
7. **Predimarket resolves** market
8. **Winners claim** payouts

## 💡 Use Cases

### 1. Demo for Investors
Show prediction markets in action with instant gratification (1-minute races).

### 2. Agent Testing
Test prediction agents without complex game logic.

### 3. Market Mechanics Demo
Demonstrate oracle → market → resolution flow.

### 4. Educational
Learn how prediction markets work without distractions.

## 🔮 Future Enhancements (Maybe)

- [ ] Horse stats/abilities (speed, stamina)
- [ ] Track conditions
- [ ] Multiple races simultaneously
- [ ] Leaderboard for best predictors
- [ ] Configurable race duration

## 📝 License

Apache-2.0

---

**Built with simplicity in mind** - The anti-Caliguland! 🐴



