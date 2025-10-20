# Mainnet Deployment Checklist

Comprehensive checklist for deploying Jeju mainnet on Base.

## Overview

- **Settlement**: Base Mainnet (Chain ID: 8453)
- **Jeju Mainnet**: Chain ID 420691
- **Time**: 1-2 days
- **Difficulty**: Advanced
- **Risk**: High - Real money, real users
- **Requirements**: Significant infrastructure budget and operational costs

::: danger Security Critical
This is a production mainnet deployment. Any mistakes can result in loss of funds or network downtime. Review every step carefully and have multiple team members verify critical operations.
:::

## Pre-Deployment Requirements

### Business & Legal

- [ ] Legal entity established (LLC, Foundation, or DAO)
- [ ] Terms of Service drafted and reviewed by counsel
- [ ] Privacy Policy compliant with GDPR/CCPA
- [ ] Insurance coverage obtained ($25k-100k/year E&O insurance)
- [ ] Incident response plan documented
- [ ] On-call rotation schedule created (24/7 coverage)
- [ ] Communication plan for incidents
- [ ] Bug bounty program configured (recommend Immunefi)

### Security Audits

- [ ] **Smart contract audit completed** by reputable firm
  - Recommended: Trail of Bits, OpenZeppelin, Spearbit
  - Cost: $50k-200k
  - Timeline: 4-8 weeks
- [ ] All critical and high severity findings resolved
- [ ] Medium severity findings reviewed and accepted/resolved
- [ ] Audit report published (transparency)
- [ ] Bug bounty program live before mainnet
  - Recommend starting with $100k-1M max payout
- [ ] Penetration testing of infrastructure completed

### Testnet Validation

- [ ] Testnet running stable for **4+ weeks minimum**
- [ ] No critical bugs or incidents on testnet
- [ ] Load testing completed (target: 100 TPS)
- [ ] Bridge tested extensively (100+ deposits and withdrawals)
- [ ] All monitoring and alerting tested
- [ ] Runbooks validated through actual incidents
- [ ] Team trained on all operational procedures
- [ ] Disaster recovery procedures tested

### Financial Requirements

**Initial Capital Requirements**:
- [ ] Deployer account: Significant ETH on Base for contract deployment
- [ ] Batcher account: Substantial ETH on Base for ongoing operations
- [ ] Proposer account: ETH on Base for state root submissions
- [ ] Emergency fund: Reserve ETH on Base
- [ ] Operating reserve: Budget for initial infrastructure costs

**Monthly Operating Budget**:
- [ ] AWS EKS cluster (production-grade)
- [ ] RDS database with high availability
- [ ] Load balancers and networking
- [ ] Monitoring and alerting infrastructure
- [ ] Base settlement (L1 gas fees, variable)
- [ ] EigenDA data availability (variable)

### Team Requirements

- [ ] Minimum 3 engineers for 24/7 on-call rotation
- [ ] DevOps engineer familiar with Kubernetes
- [ ] Smart contract developer for emergency responses
- [ ] Security engineer on-call
- [ ] PagerDuty or equivalent alerting configured
- [ ] Communication channels established (Discord, Telegram, Email)
- [ ] Escalation procedures documented

### Technical Requirements

- [ ] AWS Enterprise account with support plan
- [ ] Domain registered with DNSSEC
- [ ] SSL certificates procured
- [ ] DDoS protection configured (Cloudflare recommended)
- [ ] Backup infrastructure provider identified (multi-cloud strategy)
- [ ] Hardware security modules (HSM) for key management (optional but recommended)

---

## Phase 1: Key Generation & Security Setup

### Step 1.1: Generate Production Keys

::: danger
Production private keys must NEVER be stored in plain text. Use hardware wallets or HSMs.
:::

**Recommended: Use Hardware Wallets**

For each role (Deployer, Batcher, Proposer, Sequencer):

1. Purchase Ledger or Trezor hardware wallet
2. Initialize with strong entropy
3. Generate Ethereum account
4. Write down seed phrase and store in bank safe deposit box
5. Make 2-3 copies of seed phrase, store in separate secure locations
6. Test recovery process

**Alternative: Use HSM (Enterprise)**

