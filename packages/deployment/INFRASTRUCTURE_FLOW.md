# Jeju Network Infrastructure Flow

## Core Principle: On-Chain Provisioning for Everything

**All environments (localnet, testnet, mainnet) use the same on-chain provisioning flow.**

The only difference between environments is the compute backend:
- **Localnet**: Contracts deployed to Anvil → Docker containers on localhost
- **Testnet**: Contracts on Base Sepolia → DWS nodes (cloud)
- **Mainnet**: Contracts on Base → DWS nodes with TEE (cloud)

This means:
- Dev matches prod exactly in terms of provisioning logic
- All services (Solana, Postgres, Redis, IPFS) go through DWS contracts
- No "skip on-chain" paths - even localhost uses the marketplace

---

## Overview

Jeju Network infrastructure is deployed in two phases:

1. **Phase 1: Bootstrap Infrastructure** (Terraform) - Cloud resources needed to host DWS nodes
2. **Phase 2: Decentralized Services** (On-Chain + DWS) - All services provisioned via marketplace

After chain launch, all non-chain services transition to DWS marketplace provisioning, making them permissionless and decentralized.

---

## Phase 1: Terraform Infrastructure (Pre-Chain)

These resources are deployed via Terraform to AWS/GCP before the Jeju chain is live.

### Core Cloud Resources

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TERRAFORM MANAGED                               │
│                      (Required for Chain Launch)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  │   NETWORKING    │  │    COMPUTE      │  │    STORAGE      │        │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤        │
│  │ • VPC           │  │ • EKS/GKE       │  │ • RDS/CloudSQL  │        │
│  │ • Subnets       │  │   Cluster       │  │ • ECR/Artifact  │        │
│  │ • NAT Gateway   │  │ • Node Groups:  │  │   Registry      │        │
│  │ • Route Tables  │  │   - general     │  │ • S3/GCS        │        │
│  │                 │  │   - rpc         │  │   Buckets       │        │
│  │                 │  │   - indexer     │  │                 │        │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘        │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  │    SECURITY     │  │      DNS        │  │      CDN        │        │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤        │
│  │ • KMS Keys      │  │ • Route53/      │  │ • CloudFront/   │        │
│  │ • WAF Rules     │  │   Cloud DNS     │  │   Cloud CDN     │        │
│  │ • ACM/SSL       │  │ • DNS Records   │  │ • Static Assets │        │
│  │ • IAM Roles     │  │ • JNS Gateway   │  │ • Frontend Apps │        │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘        │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐                              │
│  │  LOAD BALANCER  │  │   MONITORING    │                              │
│  ├─────────────────┤  ├─────────────────┤                              │
│  │ • ALB/GLB       │  │ • CloudWatch    │                              │
│  │ • Target Groups │  │ • Prometheus    │                              │
│  │ • SSL Termina-  │  │ • Grafana       │                              │
│  │   tion          │  │ • Alerting      │                              │
│  └─────────────────┘  └─────────────────┘                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Initial Kubernetes Deployments (Helm)

These services run on the Terraform-provisioned K8s cluster:

| Service | Purpose | Phase 1 |
|---------|---------|---------|
| `op-geth` | L2 Execution Client | ✅ Required |
| `op-node` | L2 Consensus Client | ✅ Required |
| `op-batcher` | Transaction Batching | ✅ Required |
| `op-proposer` | State Root Proposing | ✅ Required |
| `indexer` | Blockchain Indexer | ✅ Required |
| `gateway` | API Gateway | ✅ Required |
| `bundler` | ERC-4337 Bundler | ✅ Required |
| `farcaster-hub` | Social Identity | ✅ Required |
| `sqlit` | Decentralized DB | ✅ Required |
| `messaging` | Relay + KMS | ✅ Required |

---

## Phase 2: On-Chain + DWS Services (Post-Chain)

After the Jeju chain is live, services transition to on-chain provisioning.

### On-Chain Contracts (Deployed to Jeju L2)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ON-CHAIN CONTRACTS                              │
│                    (Deployed after Chain Launch)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CORE REGISTRIES                           STAKING & DELEGATION         │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────┐  │
│  │ • IdentityRegistry (ERC-8004)       │  │ • DelegatedNodeStaking  │  │
│  │ • NodeStakingManager                │  │ • MultiServiceStakeMgr  │  │
│  │ • SequencerRegistry                 │  │ • AutoSlasher           │  │
│  │ • ComputeRegistry                   │  │                         │  │
│  │ • StorageManager                    │  │                         │  │
│  │ • CDNRegistry                       │  │                         │  │
│  │ • VPNRegistry                       │  │                         │  │
│  │ • ProxyRegistry                     │  │                         │  │
│  └─────────────────────────────────────┘  └─────────────────────────┘  │
│                                                                         │
│  DWS CONTRACTS                             EXTERNAL CHAINS              │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────┐  │
│  │ • DWSProviderRegistry               │  │ • ExternalChainProvider │  │
│  │ • DWSServiceProvisioning            │  │   - Solana nodes        │  │
│  │ • DWSBilling                        │  │   - Bitcoin nodes       │  │
│  │ • WorkerRegistry                    │  │   - Cosmos nodes        │  │
│  │                                     │  │   - Other chains        │  │
│  └─────────────────────────────────────┘  └─────────────────────────┘  │
│                                                                         │
│  MARKETPLACE & GOVERNANCE                  NAMING & DISCOVERY           │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────┐  │
│  │ • ComputeRental                     │  │ • JNSRegistry           │  │
│  │ • ServiceRegistry                   │  │ • JNSResolver           │  │
│  │ • LiquidityRouter                   │  │ • JNSRegistrar          │  │
│  │ • Treasury                          │  │ • RepoRegistry          │  │
│  │ • DAOFunding                        │  │ • PackageRegistry       │  │
│  │                                     │  │ • ContainerRegistry     │  │
│  └─────────────────────────────────────┘  └─────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### DWS Marketplace Services

