# Environment Variables

Configuration via environment variables.

## Network Selection

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `JEJU_NETWORK` | localnet, testnet, mainnet | localnet | Active network |
| `NEXT_PUBLIC_NETWORK` | (same) | localnet | Next.js apps |
| `VITE_NETWORK` | (same) | localnet | Vite apps |

## Required Secrets

| Variable | Description | Where Used |
|----------|-------------|------------|
| `DEPLOYER_PRIVATE_KEY` | Contract deployer wallet | Deployment scripts |
| `ETHERSCAN_API_KEY` | Contract verification | forge verify |
| `WALLETCONNECT_PROJECT_ID` | Wallet connections | Frontend apps |
| `OPENAI_API_KEY` | AI features | Compute, Crucible |

::: warning Never Commit Secrets
Add to `.gitignore`:
```
.env.local
.env.testnet
.env.mainnet
```
:::

## RPC URLs

| Variable | Default | Description |
|----------|---------|-------------|
| `JEJU_RPC_URL` | Network-dependent | Primary RPC |
| `L1_RPC_URL` | Network-dependent | L1 Ethereum RPC |
| `L2_RPC_URL` | Network-dependent | L2 Jeju RPC |
| `VITE_RPC_URL` | — | Frontend (Vite) |
| `NEXT_PUBLIC_RPC_URL` | — | Frontend (Next.js) |

## Service URLs

| Variable | Description |
|----------|-------------|
| `INDEXER_GRAPHQL_URL` | GraphQL endpoint |
| `GATEWAY_API_URL` | Gateway API |
| `GATEWAY_A2A_URL` | Gateway A2A |
| `STORAGE_API_URL` | Storage API |
| `COMPUTE_MARKETPLACE_URL` | Compute API |
| `OIF_AGGREGATOR_URL` | Intent aggregator |

## Port Overrides

| Variable | Default |
|----------|---------|
| `GATEWAY_PORT` | 4001 |
| `BAZAAR_PORT` | 4006 |
| `COMPUTE_PORT` | 4007 |
| `STORAGE_PORT` | 4010 |
| `INDEXER_GRAPHQL_PORT` | 4350 |
| `L2_RPC_PORT` | 9545 |

## Contract Overrides

Override any contract address:

```bash
# Pattern: {CATEGORY}_{CONTRACT}
OIF_SOLVER_REGISTRY=0x...
OIF_INPUT_SETTLER=0x...
EIL_L1_STAKE_MANAGER=0x...
REGISTRY_IDENTITY=0x...
TOKENS_JEJU=0x...
```

## App-Specific

### Compute Node

| Variable | Default | Description |
|----------|---------|-------------|
| `PRIVATE_KEY` | — | Operator wallet |
| `SSH_PORT` | 2222 | SSH access port |
| `DOCKER_ENABLED` | false | Enable container rentals |
| `MAX_RENTALS` | 10 | Max concurrent sessions |
| `MODEL_BACKEND` | ollama | LLM backend |
| `MODEL_NAME` | llama2 | Default model |
| `OLLAMA_HOST` | localhost:11434 | Ollama endpoint |

### Storage Node

| Variable | Default | Description |
|----------|---------|-------------|
| `PRIVATE_KEY` | — | Operator wallet |
| `IPFS_REPO_PATH` | /data/ipfs | IPFS data directory |
| `IPFS_NODE_URL` | localhost:5001 | IPFS API |
| `ARWEAVE_ENABLED` | false | Enable Arweave |

### Indexer

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 23798 | PostgreSQL port |
| `DB_NAME` | indexer | Database name |
| `DB_USER` | postgres | Database user |
| `DB_PASS` | postgres | Database password |

### Crucible

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | System wallet |
| `AGENT_VAULT_ADDRESS` | Vault contract |
| `ROOM_REGISTRY_ADDRESS` | Room registry |
| `TRIGGER_REGISTRY_ADDRESS` | Trigger registry |
| `STORAGE_API_URL` | Memory storage |
| `COMPUTE_MARKETPLACE_URL` | Inference |

### Facilitator

| Variable | Default | Description |
|----------|---------|-------------|
| `FACILITATOR_PORT` | 3402 | API port |
| `FACILITATOR_PRIVATE_KEY` | — | Settlement wallet |
| `PROTOCOL_FEE_BPS` | 50 | Fee (0.5%) |
| `MAX_PAYMENT_AGE` | 300 | Payment timeout (seconds) |

## Frontend

### Vite Apps

```bash
VITE_RPC_URL=https://rpc.jeju.network
VITE_CHAIN_ID=420691
VITE_WALLETCONNECT_PROJECT_ID=...
VITE_INDEXER_URL=https://indexer.jeju.network/graphql
```

### Next.js Apps

```bash
NEXT_PUBLIC_RPC_URL=https://rpc.jeju.network
NEXT_PUBLIC_CHAIN_ID=420691
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
NEXT_PUBLIC_INDEXER_URL=https://indexer.jeju.network/graphql
```

## AWS (Deployment)

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## Example Files

### .env.local

```bash
JEJU_NETWORK=localnet
# Add overrides as needed
```

### .env.testnet

```bash
JEJU_NETWORK=testnet
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
WALLETCONNECT_PROJECT_ID=...
```

### .env.mainnet

```bash
JEJU_NETWORK=mainnet
DEPLOYER_PRIVATE_KEY=0x...  # Use HSM in production
ETHERSCAN_API_KEY=...
WALLETCONNECT_PROJECT_ID=...
```

## Resolution Order

1. Shell environment
2. `.env.{network}` file
3. `.env.local` file
4. Config file defaults (`packages/config/`)
