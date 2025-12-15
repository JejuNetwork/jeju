# @jejunetwork/deployment

Infrastructure deployment for Jeju Network - supporting local development, AWS, GCP, and on-premise Kubernetes.

## Deployment Options

| Environment | Platform | Method | Status |
|-------------|----------|--------|--------|
| **Local Dev** | Docker | Kurtosis | ✅ Ready |
| **Local Dev** | Docker | docker-compose | ✅ Ready |
| **Cloud** | AWS | Terraform + EKS | ✅ Ready |
| **Cloud** | GCP | Terraform + GKE | ✅ Ready |
| **On-Prem** | Kubernetes | Helm Charts | ✅ Ready |

## Structure

```
packages/deployment/
├── docker/              # Docker images
│   ├── covenantsql/    # CovenantSQL multi-arch image
│   └── ipfs/           # IPFS node configuration
├── kubernetes/          # Kubernetes deployment
│   ├── helm/           # Helm charts for each service
│   └── helmfile/       # Environment-specific values
├── terraform/           # Infrastructure as Code
│   ├── modules/        # Reusable modules (AWS + GCP)
│   └── environments/   # Per-environment configs
├── kurtosis/           # Local development
│   └── main.star       # Kurtosis package
├── chainspecs/         # Chain specifications
├── monitoring/         # Prometheus/Grafana configs
└── scripts/            # Automation scripts
```

## Quick Start

### 1. Local Development (Kurtosis)

The fastest way to get a full Jeju stack running locally:

```bash
# Install dependencies (auto-installs Kurtosis if needed)
bun run localnet:start

# View endpoints
kurtosis enclave inspect jeju-localnet

# Stop
bun run localnet:stop

# Reset (fresh start)
bun run localnet:reset
```

**Services Started:**
- L1: Geth dev node (auto-mining)
- L2: op-geth (OP Stack)
- CQL: CovenantSQL (decentralized database)

### 2. Local Development (Docker Compose)

For more control over individual services:

```bash
# Full Stage 2 stack with multi-client diversity
docker compose up

# Decentralized messaging stack
docker compose up
```

### 3. AWS Deployment (EKS)

Full production deployment to AWS:

```bash
# Set environment
export NETWORK=testnet  # or mainnet
export AWS_REGION=us-east-1

# Validate configurations
bun run validate

# Deploy infrastructure
bun run infra:plan
bun run infra:apply

# Build and push images
bun run images:push

# Deploy to Kubernetes
bun run k8s:deploy

# Or run full pipeline
bun run deploy:testnet
```

**AWS Resources Created:**
- VPC with public/private subnets
- EKS cluster with multiple node pools
- RDS PostgreSQL (multi-AZ)
- ECR container registry
- ALB with WAF protection
- Route53 DNS + ACM certificates
- CloudFront CDN for static assets

### 4. GCP Deployment (GKE)

Full production deployment to Google Cloud:

```bash
# Set environment
export NETWORK=testnet
export GCP_PROJECT=your-project-id
export GCP_REGION=us-central1

# Initialize Terraform
cd terraform/environments/gcp-testnet
terraform init

# Deploy
terraform plan -var="project_id=$GCP_PROJECT"
terraform apply -var="project_id=$GCP_PROJECT"

# Configure kubectl
gcloud container clusters get-credentials jeju-testnet-gke \
  --region $GCP_REGION --project $GCP_PROJECT

# Deploy applications
cd ../../.. && NETWORK=testnet bun run k8s:deploy
```

**GCP Resources Created:**
- VPC with private subnets
- GKE Autopilot cluster
- Cloud SQL PostgreSQL
- Artifact Registry
- Cloud NAT for egress
- Cloud Load Balancing

### 5. On-Premise Kubernetes

Deploy to any Kubernetes cluster:

```bash
# Prerequisites
# - kubectl configured for your cluster
# - Helm 3.x installed
# - Container registry access configured

# Deploy with Helm
cd kubernetes/helm
helm install jeju-gateway gateway/ -f gateway/values.yaml
helm install jeju-bazaar bazaar/ -f bazaar/values.yaml
# ... or use helmfile

# Using Helmfile (recommended)
cd ../helmfile
helmfile -e testnet sync
```

**Requirements:**
- Kubernetes 1.28+
- Ingress controller (nginx recommended)
- cert-manager (for TLS)
- External PostgreSQL database
- S3-compatible storage (for backups)

## Scripts Reference

