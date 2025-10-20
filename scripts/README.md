# Jeju Scripts

Comprehensive collection of deployment, development, and utility scripts for the Jeju ecosystem.

## Quick Start

```bash
# Development
bun run dev              # Start complete dev environment
bun run dev:vendor       # Start vendor apps only
bun run build            # Build all components
bun run test             # Run all tests
bun run clean            # Clean build artifacts

# Deployment  
bun run deploy:testnet   # Deploy to testnet
bun run deploy:mainnet   # Deploy to mainnet

# Utilities
bun run apps:list        # List all apps
bun run wallet           # Show MetaMask config
bun run ports            # Check port assignments
bun run cleanup          # Kill orphaned processes
```

## Directory Structure

```
scripts/
├── dev.ts                          # Main dev environment
├── build.ts                        # Build all components
├── test.ts                         # Master test suite
├── deploy.ts                       # Unified deployment
│
├── deploy/                         # Deployment helpers
│   ├── account-abstraction.ts      # Deploy AA contracts
│   ├── defi-protocols.ts           # Deploy DeFi
│   ├── l1-contracts.ts             # Deploy to Base L1
│   └── l2-genesis.ts               # Generate genesis
│
├── localnet/                       # Localnet management
│   ├── start.ts                    # Start Kurtosis
│   ├── stop.ts                     # Stop Kurtosis
│   └── reset.ts                    # Reset Kurtosis
│
├── shared/                         # Shared utilities
│   ├── discover-apps.ts            # App discovery
│   ├── logger.ts                   # Structured logging
│   ├── format.ts                   # Formatting utils
│   ├── rpc.ts                      # RPC with failover
│   ├── notifications.ts            # Discord/Telegram
│   ├── bridge-helpers.ts           # Bridge utilities
│   ├── token-utils.ts              # Token formatting
│   └── protocol-tokens.ts          # Token registry
│
├── monitoring/                     # Monitoring & alerts
│   ├── heartbeat.ts                # Node heartbeat
│   ├── sync-alerts.ts              # Prometheus alerts
│   └── sync-dashboards.ts          # Grafana dashboards
│
├── oracle/                         # Oracle documentation
│   ├── README.md                   # Oracle guide
│   ├── multi-node-setup.md         # Multi-node guide
│   ├── deploy-oracle-node.sh       # Production deployment
│   └── monitoring-config.yaml      # Monitoring setup
│
├── rewards/                        # Node rewards
│   └── rewards-oracle.ts           # Update performance data
│
├── leaderboard/                    # Contributor rewards
│   ├── monthly-distribution.ts     # Monthly payouts
│   └── verify-snapshot.ts          # Verify integrity
│
├── vendor/                         # Vendor app tools
│   └── create-vendor-manifest.ts   # Create manifests
│
├── auto-update/                    # Node auto-updates
│   └── update-manager.ts           # Auto-update manager
│
└── snapshots/                      # Chain snapshots
    ├── create-snapshot.ts          # Create snapshots
    └── download-snapshot.sh        # Download snapshots
```

## Script Categories

### 🚀 Development

| Script | Purpose |
|--------|---------|
| `dev.ts` | Complete development environment (localnet + indexer + all apps) |
| `dev-with-vendor.ts` | Vendor apps only (lightweight) |
| `build.ts` | Build contracts, TypeScript, indexer, docs |
| `test.ts` | Run all tests (contracts + TypeScript + integration + E2E) |
| `clean.ts` | Clean build artifacts and Docker resources |
| `cleanup-processes.ts` | Kill orphaned bun/node processes |
| `preflight-check.ts` | Verify requirements before `bun run dev` |
| `setup-apps.ts` | Initialize git submodules and workspace |

### 📦 Bootstrap & Initialization

| Script | Purpose |
|--------|---------|
| `bootstrap-localnet-complete.ts` | Deploy complete localnet ecosystem (tokens + paymaster + pools + funding) |
| `init-multi-token-pools.ts` | Initialize Uniswap V4 pools for all tokens |
| `init-multi-token-prices.ts` | Set oracle prices for all tokens |
| `fund-test-accounts.ts` | Fund 10 test accounts with all tokens |

