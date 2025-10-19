# Common Issues & Solutions

Quick reference guide for frequently encountered issues on Jeju.

## Sequencer / Block Production Issues

### Issue: Blocks Not Being Produced

**Symptoms**: No new blocks, `eth_blockNumber` returns stale number

**Quick Check**:
```bash
kubectl get pods -n op-stack | grep op-node
kubectl logs -n op-stack deployment/op-node --tail=20
```

**Common Causes & Solutions**:

1. **L1 RPC Connection Lost**
   ```bash
   # Test L1 connection
   cast block latest --rpc-url https://mainnet.base.org

   # If fails, update RPC URL in config and restart
   kubectl edit configmap -n op-stack op-node-config
   kubectl rollout restart -n op-stack deployment/op-node
   ```

2. **Pod Restarting (OOMKilled)**
   ```bash
   # Check pod status
   kubectl describe pod -n op-stack <POD_NAME>

   # If OOMKilled, increase memory
   # Edit helm values: resources.limits.memory: "8Gi"
   helmfile -e mainnet apply
   ```

3. **Sync Issue After Long Downtime**
   ```bash
   # Clear and resync (WARNING: downtime)
   kubectl scale -n op-stack deployment/op-node --replicas=0
   kubectl delete pvc -n op-stack op-node-data
   kubectl scale -n op-stack deployment/op-node --replicas=1
   # Will re-sync from genesis or snapshot
   ```

---

### Issue: Sequencer Keeps Restarting

**Symptoms**: CrashLoopBackOff status

**Quick Check**:
```bash
kubectl describe pod -n op-stack <OP_NODE_POD>
```

**Common Causes**:

1. **Config File Error**
   - Check `rollup.json` syntax
   - Verify all required fields present
   - Compare with working testnet config

2. **Wrong Chain ID**
   - Verify chain ID matches genesis
   - Check L1 chain ID is correct (8453 for Base mainnet)

3. **Private Key Issues**
   ```bash
   # Verify secret exists
   kubectl get secret -n op-stack sequencer-key

   # Recreate if corrupted
   kubectl delete secret -n op-stack sequencer-key
   # Then recreate with sealed-secrets
   ```

---

## Batcher Issues

### Issue: Batches Not Submitting to L1

**Symptoms**: No `TransactionDeposited` events on Base for > 15 minutes

**Quick Check**:
```bash
kubectl logs -n op-stack deployment/op-batcher --tail=50
cast balance $BATCHER_ADDRESS --rpc-url https://mainnet.base.org
```

**Common Causes & Solutions**:

1. **Insufficient ETH**
   ```bash
   # Top up immediately
   cast send $BATCHER_ADDRESS --value 5ether \
     --rpc-url https://mainnet.base.org \
     --private-key $FUNDING_KEY

   # Set up balance alert (< 2 ETH)
   ```

2. **Base Gas Price Too High**
   ```bash
   # Check current gas price
   cast gas-price --rpc-url https://mainnet.base.org

   # If > 100 gwei, temporarily increase max gas price
   # Edit op-batcher values: maxGasPrice: "200"
   helmfile -e mainnet apply
   ```

3. **EigenDA Unavailable**
   ```bash
   # Check EigenDA health
   curl http://eigenda-endpoint:4242/health

   # If down, force fallback to calldata
   # Edit op-batcher values: useEigenDA: false
   # This will be more expensive but works
   ```

4. **Malformed Batch**
   ```bash
   # Check for errors in logs
   kubectl logs -n op-stack deployment/op-batcher | grep -i error

   # May indicate sequencer issue
   # Check op-node logs for invalid blocks
   ```

---

## Proposer Issues

### Issue: State Roots Not Being Proposed

**Symptoms**: No `OutputProposed` events for > 2 hours

**Quick Check**:
```bash
kubectl logs -n op-stack deployment/op-proposer --tail=50
cast balance $PROPOSER_ADDRESS --rpc-url https://mainnet.base.org
```

**Common Causes & Solutions**:

1. **Low ETH Balance**
   ```bash
   # Fund proposer
   cast send $PROPOSER_ADDRESS --value 2ether \
     --rpc-url https://mainnet.base.org \
     --private-key $FUNDING_KEY
   ```

