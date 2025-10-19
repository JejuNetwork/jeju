# Oracle Price Feed Setup

## The Problem

Your L3 paymaster needs accurate elizaOS/ETH exchange rates, but:
- ElizaOS token trades on **Base** (Uniswap, Aerodrome, etc.)
- Your paymaster runs on **Jeju**
- Can't directly access Base state from L3
- Manual updates are fragile and dangerous

## The Solution: Automated Price Bot

We use an automated keeper bot that:
1. Fetches ETH/USD from **Chainlink on Base** (battle-tested)
2. Fetches elizaOS/USD from **Base DEXes** (Uniswap V3, Aerodrome)
3. Pushes prices to your **ManualPriceOracle on Jeju**
4. Runs every 5 minutes with safety checks

## Architecture

```
┌──────────────────────────────────────────────┐
│           Base (Price Sources)            │
├──────────────────────────────────────────────┤
│                                              │
│  📊 Chainlink Feed                           │
│     └─ ETH/USD: $3,245.67                    │
│                                              │
│  🦄 Uniswap V3 Pool (elizaOS/WETH)           │
│     └─ elizaOS: $0.0842                      │
│                                              │
│  💨 Aerodrome DEX (backup source)            │
│                                              │
└──────────────────┬───────────────────────────┘
                   │
                   │ Price Bot reads every 5 min
                   ↓
          ┌─────────────────┐
          │   Price Bot     │
          │  (off-chain)    │
          └────────┬─────────┘
                   │
                   │ tx.updatePrices()
                   ↓
┌──────────────────────────────────────────────┐
│            Jeju (Your Oracle)             │
├──────────────────────────────────────────────┤
│                                              │
│  📡 ManualPriceOracle                        │
│     ├─ ethUsdPrice: 324567000000 (8 dec)    │
│     ├─ elizaUsdPrice: 8420000 (8 dec)       │
│     └─ lastUpdateTime: now                   │
│                                              │
│  💳 LiquidityPaymaster                       │
│     └─ Uses oracle for gas calculations      │
│                                              │
└──────────────────────────────────────────────┘
```

## Setup Instructions

### 1. Deploy Contracts

```bash
cd contracts
forge script script/DeployLiquiditySystem.s.sol --broadcast --verify
```

Note the deployed `ManualPriceOracle` address.

### 2. Configure Environment

Create `.env.oracle`:

```bash
# RPC endpoints
BASE_RPC_URL=https://mainnet.base.org
JEJU_RPC_URL=https://rpc.jeju.network

# Contract addresses
ORACLE_ADDRESS=0x...  # Your deployed ManualPriceOracle on Jeju
ELIZAOS_TOKEN_BASE=0x...  # ElizaOS token address on Base

# Price updater wallet (create a dedicated wallet for this)
PRICE_UPDATER_PRIVATE_KEY=0x...

# Optional: Alerting
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

### 3. Fund Price Updater Wallet

The price updater needs ETH on Jeju for gas:

```bash
# Send ~0.1 ETH to your PRICE_UPDATER wallet address
# Each update costs ~50k gas (~$0.0001 on L3)
# 0.1 ETH = ~1 million updates = years of operation
```

### 4. Set Authorized Updater

```bash
# From your oracle owner account
cast send $ORACLE_ADDRESS "setPriceUpdater(address)" $UPDATER_ADDRESS \
  --rpc-url $JEJU_RPC_URL \
  --private-key $OWNER_PRIVATE_KEY
```

### 5. Run Price Bot

#### Option A: Docker (Recommended for Production)

```dockerfile
# Dockerfile.oracle
FROM oven/bun:latest

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY scripts/oracle-updater.ts ./
COPY .env.oracle .env

CMD ["bun", "run", "oracle-updater.ts"]
```

```bash
docker build -f Dockerfile.oracle -t jeju-oracle-bot .
docker run -d --restart unless-stopped --name oracle-bot jeju-oracle-bot
```

#### Option B: Systemd Service (Linux VPS)

```ini
# /etc/systemd/system/jeju-oracle.service
[Unit]
Description=Jeju Oracle Price Updater
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/jeju
ExecStart=/usr/bin/bun run scripts/oracle-updater.ts
Restart=always
RestartSec=10
EnvironmentFile=/home/ubuntu/jeju/.env.oracle

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable jeju-oracle
sudo systemctl start jeju-oracle
sudo systemctl status jeju-oracle
```

#### Option C: Development/Testing

```bash
bun run scripts/oracle-updater.ts
```

### 6. Monitoring

Check bot logs:
```bash
# Docker
docker logs -f oracle-bot

# Systemd
journalctl -u jeju-oracle -f

