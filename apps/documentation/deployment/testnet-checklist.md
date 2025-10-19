# Testnet Deployment Checklist

Complete checklist for deploying Jeju testnet on Base Sepolia.

## Overview

- **Settlement**: Base Sepolia (Chain ID: 84532)
- **Jeju Testnet**: Chain ID 420690
- **Time**: 2-4 hours
- **Difficulty**: Intermediate

## Prerequisites Checklist

### Required Accounts & Access

- [ ] AWS account with billing configured
- [ ] Base Sepolia ETH (at least 0.5 ETH on deployer account)
- [ ] Domain name registered (optional but recommended)
- [ ] GitHub account with repository access
- [ ] Docker Desktop installed (for local testing)

### Required Tools

- [ ] Terraform v1.5+ installed
- [ ] AWS CLI configured with credentials
- [ ] Foundry (forge) installed and updated
- [ ] kubectl installed
- [ ] Helmfile installed
- [ ] Bun runtime installed
- [ ] Git configured

### Required Keys & Credentials

- [ ] AWS Access Key ID and Secret Access Key
- [ ] Deployer private key (funded with Base Sepolia ETH)
- [ ] Batcher private key (funded with ~0.2 ETH)
- [ ] Proposer private key (funded with ~0.1 ETH)
- [ ] Sequencer private key (for signing blocks)

---

## Phase 1: Pre-Deployment Preparation

### Step 1.1: Generate Deployment Keys

```bash
# Generate keys using cast (Foundry)
cd scripts

# Deployer account
cast wallet new
# Save: DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY

# Batcher account
cast wallet new
# Save: BATCHER_ADDRESS, BATCHER_PRIVATE_KEY

# Proposer account
cast wallet new
# Save: PROPOSER_ADDRESS, PROPOSER_PRIVATE_KEY

# Sequencer account
cast wallet new
# Save: SEQUENCER_ADDRESS, SEQUENCER_PRIVATE_KEY
```

**Security**: Store private keys in password manager or hardware wallet. Never commit to git.

### Step 1.2: Fund Accounts

```bash
# Fund deployer (needs most ETH for contract deployment)
# Request from Base Sepolia faucet or transfer from existing account
# Minimum: 0.5 ETH

# Fund batcher (posts transaction batches to L1)
# Minimum: 0.2 ETH

# Fund proposer (posts state roots to L1)
# Minimum: 0.1 ETH

# Verify balances
cast balance $DEPLOYER_ADDRESS --rpc-url https://sepolia.base.org
cast balance $BATCHER_ADDRESS --rpc-url https://sepolia.base.org
cast balance $PROPOSER_ADDRESS --rpc-url https://sepolia.base.org
```

- [ ] Deployer funded with 0.5+ ETH
- [ ] Batcher funded with 0.2+ ETH
- [ ] Proposer funded with 0.1+ ETH

### Step 1.3: Configure Environment

Create `config/deploy-configs/testnet.json` based on mainnet template:

```bash
cd config/deploy-configs
cp mainnet.json testnet.json
```

Edit testnet.json with your addresses:

```json
{
  "chainId": 420690,
  "deployerAddress": "YOUR_DEPLOYER_ADDRESS",
  "batcherAddress": "YOUR_BATCHER_ADDRESS",
  "proposerAddress": "YOUR_PROPOSER_ADDRESS",
  "sequencerAddress": "YOUR_SEQUENCER_ADDRESS",
  "l1ChainId": 84532,
  "l1RpcUrl": "https://sepolia.base.org"
}
```

- [ ] Config file created and validated
- [ ] All addresses filled in
- [ ] JSON syntax valid (check with `jq . testnet.json`)

---

## Phase 2: Infrastructure Deployment (Terraform)

### Step 2.1: Configure AWS Credentials

```bash
# Configure AWS CLI
aws configure
# Enter: AWS Access Key ID, Secret Access Key, Region (us-east-1), Output format (json)

# Verify
aws sts get-caller-identity
```

