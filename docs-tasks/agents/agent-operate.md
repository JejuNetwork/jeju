# Agent Task: Operate (Node Operators) Documentation

## Scope
Write documentation for node operators, solvers, and XLPs.

## Source Files to Analyze
- `apps/node/` - Node implementation
- `packages/deployment/` - Deployment configs
- `scripts/sequencer/` - Sequencer scripts
- `apps/documentation/operate/` - Existing docs
- `apps/documentation/guides/` - Operator guides

## Research Questions
1. How do you run an RPC node?
2. How do you run a compute node?
3. How do you run a storage node?
4. How does the sequencer work?
5. How do you become a solver?
6. How do you become an XLP?
7. What staking requirements exist?
8. What rewards are available?

## Output Files

### 1. `apps/documentation/operate/overview.md`

```markdown
# Node Operations Overview

Run infrastructure and earn rewards on Jeju.

## Node Types

| Type | Purpose | Stake Required |
|------|---------|---------------|
| RPC Node | Serve RPC requests | 0.5 ETH |
| Compute Node | AI inference | 1 ETH |
| Storage Node | IPFS storage | 0.5 ETH |
| Sequencer | Block production | 10 ETH |

## Roles

### Solver
Fill cross-chain intents, earn spreads.

### XLP (Cross-chain Liquidity Provider)
Provide instant bridging liquidity, earn fees.

## Getting Started

1. [Run RPC Node](/operate/rpc-node)
2. [Run Compute Node](/operate/compute-node)
3. [Become Solver](/operate/solver)
4. [Become XLP](/operate/xlp)

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/operate/rpc-node.md`

```markdown
# Run an RPC Node

Serve RPC requests and earn fees.

## Requirements

### Hardware
- 8+ CPU cores
- 32GB RAM
- 500GB NVMe SSD
- 100Mbps network

### Software
- Docker
- Linux (Ubuntu 22.04 recommended)

## Setup

### 1. Clone Repository
\`\`\`bash
git clone https://github.com/elizaos/jeju && cd jeju
\`\`\`

### 2. Configure
\`\`\`bash
cp .env.example .env
# Edit .env with your settings
\`\`\`

### 3. Start Node
\`\`\`bash
docker compose -f docker-compose.rpc.yml up -d
\`\`\`

### 4. Register On-Chain
\`\`\`bash
jeju node register --type rpc --stake 0.5
\`\`\`

## Monitoring

[Health checks, metrics]

## Rewards

[How RPC node rewards work]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 3. `apps/documentation/operate/compute-node.md`

```markdown
# Run a Compute Node

Provide AI inference and earn rewards.

## Requirements

### Hardware
- NVIDIA GPU (8GB+ VRAM)
- 16+ CPU cores
- 64GB RAM
- 1TB NVMe SSD

## Setup

[Compute node setup steps]

## Supported Models

[Available AI models]

## Pricing

[How to set pricing]

## Monitoring

[GPU metrics, job tracking]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 4. `apps/documentation/operate/storage-node.md`

```markdown
# Run a Storage Node

Provide IPFS storage and earn fees.

## Requirements

[Hardware/software requirements]

## Setup

[Storage node setup]

## Configuration

[Storage limits, pricing]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 5. `apps/documentation/operate/sequencer.md`

```markdown
# Sequencer Guide

Operate the Jeju sequencer (advanced).

## Overview

[Sequencer role, responsibilities]

## Requirements

[High availability requirements]

## Setup

[Sequencer setup]

## Threshold Signing

[Multi-party signing]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 6. `apps/documentation/operate/solver.md`

```markdown
# Become a Solver

Fill cross-chain intents and earn spreads.

## Overview

Solvers monitor intents on source chains and fill them on Jeju.

## Requirements

- 0.5 ETH stake
- Bot infrastructure
- Multi-chain RPC access

## Setup

\`\`\`bash
bun add @jejunetwork/sdk

# Start solver bot
bun run solver --networks ethereum,base,jeju
\`\`\`

## Registration

\`\`\`typescript
await client.oif.registerSolver({
  stake: parseEther('0.5'),
  chains: [1, 8453, 420691],
});
\`\`\`

## Economics

[Spreads, fees, profitability]

## Strategies

[Solver strategies]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 7. `apps/documentation/operate/xlp.md`

```markdown
# Become an XLP

Provide cross-chain liquidity and earn fees.

## Overview

XLPs enable instant bridging by fronting liquidity.

## Requirements

- 1+ ETH stake on L1
- Liquidity on L2
- Bot infrastructure

## Setup

### 1. Stake on L1
\`\`\`bash
cast send $L1_STAKE_MANAGER "register(uint256[])" "[420691]" \
  --value 1ether --rpc-url $L1_RPC --private-key $PK
\`\`\`

### 2. Provide L2 Liquidity
\`\`\`bash
cast send $CROSS_CHAIN_PAYMASTER "depositETH()" \
  --value 5ether --rpc-url $L2_RPC --private-key $PK
\`\`\`

### 3. Run XLP Bot
\`\`\`bash
bun run xlp-bot
\`\`\`

## Economics

[Fee structure, spreads]

## Risk Management

[Slashing conditions]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/operate.md`

