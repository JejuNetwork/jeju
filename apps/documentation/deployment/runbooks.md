# Operational Runbooks

Step-by-step procedures for common operational scenarios.

## Incident Response

### Sequencer Down

```bash
# 1. Check logs
kubectl logs deployment/op-node -n op-stack

# 2. Check if syncing
curl -X POST http://localhost:9545 \
  -d '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'

# 3. Restart if needed
kubectl rollout restart deployment/op-node -n op-stack

# 4. Monitor recovery
watch kubectl get pods -n op-stack
```

### Batcher Failing

```bash
# 1. Check batcher logs
kubectl logs deployment/op-batcher -n op-stack

# 2. Check Base gas prices
cast gas-price --rpc-url https://mainnet.base.org

# 3. Check EigenDA
curl http://eigenda:4242/health

# 4. Restart if needed
kubectl rollout restart deployment/op-batcher
```

### Out of Gas on Base

```bash
# 1. Check batcher balance
cast balance $BATCHER_ADDRESS --rpc-url https://mainnet.base.org

# 2. Top up immediately
cast send $BATCHER_ADDRESS --value 10ether --private-key $FUNDING_KEY

# 3. Set up low balance alerts
# See monitoring/prometheus/alerts/
```

## Maintenance

### Updating Nodes

```bash
# 1. Pull new images
docker pull ghcr.io/paradigmxyz/op-reth:latest

# 2. Update deployment
helm upgrade reth ./helm/reth

# 3. Rolling update
kubectl rollout status deployment/reth -n execution
```

### Database Backups

```bash
# Backup indexer database
kubectl exec deployment/subsquid-postgres -n indexer -- \
  pg_dump -U postgres indexer | gzip > backup-$(date +%Y%m%d).sql.gz
```

## Resources

- [Deployment Overview](./overview.md)
- [Monitoring](./monitoring.md)


