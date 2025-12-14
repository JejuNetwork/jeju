# Environment Variables

> **TL;DR:** Set `JEJU_NETWORK=testnet|mainnet|localnet`. Secrets: `DEPLOYER_PRIVATE_KEY`, `ETHERSCAN_API_KEY`, `WALLETCONNECT_PROJECT_ID`. Config auto-loads from `packages/config/`.

## Network Selection

```bash
JEJU_NETWORK=testnet         # Primary selector: localnet|testnet|mainnet
NEXT_PUBLIC_NETWORK=testnet  # Next.js apps
VITE_NETWORK=testnet         # Vite apps
```

## Required Secrets

```bash
# Deployment (never commit these)
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...

# Frontend
WALLETCONNECT_PROJECT_ID=...

# AI features
OPENAI_API_KEY=...
```

## RPC URLs

```bash
JEJU_RPC_URL=https://rpc.jeju.network          # Override config
L1_RPC_URL=https://eth.llamarpc.com
L2_RPC_URL=https://rpc.jeju.network
VITE_RPC_URL=https://rpc.jeju.network          # Frontend (Vite)
NEXT_PUBLIC_RPC_URL=https://rpc.jeju.network   # Frontend (Next.js)
```

## Service URLs

```bash
INDEXER_GRAPHQL_URL=https://indexer.jeju.network/graphql
GATEWAY_API_URL=https://gateway.jeju.network
GATEWAY_A2A_URL=https://gateway.jeju.network/a2a
STORAGE_API_URL=https://storage.jeju.network
COMPUTE_MARKETPLACE_URL=https://compute.jeju.network
OIF_AGGREGATOR_URL=https://oif.jeju.network
```

## Contract Address Overrides

Pattern: `{CATEGORY}_{CONTRACT}`

```bash
OIF_SOLVER_REGISTRY=0x...
OIF_INPUT_SETTLER=0x...
EIL_L1_STAKE_MANAGER=0x...
REGISTRY_IDENTITY=0x...
TOKENS_JEJU=0x...
PAYMASTER_MULTI_TOKEN=0x...
```

## Port Overrides

```bash
GATEWAY_PORT=4001
BAZAAR_PORT=4006
COMPUTE_PORT=4007
STORAGE_PORT=4010
INDEXER_GRAPHQL_PORT=4350
L2_RPC_PORT=9545
```

## App-Specific

### Compute Node
```bash
PRIVATE_KEY=0x...
COMPUTE_PORT=4007
SSH_PORT=2222
DOCKER_ENABLED=true
MAX_RENTALS=10
MODEL_BACKEND=ollama
MODEL_NAME=llama2
OLLAMA_HOST=http://localhost:11434
```

### Storage Node
```bash
PRIVATE_KEY=0x...
STORAGE_PORT=4010
IPFS_REPO_PATH=/data/ipfs
IPFS_NODE_URL=http://localhost:5001
ARWEAVE_ENABLED=false
ARWEAVE_KEY_FILE=./arweave-keyfile.json
```

### Indexer
```bash
DB_HOST=localhost
DB_PORT=23798
DB_NAME=indexer
DB_USER=postgres
DB_PASS=postgres
RPC_URL=http://127.0.0.1:9545
WS_RPC_URL=ws://127.0.0.1:9546
```

### Crucible
```bash
PRIVATE_KEY=0x...
RPC_URL=http://127.0.0.1:9545
AGENT_VAULT_ADDRESS=0x...
ROOM_REGISTRY_ADDRESS=0x...
TRIGGER_REGISTRY_ADDRESS=0x...
STORAGE_API_URL=http://127.0.0.1:4010
COMPUTE_MARKETPLACE_URL=http://127.0.0.1:4007
```

### Facilitator (x402)
```bash
FACILITATOR_PORT=3402
FACILITATOR_PRIVATE_KEY=0x...
PROTOCOL_FEE_BPS=50    # 0.5%
MAX_PAYMENT_AGE=300    # 5 minutes
```

## Frontend Templates

### Vite (.env)
```bash
VITE_NETWORK=mainnet
VITE_RPC_URL=https://rpc.jeju.network
VITE_CHAIN_ID=420691
VITE_WALLETCONNECT_PROJECT_ID=...
VITE_INDEXER_URL=https://indexer.jeju.network/graphql
```

### Next.js (.env.local)
```bash
NEXT_PUBLIC_NETWORK=mainnet
NEXT_PUBLIC_RPC_URL=https://rpc.jeju.network
NEXT_PUBLIC_CHAIN_ID=420691
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
NEXT_PUBLIC_INDEXER_URL=https://indexer.jeju.network/graphql
```

## File Templates

### .env.local (Development)
```bash
JEJU_NETWORK=localnet
```

### .env.testnet
```bash
JEJU_NETWORK=testnet
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

### .env.mainnet
```bash
JEJU_NETWORK=mainnet
DEPLOYER_PRIVATE_KEY=0x...  # Use HSM in production
ETHERSCAN_API_KEY=...
```

## Resolution Order

1. Shell environment
2. `.env.{network}` file
3. `.env.local` file
4. Config file defaults (`packages/config/`)

## TypeScript Access

```typescript
// Environment variables
const network = process.env.JEJU_NETWORK ?? 'localnet';
const rpc = process.env.JEJU_RPC_URL;

// Config-based (recommended)
import { getConfig, getContract } from '@jejunetwork/config';

const config = getConfig(); // Uses JEJU_NETWORK
console.log(config.rpcUrl);
console.log(config.chainId);

const identity = getContract('registry', 'identity');
```
