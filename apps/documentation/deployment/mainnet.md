# Mainnet Deployment

Production deployment to Jeju mainnet.

## Pre-Deployment Checklist

### Security

- [ ] Smart contract audit completed
- [ ] Bug bounty program live
- [ ] Multi-sig wallets configured
- [ ] Emergency runbooks documented
- [ ] 24/7 on-call team assigned
- [ ] Incident response plan tested

### Testing

- [ ] Testnet stable for 4+ weeks
- [ ] All E2E tests passing
- [ ] Load testing completed
- [ ] Chaos testing performed
- [ ] Security scanning completed

### Infrastructure

- [ ] Production AWS account configured
- [ ] HSM for key management
- [ ] Backup/restore tested
- [ ] Disaster recovery plan
- [ ] CDN configured
- [ ] DDoS protection enabled

### Governance

- [ ] DAO treasury configured
- [ ] Timelock contracts deployed
- [ ] Multi-sig requirements set
- [ ] Upgrade procedures documented

## Deployment

### One Command

```bash
bun run deploy:mainnet
```

This runs with additional safety checks:
1. Confirmation prompts
2. Multi-sig transaction creation
3. Staged rollout
4. Automatic rollback on failure

### Step by Step

#### 1. Infrastructure

```bash
cd packages/deployment/terraform

# Review plan carefully
terraform plan -var-file=mainnet.tfvars -out=mainnet.plan

# Apply with team review
terraform apply mainnet.plan
```

#### 2. L1 Contracts (Ethereum)

Deploy to Ethereum mainnet via multi-sig:

```bash
cd packages/contracts

# Generate deployment transaction
forge script script/DeployL1Mainnet.s.sol \
  --rpc-url https://eth.llamarpc.com \
  --slow

# Submit to Gnosis Safe
bun run scripts/deploy/submit-to-safe.ts \
  --safe $MAINNET_SAFE \
  --tx-file broadcast/DeployL1Mainnet.s.sol/1/run-latest.json
```

Wait for multi-sig approval, then:

```bash
# Verify after execution
forge verify-contract $ADDRESS src/Contract.sol:Contract \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

#### 3. L2 Genesis

Generate L2 genesis with L1 contract addresses:

```bash
cd packages/deployment
bun run scripts/generate-genesis.ts \
  --network mainnet \
  --l1-contracts $L1_DEPLOYMENT_JSON
```

#### 4. Kubernetes Services

Deploy with staged rollout:

```bash
cd packages/deployment/kubernetes/helmfile

# Deploy sequencer first
helmfile -e mainnet -l component=sequencer sync

# Verify block production
bun run scripts/verify-blocks.ts --network mainnet

# Deploy remaining services
helmfile -e mainnet sync
```

#### 5. L2 Contracts

```bash
cd packages/contracts

# Deploy via multi-sig
forge script script/DeployL2Mainnet.s.sol \
  --rpc-url https://rpc.jeju.network \
  --slow

# Submit to Safe
bun run scripts/deploy/submit-to-safe.ts \
  --safe $L2_SAFE \
  --tx-file broadcast/DeployL2Mainnet.s.sol/420691/run-latest.json
```

## Multi-Sig Configuration

### Safe Requirements

The L1 Admin Safe has 5 signers with a 3-of-5 threshold for L1 contract upgrades and configuration. The L2 Admin Safe also has 5 signers with a 3-of-5 threshold for L2 contract management. The Treasury Safe has 7 signers with a 4-of-7 threshold for fund management.

### Transaction Flow

```
Proposal → Safe Queue → 2-day Timelock → Execution
```

## Monitoring Setup

### Endpoints

Prometheus is available at https://prometheus.jeju.network for metrics. Grafana runs at https://grafana.jeju.network for dashboards. PagerDuty integration is configured internally for on-call routing.

### Critical Alerts

**Block production stopped** triggers when 0 blocks are produced in 5 minutes and pages on-call immediately. **L1 submission failed** triggers after 2 consecutive failures and pages on-call. **High latency** triggers when p99 exceeds 500ms as a warning. **Low sequencer balance** triggers when the sequencer has less than 1 ETH and requires a refill.

## Rollback Procedures

### Contract Rollback

Upgradeable contracts can be rolled back via proxy:

```bash
# Prepare rollback transaction
bun run scripts/deploy/prepare-rollback.ts \
  --contract IdentityRegistry \
  --to-version 1.0.0

# Submit to Safe
```

### Kubernetes Rollback

```bash
# Immediate rollback
helm rollback -n jeju-mainnet op-reth

# Rollback with specific revision
helm rollback -n jeju-mainnet op-reth 5
```

### Full Rollback

If critical failure, execute disaster recovery:

```bash
bun run scripts/disaster-recovery.ts --network mainnet
```

## Post-Deployment

### Verification

```bash
# Comprehensive checks
bun run scripts/verify-mainnet.ts

# Manual checks
curl https://rpc.jeju.network -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Announcement

1. Update status page
2. Announce on Discord/Twitter
3. Update documentation
4. Enable public RPC endpoints

### Ongoing Operations

- Monitor metrics dashboards
- Review alert thresholds
- Schedule regular drills
- Maintain on-call rotation

## Mainnet Details

The mainnet chain ID is 420691. RPC is available at https://rpc.jeju.network and WebSocket at wss://ws.jeju.network. The block explorer runs at https://explorer.jeju.network. The L1 network is Ethereum mainnet with chain ID 1.

## Emergency Contacts

The on-call engineer is reachable via PagerDuty. Security issues should be reported to security@jeju.network. Communications and public announcements go through comms@jeju.network.

