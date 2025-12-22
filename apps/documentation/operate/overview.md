# Node Operations

Run infrastructure on Jeju and earn rewards.

## What Can You Run?

| Role | What you do | Stake | Earning |
|------|-------------|-------|---------|
| **RPC Node** | Serve RPC requests | 0.5 ETH | ~$50-200/month |
| **Compute Node** | AI inference | 1 ETH | ~$100-500/month |
| **Storage Node** | IPFS pinning | 0.5 ETH | ~$50-200/month |
| **XLP** | Bridge liquidity | 1 ETH + capital | 0.1-0.3% per transfer |
| **Solver** | Fill intents | 0.5 ETH + capital | Spread |

*Earnings depend on demand and competition.*

## Quickest Start: RPC Node

An RPC node serves blockchain requests. Minimal setup.

### Requirements

- 8+ CPU cores, 32GB RAM, 500GB NVMe
- Static IP or domain
- 100Mbps+ internet
- 0.5 ETH for stake

### Setup

```bash
# Clone
git clone https://github.com/elizaos/jeju
cd jeju

# Configure
cp .env.rpc.example .env
nano .env  # Set PRIVATE_KEY, STAKE_AMOUNT=0.5

# Run
docker compose -f docker/rpc-node.yml up -d

# Verify
curl http://localhost:8545/health
```

### Register On-Chain

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseEther } from 'viem';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

await jeju.staking.registerNode({
  type: 'rpc',
  endpoint: 'https://my-node.example.com',
  stake: parseEther('0.5'),
});
```

## Compute Node

Runs AI inference. Requires GPU.

### Requirements

- 16+ CPU cores, 64GB RAM
- NVIDIA GPU (8GB+ VRAM, RTX 3080 or better)
- 1TB NVMe
- 1 ETH stake

### Setup

```bash
# Ensure NVIDIA drivers installed
nvidia-smi

# Configure
cp .env.compute.example .env
nano .env  # Set PRIVATE_KEY, GPU_ENABLED=true

# Run
docker compose -f docker/compute-node.yml up -d
```

### Register

```typescript
await jeju.staking.registerNode({
  type: 'compute',
  endpoint: 'https://my-compute.example.com',
  stake: parseEther('1'),
  capabilities: ['inference', 'llama3.2', 'mixtral'],
});
```

## Storage Node

Provides IPFS storage and pinning.

### Requirements

- 8+ CPU cores, 32GB RAM
- 10TB+ storage
- 1Gbps internet
- 0.5 ETH stake

### Setup

```bash
cp .env.storage.example .env
docker compose -f docker/storage-node.yml up -d
```

## XLP (Liquidity Provider)

Provide instant bridging liquidity. Users deposit on Ethereum/Base, you credit them instantly on Jeju, then claim your deposit later.

**Capital required:** At least 5 ETH worth of liquidity on Jeju.

→ [EIL Integration Guide](/integrate/eil#for-xlps-liquidity-providers)

## Solver

Fill cross-chain intents. Monitor for intents, fill them on Jeju, claim payment from source chain.

**Capital required:** Depends on intent sizes you want to fill.

→ [OIF Integration Guide](/integrate/oif#for-solvers)

## Staking

### Check Your Stake

```typescript
const stake = await jeju.staking.getStake(myNodeId);
console.log('Staked:', stake.amount);
console.log('Locked until:', new Date(stake.unlockTime * 1000));
```

### Add More Stake

```typescript
await jeju.staking.addStake({
  nodeId: myNodeId,
  amount: parseEther('0.5'),
});
```

### Withdraw (7-day unbonding)

```typescript
// Start unbonding
await jeju.staking.initiateUnbond({
  nodeId: myNodeId,
  amount: parseEther('0.5'),
});

// After 7 days
await jeju.staking.withdraw({ nodeId: myNodeId });
```

## Rewards

### How it Works

1. Users pay fees (RPC requests, inference, storage)
2. Protocol collects fees
3. Distributed to nodes based on uptime × volume × quality

### Claim Rewards

```typescript
const pending = await jeju.staking.getPendingRewards(myNodeId);
console.log('Pending:', pending);

await jeju.staking.claimRewards({ nodeId: myNodeId });
```

## Monitoring

Every node exposes:

| Endpoint | What it shows |
|----------|---------------|
| `/health` | Basic health |
| `/ready` | Ready to serve |
| `/metrics` | Prometheus metrics |

### Prometheus Setup

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'jeju-node'
    static_configs:
      - targets: ['localhost:9090']
```

### Grafana

Import dashboards from `apps/monitoring/grafana/`.

## Slashing

Your stake can be slashed for:

| Offense | Slash |
|---------|-------|
| Downtime > 24 hours | 10% |
| Invalid responses | 25% |
| Malicious behavior | 100% |

### Appeal

1. Submit appeal with evidence via Gateway UI
2. DAO votes (7 days)
3. If upheld, slash is reversed

## FAQ

**How much can I earn?**

Depends on demand. RPC nodes typically earn $50-200/month. Compute nodes with good GPUs can earn more. XLPs earn 0.1-0.3% per transfer.

**What uptime is required?**

99%+. More than 24 hours downtime = slashing.

**Can I run multiple node types?**

Yes. Each requires separate stake.

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Node Operations

Node types:
- RPC Node: 0.5 ETH stake, serve RPC, ~$50-200/mo
- Compute Node: 1 ETH stake, AI inference, ~$100-500/mo
- Storage Node: 0.5 ETH stake, IPFS, ~$50-200/mo
- XLP: 1 ETH stake + capital, bridge liquidity, 0.1-0.3%
- Solver: 0.5 ETH stake + capital, fill intents

Setup:
git clone https://github.com/elizaos/jeju
docker compose -f docker/rpc-node.yml up -d

Register:
await jeju.staking.registerNode({
  type: 'rpc',
  endpoint: 'https://my-node.example.com',
  stake: parseEther('0.5'),
});

Staking:
await jeju.staking.addStake({ nodeId, amount })
await jeju.staking.initiateUnbond({ nodeId, amount }) // 7-day unbond
await jeju.staking.claimRewards({ nodeId })

Hardware:
- RPC: 8 cores, 32GB RAM, 500GB NVMe
- Compute: 16 cores, 64GB RAM, GPU 8GB VRAM
- Storage: 8 cores, 32GB RAM, 10TB storage

Slashing: >24h downtime 10%, invalid responses 25%, malicious 100%
Endpoints: /health, /ready, /metrics
```

</details>
