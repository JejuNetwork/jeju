# Agent Task: EIL/OIF Integration Documentation

## Scope
Write comprehensive documentation for cross-chain intents and liquidity integration.

## Source Files to Analyze
- `packages/contracts/src/oif/` - OIF contracts
- `packages/contracts/src/eil/` - EIL contracts
- `apps/documentation/contracts/eil.md` - Existing EIL docs
- `apps/documentation/contracts/oif.md` - Existing OIF docs
- `scripts/shared/eil.ts` - EIL utilities
- `scripts/deploy/eil.ts` - EIL deployment
- `scripts/deploy/oif.ts` - OIF deployment

## Research Questions
1. How does EIL enable instant bridging?
2. How does OIF enable cross-chain intents?
3. What is the full intent lifecycle?
4. How do solvers interact with the system?
5. What is the XLP flow?
6. What oracles are used?
7. What slashing conditions exist?
8. How do integrating projects use these?

## Output Files

### 1. `apps/documentation/integrate/overview.md`

```markdown
# Integration Overview

Integrate cross-chain capabilities into your project.

## What You Can Integrate

### EIL (Ethereum Interop Layer)
Instant cross-chain transfers without traditional bridge delays.

### OIF (Open Intents Framework)
Express user intents on any chain, fulfilled on Jeju.

## Use Cases

### For DApps
Accept payments from any chain instantly.

### For Bridges
Integrate Jeju as a destination chain.

### For Wallets
Offer cross-chain swaps.

### For Market Makers
Earn fees as solver or XLP.

## Quick Start

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({ network: 'mainnet' });

// Create cross-chain intent
await client.crosschain.createIntent({
  sourceChain: 8453, // Base
  inputToken: USDC_BASE,
  inputAmount: parseUnits('100', 6),
  outputToken: USDC_JEJU,
  minOutputAmount: parseUnits('99.5', 6),
});
\`\`\`

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/integrate/eil.md`

```markdown
# EIL Integration

Integrate Ethereum Interop Layer for instant cross-chain transfers.

## How EIL Works

1. User deposits on source chain (L1)
2. XLP sees deposit, provides liquidity on L2
3. User receives funds instantly on L2
4. XLP claims from L1 after message finality

## For DApp Developers

### Accept Cross-Chain Payments

\`\`\`typescript
import { EILClient } from '@jejunetwork/sdk';

const eil = new EILClient({
  l1Rpc: 'https://eth-mainnet.g.alchemy.com/v2/...',
  l2Rpc: 'https://rpc.jejunetwork.org',
});

// Monitor for user deposits
eil.onDeposit(async (deposit) => {
  console.log(`User ${deposit.user} deposited ${deposit.amount}`);
  // Credit user in your app
});
\`\`\`

### Initiate Deposits

\`\`\`typescript
const tx = await eil.deposit({
  amount: parseEther('1'),
  destinationChain: 420691,
  recipient: userAddress,
});
\`\`\`

## For XLPs

### Register as XLP

\`\`\`bash
cast send $L1_STAKE_MANAGER "register(uint256[])" "[420691]" \
  --value 1ether --rpc-url $L1_RPC --private-key $PK
\`\`\`

### Run XLP Bot

\`\`\`typescript
import { XLPBot } from '@jejunetwork/bots';

const bot = new XLPBot({
  privateKey: process.env.XLP_PRIVATE_KEY,
  minProfit: 0.001, // 0.1%
});

await bot.start();
\`\`\`

## Contracts

| Contract | Mainnet | Testnet |
|----------|---------|---------|
| L1StakeManager | `0x...` | `0x...` |
| CrossChainPaymaster | `0x...` | `0x...` |

## Economics

| Fee Type | Amount |
|----------|--------|
| XLP Spread | 0.1-0.5% |
| Protocol Fee | 0.05% |

## Slashing

XLPs are slashed for:
- Failing to credit users
- Double-crediting (fraud)
- Providing incorrect amounts

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 3. `apps/documentation/integrate/oif.md`

```markdown
# OIF Integration

Integrate Open Intents Framework for cross-chain intents.

## How OIF Works

1. User creates intent on source chain (InputSettler)
2. Solvers see intent via indexer/websocket
3. Solver fills on destination chain (OutputSettler)
4. Oracle verifies source chain state
5. Solver claims payment from InputSettler

