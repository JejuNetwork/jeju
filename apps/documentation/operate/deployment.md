# Deployment

Deploy Jeju infrastructure and applications.

## Environments

| Environment | Use Case | Time to Deploy |
|-------------|----------|----------------|
| [Localnet](#localnet) | Development | 5 minutes |
| [Testnet](#testnet) | Staging | 2-4 hours |
| [Mainnet](#mainnet) | Production | 1-2 days |

## Localnet

Full local environment for development.

### Start

```bash
git clone https://github.com/elizaos/jeju && cd jeju
bun install
bun run dev
```

### What Runs

| Service | Port | Auto-start |
|---------|------|------------|
| L2 RPC | 9545 | ✅ |
| L1 RPC | 8545 | ✅ |
| Gateway | 4001 | ✅ |
| Bazaar | 4006 | ✅ |
| Indexer | 4350 | ❌ |

### Commands

```bash
bun run dev              # Start all
bun run dev --minimal    # Chain only
bun run localnet:stop    # Stop
bun run localnet:reset   # Fresh start
```

## Testnet

Deploy to Jeju testnet for staging.

### Prerequisites

```bash
brew install terraform kubectl helm helmfile awscli
aws configure
```

### One Command

```bash
bun run deploy:testnet
```

This runs:
1. Terraform (infrastructure)
2. Helm (Kubernetes services)
3. Foundry (contracts)
4. Verification

### Step by Step

```bash
# 1. Infrastructure
cd packages/deployment/terraform
terraform plan -var-file=testnet.tfvars
terraform apply -var-file=testnet.tfvars

# 2. Kubernetes
cd ../kubernetes/helmfile
helmfile -e testnet sync

# 3. Contracts
cd ../../../contracts
forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast --verify
```

### Required Secrets

Create `.env.testnet`:

```bash
JEJU_NETWORK=testnet
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

## Mainnet

Production deployment with safety checks.

### Pre-Deployment Checklist

- [ ] Smart contract audit completed
- [ ] Bug bounty program live
- [ ] Multi-sig wallets configured
- [ ] Testnet stable 4+ weeks
- [ ] Load testing completed
- [ ] On-call team assigned

### Deploy

```bash
bun run deploy:mainnet
```

This includes:
- Confirmation prompts
- Multi-sig transaction creation
- Staged rollout
- Automatic rollback on failure

### Required Secrets

Use AWS Secrets Manager with HSM for production keys.

## App Deployment

### Build All Apps

```bash
bun run build
```

### Deploy Specific App

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet -l app=gateway sync
```

### App-Specific Notes

| App | Special Requirements |
|-----|---------------------|
| Gateway | WalletConnect project ID |
| Bazaar | Alchemy API key (optional) |
| Compute | Ollama sidecar for inference |
| Storage | IPFS node, Arweave key |
| Indexer | PostgreSQL database |
| Crucible | AI API keys |

## Contract Deployment

### Deploy All

```bash
cd packages/contracts
PRIVATE_KEY=$KEY forge script script/Deploy.s.sol \
  --rpc-url $RPC --broadcast --verify
```

### Deploy Specific System

```bash
# OIF contracts
forge script script/DeployOIF.s.sol --rpc-url $RPC --broadcast

# Paymasters
forge script script/DeployMultiTokenSystem.s.sol --rpc-url $RPC --broadcast

# Identity
forge script script/DeployIdentityRegistry.s.sol --rpc-url $RPC --broadcast
```

### Update Config

After deploying, update addresses:

```bash
vim packages/config/contracts.json
cd packages/config && bun run build
git commit -am "chore: update contract addresses"
```

## Infrastructure

### Terraform Resources

| Resource | Testnet | Mainnet |
|----------|---------|---------|
| EKS Nodes | 7 | 15 |
| RDS | db.t3.medium | db.r6g.large |
| ElastiCache | cache.t3.micro | cache.r6g.large |

### Kubernetes Services

```bash
# Preview changes
helmfile -e testnet diff

# Apply
helmfile -e testnet sync

# Rollback
helmfile -e testnet rollback
```

## Monitoring

### Setup Prometheus

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring -f helm/monitoring/values.yaml
```

### Key Dashboards

- Block production rate
- Transaction throughput
- RPC latency
- L1 data costs

### Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| Blocks stopped | 0 in 5min | Page on-call |
| High latency | p99 > 500ms | Warning |
| L1 submission failed | 2 failures | Page on-call |
| Low sequencer balance | < 1 ETH | Refill |

## Rollback

### Kubernetes

```bash
helm rollback -n jeju-mainnet $RELEASE
```

### Contracts

Upgradeable contracts can rollback via proxy:

```bash
bun run scripts/deploy/prepare-rollback.ts \
  --contract IdentityRegistry --to-version 1.0.0
```

## Secrets Management

### Localnet

Use `.env.local` (gitignored).

### Testnet/Mainnet

Use AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name jeju/testnet/deployer \
  --secret-string '{"privateKey":"0x..."}'
```

### Kubernetes Integration

Use External Secrets Operator:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: deployer-key
spec:
  secretStoreRef:
    name: aws-secrets
    kind: ClusterSecretStore
  target:
    name: deployer-key
  data:
    - secretKey: privateKey
      remoteRef:
        key: jeju/testnet/deployer
        property: privateKey
```

## Troubleshooting

**Pod not starting:**
```bash
kubectl describe pod $POD -n jeju
kubectl logs $POD -n jeju --previous
```

**RPC not responding:**
```bash
kubectl get pods -n jeju
kubectl logs deployment/op-reth -n jeju
```

**Contract verification failed:**
```bash
forge verify-contract $ADDRESS src/Contract.sol:Contract \
  --chain-id $CHAIN_ID --etherscan-api-key $KEY
```

