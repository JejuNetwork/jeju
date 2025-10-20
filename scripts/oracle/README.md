# Oracle Price Feed System

## Overview

The Jeju paymaster requires accurate elizaOS/ETH exchange rates to calculate gas costs. Since the elizaOS token trades on Base (Uniswap, Aerodrome), we need a reliable way to get those prices onto Jeju.

## Solution: Automated Price Bot

```
┌──────────────────┐
│    Base       │  
│  (Price Source)  │  Chainlink ETH/USD + Uniswap elizaOS pools
└────────┬─────────┘
         │
         │ Price Bot reads every 5 min
         ↓
┌──────────────────┐
│   Price Bot      │  Aggregates, validates, submits
│   (Off-chain)    │
└────────┬─────────┘
         │
         │ tx.updatePrices()
         ↓
┌──────────────────┐
│    Jeju       │
│  (Oracle)        │  ManualPriceOracle → LiquidityPaymaster
└──────────────────┘
```

## Quick Start

### 1. Deploy Contracts

```bash
# Deploy oracle and paymaster system
cd contracts
forge script script/DeployLiquiditySystem.s.sol --broadcast --verify
```

### 2. Configure Bot

```bash
# Copy example config
cp .env.oracle.example .env.oracle

# Edit with your values
vim .env.oracle
```

Required values:
- `ORACLE_ADDRESS`: Deployed oracle contract on Jeju
- `ELIZAOS_TOKEN_BASE`: ElizaOS token address on Base
- `PRICE_UPDATER_PRIVATE_KEY`: Dedicated wallet for bot

### 3. Test Oracle System

```bash
# Run comprehensive oracle tests (included in main test suite)
bun run test
```

### 4. Run Bot

#### Development
```bash
bun run oracle:start
```

#### Production (Docker)
```bash
bun run oracle:docker:build
bun run oracle:docker:run

# View logs
bun run oracle:docker:logs
```

## Files

```
scripts/
├── oracle-updater.ts              # Main price bot
├── test-oracle-prices.ts          # Test price fetching
├── deploy-oracle.ts               # One-command deployment
├── oracle-updater.Dockerfile      # Docker image
└── oracle-updater.compose.yml     # Docker Compose config

documentation/deployment/
└── oracle-setup.md                # Complete setup guide

.env.oracle.example                # Config template
```

## How It Works

### Price Sources

**ETH/USD**: Chainlink Price Feed on Base
- Address: `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`
- Update frequency: ~every hour
- Decimals: 8
- Highly reliable, battle-tested

**elizaOS/USD**: Calculated from Uniswap V3 on Base
- Searches all fee tiers (0.05%, 0.3%, 1%)
- Uses sqrtPriceX96 from pool slot0
- Converts to USD using ETH price
- Multi-pool aggregation for robustness

### Update Logic

Bot runs every 5 minutes and:

1. **Fetch prices** from Base
2. **Validate** against safety limits
3. **Check deviation** - only update if >1% change
4. **Submit transaction** to oracle on Jeju
5. **Log results** and metrics

### Safety Features

1. **Deviation Limits**: Oracle rejects >50% price moves
2. **Staleness Detection**: Paymaster pauses if price >1 hour old
3. **Rate Limiting**: Max 1 update per minute
4. **Price Bounds**: ETH $500-$10k, elizaOS must be reasonable
5. **Multi-source Validation**: Checks multiple DEX pools

## Costs

### Bot Operating Costs

**Gas per update:**
- Jeju: ~50,000 gas @ 0.1 gwei = $0.000015
- Updates per day: 288 (every 5 minutes)
- **Daily: $0.0043**
- **Monthly: $0.13**

**Infrastructure:**
- Small VPS: $5/month
- **Total: ~$5/month**

Compare to Chainlink custom feed: $2,000-10,000/month

### Initial Setup

- Price updater wallet: ~0.1 ETH on Jeju (~$300)
  - Lasts for ~1 million updates (years)