## For DApp Developers

### Create Cross-Chain Intent

\`\`\`typescript
import { OIFClient } from '@jejunetwork/sdk';

const oif = new OIFClient({ network: 'mainnet' });

const intent = await oif.createIntent({
  sourceChain: 8453, // Base
  inputToken: USDC_BASE,
  inputAmount: parseUnits('100', 6),
  outputChain: 420691, // Jeju
  outputToken: USDC_JEJU,
  minOutputAmount: parseUnits('99', 6),
  deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour
});
\`\`\`

### Monitor Intent Status

\`\`\`typescript
const status = await oif.getIntentStatus(intentHash);
// 'pending' | 'filled' | 'expired' | 'settled'
\`\`\`

## For Solvers

### Register as Solver

\`\`\`typescript
await oif.registerSolver({
  stake: parseEther('0.5'),
  chains: [1, 8453, 420691],
});
\`\`\`

### Fill Intents

\`\`\`typescript
import { SolverBot } from '@jejunetwork/bots';

const solver = new SolverBot({
  privateKey: process.env.SOLVER_PRIVATE_KEY,
  chains: ['ethereum', 'base', 'jeju'],
  minProfitBps: 10, // 0.1%
});

await solver.start();
\`\`\`

## Contracts

| Contract | Chain | Address |
|----------|-------|---------|
| InputSettler | Base Sepolia | `0x...` |
| InputSettler | Ethereum | `0x...` |
| OutputSettler | Jeju | `0x...` |
| SolverRegistry | Jeju | `0x...` |

## Supported Chains

| Chain | Chain ID | Role |
|-------|----------|------|
| Ethereum | 1 | Source |
| Base | 8453 | Source |
| Jeju Mainnet | 420691 | Source + Destination |
| Jeju Testnet | 420690 | Source + Destination |

## Oracle

OIF uses Hyperlane for cross-chain attestation.

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 4. `apps/documentation/integrate/become-xlp.md`

```markdown
# Become an XLP

Complete guide to becoming a Cross-chain Liquidity Provider.

## Requirements

- 1+ ETH stake on L1
- Liquidity capital for L2
- Server infrastructure
- Technical knowledge

## Step-by-Step Setup

### 1. Prepare Infrastructure
[Server setup, monitoring]

### 2. Stake on L1
\`\`\`bash
cast send $L1_STAKE_MANAGER "register(uint256[])" "[420691]" \
  --value 1ether --rpc-url $L1_RPC --private-key $PK
\`\`\`

### 3. Deposit L2 Liquidity
\`\`\`bash
cast send $CROSS_CHAIN_PAYMASTER "depositETH()" \
  --value 5ether --rpc-url $L2_RPC --private-key $PK
\`\`\`

### 4. Run XLP Bot
[Bot setup]

## Economics

### Revenue Streams
- Spread on transfers (0.1-0.5%)
- Protocol fee share (50%)

### Costs
- L1 gas for staking
- L2 gas for credits
- Infrastructure

### Example P&L
[Monthly P&L example]

## Risk Management

### Capital Efficiency
[How to size liquidity]

### Slashing Avoidance
[Best practices]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 5. `apps/documentation/integrate/become-solver.md`

```markdown
# Become a Solver

Complete guide to becoming an OIF solver.

## Requirements

- 0.5 ETH stake
- Multi-chain RPC access
- Bot infrastructure

## Step-by-Step Setup

### 1. Register

\`\`\`typescript
await client.oif.registerSolver({
  stake: parseEther('0.5'),
  chains: [1, 8453, 420691],
});
\`\`\`

### 2. Run Solver Bot
[Bot configuration]

## Strategies

### Simple Filling
Fill any profitable intent.

### Market Making
Provide liquidity around specific pairs.

### Arbitrage
Cross-DEX arbitrage on fills.

## Economics

[Revenue, costs, profitability]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 6. `apps/documentation/integrate/market-making.md`

```markdown
# Market Making on Jeju

Strategies for market makers on Jeju.

## Opportunities

### AMM Liquidity
Provide LP on Bazaar pools.

### OIF Solving
Fill cross-chain intents.

### XLP
Provide bridge liquidity.

## Integration

[Technical integration details]

## Strategies

[MM strategies for each opportunity]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/integrate.md`

