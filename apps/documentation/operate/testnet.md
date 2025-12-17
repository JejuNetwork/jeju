# Testnet

Deploy to Jeju testnet for staging.

## Network Details

| Property | Value |
|----------|-------|
| Chain ID | `420690` |
| RPC | `https://testnet-rpc.jejunetwork.org` |
| WebSocket | `wss://testnet-ws.jejunetwork.org` |
| Explorer | `https://testnet-explorer.jejunetwork.org` |
| Indexer | `https://testnet-indexer.jejunetwork.org/graphql` |
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
2. Bridge to Jeju testnet at [testnet-gateway.jejunetwork.org](https://testnet-gateway.jejunetwork.org)

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
  --rpc-url https://testnet-rpc.jejunetwork.org \
  --broadcast --verify

# 4. Verify
jeju deploy check testnet
```

## Deploy Contracts Only

```bash
cd packages/contracts

# All contracts
forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jejunetwork.org \
  --broadcast --verify

# Specific system
forge script script/DeployOIF.s.sol \
  --rpc-url https://testnet-rpc.jejunetwork.org \
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
| Prometheus | `https://testnet-prometheus.jejunetwork.org` |
| Grafana | `https://testnet-grafana.jejunetwork.org` |

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