2. **Cannot Reach Sequencer**
   ```bash
   # Test connectivity from proposer pod
   kubectl exec -n op-stack deployment/op-proposer -- \
     curl http://op-node:8547/health

   # If fails, check Kubernetes service
   kubectl get svc -n op-stack op-node
   ```

3. **Behind on Sync**
   ```bash
   # Restart proposer to re-sync
   kubectl rollout restart -n op-stack deployment/op-proposer
   ```

---

## RPC / reth Issues

### Issue: RPC Slow or Timing Out

**Symptoms**: Requests take > 1 second, timeouts, user complaints

**Quick Check**:
```bash
time cast block latest --rpc-url http://localhost:8545
kubectl top pods -n op-stack | grep reth
```

**Common Causes & Solutions**:

1. **Too Many Connections**
   ```bash
   # Check active connections
   kubectl exec -n op-stack deployment/reth -- \
     netstat -an | grep :8545 | wc -l

   # Add rate limiting on ingress
   # Edit ingress annotations:
   # nginx.ingress.kubernetes.io/rate-limit: "100"
   ```

2. **Resource Exhaustion**
   ```bash
   # Check CPU/memory
   kubectl top pods -n op-stack

   # Scale up resources
   # Edit reth values:
   # resources.limits.cpu: "8000m"
   # resources.limits.memory: "16Gi"
   ```

3. **Slow Database Queries**
   ```bash
   # Check RDS performance in AWS console
   # If needed, upgrade RDS instance type

   # Temporarily reduce load by scaling down indexer
   kubectl scale -n indexer deployment/subsquid --replicas=0
   ```

4. **Old Blocks Query**
   ```bash
   # If pruned node, old blocks not available
   # Deploy archive node for historical queries
   # Or configure read replica with longer retention
   ```

---

### Issue: RPC Returns "method not found"

**Symptoms**: Specific RPC methods failing

**Solution**:
```bash
# Check which methods are enabled
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"rpc_methods","params":[],"id":1}'

# Enable additional namespaces if needed
# Edit reth values: rpcNamespaces: ["eth", "net", "web3", "debug", "trace"]
# Note: debug/trace are resource intensive
```

---

## Bridge Issues

### Issue: Deposit Not Appearing on L2

**Symptoms**: Deposited ETH/tokens from Base but not received on Jeju

**Quick Check**:
```bash
# Get deposit transaction hash on Base
# Check if transaction succeeded on BaseScan

# Check if event was emitted
cast logs --address $OPTIMISM_PORTAL \
  --from-block <BLOCK> --to-block <BLOCK> \
  --rpc-url https://mainnet.base.org

# Check if deposit appeared in L2
cast receipt <L2_TX_HASH> --rpc-url http://localhost:8545
```

**Common Causes**:

1. **Deposit Still Pending**
   - Deposits take 5-10 minutes on mainnet
   - Check BaseScan for transaction confirmations
   - Need 64 confirmations before processed

2. **Insufficient Gas Provided**
   - Check deposit transaction on BaseScan
   - If gas limit too low, deposit may fail
   - Minimum: 100,000 gas for ETH deposit

3. **Sequencer Was Down**
   - If sequencer down when deposit processed, need to resubmit
   - Contact support with transaction hash

---

### Issue: Withdrawal Stuck in Proving Period

**Symptoms**: Initiated withdrawal but can't finalize after 7 days

**Quick Check**:
```bash
# Check withdrawal status
cast call $L2_TO_L1_MESSAGE_PASSER \
  "sentMessages(bytes32)(bool)" \
  <MESSAGE_HASH> \
  --rpc-url http://localhost:8545

# Check if output root was proposed
cast call $L2_OUTPUT_ORACLE \
  "getL2Output(uint256)" \
  <OUTPUT_INDEX> \
  --rpc-url https://mainnet.base.org
```

**Common Causes**:

1. **Fraud Proof Window Not Elapsed**
   - Need to wait 7 days on mainnet (instant on testnet)
   - Check timestamp of withdrawal initiation

2. **Withdrawal Not Proven**
   - Must call `proveWithdrawalTransaction` after 7 days
   - Then wait for finalization window
   - Then call `finalizeWithdrawalTransaction`

3. **State Root Not Proposed Yet**
   - Proposer submits roots every hour
   - May need to wait up to 1 hour after withdrawal

---

## Monitoring & Alerts