```bash
# If using AWS KMS or similar HSM
# Document HSM setup and key generation separately
# Ensure keys are backed up securely
```

**For Development/Testing Keys Only**:

```bash
# DO NOT USE FOR REAL MAINNET
cast wallet new
```

- [ ] Deployer key generated and secured
- [ ] Batcher key generated and secured
- [ ] Proposer key generated and secured
- [ ] Sequencer key generated and secured
- [ ] Seed phrases stored in 3+ secure locations
- [ ] Recovery process tested
- [ ] Key access documented and restricted

### Step 1.2: Configure Multisig Wallets

Use Gnosis Safe for all admin functions:

**Operations Multisig** (3-of-5, no timelock):
- Daily operations
- Pausing contracts in emergency
- Updating gas parameters

**Upgrades Multisig** (5-of-9, 48hr timelock):
- Contract upgrades
- Major parameter changes
- System config updates

**Treasury Multisig** (5-of-9):
- Fee collection address
- Fund management

```bash
# Deploy Gnosis Safe contracts
# Configure signers
# Test multisig operations on testnet first

# Save addresses:
OPERATIONS_MULTISIG=0x...
UPGRADES_MULTISIG=0x...
TREASURY_MULTISIG=0x...
```

- [ ] All multisig wallets deployed
- [ ] Signers configured and verified
- [ ] Timelock contracts deployed (for Upgrades)
- [ ] Multisig operations tested on testnet
- [ ] All signers have hardware wallets
- [ ] Signing procedures documented

### Step 1.3: Fund Accounts

**Base Mainnet ETH Required**:

```bash
# Check current ETH price and gas costs
# Adjust amounts based on current market conditions

# Minimum funding (at current ETH prices ~$3000):
# Deployer: 3.33 ETH ($10,000)
# Batcher: 10 ETH ($30,000)
# Proposer: 3.33 ETH ($10,000)
# Emergency: 3.33 ETH ($10,000)

# Verify balances
cast balance $DEPLOYER_ADDRESS --rpc-url https://mainnet.base.org
cast balance $BATCHER_ADDRESS --rpc-url https://mainnet.base.org
cast balance $PROPOSER_ADDRESS --rpc-url https://mainnet.base.org
```

**Funding Checklist**:
- [ ] Accounts funded via secure method (not exchange hot wallet)
- [ ] Transaction confirmations saved
- [ ] Balances verified on multiple explorers
- [ ] Low balance alerts configured
- [ ] Auto-refill mechanism considered (optional)

---

## Phase 2: Infrastructure Deployment

### Step 2.1: Production AWS Account Setup

- [ ] AWS Organization created
- [ ] Production account created under organization
- [ ] CloudTrail enabled (all regions)
- [ ] AWS Config enabled
- [ ] GuardDuty enabled
- [ ] Security Hub enabled
- [ ] IAM users created with MFA required
- [ ] IAM roles follow principle of least privilege
- [ ] All API keys rotated from setup
- [ ] Billing alerts configured
- [ ] Cost anomaly detection enabled

### Step 2.2: Network Architecture

```bash
cd terraform/environments/mainnet

# Review terraform configuration thoroughly
# Ensure production-grade settings:
# - Multi-AZ deployment
# - Private subnets for database
# - NAT gateways for outbound traffic
# - VPC flow logs enabled
# - Network ACLs configured

terraform init
terraform validate
terraform plan -out=mainnet.tfplan

# STOP: Have another engineer review the plan
# Review expected costs
# Review security groups
# Review all resources being created
```

- [ ] Terraform plan reviewed by 2+ engineers
- [ ] Cost estimate approved
- [ ] Security review completed
- [ ] Backup and disaster recovery plan documented
- [ ] Multi-region failover considered

### Step 2.3: Deploy Infrastructure

```bash
# This is a point of no return for infrastructure costs
# Ensure you have approval to proceed

terraform apply mainnet.tfplan

# Expected duration: 20-30 minutes
# Save all outputs securely
terraform output -json > ../../.terraform-outputs-mainnet.json

# Encrypt outputs
gpg --encrypt .terraform-outputs-mainnet.json
```