These services are provisioned through DWS and can be run by anyone:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DWS MARKETPLACE SERVICES                             │
│              (Permissionless - Anyone Can Provide)                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  JEJU PROVIDES (Canonical)          ANYONE CAN PROVIDE                  │
│  ┌───────────────────────────┐     ┌───────────────────────────┐       │
│  │ • Solana RPC (TEE)        │     │ • Solana RPC              │       │
│  │ • Bitcoin RPC             │     │ • Bitcoin RPC             │       │
│  │ • Bridge Relayers         │     │ • Bridge Relayers         │       │
│  │ • Oracle Feeds            │     │ • Oracle Feeds            │       │
│  │ • Storage Nodes           │     │ • Storage Nodes           │       │
│  │ • CDN Edge Nodes          │     │ • CDN Edge Nodes          │       │
│  │ • Compute Workers         │     │ • Compute Workers         │       │
│  │ • VPN Exit Nodes          │     │ • VPN Exit Nodes          │       │
│  └───────────────────────────┘     └───────────────────────────┘       │
│                                                                         │
│  PROVISIONING FLOW:                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  1. Provider stakes tokens → DelegatedNodeStaking               │   │
│  │  2. Provider registers    → DWSProviderRegistry                 │   │
│  │  3. Consumer requests     → ExternalChainProvider.provision()   │   │
│  │  4. DWS deploys node      → Workerd/Container/TEE               │   │
│  │  5. Consumer pays         → x402 or prepaid credits             │   │
│  │  6. Provider earns        → Commission + delegator rewards      │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Deployment by Environment

### Localnet (Development)

**Key Principle: Full on-chain provisioning, even locally.**

Everything goes through the same DWS marketplace flow - contracts deployed to local Anvil, Docker containers as compute backend.

```bash
# Start local chain (Anvil) + deploy contracts
NETWORK=localnet bun run scripts/deploy/full-deployment.ts

# Provision Solana via on-chain marketplace (deploys to local Docker)
NETWORK=localnet bun run scripts/deploy/dws-external-chains.ts --chain solana

# Provision PostgreSQL via on-chain marketplace (deploys to local Docker)
NETWORK=localnet bun run scripts/deploy/dws-external-chains.ts --chain postgres

# Provision Redis via on-chain marketplace (deploys to local Docker)
NETWORK=localnet bun run scripts/deploy/dws-external-chains.ts --chain redis
```

**How it works:**
1. Contracts deployed to local Anvil (port 8545)
2. Register as provider → `ExternalChainProvider.registerProvider()` on Anvil
3. Request service → `ExternalChainProvider.provisionNode()` on Anvil
4. Deploy to Docker → `docker run <service>`
5. Report ready → `ExternalChainProvider.reportNodeReady()` on Anvil
6. Consumer discovers → reads endpoint from on-chain

**Compute Backend:** Local Docker
**Chain:** Local Anvil
**Flow:** Same as testnet/mainnet

### Testnet

```bash
# Phase 1: Deploy Terraform infrastructure
cd packages/deployment/terraform/environments/testnet
terraform apply

# Phase 2: Deploy Kubernetes services
NETWORK=testnet bun run k8s:deploy

# Phase 3: Deploy contracts
NETWORK=testnet bun run scripts/deploy/contracts.ts

# Phase 4: Register as DWS provider + provision external chains
NETWORK=testnet bun run scripts/deploy/dws-external-chains.ts --chain solana

# Multi-cloud coordination (AWS + GCP)
NETWORK=testnet bun run scripts/infrastructure/multi-cloud-coordinator.ts all
```

**External Chains in Testnet:**
- Solana Devnet: Provisioned via DWS, TEE optional
- Bitcoin Testnet: Provisioned via DWS
- Jeju is both buyer AND seller on marketplace initially

### Mainnet

