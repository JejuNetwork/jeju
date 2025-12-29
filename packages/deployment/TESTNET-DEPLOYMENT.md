# Jeju Testnet + Babylon Deployment Guide

Complete guide for deploying the Jeju testnet infrastructure and Babylon.

## Overview

The deployment consists of several phases:

1. **Infrastructure** - AWS resources via Terraform (EKS, RDS, networking)
2. **L2 Chain** - OP Stack components (op-geth, op-node, op-batcher)
3. **Core Contracts** - JNS, DWS, Payments, Governance, etc.
4. **Babylon Contracts** - Treasury, DAO, Training orchestrator
5. **Apps** - All Jeju apps deployed via DWS
6. **Babylon App** - Frontend and backend deployment
7. **Verification** - End-to-end tests

## Prerequisites

### Required Tools

```bash
# Check all prerequisites
cd packages/deployment
bun run preflight:testnet
```

- **Bun** >= 1.0 - `curl -fsSL https://bun.sh/install | bash`
- **Foundry** - `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Terraform** >= 1.5 - `brew install terraform`
- **AWS CLI** - `brew install awscli`
- **kubectl** - `brew install kubectl`

### Required Credentials

```bash
# Deployer wallet (needs 1+ ETH on Jeju testnet and 0.1+ ETH on Sepolia)
export DEPLOYER_PRIVATE_KEY=0x...

# AWS (for infrastructure)
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1

# Optional
export OPENAI_API_KEY=sk-...  # For AI features
```

### Wallet Funding

Get testnet ETH:
- **Sepolia**: https://sepoliafaucet.com or https://faucet.alchemy.com/sepolia
- **Jeju Testnet**: Bridge from Sepolia via https://bridge.testnet.jejunetwork.org

## Quick Start

### Full Deployment (All Phases)

```bash
cd packages/deployment

# 1. Run preflight check
bun run preflight:testnet

# 2. Deploy everything
NETWORK=testnet DEPLOYER_PRIVATE_KEY=0x... bun run deploy:testnet-babylon

# 3. Verify deployment
bun run verify:testnet
```

### Contracts Only

```bash
# Deploy all contracts (dry run first)
DEPLOYER_PRIVATE_KEY=0x... bun run deploy:contracts-dry

# Deploy for real
DEPLOYER_PRIVATE_KEY=0x... bun run deploy:contracts

# Deploy specific phase only
DEPLOYER_PRIVATE_KEY=0x... bun run deploy:contracts --phase dws
```

### Individual Phases

```bash
# Infrastructure (Terraform)
NETWORK=testnet bun run infra:plan
NETWORK=testnet bun run infra:apply

# Kubernetes
NETWORK=testnet bun run k8s:deploy