**Critical Resources Created**:
- [ ] VPC with public/private subnets across 3 AZs
- [ ] EKS cluster with auto-scaling node groups
- [ ] RDS PostgreSQL Multi-AZ instance
- [ ] Application Load Balancers
- [ ] CloudWatch Log Groups
- [ ] S3 buckets for backups
- [ ] KMS keys for encryption
- [ ] Route53 hosted zones

### Step 2.4: Database Configuration

```bash
# Enable automated backups
# Retention: 30 days minimum

# Enable encryption at rest (should be default)

# Configure slow query logs

# Enable Performance Insights

# Create read replicas (for high availability)

# Test backup restoration
```

- [ ] Database backups enabled (30 day retention)
- [ ] Encryption at rest verified
- [ ] Encryption in transit verified (SSL)
- [ ] Read replicas created
- [ ] Backup restoration tested
- [ ] Database credentials stored in AWS Secrets Manager
- [ ] Connection pooling configured

### Step 2.5: Kubernetes Hardening

```bash
# Configure kubectl
aws eks update-kubeconfig \
  --region us-east-1 \
  --name jeju-mainnet-cluster

# Enable pod security policies
kubectl apply -f kubernetes/security/pod-security-policy.yaml

# Configure network policies
kubectl apply -f kubernetes/security/network-policies.yaml

# Enable audit logging
# Enable RBAC
# Configure service accounts with minimal permissions

# Install cert-manager for TLS
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Install sealed-secrets for encrypted secrets
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/controller.yaml
```

- [ ] Pod security policies enforced
- [ ] Network policies configured
- [ ] RBAC configured
- [ ] Audit logging enabled
- [ ] Secrets encrypted at rest
- [ ] cert-manager installed
- [ ] sealed-secrets installed
- [ ] Node auto-scaling configured
- [ ] Pod disruption budgets configured

---

## Phase 3: Smart Contract Deployment

### Step 3.1: Final Security Review

**48 Hours Before Deployment**:

- [ ] All audit findings resolved
- [ ] Code freeze implemented
- [ ] Final contract code reviewed by 3+ engineers
- [ ] Test coverage verified (>90%)
- [ ] All tests passing on CI
- [ ] Deployment scripts tested on local testnet
- [ ] Deployment scripts tested on public testnet
- [ ] Deployment addresses calculated and verified
- [ ] Contract verification plan ready

### Step 3.2: Deployment Rehearsal

**24 Hours Before Deployment**:

```bash
# Deploy to a fresh local testnet that mirrors mainnet
# Use mainnet fork if possible

anvil --fork-url https://mainnet.base.org

# Run full deployment script
forge script script/Deploy.s.sol \
  --rpc-url http://localhost:8545 \
  --private-key $TEST_PRIVATE_KEY \
  --broadcast

# Verify all contracts deployed correctly
# Verify all initializations successful
# Verify contract interactions work
# Time the deployment (should complete in < 30 minutes)
```

- [ ] Rehearsal completed successfully
- [ ] Deployment time estimated
- [ ] Gas costs calculated
- [ ] All team members understand their roles
- [ ] Rollback procedures reviewed

### Step 3.3: Mainnet Contract Deployment

::: warning Critical Operation
This is the point of no return for contracts. Once deployed, contracts are immutable (unless proxies are used).
:::

**Team Requirements**:
- [ ] 3+ engineers present and on call
- [ ] All engineers on video call
- [ ] Screen sharing enabled
- [ ] Recording started (for documentation)
- [ ] Incident response team on standby

**Pre-Deployment Checklist** (15 minutes before):
- [ ] Deployer account has sufficient ETH (3+ ETH)
- [ ] Gas price is reasonable (check gasnow.org)
- [ ] Base network is stable (no outages)
- [ ] BaseScan API key ready for verification
- [ ] Communication channels ready (Discord, Twitter)

**Deployment**:

