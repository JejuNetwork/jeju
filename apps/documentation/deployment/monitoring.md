# Monitoring

Set up comprehensive monitoring for your Jeju deployment.

## Quick Setup

### Prometheus

```bash
# Deploy with Helm
helm install prometheus ./monitoring/prometheus/

# Access
kubectl port-forward -n monitoring svc/prometheus 9090:9090
```

### Grafana

```bash
# Deploy with Helm
helm install grafana ./monitoring/grafana/

# Access
kubectl port-forward -n monitoring svc/grafana 3000:3000
# Default: admin/admin
```

## Key Metrics to Monitor

### Chain Health
- Block production rate
- Transaction throughput
- Gas prices
- Reorg depth

### Sequencer
- Uptime
- Block proposals
- Transaction pool size
- P2P peer count

### Batcher
- Batch submission rate
- Gas costs on Base
- EigenDA health
- Failed batches

### Proposer
- State root submissions
- Challenge events
- Gas costs

## Alerting

### Critical Alerts

```yaml
# prometheus/alerts.yml
- alert: SequencerDown
  expr: up{job="sequencer"} == 0
  for: 1m
  
- alert: BatcherFailing
  expr: batcher_failed_batches > 3
  for: 5m
  
- alert: HighGasPrice
  expr: base_gas_price_gwei > 100
  for: 15m
```

### Alert Channels

- Discord webhooks
- Telegram bots
- PagerDuty
- Email

## Dashboards

Import from `monitoring/grafana/dashboards/`:
- `op-stack.json` - OP-Stack metrics
- `subsquid-overview.json` - Indexer metrics

## Resources

- [Deployment Overview](./overview.md)
- [Runbooks](./runbooks.md)


