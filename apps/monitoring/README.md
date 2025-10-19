# Jeju Monitoring Stack

🎯 **Complete blockchain monitoring with zero configuration required.**

## ⚡ Quick Start (30 seconds)

```bash
cd apps/monitoring
./start-monitoring.sh
```

Then open: **http://localhost:4010** (login: admin/admin)

**That's it!** You'll see 9 dashboards with live data from every contract on Jeju.

---

## 📊 What You Get

This monitoring stack provides real-time visibility into:
- **Blockchain Activity**: Blocks, transactions, gas usage, and network health
- **Events & Logs**: All decoded events and smart contract logs
- **Contracts & DeFi**: Contract deployments, interactions, and protocol activity
- **Prediction Markets**: Market creation, trading activity, and oracle games
- **Accounts & Tokens**: Account activity, token transfers, and NFT ownership
- **OP Stack Metrics**: Sequencer, batcher, proposer, and challenger performance
- **Indexer Performance**: Processing status, API latency, and database health

## Components

### Prometheus
- Metrics collection and storage
- Accessible at: `http://localhost:9090`
- Scrapes metrics from:
  - OP Stack components (op-node, op-batcher, op-proposer)
  - Subsquid indexer
  - PostgreSQL database
  - EigenDA disperser

### Grafana
- Data visualization and dashboards
- Accessible at: `http://localhost:4010` (default)
- Default credentials: `admin` / `admin`

## Dashboards

### 1. Jeju - Complete Overview
**Purpose**: High-level view of the entire system  
**Metrics**: Chain health, block production, transaction volume, active users, events, markets

### 2. Blockchain Activity
**Purpose**: Detailed blockchain metrics  
**Metrics**: 
- Latest block number and transaction counts
- Transactions per minute
- Gas usage and prices
- Block sizes
- Recent blocks and transactions
- Daily activity trends

### 3. Events & Logs Explorer
**Purpose**: Monitor all on-chain events  
**Metrics**:
- Total events and unique event types
- Events per minute by type
- Top event types and contracts
- Recent decoded events with arguments
- Event signature distribution
- Logs by topic

### 4. Contracts & DeFi Activity
**Purpose**: Track smart contract deployments and interactions  
**Metrics**:
- Total contracts by type (ERC20, ERC721, ERC1155, Proxy)
- Contract deployments over time
- Most active contracts
- Protocol activity by day
- Contract interaction heatmap
- Token standards breakdown

### 5. Prediction Markets
**Purpose**: Monitor Jeju's prediction market ecosystem  
**Metrics**:
- Total/active/resolved markets
- Trading volume and unique traders
- Buy vs sell trades
- Top markets by volume
- YES/NO outcome distribution
- Oracle game activity
- Recent trades and market stats

### 6. Accounts & Token Transfers
**Purpose**: Track user accounts and token movements  
**Metrics**:
- Total accounts (EOA vs Contract)
- Active accounts over time
- Token transfers by standard (ERC20, ERC721, ERC1155)
- Top token holders and active accounts
- NFT ownership distribution
- Account relationships
- Recent token transfers

### 7. OP Stack Overview
**Purpose**: Monitor OP Stack infrastructure  
**Metrics**:
- Chain health and block production rate
- Flashblocks sub-block latency
- Batcher status and pending transactions
- Proposer output roots
- Challenger activity
- P2P network metrics
- EigenDA performance
- Gas usage

### 8. Subsquid Indexer Overview
**Purpose**: Monitor indexer health and performance  
**Metrics**:
- Processing status
- Last processed block
- Database lag
- API status
- Processing rate
- API request rate and latency
- Database connections

## Setup

### Quick Start

1. **Start the monitoring stack**:
   ```bash
   cd apps/monitoring
   docker-compose up -d
   ```

2. **Access Grafana**:
   - URL: `http://localhost:4010`
   - Username: `admin`
   - Password: `admin`

3. **Configure data sources**:
   - Prometheus is auto-configured
   - PostgreSQL connection requires the indexer database to be running

### Connecting to Indexer Database

The monitoring stack connects to the Subsquid indexer's PostgreSQL database to query indexed blockchain data.

**Prerequisites**:
- Indexer database must be running (`squid-db-1` container)
- Default connection: `squid-db-1:5432/indexer`
- Credentials: `postgres` / `postgres`

**Network Configuration**:

If Grafana cannot connect to the indexer database, ensure both containers can communicate:

```bash
# Option 1: Use the same Docker network
docker network connect bridge jeju-grafana

# Option 2: Update docker-compose.yml to use external network
# (See docker-compose.yml for configuration)
```

**Testing Connection**:
```bash
# From Grafana container
docker exec -it jeju-grafana /bin/sh
# Try to ping the database
ping squid-db-1
```

### Environment Variables

Configure ports via environment variables:

```bash
export GRAFANA_PORT=4010
export PROMETHEUS_PORT=9090
```

Or create a `.env` file:
```
GRAFANA_PORT=4010
PROMETHEUS_PORT=9090
```

## Data Sources

