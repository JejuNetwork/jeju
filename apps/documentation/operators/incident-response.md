# Incident Response Runbook

Comprehensive procedures for responding to operational incidents on Jeju.

## Incident Severity Levels

### P0 - Critical (Page Immediately)
- Network down (no block production)
- Security breach or exploit
- Complete loss of RPC access
- Data loss or corruption

**Response Time**: < 5 minutes
**Escalation**: All hands on deck

### P1 - High (Alert Team)
- Sequencer restarting frequently
- Batcher failing to submit batches
- Proposer stuck or failing
- Bridge not processing deposits/withdrawals
- RPC degraded performance

**Response Time**: < 15 minutes
**Escalation**: On-call engineer + lead

### P2 - Medium (Monitor)
- High resource utilization (>80%)
- Elevated error rates
- Slow query performance
- Account balances low (< 2 ETH)

**Response Time**: < 1 hour
**Escalation**: On-call engineer

### P3 - Low (Scheduled)
- Minor bugs
- Documentation issues
- Performance optimizations

**Response Time**: Next business day
**Escalation**: Regular ticket

---

## P0: Network Down (No Block Production)

### Symptoms
- No new blocks for > 1 minute
- Sequencer pod CrashLoopBackOff
- RPC returns stale blocks
- Monitoring alerts firing

### Immediate Actions (< 5 minutes)

```bash
# 1. Check sequencer status
kubectl get pods -n op-stack | grep op-node

# 2. Check logs
kubectl logs -n op-stack deployment/op-node --tail=100

# 3. Check if L1 connection is down
cast block latest --rpc-url https://mainnet.base.org

# 4. Restart sequencer if needed
kubectl rollout restart -n op-stack deployment/op-node

# 5. Monitor recovery
watch kubectl get pods -n op-stack
```

### Root Cause Analysis

**Common Causes**:
1. **L1 RPC failure**: Base RPC provider down
   - **Fix**: Switch to backup RPC provider
   - **Edit**: `op-node/values.yaml` → update `l1RpcUrl`

2. **Out of memory**: Pod killed by OOM
   - **Fix**: Increase memory limits
   - **Edit**: `op-node/values.yaml` → increase `resources.limits.memory`

3. **Bad block**: Invalid block causing crash
   - **Fix**: Revert to last known good block (requires expertise)
   - **Escalate**: Contact OP Stack team

4. **Kubernetes node failure**: Node hosting pod is down
   - **Fix**: Pod should auto-reschedule to healthy node
   - **Check**: `kubectl get nodes`

### Recovery Steps

```bash
# If restart doesn't work:

# 1. Scale down to 0
kubectl scale -n op-stack deployment/op-node --replicas=0

# 2. Check persistent volumes
kubectl get pvc -n op-stack

# 3. If volume corrupted, restore from backup
# (See backup restoration section)

# 4. Scale back up
kubectl scale -n op-stack deployment/op-node --replicas=1

# 5. Verify block production
cast subscribe newHeads --rpc-url http://localhost:8545
```

### Communication Template

```
🚨 INCIDENT REPORT - Network Down

Status: Investigating
Time Detected: [TIME]
Impact: Block production stopped
Expected Resolution: [TIME]

We are actively investigating and will provide updates every 15 minutes.

Updates:
- [TIME] Issue detected
- [TIME] Root cause identified: [CAUSE]
- [TIME] Fix deployed
- [TIME] Network recovering
- [TIME] Resolved - monitoring closely

Post-mortem will be published within 48 hours.
```

---

## P0: Security Breach / Exploit

### Immediate Actions (< 2 minutes)

```bash
# 1. PAUSE ALL CONTRACTS (requires multisig)
# Via Gnosis Safe - pre-signed transaction should be ready

# 2. STOP SEQUENCER
kubectl scale -n op-stack deployment/op-node --replicas=0

# 3. STOP BATCHER (prevents L1 submission)
kubectl scale -n op-stack deployment/op-batcher --replicas=0

# 4. STOP PROPOSER
kubectl scale -n op-stack deployment/op-proposer --replicas=0

# 5. NOTIFY TEAM
# - Page all engineers
# - Contact security partners
# - Contact audit firm
```

### Do NOT

