# Testnet

Deploy to Jeju testnet for staging.

## Network Details

| Property | Value |
|----------|-------|
| Chain ID | `420690` |
| RPC | `https://testnet-rpc.jeju.network` |
| WebSocket | `wss://testnet-ws.jeju.network` |
| Explorer | `https://testnet-explorer.jeju.network` |
| Indexer | `https://testnet-indexer.jeju.network/graphql` |
| L1 Network | Sepolia |

## Prerequisites

```bash
# Tools
brew install terraform kubectl helm helmfile awscli

# Configure AWS
aws configure

# Secrets
cp env.testnet .env.testnet
vim .env.testnet  # Add keys
```

Required secrets:
```bash
JEJU_NETWORK=testnet
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

## Get Testnet ETH

1. Get Sepolia ETH from [sepoliafaucet.com](https://sepoliafaucet.com)
2. Bridge to Jeju testnet at [testnet-gateway.jeju.network](https://testnet-gateway.jeju.network)

## Deploy

### One Command

```bash
bun run deploy:testnet
```

### Step by Step

```bash
# 1. Infrastructure
cd packages/deployment/terraform
terraform plan -var-file=testnet.tfvars
terraform apply -var-file=testnet.tfvars

# 2. Kubernetes services
cd ../kubernetes/helmfile
helmfile -e testnet sync

# 3. Contracts
cd ../../../packages/contracts
forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast --verify

# 4. Verify
bun run scripts/check-testnet-deployment.ts
```

## Deploy Contracts Only

```bash
cd packages/contracts

# All contracts
forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast --verify

# Specific system
forge script script/DeployOIF.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast --verify
```

## Update Config

After deployment:

```bash
vim packages/config/contracts.json  # Add addresses
cd packages/config && bun run build
git commit -am "chore: update testnet addresses"
```

## Monitoring

| Service | URL |
|---------|-----|
| Prometheus | `https://testnet-prometheus.jeju.network` |
| Grafana | `https://testnet-grafana.jeju.network` |

## Troubleshooting

**RPC not responding:**
```bash
kubectl get pods -n jeju-testnet
kubectl logs deployment/op-reth -n jeju-testnet
```

**Verification failed:**
```bash
forge verify-contract $ADDRESS src/Contract.sol:Contract \
  --chain-id 420690 \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

**Rollback:**
```bash
helmfile -e testnet rollback
helm rollback -n jeju-testnet $RELEASE
```

