# Mainnet

Production deployment to Jeju mainnet.

## Network Details

| Property | Value |
|----------|-------|
| Chain ID | `420691` |
| RPC | `https://rpc.jeju.network` |
| WebSocket | `wss://ws.jeju.network` |
| Explorer | `https://explorer.jeju.network` |
| Indexer | `https://indexer.jeju.network/graphql` |
| L1 Network | Ethereum |

## Pre-Deployment Checklist

### Security
- [ ] Smart contract audit completed
- [ ] Bug bounty program live
- [ ] Multi-sig wallets configured
- [ ] Emergency runbooks documented
- [ ] On-call team assigned

### Testing
- [ ] Testnet stable 4+ weeks
- [ ] All E2E tests passing
- [ ] Load testing completed
- [ ] Chaos testing performed

### Infrastructure
- [ ] Production AWS account configured
- [ ] HSM for key management
- [ ] Backup/restore tested
- [ ] DDoS protection enabled

## Deploy

### One Command

```bash
bun run deploy:mainnet
```

Includes safety checks:
- Confirmation prompts
- Multi-sig transaction creation
- Staged rollout
- Automatic rollback on failure

### Multi-Sig Flow

1. Generate transaction
2. Submit to Gnosis Safe
3. Collect signatures (3/5 threshold)
4. Execute after timelock (2 days)

```bash
# Generate deployment tx
forge script script/DeployMainnet.s.sol \
  --rpc-url https://rpc.jeju.network \
  --slow

# Submit to Safe
bun run scripts/deploy/submit-to-safe.ts \
  --safe $MAINNET_SAFE \
  --tx-file broadcast/DeployMainnet.s.sol/420691/run-latest.json
```

## Monitoring

| Service | URL |
|---------|-----|
| Status | `https://status.jeju.network` |
| Prometheus | `https://prometheus.jeju.network` |
| Grafana | `https://grafana.jeju.network` |

### Critical Alerts

| Alert | Threshold | Action |
|-------|-----------|--------|
| Blocks stopped | 0 in 5min | Page on-call |
| L1 submission failed | 2 failures | Page on-call |
| High latency | p99 > 500ms | Warning |
| Low sequencer balance | < 1 ETH | Refill |

## Rollback

### Kubernetes

```bash
helm rollback -n jeju-mainnet $RELEASE
```

### Contracts

UUPS upgradeable contracts can rollback:

```bash
bun run scripts/deploy/prepare-rollback.ts \
  --contract IdentityRegistry \
  --to-version 1.0.0
# Then execute via multi-sig
```

### Disaster Recovery

```bash
bun run scripts/disaster-recovery.ts --network mainnet
```

## Post-Deployment

1. Update status page
2. Announce on Discord/Twitter
3. Enable public RPC
4. Monitor metrics 24h

## Emergency Contacts

- On-call: PagerDuty
- Security: security@jeju.network
- Comms: comms@jeju.network

