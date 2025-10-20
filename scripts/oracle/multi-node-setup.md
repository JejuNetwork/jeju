# Multi-Node Oracle Setup with Failover

## Overview

This guide covers deploying **multiple oracle bots with automatic failover** for high availability.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Base (Price Sources)              │
│     Chainlink ETH/USD + Uniswap V3 elizaOS Pools       │
└───────────────────────┬─────────────────────────────────┘
                        │
       ┌────────────────┴────────────────┐
       │                                 │
┌──────▼──────┐                   ┌─────▼──────┐
│   Bot #1    │ ◄─── Leader ───► │   Bot #2   │
│  (Leader)   │   Election       │ (Follower) │
└──────┬──────┘                   └─────┬──────┘
       │                                │
       │  ┌─────────────────────────────┘
       │  │
       ▼  ▼
┌─────────────────────────────────────────────────────────┐
│                  Jeju (Oracle)                       │
│          Only leader submits transactions               │
└─────────────────────────────────────────────────────────┘
```

**Key Features:**
- ✅ **Leader Election**: Only one bot updates at a time (no duplicate transactions)
- ✅ **Automatic Failover**: If leader dies, follower takes over in <2 minutes
- ✅ **Health Checks**: Each bot exposes /health endpoint for monitoring
- ✅ **RPC Failover**: Each bot tries multiple RPC endpoints
- ✅ **Alerting**: Telegram/Discord notifications on failures

## Deployment Options

### Option 1: Docker Compose (Recommended for VPS)

Deploy 2-3 bots on different VPS providers for true redundancy.

**Bot #1 (Primary - AWS/DigitalOcean):**
```yaml
# docker-compose.bot1.yml
version: '3.8'

services:
  oracle-bot-1:
    build:
      context: ../..
      dockerfile: scripts/oracle-updater.Dockerfile
    container_name: jeju-oracle-bot-1
    restart: unless-stopped
    environment:
      - BOT_ID=bot-1-aws
      - LEADER_ELECTION_ENABLED=true
      - HEALTH_CHECK_PORT=3001
      
      # Multiple RPC endpoints for failover
      - BASE_RPC_URLS=https://mainnet.base.org,https://base.llamarpc.com,https://base.drpc.org
      - JEJU_RPC_URLS=https://rpc.jeju.network,https://rpc-backup.jeju.network
      
      - ORACLE_ADDRESS=${ORACLE_ADDRESS}
      - ELIZAOS_TOKEN_BASE=${ELIZAOS_TOKEN_BASE}
      - PRICE_UPDATER_PRIVATE_KEY=${PRICE_UPDATER_PRIVATE_KEY}
      
      # Alerting
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
      - DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
      
    ports:
      - "3001:3001"
    volumes:
      - /tmp:/tmp  # For leader election lock file
    networks:
      - oracle-network
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"

networks:
  oracle-network:
    name: oracle-network
```

**Bot #2 (Backup - Hetzner/Vultr):**
```yaml
# docker-compose.bot2.yml
version: '3.8'

services:
  oracle-bot-2:
    build:
      context: ../..
      dockerfile: scripts/oracle-updater.Dockerfile
    container_name: jeju-oracle-bot-2
    restart: unless-stopped
    environment:
      - BOT_ID=bot-2-hetzner
      - LEADER_ELECTION_ENABLED=true
      - HEALTH_CHECK_PORT=3002
      
      # Different RPC order for redundancy
      - BASE_RPC_URLS=https://base.llamarpc.com,https://mainnet.base.org,https://base.drpc.org
      - JEJU_RPC_URLS=https://rpc-backup.jeju.network,https://rpc.jeju.network
      
      - ORACLE_ADDRESS=${ORACLE_ADDRESS}
      - ELIZAOS_TOKEN_BASE=${ELIZAOS_TOKEN_BASE}
      - PRICE_UPDATER_PRIVATE_KEY=${PRICE_UPDATER_PRIVATE_KEY}
      
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
      - DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
      
    ports:
      - "3002:3002"
    volumes:
      - /tmp:/tmp
    networks:
      - oracle-network

networks:
  oracle-network:
    name: oracle-network
```

**Deploy:**
```bash
# Server 1 (AWS)
docker-compose -f docker-compose.bot1.yml up -d