| Script | Description |
|--------|-------------|
| `validate` | Validate all Terraform, Helm, Kurtosis configs |
| `localnet:start` | Start local chain with Kurtosis |
| `localnet:stop` | Stop local chain |
| `localnet:reset` | Reset and restart local chain |
| `infra:plan` | Terraform plan |
| `infra:apply` | Terraform apply |
| `infra:destroy` | Terraform destroy |
| `images:build` | Build Docker images locally |
| `images:push` | Build and push to container registry |
| `images:cql` | Build multi-arch CovenantSQL image |
| `images:cql:arm` | Build ARM64-only CovenantSQL image |
| `images:cql:x86` | Build x86_64-only CovenantSQL image |
| `k8s:deploy` | Helmfile sync |
| `k8s:diff` | Helmfile diff (preview changes) |
| `k8s:destroy` | Helmfile destroy |
| `genesis:l2` | Generate L2 genesis |
| `deploy:testnet` | Full testnet deployment pipeline |
| `deploy:mainnet` | Full mainnet deployment pipeline |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NETWORK` | Target network (localnet/testnet/mainnet) | `testnet` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `GCP_PROJECT` | GCP project ID | - |
| `GCP_REGION` | GCP region | `us-central1` |
| `SKIP_TERRAFORM` | Skip infrastructure step | `false` |
| `SKIP_IMAGES` | Skip image build step | `false` |
| `SKIP_KUBERNETES` | Skip k8s deploy step | `false` |
| `BUILD_CQL_IMAGE` | Build CovenantSQL image | `false` |
| `USE_ARM64_CQL` | Use ARM64 for CovenantSQL | `false` |

## ARM64 / Graviton Support

CovenantSQL supports both ARM64 and x86_64 architectures:

```bash
# Build multi-arch image (both platforms)
bun run images:cql

# Build ARM64 only (Apple Silicon, AWS Graviton)
bun run images:cql:arm

# Build x86_64 only
bun run images:cql:x86

# Push to registry
bun run images:cql:push
```

For AWS Graviton instances, set `use_arm64_cql = true` in Terraform.

## Helm Charts

Available charts in `kubernetes/helm/`:

| Chart | Description |
|-------|-------------|
| `gateway` | API gateway and RPC proxy |
| `bazaar` | Marketplace frontend |
| `leaderboard` | Leaderboard app |
| `crucible` | Agent orchestration |
| `subsquid` | Blockchain indexer |
| `messaging` | Relay + KMS nodes |
| `op-geth` | OP Stack execution client |
| `op-node` | OP Stack consensus client |
| `op-batcher` | Transaction batcher |
| `op-proposer` | State proposer |
| `bundler` | ERC-4337 bundler |
| `ipfs` | IPFS node |

## Adding a New Service

1. **Create Helm chart:**
   ```bash
   mkdir kubernetes/helm/my-service
   # Add Chart.yaml, values.yaml, templates/
   ```

2. **Add to helmfile:**
   ```yaml
   # kubernetes/helmfile/helmfile.yaml.gotmpl
   - name: my-service
     chart: ../helm/my-service
     values:
       - ../helm/my-service/values-{{ .Environment.Name }}.yaml
   ```

3. **Add Dockerfile path:**
   ```typescript
   // scripts/build-images.ts
   const APPS = {
     'my-service': { dockerfile: 'apps/my-service/Dockerfile', context: 'apps/my-service' }
   };
   ```

4. **Add to ECR/Artifact Registry:**
   - AWS: Add to `terraform/modules/ecr/main.tf`
   - GCP: Add to `terraform/modules/gcp-artifact-registry/main.tf`

## CI/CD Integration

GitHub Actions workflows:

- `.github/workflows/deploy-testnet.yml` - Testnet deployment
- `.github/workflows/deploy-mainnet.yml` - Mainnet deployment (manual)
- `.github/workflows/localnet-test.yml` - Localnet integration tests

### Required Secrets

**AWS:**
- `AWS_ROLE_ARN_TESTNET` / `AWS_ROLE_ARN_MAINNET`
- `DEPLOYER_PRIVATE_KEY_TESTNET` / `DEPLOYER_PRIVATE_KEY_MAINNET`

**GCP:**
- `GCP_PROJECT_ID`
- `GCP_SA_KEY` (service account JSON)

**Common:**
- `ETHERSCAN_API_KEY`

## Troubleshooting

### Kurtosis won't start
```bash
# Reset Docker
docker system prune -af

# Reinstall Kurtosis
brew reinstall kurtosis-tech/tap/kurtosis
```

### Terraform state locked
```bash
# AWS
aws dynamodb delete-item --table-name jeju-terraform-locks-testnet \
  --key '{"LockID":{"S":"jeju-terraform-state-testnet/testnet/terraform.tfstate"}}'

# GCP
gcloud storage rm gs://jeju-terraform-state-testnet/terraform/state/default.tflock
```

### EKS/GKE auth issues
```bash
# AWS
aws eks update-kubeconfig --name jeju-testnet --region us-east-1

# GCP
gcloud container clusters get-credentials jeju-testnet-gke --region us-central1
```