- Disclose details publicly before patched
- Restart services until root cause found
- Make any on-chain transactions that could be exploited

### Investigation Checklist

- [ ] Identify attack vector
- [ ] Assess funds at risk
- [ ] Check if exploit is ongoing
- [ ] Review recent transactions
- [ ] Check all contract balances
- [ ] Review access logs
- [ ] Identify attacker addresses

### Response Team

**Assemble within 30 minutes**:
- Technical Lead
- Security Engineer
- Smart Contract Engineer
- Legal Counsel
- PR/Communications Lead
- Audit Partner (conference call)

### Communication (After Assessment)

```
🚨 CRITICAL SECURITY INCIDENT

We have paused the Jeju network due to a potential security issue.

- All funds are currently safe
- We are investigating with our security partners
- Network will remain paused until issue is resolved
- Updates every 2 hours

DO NOT attempt any transactions until we announce resolution.

For urgent queries: security@jeju.network
```

---

## P1: Batcher Failing to Submit Batches

### Symptoms
- No `TransactionDeposited` events on Base for > 15 minutes
- Batcher logs show errors
- L2 transactions not finalizing on L1

### Diagnostic Steps

```bash
# 1. Check batcher status
kubectl logs -n op-stack deployment/op-batcher --tail=50 | grep -i error

# 2. Check batcher ETH balance
cast balance $BATCHER_ADDRESS --rpc-url https://mainnet.base.org
# If < 1 ETH, top up immediately

# 3. Check Base network status
cast block latest --rpc-url https://mainnet.base.org
# Ensure Base is not experiencing issues

# 4. Check Base gas prices
cast gas-price --rpc-url https://mainnet.base.org
# If extremely high, may need to wait or increase gas limits

# 5. Check EigenDA (if used)
curl http://eigenda-endpoint:4242/health
```

### Common Issues & Fixes

**Issue 1: Insufficient ETH Balance**
```bash
# Top up batcher address
cast send $BATCHER_ADDRESS \
  --value 5ether \
  --rpc-url https://mainnet.base.org \
  --private-key $FUNDING_KEY

# Restart batcher to pick up new balance
kubectl rollout restart -n op-stack deployment/op-batcher
```

**Issue 2: Base Network Congestion**
```bash
# Update batcher to use higher gas price
# Edit op-batcher/values.yaml
# Set: maxGasPrice: "200" # gwei
# Apply changes
helmfile -e mainnet apply

# Restart batcher
kubectl rollout restart -n op-stack deployment/op-batcher
```

**Issue 3: EigenDA Unavailable**
```bash
# If EigenDA is down, batcher should fallback to calldata
# Check batcher config for fallback settings

# If not configured, emergency update to use calldata only
# Edit op-batcher/values.yaml
# Set: useEigenDA: false
# Apply and restart
```

**Issue 4: Invalid Transaction Batch**
```bash
# This is complex - may indicate sequencer issue
# Check sequencer logs for malformed blocks

# May require rolling back to last good batch
# Escalate to core engineering team
```

### Recovery Verification

```bash
# Watch for successful batch submission
cast logs \
  --address $BATCHER_INBOX \
  --from-block latest \
  --rpc-url https://mainnet.base.org \
  -f

# Should see new TransactionDeposited events
```

---

## P1: Proposer Stuck (No State Roots)

### Symptoms
- No `OutputProposed` events on L2OutputOracle for > 2 hours
- Proposer logs show errors
- Withdrawals stuck in proving period

### Diagnostic Steps

```bash
# 1. Check proposer logs
kubectl logs -n op-stack deployment/op-proposer --tail=100

# 2. Check proposer balance
cast balance $PROPOSER_ADDRESS --rpc-url https://mainnet.base.org

# 3. Check L2OutputOracle
cast call $L2_OUTPUT_ORACLE \
  "latestOutputIndex()(uint256)" \
  --rpc-url https://mainnet.base.org

# Compare with expected output index (one per hour)

# 4. Check if proposer can compute state root
kubectl exec -n op-stack deployment/op-proposer -- \
  sh -c 'op-proposer --test-compute-root'
```

### Common Issues & Fixes