- [ ] AWS CLI configured
- [ ] IAM user has admin permissions (or EKS/RDS/VPC permissions)

### Step 2.2: Initialize Terraform Backend

```bash
cd terraform/environments/testnet

# Initialize
terraform init

# Validate configuration
terraform validate

# Plan (review changes)
terraform plan -out=tfplan
```

Review the plan carefully. It should create:
- VPC with public/private subnets
- EKS cluster
- RDS PostgreSQL instance
- Load balancers
- Security groups

- [ ] Terraform initialized successfully
- [ ] Plan reviewed and approved
- [ ] No unexpected resources being created/destroyed

### Step 2.3: Deploy Infrastructure

```bash
# Apply the plan
terraform apply tfplan

# This takes 15-20 minutes
# Watch for errors

# Save outputs
terraform output -json > ../../../.terraform-outputs-testnet.json
```

**Important Outputs:**
- `eks_cluster_endpoint`
- `eks_cluster_name`
- `rds_endpoint`
- `vpc_id`

- [ ] Terraform apply completed without errors
- [ ] EKS cluster created
- [ ] RDS instance available
- [ ] Outputs saved

### Step 2.4: Configure kubectl

```bash
# Get kubeconfig
aws eks update-kubeconfig \
  --region us-east-1 \
  --name jeju-testnet-cluster

# Verify
kubectl get nodes
# Should show 2-3 nodes in Ready state

# Create namespaces
kubectl create namespace op-stack
kubectl create namespace monitoring
```

- [ ] kubectl configured for cluster
- [ ] Cluster nodes ready
- [ ] Namespaces created

---

## Phase 3: Smart Contract Deployment

### Step 3.1: Deploy L1 Contracts to Base Sepolia

```bash
cd contracts

# Set environment variables
export DEPLOYER_PRIVATE_KEY="your_deployer_private_key"
export RPC_URL="https://sepolia.base.org"
export ETHERSCAN_API_KEY="your_basescan_api_key"  # Optional for verification

# Deploy contracts
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify

# Save deployment addresses
# Addresses will be printed and saved to: deployments/testnet-84532-latest.json
```

**Critical Contracts** (verify addresses):
- OptimismPortal
- L2OutputOracle
- L1StandardBridge
- L1CrossDomainMessenger
- SystemConfig

- [ ] Deployment script completed
- [ ] All contracts deployed successfully
- [ ] Contracts verified on BaseScan
- [ ] Deployment JSON saved

### Step 3.2: Update Chain Configuration

```bash
cd config/chain

# Update testnet.json with deployed contract addresses
bun run scripts/update-testnet-config.ts

# Validate configuration
bun run config/index.test.ts
```

Edit `config/chain/testnet.json` with deployed addresses from previous step.

- [ ] testnet.json updated with contract addresses
- [ ] Configuration tests pass

### Step 3.3: Generate Genesis File

```bash
cd scripts

# Generate L2 genesis
bun run deploy/l2-genesis.ts --network testnet

# Output: config/genesis/testnet.json
```

- [ ] Genesis file generated
- [ ] Genesis validated (no errors)

---

## Phase 4: Kubernetes Services Deployment

### Step 4.1: Configure Helm Values

```bash
cd kubernetes/helm

# Update op-node/values-testnet.yaml
# Set:
# - L1 RPC URL
# - Rollup config path
# - Sequencer key

# Update values for all services:
# - op-node
# - reth (execution client)
# - op-batcher
# - op-proposer
```

Edit files:
- `op-node/values-testnet.yaml`
- `reth/values-testnet.yaml`
- `op-batcher/values-testnet.yaml`
- `op-proposer/values-testnet.yaml`

- [ ] All values files updated
- [ ] Private keys stored as Kubernetes secrets (not in values files!)

### Step 4.2: Deploy Services with Helmfile