```bash
cd contracts

# Set environment variables
export DEPLOYER_PRIVATE_KEY=$(cat /secure/path/deployer.key)  # Or use hardware wallet
export RPC_URL="https://mainnet.base.org"
export ETHERSCAN_API_KEY="your_basescan_api_key"

# Final balance check
cast balance $(cast wallet address --private-key $DEPLOYER_PRIVATE_KEY) --rpc-url $RPC_URL

# DEPLOY
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --watch

# Expected duration: 15-30 minutes
# Do NOT interrupt the process
# Monitor each transaction on BaseScan

# Deployment creates:
# - OptimismPortal
# - L2OutputOracle
# - L1StandardBridge
# - L1CrossDomainMessenger
# - L1ERC721Bridge
# - SystemConfig
# - AddressManager
# - ProxyAdmin
# - All proxy contracts

# Save deployment addresses
cat deployments/mainnet-8453-latest.json
```

**Post-Deployment Verification** (immediately after):

```bash
# Verify all contracts on BaseScan
# Check: https://basescan.org/address/<CONTRACT_ADDRESS>

# Verify ownership
cast call <OPTIMISM_PORTAL> "owner()" --rpc-url $RPC_URL
# Should return OPERATIONS_MULTISIG address

# Verify initial state
cast call <L2_OUTPUT_ORACLE> "latestOutputIndex()" --rpc-url $RPC_URL
# Should return 0

# Verify system config
cast call <SYSTEM_CONFIG> "batcherHash()" --rpc-url $RPC_URL
# Should return keccak256(BATCHER_ADDRESS)

# Test deposit (small amount)
cast send <OPTIMISM_PORTAL> "depositTransaction(address,uint256,uint64,bool,bytes)" \
  $TEST_ADDRESS 1000000000000000 100000 false 0x \
  --rpc-url $RPC_URL \
  --private-key $TEST_PRIVATE_KEY \
  --value 0.001ether

# Monitor transaction on BaseScan
```

**Deployment Checklist**:
- [ ] All contracts deployed successfully
- [ ] All contracts verified on BaseScan
- [ ] Ownership transferred to multisigs
- [ ] Proxy admin controlled by upgrades multisig
- [ ] Test deposit completed successfully
- [ ] Deployment addresses saved and backed up
- [ ] Deployment transaction hashes saved
- [ ] Announcement prepared (DO NOT post yet)

---

## Phase 4: Network Initialization

### Step 4.1: Update Configuration Files

```bash
cd config

# Update chain/mainnet.json with deployed addresses
# This file is used by op-node and other services

bun run scripts/update-mainnet-config.ts

# Verify configuration
bun run config/index.test.ts

# Generate L2 genesis
cd ../scripts
bun run deploy/l2-genesis.ts --network mainnet

# Output: config/genesis/mainnet.json
# This file defines the initial state of Jeju

# Verify genesis file
jq . config/genesis/mainnet.json
```

- [ ] chain/mainnet.json updated with all contract addresses
- [ ] Configuration validated
- [ ] Genesis file generated
- [ ] Genesis validated (correct chain ID, accounts, etc.)
- [ ] Genesis committed to repository
- [ ] Genesis file backed up

### Step 4.2: Configure Kubernetes Secrets

```bash
cd kubernetes

# Create sealed secrets (encrypted secrets for Kubernetes)

# Batcher private key
echo -n "<BATCHER_PRIVATE_KEY>" | \
  kubectl create secret generic batcher-key \
  --from-file=key=/dev/stdin \
  --dry-run=client -o yaml | \
  kubeseal -o yaml > secrets/batcher-key-sealed.yaml

# Proposer private key
echo -n "<PROPOSER_PRIVATE_KEY>" | \
  kubectl create secret generic proposer-key \
  --from-file=key=/dev/stdin \
  --dry-run=client -o yaml | \
  kubeseal -o yaml > secrets/proposer-key-sealed.yaml

# Sequencer private key
echo -n "<SEQUENCER_PRIVATE_KEY>" | \
  kubectl create secret generic sequencer-key \
  --from-file=key=/dev/stdin \
  --dry-run=client -o yaml | \
  kubeseal -o yaml > secrets/sequencer-key-sealed.yaml

# Apply sealed secrets
kubectl apply -f secrets/
```

- [ ] All private keys encrypted with sealed-secrets
- [ ] Secrets applied to Kubernetes
- [ ] Secrets verified (cannot be read in plaintext)
- [ ] Original plaintext secrets securely deleted

### Step 4.3: Deploy Kubernetes Services

