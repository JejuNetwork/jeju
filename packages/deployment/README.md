# @jejunetwork/deployment

Infrastructure deployment for Jeju Network.

## Current Status (Testnet)

| Component | Status |
|-----------|--------|
| AWS Infrastructure | ✅ Deployed |
| Kubernetes Cluster | ✅ 7 nodes ready |
| L1 Contracts (Sepolia) | ❌ Not deployed |
| L2 Genesis | ❌ Not generated |
| OP Stack Services | ❌ Not running |

**Run:** `bun run scripts/check-testnet-readiness.ts` for full status.

See [TESTNET_GAPS.md](./TESTNET_GAPS.md) for deployment instructions.

## Structure

```
packages/deployment/
├── kubernetes/          # Helm charts and helmfile
│   ├── helm/           # Individual service charts
│   └── helmfile/       # Environment configurations
├── terraform/          # AWS infrastructure
│   ├── modules/        # Reusable modules
│   └── environments/   # Per-environment configs
├── kurtosis/           # Local development
│   └── main.star       # Kurtosis package
└── scripts/            # Deployment automation
```

## Quick Start

### Local Development

```bash
# Start localnet (requires Docker + Kurtosis)
bun run localnet:start

# Stop localnet
bun run localnet:stop

# Reset (stop + start fresh)
bun run localnet:reset
```

### Testnet Deployment

```bash
# Validate all configs
bun run validate

# Deploy infrastructure
NETWORK=testnet bun run infra:apply

# Build and push images
NETWORK=testnet bun run images:push

# Deploy to Kubernetes
NETWORK=testnet bun run k8s:deploy

# Or run full pipeline
bun run deploy:testnet
```

### Mainnet Deployment

```bash
# Full deployment (with safety checks)
bun run deploy:mainnet
```

## Scripts

| Script | Description |
|--------|-------------|
| `validate` | Validate terraform, helm, kurtosis configs |
| `localnet:start` | Start local chain with Kurtosis |
| `localnet:stop` | Stop local chain |
| `localnet:reset` | Reset local chain |
| `infra:plan` | Terraform plan |
| `infra:apply` | Terraform apply |
| `infra:destroy` | Terraform destroy |
| `images:build` | Build Docker images |
| `images:push` | Build and push to ECR |
| `k8s:deploy` | Helmfile sync |
| `k8s:diff` | Helmfile diff |
| `k8s:destroy` | Helmfile destroy |
| `genesis:l2` | Generate L2 genesis |
| `deploy:testnet` | Full testnet deployment |
| `deploy:mainnet` | Full mainnet deployment |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NETWORK` | Target network | `testnet` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `SKIP_TERRAFORM` | Skip infra step | `false` |
| `SKIP_IMAGES` | Skip image build | `false` |
| `SKIP_KUBERNETES` | Skip k8s deploy | `false` |
| `SKIP_VERIFY` | Skip verification | `false` |

## CI/CD Integration

The deployment package integrates with GitHub Actions workflows:

- `.github/workflows/deploy-testnet.yml` - Testnet deployment
- `.github/workflows/deploy-mainnet.yml` - Mainnet deployment (manual)
- `.github/workflows/localnet-test.yml` - Localnet tests

### Required Secrets

- `AWS_ROLE_ARN_TESTNET` / `AWS_ROLE_ARN_MAINNET`
- `DEPLOYER_PRIVATE_KEY_TESTNET` / `DEPLOYER_PRIVATE_KEY_MAINNET`
- `ETHERSCAN_API_KEY`

## Adding a New Service

1. Create Helm chart in `kubernetes/helm/<service>/`
2. Add to `kubernetes/helmfile/helmfile.yaml`
3. Add environment values in `kubernetes/helmfile/environments/`
4. Add Dockerfile path to `scripts/build-images.ts`

