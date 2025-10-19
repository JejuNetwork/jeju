# Testnet Deployment

Deploy Jeju testnet on Base Sepolia.

## Overview

- **Settlement**: Base Sepolia (Chain ID: 84532)
- **Jeju Testnet**: Chain ID 420690
- **Time**: 2-4 hours

## Prerequisites

- AWS account
- Base Sepolia ETH
- Domain name
- See [Prerequisites](./prerequisites.md)

## Deployment Steps

### 1. Infrastructure (Terraform)

```bash
cd terraform/environments/testnet
terraform init
terraform apply
```

### 2. Deploy Contracts to Base Sepolia

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --private-key $DEPLOYER_KEY \
  --broadcast \
  --verify
```

### 3. Update Configuration

Update `config/chain/testnet.json` with deployed addresses.

### 4. Deploy Kubernetes Services

```bash
cd kubernetes/helmfile
helmfile -e testnet sync
```

### 5. Verify Deployment

```bash
# Check block production
cast block latest --rpc-url https://testnet-rpc.jeju.network

# Check settlement
cast block latest --rpc-url https://sepolia.base.org
```

## Resources

- [Deployment Overview](./overview.md)
- [Prerequisites](./prerequisites.md)
- [Monitoring](./monitoring.md)