### 🏗️ Deployment

| Script | Purpose | Network |
|--------|---------|---------|
| `deploy.ts` | Unified deployment orchestrator | testnet/mainnet |
| `deploy-eliza-token.ts` | Deploy ElizaOS token | all |
| `deploy-usdc-localnet.ts` | Deploy USDC with faucet | localnet |
| `deploy-jeju-usdc.ts` | Deploy USDC + ServicePaymaster | testnet/mainnet |
| `deploy-multi-token-system.ts` | Deploy all protocol tokens + paymasters | all |
| `deploy-uniswap-v4.ts` | Deploy Uniswap V4 PoolManager | all |
| `deploy-oracle.ts` | Deploy oracle system | testnet/mainnet |
| `deploy-paymaster-system.ts` | Deploy TokenRegistry + PaymasterFactory | all |
| `deploy-service-integration.ts` | Deploy cloud service contracts | all |
| `deploy-node-system.ts` | Deploy NodeStakingManager (multi-token) | all |
| `deploy-rpg-canonical.ts` | Deploy shared RPG contracts | all |
| `deploy-rpg-game.ts` | Deploy individual RPG game | all |

### 🌉 Bridge

| Script | Purpose |
|--------|---------|
| `bridge-multi-tokens.ts` | CLI tool to bridge any token (CLANKER, VIRTUAL, etc.) |
| `bridge-all-l1-tokens-to-l2.ts` | Batch bridge all protocol tokens |

### 🤖 Oracle & Automation

| Script | Purpose |
|--------|---------|
| `oracle-updater.ts` | Production price bot (Chainlink + Base DEX) |
| `oracle-updater-localnet.ts` | Localnet price bot (mock prices) |
| `oracle-updater.Dockerfile` | Oracle bot container image |
| `oracle-updater.compose.yml` | Oracle bot compose file |
| `start-localnet-oracle.sh` | Start localnet oracle (shell script) |
| `auto-update/update-manager.ts` | Auto-update node software |

### 📊 Monitoring

| Script | Purpose |
|--------|---------|
| `monitor-bridge-transfers.ts` | Watch bridge events in real-time |
| `monitor-service-integration.ts` | Cloud integration dashboard |
| `monitoring/heartbeat.ts` | Node heartbeat service |
| `monitoring/sync-alerts.ts` | Sync Prometheus alerts to K8s ConfigMap |
| `monitoring/sync-dashboards.ts` | Sync Grafana dashboards to K8s ConfigMap |
| `rewards/rewards-oracle.ts` | Update node performance scores |

### 💰 Leaderboard & Rewards

| Script | Purpose |
|--------|---------|
| `leaderboard/monthly-distribution.ts` | Generate & submit monthly contributor snapshots |
| `leaderboard/verify-snapshot.ts` | Verify snapshot integrity before submission |

### ✅ Validation & Verification

| Script | Purpose |
|--------|---------|
| `validate-config.ts` | Validate network configurations |
| `validate-manifests.ts` | Validate app manifest files |
| `verify-contracts.ts` | Verify contracts on block explorer |
| `verify-documentation.ts` | Check documentation coverage |
| `verify-gateway-portal.ts` | Verify Gateway token integration |
| `verify-localnet-config.ts` | Verify localnet-first setup |
| `verify-multi-token-system.ts` | Verify all paymasters operational |
| `verify-oracle-integration.ts` | Verify oracle system integration |
| `verify-uniswap-v4-deployment.ts` | Verify Uniswap V4 deployment |

### 🧪 Testing

| Script | Purpose |
|--------|---------|
| `test-jeju-detection.ts` | Test RPC auto-detection |
| `smoke-test-multi-token.ts` | Quick end-to-end multi-token test |
| `economics-model.ts` | Node rewards economics analysis |

### 🛠️ Utilities