```bash
cd kubernetes/helmfile

# Deploy all services
helmfile -e testnet sync

# This deploys:
# - op-node (consensus layer)
# - reth (execution layer)
# - op-batcher (transaction batcher)
# - op-proposer (state root proposer)
# - monitoring (Prometheus, Grafana)

# Wait for pods to be ready (5-10 minutes)
watch kubectl get pods -n op-stack
```

- [ ] All pods deployed
- [ ] All pods in Running state
- [ ] No CrashLoopBackOff errors

### Step 4.3: Verify Services

```bash
# Check op-node logs
kubectl logs -n op-stack deployment/op-node -f

# Should see:
# "Sequencer started"
# "Syncing with L1"

# Check reth logs
kubectl logs -n op-stack deployment/reth -f

# Should see:
# "Listening on 0.0.0.0:8545"
# "Blocks imported"

# Test RPC endpoint
kubectl port-forward -n op-stack svc/reth 8545:8545 &

cast block latest --rpc-url http://localhost:8545
# Should return block 0 or 1

# Test websocket
cast subscribe newHeads --rpc-url ws://localhost:8545
```

- [ ] op-node syncing blocks
- [ ] reth accepting RPC requests
- [ ] op-batcher submitting batches to L1
- [ ] op-proposer posting state roots
- [ ] No errors in logs

---

## Phase 5: Network Testing & Validation

### Step 5.1: Basic Functionality Tests

```bash
cd scripts

# Run localnet tests against testnet
export TESTNET_RPC="https://testnet-rpc.jeju.network"  # Or use port-forward

bun run tests/integration/runtime-full-stack.test.ts
```

**Manual Tests:**

1. **Block Production**
```bash
# Watch blocks being produced
cast subscribe newHeads --rpc-url $TESTNET_RPC
# Should see new blocks every 2 seconds
```

2. **ETH Transfer**
```bash
# Create test account
cast wallet new

# Fund from deployer
cast send <TEST_ADDRESS> --value 0.1ether \
  --rpc-url $TESTNET_RPC \
  --private-key $DEPLOYER_PRIVATE_KEY

# Verify balance
cast balance <TEST_ADDRESS> --rpc-url $TESTNET_RPC
```

3. **Contract Deployment**
```bash
# Deploy simple contract
forge create Counter \
  --rpc-url $TESTNET_RPC \
  --private-key $DEPLOYER_PRIVATE_KEY
```

- [ ] Blocks producing consistently
- [ ] ETH transfers working
- [ ] Contract deployments working
- [ ] Gas prices reasonable

### Step 5.2: Bridge Testing

```bash
cd scripts

# Test deposit (L1 → L2)
bun run bridge/test-deposit.ts --network testnet --amount 0.01

# Wait for finalization (5-10 minutes on testnet)

# Test withdrawal (L2 → L1)
bun run bridge/test-withdrawal.ts --network testnet --amount 0.005

# Prove and finalize withdrawal after 7 days on mainnet (instant on testnet for testing)
```

- [ ] Deposits from Base Sepolia to Jeju testnet working
- [ ] Withdrawals from Jeju to Base Sepolia working
- [ ] Bridge events emitted correctly

### Step 5.3: Settlement Verification

```bash
# Check that batches are being posted to L1
cast logs \
  --address <BATCHER_INBOX_ADDRESS> \
  --rpc-url https://sepolia.base.org

# Check state root proposals
cast logs \
  --address <L2_OUTPUT_ORACLE_ADDRESS> \
  --rpc-url https://sepolia.base.org

# Should see regular TransactionDeposited and OutputProposed events
```

- [ ] Batcher posting batches to L1 (every 5-10 minutes)
- [ ] Proposer posting state roots to L1 (every hour)
- [ ] L1 gas costs reasonable

---

## Phase 6: Monitoring & Observability

### Step 6.1: Deploy Monitoring Stack

Already deployed in Phase 4, but verify:

