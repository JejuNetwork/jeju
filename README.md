# Jeju Network

OP-Stack L2 on Ethereum with 200ms Flashblocks.

## Quick Start

```bash
# Prerequisites
brew install --cask docker
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash

# Run
git clone https://github.com/elizaos/jeju.git && cd jeju
bun install
bun run dev
```

No configuration needed. Private vendor apps (hyperscape, babylon, cloud, etc.) are automatically cloned if you have access.

## What Starts

| Service | URL |
|---------|-----|
| Jeju (L2) RPC | http://127.0.0.1:9545 |
| Ethereum (L1) RPC | http://127.0.0.1:8545 |
| GraphQL | http://127.0.0.1:4350/graphql |
| Gateway | http://127.0.0.1:4001 |
| Bazaar | http://127.0.0.1:4006 |
| ICO / Presale | http://127.0.0.1:4020 |
| Intent Aggregator | http://127.0.0.1:4010 |
| Intent Viewer | http://127.0.0.1:5173 |

## Test Account

```
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key:     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Chain ID: `1337`

## Commands

```bash
bun run dev                  # Start everything
bun run dev -- --minimal     # Chain only
bun run test                 # Run tests

# Contracts
cd packages/contracts
forge test                   # Test contracts
forge build                  # Build contracts
```

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Localnet | 1337 | http://127.0.0.1:9545 |
| Testnet | 420690 | https://testnet-rpc.jeju.network |
| Mainnet | 420691 | https://rpc.jeju.network |

## Deployment

### Prerequisites Check

```bash
# Run preflight checks before deployment
bun run scripts/preflight-testnet.ts
```

### Deploy to Testnet

```bash
# Copy and configure environment
cp env.testnet .env.testnet
# Edit .env.testnet with your DEPLOYER_PRIVATE_KEY

# Deploy contracts
bun run scripts/deploy/testnet.ts

# Deploy EIL (cross-chain)
bun run scripts/deploy/eil.ts testnet

# Deploy OIF (intents)
cd packages/contracts
PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY forge script script/DeployOIF.s.sol \
  --rpc-url https://testnet-rpc.jeju.network --broadcast
```

See `packages/deployment/TESTNET_RUNBOOK.md` for complete guide.

### Deploy to Mainnet

```bash
# See packages/deployment/MAINNET_RUNBOOK.md for full checklist
bun run scripts/deploy/mainnet.ts
```

### Deployed Contracts (Testnet)

| Contract | Chain | Address |
|----------|-------|---------|
| L1StakeManager | Sepolia | `0x355281d1974BfB64F9d475d01936e5dB37396DA3` |
| SolverRegistry | Base Sepolia | `0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de` |
| InputSettler | Base Sepolia | `0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75` |
| OutputSettler | Base Sepolia | `0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5` |

## Open Intents Framework (OIF)

Cross-chain intent system with ERC-7683 compatible contracts.

### Quick Start

```bash
# Intent functionality is now part of Gateway
cd apps/gateway && bun run dev          # UI + A2A Server (ports 4001, 4003)
cd apps/gateway && bun run dev:solver   # Standalone solver agent
```

### Deploy OIF Contracts

```bash
cd packages/contracts
PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY forge script script/DeployOIF.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast
```

### OIF Architecture

| Component | Description |
|-----------|-------------|
| `InputSettler` | User intent creation, fund locking |
| `OutputSettler` | Solver fills, output delivery |
| `SolverRegistry` | Solver staking and slashing |
| `OracleAdapter` | Cross-chain attestations |

| Service | Port | Purpose |
|---------|------|---------|
| Gateway A2A | 4003 | REST API, A2A, MCP |
| WebSocket | 4012 | Real-time updates |
| Gateway UI | 4001 | Web UI |

See `apps/gateway/README.md` for full documentation.

## Ethereum Interop Layer (EIL)

Trustless cross-chain transfers without bridges. Users can use tokens from Ethereum, Base, or other L2s directly on Jeju.

### Architecture

```
User on Ethereum → L1StakeManager → CrossChainPaymaster → User gets tokens on Jeju
```

### Key Contracts

| Contract | Purpose |
|----------|---------|
| `L1StakeManager` | XLP staking on L1 (Ethereum) |
| `CrossChainPaymaster` | ERC-4337 paymaster for cross-chain swaps |
| `LiquidityPaymaster` | Pay gas in tokens (not ETH) |

### Become an XLP (Cross-chain Liquidity Provider)

```bash
# Register as XLP on L1 (requires 1+ ETH stake)
cast send $L1_STAKE_MANAGER "register(uint256[])" "[420691]" \
  --value 1ether --rpc-url $L1_RPC --private-key $PK

