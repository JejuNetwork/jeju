# Oracle Pricing Strategy

## The Challenge

Your L3 paymaster needs accurate **elizaOS/ETH exchange rates** to calculate how much elizaOS to charge users for gas. The problem:

- **ElizaOS token trades on Base** (Uniswap, Aerodrome, etc.)
- **Your paymaster runs on Jeju**
- **Can't directly access Base state** from Jeju
- **Prices change constantly** as people trade

Without accurate prices, you risk:
- ❌ **Overcharging users** → Bad UX, users leave
- ❌ **Undercharging users** → You lose money on gas
- ❌ **Oracle manipulation** → Attackers exploit stale/wrong prices

## Your Options

### Option 1: Automated Price Bot ⭐ **RECOMMENDED**

**What**: Off-chain bot that fetches prices from Base and updates your L3 oracle.

```
Base (Chainlink + Uniswap) 
    → Price Bot (off-chain)
    → ManualPriceOracle on Jeju
    → LiquidityPaymaster uses prices
```

**Implementation Status**: ✅ **Ready to deploy**
- See: `scripts/oracle-updater.ts`
- See: `documentation/deployment/oracle-setup.md`

**Pros:**
- ✅ Simple to implement and maintain
- ✅ Fast updates (every 5 minutes)
- ✅ Very cheap (~$5/month)
- ✅ Works with any price source
- ✅ Easy to debug and monitor
- ✅ Can aggregate multiple DEXes

**Cons:**
- ⚠️ Requires running a bot (centralization risk)
- ⚠️ Single point of failure (mitigated by running multiple bots)
- ⚠️ Bot wallet needs ETH for gas

**Setup Time:** 30 minutes

**When to use:**
- ✅ MVP / Early launch
- ✅ Budget-conscious
- ✅ Need fast, reliable prices
- ✅ Most teams start here

### Option 2: Cross-Chain Oracle

**What**: Smart contract on Base reads prices and relays via `L2CrossDomainMessenger` to Jeju.

```
Base (PriceSource contract reads prices)
    → L2CrossDomainMessenger
    → CrossChainPriceRelay on Jeju
    → ManualPriceOracle on Jeju
```

**Implementation Status**: 🚧 **Prototype exists**
- See: `contracts/src/oracle/CrossChainPriceRelay.sol`
- Needs: PriceSource contract on Base

**Pros:**
- ✅ Trustless (no off-chain bot)
- ✅ Uses OP Stack native messaging
- ✅ Cryptographically secure
- ✅ Inherits Base/Ethereum security

**Cons:**
- ⚠️ More complex to implement
- ⚠️ Higher gas costs (Base + Jeju + message passing)
- ⚠️ 1-2 minute latency for message relay
- ⚠️ Still needs trigger (bot or keeper network)

**Setup Time:** 2-3 days

**When to use:**
- ✅ Decentralization is critical
- ✅ Budget allows higher costs
- ✅ Building for long-term (years)
- ✅ Want to eliminate bot dependency

### Option 3: Chainlink on Jeju

**What**: Wait for Chainlink to deploy price feeds on Jeju.

**Implementation Status**: ❌ **Not available**
- Chainlink exists on Base
- Chainlink rarely deploys to L3s
- ElizaOS feed unlikely to exist

**Pros:**
- ✅ Battle-tested, industry standard
- ✅ Highly decentralized
- ✅ No maintenance needed
- ✅ Trusted by all major protocols

**Cons:**
- ❌ Not available on Jeju
- ❌ Very expensive for custom feeds
- ❌ ElizaOS price feed doesn't exist
- ❌ Would still need ETH/USD → elizaOS/ETH conversion

**When to use:**
- ✅ Only if Chainlink deploys to Jeju (unlikely)
- ✅ For established protocols with high TVL
- ✅ When budget permits premium oracle service

### Option 4: Superchain Oracle Aggregation

**What**: Optimism Superchain's planned oracle infrastructure.

**Implementation Status**: 🔮 **Future / Not available**
- Mentioned in OP Stack roadmap
- Timeline unclear
- Design not finalized