# Server 2 (Hetzner)
docker-compose -f docker-compose.bot2.yml up -d

# Check logs
docker logs -f jeju-oracle-bot-1
docker logs -f jeju-oracle-bot-2

# Check health
curl http://server1:3001/health
curl http://server2:3002/health
```

### Option 2: Systemd (Linux VPS)

Deploy on multiple Linux servers with systemd services.

**Service File:** `/etc/systemd/system/jeju-oracle-bot.service`
```ini
[Unit]
Description=Jeju Oracle Price Updater Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/jeju
ExecStart=/usr/bin/bun run scripts/oracle-updater.ts
Restart=always
RestartSec=10
StartLimitInterval=0

# Environment
Environment="BOT_ID=bot-server1"
Environment="LEADER_ELECTION_ENABLED=true"
Environment="HEALTH_CHECK_PORT=3001"

EnvironmentFile=/home/ubuntu/jeju/.env.oracle

# Security
NoNewPrivileges=true
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=jeju-oracle-bot

[Install]
WantedBy=multi-user.target
```

**Deploy:**
```bash
# Server 1
sudo cp jeju-oracle-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable jeju-oracle-bot
sudo systemctl start jeju-oracle-bot

# Check status
sudo systemctl status jeju-oracle-bot
sudo journalctl -u jeju-oracle-bot -f

# Server 2 (same steps with BOT_ID=bot-server2)
```

### Option 3: Kubernetes (Cloud/Enterprise)

Deploy on Kubernetes with automatic pod failover.

**Deployment:** `kubernetes/manifests/oracle-bot-deployment.yaml`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jeju-oracle-updater
  namespace: jeju
spec:
  replicas: 2  # 2 bots with leader election
  selector:
    matchLabels:
      app: oracle-updater
  template:
    metadata:
      labels:
        app: oracle-updater
    spec:
      containers:
      - name: oracle-bot
        image: jeju/oracle-updater:latest
        env:
        - name: BOT_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: LEADER_ELECTION_ENABLED
          value: "true"
        - name: HEALTH_CHECK_PORT
          value: "3000"
        - name: BASE_RPC_URLS
          value: "https://mainnet.base.org,https://base.llamarpc.com"
        - name: JEJU_RPC_URLS
          value: "https://rpc.jeju.network"
        envFrom:
        - secretRef:
            name: oracle-secrets
        ports:
        - containerPort: 3000
          name: health
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 60
          timeoutSeconds: 10
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: oracle-updater
  namespace: jeju
spec:
  selector:
    app: oracle-updater
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
---
apiVersion: v1
kind: Secret
metadata:
  name: oracle-secrets
  namespace: jeju
type: Opaque
stringData:
  ORACLE_ADDRESS: "0x..."
  ELIZAOS_TOKEN_BASE: "0x..."
  PRICE_UPDATER_PRIVATE_KEY: "0x..."
  TELEGRAM_BOT_TOKEN: "..."
  TELEGRAM_CHAT_ID: "..."
```

**Deploy:**
```bash
kubectl apply -f kubernetes/manifests/oracle-bot-deployment.yaml

# Check pods
kubectl get pods -n jeju

# Check logs
kubectl logs -f -n jeju deployment/jeju-oracle-updater

# Check which is leader
kubectl logs -n jeju deployment/jeju-oracle-updater | grep "became leader"
```

## Monitoring

### Health Check Endpoints

Each bot exposes:

**`GET /health`** - Health status (for load balancers)
```json
{
  "status": "healthy",
  "botId": "bot-1-aws",
  "healthy": true,
  "lastUpdate": 1704067200000,
  "consecutiveFailures": 0,
  "totalUpdates": 142,
  "uptime": 86400
}
```

**`GET /metrics`** - Detailed metrics (for Prometheus)
```json
{
  "healthy": true,
  "lastUpdate": 1704067200000,
  "consecutiveFailures": 0,
  "totalUpdates": 142,
  "uptime": 1704067200000
}
```

### Prometheus Monitoring

**`prometheus.yml`:**
```yaml
scrape_configs:
  - job_name: 'oracle-bot'
    static_configs:
      - targets:
          - 'server1:3001'
          - 'server2:3002'
```

### Grafana Dashboard

