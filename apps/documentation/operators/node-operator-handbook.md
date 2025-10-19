# Jeju Node Operator Handbook

Complete guide to running, maintaining, and earning rewards from Jeju nodes.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Monitoring](#monitoring)
5. [Maintenance](#maintenance)
6. [Rewards Program](#rewards-program)
7. [Troubleshooting](#troubleshooting)
8. [Best Practices](#best-practices)

---

## Getting Started

### What is a Node Operator?

As a Jeju node operator, you:
- Run RPC infrastructure for the network
- Serve JSON-RPC requests to users and dApps
- Earn rewards for uptime and performance
- Contribute to network decentralization

### Why Run a Node?

**🎁 Earn Rewards**
- Earn JEJU tokens for operating nodes
- Based on uptime, performance, and geographic location
- Additional volume bonuses for high-traffic nodes

**🌍 Support Decentralization**
- Help make Jeju truly decentralized
- Reduce reliance on centralized providers
- Improve network resilience

**🚀 Technical Skills**
- Learn blockchain infrastructure
- Understand L2/L3 technology
- Join a community of operators

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 8 cores | 16 cores |
| **RAM** | 16 GB | 32 GB |
| **Storage** | 500 GB SSD | 1 TB NVMe SSD |
| **Network** | 100 Mbps | 1 Gbps |
| **Bandwidth** | 5 TB/month | 10 TB/month |

### Operating Considerations

**Cloud Hosting:**
- Standard node: Moderate monthly infrastructure costs
- Archive node: Higher costs due to storage and compute requirements

**Bare Metal:**
- Lower monthly costs after initial hardware investment
- Requires technical setup and maintenance

**Rewards:**
- Earn JEJU tokens for reliable operation
- Amount varies based on uptime, performance, and location

---

## Installation

### One-Command Install

The easiest way to get started:

```bash
curl -fsSL https://raw.githubusercontent.com/elizaos/jeju/main/scripts/install-node.sh | bash
```

This will:
✅ Install Docker and dependencies
✅ Download network configs
✅ Generate JWT secret
✅ Create docker-compose.yml
✅ Set up monitoring
✅ Download snapshot (optional)
✅ Create helper scripts

### Manual Installation

If you prefer to install manually:

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Clone repository
git clone https://github.com/elizaos/jeju.git
cd jeju

# 3. Configure
mkdir -p ~/.jeju/{data,config,logs}
cd ~/.jeju

# 4. Generate JWT secret
openssl rand -hex 32 > config/jwt-secret.txt

# 5. Download configs
curl -fsSL https://raw.githubusercontent.com/elizaos/jeju/main/config/rollup/mainnet.json \
  -o config/rollup.json

# 6. Create docker-compose.yml (see full config below)

# 7. Start node
docker-compose up -d
```

### Using Snapshots

Snapshots dramatically reduce sync time from days to hours:

```bash
# Download and apply latest snapshot
curl -fsSL https://raw.githubusercontent.com/elizaos/jeju/main/scripts/snapshots/download-snapshot.sh | bash
```

Or manually:

```bash
cd ~/.jeju
wget https://snapshots.jeju.network/mainnet-full-latest.tar.gz
tar -xzf mainnet-full-latest.tar.gz -C data/
docker-compose up -d
```

---

## Configuration

### Network Selection

**Mainnet (Production):**
```bash
export JEJU_NETWORK=mainnet
# RPC: https://rpc.jeju.network
# Chain ID: 420691
```

**Testnet (Testing):**
```bash
export JEJU_NETWORK=testnet
# RPC: https://testnet-rpc.jeju.network
# Chain ID: 420690
```

### Node Types

**Full Node (Pruned):**
- Stores ~500 GB of data
- Can serve all recent queries
- Recommended for most operators
- Lower hardware requirements

**Archive Node:**
- Stores complete history
- 2+ TB storage required
- Can serve historical queries
- Higher rewards potential

### Ports

Ensure these ports are open:

| Port | Protocol | Purpose |
|------|----------|---------|
| 8545 | TCP | HTTP RPC |
| 8546 | TCP | WebSocket RPC |
| 30303 | TCP/UDP | P2P networking |
| 9001 | TCP | Metrics (internal) |

### Firewall Configuration

```bash
# Allow necessary ports
ufw allow 22/tcp      # SSH
ufw allow 8545/tcp    # RPC (if public)
ufw allow 8546/tcp    # WebSocket (if public)
ufw allow 30303/tcp   # P2P
ufw allow 30303/udp   # P2P
ufw enable
```

### Environment Variables

```bash
# ~/.jeju/.env
JEJU_NETWORK=mainnet
NODE_TYPE=full
JEJU_SNAPSHOT=true
JEJU_AUTOSTART=true
```

---

## Monitoring

### Helper Scripts

After installation, use these scripts from `~/.jeju/`:

**Check Status:**
```bash
./status.sh
```

**View Logs:**
```bash
./logs.sh              # All services
./logs.sh reth         # Just Reth
./logs.sh op-node      # Just OP-Node
```

**Start/Stop:**
```bash
./start.sh
./stop.sh
```

**Update Node:**
```bash
./update.sh
```

### Sync Status

Check if your node is synced:

```bash
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'

# Response: false = fully synced
# Response: {...} = syncing (shows progress)
```

Get current block:

```bash
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Prometheus Metrics

Access metrics at `http://localhost:9090`

Key metrics to monitor:
- `reth_sync_height` - Current block
- `reth_p2p_peers` - Peer count
- `reth_rpc_requests_total` - Request volume
- `reth_rpc_response_time` - Response latency

### Grafana Dashboard

Import the provided dashboard:

```bash
# Open Grafana at http://localhost:3000
# Default: admin/admin
# Import: monitoring/grafana/dashboards/op-stack.json
```

### Alerting

Set up alerts for critical issues:

```yaml
# prometheus/alerts.yml
groups:
  - name: node
    interval: 1m
    rules:
      - alert: NodeOffline
        expr: up{job="reth"} == 0
        for: 5m
        annotations:
          summary: "Node is offline"
      
      - alert: NotSyncing
        expr: reth_sync_height < 100
        for: 15m
        annotations:
          summary: "Node stopped syncing"
      
      - alert: HighMemory
        expr: node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.1
        for: 5m
        annotations:
          summary: "Memory usage >90%"
```

---

## Maintenance

### Regular Updates

**Automatic Updates (Recommended):**

```bash
# Enable auto-updates
cd ~/.jeju
export AUTO_UPDATE=true
bun run ~/jeju/scripts/auto-update/update-manager.ts &
```

This will:
- Check for updates hourly
- Automatically update when available
- Backup before updating
- Rollback if update fails
- Notify you of updates

**Manual Updates:**

```bash
cd ~/.jeju
docker-compose pull
docker-compose up -d
```

### Backups

**What to Backup:**
- Configuration files (not data - can re-sync)
- JWT secret
- docker-compose.yml

```bash
# Create backup
tar -czf jeju-config-backup.tar.gz \
  ~/.jeju/config/ \
  ~/.jeju/docker-compose.yml

# Store offsite
scp jeju-config-backup.tar.gz user@backup-server:~/
```

### Log Rotation

Prevent logs from filling disk:

```bash
# Add to /etc/logrotate.d/jeju-node
/home/ubuntu/.jeju/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

### Disk Space Management

Monitor disk usage:

```bash
df -h ~/.jeju/data

# If running low:
# 1. Archive nodes: consider pruning
# 2. Full nodes: automatic pruning enabled
# 3. Clear logs: find ~/.jeju/logs -type f -mtime +7 -delete
```

---

## Rewards Program

### Overview

Earn JEJU tokens for running reliable infrastructure.

**Base Reward:** Monthly JEJU allocation per node
**Uptime Multiplier:** Bonus for high uptime (99%+)
**Geographic Bonus:** Additional rewards for underserved regions
**Volume Bonus:** Extra rewards for high-traffic nodes

### Registration

1. **Deploy Node** (see Installation above)

2. **Stake Tokens:**

```bash
# Requires 1,000 JEJU minimum stake
cd ~/jeju

# Approve tokens
cast send $JEJU_TOKEN "approve(address,uint256)" \
  $REWARDS_CONTRACT 1000000000000000000000 \
  --rpc-url https://rpc.jeju.network \
  --private-key $YOUR_PRIVATE_KEY

# Register node
cast send $REWARDS_CONTRACT \
  "registerNode(string,string,uint256)" \
  "https://your-rpc-url.com" \
  "North America" \
  1000000000000000000000 \
  --rpc-url https://rpc.jeju.network \
  --private-key $YOUR_PRIVATE_KEY
```

3. **Register with Explorer:**

Visit https://nodes.jeju.network/register and fill in:
- Operator address
- RPC URL
- Geographic location
- Node version

4. **Enable Heartbeats:**

```bash
# Run heartbeat service
cd ~/jeju
export NODE_ID=<your-node-id>
bun run scripts/monitoring/heartbeat.ts &
```

### Maximizing Rewards

**High Uptime (99.5%+):**
- Use reliable hosting (AWS, GCP, etc.)
- Set up monitoring and alerts
- Enable auto-updates
- Have failover plan

**Geographic Diversity:**
- Check current distribution at nodes.jeju.network
- Target underserved regions:
  - South America: +50%
  - Africa: +50%
  - Asia (outside China): +50%

**High Volume:**
- Share your RPC publicly (safely)
- List on public RPC aggregators
- Ensure rate limiting is reasonable
- Optimize for low latency

### Claiming Rewards

Rewards accrue automatically and can be claimed anytime:

```bash
# Check pending rewards
cast call $REWARDS_CONTRACT \
  "calculateRewards(bytes32)" \
  $YOUR_NODE_ID \
  --rpc-url https://rpc.jeju.network

# Claim rewards (after 24h minimum)
cast send $REWARDS_CONTRACT \
  "claimRewards(bytes32)" \
  $YOUR_NODE_ID \
  --rpc-url https://rpc.jeju.network \
  --private-key $YOUR_PRIVATE_KEY
```

### Performance Metrics

Track your performance at:
- https://nodes.jeju.network/nodes/YOUR_NODE_ID

Key metrics:
- **Uptime Score:** Target 99.5%+ for maximum multiplier
- **Response Time:** Keep <100ms for best performance
- **Request Volume:** Higher = more bonus rewards
- **Peer Count:** Maintain 50+ peers

---

## Troubleshooting

### Node Won't Start

**Check Docker:**
```bash
docker ps  # Should see jeju-reth and jeju-op-node
docker-compose logs
```

**Common Issues:**
- Port already in use: Change ports in docker-compose.yml
- Out of disk: Clear space or increase disk size
- JWT secret missing: Regenerate with `openssl rand -hex 32 > config/jwt-secret.txt`

### Node Not Syncing

**Check Connection:**
```bash
docker-compose logs op-node | grep "connected"
```

**Common Issues:**
- Firewall blocking P2P (port 30303)
- Wrong Base RPC URL in config
- Network congestion (wait it out)

**Force Resync:**
```bash
docker-compose down
rm -rf ~/.jeju/data/*
# Re-download snapshot
docker-compose up -d
```

### High Memory Usage

**Check Usage:**
```bash
docker stats
```

**Solutions:**
- Increase RAM
- Reduce cache size in docker-compose.yml
- Switch to pruned node if running archive

### Slow RPC Responses

**Test Response Time:**
```bash
time curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

**Solutions:**
- Upgrade to NVMe SSD
- Increase CPU cores
- Reduce concurrent connections
- Enable response caching

### Rewards Not Accruing

**Check Node Status:**
```bash
# Visit https://nodes.jeju.network/nodes/YOUR_NODE_ID
```

**Common Issues:**
- Node not sending heartbeats (check heartbeat service)
- Uptime below 99% (improve reliability)
- Performance data not updating (check oracle)
- Node slashed (contact team on Discord)

---

## Best Practices

### Security

**1. Dedicated Server:**
- Don't run other services on the same machine
- Isolate node in its own VPC/subnet
- Use security groups/firewall rules

**2. SSH Hardening:**
```bash
# Disable password authentication
# /etc/ssh/sshd_config
PasswordAuthentication no
PermitRootLogin no
```

**3. Rate Limiting:**
- Use nginx/Caddy in front of RPC
- Limit to 100 req/sec per IP
- Block abusive IPs

**4. DDoS Protection:**
- Use Cloudflare for public RPC
- Enable "Under Attack" mode if needed
- Monitor for unusual traffic patterns

### Performance Optimization

**1. Use NVMe SSDs:**
- 3-5x faster than SATA SSDs
- Critical for archive nodes
- Improves sync speed significantly

**2. Optimize Docker:**
```yaml
# docker-compose.yml - Add these limits
services:
  reth:
    mem_limit: 16g
    cpus: 8
```

**3. Tune Network:**
```bash
# Increase network buffers
sysctl -w net.core.rmem_max=134217728
sysctl -w net.core.wmem_max=134217728
```

### High Availability

**1. Monitoring:**
- Set up Grafana + Prometheus
- Configure alerts (Discord/Telegram/PagerDuty)
- Monitor 24/7

**2. Auto-Restart:**
```yaml
# docker-compose.yml
services:
  reth:
    restart: unless-stopped
```

**3. Failover:**
- Run backup node on different provider
- Use load balancer for public RPC
- Automatic failover on outage

### Cost Optimization

**1. Right-Size Resources:**
- Start with minimum specs
- Scale up based on actual usage
- Don't over-provision

**2. Use Spot Instances:**
- AWS EC2 Spot: 70% cheaper
- Set up auto-recovery on termination
- Not for primary/only node

**3. Optimize Bandwidth:**
- Limit peer connections (--max-outbound-peers)
- Use local mirrors for updates
- Compress logs before shipping

---

## Support & Community

### Getting Help

**Documentation:**
- https://docs.jeju.network

**Discord:**
- https://discord.gg/jeju
- #node-operators channel

**GitHub:**
- Issues: https://github.com/elizaos/jeju/issues
- Discussions: https://github.com/elizaos/jeju/discussions

### Contributing

Help improve the network:
- Report bugs
- Suggest improvements
- Contribute to docs
- Help other operators

### Node Operator DAO

Operators get governance rights:
- Vote on parameter changes
- Propose infrastructure improvements
- Participate in treasury allocation
- Shape network's future

---

## Quick Reference

### Essential Commands

```bash
# Status
~/.jeju/status.sh

# Logs
~/.jeju/logs.sh

# Start/Stop
~/.jeju/start.sh
~/.jeju/stop.sh

# Update
~/.jeju/update.sh

# Restart
cd ~/.jeju && docker-compose restart

# Check sync
curl -s -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' | jq
```

### Important URLs

- **Mainnet RPC:** https://rpc.jeju.network
- **Testnet RPC:** https://testnet-rpc.jeju.network
- **Explorer:** https://nodes.jeju.network
- **Docs:** https://docs.jeju.network
- **Snapshots:** https://snapshots.jeju.network

### Contract Addresses

```
Rewards Contract: 0x... (TBD)
JEJU Token: 0x... (TBD)
```

---

## Changelog

### Version 1.0 (Current)
- Initial release
- One-command installer
- Snapshot service
- Rewards program
- Auto-updates
- Node explorer

---

**Welcome to the Jeju node operator community! 🎉**

For questions or issues, reach out on Discord or open a GitHub issue.

Happy node operating! 🚀