**Pros:**
- ✅ Native OP Stack integration
- ✅ Likely free or very cheap
- ✅ No maintenance
- ✅ Shared across all OP chains

**Cons:**
- ❌ Doesn't exist yet
- ❌ Timeline uncertain (2024? 2025?)
- ❌ ElizaOS feed still unlikely
- ❌ Can't build on vaporware

**When to use:**
- ✅ Keep an eye on this for future migration
- ❌ Don't wait for this to launch

### Option 5: Hybrid Approach

**What**: Start with bot, migrate to cross-chain later.

```
Phase 1 (Launch): Automated Bot
    → Fast to implement
    → Low cost
    → Get to market quickly

Phase 2 (6+ months): Cross-Chain Oracle
    → More decentralized
    → Bot becomes backup
    → Gradual migration
```

**Implementation Status**: ✅ **Best practice**

**When to use:**
- ✅ Most teams should do this
- ✅ Don't over-engineer for launch
- ✅ Add decentralization as you scale

## Comparison Matrix

| Feature | Price Bot | Cross-Chain | Chainlink | Superchain |
|---------|-----------|-------------|-----------|------------|
| **Cost** | Very Low | Medium | Very High | TBD |
| **Setup time** | 30 min | 2-3 days | N/A | N/A |
| **Latency** | 5 min | 1-2 min | <1 min | TBD |
| **Decentralization** | ⚠️ Medium | ✅ High | ✅ Very High | ✅ High |
| **Maintenance** | Low | Low | None | None |
| **Availability** | ✅ Now | ✅ Now | ❌ No | ❌ No |
| **Complexity** | Low | Medium | Low | TBD |
| **Security** | Good | Very Good | Excellent | TBD |

## Our Recommendation

### For Launch (Month 0-6): **Price Bot** ⭐

**Why:**
1. Get to market in 30 minutes, not weeks
2. Only costs $5/month (trivial)
3. Fast, reliable updates
4. Easy to monitor and debug
5. Every major DeFi protocol started this way

**Implementation:**
```bash
# Deploy contracts
cd contracts && forge script script/DeployLiquiditySystem.s.sol --broadcast

# Configure bot
cp .env.oracle.example .env.oracle
vim .env.oracle  # Add your keys

# Test it works
bun run scripts/test-oracle-prices.ts

# Deploy
bun run oracle:docker:build
bun run oracle:docker:run
```

**Risk mitigation:**
- Run 2-3 redundant bots (different VPS providers)
- Set up monitoring and alerts
- Manual override available
- Paymaster auto-pauses if price stale

### For Growth (Month 6+): **Consider Cross-Chain**

**When to migrate:**
- TVL > $10M (decentralization matters more)
- Community asks for it (trust concerns)
- You have engineering bandwidth
- Bot becomes operational burden

**Migration path:**
```solidity
// Phase 1: Bot updates oracle
ManualPriceOracle.updatePrices() ← Bot

// Phase 2: Both (testing)
ManualPriceOracle.updatePrices() ← Bot OR CrossChainRelay

// Phase 3: Cross-chain primary
ManualPriceOracle.updatePrices() ← CrossChainRelay (bot backup)
```

## Price Sources on Base

### ETH/USD Price
**Source:** Chainlink Price Feed
- Address: `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`
- Decimals: 8
- Update frequency: ~1 hour
- Deviation threshold: 0.5%
- **Trust level**: Highest (used by all DeFi)

### elizaOS/USD Price
**Source:** DEX Aggregation (Uniswap V3, Aerodrome, etc.)
- Multiple pools checked
- Fee tier optimization (0.05%, 0.3%, 1%)
- TWAP can be added later
- **Trust level**: Medium (DEX liquidity dependent)

**Calculation:**
```
elizaOS/USD = (elizaOS/ETH from Uniswap) × (ETH/USD from Chainlink)
```

## Security Considerations

### Attack Vectors

**1. Oracle Manipulation**
- **Risk**: Attacker manipulates DEX price
- **Mitigation**: 
  - Multi-pool aggregation
  - 50% deviation limit in oracle
  - 10% fee margin in paymaster
  - TWAP for larger trades

