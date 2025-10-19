# Node Operator Quick Start

Get your Jeju node up and running in 5 minutes.

---

## Prerequisites

- Linux server (Ubuntu 22.04 recommended) or macOS
- 8+ CPU cores, 16+ GB RAM, 500+ GB SSD
- 100+ Mbps network connection
- Docker installed (installer can do this for you)

---

## Step 1: Install Node (1 minute)

Run the one-command installer:

```bash
curl -fsSL https://raw.githubusercontent.com/elizaos/jeju/main/scripts/install-node.sh | bash
```

This will:
- ✅ Install Docker and dependencies
- ✅ Download network configs
- ✅ Set up monitoring
- ✅ Create helper scripts
- ✅ Download snapshot (optional, saves days of sync time)

---

## Step 2: Start Your Node (30 seconds)

```bash
cd ~/.jeju
docker-compose up -d
```

---

## Step 3: Check Status (30 seconds)

```bash
~/.jeju/status.sh
```

You should see:
- ✅ Services running
- ✅ Syncing status (false when fully synced)
- ✅ Current block number

---

## Step 4: Register for Rewards (2 minutes)

### A. Stake Tokens

You need 1,000 JEJU tokens minimum:

```bash
# Get testnet JEJU from faucet
# https://faucet.jeju.network

# Approve tokens
cast send $JEJU_TOKEN "approve(address,uint256)" \
  $REWARDS_CONTRACT 1000000000000000000000 \
  --rpc-url https://rpc.jeju.network \
  --private-key $YOUR_PRIVATE_KEY

# Register node
cast send $REWARDS_CONTRACT \
  "registerNode(string,string,uint256)" \
  "http://YOUR_PUBLIC_IP:8545" \
  "Your Region" \
  1000000000000000000000 \
  --rpc-url https://rpc.jeju.network \
  --private-key $YOUR_PRIVATE_KEY
```

### B. Register with Explorer

Visit https://nodes.jeju.network/register and submit:
- Your operator address
- Your RPC URL
- Geographic location
- Node version

---

## Step 5: Monitor Performance (ongoing)

Visit your node dashboard:
```
https://nodes.jeju.network/nodes/YOUR_NODE_ID
```

Track:
- 📊 Uptime score (target 99.5%+)
- 🌐 Request volume
- ⚡ Response time
- 💰 Pending rewards

---

## Next Steps

### Enable Auto-Updates

Never miss an important update:

```bash
cd ~/.jeju
export AUTO_UPDATE=true
bun run ~/jeju/scripts/auto-update/update-manager.ts &
```

### Set Up Monitoring Alerts

Get notified if your node goes down:

```bash
# Add webhook to .env
echo "NOTIFICATION_WEBHOOK=https://discord.com/api/webhooks/YOUR_WEBHOOK" >> .env
```

### Optimize for Rewards

Maximize your earnings:
- ✅ Maintain 99.5%+ uptime
- ✅ Keep response time <100ms
- ✅ Serve in underserved regions (+50% bonus)
- ✅ Enable public RPC (with rate limits)

---

## Common Commands

```bash
# View logs
~/.jeju/logs.sh

# Restart node
cd ~/.jeju && docker-compose restart

# Update node
~/.jeju/update.sh

# Check sync progress
curl -s -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' | jq

# Stop node
~/.jeju/stop.sh

# Start node
~/.jeju/start.sh
```

---

## Troubleshooting

### Node not syncing?

```bash
# Check logs
docker-compose logs -f op-node

# Restart services
docker-compose restart
```

### Out of disk space?

```bash
# Check usage
df -h ~/.jeju/data

# Clear old logs
find ~/.jeju/logs -type f -mtime +7 -delete

# For full nodes, pruning is automatic
# For archive nodes, consider increasing disk size
```

### High memory usage?

```bash
# Check resource usage
docker stats

# Increase RAM or switch to pruned node
```

---

## Get Help

- **Discord:** https://discord.gg/jeju (#node-operators)
- **Docs:** https://docs.jeju.network
- **GitHub:** https://github.com/elizaos/jeju/issues

---

## Earning Potential

### Example High-Performance Node

```
Base Reward:          Monthly allocation
Uptime Multiplier:    High uptime bonus (99.5%+)
Volume Bonus:         High-traffic bonus
Geographic Bonus:     Underserved region bonus
─────────────────────────────────
Total Monthly:        Significant JEJU rewards
```

Actual rewards vary based on network parameters and token economics.

---

**You're all set! Welcome to the Jeju node operator community! 🎉**

For detailed information, see the [Node Operator Handbook](./node-operator-handbook.md).