```bash
cd kubernetes/helmfile

# Review all Helm values for mainnet
# Ensure:
# - Correct RPC URLs
# - Correct contract addresses
# - Resource limits appropriate for mainnet load
# - Replicas set for high availability (2+ per service)

# Deploy services
helmfile -e mainnet apply

# This deploys:
# - op-node (consensus, sequencer)
# - reth (execution engine)
# - op-batcher (batch submitter)
# - op-proposer (state root proposer)
# - monitoring (Prometheus, Grafana, Loki)
# - ingress controllers
# - cert-manager for TLS

# Wait for all pods to be ready
watch kubectl get pods -n op-stack

# Expected: All pods Running within 10 minutes
```

- [ ] All Helm values reviewed and approved
- [ ] Helmfile apply completed without errors
- [ ] All pods in Running state
- [ ] No CrashLoopBackOff errors
- [ ] Logs checked for errors
- [ ] Resource utilization within expected ranges

---

## Phase 5: Network Startup

### Step 5.1: Start Sequencer (Block Production)

```bash
# Check op-node logs
kubectl logs -n op-stack deployment/op-node -f --tail=100

# Should see:
# "Sequencer started"
# "Sequencer is active"
# "Generated block #1"

# Wait for first block to be produced
# Expected: Within 2 seconds of startup

# Verify block production
kubectl port-forward -n op-stack svc/reth 8545:8545 &

cast block latest --rpc-url http://localhost:8545
# Should show block 1 or higher
```

- [ ] Sequencer started successfully
- [ ] First block produced
- [ ] Block production rate stable (~1 block/2 seconds)
- [ ] No errors in op-node logs

### Step 5.2: Start Batcher (L1 Submission)

```bash
# Check op-batcher logs
kubectl logs -n op-stack deployment/op-batcher -f --tail=100

# Should see:
# "Batcher started"
# "Submitting batch with X transactions"
# "Batch submitted successfully, tx=0x..."

# Verify on Base
# Go to BaseScan and check BATCHER_ADDRESS transactions
# Should see TransactionDeposited events every 5-10 minutes

# Monitor batcher balance
cast balance $BATCHER_ADDRESS --rpc-url https://mainnet.base.org
```

- [ ] Batcher started successfully
- [ ] First batch submitted to Base
- [ ] Batch submission rate stable
- [ ] Batcher balance sufficient (> 5 ETH)
- [ ] No errors in batcher logs

### Step 5.3: Start Proposer (State Root Submission)

```bash
# Check op-proposer logs
kubectl logs -n op-stack deployment/op-proposer -f --tail=100

# Should see:
# "Proposer started"
# "Proposing state root for block X"
# "Proposal submitted successfully, tx=0x..."

# Verify on Base
# Check L2OutputOracle contract on BaseScan
# Should see OutputProposed events every hour

# Monitor proposer balance
cast balance $PROPOSER_ADDRESS --rpc-url https://mainnet.base.org
```

- [ ] Proposer started successfully
- [ ] First output proposed to Base
- [ ] Output proposal rate stable (~1 per hour)
- [ ] Proposer balance sufficient (> 2 ETH)
- [ ] No errors in proposer logs

---

## Phase 6: Initial Network Validation

### Step 6.1: Block Production Testing

```bash
# Monitor block production for 1 hour
# Verify consistent 2-second block times

# Check block timestamps
for i in {1..30}; do
  cast block $i --rpc-url http://localhost:8545 | grep timestamp
  sleep 2
done

# Should see consistent ~2-second intervals
```

- [ ] Block production stable for 1 hour
- [ ] Block times consistent
- [ ] No missed blocks
- [ ] No sequencer restarts

### Step 6.2: Basic Transaction Testing

```bash
# Create test account
TEST_ACCOUNT=$(cast wallet new | grep "Address:" | awk '{print $2}')

# Fund via deposit from Base
cast send $OPTIMISM_PORTAL "depositTransaction(...)" \
  $TEST_ACCOUNT 1000000000000000 100000 false 0x \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --value 0.01ether

# Wait for deposit to be processed (5-10 minutes)

# Verify balance on L2
cast balance $TEST_ACCOUNT --rpc-url http://localhost:8545

# Send transaction on L2
cast send $TEST_ACCOUNT_2 --value 0.001ether \
  --rpc-url http://localhost:8545 \
  --private-key $TEST_ACCOUNT_KEY

# Deploy contract
forge create Counter \
  --rpc-url http://localhost:8545 \
  --private-key $TEST_ACCOUNT_KEY
```

