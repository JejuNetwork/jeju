# Testnet Deployment

Deploy to Jeju testnet for public testing and staging.

## Prerequisites

### Tools

```bash
# Required
brew install terraform
brew install kubectl
brew install helm
brew install helmfile
brew install awscli

# Configure AWS
aws configure
```

### Secrets

Create `.env.testnet`:

```bash
JEJU_NETWORK=testnet
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
AWS_REGION=us-east-1
```

### Funding

Get testnet ETH:
1. Get Sepolia ETH from [sepoliafaucet.com](https://sepoliafaucet.com)
2. Bridge to Jeju testnet or use deployer faucet

```bash
# Check deployer balance
bun run scripts/check-deployer-balance.ts --network testnet

# Fund deployer (if you have a faucet key)
bun run scripts/fund-testnet-deployer.ts
```

## Full Deployment

### One Command

```bash
bun run deploy:testnet
```

This runs:
1. Infrastructure (Terraform)
2. Kubernetes services (Helm)
3. Contract deployment (Foundry)
4. Verification

### Step by Step

```bash
# 1. Infrastructure
cd packages/deployment
NETWORK=testnet bun run infra:apply

# 2. Kubernetes
NETWORK=testnet bun run k8s:deploy

# 3. Contracts
cd packages/contracts
forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast \
  --verify

# 4. Verify deployment
bun run scripts/check-testnet-deployment.ts
```

## Infrastructure

### Terraform

Deploys AWS resources:

```bash
cd packages/deployment/terraform

# Preview changes
terraform plan -var-file=testnet.tfvars

# Apply
terraform apply -var-file=testnet.tfvars
```

Resources created:
- VPC with public/private subnets
- EKS cluster (7 nodes)
- RDS PostgreSQL (indexer)
- Load balancers
- Security groups

### Kubernetes

Deploy services:

```bash
cd packages/deployment/kubernetes/helmfile

# Preview
helmfile -e testnet diff

# Deploy
helmfile -e testnet sync
```

Services deployed:
- op-node, op-reth (L2 chain)
- op-batcher, op-proposer
- indexer, api-server
- monitoring (Prometheus, Grafana)

## Contract Deployment

### Deploy All Contracts

```bash
cd packages/contracts

# Deploy core contracts
PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast \
  --verify
```

### Deploy Specific Systems

```bash
# OIF only
forge script script/DeployOIF.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast --verify

# EIL (L1 contracts on Sepolia)
forge script script/DeployEIL.s.sol:DeployL1 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast --verify

# Paymaster system
forge script script/DeployMultiTokenSystem.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast --verify
```

### Update Config

After deployment, update `packages/config/contracts.json`:

```json
{
  "testnet": {
    "tokens": {
      "jeju": "0x...",
      "usdc": "0x..."
    },
    "oif": {
      "solverRegistry": "0x...",
      "inputSettler": "0x...",
      "outputSettler": "0x..."
    }
  }
}
```

## Verification

### Preflight Check

```bash
bun run scripts/preflight-testnet.ts
```

Checks:
- RPC connectivity
- Block production
- Contract deployments
- Service health

### Smoke Tests

```bash
cd packages/tests
bun run smoke:chain     # Chain functionality
bun run smoke:wallet    # Wallet transactions
```

### E2E Tests

```bash
bun run test:e2e --network testnet
```

## Monitoring

### Endpoints

Prometheus is available at https://testnet-prometheus.jeju.network for metrics collection. Grafana runs at https://testnet-grafana.jeju.network for dashboards and visualization. Alertmanager is at https://testnet-alerts.jeju.network for alert routing and management.

### Key Metrics

- Block production rate
- Transaction throughput
- RPC latency
- L1 data posting

### Alerts

Configure in `packages/deployment/kubernetes/helm/monitoring/values-testnet.yaml`:

```yaml
alertRules:
  - name: BlockProductionStopped
    condition: rate(blocks_produced[5m]) == 0
    severity: critical
```

## Troubleshooting

### RPC Not Responding

```bash
# Check pod status
kubectl get pods -n jeju-testnet

# Check logs
kubectl logs -n jeju-testnet deployment/op-reth
```

### Contracts Not Verified

```bash
# Retry verification
forge verify-contract $ADDRESS src/MyContract.sol:MyContract \
  --chain-id 420690 \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

### Indexer Behind

```bash
# Check indexer status
kubectl logs -n jeju-testnet deployment/indexer

# Force reindex
kubectl exec -n jeju-testnet deployment/indexer -- bun run reindex
```

## Rollback

### Kubernetes

```bash
# Rollback last deployment
helmfile -e testnet rollback

# Rollback specific release
helm rollback -n jeju-testnet op-reth
```

### Infrastructure

```bash
# Revert terraform
cd packages/deployment/terraform
git checkout HEAD~1 testnet.tfvars
terraform apply -var-file=testnet.tfvars
```

## Testnet Details

The testnet chain ID is 420690. RPC is available at https://testnet-rpc.jeju.network and WebSocket at wss://testnet-ws.jeju.network. The block explorer runs at https://testnet-explorer.jeju.network. The L1 network is Sepolia with chain ID 11155111.