| Script | Purpose |
|--------|---------|
| `list-apps.ts` | List all discovered apps (core + vendor) |
| `show-wallet-config.ts` | Display MetaMask configuration |
| `check-ports.ts` | Validate port assignments |
| `register-governance-in-erc8004.ts` | Register in identity registry |
| `rpcDetector.ts` | Auto-detect Jeju network |
| `vendor/create-vendor-manifest.ts` | Interactive manifest creator |

### 🏗️ Infrastructure Scripts

| Script | Purpose |
|--------|---------|
| `start.ts` | Production start (all services) |
| `generate-genesis.sh` | Generate genesis/rollup configs |
| `install-node.sh` | One-command node installer |
| `oracle/deploy-oracle-node.sh` | Deploy multi-cloud oracle bot |
| `snapshots/create-snapshot.ts` | Create chain snapshots |
| `snapshots/download-snapshot.sh` | Download snapshots |

## Common Workflows

### Local Development
```bash
# Start everything
bun run dev

# Or check prerequisites first
bun run preflight
bun run dev

# Clean restart
bun run cleanup
bun run clean
bun run dev
```

### Deploy to Localnet
```bash
# One command bootstrap
bun run scripts/bootstrap-localnet-complete.ts

# Or step by step
forge script script/DeployMultiTokenSystem.s.sol --broadcast
bun run scripts/init-multi-token-pools.ts
bun run scripts/init-multi-token-prices.ts
bun run scripts/fund-test-accounts.ts
```

### Deploy to Testnet
```bash
# Complete deployment
NETWORK=testnet bun run deploy:testnet

# Or individual components
bun run scripts/deploy-uniswap-v4.ts
bun run scripts/deploy-oracle.ts
bun run scripts/deploy-paymaster-system.ts
```

### Run Oracle Bot
```bash
# Localnet
bun run scripts/oracle-updater-localnet.ts

# Production (requires env vars)
export ORACLE_ADDRESS=0x...
export ELIZAOS_TOKEN_BASE=0x...
export PRICE_UPDATER_PRIVATE_KEY=0x...
bun run scripts/oracle-updater.ts
```

### Monitoring
```bash
# Bridge transfers
bun run scripts/monitor-bridge-transfers.ts

# Cloud integration
bun run scripts/monitor-service-integration.ts

# Node heartbeat (production)
export NODE_ID=node-123
export OPERATOR_PRIVATE_KEY=0x...
bun run scripts/monitoring/heartbeat.ts
```

## Environment Variables

See individual script headers for required environment variables. Common ones:

- `PRIVATE_KEY` / `DEPLOYER_PRIVATE_KEY` - Deployment key
- `JEJU_RPC_URL` - Jeju RPC endpoint  
- `BASE_RPC_URL` - Base RPC endpoint
- `ORACLE_ADDRESS` - Oracle contract address
- `DISCORD_WEBHOOK` - Discord notifications
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` - Telegram notifications

## Documentation

- [SCRIPT_AUDIT.md](./SCRIPT_AUDIT.md) - Detailed audit findings
- [CLEANUP_SUMMARY.md](./CLEANUP_SUMMARY.md) - Cleanup summary
- [shared/README.md](./shared/README.md) - Shared utilities docs
- [oracle/README.md](./oracle/README.md) - Oracle system guide
- [rewards/README.md](./rewards/README.md) - Node rewards guide
- [auto-update/README.md](./auto-update/README.md) - Auto-update guide

## Testing

All shared utilities have comprehensive test suites:

```bash
bun test scripts/shared/           # Run all shared utility tests
bun test scripts/shared/format.test.ts
bun test scripts/shared/logger.test.ts  
bun test scripts/shared/notifications.test.ts
bun test scripts/shared/rpc.test.ts
```

**Current Status**: 71/71 tests passing ✅

## Contributing

When adding new scripts:

1. Place in appropriate subdirectory
2. Add proper JSDoc header with @fileoverview
3. Include usage examples in header
4. Use shared utilities from `scripts/shared/`
5. Add to this README if it's user-facing
6. Create tests for utility functions

## Support

- Documentation: See individual script headers
- Issues: GitHub Issues
- Discord: #dev-tools channel