# Apps via DWS
NETWORK=testnet bun run scripts/deploy/dws-bootstrap.ts
```

## Deployment Scripts

| Script | Description |
|--------|-------------|
| `preflight:testnet` | Validate prerequisites |
| `deploy:testnet-babylon` | Full deployment orchestrator |
| `deploy:contracts` | Deploy all contracts |
| `deploy:contracts-dry` | Preview contract deployment |
| `verify:testnet` | Verify deployed testnet |
| `update-contracts` | Update contracts.json from deployments |
| `infra:plan` | Terraform plan |
| `infra:apply` | Terraform apply |
| `k8s:deploy` | Deploy to Kubernetes |

## Contract Deployment Phases

The contract deployment runs in order:

| Phase | Contracts | Description |
|-------|-----------|-------------|
| dws | JNS, StorageManager, WorkerRegistry, CDN | Core DWS infrastructure |
| x402 | X402Facilitator | Payment protocol |
| decentralization | SequencerRegistry, Governance | Decentralization |
| commerce | AuthCaptureEscrow | E-commerce |
| chainlink | VRF, Automation | Chainlink integrations |
| training | TrainingCoordinator | AI training |
| federation | FederatedIdentity | Cross-chain identity |
| da | DataAvailability | Blob storage |
| decentralized-rpc | RPCStaking | Decentralized RPC |
| liquidity | LiquidityRouter | Liquidity infrastructure |
| dao-registry | DAOFactory | DAO creation |
| git-pkg | RepoRegistry, PackageRegistry | Git/npm hosting |
| content-registry | ContentRegistry | Content management |
| proof-of-cloud | ComputeRegistry | Compute marketplace |

## Babylon Contracts

Babylon has its own contracts:

| Contract | Description |
|----------|-------------|
| BabylonTreasury | Agent vault and treasury |
| BabylonDAO | Governance |
| TrainingOrchestrator | AI training coordination |
| PredictionMarketFacet | Game mechanics |

Deploy Babylon:
```bash
cd vendor/babylon/packages/contracts
DEPLOYER_PRIVATE_KEY=0x... forge script script/DeployDAO.s.sol --rpc-url https://testnet-rpc.jejunetwork.org --broadcast
```

## Configuration Files

After deployment, addresses are stored in:

- `packages/config/contracts.json` - Main config
- `packages/contracts/deployments/testnet/deployment.json` - Deployment state
- `packages/deployment/.testnet-babylon-deployment-state.json` - Full state

Update config from deployments:
```bash
bun run update-contracts --file broadcast/DeployDWS.s.sol/420690/run-latest.json
```

## Verification

Run comprehensive verification:

```bash
# Standard verification
bun run verify:testnet

# Verbose output
bun run verify:testnet-verbose
```

Verification checks:
- Chain health (L1 and L2)
- Service endpoints
- Contract deployment
- Functional tests (RPC, gas, transactions)
- Babylon API and contracts

## Testnet Endpoints

| Service | URL |
|---------|-----|
| RPC | https://testnet-rpc.jejunetwork.org |
| WebSocket | wss://testnet-ws.jejunetwork.org |
| Explorer | https://explorer.testnet.jejunetwork.org |
| Gateway | https://gateway.testnet.jejunetwork.org |
| API | https://api.testnet.jejunetwork.org |
| DWS | https://dws.testnet.jejunetwork.org |
| Bazaar | https://bazaar.testnet.jejunetwork.org |
| Babylon | https://babylon.testnet.jejunetwork.org |

## Troubleshooting

### RPC Not Responding

If testnet RPC is down:
1. Check infrastructure: `kubectl get pods -n op-stack`
2. Check L1 connectivity to Sepolia
3. Review op-node logs: `kubectl logs -n op-stack op-node-xxx`

### Contract Deployment Fails

1. Check balance: Need 1+ ETH on testnet
2. Check gas: `forge script ... --legacy` for non-EIP1559
3. Verify RPC: `curl -X POST https://testnet-rpc.jejunetwork.org -d '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}'`

### Missing Dependencies

If forge complains about missing deps:
```bash
cd packages/contracts
forge install
forge build
```

### Terraform State Issues

```bash
cd packages/deployment/terraform/environments/testnet
terraform init -upgrade
terraform refresh
```

## Cost Management

### Testnet Token Management

1. **Faucet limits**: Most faucets limit to 0.5 ETH/day
2. **Bridge costs**: ~0.01 ETH to bridge Sepolia -> Jeju
3. **Deployment costs**: Full contract deployment uses ~2-5 ETH

### AWS Costs (Estimate)

| Resource | Monthly Cost |
|----------|--------------|
| EKS Cluster | ~$75 |
| RDS | ~$25 |
| ALB | ~$20 |
| NAT Gateway | ~$35 |
| Total | ~$155/month |

## Monitoring

After deployment:

1. **Grafana**: https://grafana.testnet.jejunetwork.org
2. **Logs**: `kubectl logs -n jeju-system -l app=<service>`
3. **Metrics**: Prometheus at https://prometheus.testnet.jejunetwork.org

## Next Steps

After successful testnet deployment:

1. Run E2E tests against testnet
2. Test all user flows manually
3. Load test with synthetic traffic
4. Monitor for 48-72 hours
5. Document any issues
6. Plan mainnet deployment