```bash
# Port-forward Grafana
kubectl port-forward -n monitoring svc/grafana 3000:3000 &

# Port-forward Prometheus
kubectl port-forward -n monitoring svc/prometheus 9090:9090 &

# Open Grafana
open http://localhost:3000
# Default: admin / admin

# Import dashboards from kubernetes/helm/monitoring/dashboards/
```

- [ ] Grafana accessible
- [ ] Prometheus scraping metrics
- [ ] Dashboards showing data

### Step 6.2: Configure Alerts

```bash
cd kubernetes/helm/monitoring

# Edit prometheus/alerts.yml
# Configure alerting channels (Discord, PagerDuty, etc.)

# Apply changes
helmfile -e testnet apply
```

Set up alerts for:
- [ ] Sequencer down
- [ ] Batcher failing
- [ ] Proposer stuck
- [ ] RPC unavailable
- [ ] Low L1 gas on batcher/proposer accounts

### Step 6.3: Set Up Public RPC (Optional)

```bash
# Expose RPC via load balancer
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: reth-public
  namespace: op-stack
spec:
  type: LoadBalancer
  selector:
    app: reth
  ports:
    - name: http
      port: 80
      targetPort: 8545
    - name: ws
      port: 443
      targetPort: 8546
EOF

# Get load balancer URL
kubectl get svc -n op-stack reth-public
# Use EXTERNAL-IP as your public RPC endpoint
```

- [ ] Public RPC endpoint available
- [ ] Rate limiting configured
- [ ] DDoS protection enabled (Cloudflare or AWS WAF)

---

## Phase 7: Documentation & Handoff

### Step 7.1: Document Deployment

Create `deployments/testnet-YYYYMMDD.md`:

```markdown
# Jeju Testnet Deployment - [DATE]

## Network Details
- Chain ID: 420690
- RPC URL: https://testnet-rpc.jeju.network
- Explorer: https://testnet-explorer.jeju.network
- Bridge: https://testnet-bridge.jeju.network

## Contract Addresses (Base Sepolia)
- OptimismPortal: 0x...
- L2OutputOracle: 0x...
- L1StandardBridge: 0x...
[etc.]

## Infrastructure
- AWS Region: us-east-1
- EKS Cluster: jeju-testnet-cluster
- RDS Instance: jeju-testnet-db

## Keys & Accounts
- Deployer: 0x...
- Batcher: 0x...
- Proposer: 0x...
- Sequencer: 0x...

## Monitoring
- Grafana: [URL]
- Prometheus: [URL]
- Logs: [URL]

## Known Issues
- [List any issues or workarounds]

## Runbook Links
- [Incident Response](/documentation/operators/incident-response.md)
- [Common Issues](/documentation/operators/common-issues.md)
```

- [ ] Deployment documented
- [ ] All addresses recorded
- [ ] Access credentials shared with team (securely)

### Step 7.2: Update Public Documentation

```bash
cd apps/documentation

# Update testnet.md with new addresses
# Update network/testnet.md with RPC URLs

# Commit changes
git add .
git commit -m "docs: update testnet deployment info"
git push
```

- [ ] Public docs updated
- [ ] RPC endpoints added to docs
- [ ] Bridge UI updated
- [ ] Explorer updated

---

## Phase 8: Post-Deployment Monitoring

### Week 1 Checklist

- [ ] Monitor for 24 hours: No crashes or restarts
- [ ] Check batcher balance daily: Top up if < 0.05 ETH
- [ ] Check proposer balance daily: Top up if < 0.02 ETH
- [ ] Verify state root proposals happening every hour
- [ ] Verify batches posting every 5-10 minutes
- [ ] Test bridge deposits and withdrawals daily
- [ ] Check Grafana dashboards for anomalies
- [ ] Review error logs daily

### Week 2-4 Checklist

- [ ] Run full test suite weekly
- [ ] Monitor block production rate (should be consistent)
- [ ] Check L1 settlement costs (should be ~$50-100/day)
- [ ] Test failover scenarios (what if op-node crashes?)
- [ ] Gather feedback from early users
- [ ] Document any issues and resolutions
- [ ] Plan for mainnet deployment

