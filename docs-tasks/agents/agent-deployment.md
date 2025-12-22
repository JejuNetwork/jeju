# Agent Task: Deployment Documentation

## Scope
Write comprehensive deployment documentation for all environments.

## Source Files to Analyze
- `packages/deployment/` - All deployment configs
- `packages/contracts/script/` - Contract deployment
- `scripts/deploy/` - Deployment scripts
- `apps/documentation/deployment/` - Existing docs

## Research Questions
1. How do you deploy contracts to each network?
2. How do you deploy infrastructure?
3. What is the localnet deployment process?
4. What is the testnet deployment process?
5. What is the mainnet deployment process?
6. How do you deploy apps?
7. How does Superchain deployment work?
8. What verification steps are needed?

## Output Files

### 1. `apps/documentation/deployment/overview.md`

```markdown
# Deployment Overview

Guide to deploying contracts, apps, and infrastructure on Jeju.

## Deployment Targets

| Environment | Purpose | Chain ID |
|-------------|---------|----------|
| Localnet | Development | 1337 |
| Testnet | Staging | 420690 |
| Mainnet | Production | 420691 |

## What You Can Deploy

- Smart Contracts
- DApps (frontend + backend)
- Infrastructure (nodes, services)

## Prerequisites

[Required tools and access]

## Quick Links

- [Deploy Contracts](/deployment/contracts)
- [Deploy to Localnet](/deployment/localnet)
- [Deploy to Testnet](/deployment/testnet)
- [Deploy to Mainnet](/deployment/mainnet)

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/deployment/contracts.md`

```markdown
# Deploy Contracts

How to deploy smart contracts to Jeju.

## Prerequisites

\`\`\`bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
\`\`\`

## Deploy with Foundry

### Localnet
\`\`\`bash
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:9545 --broadcast
\`\`\`

### Testnet
\`\`\`bash
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.jejunetwork.org \
  --broadcast --verify
\`\`\`

### Mainnet
\`\`\`bash
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.jejunetwork.org \
  --broadcast --verify
\`\`\`

## Using Jeju SDK

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({ network: 'testnet' });
const tx = await client.deployContract(bytecode, abi);
\`\`\`

## Verification

[How to verify contracts]

## Common Patterns

[Proxy patterns, upgrades]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 3. `apps/documentation/deployment/localnet.md`

```markdown
# Localnet Deployment

Set up a local development environment.

## Start Localnet

\`\`\`bash
bun run dev
\`\`\`

## Deploy Core Contracts

\`\`\`bash
cd packages/contracts
forge script script/DeployAll.s.sol --rpc-url http://127.0.0.1:9545 --broadcast
\`\`\`

## Deploy Apps

\`\`\`bash
bun run setup-apps
\`\`\`

## Minimal Mode

\`\`\`bash
bun run dev -- --minimal
\`\`\`

[Additional localnet details]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 4. `apps/documentation/deployment/testnet.md`

```markdown
# Testnet Deployment

Deploy to Jeju testnet for staging.

## Get Testnet ETH

[Faucet instructions]

## Deploy Contracts

\`\`\`bash
PRIVATE_KEY=$DEPLOYER_KEY forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.jejunetwork.org \
  --broadcast --verify
\`\`\`

## Deploy App

\`\`\`bash
jeju deploy --network testnet
\`\`\`

## Verification

[How to verify deployment]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 5. `apps/documentation/deployment/mainnet.md`

```markdown
# Mainnet Deployment

Production deployment to Jeju mainnet.

## Prerequisites

[Security checklist]

## Deploy Contracts

[Mainnet deployment steps]

## Deploy Infrastructure

[Production infrastructure]

## Monitoring

[Post-deployment monitoring]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 6. `apps/documentation/deployment/infrastructure.md`

```markdown
# Infrastructure Deployment

Deploy Jeju infrastructure with Kubernetes and Terraform.

## Kubernetes

[Helm charts, K8s deployment]

## Terraform

[Cloud provisioning]

## Docker Compose

[Single-node deployment]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 7. `apps/documentation/deployment/superchain.md`

```markdown
# Superchain Deployment

Deploy your own OP-Stack chain in the Jeju ecosystem.

## Fork Jeju

\`\`\`bash
bun run jeju fork --name "MyNetwork" --chain-id 123456
\`\`\`

## Configure

[branding.json, genesis, keys]

## Deploy

[L1 contracts, L2 chain]

## Join Superchain

[Registration, interop]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/deployment.md`

