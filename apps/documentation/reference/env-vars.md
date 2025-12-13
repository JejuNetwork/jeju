# Environment Variables

All environment variables for Jeju configuration.

## Network Selection

`JEJU_NETWORK` controls the network and accepts localnet, testnet, or mainnet (defaults to localnet). `NEXT_PUBLIC_NETWORK` and `VITE_NETWORK` mirror this for frontend frameworks.

## Secrets (Required for Deployment)

`DEPLOYER_PRIVATE_KEY` is the contract deployer wallet. `ETHERSCAN_API_KEY` enables contract verification. `WALLETCONNECT_PROJECT_ID` powers wallet connections. `OPENAI_API_KEY` enables AI features.

## RPC URLs

`JEJU_RPC_URL`, `L1_RPC_URL`, and `L2_RPC_URL` are network-dependent. `VITE_RPC_URL` and `NEXT_PUBLIC_RPC_URL` are for frontend configuration.

## Service URLs

`INDEXER_GRAPHQL_URL` sets the GraphQL endpoint. `GATEWAY_API_URL` and `GATEWAY_A2A_URL` configure Gateway access. `STORAGE_API_URL` and `COMPUTE_MARKETPLACE_URL` set their respective APIs. `OIF_AGGREGATOR_URL` configures the intent aggregator.

## Contract Overrides

Override any contract address using the pattern `{CATEGORY}_{CONTRACT}`, for example `OIF_SOLVER_REGISTRY=0x...`.

```bash
# OIF contracts
OIF_SOLVER_REGISTRY=0x...
OIF_INPUT_SETTLER=0x...
OIF_OUTPUT_SETTLER=0x...

# EIL contracts
EIL_L1_STAKE_MANAGER=0x...
EIL_CROSS_CHAIN_PAYMASTER=0x...

# Registry
REGISTRY_IDENTITY=0x...

# Tokens
TOKENS_JEJU=0x...
TOKENS_USDC=0x...
```

## Port Overrides

`GATEWAY_PORT` defaults to 4001. `BAZAAR_PORT` defaults to 4006. `COMPUTE_PORT` defaults to 4007. `STORAGE_PORT` defaults to 4010. `INDEXER_GRAPHQL_PORT` defaults to 4350. `L2_RPC_PORT` defaults to 9545.

## Frontend (Vite)

```bash
VITE_RPC_URL=https://rpc.jeju.network
VITE_CHAIN_ID=420691
VITE_WALLETCONNECT_PROJECT_ID=...
VITE_INDEXER_URL=https://indexer.jeju.network/graphql
VITE_NETWORK=mainnet
```

## Frontend (Next.js)

```bash
NEXT_PUBLIC_RPC_URL=https://rpc.jeju.network
NEXT_PUBLIC_CHAIN_ID=420691
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
NEXT_PUBLIC_INDEXER_URL=https://indexer.jeju.network/graphql
NEXT_PUBLIC_NETWORK=mainnet
```

## Compute Node

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

## Storage Node

```bash
PRIVATE_KEY=0x...
STORAGE_PORT=4010
IPFS_REPO_PATH=/data/ipfs
IPFS_NODE_URL=http://localhost:5001
ARWEAVE_ENABLED=false
```

## Indexer

```bash
DB_HOST=localhost
DB_PORT=23798
DB_NAME=indexer
DB_USER=postgres
DB_PASS=postgres
RPC_URL=http://127.0.0.1:9545
```

## Facilitator

```bash
FACILITATOR_PORT=3402
X402_FACILITATOR_ADDRESS=0x...
FACILITATOR_PRIVATE_KEY=0x...
PROTOCOL_FEE_BPS=50
MAX_PAYMENT_AGE=300
```

## Crucible

```bash
PRIVATE_KEY=0x...
RPC_URL=http://127.0.0.1:9545
AGENT_VAULT_ADDRESS=0x...
ROOM_REGISTRY_ADDRESS=0x...
TRIGGER_REGISTRY_ADDRESS=0x...
STORAGE_API_URL=http://127.0.0.1:4010
COMPUTE_MARKETPLACE_URL=http://127.0.0.1:4007
```

## AWS (Deployment)

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## File Templates

### .env.local (Development)

```bash
# Network
JEJU_NETWORK=localnet

# Optional overrides
GATEWAY_PORT=4001
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
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

## Priority Order

Environment variables are resolved in order:

1. Shell environment
2. `.env.{network}` file
3. `.env.local` file
4. Config file defaults (`packages/config/`)

