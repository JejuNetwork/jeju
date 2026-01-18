# Environment Variables

> **TL;DR:** Set `JEJU_NETWORK=testnet|mainnet|localnet`. Everything else comes from config files. Only secrets need env vars.

## Philosophy

Jeju uses **config-first architecture**:
- Public values (RPCs, contract addresses, URLs) → JSON config files
- Secrets (private keys, API keys) → Environment variables or secret managers
- Everything is overridable via env vars if needed

## Network Selection

```bash
JEJU_NETWORK=testnet         # Primary selector: localnet|testnet|mainnet
NEXT_PUBLIC_NETWORK=testnet  # Next.js apps (auto-prefixed)
VITE_NETWORK=testnet         # Vite apps (auto-prefixed)
```

## Required Secrets

These are the only environment variables you **must** set for deployment:

```bash
# Deployment key (required for contract deployment)
DEPLOYER_PRIVATE_KEY=0x...
```

For local development, no secrets are needed - localnet uses hardcoded test keys.

## Optional API Keys

All API keys are **optional**. Features degrade gracefully when keys are missing.

```bash
# Block explorer verification
ETHERSCAN_API_KEY=...        # Ethereum contract verification
BASESCAN_API_KEY=...         # Base contract verification

# Frontend wallet connections
WALLETCONNECT_PROJECT_ID=... # WalletConnect modal

# AI features
OPENROUTER_API_KEY=...       # AI model access
OPENAI_API_KEY=...           # Direct OpenAI access
ANTHROPIC_API_KEY=...        # Direct Claude access

# Storage
PINATA_JWT=...               # IPFS pinning (falls back to local/public)

# Infrastructure (only for deployment)
AWS_ACCESS_KEY_ID=...        # AWS infrastructure
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

## Secret Management

Secrets resolve in this order:

1. **Environment variables** - For CI/CD and local dev
2. **AWS Secrets Manager** - If `AWS_REGION` + `AWS_ACCESS_KEY_ID` set
3. **GCP Secret Manager** - If `GCP_PROJECT_ID` set
4. **Local files** - `.secrets/` directory (gitignored)

```typescript
import { getSecret, requireSecret } from '@jejunetwork/config';

// Optional - returns undefined if not found
const apiKey = await getSecret('ETHERSCAN_API_KEY');

// Required - throws if not found
const deployerKey = await requireSecret('DEPLOYER_PRIVATE_KEY');
```

## Config Overrides

Override any config value via environment:

```bash
# RPC URLs
JEJU_RPC_URL=https://custom-rpc.example.com
L1_RPC_URL=https://custom-l1.example.com

# Service URLs
INDEXER_GRAPHQL_URL=https://custom-indexer.example.com
GATEWAY_API_URL=https://custom-gateway.example.com

# Contract addresses (pattern: CATEGORY_NAME)
OIF_SOLVER_REGISTRY=0x...
REGISTRY_IDENTITY=0x...
```

## Frontend Apps

Frontend apps use prefixed environment variables:

### Vite Apps (.env)
```bash
VITE_NETWORK=mainnet
VITE_RPC_URL=https://rpc.jejunetwork.org
VITE_CHAIN_ID=420691
VITE_WALLETCONNECT_PROJECT_ID=...
```

### Next.js Apps (.env.local)
```bash
NEXT_PUBLIC_NETWORK=mainnet
NEXT_PUBLIC_RPC_URL=https://rpc.jejunetwork.org
NEXT_PUBLIC_CHAIN_ID=420691
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
```

## App-Specific Variables

### Compute Node
```bash
PRIVATE_KEY=0x...            # Node operator key
COMPUTE_PORT=4007
MODEL_BACKEND=ollama         # ollama, openai, anthropic
MODEL_NAME=llama2
OLLAMA_HOST=http://localhost:11434
```

### Storage Node
```bash
PRIVATE_KEY=0x...            # Node operator key
STORAGE_PORT=4010
IPFS_REPO_PATH=/data/ipfs
ARWEAVE_ENABLED=false
```

### Indexer
```bash
DB_HOST=localhost
DB_PORT=23798
DB_NAME=indexer
DB_USER=postgres
DB_PASS=postgres
RPC_URL=http://127.0.0.1:9545
```

## Key Management CLI

Generate and manage keys using the CLI:

```bash
# Generate testnet keys
bun run scripts/keys/manager.ts generate --network testnet

# Fund from faucets and bridge to L2s
bun run scripts/keys/manager.ts fund --bridge

# Check balances across all chains
bun run scripts/keys/manager.ts balances

# Export keys for env file
bun run scripts/keys/manager.ts export --format env

# Show configuration status
bun run scripts/keys/manager.ts status
```

## Resolution Order

1. Shell environment variable
2. `.env.{network}` file (e.g., `.env.testnet`)
3. `.env.local` file
4. Config file defaults (`packages/config/`)

## TypeScript Usage

```typescript
import { 
  getConfig, 
  getContract, 
  getServiceUrl,
  getSecret,
  getApiKey 
} from '@jejunetwork/config';

// Get full config for current network
const config = getConfig();
console.log(config.chain.chainId);
console.log(config.services.rpc.l2);

// Get contract address (with env override support)
const solver = getContract('oif', 'solverRegistry');

// Get service URL
const indexer = getServiceUrl('indexer', 'graphql');

// Get optional API key
const etherscanKey = await getApiKey('etherscan');

// Get required secret
const deployerKey = await requireSecret('DEPLOYER_PRIVATE_KEY');
```

## Minimal Setup

For local development:
```bash
# Nothing required! Localnet uses test keys
bun run dev
```

For testnet deployment:
```bash
# Generate keys
bun run scripts/keys/manager.ts generate

# Fund deployer (follow faucet instructions)
bun run scripts/keys/manager.ts fund

# Deploy
JEJU_NETWORK=testnet bun run deploy
```

For mainnet:
```bash
# Use hardware wallet or HSM
JEJU_NETWORK=mainnet DEPLOYER_PRIVATE_KEY=$HSM_KEY bun run deploy
```
