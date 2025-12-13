# Node Operations

Run infrastructure on Jeju and earn rewards.

## Operator Roles

| Role | What You Do | Requirements | Rewards |
|------|-------------|--------------|---------|
| **RPC Node** | Serve blockchain queries | 1,000 JEJU stake, 16GB RAM | Block rewards + tips |
| **XLP** | Provide bridge liquidity | 1+ ETH on L1 | 0.05-0.3% per transfer |
| **Solver** | Fill cross-chain intents | 0.5 ETH stake | Intent spreads |
| **Compute** | Serve AI inference | GPU, 0.1 ETH stake | Pay per request |
| **Storage** | Store IPFS data | 1TB+ disk, 0.1 ETH stake | Storage fees |

## Quick Start

Choose your path:

### I want to run infrastructure
→ [Run an RPC Node](/operate/rpc-node)

### I want to provide bridge liquidity
→ [Become an XLP](/operate/xlp)

### I want to fill intents
→ [Become a Solver](/operate/solver)

### I want to provide compute
→ [Run a Compute Node](/operate/compute-node)

### I want to provide storage
→ [Run a Storage Node](/operate/storage-node)

## Hardware Requirements

### Minimum Specs

| Role | CPU | RAM | Storage | Network |
|------|-----|-----|---------|---------|
| RPC Node | 8 cores | 16 GB | 500 GB SSD | 100 Mbps |
| Compute | 8+ cores | 32 GB | 500 GB SSD | 100 Mbps |
| Storage | 4 cores | 8 GB | 1 TB | 100 Mbps |

### Recommended for Production

| Role | CPU | RAM | Storage | Network |
|------|-----|-----|---------|---------|
| RPC Node | 16 cores | 32 GB | 1 TB NVMe | 1 Gbps |
| Compute | 16+ cores | 64 GB | 1 TB NVMe | 1 Gbps |
| Storage | 8 cores | 16 GB | 10 TB | 1 Gbps |

### GPU Requirements (Compute Only)

| Tier | GPU | VRAM | Use Case |
|------|-----|------|----------|
| Entry | RTX 3090 | 24 GB | Small models |
| Standard | A100 | 40-80 GB | Large models |
| Premium | H100 | 80 GB | All models |

## Staking

All operators stake tokens to participate:

| Role | Token | Minimum | Lockup |
|------|-------|---------|--------|
| RPC Node | JEJU | 1,000 | 7 days |
| XLP | ETH | 1.0 | 14 days |
| Solver | ETH | 0.5 | 7 days |
| Compute | ETH | 0.1 | None |
| Storage | ETH | 0.1 | None |

Staked funds are slashable for misbehavior.

## Rewards

### RPC Nodes
- Block rewards from sequencer tips
- Based on uptime and performance
- Higher rewards for better latency

### XLPs
- 0.05-0.3% of every fast bridge transfer
- Set your own fee within bounds
- Rewards proportional to liquidity

### Solvers
- Keep spread on intent fills
- Typical spread: 0.1-0.5%
- Compete on speed and price

### Compute Nodes
- Per-token inference payments
- Session-based rental income
- x402 micropayments

### Storage Nodes
- Per-MB upload fees
- Monthly pinning fees
- Paid in ETH or tokens

## Monitoring

All operators should monitor:

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Uptime | >99.9% | <99% | <95% |
| Latency | <100ms | <500ms | >500ms |
| Sync lag | 0 blocks | <10 | >100 |

Use Prometheus + Grafana for monitoring. See [Monitoring Setup](/operate/deployment#monitoring).

## Slashing

Operators can be slashed for:

| Offense | Penalty |
|---------|---------|
| Downtime >1 hour | Warning |
| Downtime >24 hours | 5% stake |
| Repeated downtime | Up to 100% |
| Malicious behavior | 100% stake |
| Invalid attestations | 100% stake |

## Getting Help

- [Discord #operators](https://discord.gg/elizaos)
- [GitHub Issues](https://github.com/elizaos/jeju/issues)
- [Status Page](https://status.jeju.network)