- [ ] Deposits from Base working
- [ ] ETH transfers working
- [ ] Contract deployments working
- [ ] Transaction execution gas costs reasonable
- [ ] All test transactions confirmed

### Step 6.3: Load Testing (Cautious)

::: warning
Start with very low load. Ramp up gradually over days.
:::

```bash
# Day 1: 10 TPS
# Day 2: 25 TPS
# Day 3: 50 TPS
# Week 2: 100 TPS

# Use load testing tool
cd scripts/load-testing
bun run load-test.ts --rpc http://localhost:8545 --tps 10 --duration 1h

# Monitor during load test:
# - Block production remains stable
# - No increased error rates
# - CPU/memory usage acceptable
# - Network latency acceptable
```

- [ ] Load testing at 10 TPS successful
- [ ] No performance degradation
- [ ] All monitoring metrics normal

---

## Phase 7: Public Infrastructure

### Step 7.1: DNS Configuration

```bash
# Configure public RPC endpoint
# rpc.jeju.network -> Load Balancer

# Get load balancer DNS
kubectl get svc -n op-stack reth-public -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'

# Create Route53 records
# rpc.jeju.network -> CNAME -> <load-balancer-dns>
# ws.jeju.network -> CNAME -> <load-balancer-dns>
```

- [ ] DNS records created
- [ ] SSL certificates issued
- [ ] HTTPS working
- [ ] WebSocket endpoint working
- [ ] DNS propagation verified (24-48 hours)

### Step 7.2: Rate Limiting & DDoS Protection

```bash
# Configure Cloudflare (recommended)
# 1. Add jeju.network to Cloudflare
# 2. Enable DDoS protection
# 3. Configure rate limiting:
#    - 100 requests/second per IP for RPC
#    - 1000 requests/second total
# 4. Enable Web Application Firewall (WAF)
# 5. Configure caching rules

# Alternative: Use AWS WAF
# Configure in AWS Console
```

- [ ] DDoS protection enabled
- [ ] Rate limiting configured
- [ ] WAF rules configured
- [ ] Caching configured for static content
- [ ] Attack simulation tested

### Step 7.3: Monitoring & Alerting

```bash
# Configure external monitoring (uptime monitors)
# Recommended: UptimeRobot, Pingdom, or StatusPage.io

# Configure alerts via PagerDuty/OpsGenie
# Critical alerts:
# - Sequencer down (page immediately)
# - Batcher failing (page immediately)
# - Low account balances (< 1 ETH)
# - RPC downtime
# - Database connection issues

# Configure Grafana dashboards
kubectl port-forward -n monitoring svc/grafana 3000:3000 &

# Import dashboards:
# - OP Stack overview
# - Resource utilization
# - Transaction metrics
# - Error rates
```

**Critical Alerts**:
- [ ] Sequencer down alert configured (PagerDuty)
- [ ] Batcher failing alert configured
- [ ] Proposer stuck alert configured
- [ ] Low ETH balance alerts configured
- [ ] RPC downtime alert configured
- [ ] Database issues alert configured
- [ ] Disk space alerts configured
- [ ] All alerts tested

---

## Phase 8: Private Beta (48 Hours)

### Step 8.1: Invite Beta Users

**Invite List** (Recommend 10-20 trusted users):
- [ ] Team members
- [ ] Audit partners
- [ ] Close community members
- [ ] Partner projects

**Beta Requirements**:
- [ ] Whitelist addresses (if applicable)
- [ ] Provide testnet ETH via faucet
- [ ] Setup support channel (Discord/Telegram)
- [ ] Document known issues
- [ ] Create feedback form

### Step 8.2: Monitor Beta Period

**First 24 Hours**:
- [ ] Monitor all metrics constantly
- [ ] All engineers on call
- [ ] Quick response to any issues
- [ ] Collect user feedback
- [ ] No critical issues observed

