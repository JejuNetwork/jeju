# Monitoring

Monitoring provides the observability stack for Jeju — Prometheus for metrics collection, Grafana for dashboards, Alertmanager for alert routing, and an A2A server for agent-queryable metrics.

**URLs:** A2A at http://127.0.0.1:9091, Prometheus at http://127.0.0.1:9090, Grafana at http://127.0.0.1:3000. Production uses https://monitoring.jeju.network.

## Stack Components

The A2A server on port 9091 allows agents to query metrics programmatically. Prometheus on port 9090 collects and stores time-series metrics. Grafana on port 3000 provides dashboards and visualization. Alertmanager routes alerts to appropriate channels.

## Key Metrics

### Chain Health

`eth_block_number` tracks the current block number. `eth_block_time` measures time between blocks. `eth_pending_transactions` counts pending transactions. `eth_gas_price` tracks current gas price.

### RPC Performance

`rpc_requests_total` counts total RPC requests. `rpc_request_duration_seconds` measures request latency. `rpc_errors_total` tracks error count.

### Indexer

`indexer_blocks_processed` counts blocks indexed. `indexer_events_processed` counts events indexed. `indexer_sync_lag` measures blocks behind head.

### OIF

`oif_intents_created` counts intents created. `oif_intents_filled` counts intents filled. `oif_fill_time_seconds` measures time to fill.

## Dashboards

The Chain Overview dashboard shows block production rate, transaction throughput, gas usage, and L1 data costs.

The RPC Health dashboard shows request rate, latency percentiles, error rate, and active connections.

The Intent Tracking dashboard shows intent volume, fill rate, solver performance, and cross-chain distribution.

The Node Performance dashboard shows CPU/memory usage, disk I/O, network traffic, and sync status.

## Alerts

### Critical Alerts

BlockProductionStopped fires when there are no new blocks in 5 minutes. SequencerDown fires when the sequencer is unreachable for 1 minute.

### Warning Alerts

HighRPCLatency fires when p99 latency exceeds 0.5 seconds for 5 minutes. IndexerBehind fires when sync lag exceeds 100 blocks for 10 minutes.

## A2A Integration

Agents can query metrics via A2A:

```bash
curl -X POST http://localhost:9091/api/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task",
    "task": {
      "skill": "query",
      "parameters": {
        "query": "rate(eth_block_number[5m])",
        "time": "now"
      }
    }
  }'
```

Available skills: `query` for PromQL queries, `alerts` to get active alerts, and `targets` to get scrape targets.

## Adding Custom Metrics

```typescript
import { Counter, Histogram, register } from 'prom-client';

const requestCounter = new Counter({
  name: 'myapp_requests_total',
  help: 'Total requests',
  labelNames: ['method', 'status'],
});

const latencyHistogram = new Histogram({
  name: 'myapp_request_duration_seconds',
  help: 'Request latency',
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

// Record metrics
requestCounter.inc({ method: 'POST', status: '200' });
latencyHistogram.observe(0.125);

// Expose endpoint
app.get('/metrics', async (c) => {
  return c.text(await register.metrics());
});
```

## Setup & Configuration

Install with `cd apps/monitoring && bun install`.

### Prometheus Configuration

Configure scrape targets in `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'jeju-l2'
    static_configs:
      - targets: ['op-reth:6060']
    metrics_path: /debug/metrics/prometheus

  - job_name: 'indexer'
    static_configs:
      - targets: ['indexer:4350']
    metrics_path: /metrics

  - job_name: 'gateway'
    static_configs:
      - targets: ['gateway:4001']
    metrics_path: /metrics
```

### Environment Variables

```bash
PROMETHEUS_URL=http://localhost:9090  # Prometheus endpoint
ALERTMANAGER_URL=http://localhost:9093  # Alertmanager endpoint
MONITORING_PORT=9091  # A2A server port
```

### Running Development

```bash
# A2A server only
bun run dev

# Full stack (requires Docker)
docker-compose up
```

### Running Production

```bash
bun run build
bun run start
```

## Testing

Run unit tests with `bun test`. Run integration tests with `bun run test:integration`.

## Deployment

### Localnet

Monitoring is optional for local development. Start with `bun run dev:full` to include monitoring.

### Testnet/Mainnet

Deploy via Kubernetes using the Prometheus Operator:

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet -l component=monitoring sync
```

This deploys Prometheus, Grafana, Alertmanager, and the A2A server with pre-configured dashboards and alerts.

## Grafana Access

Local Grafana runs at http://localhost:3000 with default credentials admin/admin.

Production Grafana uses GitHub OAuth SSO at https://grafana.jeju.network.

## Troubleshooting

"Prometheus not scraping" — check targets at `curl http://localhost:9090/api/v1/targets`. Verify the target is accessible and exposing /metrics.

"Grafana dashboard missing" — reload dashboards with `curl -X POST http://admin:admin@localhost:3000/api/admin/provisioning/dashboards/reload`.

"Alerts not firing" — check Alertmanager configuration, verify the alert expression in Prometheus, and check the /alerts endpoint.