**Issue 1: Low ETH Balance**
```bash
# Fund proposer
cast send $PROPOSER_ADDRESS \
  --value 2ether \
  --rpc-url https://mainnet.base.org \
  --private-key $FUNDING_KEY
```

**Issue 2: Cannot Sync with Sequencer**
```bash
# Check if op-node is accessible from proposer pod
kubectl exec -n op-stack deployment/op-proposer -- \
  sh -c 'curl http://op-node:8547/health'

# If unreachable, check Kubernetes networking
kubectl get svc -n op-stack op-node

# Restart proposer
kubectl rollout restart -n op-stack deployment/op-proposer
```

**Issue 3: Conflicting State Root**
```bash
# Another proposer may have submitted
# Check L2OutputOracle events on BaseScan

# If legitimate proposer (not attacker):
# - Proposer will skip this output and propose next
# - Monitor to ensure it proposes next output

# If attacker:
# - EMERGENCY: Pause L2OutputOracle
# - Investigate how attacker got proposer key
# - This is P0 security incident
```

---

## P1: RPC Degraded Performance

### Symptoms
- RPC response times > 500ms
- Timeouts on `eth_call` requests
- User complaints about slow transactions
- High CPU/memory on reth pods

### Diagnostic Steps

```bash
# 1. Check reth resource usage
kubectl top pods -n op-stack | grep reth

# 2. Check active connections
kubectl exec -n op-stack deployment/reth -- \
  sh -c 'netstat -an | grep :8545 | wc -l'

# 3. Check for slow queries
kubectl logs -n op-stack deployment/reth --tail=100 | \
  grep -E "slow|timeout|error"

# 4. Test RPC response time
time cast block latest --rpc-url http://localhost:8545
```

### Immediate Actions

**If CPU/Memory High**:
```bash
# Scale up reth replicas (if multiple supported)
kubectl scale -n op-stack deployment/reth --replicas=3

# Or increase resources
# Edit reth/values.yaml
resources:
  limits:
    cpu: "8000m"
    memory: "16Gi"
  requests:
    cpu: "4000m"
    memory: "8Gi"

# Apply
helmfile -e mainnet apply
```

**If Connection Overload**:
```bash
# Enable rate limiting on ingress
# Add to ingress annotations:
nginx.ingress.kubernetes.io/rate-limit: "100"
nginx.ingress.kubernetes.io/rate-limit-window: "1m"

# Apply ingress changes
kubectl apply -f kubernetes/ingress/reth-public.yaml
```

**If Database Slow**:
```bash
# Check RDS performance
# AWS Console → RDS → Performance Insights

# If disk I/O high, may need to upgrade RDS instance

# Temporarily disable indexer if not critical
kubectl scale -n indexer deployment/subsquid --replicas=0
```

---

## P2: High Resource Utilization

### Symptoms
- CPU > 80% sustained
- Memory > 80% sustained
- Disk usage > 80%
- Network bandwidth saturated

### Actions

**High CPU**:
```bash
# Identify high CPU pods
kubectl top pods -n op-stack --sort-by=cpu

# Check if specific workload is cause
kubectl logs -n op-stack <HIGH_CPU_POD> --tail=100

# If op-node/reth:
# - May be normal during high traffic
# - Scale horizontally if possible
# - Upgrade node type if sustained

# If unexpected pod:
# - Investigate for bugs or attacks
# - May need to restart or scale down
```

**High Memory**:
```bash
# Check for memory leaks
kubectl top pods -n op-stack --sort-by=memory

# Reth typically uses 4-8GB
# If higher, may indicate leak or large state

# Restart pod to reclaim memory (if no leak)
kubectl rollout restart -n op-stack deployment/reth

# If leak confirmed, escalate to development team
```

**High Disk Usage**:
```bash
# Check disk usage per pod
kubectl exec -n op-stack deployment/reth -- df -h

# If logs filling disk:
kubectl exec -n op-stack deployment/reth -- \
  sh -c 'du -sh /var/log/*'

# Clear old logs
kubectl exec -n op-stack deployment/reth -- \
  sh -c 'find /var/log -name "*.log" -mtime +7 -delete'

# If data growing too fast:
# - Check if pruning enabled (should be)
# - May need larger volume
# - Consider archive node strategy
```

---

## Rollback Procedures

### Rollback Kubernetes Deployment