```bash
# Phase 1: Deploy Terraform infrastructure (both AWS + GCP for redundancy)
cd packages/deployment/terraform/environments/mainnet
terraform apply

cd ../gcp-mainnet
terraform apply

# Phase 2: Deploy Kubernetes services
NETWORK=mainnet bun run k8s:deploy

# Phase 3: Deploy contracts
NETWORK=mainnet bun run scripts/deploy/contracts.ts

# Phase 4: Register as DWS provider + provision external chains (TEE required)
NETWORK=mainnet bun run scripts/deploy/dws-external-chains.ts --chain solana --tee

# Multi-cloud coordination
NETWORK=mainnet bun run scripts/infrastructure/multi-cloud-coordinator.ts all
```

**External Chains in Mainnet:**
- Solana Mainnet: TEE required, provisioned via DWS
- Bitcoin Mainnet: Provisioned via DWS
- Anyone can become a provider and compete

---

## Running Your Own Node

### Full Jeju Chain Node

Run the complete Jeju L2 infrastructure:

```bash
# Clone and build
git clone https://github.com/JejuNetwork/jeju
cd jeju

# Option 1: Run as standalone node (connects to existing network)
bun run node:start --network testnet

# Option 2: Run with staking (earn rewards)
bun run node:start --network testnet --stake 10000 --commission 20

# Services included:
# - op-geth (execution)
# - op-node (consensus)
# - Sequencer (if registered and staked)
# - All DWS services
```

### Node Services Configuration

```typescript
// apps/node configuration
{
  services: {
    // Chain infrastructure
    sequencer: { enabled: true, minStake: '100000' },
    
    // DWS services (earn rewards)
    compute: { enabled: true },
    storage: { enabled: true },
    cdn: { enabled: true },
    oracle: { enabled: true },
    bridge: { enabled: true },
    
    // External chain nodes (optional)
    externalChains: {
      solana: { enabled: true, tee: true },
      bitcoin: { enabled: false }
    }
  },
  
  // Staking configuration
  staking: {
    selfStake: '10000',      // Your own stake
    commissionBps: 2000,     // 20% commission
    acceptDelegations: true  // Allow others to delegate
  }
}
```

### Delegated Staking (Capital Providers)

Don't have hardware? Delegate to operators:

```typescript
// As a capital staker
await delegatedNodeStaking.delegate(nodeId, { value: parseEther('1000') })

// Profit split:
// - Operator: 20-40% (commission)
// - Delegators: 60-80% (proportional to stake)
// - Protocol: 5% (treasury)
```

---

## Infrastructure Ownership Matrix

| Component | Localnet | Testnet | Mainnet |
|-----------|----------|---------|---------|
| **Chain** | Anvil (local) | Base Sepolia | Base Mainnet |
| **Contracts** | On Anvil | On Base Sepolia | On Base |
| **Provisioning** | On-chain → Docker | On-chain → DWS | On-chain → DWS + TEE |
| **Solana RPC** | On-chain → Docker | On-chain → DWS | On-chain → DWS (TEE) |
| **Bitcoin RPC** | On-chain → Docker | On-chain → DWS | On-chain → DWS |
| **PostgreSQL** | On-chain → Docker | On-chain → DWS | On-chain → DWS |
| **Redis** | On-chain → Docker | On-chain → DWS | On-chain → DWS |
| **IPFS** | On-chain → Docker | On-chain → DWS | On-chain → DWS |
| **Compute** | On-chain → Docker | On-chain → DWS | On-chain → DWS + TEE |

**All environments use the same on-chain provisioning flow.** The only difference is the compute backend:
- Localnet: Docker containers on localhost
- Testnet: DWS nodes (cloud)
- Mainnet: DWS nodes with TEE (cloud)

---

## Decentralization Timeline

```
Phase 1: Launch
├── Jeju operates all infrastructure
├── Contracts deployed
└── DWS marketplace live but Jeju is primary provider

Phase 2: Bootstrap (Months 1-3)
├── Community nodes start joining
├── Jeju still provides canonical services
├── External providers earn rewards
└── Delegated staking active

Phase 3: Decentralized (Months 3-6)
├── Multiple providers for each service
├── Automatic failover between providers
├── Jeju is one of many providers
└── Geographic distribution achieved

Phase 4: Fully Decentralized (6+ months)
├── No single point of failure
├── All services have redundant providers
├── Jeju may or may not be a provider
└── Protocol governance decides upgrades
```

---

## Quick Reference Commands

```bash
# Local Development
bun run localnet:start              # Start local chain
bun run localnet:stop               # Stop local chain

# Testnet Deployment
NETWORK=testnet bun run deploy:all  # Full deployment
NETWORK=testnet bun run k8s:deploy  # K8s only

# Mainnet Deployment
NETWORK=mainnet bun run deploy:all  # Full deployment

# External Chains
NETWORK=testnet bun run scripts/deploy/dws-external-chains.ts --chain solana
NETWORK=mainnet bun run scripts/deploy/dws-external-chains.ts --chain solana --tee

# Multi-Cloud
NETWORK=testnet bun run scripts/infrastructure/multi-cloud-coordinator.ts status
NETWORK=testnet bun run scripts/infrastructure/multi-cloud-coordinator.ts all

# Node Operations
bun run node:start                  # Start node
bun run node:stake 10000           # Stake tokens
bun run node:register              # Register as provider
```

