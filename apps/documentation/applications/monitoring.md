# Monitoring

Prometheus + Grafana observability stack.

**URL**: http://127.0.0.1:4010 (Grafana)  
**Credentials**: admin / admin

## Start

```bash
cd apps/monitoring
docker compose up -d
```

## Dashboards

1. **Jeju Overview** - High-level health
2. **Blockchain Activity** - Blocks, txs, gas
3. **Contracts & DeFi** - Contract deployments
4. **Prediction Markets** - Trading volume
5. **OP Stack** - Chain infrastructure
6. **Indexer** - Subsquid health

## Data Sources

- **Prometheus** (9090): OP Stack metrics
- **PostgreSQL**: Indexed blockchain data

## Alerts

```yaml
- alert: SequencerDown
  expr: up{job="sequencer"} == 0
  severity: critical

- alert: RPCHighLatency
  expr: rpc_latency_seconds > 1
  severity: warning
```

## Resources

- ~500MB RAM
- 1GB disk/week
- 15 day retention