```bash
# View deployment history
kubectl rollout history deployment/op-node -n op-stack

# Rollback to previous version
kubectl rollout undo deployment/op-node -n op-stack

# Rollback to specific revision
kubectl rollout undo deployment/op-node -n op-stack --to-revision=5

# Monitor rollback
kubectl rollout status deployment/op-node -n op-stack
```

### Rollback Helm Release

```bash
# View release history
helm history op-node -n op-stack

# Rollback to previous release
helm rollback op-node -n op-stack

# Rollback to specific revision
helm rollback op-node 5 -n op-stack
```

---

## Communication Guidelines

### Internal Communication

**Slack/Discord Channels**:
- `#incidents` - All incidents logged here
- `#ops-alerts` - Automated alerts
- `#on-call` - On-call engineer coordination

**Incident Updates**:
- Update every 15 minutes for P0
- Update every 30 minutes for P1
- Include: Status, Actions Taken, Next Steps, ETA

### External Communication

**Twitter/X**:
- Post status updates for P0/P1 incidents
- Be transparent but don't reveal security details
- Provide ETA when possible

**Status Page**:
- Update status.jeju.network
- Set status: Operational, Degraded, Partial Outage, Major Outage
- Add incident updates

**Discord Community**:
- Pin announcement in `#announcements`
- Answer questions in `#support`
- Provide regular updates

### Post-Incident

**Post-Mortem Template**:

```markdown
# Incident Post-Mortem: [TITLE]

## Summary
[Brief description of what happened]

## Impact
- Duration: [TIME]
- Users affected: [NUMBER]
- Transactions failed: [NUMBER]
- Financial impact: [AMOUNT]

## Timeline
- [TIME] - Incident began
- [TIME] - Detected via [MONITORING]
- [TIME] - On-call engineer paged
- [TIME] - Root cause identified
- [TIME] - Fix deployed
- [TIME] - Incident resolved

## Root Cause
[Detailed explanation of what caused the incident]

## Resolution
[What was done to resolve it]

## Lessons Learned
### What Went Well
- [ITEM]

### What Went Wrong
- [ITEM]

### Action Items
- [ ] [ACTION] - Owner: [NAME] - Due: [DATE]
- [ ] [ACTION] - Owner: [NAME] - Due: [DATE]

## Prevention
[How we will prevent this in the future]
```

---

## Escalation Paths

### Level 1: On-Call Engineer
- First responder
- Follows runbooks
- Resolves P2/P3 independently
- Escalates P0/P1 if needed

### Level 2: Engineering Lead
- Assists with complex P1 incidents
- Makes architectural decisions
- Coordinates with multiple teams

### Level 3: CTO / Technical Co-Founder
- P0 security incidents
- Major architectural decisions
- External communications for critical incidents

### Level 4: External Partners
- Audit firm (security incidents)
- OP Labs (core OP Stack issues)
- AWS Enterprise Support (infrastructure)

---

## On-Call Procedures

### On-Call Responsibilities

**Response Times**:
- P0: < 5 minutes
- P1: < 15 minutes
- P2: < 1 hour
- P3: Next business day

**Daily Checks** (even if no alerts):
- [ ] Check Grafana dashboards
- [ ] Review error logs
- [ ] Check account balances
- [ ] Verify monitoring is working
- [ ] Test RPC endpoint
- [ ] Check Discord for user reports

### Handoff Checklist

When going off-call:
- [ ] Review all open incidents
- [ ] Update incident notes
- [ ] Brief incoming engineer (15 min call)
- [ ] Confirm incoming engineer can access all systems
- [ ] Test paging system with incoming engineer

---

## Resources

- [Common Issues Guide](./common-issues)
- [Deployment Overview](/deployment/overview)
- [Monitoring Guide](/deployment/monitoring)
- [Node Operator Handbook](./node-operator-handbook)
- [Runbooks](/deployment/runbooks)

### Emergency Contacts

- On-Call Engineer: PagerDuty
- Engineering Lead: [PHONE]
- Security Team: security@jeju.network
- OP Labs Discord: [LINK]
- AWS Support: [PHONE]

---

**Remember**: Stay calm, follow procedures, communicate clearly, and don't be afraid to escalate.