### Prometheus
- **Type**: Prometheus
- **URL**: `http://prometheus:9090`
- **Usage**: Infrastructure metrics, OP Stack performance
- **Auto-configured**: Yes

### PostgreSQL - Indexer
- **Type**: PostgreSQL
- **Host**: `squid-db-1:5432`
- **Database**: `indexer`
- **User**: `postgres`
- **Usage**: Indexed blockchain data (blocks, transactions, events, contracts)
- **Auto-configured**: Yes (requires indexer to be running)

## Customization

### Adding New Dashboards

1. Create a new dashboard JSON file in `grafana/dashboards/`
2. Follow the naming convention: `kebab-case.json`
3. Grafana automatically loads dashboards from this directory
4. No restart required

### Modifying Dashboards

1. Make changes in Grafana UI
2. Export the dashboard as JSON
3. Save to `grafana/dashboards/`
4. Commit changes to version control

### Adding New Data Sources

1. Create a new YAML file in `grafana/provisioning/datasources/`
2. Follow the format in existing datasource files
3. Restart Grafana to apply changes

### Custom Prometheus Targets

Edit `prometheus/prometheus.yml` to add new scrape targets:

```yaml
scrape_configs:
  - job_name: 'my-service'
    static_configs:
      - targets: ['my-service:9090']
```

## Alerts

Alert rules are defined in `prometheus/alerts/`. To add new alerts:

1. Create a YAML file in `prometheus/alerts/`
2. Define alert rules following Prometheus syntax
3. Prometheus automatically loads alert rules
4. Configure alert receivers in `prometheus/prometheus.yml`

Example alert rule:
```yaml
groups:
  - name: jeju-alerts
    rules:
      - alert: HighBlockTime
        expr: increase(block[5m]) < 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Block production is slow"
```

## Troubleshooting

### Grafana shows "No Data"

**For PostgreSQL queries**:
1. Check indexer is running: `docker ps | grep squid`
2. Verify database connection in Grafana data sources
3. Check database has data: 
   ```bash
   docker exec squid-db-1 psql -U postgres -d indexer -c "SELECT COUNT(*) FROM block;"
   ```

**For Prometheus queries**:
1. Check Prometheus is scraping targets: `http://localhost:9090/targets`
2. Verify metric names in Prometheus: `http://localhost:9090/graph`
3. Check if services are exposing metrics

### Grafana cannot connect to database

```bash
# Check if containers can communicate
docker network ls
docker network inspect bridge

# Connect Grafana to indexer network
docker network connect <indexer-network> jeju-grafana
docker restart jeju-grafana
```

### Prometheus not scraping metrics

1. Check service is running and exposing metrics
2. Verify firewall/network rules
3. Check Prometheus logs: `docker logs jeju-prometheus`
4. Verify scrape config in `prometheus/prometheus.yml`

### Dashboard queries are slow

1. Add indexes to frequently queried columns
2. Reduce time range or increase refresh interval
3. Use materialized views for complex queries
4. Check database performance: `docker stats squid-db-1`

## Architecture

```
┌─────────────────┐
│   Jeju Chain    │
│   (OP Stack)    │
└────────┬────────┘
         │
         ├──► Metrics (Prometheus)
         │
         ▼
┌─────────────────┐         ┌──────────────┐
│    Subsquid     │────────►│  PostgreSQL  │
│    Indexer      │         │  (indexed    │
└────────┬────────┘         │   data)      │
         │                  └──────┬───────┘
         │                         │
         ├──► Metrics              │
         │    (Prometheus)          │
         │                         │
         ▼                         ▼
┌─────────────────┐         ┌──────────────┐
│   Prometheus    │         │   Grafana    │
│  (metrics DB)   │────────►│ (dashboards) │
└─────────────────┘         └──────────────┘
```

## Performance Considerations

- **Prometheus retention**: Default 15 days, configurable in docker-compose
- **Grafana refresh rate**: Default 30s, adjustable per dashboard
- **Database queries**: Optimized with indexes, use time filters
- **Dashboard panels**: Limit data points, use aggregation
- **Resource usage**: ~500MB RAM for full stack

## Integration with Development Workflow

### Local Development
```bash
# Start everything
bun run dev

# Monitoring stack starts automatically
# Access dashboards at http://localhost:4010
```

### Production Deployment
```bash
# Deploy monitoring stack separately
cd apps/monitoring
docker-compose -f docker-compose.yml up -d

# Configure external metrics endpoints
# Set up alerts and notifications
```

## Data Retention

- **Prometheus**: 15 days (configurable)
- **PostgreSQL**: Unlimited (indexer handles pruning)
- **Grafana**: Dashboard state persisted in volume

To increase Prometheus retention:
```yaml
# docker-compose.yml
command:
  - '--storage.tsdb.retention.time=30d'
```

## Security

- Change default Grafana password immediately
- Use environment variables for sensitive data
- Restrict network access to monitoring ports
- Enable HTTPS in production
- Use read-only database user for Grafana

## Support

For issues or questions:
- Check logs: `docker-compose logs -f`
- Prometheus: http://localhost:9090
- Grafana: http://localhost:4010

## License

Part of the Jeju blockchain project