---

## Rollback Procedures

### If Deployment Fails at Phase 2 (Infrastructure)

```bash
cd terraform/environments/testnet

# Destroy infrastructure
terraform destroy

# Fix issues, then re-deploy
terraform apply
```

### If Deployment Fails at Phase 3 (Contracts)

Contracts are immutable once deployed. Options:
1. Deploy new set of contracts (new addresses)
2. Use contract proxies for upgradeability (if implemented)
3. Start over with new configuration

### If Deployment Fails at Phase 4 (Kubernetes)

```bash
cd kubernetes/helmfile

# Destroy all releases
helmfile -e testnet destroy

# Fix values files
# Re-deploy
helmfile -e testnet sync
```

### Emergency Shutdown

```bash
# Stop sequencer (stops block production)
kubectl scale -n op-stack deployment/op-node --replicas=0

# Stop batcher (stops L1 batch submission)
kubectl scale -n op-stack deployment/op-batcher --replicas=0

# Stop proposer (stops state root posting)
kubectl scale -n op-stack deployment/op-proposer --replicas=0
```

---

## Troubleshooting Common Issues

### Issue: Pods stuck in CrashLoopBackOff

**Cause**: Usually config errors or missing secrets

**Solution**:
```bash
# Check pod logs
kubectl logs -n op-stack <POD_NAME>

# Check pod events
kubectl describe pod -n op-stack <POD_NAME>

# Common fixes:
# 1. Wrong RPC URL
# 2. Missing private key
# 3. Incorrect genesis config
```

### Issue: op-node not syncing

**Cause**: L1 connection issues or wrong rollup config

**Solution**:
```bash
# Test L1 RPC
cast block latest --rpc-url https://sepolia.base.org

# Check op-node config
kubectl get configmap -n op-stack op-node-config -o yaml

# Restart op-node
kubectl rollout restart -n op-stack deployment/op-node
```

### Issue: Batcher running out of gas

**Cause**: High L1 gas prices or insufficient balance

**Solution**:
```bash
# Check batcher balance
cast balance $BATCHER_ADDRESS --rpc-url https://sepolia.base.org

# Top up
cast send $BATCHER_ADDRESS --value 0.1ether \
  --rpc-url https://sepolia.base.org \
  --private-key $FUNDING_KEY
```

### Issue: State root proposals not appearing on L1

**Cause**: Proposer not running or insufficient gas

**Solution**:
```bash
# Check proposer logs
kubectl logs -n op-stack deployment/op-proposer -f

# Check proposer balance
cast balance $PROPOSER_ADDRESS --rpc-url https://sepolia.base.org

# Restart proposer
kubectl rollout restart -n op-stack deployment/op-proposer
```

---

## Final Checklist

### Before Announcing Testnet

- [ ] All services running smoothly for 48 hours
- [ ] Block production consistent
- [ ] Bridge working in both directions
- [ ] Monitoring and alerts configured
- [ ] Documentation complete and published
- [ ] Team trained on operations
- [ ] Runbooks tested
- [ ] Emergency procedures documented
- [ ] Backup plan in place

### Resources

- [Deployment Overview](./overview)
- [Prerequisites](./prerequisites)
- [Infrastructure Setup](./infrastructure)
- [Monitoring Guide](./monitoring)
- [Runbooks](./runbooks)
- [Node Operator Handbook](/operators/node-operator-handbook)

### Support

- Discord: [#testnet-support](https://discord.gg/jeju)
- GitHub Issues: [elizaos/jeju](https://github.com/elizaos/jeju/issues)
- Email: testnet@jeju.network

---

**Deployment Time**: 2-4 hours for experienced operators
**Infrastructure**: AWS services required plus L1 gas for settlement
**Difficulty**: Intermediate - requires DevOps and blockchain knowledge
