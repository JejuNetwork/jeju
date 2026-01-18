# Monitoring

Blockchain monitoring with Prometheus and Grafana. 10 pre-configured dashboards.

## Quick Start

```bash
cd packages/monitoring
docker compose up -d
```

Access Grafana at http://localhost:4010 (admin/admin)

## Available Dashboards

### ✅ Always Working
- **System Status** - Shows monitoring health, database connection, blocks, and transactions
  - URL: http://localhost:4010/d/system-status

### 📊 Data-Dependent Dashboards
These show data when the blockchain and indexer are running:
- **Jeju Overview** - Complete system overview
- **Blockchain Activity** - Chain metrics and activity
- **Contract Activity** - Smart contract interactions
- **Accounts & Tokens** - User and token data
- **Events & Logs** - Event tracking
- **Prediction Markets** - Market activity
- **Contracts & DeFi** - DeFi metrics
- **OP Stack** - OP Stack node metrics (requires localnet)
- **Subsquid Indexer** - Indexer performance

## Data Sources

### Prometheus (http://localhost:9090)
- Monitors: OP Stack nodes, Reth, Subsquid indexer
- **Note**: Many targets will show "down" unless the full localnet stack is running
- Prometheus self-monitoring always works

### PostgreSQL (squid-db-1:5432)
- Database: `indexer`
- Shows blockchain data indexed by Subsquid
- Connected via Docker network bridge

## Expected Behavior

### When Localnet is NOT Running
- ❌ Most Prometheus metrics show "No data" (services not running)
- ✅ Database queries work (shows indexed historical data)
- ✅ System Status dashboard works

### When Localnet IS Running
- ✅ All Prometheus metrics populate
- ✅ Database shows real-time data
- ✅ All dashboards show live metrics

## Troubleshooting

### "No data" in dashboards?

1. **Check if localnet is running**:
   ```bash
   docker ps | grep -E "op-|reth|squid"
   ```

2. **Check Prometheus targets**:
   ```bash
   curl http://localhost:9090/api/v1/targets | jq -r '.data.activeTargets[] | "\(.job): \(.health)"'
   ```

3. **Check database connection**:
   ```bash
   docker exec squid-db-1 psql -U postgres -d indexer -c "SELECT COUNT(*) FROM block;"
   ```

4. **View System Status dashboard** - This always works and shows what's available:
   ```bash
   open http://localhost:4010/d/system-status
   ```

### Services showing as "Offline"?

This is normal if you're not running the full localnet stack. The monitoring system is designed to handle this gracefully.

## Development

```bash
# View logs
docker logs jeju-grafana
docker logs jeju-prometheus

# Restart services
docker restart jeju-grafana jeju-prometheus

# View Prometheus config
docker exec jeju-prometheus cat /etc/prometheus/prometheus.yml
```