# Deposit liquidity on L2
cast send $CROSS_CHAIN_PAYMASTER "depositETH()" \
  --value 0.5ether --rpc-url $L2_RPC --private-key $PK
```

### Become a Solver (OIF)

```bash
# Register solver (requires 0.5 ETH stake)
cast send $SOLVER_REGISTRY "register(uint256[])" "[420691,84532]" \
  --value 0.5ether --rpc-url $RPC --private-key $PK

# Deposit fill liquidity
cast send $OUTPUT_SETTLER "depositETH()" \
  --value 1ether --rpc-url $RPC --private-key $PK
```

See `packages/deployment/TESTNET_RUNBOOK.md` for complete setup.

## JEJU Token

The native governance and utility token for Jeju Network.

### Token Utility

| Use Case | Description |
|----------|-------------|
| Governance | Vote on protocol proposals and upgrades |
| Moderation | Stake in the futarchy moderation marketplace |
| Services | Pay for compute, storage via paymaster |

### Presale

```bash
# Run the presale app
cd apps/ico && bun run dev

# Deploy presale contract
cd packages/contracts
PRIVATE_KEY=$PK forge script script/DeployPresale.s.sol --rpc-url $RPC --broadcast
```

See `apps/ico/README.md` for full documentation.

## Configuration

**Config-first architecture**: All public values live in JSON config files. Environment variables only override or provide secrets.

### Config Files

| Config | Location | Purpose |
|--------|----------|---------|
| Chain | `packages/config/chain/*.json` | Network settings (RPC, chain ID, bridge contracts) |
| Contracts | `packages/config/contracts.json` | All contract addresses (Jeju + external chains) |
| Services | `packages/config/services.json` | API URLs per network |
| Tokens | `packages/config/tokens.json` | Token definitions |
| Ports | `packages/config/ports.ts` | Local port allocations |

### Usage

```typescript
import { getConfig, getContract, getServiceUrl, getExternalContract } from '@jejunetwork/config';

// Full config for current network
const config = getConfig();

// Contract address (env override: OIF_SOLVER_REGISTRY)
const solver = getContract('oif', 'solverRegistry');

// Service URL (env override: INDEXER_GRAPHQL_URL)
const indexer = getServiceUrl('indexer', 'graphql');

// External chain contract (Base Sepolia, etc.)
const baseSolver = getExternalContract('baseSepolia', 'oif', 'solverRegistry');
```

### Environment Overrides

Environment variables override config values (not replace them):

```bash
# Override RPC URL
JEJU_RPC_URL=https://custom-rpc.example.com

# Override contract address
OIF_SOLVER_REGISTRY=0x...

# Override service URL  
GATEWAY_API_URL=https://custom-gateway.example.com
```

### Secrets Only in .env

Only actual secrets go in `.env.{network}`:

```bash
# Required
DEPLOYER_PRIVATE_KEY=0x...

# Optional API keys
ETHERSCAN_API_KEY=...
WALLETCONNECT_PROJECT_ID=...
OPENAI_API_KEY=...
```

### Deployment Updates

When deploying contracts, update the config files:
```bash
# After deploying, update contracts.json
packages/config/contracts.json

# After infrastructure changes, update services.json
packages/config/services.json
```

## Troubleshooting

**Docker not running**: Start Docker Desktop

**Port in use**: `lsof -i :9545` then `kill -9 <PID>`

**Reset**: `kurtosis clean -a`

## Links

- [Docs](https://docs.jeju.network)
- [Discord](https://discord.gg/jeju)
- [GitHub](https://github.com/elizaos/jeju)