Import our pre-built dashboard: `monitoring/grafana/dashboards/oracle-bot.json`

**Key Metrics:**
- Last update time
- Update success rate
- Consecutive failures
- RPC endpoint health
- Gas prices paid
- Leader election status

## Failover Testing

### Test Scenario 1: Primary Bot Failure

```bash
# Stop primary bot
docker stop jeju-oracle-bot-1

# Watch secondary bot logs
docker logs -f jeju-oracle-bot-2

# Expected: "Bot bot-2 became leader" within 2 minutes
```

### Test Scenario 2: RPC Failover

```bash
# Block primary RPC endpoint with firewall
sudo iptables -A OUTPUT -d mainnet.base.org -j DROP

# Watch logs
docker logs -f jeju-oracle-bot-1

# Expected: "Base RPC 0 failed, trying fallback... Base switched to RPC 1"
```

### Test Scenario 3: Network Partition

```bash
# Simulate network partition (bot can't reach oracle)
sudo iptables -A OUTPUT -p tcp --dport 8545 -j DROP

# Expected: Health check fails, alerts sent, follower doesn't take over (network is down for both)
```

## Production Checklist

### Before Deployment

- [ ] Deploy to at least 2 different cloud providers (AWS + Hetzner)
- [ ] Configure 3+ RPC endpoints per chain
- [ ] Set up Telegram/Discord alerting
- [ ] Configure monitoring (Prometheus + Grafana)
- [ ] Test leader election (stop/start bots)
- [ ] Test RPC failover (block endpoints)
- [ ] Set up log aggregation (ELK/Loki)
- [ ] Create runbooks for common incidents
- [ ] Document emergency procedures
- [ ] Test manual oracle override

### Security

- [ ] Use dedicated wallet for oracle updates (low privilege)
- [ ] Store private keys in secrets manager (AWS Secrets Manager, Vault)
- [ ] Enable firewall rules (only allow necessary ports)
- [ ] Set up SSH key-only access
- [ ] Enable automatic security updates
- [ ] Set up intrusion detection (fail2ban)
- [ ] Regular security audits

### Operational

- [ ] Set up alerting (critical: 5 consecutive failures)
- [ ] Create on-call rotation
- [ ] Document escalation procedures
- [ ] Set up log retention (30 days minimum)
- [ ] Create backup of leader election state
- [ ] Test disaster recovery (all bots down)
- [ ] Monitor wallet balances (alert if <0.01 ETH)
- [ ] Schedule regular failover drills

## Troubleshooting

### Bot won't become leader

**Symptom:** Both bots show "Bot X is follower"

**Cause:** Leader lock file exists but leader is dead

**Fix:**
```bash
# Manually clear lock file
sudo rm /tmp/oracle-bot-leader.lock

# Or restart both bots
docker restart jeju-oracle-bot-1 jeju-oracle-bot-2
```

### Duplicate transactions

**Symptom:** Oracle updated twice in <1 minute

**Cause:** Leader election failed, both bots think they're leader

**Fix:**
1. Check `/tmp/oracle-bot-leader.lock` exists
2. Ensure both bots have access to same filesystem
3. If on different servers, use Redis for leader election instead

### RPC failover not working

**Symptom:** Bot fails instead of trying backup RPC

**Cause:** All RPCs in list are down

**Fix:**
1. Check all RPC endpoints manually
2. Add more RPC providers
3. Check firewall rules

## Cost Analysis

### 2-Bot Setup

**Infrastructure:**
- Server 1 (AWS t3.small): $15/month
- Server 2 (Hetzner CX11): $5/month

**Gas:**
- Updates: 288/day × $0.000015 = $0.13/month

**Total: ~$20/month** for high-availability setup

### 3-Bot Setup (Enterprise)

**Infrastructure:**
- 3 × VPS: $25/month
- Load balancer: $10/month
- Monitoring (Grafana Cloud): $15/month

**Total: ~$50/month** for enterprise-grade reliability

## Next Steps

1. Choose deployment option
2. Deploy to production
3. Set up monitoring
4. Test failover scenarios
5. Document for your team
6. Schedule regular drills

## Support

- Issues: GitHub Issues
- Chat: Discord #oracle-bot
- Urgent: On-call rotation

