# Deployment Scripts

Infrastructure deployment scripts for Jeju Network.

**⚠️ Most scripts have been integrated into CLI commands. Use `jeju <command>` instead.**

## Scripts Status

### ✅ Integrated into CLI (Use CLI Instead)

| Script | CLI Command | Notes |
|--------|-------------|-------|
| `localnet-start.ts` | `jeju dev --minimal` | Localnet management integrated into CLI |
| `localnet-stop.ts` | `jeju dev --stop` | Localnet management integrated into CLI |
| `localnet-reset.ts` | `jeju dev --stop && jeju dev --minimal` | Use CLI commands |
| `build-images.ts` | `jeju build images` | Docker image builds |
| `build-covenantsql.ts` | `jeju build covenantsql` | CovenantSQL multi-arch builds |
| `terraform.ts` | `jeju infra terraform <command>` | Terraform operations |
| `helmfile.ts` | `jeju infra helmfile <command>` | Kubernetes deployments |
| `deploy-full.ts` | `jeju infra deploy-full` | Full deployment pipeline |
| `validate.ts` | `jeju infra validate` | Configuration validation |
| `l2-genesis.ts` | `jeju infra genesis` | L2 genesis generation |
| `deploy-messaging-contracts.ts` | `jeju deploy messaging` | Messaging contracts |

### 📦 Keep in Deployment Package

These scripts remain in the deployment package because they:
- Are infrastructure-specific utilities
- May be called directly by CI/CD pipelines
- Have detailed error handling and installation logic
- Are referenced by other deployment scripts

**Scripts to Keep:**
- `localnet-start.ts` - Detailed Kurtosis setup (CLI uses simplified version)
- `localnet-stop.ts` - Direct Kurtosis control
- `localnet-reset.ts` - Convenience wrapper
- `build-images.ts` - Docker build logic (CLI wrapper calls this)
- `build-covenantsql.ts` - Multi-arch build logic (CLI wrapper calls this)
- `terraform.ts` - Terraform wrapper (CLI wrapper calls this)
- `helmfile.ts` - Helmfile wrapper (CLI wrapper calls this)
- `deploy-full.ts` - Full pipeline orchestration (CLI wrapper calls this)
- `validate.ts` - Validation logic (CLI wrapper calls this)
- `l2-genesis.ts` - Genesis generation (CLI wrapper calls this)
- `deploy-messaging-contracts.ts` - Contract deployment (CLI wrapper calls this)

## Usage

### Via CLI (Recommended)

```bash
# Infrastructure
jeju infra validate                    # Validate configurations
jeju infra terraform plan --network testnet
jeju infra terraform apply --network testnet
jeju infra helmfile sync --network testnet
jeju infra deploy-full --network testnet
jeju infra genesis --network testnet

# Builds
jeju build images --network testnet
jeju build images --push --network testnet
jeju build covenantsql --network testnet --push

# Deployment
jeju deploy messaging --network testnet
jeju deploy messaging --network testnet --verify

# Localnet (integrated into dev command)
jeju dev --minimal  # Start localnet
jeju dev --stop     # Stop localnet
```

### Direct Script Usage (For CI/CD or Advanced Use)

```bash
# These can still be run directly if needed
cd packages/deployment
bun run scripts/localnet-start.ts
bun run scripts/build-images.ts --push
bun run scripts/terraform.ts plan
bun run scripts/deploy-full.ts
```

## Script Details

### `localnet-start.ts`
- Starts localnet using Kurtosis
- Installs Kurtosis if missing
- Sets up port forwarding
- **Note:** CLI `jeju dev` uses a simplified version integrated into the dev command

### `localnet-stop.ts`
- Stops Kurtosis enclave
- **Note:** CLI `jeju dev --stop` provides the same functionality

### `localnet-reset.ts`
- Stops and restarts localnet
- Convenience wrapper

### `build-images.ts`
- Builds Docker images for all apps
- Supports pushing to ECR
- **CLI:** `jeju build images`

### `build-covenantsql.ts`
- Builds multi-arch CovenantSQL image
- Supports ARM64 and x86_64
- **CLI:** `jeju build covenantsql`

### `terraform.ts`
- Terraform wrapper for infrastructure
- Commands: init, plan, apply, destroy, output
- **CLI:** `jeju infra terraform <command>`

### `helmfile.ts`
- Helmfile wrapper for Kubernetes
- Commands: diff, sync, apply, destroy, status, list
- **CLI:** `jeju infra helmfile <command>`

### `deploy-full.ts`
- Full deployment pipeline:
  1. Validate configurations
  2. Deploy infrastructure (Terraform)
  3. Build and push Docker images
  4. Deploy to Kubernetes (Helmfile)
  5. Verify deployment
- **CLI:** `jeju infra deploy-full`

### `validate.ts`
- Validates Terraform, Helm, and Kurtosis configurations
- **CLI:** `jeju infra validate`

### `l2-genesis.ts`
- Generates L2 genesis files using op-node
- Requires L1 contracts deployed
- **CLI:** `jeju infra genesis`

### `deploy-messaging-contracts.ts`
- Deploys KeyRegistry and MessageNodeRegistry contracts
- Supports verification on explorer
- **CLI:** `jeju deploy messaging`

## Migration Notes

- **Localnet scripts:** CLI `jeju dev` integrates localnet management, but the detailed scripts remain for direct use
- **Build scripts:** CLI provides wrappers, but scripts contain the actual build logic
- **Infrastructure scripts:** CLI provides unified interface, but scripts remain for CI/CD use
- **All scripts:** Can be called directly or via CLI - CLI is preferred for interactive use

## Package.json Scripts

The `packages/deployment/package.json` contains convenience scripts that can be used directly:

```bash
cd packages/deployment
bun run localnet:start
bun run images:build
bun run infra:plan
bun run k8s:deploy
```

These are kept for backwards compatibility and CI/CD use, but CLI commands are preferred for interactive use.