**Next 24 Hours**:
- [ ] Address any issues found
- [ ] Deploy fixes if needed (test on testnet first!)
- [ ] Continue monitoring
- [ ] Prepare for public launch

**Beta Metrics**:
- [ ] Uptime: 99.9%+
- [ ] Block production: 100% (no missed blocks)
- [ ] Batcher success rate: 100%
- [ ] Proposer success rate: 100%
- [ ] User-reported issues: 0 critical, < 5 minor

---

## Phase 9: Public Launch

### Step 9.1: Pre-Launch Checklist (12 Hours Before)

- [ ] All beta testing completed successfully
- [ ] All critical issues resolved
- [ ] Monitoring dashboards ready
- [ ] Team rested and ready (no deploys after midnight!)
- [ ] Communication materials prepared
- [ ] Social media accounts ready
- [ ] Support channels staffed
- [ ] Incident response team on standby

### Step 9.2: Launch Communications

**Announcement Content** (prepare in advance):
- [ ] Blog post published
- [ ] Twitter/X announcement thread
- [ ] Discord announcement
- [ ] Telegram announcement
- [ ] Email to mailing list
- [ ] Update website with mainnet info
- [ ] Update documentation with RPC endpoints
- [ ] Update bridge UI to mainnet

**Announcement Should Include**:
- Network details (chain ID, RPC URL)
- Contract addresses (verified links)
- Bridge URL
- Explorer URL
- Known limitations
- Support channels
- Security information

### Step 9.3: Launch Day Operations

**Hour 0-1** (Immediate post-launch):
- [ ] Monitor all systems every 5 minutes
- [ ] Watch for any spikes in errors
- [ ] Monitor social media for user reports
- [ ] Respond to support requests immediately

**Hour 1-24**:
- [ ] Continue constant monitoring
- [ ] All engineers on call
- [ ] Log all incidents (even minor)
- [ ] Collect user feedback
- [ ] Monitor costs (AWS, L1 gas)

**Day 1-7**:
- [ ] Daily team meetings to review metrics
- [ ] Address any issues quickly
- [ ] Communicate proactively about any problems
- [ ] Continue 24/7 monitoring
- [ ] Prepare weekly status report

---

## Phase 10: Post-Launch Stabilization

### Week 1 Critical Monitoring

**Daily Checks**:
- [ ] Block production: 100% uptime
- [ ] Batcher: All batches submitted successfully
- [ ] Proposer: All outputs proposed successfully
- [ ] Balances: All accounts above minimum thresholds
- [ ] Bridge: Deposits and withdrawals working
- [ ] RPC: Response times < 100ms
- [ ] Database: Performance metrics normal
- [ ] Costs: Within expected range

**Daily Reports**:
- [ ] Uptime percentage
- [ ] Transaction count
- [ ] Unique users
- [ ] Total value locked
- [ ] Gas costs (L1 and L2)
- [ ] Incident summary
- [ ] User feedback summary

### Week 2-4 Operations

- [ ] Gradually reduce monitoring frequency (but maintain 24/7)
- [ ] Implement automated responses to common issues
- [ ] Optimize costs where possible
- [ ] Address user feature requests
- [ ] Plan first upgrade cycle
- [ ] Conduct post-mortem on any incidents

---

## Emergency Procedures

### Emergency Pause (Critical Issues)

If critical vulnerability or bug discovered:

```bash
# Pause the OptimismPortal (stops deposits)
# This requires operations multisig

# Via Gnosis Safe:
# 1. Go to app.safe.global
# 2. Connect to operations multisig
# 3. Navigate to New Transaction
# 4. Contract Interaction
# 5. Contract: OPTIMISM_PORTAL
# 6. Method: pause()
# 7. Submit and get required signatures
# 8. Execute

# Pause the sequencer (stops block production)
kubectl scale -n op-stack deployment/op-node --replicas=0

# Stop batcher (stops L1 submission)
kubectl scale -n op-stack deployment/op-batcher --replicas=0

# COMMUNICATE:
# 1. Post on Twitter/Discord immediately
# 2. Explain issue (if safe to disclose)
# 3. Provide timeline for resolution
# 4. Update status page
```

### Emergency Restart

