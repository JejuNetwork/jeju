# Deploying Subsquid Indexer to Kubernetes

## Prerequisites

- Kubernetes cluster running
- `kubectl` configured
- Helm 3+ installed
- Container registry access (for custom images)

---

## Quick Deploy

### 1. Build and Push Images

From the indexer directory:

```bash
cd indexer

# Build processor image
docker build -f Dockerfile.k8s -t ghcr.io/jeju/indexer-processor:latest .

# Build API image (same image, different command)
docker tag ghcr.io/jeju/indexer-processor:latest ghcr.io/jeju/indexer-api:latest

# Push to registry
docker push ghcr.io/jeju/indexer-processor:latest
docker push ghcr.io/jeju/indexer-api:latest
```

### 2. Create Namespace and Secrets

```bash
# Create namespace
kubectl create namespace jeju-indexer

# Create database secret
kubectl create secret generic subsquid-db-secret \
  --from-literal=username=postgres \
  --from-literal=password=$(openssl rand -base64 32) \
  -n jeju-indexer
```

### 3. Update values.yaml

Edit `packages/deployment/kubernetes/helm/subsquid/values-testnet.yaml` or `values-mainnet.yaml`:

```yaml
processor:
  image:
    repository: ghcr.io/jeju/indexer-processor
    tag: "latest"
  
  env:
    - name: RPC_ETH_HTTP
      value: "http://reth-rpc.jeju-rpc:8545"  # Your Jeju RPC
    - name: START_BLOCK
      value: "0"

api:
  image:
    repository: ghcr.io/jeju/indexer-api
    tag: "latest"

ingress:
  enabled: true
  hosts:
    - host: indexer.jeju.network
      paths:
        - path: /
          pathType: Prefix
```

### 4. Deploy with Helm

```bash
# For testnet
helm install subsquid packages/deployment/kubernetes/helm/subsquid \
  --namespace indexer \
  --values packages/deployment/kubernetes/helm/subsquid/values-testnet.yaml

# Or use helmfile
helmfile -e testnet sync
```

### 5. Verify Deployment

```bash
# Check pods
kubectl get pods -n jeju-indexer

# Check logs
kubectl logs -f deployment/subsquid-processor -n jeju-indexer

# Check if indexing
kubectl logs deployment/subsquid-processor -n jeju-indexer | grep "Processed blocks"

# Should see:
# "Processed blocks X-Y: N blocks, M txs, P logs, Q tokens, R events, S contracts"
```

### 6. Access GraphQL API

```bash
# Port forward for testing
kubectl port-forward -n jeju-indexer svc/subsquid-api 4350:4350

# Test query
curl http://localhost:4350/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ blocks(limit: 1) { number } }"}'

# Or use ingress (if configured)
curl https://indexer.jeju.network/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ blocks(limit: 1) { number } }"}'
```

---

## Verification Checklist

After deployment, verify:

- [ ] Processor pod running
- [ ] API pods running (2 replicas)
- [ ] PostgreSQL pod running
- [ ] Processor logs show "Processed blocks..."
- [ ] Processor logs show "logs", "tokens", "events", "contracts"
- [ ] GraphQL API responds on port 4350
- [ ] Database has data (connect and check tables)
- [ ] Ingress routes to API (if configured)

---

## Troubleshooting

### Processor Not Starting

```bash
# Check logs
kubectl logs deployment/subsquid-processor -n jeju-indexer

# Check RPC connectivity
kubectl exec -it deployment/subsquid-processor -n jeju-indexer -- \
  curl http://reth-rpc.jeju-rpc:8545 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### No Data Being Indexed

```bash
# Check processor logs for errors
kubectl logs deployment/subsquid-processor -n jeju-indexer | grep -i error

# Verify RPC_ETH_HTTP is correct
kubectl get deployment subsquid-processor -n jeju-indexer -o yaml | grep RPC_ETH_HTTP
```

### API Not Responding

```bash
# Check API logs
kubectl logs deployment/subsquid-api -n jeju-indexer

# Check service
kubectl get svc subsquid-api -n jeju-indexer

# Test direct pod connection
kubectl port-forward pod/subsquid-api-xxxxx 4350:4350 -n jeju-indexer
curl http://localhost:4350/graphql
```

---

## Monitoring

Processor emits metrics on port 9090:

```yaml
# Add to values.yaml for Prometheus scraping
processor:
  service:
    annotations:
      prometheus.io/scrape: "true"
      prometheus.io/port: "9090"
      prometheus.io/path: "/metrics"
```

---

## Scaling

### Horizontal Scaling (API)

```bash
# Scale API replicas
kubectl scale deployment subsquid-api --replicas=5 -n jeju-indexer

# Or use HPA (already configured)
kubectl get hpa -n jeju-indexer
```

### Vertical Scaling (Processor)

```yaml
# Edit values.yaml
processor:
  resources:
    requests:
      memory: "4Gi"
      cpu: "2000m"
    limits:
      memory: "8Gi"
      cpu: "4000m"

# Upgrade deployment
helm upgrade subsquid /path/to/helm/subsquid \
  --namespace jeju-indexer \
  --values values-jeju.yaml
```

---

## Database Backup

```bash
# Create backup
kubectl exec deployment/subsquid-postgres -n jeju-indexer -- \
  pg_dump -U postgres indexer | gzip > backup-$(date +%Y%m%d).sql.gz

# Restore
gunzip < backup-20251015.sql.gz | \
  kubectl exec -i deployment/subsquid-postgres -n jeju-indexer -- \
  psql -U postgres indexer
```

---

## Clean Uninstall

```bash
# Remove helm release
helm uninstall subsquid -n jeju-indexer

# Remove PVCs (if you want to delete data)
kubectl delete pvc -n jeju-indexer --all

# Remove namespace
kubectl delete namespace jeju-indexer
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| RPC_ETH_HTTP | Yes | - | RPC endpoint URL |
| START_BLOCK | No | 0 | Starting block number |
| DB_HOST | Yes | - | PostgreSQL host |
| DB_PORT | No | 5432 | PostgreSQL port |
| DB_NAME | Yes | indexer | Database name |
| DB_USER | Yes | - | Database user |
| DB_PASS | Yes | - | Database password |
| GQL_PORT | No | 4350 | GraphQL API port |
| CHAIN_ID | No | 42069 | Chain ID (for metrics) |

---

## Success Criteria

Deployment is successful when:

1. ✅ All pods are `Running`
2. ✅ Processor logs show "Processed blocks..."
3. ✅ Processor logs mention "logs", "tokens", "events"
4. ✅ GraphQL API returns data
5. ✅ Database tables have rows > 0
6. ✅ No error logs

Run verification:
```bash
kubectl logs deployment/subsquid-processor -n jeju-indexer | grep "Processed blocks" | tail -5
```

Should see output like:
```
Processed blocks X-Y: 10 blocks, 1000 txs, 5000 logs, 3000 tokens, 3000 events, 200 contracts
```

If you see all these numbers, **indexing is working!** ✅

