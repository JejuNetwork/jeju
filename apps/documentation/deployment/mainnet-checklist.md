# Mainnet Deployment Checklist

L1: Ethereum (1) → Jeju Mainnet (420691)  
Time: 1-2 days  
Risk: High

## Pre-requisites

### Business
- [ ] Legal entity established
- [ ] Insurance obtained
- [ ] 24/7 on-call team (3+ engineers)
- [ ] Bug bounty live (Immunefi)

### Security
- [ ] Smart contract audit completed
- [ ] All critical/high findings resolved
- [ ] Penetration testing done

### Testnet
- [ ] Stable 4+ weeks
- [ ] No critical bugs
- [ ] Load tested (100 TPS)
- [ ] Team trained on ops

### Capital
- [ ] Deployer: ~3 ETH on Ethereum
- [ ] Batcher: ~10 ETH on Ethereum
- [ ] Proposer: ~3 ETH on Ethereum
- [ ] Emergency reserve: ~3 ETH

## Phase 1: Keys & Security

Use hardware wallets or HSM for all keys. Never store plaintext.

**Multisigs**:
- Operations (3-of-5): Daily ops, emergency pause
- Upgrades (5-of-9 + 48hr timelock): Contract upgrades
- Treasury (5-of-9): Fee collection

## Phase 2: Infrastructure

```bash
cd packages/deployment/terraform/environments/mainnet
terraform init && terraform validate
terraform plan -out=mainnet.tfplan
# Review with 2+ engineers
terraform apply mainnet.tfplan

aws eks update-kubeconfig --region us-east-1 --name jeju-mainnet-cluster
# Security policies applied via helmfile
```

## Phase 3: Contracts

**Requirements**: 3+ engineers on call, screen sharing, recording

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url https://eth.llamarpc.com \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify --watch
```

Post-deploy:
- [ ] All contracts verified on Etherscan
- [ ] Ownership → multisigs
- [ ] Test deposit completed

## Phase 4: Services

Create sealed secrets for private keys, then:

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e mainnet apply
watch kubectl get pods -n op-stack
```

## Phase 5: Validation

```bash
# Block production
cast subscribe newHeads --rpc-url http://127.0.0.1:8545

# Test deposit
cast send $OPTIMISM_PORTAL "depositTransaction(...)" \
  --value 0.001ether --rpc-url https://eth.llamarpc.com

# Monitor batcher/proposer
kubectl logs -n op-stack deployment/op-batcher -f
kubectl logs -n op-stack deployment/op-proposer -f
```

## Phase 6: Public Launch

1. DNS + SSL for rpc.jeju.network
2. Cloudflare DDoS protection + rate limiting
3. Configure PagerDuty alerts
4. Private beta (48h) with 10-20 users
5. Public announcement

## Emergency Procedures

```bash
# Pause portal (via multisig)
# app.safe.global → OptimismPortal → pause()

# Stop sequencer
kubectl scale -n op-stack deployment/op-node --replicas=0

# Stop batcher
kubectl scale -n op-stack deployment/op-batcher --replicas=0
```

## Success Criteria

- [ ] 7 days stable
- [ ] 99.9%+ uptime
- [ ] >100 users, >10k txs
- [ ] Bridge working
- [ ] No security incidents