```bash
# Restart sequencer
kubectl rollout restart -n op-stack deployment/op-node

# Restart batcher
kubectl rollout restart -n op-stack deployment/op-batcher

# Restart proposer
kubectl rollout restart -n op-stack deployment/op-proposer

# Monitor recovery
watch kubectl get pods -n op-stack
```

### Catastrophic Failure Response

In case of major exploit or loss of funds:

1. **Immediate** (< 5 minutes):
   - Pause all contracts
   - Stop sequencer
   - Post holding statement on social media

2. **Hour 1**:
   - Assess damage
   - Assemble full team + security experts
   - Contact audit partners
   - Contact insurance provider
   - Contact legal counsel

3. **Hour 1-24**:
   - Investigate root cause
   - Determine if funds are recoverable
   - Prepare detailed incident report
   - Communicate updates every 6 hours
   - Coordinate with exchanges if needed

4. **Day 1-7**:
   - Implement fix
   - Test thoroughly
   - Audit fix
   - Prepare recovery plan
   - Publish post-mortem

5. **Week 2+**:
   - Execute recovery
   - Resume operations (if possible)
   - Implement additional safeguards
   - Enhance monitoring
   - Review insurance claims

---

## Success Criteria

### Launch Success

- [ ] Network running for 7 days without critical incidents
- [ ] 99.9%+ uptime
- [ ] >100 unique users
- [ ] >10,000 transactions processed
- [ ] Bridge working reliably (50+ successful deposits/withdrawals)
- [ ] No security incidents
- [ ] Costs within budget
- [ ] Positive community feedback

### 30-Day Success

- [ ] 99.95%+ uptime
- [ ] >1,000 unique users
- [ ] >100,000 transactions processed
- [ ] <5 minor incidents (all resolved quickly)
- [ ] 0 critical incidents
- [ ] Community growing
- [ ] Revenue > costs (if monetized)

---

## Cost Tracking

### Daily Operational Items

| Item | Type | Notes |
|------|------|-------|
| AWS EKS | Infrastructure | Kubernetes cluster |
| AWS RDS | Database | PostgreSQL with HA |
| AWS Networking | Infrastructure | Load balancers, NAT gateways |
| Base Gas (Batcher) | Variable | Batch submission fees |
| Base Gas (Proposer) | Variable | State root posting fees |
| EigenDA | Variable | Data availability |

### Monthly Budget Considerations

Monitor and track:
- Infrastructure costs
- L1 settlement fees
- Data availability costs
- Monitoring and tools
- Contingency buffer

---

## Documentation & Handoff

### Required Documentation

- [ ] Deployment summary document (all addresses, configs, keys)
- [ ] Architecture diagrams (updated with actual infrastructure)
- [ ] Runbook for common operations
- [ ] Incident response procedures
- [ ] Key management procedures
- [ ] Backup and recovery procedures
- [ ] Cost optimization guide
- [ ] Monitoring guide

### Knowledge Transfer

- [ ] All team members trained
- [ ] On-call rotation confirmed
- [ ] Access credentials distributed (securely)
- [ ] Communication channels tested
- [ ] Escalation procedures understood

---

## Final Sign-Off

**Before considering deployment complete**:

- [ ] All checklist items completed
- [ ] Network stable for 7+ days
- [ ] No critical open issues
- [ ] Team confident in operations
- [ ] Community satisfied
- [ ] Documentation complete
- [ ] Business metrics met

**Sign-Off**:
- Technical Lead: _____________________ Date: _____
- Security Lead: _____________________ Date: _____
- Operations Lead: ___________________ Date: _____
- CEO/Founder: ______________________ Date: _____

---

## Resources

- [Deployment Overview](./overview)
- [Prerequisites](./prerequisites)
- [Testnet Checklist](./testnet-checklist)
- [Infrastructure Guide](./infrastructure)
- [Monitoring Setup](./monitoring)
- [Runbooks](./runbooks)
- [Incident Response](/operators/incident-response)
- [Common Issues](/operators/common-issues)

---

**Deployment Time**: 1-2 days (excluding audits and testing)
**Total Time to Launch**: 2-3 months (including audits, testing, preparation)
**Budget**: Significant infrastructure, capital, and audit costs required
**Risk Level**: High - requires expert team and comprehensive preparation