# PM2
pm2 logs oracle-bot
```

Verify oracle is updating:
```bash
cast call $ORACLE_ADDRESS "getPrices()" --rpc-url $JEJU_RPC_URL
cast call $ORACLE_ADDRESS "isPriceFresh()" --rpc-url $JEJU_RPC_URL
```

## Alternative Solutions

### Option 1: Cross-Chain Oracle (More Decentralized)

Deploy an oracle relay that uses `L2CrossDomainMessenger`:

**Pros:**
- More decentralized
- Trustless price relay
- No bot maintenance

**Cons:**
- More complex
- Higher gas costs (cross-chain messaging)
- 1-2 minute latency

**Implementation:** Would require a contract on Base that reads DEX prices and sends them via CrossDomainMessenger to your L3 oracle.

### Option 2: Chainlink on Jeju (If Available)

**Pros:**
- Battle-tested
- Decentralized
- No maintenance

**Cons:**
- Expensive on L3s
- Requires Chainlink deployment on Jeju
- elizaOS price feed likely doesn't exist

### Option 3: Superchain Oracle Aggregation

Optimism Superchain has oracle aggregation coming:

**Pros:**
- Free or cheap
- Native OP Stack integration
- No bot needed

**Cons:**
- Not available yet
- Still requires price source for elizaOS

## Safety Features

The bot includes multiple safety mechanisms:

### 1. Price Deviation Limits
```solidity
uint256 public constant MAX_DEVIATION_PCT = 50; // 50% max change
```
Oracle rejects price updates that move >50% to prevent oracle manipulation.

### 2. Staleness Detection
```solidity
uint256 public constant PRICE_STALE_THRESHOLD = 1 hours;
```
Paymaster pauses if price is >1 hour old.

### 3. Rate Limiting
Bot won't update more than once per minute, even if prices change rapidly.

### 4. Multi-Source Aggregation
Fetches from multiple DEXes and takes median/weighted average.

### 5. Circuit Breaker
If deviation is too large, bot alerts admin and waits for manual approval.

## Cost Analysis

### Bot Operating Costs

**Gas per update:**
- Very low gas costs on L3 Jeju
- Updates every 5 minutes (288/day)
- Minimal daily gas expenditure

**Infrastructure:**
- Small VPS required for bot hosting
- Very low total operational costs

Compare this to:
- Chainlink custom feeds: Very expensive
- Manual updates: Risk of stale prices → exploits

Price bot provides the most cost-effective solution for oracle updates.

## Backup Plans

### Emergency Manual Update

If bot fails, owner can manually update:

```bash
# Emergency price update (bypasses deviation checks)
cast send $ORACLE_ADDRESS \
  "emergencyPriceUpdate(uint256,uint256)" \
  324567000000 \  # ETH price (8 decimals)
  8420000 \       # elizaOS price (8 decimals)
  --rpc-url $JEJU_RPC_URL \
  --private-key $OWNER_PRIVATE_KEY
```

### Pause Paymaster

If oracle is compromised:

```bash
cast send $PAYMASTER_ADDRESS "pause()" \
  --rpc-url $JEJU_RPC_URL \
  --private-key $OWNER_PRIVATE_KEY
```

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Oracle freshness**: `isPriceFresh()` should always return `true`
2. **Bot health**: Last successful update timestamp
3. **Price deviation**: Alert if >20% moves
4. **Bot wallet balance**: Alert if <0.01 ETH
5. **Update frequency**: Should update ~12 times/hour

### Alert Setup

Add to `oracle-updater.ts`:

```typescript
// Send alert to Telegram/Discord
async function sendAlert(message: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: `🚨 Jeju Oracle Alert: ${message}`,
    }),
  });
}
```

## FAQ

### Q: What if the bot goes down?

**A:** Oracle has a 1-hour staleness threshold. If bot is down >1 hour:
1. Paymaster automatically pauses (safety)
2. You get alerted
3. Restart bot or manually update oracle
4. Unpause paymaster

### Q: Can someone manipulate the DEX price to exploit the oracle?

**A:** Multiple protections:
1. Bot aggregates from multiple DEXes
2. Oracle has 50% deviation limit
3. Large moves trigger manual review
4. Paymaster has fee margins to absorb small price swings

### Q: Why not use Uniswap TWAP?

**A:** TWAP is better but more complex:
- Requires historical price data storage
- More expensive to update
- Still needs off-chain bot for cross-chain relay

This is a v2 enhancement.

### Q: Can I run multiple bots for redundancy?

**A:** Yes! Deploy 2-3 bots with different infrastructure:
1. Primary: Your VPS
2. Backup: AWS Lambda
3. Backup: Friend's server

Only one update will succeed per time period (rate limiting), others will skip.

## Next Steps

1. ✅ Deploy contracts
2. ✅ Configure bot
3. ✅ Test on testnet
4. ✅ Deploy to mainnet
5. ⏳ Set up monitoring
6. ⏳ Deploy backup bots
7. ⏳ Consider upgrading to cross-chain oracle (v2)

## Resources

- [Chainlink Base Price Feeds](https://docs.chain.link/data-feeds/price-feeds/addresses?network=base)
- [Uniswap V3 SDK](https://docs.uniswap.org/sdk/v3/overview)
- [OP Stack Cross-Chain Messaging](https://docs.optimism.io/builders/app-developers/bridging/messaging)
- [EIP-4337 Paymaster Patterns](https://eips.ethereum.org/EIPS/eip-4337)