### Issue: Alerts Not Firing

**Quick Check**:
```bash
# Check Prometheus targets
kubectl port-forward -n monitoring svc/prometheus 9090:9090 &
open http://localhost:9090/targets

# Check Alertmanager
kubectl port-forward -n monitoring svc/alertmanager 9093:9093 &
open http://localhost:9093
```

**Common Causes**:

1. **Prometheus Not Scraping**
   - Check ServiceMonitor configuration
   - Verify pods have metrics endpoints
   ```bash
   kubectl get servicemonitor -n op-stack
   ```

2. **Alert Rules Not Loaded**
   ```bash
   # Check PrometheusRule resources
   kubectl get prometheusrules -n monitoring

   # Verify syntax of alert rules
   promtool check rules monitoring/prometheus/alerts.yml
   ```

3. **Alertmanager Config Error**
   ```bash
   # Check Alertmanager config
   kubectl get secret -n monitoring alertmanager-config -o yaml

   # Test webhook
   curl -X POST http://alertmanager:9093/api/v1/alerts \
     -d '[{"labels":{"alertname":"test"}}]'
   ```

---

## Database Issues

### Issue: Database Connection Errors

**Symptoms**: Pods can't connect to RDS, connection timeouts

**Quick Check**:
```bash
# Test from pod
kubectl exec -n op-stack deployment/reth -- \
  pg_isready -h $DB_HOST -U $DB_USER

# Check security group rules
# AWS Console → RDS → Security Groups
# Ensure EKS node security group can access on port 5432
```

**Solutions**:

1. **Security Group Misconfigured**
   - Add inbound rule: PostgreSQL (5432) from EKS nodes
   - Apply and wait 1 minute

2. **Connection String Wrong**
   - Verify: `postgresql://user:pass@host:5432/dbname`
   - Check secret has correct values
   ```bash
   kubectl get secret -n op-stack database-url -o yaml
   ```

3. **Database Not Available**
   - Check RDS status in AWS console
   - May be rebooting or in maintenance window

---

### Issue: Slow Database Queries

**Symptoms**: High query times, RPC slow, CPU high on RDS

**Quick Check**:
```bash
# Check RDS Performance Insights
# AWS Console → RDS → <instance> → Performance Insights

# Check active connections
# Should be < 100 typically
```

**Solutions**:

1. **Missing Indexes**
   - Review slow query log
   - Add indexes on frequently queried columns
   ```sql
   CREATE INDEX IF NOT EXISTS idx_blocks_number ON blocks(number);
   ```

2. **Too Many Connections**
   - Increase `max_connections` parameter
   - Or enable connection pooling in app

3. **Need Larger Instance**
   - Upgrade RDS instance type
   - Scale vertically: db.t3.large → db.m5.xlarge

---

## Kubernetes Issues

### Issue: Pods Stuck in Pending

**Quick Check**:
```bash
kubectl describe pod -n op-stack <POD_NAME>
```

**Common Causes**:

1. **Insufficient Resources**
   - Node doesn't have enough CPU/memory
   - Scale up node group or add nodes
   ```bash
   # Check node resources
   kubectl top nodes

   # Manually scale EKS node group in AWS console
   ```

2. **Volume Mount Issues**
   - PVC not bound
   ```bash
   kubectl get pvc -n op-stack

   # If pending, check StorageClass exists
   kubectl get storageclass
   ```

3. **Image Pull Errors**
   - Check if image exists and accessible
   ```bash
   kubectl describe pod <POD> | grep -i image

   # May need to add imagePullSecret
   ```

---

### Issue: Pod CrashLoopBackOff

**Quick Check**:
```bash
kubectl logs -n op-stack <POD_NAME> --previous
kubectl describe pod -n op-stack <POD_NAME>
```

**Common Causes**:

1. **Application Error**
   - Check logs for stack traces
   - Fix code or configuration issue

2. **Liveness Probe Failing**
   - Application may be slow to start
   - Increase `initialDelaySeconds` in probe
   ```yaml
   livenessProbe:
     initialDelaySeconds: 60  # Increase from 30
   ```

3. **Resource Limits Too Low**
   - Pod killed by OOM
   - Increase memory limits

---

## Network / Connectivity

### Issue: Cannot Reach Public RPC

