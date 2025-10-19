# Local Development

Complete guide to developing on Jeju locally.

## Quick Start

```bash
# One command starts everything (localnet, indexer, services)
bun run dev

# Or start minimal environment (just localnet)
bun run dev -- --minimal

# Everything is automatically managed - press Ctrl+C to stop all services
```

**What `bun run dev` starts:**
- ✅ Kurtosis Localnet (L1 + L2)
- ✅ Subsquid Indexer + GraphQL
- ✅ Node Explorer (UI + API)
- ✅ Documentation site
- ✅ All services with automatic lifecycle management

## Development Environment

### Localnet (Kurtosis)

The localnet provides a complete L1 + L2 blockchain environment:

- **L1**: Geth in dev mode (settlement layer)
- **L2**: op-geth in dev mode (Jeju execution layer)
- **Block time**: 2 seconds
- **Pre-funded accounts**: 10 Foundry accounts with 10,000 ETH each

### Pre-funded Test Accounts

```javascript
// Account 0 (default deployer)
const account0 = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
}

// Account 1
const account1 = {
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
}
```

## Development Workflow

### 1. Contract Development

```bash
# Watch mode for contract tests
cd contracts
forge test --watch

# Build contracts
forge build

# Deploy to localnet
forge script script/Deploy.s.sol --broadcast --rpc-url http://localhost:9545
```

### 2. Frontend Development

```typescript
import { ethers } from 'ethers';

// Connect to localnet
const provider = new ethers.JsonRpcProvider('http://localhost:9545');

// Use test account
const wallet = new ethers.Wallet(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  provider
);

// Deploy your contracts and interact
```

### 3. Testing Your Changes

```bash
# Run all tests (automatically manages localnet lifecycle)
bun run test

# Or run specific contract tests
cd contracts && forge test

# Dev environment already has indexer running
# Access GraphQL at http://localhost:4350/graphql
```

## Hot Reload Development

### Smart Contracts

```bash
# Terminal 1: Full dev environment (runs everything)
bun run dev

# Terminal 2: Watch tests
cd contracts
forge test --watch --match-contract YourContract
```

### Scripts

```bash
# Watch mode for TypeScript
bun test --watch tests/integration/
```

## Debugging

### Contract Debugging

```bash
# Trace a transaction
forge test --match-test testYourFunction -vvvv

# Debug interactively
forge test --debug testYourFunction

# Get gas report
forge test --gas-report
```

### RPC Debugging

```bash
# Check RPC
curl -X POST http://localhost:9545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Check logs
kurtosis service logs jeju-localnet op-geth
```

## Common Tasks

### Deploy All Contracts

```bash
cd contracts
forge script script/DeployLiquiditySystem.s.sol --broadcast --rpc-url http://localhost:9545
```

### Reset Localnet

```bash
# Stop dev environment (Ctrl+C) then:
bun run scripts/localnet/reset.ts

# Or directly with Kurtosis:
kurtosis enclave rm -f jeju-localnet
```

### Check Indexer

```bash
cd apps/indexer
npm run dev

# In another terminal
curl http://localhost:4350/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ blocks(limit: 1) { number } }"}'
```

## Resources

- [Quick Start Guide](./quick-start)
- [Deploy Contracts](./deploy-contracts)
- [Getting Started](/getting-started/quick-start)
- [Network Information](/network/testnet)

