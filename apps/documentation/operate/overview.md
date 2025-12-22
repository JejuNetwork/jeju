# Node Operations

Run infrastructure on Jeju.

## Node Types

| Role | What you do | Stake | Hardware |
|------|-------------|-------|----------|
| **RPC Node** | Serve RPC requests | 0.5 ETH | 8 cores, 32GB RAM, 500GB SSD |
| **Compute Node** | AI inference | 1 ETH | 16 cores, 64GB RAM, GPU 8GB+ |
| **Storage Node** | IPFS storage | 0.5 ETH | 8 cores, 32GB RAM, 10TB+ |
| **XLP** | Bridge liquidity | 1 ETH + capital | Any |
| **Solver** | Fill intents | 0.5 ETH + capital | Any |

Earnings depend on network demand and your performance.

## RPC Node

Serves blockchain RPC requests.

### Requirements

- 8+ CPU cores, 32GB RAM, 500GB NVMe
- Static IP or domain
- 100Mbps+ internet
- 0.5 ETH stake

### Setup

```bash
git clone https://github.com/elizaos/jeju
cd jeju

cp .env.rpc.example .env
# Edit .env: set PRIVATE_KEY

docker compose -f packages/deployment/docker/rpc-node.yml up -d

# Verify
curl http://localhost:8545/health
```

### Register

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

Runs AI inference jobs.

### Requirements

- 16+ CPU cores, 64GB RAM
- NVIDIA GPU (8GB+ VRAM)
- 1TB NVMe
- 1 ETH stake

### Setup

```bash
# Check GPU
nvidia-smi

cp .env.compute.example .env
# Edit .env: set PRIVATE_KEY, GPU_ENABLED=true

docker compose -f packages/deployment/docker/compute-node.yml up -d
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

Provides IPFS storage.

### Requirements

- 8+ CPU cores, 32GB RAM
- 10TB+ storage
- 1Gbps internet
- 0.5 ETH stake

### Setup

```bash
cp .env.storage.example .env
docker compose -f packages/deployment/docker/storage-node.yml up -d
```

## XLP (Liquidity Provider)

Provide bridge liquidity. Users deposit on Ethereum/Base, you credit them on Jeju, then claim your deposit.

**Requirements:**
- 1 ETH stake
- Liquidity capital (minimum 5 ETH worth on Jeju)

→ [EIL Guide](/integrate/eil)

## Solver

Fill cross-chain intents.

**Requirements:**
- 0.5 ETH stake
- Capital to fill intents

→ [OIF Guide](/integrate/oif)

## Staking

### Check Stake

```typescript
const stake = await jeju.staking.getStake(nodeId);
console.log('Amount:', stake.amount);
console.log('Locked until:', new Date(stake.unlockTime * 1000));
```

### Add Stake

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

Distributed based on:
- Uptime
- Requests served
- Response quality

```typescript
const pending = await jeju.staking.getPendingRewards(nodeId);
console.log('Pending:', pending);

await jeju.staking.claimRewards({ nodeId });
```

## Monitoring

Every node exposes:

| Endpoint | Purpose |
|----------|---------|
| `/health` | Basic health check |
| `/ready` | Ready to serve |
| `/metrics` | Prometheus metrics |

### Prometheus

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'jeju-node'
    static_configs:
      - targets: ['localhost:9090']
```

Import Grafana dashboards from `apps/monitoring/grafana/`.

## Slashing

| Offense | Penalty |
|---------|---------|
| Downtime > 24h | 10% |
| Invalid responses | 25% |
| Malicious behavior | 100% |

### Appeal

1. Submit appeal via Gateway
2. DAO vote (7 days)
3. If upheld, slash reversed

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Node Operations

Node types:
- RPC: 0.5 ETH stake, 8 cores, 32GB RAM, 500GB
- Compute: 1 ETH stake, 16 cores, 64GB RAM, GPU
- Storage: 0.5 ETH stake, 8 cores, 32GB RAM, 10TB
- XLP: 1 ETH stake + capital
- Solver: 0.5 ETH stake + capital

Setup:
git clone https://github.com/elizaos/jeju
docker compose -f packages/deployment/docker/rpc-node.yml up -d

Register:
await jeju.staking.registerNode({ type: 'rpc', endpoint, stake: parseEther('0.5') });

Staking:
await jeju.staking.addStake({ nodeId, amount })
await jeju.staking.initiateUnbond({ nodeId, amount }) // 7-day unbond
await jeju.staking.claimRewards({ nodeId })

Slashing: >24h downtime 10%, invalid 25%, malicious 100%
Endpoints: /health, /ready, /metrics
```

</details>
