# Open Intents Framework (OIF)

Cross-chain intent system for Jeju Network. Users specify desired outcomes, solvers compete to fulfill them.

## Overview

OIF implements ERC-7683 compatible cross-chain intents:

1. **User** creates intent specifying desired outcome (e.g., "swap 1 ETH on Ethereum for USDC on Jeju")
2. **Aggregator** collects intents and routes to solvers
3. **Solver** evaluates profitability and fills the intent
4. **Oracle** attests to cross-chain fill completion
5. **Settlement** releases locked funds to appropriate parties

## Quick Start

```bash
# Start all services (from repo root)
bun run dev

# Or start individually
cd apps/intents/aggregator && bun run src/index.ts  # Port 4010
cd apps/intents/solver && bun run src/index.ts      # Port 4011
cd apps/intents/viewer && bun run dev               # Port 5173
```

## Architecture

### Smart Contracts

Located in `packages/contracts/src/oif/`:

| Contract | Purpose |
|----------|---------|
| `InputSettler.sol` | Intent creation, fund locking, refunds |
| `OutputSettler.sol` | Solver fills, output delivery |
| `SolverRegistry.sol` | Solver registration, staking, slashing |
| `OracleAdapter.sol` | Cross-chain attestation verification |
| `IOIF.sol` | Interfaces (ERC-7683 compatible) |

### Off-Chain Services

| Service | Port | Description |
|---------|------|-------------|
| Aggregator | 4010 | Intent aggregation, routing, APIs |
| WebSocket | 4012 | Real-time intent updates |
| Solver | 4011 | Automated intent fulfillment |
| Viewer | 5173 | Web UI for intent management |

### Aggregator APIs

**REST API** (`/api/*`):
- `POST /api/intents` - Create intent
- `GET /api/intents` - List intents
- `GET /api/intents/:id` - Get intent details
- `POST /api/intents/quote` - Get quote
- `GET /api/routes` - List supported routes
- `GET /api/solvers` - List active solvers
- `GET /api/stats` - Network statistics

**A2A Protocol** (`/a2a`):
- Agent-to-agent communication for AI agents
- Skills: `create-intent`, `get-quote`, `list-routes`, `get-solver-liquidity`
- Agent card at `/.well-known/agent-card.json`

**MCP Protocol** (`/mcp`):
- Model Context Protocol for AI integration
- Resources: `intent://`, `route://`, `solver://`
- Tools: `create_intent`, `get_quote`, `list_routes`

**WebSocket** (`ws://localhost:4012`):
- Subscribe to: `intents`, `solvers`, `stats`
- Real-time updates on intent status changes

## Deployment

### 1. Deploy Contracts

```bash
cd packages/contracts

# Deploy to Jeju (chain 420690)
PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY forge script script/DeployOIF.s.sol \
  --rpc-url https://rpc.testnet.jeju.network \
  --broadcast \
  --verify

# Deploy to Sepolia (chain 11155111) - Jeju L1
PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY forge script script/DeployOIF.s.sol \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast \
  --verify
```

The deployment script outputs environment variables to add to your `.env`:

```
OIF_SOLVER_REGISTRY_420690=0x...
OIF_ORACLE_420690=0x...
OIF_INPUT_SETTLER_420690=0x...
OIF_OUTPUT_SETTLER_420690=0x...
```

### 2. Configure Environment

Add to `.env`:

```bash
# OIF Service Ports
OIF_AGGREGATOR_PORT=4010
OIF_AGGREGATOR_WS_PORT=4012
OIF_SOLVER_PORT=4011

# Oracle Type (simple, hyperlane, superchain)
OIF_ORACLE_TYPE=simple

# Contract Addresses (from deployment)
OIF_INPUT_SETTLER_420690=0x...
OIF_OUTPUT_SETTLER_420690=0x...
OIF_SOLVER_REGISTRY_420690=0x...
OIF_ORACLE_420690=0x...

# Solver Configuration
OIF_SOLVER_PRIVATE_KEY=0x...
OIF_SOLVER_MIN_PROFIT_BPS=50
OIF_SOLVER_MAX_SLIPPAGE_BPS=100

# Supported Chains
OIF_SUPPORTED_CHAINS=420690,11155111

# RPC URLs
OIF_RPC_420690=https://testnet-rpc.jeju.network
OIF_RPC_11155111=https://ethereum-sepolia-rpc.publicnode.com
```

