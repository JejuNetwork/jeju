# Agent Task: Bots Package Documentation

## Scope
Research and document the Bots package (`packages/bots/`).

## Source Files to Analyze
- `packages/bots/src/` - All source files
- `packages/bots/src/strategies/` - Trading strategies
- `packages/bots/src/oracles/` - Price oracles
- `packages/bots/src/simulation/` - Backtesting
- `packages/bots/package.json` - Dependencies

## Research Questions
1. What types of bots are supported?
2. What trading strategies are implemented?
3. How does the bot engine work?
4. How do oracles provide pricing?
5. How does simulation/backtesting work?
6. How do bots integrate with Jeju DeFi?
7. What configuration options exist?
8. How do bots manage risk?

## Output Format

### File: `apps/documentation/packages/bots.md`

```markdown
# Bots Package

[One-sentence description - automated trading and arbitrage bots]

## Overview

[Bot framework, strategies, use cases]

## Bot Types

### Arbitrage Bot
[Cross-DEX arbitrage]

### Market Making Bot
[Liquidity provision]

### Liquidation Bot
[Collateral liquidation]

## Strategies

### Available Strategies
[List of implemented strategies]

### Custom Strategies
[How to implement custom strategies]

## Usage

\`\`\`typescript
import { BotEngine, ArbitrageStrategy } from '@jejunetwork/bots';

const bot = new BotEngine({
  network: 'mainnet',
  privateKey: process.env.BOT_PRIVATE_KEY,
});

bot.use(new ArbitrageStrategy({
  minProfit: 0.001, // 0.1%
  maxSlippage: 0.005,
}));

await bot.start();
\`\`\`

## Oracles

[Price feed integration]

## Simulation

[Backtesting strategies]

## Risk Management

[Position limits, stop losses]

## Related

- [DeFi Contracts](/contracts/defi)
- [SDK DeFi](/build/sdk/defi)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/bots.md`

