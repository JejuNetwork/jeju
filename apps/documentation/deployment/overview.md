# Deployment

Deploy Jeju infrastructure and contracts across environments.

## Environments

[Localnet](/deployment/localnet) is for development and takes about 5 minutes to deploy. [Testnet](/deployment/testnet) is for staging and testing, taking 2-4 hours. [Mainnet](/deployment/mainnet) is for production and takes 1-2 days.

## What Gets Deployed

### Infrastructure

The L2 Chain runs op-reth, op-node, batcher, and proposer via Kurtosis/Kubernetes. The Database is PostgreSQL for indexer data storage. Monitoring uses Prometheus and Grafana for metrics and alerting.

### Contracts

Tokens include JejuToken, ERC20Factory, and TokenRegistry. Identity includes IdentityRegistry and BanManager. Payments include MultiTokenPaymaster and PaymasterFactory. OIF includes InputSettler, OutputSettler, and SolverRegistry. EIL includes L1StakeManager and CrossChainPaymaster. DeFi includes Uniswap V4 periphery and LiquidityVault.

### Applications

Gateway on port 4001, Bazaar on port 4006, Compute on port 4007, and Storage on port 4010 all auto-start with localnet. Indexer on port 4350 does not auto-start.

## Quick Commands

```bash
# Local development
bun run dev                    # Start everything
bun run dev -- --minimal       # Chain only
bun run localnet:reset         # Reset to fresh state

# Contract deployment
bun run scripts/deploy.ts                    # Deploy to current network
bun run scripts/deploy/testnet.ts            # Deploy to testnet
bun run scripts/deploy/mainnet.ts            # Deploy to mainnet

# Infrastructure
bun run infra:plan             # Terraform plan
bun run infra:apply            # Terraform apply
bun run k8s:deploy             # Kubernetes deploy
```

## Deployment Flow

Start with **Prerequisites** (Docker, Kurtosis, Bun). Then deploy **Infrastructure** (Terraform, Kubernetes, load balancers). Next deploy **Contracts** (Foundry, deploy scripts, verification). Then deploy **Applications** (build images, push to registry, deploy to K8s). Finally run **Validation** (health checks, E2E tests, monitoring).

## Prerequisites

Core tools: `brew install --cask docker`, `brew install kurtosis-tech/tap/kurtosis`, `curl -fsSL https://bun.sh/install | bash`, `curl -L https://foundry.paradigm.xyz | bash && foundryup`.

For testnet/mainnet infrastructure: `brew install terraform kubectl helm helmfile`.

```bash
git clone https://github.com/elizaos/jeju.git
cd jeju
bun install
cp env.example .env.local        # Localnet
cp env.testnet .env.testnet      # Testnet
cp env.mainnet .env.mainnet      # Mainnet
```

## Directory Structure

The `packages/deployment/` directory contains `kubernetes/helm/` for individual service charts, `kubernetes/helmfile/` for environment configurations, `terraform/modules/` for reusable modules, `terraform/environments/` for per-environment configs, `kurtosis/` for local development, and `scripts/` for automation scripts.

## Secrets Management

For localnet, secrets go in `.env.local` (gitignored). For testnet and mainnet, use AWS Secrets Manager, with HSM for mainnet. Required secrets include `DEPLOYER_PRIVATE_KEY` for contract deployer, `ETHERSCAN_API_KEY` for contract verification, `WALLETCONNECT_PROJECT_ID` for wallet connections, and `OPENAI_API_KEY` for AI features.

## Network Endpoints

Localnet has L2 RPC at `http://127.0.0.1:9545`, L1 RPC at `http://127.0.0.1:8545`, and Indexer at `http://127.0.0.1:4350/graphql`.

Testnet has L2 RPC at `https://testnet-rpc.jeju.network`, Explorer at `https://testnet-explorer.jeju.network`, and Indexer at `https://testnet-indexer.jeju.network/graphql`.

Mainnet has L2 RPC at `https://rpc.jeju.network`, Explorer at `https://explorer.jeju.network`, and Indexer at `https://indexer.jeju.network/graphql`.