**2. Stale Prices**
- **Risk**: Bot goes down, prices become stale
- **Mitigation**:
  - 1-hour staleness threshold
  - Paymaster auto-pauses
  - Multiple redundant bots
  - Manual override available

**3. Front-Running**
- **Risk**: MEV bots exploit price updates
- **Mitigation**:
  - Price updates are public (no surprise)
  - Fee margin absorbs small moves
  - Flashbots can be used

**4. Bot Compromise**
- **Risk**: Bot wallet private key leaked
- **Mitigation**:
  - Bot wallet is low-privilege (only updates oracle)
  - Can't steal funds or change parameters
  - Rate limited (max 1 update/minute)
  - Owner can change bot address

### Safety Features

All our oracle implementations include:

1. **Price Bounds**: Reject unreasonable prices
2. **Deviation Limits**: Max 50% change per update
3. **Staleness Detection**: Reject old data
4. **Rate Limiting**: Prevent spam updates
5. **Pause Mechanism**: Emergency stop
6. **Multi-sig Owner**: Governance control

## FAQs

### Q: What if the bot goes down?

**A:** Multiple layers of protection:
1. Oracle stays fresh for 1 hour (plenty of time)
2. Paymaster automatically pauses if stale
3. Run 2-3 redundant bots
4. Manual emergency update available
5. You'll get alerts within minutes

### Q: Can someone manipulate the DEX price?

**A:** Very difficult:
1. Bot aggregates multiple DEX pools
2. Oracle rejects >50% moves
3. Paymaster has 10% fee margin
4. Would need to manipulate multiple pools simultaneously
5. Not economically viable for attacker

### Q: Why not just use Chainlink?

**A:** Three reasons:
1. Chainlink not available on L3s (yet)
2. Very expensive for custom feeds
3. ElizaOS price feed doesn't exist

For ETH/USD we DO use Chainlink (on Base), just read it via our bot.

### Q: Is a price bot "centralized"?

**A:** Technically yes, but:
1. Bot is open-source (anyone can verify)
2. Multiple bots can run (decentralization)
3. Bot is low-privilege (can't steal funds)
4. Owner can change bot if compromised
5. All major protocols started this way (Uniswap, Aave, Compound)

True decentralization is a spectrum. We start practical, migrate to more decentralized over time.

### Q: What's the latency?

**A:** 
- Price Bot: 5 minutes (configurable down to 1 minute)
- Cross-Chain: 1-2 minutes (L2→L3 message passing)
- Chainlink: 1 hour (or 0.5% deviation)

5-minute latency is fine because:
- Paymaster has 10% fee margin
- Crypto prices don't move >10% in 5 minutes often
- If they do, deviation limit prevents exploits

## Next Steps

1. ✅ **Deploy Price Bot** (30 minutes)
   ```bash
   cd contracts && forge script script/DeployLiquiditySystem.s.sol --broadcast
   bun run scripts/deploy-oracle.ts
   bun run oracle:start
   ```

2. ⏳ **Set up monitoring** (1 hour)
   - Configure Telegram/Discord alerts
   - Set up Grafana dashboards
   - Create runbooks for incidents

3. ⏳ **Deploy redundant bots** (30 minutes)
   - AWS + DigitalOcean + Hetzner
   - Different providers = true redundancy

4. 🔮 **Plan migration to cross-chain** (future)
   - When TVL > $10M
   - When community requests it
   - Keep bot as backup

## Resources

- 📖 [Oracle Setup Guide](../deployment/oracle-setup.md)
- 💻 [Price Bot Source](../../scripts/oracle-updater.ts)
- 🔗 [Chainlink Base Feeds](https://docs.chain.link/data-feeds/price-feeds/addresses?network=base)
- 🦄 [Uniswap V3 SDK](https://docs.uniswap.org/sdk/v3/overview)
- 🔗 [OP Stack Messaging](https://docs.optimism.io/builders/app-developers/bridging/messaging)

---

**TL;DR**: Use the automated price bot. It's fast, cheap, reliable, and what everyone uses at launch. Migrate to cross-chain oracle later if needed.