## Monitoring

### Health Checks

```bash
# Check oracle freshness
cast call $ORACLE_ADDRESS "isPriceFresh()" --rpc-url $JEJU_RPC_URL

# Get current prices
cast call $ORACLE_ADDRESS "getPrices()" --rpc-url $JEJU_RPC_URL

# Check bot wallet balance
cast balance $BOT_ADDRESS --rpc-url $JEJU_RPC_URL
```

### Key Metrics

1. **Oracle freshness**: Must be <1 hour
2. **Update frequency**: ~12 per hour
3. **Price deviation**: Alert if >20% moves
4. **Bot balance**: Alert if <0.01 ETH
5. **Error rate**: Should be near zero

### Alerts

Bot can send alerts via:
- Telegram
- Discord
- Email (SendGrid)
- Sentry (error tracking)

Configure in `.env.oracle`.

## Troubleshooting

### Bot Won't Start

**Check RPC connectivity:**
```bash
curl -X POST $BASE_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

**Check wallet has funds:**
```bash
cast balance $BOT_ADDRESS --rpc-url $JEJU_RPC_URL
```

**Check bot is authorized:**
```bash
cast call $ORACLE_ADDRESS "priceUpdater()" --rpc-url $JEJU_RPC_URL
```

### Prices Not Updating

**Check oracle permissions:**
```bash
cast send $ORACLE_ADDRESS "setPriceUpdater(address)" $BOT_ADDRESS \
  --rpc-url $JEJU_RPC_URL --private-key $OWNER_KEY
```

**Check price deviation:**
- Large moves trigger manual review
- Use `emergencyPriceUpdate()` to bypass

**Check gas price:**
- Bot won't submit if gas too high
- Adjust `MAX_GAS_PRICE_GWEI` in .env

### Oracle Stale

**Manual update:**
```bash
cast send $ORACLE_ADDRESS \
  "emergencyPriceUpdate(uint256,uint256)" \
  324567000000 8420000 \
  --rpc-url $JEJU_RPC_URL --private-key $OWNER_KEY
```

**Pause paymaster temporarily:**
```bash
cast send $PAYMASTER_ADDRESS "pause()" \
  --rpc-url $JEJU_RPC_URL --private-key $OWNER_KEY
```

## Security

### Bot Security

- **Dedicated wallet**: Bot wallet only updates oracle, no other permissions
- **Low privilege**: Can't steal funds or change system parameters
- **Rate limited**: Can't update more than once per minute
- **Deviation limits**: Oracle rejects suspicious prices

### Oracle Security

- **Owner controls**: Only owner can change updater address
- **Price bounds**: Rejects out-of-range prices
- **Time locks**: Emergency updates have delay
- **Pausable**: Can pause paymaster if oracle compromised

### Best Practices

1. **Never commit `.env.oracle`** - Add to .gitignore
2. **Use hardware wallet** for oracle owner
3. **Monitor bot logs** for anomalies
4. **Run redundant bots** for high availability
5. **Test on testnet** before mainnet

## Alternatives

### Option 1: Cross-Chain Oracle

Use `L2CrossDomainMessenger` to relay prices from Base to Jeju trustlessly.

**Pros**: More decentralized, no bot maintenance
**Cons**: Complex, higher gas costs, slower updates

### Option 2: Chainlink on Jeju

If Chainlink deploys to Jeju.

**Pros**: Battle-tested, no maintenance
**Cons**: Expensive, elizaOS feed unlikely to exist

### Option 3: Superchain Oracle

When OP Superchain oracle aggregation launches.

**Pros**: Free, native integration
**Cons**: Not available yet, uncertain timeline

## Support

- **Documentation**: `/documentation/deployment/oracle-setup.md`
- **Issues**: Open GitHub issue
- **Discord**: [Join our Discord](https://discord.gg/jeju)

## License

MIT