**Symptoms**: External users can't reach rpc.jeju.network

**Quick Check**:
```bash
# Test from external machine
curl https://rpc.jeju.network
cast block latest --rpc-url https://rpc.jeju.network
```

**Common Causes**:

1. **DNS Not Propagated**
   - Check DNS: `dig rpc.jeju.network`
   - May take 24-48 hours for global propagation
   - Use `8.8.8.8` or `1.1.1.1` for testing

2. **Load Balancer Down**
   ```bash
   kubectl get svc -n op-stack reth-public
   # Check EXTERNAL-IP is assigned

   # If <pending>, check AWS ELB console for errors
   ```

3. **SSL Certificate Issues**
   - Check cert-manager
   ```bash
   kubectl get certificate -n op-stack

   # If not ready, check cert-manager logs
   kubectl logs -n cert-manager deployment/cert-manager
   ```

4. **Firewall / Security Group**
   - Ensure load balancer security group allows 443 from 0.0.0.0/0
   - Check AWS WAF rules if enabled

---

## Performance Optimization

### High CPU Usage

**Normal for**:
- Sequencer during high TPS
- reth during sync
- Indexer during backfill

**Reduce if problematic**:
```bash
# Lower target TPS in sequencer config
# Reduce indexer concurrency
# Add more replicas to distribute load
kubectl scale -n op-stack deployment/reth --replicas=3
```

---

### High Memory Usage

**Normal for**:
- reth (4-8 GB baseline)
- Indexer (2-4 GB)

**If abnormally high**:
- Check for memory leaks (memory always increasing)
- Restart pod to reclaim: `kubectl rollout restart deployment/reth`
- Increase limits if genuine usage increase

---

### High Disk I/O

**Causes**:
- Database queries
- Block production
- State sync

**Solutions**:
- Upgrade to faster disk (gp3 with higher IOPS)
- Enable caching
- Optimize database queries

---

## Emergency Procedures

### Complete Network Reset (Last Resort)

::: danger
This will cause extended downtime. Only use if absolutely necessary.
:::

```bash
# 1. Stop all services
kubectl scale -n op-stack deployment --all --replicas=0

# 2. Back up current state
kubectl get pvc -n op-stack
# Export PVC snapshots in AWS Console

# 3. Delete persistent volumes
kubectl delete pvc -n op-stack --all

# 4. Recreate from latest snapshot or genesis
# Re-deploy services
helmfile -e mainnet apply

# 5. Verify recovery
kubectl get pods -n op-stack
cast block latest --rpc-url http://localhost:8545
```

---

## Getting Help

### Before Contacting Support

Collect this information:
- [ ] Description of issue
- [ ] When it started
- [ ] Recent changes made
- [ ] Relevant logs (last 100 lines)
- [ ] Pod/service status
- [ ] Resource utilization metrics
- [ ] Transaction hashes (if applicable)

### Support Channels

- **Discord**: `#operator-support` - Community help
- **GitHub Issues**: Bug reports and feature requests
- **Email**: support@jeju.network - Private issues
- **OP Stack Discord**: For core OP Stack questions

### Escalation

For critical production issues:
1. Page on-call engineer via PagerDuty
2. Post in `#incidents` Discord channel
3. Email: oncall@jeju.network
4. Phone: [Emergency line]

---

## Useful Commands Reference

```bash
# Check all pod status
kubectl get pods -n op-stack -o wide

# Get logs for all replicas
kubectl logs -n op-stack -l app=op-node --tail=50

# Watch pod status
watch kubectl get pods -n op-stack

# Check resource usage
kubectl top pods -n op-stack
kubectl top nodes

# Port forward for local testing
kubectl port-forward -n op-stack svc/reth 8545:8545

# Exec into pod
kubectl exec -it -n op-stack deployment/reth -- /bin/bash

# Restart all pods
kubectl rollout restart -n op-stack deployment --all

# Check events
kubectl get events -n op-stack --sort-by='.lastTimestamp'

# Describe everything
kubectl describe all -n op-stack
```

---

## Additional Resources

- [Incident Response Runbook](./incident-response)
- [Node Operator Handbook](./node-operator-handbook)
- [Deployment Guides](/deployment/overview)
- [Monitoring Setup](/deployment/monitoring)
- [OP Stack Documentation](https://docs.optimism.io/)
