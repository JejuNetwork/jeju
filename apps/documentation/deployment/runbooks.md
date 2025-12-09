# Runbooks

## Sequencer Down

```bash
kubectl logs deployment/op-node -n op-stack
curl -X POST http://127.0.0.1:9545 -d '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'
kubectl rollout restart deployment/op-node -n op-stack
watch kubectl get pods -n op-stack
```

## Batcher Failing

```bash
kubectl logs deployment/op-batcher -n op-stack
cast gas-price --rpc-url https://eth.llamarpc.com
curl http://eigenda:4242/health
kubectl rollout restart deployment/op-batcher
```

## Out of Gas

```bash
cast balance $BATCHER_ADDRESS --rpc-url https://eth.llamarpc.com
cast send $BATCHER_ADDRESS --value 10ether --private-key $FUNDING_KEY
```

## Node Updates

```bash
docker pull ghcr.io/paradigmxyz/op-reth:latest
helm upgrade reth ./helm/reth
kubectl rollout status deployment/reth -n execution
```

## Database Backup

```bash
kubectl exec deployment/subsquid-postgres -n indexer -- \
  pg_dump -U postgres indexer | gzip > backup-$(date +%Y%m%d).sql.gz
```