### 3. Start Services

```bash
# Aggregator (required)
cd apps/intents/aggregator && bun run src/index.ts

# Solver (optional - for automated filling)
cd apps/intents/solver && bun run src/index.ts

# Viewer (optional - for web UI)
cd apps/intents/viewer && bun run dev
```

## Oracle Types

### SimpleOracle (Default)
Trusted attester model. Good for development and controlled environments.

### HyperlaneOracle
Uses Hyperlane for cross-chain message verification. Requires:
```bash
HYPERLANE_MAILBOX=0x...
HYPERLANE_ISM=0x...
```

### SuperchainOracle
Uses OP Superchain native interop. Best for OP Stack chains with shared sequencer.

## Testing

```bash
# Smart contract tests (70 tests)
cd packages/contracts
forge test --match-path "test/OIF*.sol"

# Aggregator tests (77 tests)
cd apps/intents/aggregator && bun test

# Solver tests (18 tests)
cd apps/intents/solver && bun test

# Cross-chain tests (14 tests)
cd apps/intents && bun test test/cross-chain.test.ts
```

## Intent Flow

```
┌─────────┐     ┌────────────┐     ┌────────────┐     ┌─────────────┐
│  User   │────▶│ Aggregator │────▶│   Solver   │────▶│ OutputSettler│
│         │     │            │     │            │     │ (dest chain) │
└─────────┘     └────────────┘     └────────────┘     └─────────────┘
     │                                    │                  │
     ▼                                    │                  ▼
┌─────────────┐                          │           ┌──────────┐
│InputSettler │                          │           │  Oracle  │
│(src chain)  │◀─────────────────────────┘           │          │
└─────────────┘                                      └──────────┘
     │                                                     │
     └────────────── attestation ◀─────────────────────────┘
```

1. User calls `InputSettler.open()` with order details + funds
2. Aggregator broadcasts intent to solvers
3. Solver evaluates profitability and calls `OutputSettler.fill()`
4. Oracle attests to fill completion
5. `InputSettler.settle()` releases funds to solver

## Supported Chains

| Chain | Chain ID | Status |
|-------|----------|--------|
| Jeju Mainnet | 420691 | ✅ |
| Jeju Testnet | 420690 | ✅ |
| Ethereum | 1 | ✅ |
| Sepolia | 11155111 | ✅ |
| Arbitrum | 42161 | Ready |
| Optimism | 10 | Ready |

## File Structure

```
apps/intents/
├── aggregator/           # Intent aggregation service
│   ├── src/
│   │   ├── index.ts      # Entry point
│   │   ├── api.ts        # REST endpoints
│   │   ├── a2a-server.ts # A2A protocol
│   │   ├── mcp-server.ts # MCP protocol
│   │   ├── websocket.ts  # Real-time updates
│   │   ├── services/     # Business logic
│   │   └── middleware/   # Rate limiting, etc.
│   └── test/             # Unit & API tests
├── solver/               # Automated solver agent
│   ├── src/
│   │   ├── index.ts      # Entry point
│   │   ├── agent.ts      # Core solver logic
│   │   ├── monitor.ts    # Intent monitoring
│   │   ├── strategy.ts   # Profitability analysis
│   │   └── liquidity.ts  # Liquidity management
│   └── test/             # Unit & integration tests
├── viewer/               # Web UI
│   ├── src/
│   │   ├── App.tsx       # Main app
│   │   ├── pages/        # Views
│   │   ├── components/   # UI components
│   │   └── hooks/        # React hooks
│   └── tests/            # E2E tests
└── test/                 # Cross-chain tests

packages/contracts/src/oif/
├── IOIF.sol              # Interfaces
├── InputSettler.sol      # Source chain settler
├── OutputSettler.sol     # Destination chain settler
├── SolverRegistry.sol    # Solver management
└── OracleAdapter.sol     # Oracle implementations
```

## Links

- [ERC-7683 Specification](https://eips.ethereum.org/EIPS/eip-7683)
- [Ethereum Interoperability Layer](https://ethereum.org/en/roadmap/)
- [Jeju Docs](https://docs.jeju.network)
