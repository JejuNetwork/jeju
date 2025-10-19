# Oracle Failover Procedures

## Overview

This document describes the failover procedures for the Jeju oracle price updater system. Oracle bots use leader election to ensure only one bot updates prices at a time, with automatic failover to backup bots if the leader fails.

## Table of Contents

- [Architecture](#architecture)
- [Automatic Failover](#automatic-failover)
- [Detecting Failures](#detecting-failures)
- [Manual Failover](#manual-failover)
- [Recovery Procedures](#recovery-procedures)
- [Testing Failover](#testing-failover)
- [Runbooks](#runbooks)

## Architecture

### Multi-Node Setup

```
┌─────────────────────────────────────────────┐
│           Price Sources (Base)              │
│   Chainlink ETH/USD + Uniswap elizaOS       │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────▼────────┐    ┌───────▼────────┐
│   Bot #1 (AWS) │    │ Bot #2 (Hetzner)│
│    LEADER      │◄───┤    FOLLOWER     │
│   Port 3000    │    │    Port 3000    │
└───────┬────────┘    └───────┬─────────┘
        │                     │
        │  ┌──────────────────┘
        │  │
        ▼  ▼
┌─────────────────────────────────────────────┐
│      Jeju ManualPriceOracle Contract        │
│    Only leader submits price updates        │
└─────────────────────────────────────────────┘
```

### Leader Election Mechanism

- **File-based lock**: Uses `/tmp/oracle-bot-leader.lock` with 2-minute timeout
- **Heartbeat**: Leader updates lock file every 30 seconds
- **Automatic takeover**: Followers become leader if lock is stale (>2 minutes)
- **Single leader guarantee**: Only one bot writes to oracle at a time

## Automatic Failover

### How It Works

1. **Normal Operation**:
   - Bot #1 is leader, updates every 5 minutes
   - Bot #2 is follower, monitors but doesn't update
   - Both bots check leadership status every cycle

2. **Leader Failure Detected**:
   - Bot #1 stops updating (crash, network issue, etc.)
   - Lock file not updated for 2+ minutes
   - Bot #2 detects stale lock

3. **Automatic Takeover**:
   - Bot #2 acquires lock, becomes leader
   - Bot #2 starts updating oracle
   - Total downtime: <2 minutes

4. **Leader Recovery**:
   - Bot #1 comes back online
   - Detects Bot #2 is leader
   - Remains as follower
   - No duplicate updates

### Failover Timing

| Scenario | Detection Time | Failover Time | Total Downtime |
|----------|----------------|---------------|----------------|
| Bot crash | 30s (next heartbeat) | 0s | 30s |
| Network partition | 120s (lock timeout) | 0s | 2min |
| Graceful restart | 0s (immediate) | 0s | 0s |
| Cloud region outage | 120s (lock timeout) | 0s | 2min |

## Detecting Failures

### Health Check Endpoints

Each bot exposes health endpoints:

```bash
# Check if bot is alive
curl http://bot-1.example.com:3000/health

# Response when healthy:
{
  "status": "healthy",
  "botId": "bot-aws-1",
  "healthy": true,
  "lastUpdate": 1704067200000,
  "consecutiveFailures": 0,
  "totalUpdates": 142,
  "uptime": 86400
}

# Response when unhealthy (503):
{
  "status": "unhealthy",
  "botId": "bot-aws-1",
  "healthy": false,
  "lastUpdate": 1704063600000,
  "consecutiveFailures": 6,
  "totalUpdates": 142,
  "uptime": 86400
}
```

### Monitoring Alerts

Prometheus alerts notify you of failures:

#### Critical Alerts

1. **OracleBotDown**: Bot not responding for 2 minutes
2. **AllOracleBotsDown**: All bots down (CRITICAL!)
3. **OraclePriceStale**: No price update in 1 hour

#### Warning Alerts

1. **OracleHighFailureRate**: >5 consecutive failures
2. **OracleSingleBotRunning**: Only 1 bot active (need 2+)
3. **OracleLowWalletBalance**: Bot wallet <0.01 ETH

### Log Analysis

Check bot logs for failure indicators:

```bash
# Systemd
sudo journalctl -u jeju-oracle -f

# Docker
docker logs -f jeju-oracle-bot-1

# Key log patterns to watch:
# ✅ Success: "Oracle updated successfully"
# ⚠️  Warning: "RPC failover occurred"
# ❌ Error: "Oracle update failed"
# 👑 Leadership: "Bot X became leader"
# 💀 Failure: "Previous leader X is dead, taking over"
```

## Manual Failover

### When to Manually Failover

- Leader bot is stuck but not crashed
- Need to perform maintenance on leader
- Leader in degraded state but not triggering automatic failover
- Testing failover procedures

### Procedure 1: Graceful Failover

Best for planned maintenance:

```bash
# Step 1: Stop the current leader
ssh bot-1.example.com
sudo systemctl stop jeju-oracle

# Step 2: Verify follower took over (within 2 minutes)
ssh bot-2.example.com
sudo journalctl -u jeju-oracle -f
# Look for: "Bot bot-2 became leader"

# Step 3: Verify oracle is still updating
curl http://bot-2.example.com:3000/health
# Check: lastUpdate should be recent

# Step 4: Check oracle contract
cast call $ORACLE_ADDRESS "getPrices()" --rpc-url $JEJU_RPC_URL
# Verify: lastUpdate timestamp is fresh

# Step 5: When ready, restart original leader (it will remain follower)
ssh bot-1.example.com
sudo systemctl start jeju-oracle
```

### Procedure 2: Force Leadership Change

For when automatic failover isn't working:

```bash
# Step 1: SSH to desired new leader
ssh bot-2.example.com

# Step 2: Remove leader lock file
sudo rm /tmp/oracle-bot-leader.lock

# Step 3: Wait for bot to detect and become leader (next cycle, <30s)
sudo journalctl -u jeju-oracle -f
# Look for: "Bot bot-2 became leader"

# Step 4: Stop old leader to prevent conflicts
ssh bot-1.example.com
sudo systemctl stop jeju-oracle

# Step 5: Investigate why old leader didn't step down
sudo journalctl -u jeju-oracle -n 100
```

### Procedure 3: Emergency Manual Price Update

If all bots are down and oracle is stale:

```bash
# Step 1: Get current prices manually
# ETH/USD from Base Chainlink
cast call 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70 \
  "latestRoundData()" \
  --rpc-url https://mainnet.base.org

# elizaOS price from reliable source (CoinGecko, DEX aggregator)
# Convert to 8 decimals (e.g., $0.0842 = 8420000)

# Step 2: Update oracle with owner key
cast send $ORACLE_ADDRESS \
  "emergencyPriceUpdate(uint256,uint256)" \
  324567000000 \  # ETH price in 8 decimals
  8420000 \       # elizaOS price in 8 decimals
  --rpc-url $JEJU_RPC_URL \
  --private-key $OWNER_PRIVATE_KEY

# Step 3: Verify update
cast call $ORACLE_ADDRESS "getPrices()" --rpc-url $JEJU_RPC_URL

# Step 4: Restart bots
ssh bot-1.example.com "sudo systemctl start jeju-oracle"
ssh bot-2.example.com "sudo systemctl start jeju-oracle"
```

## Recovery Procedures

### Bot Crashed

```bash
# Step 1: Identify which bot crashed
# Check monitoring dashboard or logs

# Step 2: Check service status
ssh bot-1.example.com
sudo systemctl status jeju-oracle
# If "failed" or "inactive"

# Step 3: Check logs for crash reason
sudo journalctl -u jeju-oracle -n 200 --no-pager

# Common causes:
# - Out of memory: Restart service, increase RAM
# - Unhandled exception: Bug fix needed
# - Out of gas: Top up wallet
# - RPC issues: Check RPC endpoints

# Step 4: Restart service
sudo systemctl restart jeju-oracle

# Step 5: Monitor for stability
sudo journalctl -u jeju-oracle -f

# Step 6: If crashes persist, keep it stopped and investigate
```

### Network Partition

When bot can't reach oracle contract:

```bash
# Step 1: Verify network connectivity
ssh bot-1.example.com
ping -c 5 rpc.jeju.network
curl https://rpc.jeju.network

# Step 2: Check if RPC endpoints are healthy
curl -X POST https://rpc.jeju.network \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Step 3: If primary RPC down, bot should auto-failover
# Check logs: "Jeju RPC 0 failed, trying fallback..."

# Step 4: If all RPCs down, add backup RPCs to .env
sudo vim /opt/jeju-oracle/.env
# Add to JEJU_RPC_URLS: https://backup-rpc.jeju.network

# Step 5: Restart to pick up new config
sudo systemctl restart jeju-oracle

# Step 6: If issue is with bot's VPS network, switch to backup bot
# Follow "Graceful Failover" procedure
```

### Cloud Region Outage

If entire cloud region goes down (e.g., AWS us-east-1):

```bash
# Automatic Response:
# - Bots in other regions detect leader timeout
# - Backup bot becomes leader within 2 minutes
# - No manual intervention needed

# Post-Outage Actions:
# Step 1: Verify backup bot took over
curl http://bot-2.example.com:3000/health

# Step 2: Check oracle still updating
cast call $ORACLE_ADDRESS "isPriceFresh()" --rpc-url $JEJU_RPC_URL
# Should return: true

# Step 3: When failed region recovers, bring bot back online
ssh bot-1.example.com
sudo systemctl start jeju-oracle

# Step 4: It will automatically become follower
# No manual intervention needed

# Step 5: Monitor both bots for stability
```

### Oracle Contract Issue

If oracle contract has a bug or is paused:

```bash
# Step 1: Check if oracle is paused
cast call $ORACLE_ADDRESS "paused()" --rpc-url $JEJU_RPC_URL

# Step 2: If paused, check why
# Look at recent transactions on block explorer

# Step 3: If legitimate pause, bots will fail gracefully
# If bug, may need contract upgrade

# Step 4: Emergency actions:
# Option A: Unpause oracle (if safe)
cast send $ORACLE_ADDRESS "unpause()" \
  --rpc-url $JEJU_RPC_URL \
  --private-key $OWNER_PRIVATE_KEY

# Option B: Deploy new oracle
forge script script/DeployOracle.s.sol --broadcast

# Option C: Pause paymaster until fixed
cast send $PAYMASTER_ADDRESS "pause()" \
  --rpc-url $JEJU_RPC_URL \
  --private-key $OWNER_PRIVATE_KEY
```

## Testing Failover

### Test 1: Simulated Bot Crash

```bash
# Purpose: Verify automatic failover works

# Step 1: Note current leader
curl http://bot-1.example.com:3000/health | jq -r '.botId'

# Step 2: Stop leader bot
ssh bot-1.example.com
sudo systemctl stop jeju-oracle

# Step 3: Monitor follower logs
ssh bot-2.example.com
sudo journalctl -u jeju-oracle -f

# Expected: Within 2 minutes, see "Bot bot-2 became leader"

# Step 4: Verify oracle still updating
watch -n 10 'cast call $ORACLE_ADDRESS "getPrices()" --rpc-url $JEJU_RPC_URL'

# Step 5: Restart original leader
ssh bot-1.example.com
sudo systemctl start jeju-oracle

# Expected: Bot-1 becomes follower, Bot-2 remains leader

# Step 6: Record results
echo "Failover time: X seconds" >> failover-test-results.txt
```

### Test 2: Network Partition Simulation

```bash
# Purpose: Test behavior when bot can't reach oracle

# Step 1: Block outbound traffic to Jeju RPC
ssh bot-1.example.com
sudo iptables -A OUTPUT -d rpc.jeju.network -j DROP

# Step 2: Watch bot logs
sudo journalctl -u jeju-oracle -f
# Expected: RPC failover to backup endpoint

# Step 3: If all RPCs blocked, bot should mark itself unhealthy
curl http://localhost:3000/health
# Expected: "status": "unhealthy"

# Step 4: Verify backup bot takes over
ssh bot-2.example.com
sudo journalctl -u jeju-oracle -f
# Expected: Bot-2 becomes leader

# Step 5: Restore network
ssh bot-1.example.com
sudo iptables -D OUTPUT -d rpc.jeju.network -j DROP

# Step 6: Verify bot-1 recovers and becomes follower
```

### Test 3: Planned Maintenance

```bash
# Purpose: Practice zero-downtime maintenance

# Step 1: Perform graceful failover (see above)

# Step 2: Update bot-1 (upgrade, config change, etc.)
ssh bot-1.example.com
cd /opt/jeju-oracle
sudo -u jeju-oracle git pull
sudo -u jeju-oracle bun install

# Step 3: Restart bot-1
sudo systemctl restart jeju-oracle

# Step 4: Verify bot-1 is healthy follower
curl http://bot-1.example.com:3000/health

# Step 5: Repeat for bot-2 (one at a time!)

# Step 6: Verify zero oracle downtime
# Check Prometheus: oracle uptime never <100%
```

## Runbooks

### Runbook: All Bots Down

**Severity**: CRITICAL
**Expected Response Time**: 5 minutes

```bash
# 1. Check if bots are actually down
curl http://bot-1.example.com:3000/health
curl http://bot-2.example.com:3000/health

# 2. SSH to each bot and check status
ssh bot-1.example.com "sudo systemctl status jeju-oracle"
ssh bot-2.example.com "sudo systemctl status jeju-oracle"

# 3. If stopped, restart
ssh bot-1.example.com "sudo systemctl start jeju-oracle"
ssh bot-2.example.com "sudo systemctl start jeju-oracle"

# 4. If crashed, check logs for errors
ssh bot-1.example.com "sudo journalctl -u jeju-oracle -n 100"

# 5. If oracle is now stale (>1 hour), do emergency price update
# See "Procedure 3: Emergency Manual Price Update" above

# 6. Once one bot is up and updating, investigate others
```

### Runbook: Oracle Price Stale

**Severity**: CRITICAL
**Expected Response Time**: 10 minutes

```bash
# 1. Check oracle staleness
cast call $ORACLE_ADDRESS "getPrices()" --rpc-url $JEJU_RPC_URL
# Note the lastUpdate timestamp

# 2. Check if bots are running
curl http://bot-1.example.com:3000/health

# 3. If bots running but not updating, check logs
ssh bot-1.example.com "sudo journalctl -u jeju-oracle -n 50"

# Common causes:
# - All price updates failing (RPC issues)
# - Price deviation too large (market volatility)
# - Gas price too high
# - Oracle contract issue

# 4. If price deviation too large, use emergency update
cast send $ORACLE_ADDRESS "emergencyPriceUpdate(...)" \
  --rpc-url $JEJU_RPC_URL --private-key $OWNER_PRIVATE_KEY

# 5. If RPC issues, add more RPC endpoints

# 6. If gas too high, increase MAX_GAS_PRICE_GWEI in config
```

### Runbook: Leader Election Split Brain

**Severity**: HIGH
**Expected Response Time**: 5 minutes

**Symptoms**: Multiple bots think they're leader (duplicate price updates)

```bash
# 1. Check which bots are leaders
curl http://bot-1.example.com:3000/metrics | grep oracle_is_leader
curl http://bot-2.example.com:3000/metrics | grep oracle_is_leader
# If both show 1, split brain detected

# 2. Check lock file on each bot
ssh bot-1.example.com "cat /tmp/oracle-bot-leader.lock"
ssh bot-2.example.com "cat /tmp/oracle-bot-leader.lock"

# 3. Stop all bots
ssh bot-1.example.com "sudo systemctl stop jeju-oracle"
ssh bot-2.example.com "sudo systemctl stop jeju-oracle"

# 4. Clear lock files
ssh bot-1.example.com "sudo rm /tmp/oracle-bot-leader.lock"
ssh bot-2.example.com "sudo rm /tmp/oracle-bot-leader.lock"

# 5. Start bots one at a time (30s apart)
ssh bot-1.example.com "sudo systemctl start jeju-oracle"
sleep 30
ssh bot-2.example.com "sudo systemctl start jeju-oracle"

# 6. Verify only one leader
curl http://bot-1.example.com:3000/metrics | grep oracle_is_leader
curl http://bot-2.example.com:3000/metrics | grep oracle_is_leader
```

## Best Practices

1. **Always run 2+ bots**: Never rely on a single bot
2. **Different cloud providers**: Deploy bots in different regions/providers
3. **Test failover regularly**: Monthly failover drills
4. **Monitor continuously**: Prometheus + Grafana + Alerts
5. **Document incidents**: Keep runbook updated with lessons learned
6. **Automate recovery**: Use systemd auto-restart, health checks
7. **Low-privilege keys**: Bot wallets only have oracle update permission
8. **Keep wallets funded**: Alert when <0.01 ETH
9. **Version control configs**: Track changes to .env files
10. **Communication**: Alert team via Telegram/Discord/PagerDuty

## Emergency Contacts

- **Oracle Owner**: [Wallet address with emergency update permission]
- **Primary On-Call**: [Telegram/Phone]
- **Secondary On-Call**: [Telegram/Phone]
- **Escalation**: [Team lead contact]

## Related Documentation

- [Oracle Setup Guide](./oracle-setup)
- [Security Checklist](./oracle-security-checklist)
- [Deployment Overview](./overview)
- [Monitoring Guide](./monitoring)
