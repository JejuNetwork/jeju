# Deployment Overview

Deploy contracts, apps, and infrastructure on Jeju.

## Deployment Targets

| Environment | Purpose | Chain ID |
|-------------|---------|----------|
| Localnet | Development | 1337 |
| Testnet | Staging | 420690 |
| Mainnet | Production | 420691 |

## What You Can Deploy

### Smart Contracts

Deploy Solidity contracts with Foundry:

```bash
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.jejunetwork.org \
  --broadcast --verify
```

### DApps

Deploy frontend + backend applications:

```bash
jeju deploy --network testnet
```

### Infrastructure

Deploy Kubernetes infrastructure:

```bash
bun run k8s:deploy
```

## Quick Links

| Target | Guide |
|--------|-------|
| Contracts to Localnet | [Localnet Deployment](/deployment/localnet) |
| Contracts to Testnet | [Testnet Deployment](/deployment/testnet) |
| Contracts to Mainnet | [Mainnet Deployment](/deployment/mainnet) |
| Infrastructure | [Infrastructure Deployment](/deployment/infrastructure) |
| Fork Jeju | [Superchain Deployment](/deployment/superchain) |

## Prerequisites

### For Contracts

```bash
# Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Verify
forge --version
```

### For Infrastructure

```bash
# Docker
docker --version

# Kubernetes CLI
kubectl version

# Helm
helm version

# Terraform (for cloud)
terraform --version
```

## Contract Deployment

### Localnet

```bash
# Start localnet
bun run dev

# Deploy
cd packages/contracts
forge script script/DeployLocalnet.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```

### Testnet

```bash
# Set deployer key
export PRIVATE_KEY=0x...

# Deploy with verification
forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jejunetwork.org \
  --broadcast --verify
```

### Mainnet

```bash
# Requires Safe multi-sig
bun run scripts/deploy-jeju-token.ts --network mainnet --safe 0x...
```

## App Deployment

### Using CLI

```bash
# Deploy to testnet
jeju deploy my-app --network testnet

# Deploy to mainnet
jeju deploy my-app --network mainnet
```

### Using jeju-manifest.json

```json
{
  "name": "my-app",
  "type": "dapp",
  "commands": {
    "dev": "bun run dev",
    "build": "bun run build"
  },
  "ports": {
    "main": 3000
  }
}
```

## Infrastructure Deployment

### Local (Kurtosis)

```bash
bun run localnet:start
```

### Docker Compose

```bash
docker compose up -d
```

### Kubernetes

```bash
# Using Helmfile
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet sync
```

### Cloud (Terraform)

```bash
cd packages/deployment/terraform/environments/aws-testnet
terraform init
terraform plan
terraform apply
```

## Verification

### Verify Contracts

```bash
forge verify-contract $CONTRACT_ADDRESS \
  --chain-id 420690 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  ContractName
```

### Verify Deployment

```bash
jeju token verify --network testnet
```

## Deployment Scripts

| Script | Description |
|--------|-------------|
| `bun run deploy:testnet` | Full testnet deployment |
| `bun run deploy:mainnet` | Full mainnet deployment |
| `bun run k8s:deploy` | Deploy to Kubernetes |
| `bun run infra:apply` | Apply Terraform |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Deployer private key |
| `ETHERSCAN_API_KEY` | For contract verification |
| `AWS_REGION` | AWS region |
| `GCP_PROJECT` | GCP project ID |

## Related

- [Contract Deployment](/deployment/contracts) - Contract deployment details
- [Localnet](/deployment/localnet) - Local development
- [Testnet](/deployment/testnet) - Staging deployment
- [Mainnet](/deployment/mainnet) - Production deployment
- [Infrastructure](/deployment/infrastructure) - K8s and Terraform

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Deployment

Environments:
- Localnet: Chain ID 1337, development
- Testnet: Chain ID 420690, staging
- Mainnet: Chain ID 420691, production

Contract Deployment:
# Localnet
forge script script/DeployLocalnet.s.sol --rpc-url http://127.0.0.1:9545 --broadcast

# Testnet
PRIVATE_KEY=0x... forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jejunetwork.org --broadcast --verify

# Mainnet (with Safe)
bun run scripts/deploy-jeju-token.ts --network mainnet --safe 0x...

App Deployment:
jeju deploy my-app --network testnet

Infrastructure:
bun run localnet:start          # Kurtosis
docker compose up -d            # Docker
helmfile -e testnet sync        # Kubernetes
terraform apply                 # Cloud

Prerequisites: Foundry, Docker, Kubernetes, Helm, Terraform

Verification:
forge verify-contract $ADDRESS --chain-id 420690 ContractName
jeju token verify --network testnet
```

</details>
