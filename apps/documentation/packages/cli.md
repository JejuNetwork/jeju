# CLI

Development, testing, and deployment CLI for Jeju Network.

## Installation

```bash
bun install -g @jejunetwork/cli
```

Or use via monorepo:

```bash
bun run jeju [command]
```

## Commands

### Development

```bash
# Start everything (chain + apps)
jeju dev

# Start chain only
jeju dev --minimal

# Check status
jeju status

# Stop all services
jeju dev --stop
```

### Testing

```bash
# Run all tests
jeju test

# Solidity contracts only
jeju test --phase=contracts

# TypeScript only
jeju test --phase=unit

# Specific app
jeju test --app=wallet

# CI mode
jeju test --ci
```

### Accounts

```bash
# Show dev keys
jeju keys

# Show balances
jeju fund

# Fund an address
jeju fund 0x1234... -a 50

# Fund all dev accounts
jeju fund --all
```

### Key Generation

```bash
# Local ceremony
jeju keys genesis -n mainnet

# TEE ceremony (hardware enclave)
jeju keys tee -n mainnet

# Multi-TEE (max security)
jeju keys distributed -n mainnet
```

### Deployment

```bash
# Deploy to testnet
jeju deploy testnet

# Deploy to mainnet
jeju deploy mainnet

# Dry run (no transactions)
jeju deploy testnet --dry-run
```

### Token Management

```bash
# Deploy JEJU token
jeju token deploy:jeju --network testnet

# Deploy full token ecosystem
jeju token deploy:ecosystem --network testnet

# Deploy Hyperlane infrastructure
jeju token deploy:hyperlane --network testnet

# Verify deployment
jeju token verify --network testnet
```

## Quick Reference

| Command | Description |
|---------|-------------|
| `jeju dev` | Start localnet + apps |
| `jeju dev --minimal` | Localnet only |
| `jeju dev --stop` | Stop all services |
| `jeju status` | Check what's running |
| `jeju test` | Run all tests |
| `jeju test --app=X` | Test specific app |
| `jeju keys` | Show dev keys |
| `jeju fund` | Show balances |
| `jeju fund 0x...` | Fund address |
| `jeju deploy testnet` | Deploy to testnet |

## Monorepo Integration

```bash
# From monorepo root
bun run jeju:dev
bun run jeju:test
bun run jeju:deploy
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `JEJU_NETWORK` | Target network (localnet/testnet/mainnet) |
| `DEPLOYER_PRIVATE_KEY` | Deployment key |
| `ETHERSCAN_API_KEY` | For contract verification |

## Examples

### Start Development

```bash
# Start everything
jeju dev

# In another terminal, run tests
jeju test --app=gateway

# Check status
jeju status

# Stop when done
jeju dev --stop
```

### Deploy to Testnet

```bash
# Set up deployer key
export DEPLOYER_PRIVATE_KEY=0x...

# Deploy
jeju deploy testnet

# Verify
jeju token verify --network testnet
```

### Fund Test Accounts

```bash
# Fund specific address with 50 ETH
jeju fund 0x1234567890abcdef... -a 50

# Fund all dev accounts
jeju fund --all
```

## Related

- [Quick Start](/getting-started/quick-start) - Getting started guide
- [Deployment](/deployment/overview) - Full deployment documentation
- [Test Accounts](/reference/test-accounts) - Development accounts

---

<details>
<summary>📋 Copy as Context</summary>

```
@jejunetwork/cli - Development CLI

Install: bun install -g @jejunetwork/cli

Commands:
jeju dev              # Start localnet + apps
jeju dev --minimal    # Chain only
jeju dev --stop       # Stop all
jeju status           # Check running services

jeju test             # All tests
jeju test --phase=contracts  # Solidity only
jeju test --app=wallet       # Specific app

jeju keys             # Show dev keys
jeju fund             # Show balances
jeju fund 0x... -a 50 # Fund address
jeju fund --all       # Fund all dev accounts

jeju keys genesis -n mainnet  # Generate prod keys
jeju keys tee -n mainnet      # TEE ceremony

jeju deploy testnet   # Deploy to testnet
jeju deploy mainnet   # Deploy to mainnet

jeju token deploy:jeju --network testnet
jeju token verify --network testnet

Env vars:
JEJU_NETWORK=testnet
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

</details>

