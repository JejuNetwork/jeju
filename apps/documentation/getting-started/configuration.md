# Configuration

Jeju uses config-first architecture. Public values live in JSON config files. Environment variables only provide secrets or overrides.

## Config Files

All configuration lives in `packages/config/`. The `chain/localnet.json`, `chain/testnet.json`, and `chain/mainnet.json` files contain network settings. The `contracts.json` file holds all contract addresses by network. The `services.json` file stores API URLs by network. The `tokens.json` file contains token metadata. The `ports.ts` file defines local port allocations.

## Using Config in Code

```typescript
import { 
  getConfig, 
  getContract, 
  getServiceUrl, 
  getConstant 
} from '@jejunetwork/config';

// Full config for current network
const config = getConfig();
console.log(config.chainId);  // 1337, 420690, or 420691
console.log(config.rpcUrl);   // Network-specific RPC

// Get contract address
const registry = getContract('registry', 'identity');

// Get service URL
const indexer = getServiceUrl('indexer', 'graphql');

// Get constants (same across networks)
const entryPoint = getConstant('entryPoint');
```

## Environment Variables

### Network Selection

```bash
JEJU_NETWORK=testnet         # Select network
NEXT_PUBLIC_NETWORK=testnet  # Frontend (Next.js)
VITE_NETWORK=testnet         # Frontend (Vite)
```

### Secrets (Required for Deployment)

```bash
DEPLOYER_PRIVATE_KEY=0x...   # Deployer wallet (never commit)
ETHERSCAN_API_KEY=...        # Contract verification
WALLETCONNECT_PROJECT_ID=... # Wallet connections
OPENAI_API_KEY=...           # AI features
```

### URL Overrides

Override any config value via environment:

```bash
JEJU_RPC_URL=https://custom-rpc.example.com
OIF_SOLVER_REGISTRY=0x...
GATEWAY_API_URL=https://custom-gateway.example.com
INDEXER_GRAPHQL_URL=https://custom-indexer.example.com
```

### Port Overrides

```bash
GATEWAY_PORT=5001
BAZAAR_PORT=5006
INDEXER_GRAPHQL_PORT=5350
L2_RPC_PORT=8545
```

## Environment Files

Create network-specific env files:

```bash
cp env.example .env.local      # Localnet secrets
cp env.testnet .env.testnet    # Testnet secrets
cp env.mainnet .env.mainnet    # Mainnet secrets
```

Example `.env.testnet`:

```bash
JEJU_NETWORK=testnet
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

## Frontend Configuration

Frontend apps use `VITE_` or `NEXT_PUBLIC_` prefixes:

```bash
# Vite apps (Gateway)
VITE_RPC_URL=https://rpc.jeju.network
VITE_CHAIN_ID=420691
VITE_WALLETCONNECT_PROJECT_ID=...

# Next.js apps (Bazaar)
NEXT_PUBLIC_RPC_URL=https://rpc.jeju.network
NEXT_PUBLIC_CHAIN_ID=420691
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
```

## Contract Addresses

Contract addresses are stored in `packages/config/contracts.json` organized by network, then category, then contract name. Access them in code:

```typescript
import { getContract } from '@jejunetwork/config';

const solver = getContract('oif', 'solverRegistry');
```

## Service URLs

Service URLs are stored in `packages/config/services.json` organized by network, then service category, then endpoint type. The config package handles network-specific URL resolution automatically.

## Updating Config After Deployment

When deploying contracts, update the config files, then commit the changes to share with the team:

```bash
vim packages/config/contracts.json  # Add new addresses
vim packages/config/services.json   # Update URLs
```
