# OIF (Open Intents Framework)

Cross-chain swaps via solver competition.

## How It Works

1. User creates intent (what they want, not how)
2. Solvers compete to fill it
3. Winning solver executes on destination
4. Oracle verifies and settles

Time: ~10 minutes.

## For Users

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits } from 'viem';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// Create intent: swap USDC on Base for JEJU on Jeju
const intentHash = await jeju.crosschain.createIntent({
  sourceChain: 8453, // Base
  inputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  inputAmount: parseUnits('100', 6),
  outputChain: 420691, // Jeju
  outputToken: '0x...', // JEJU
  minOutputAmount: parseUnits('95', 18),
  deadline: Math.floor(Date.now() / 1000) + 3600,
});

// Check status
const status = await jeju.crosschain.getIntentStatus(intentHash);
// 'pending' | 'filled' | 'expired' | 'settled'
```

## For DApps

Add cross-chain swaps:

```typescript
// Get quote
const quote = await jeju.crosschain.quoteIntent({
  sourceChain: 8453,
  inputToken: USDC_BASE,
  inputAmount: parseUnits('100', 6),
  outputChain: 420691,
  outputToken: JEJU,
});

console.log('Expected output:', quote.expectedOutput);
console.log('Fee:', quote.fee);

// Create intent
const hash = await jeju.crosschain.createIntent({
  ...quote.params,
  minOutputAmount: quote.expectedOutput * 0.95n,
  deadline: Math.floor(Date.now() / 1000) + 3600,
});

// Track
await jeju.crosschain.waitForIntent(hash);
```

## For Solvers

Fill intents and earn the spread.

### Requirements

- 0.5 ETH stake
- Liquidity on destination chains
- Running infrastructure

### Register

```typescript
import { parseEther } from 'viem';

await jeju.staking.registerSolver({
  stake: parseEther('0.5'),
  chains: [8453, 420691],
  tokens: ['USDC', 'JEJU'],
});
```

### Run Solver Bot

```bash
cd packages/bridge
bun run solver
```

The bot:
- Monitors for new intents
- Quotes and fills profitable intents
- Claims settlement from source chain

### Filling Intents

```typescript
// Subscribe to intents
jeju.crosschain.onIntent(async (intent) => {
  // Check profitability
  const profit = calculateProfit(intent);
  if (profit < minProfit) return;

  // Fill
  await jeju.crosschain.fillIntent({
    intentHash: intent.hash,
    fillAmount: intent.outputAmount,
  });
});
```

### Earnings

Solvers earn the spread between user's minOutput and actual execution.

Example:
- User wants: min 95 JEJU for 100 USDC
- Market rate: 100 USDC = 98 JEJU
- Solver fills at 95 JEJU
- Solver profit: 3 JEJU

## Contracts

| Contract | Description |
|----------|-------------|
| `InputSettler` | Locks user funds on source chain |
| `OutputSettler` | Releases funds on destination |
| `SolverRegistry` | Manages solver registration |
| `OracleAdapter` | Verifies cross-chain execution |

### Testnet Addresses

| Contract | Chain | Address |
|----------|-------|---------|
| InputSettler | Sepolia | `0x742d35Cc6634C0532925a3b844Bc9e7595f7a1B2` |
| OutputSettler | Jeju | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| SolverRegistry | Jeju | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |

## Supported Routes

| Source | Destination | Tokens |
|--------|-------------|--------|
| Ethereum | Jeju | ETH, USDC, USDT |
| Base | Jeju | ETH, USDC |
| Jeju | Ethereum | ETH, USDC, USDT |
| Jeju | Base | ETH, USDC |

## Fees

| Component | Fee |
|-----------|-----|
| Protocol | 0.1% |
| Solver | Spread |

---

<details>
<summary>📋 Copy as Context</summary>

```
OIF - Cross-Chain Intents

How it works:
1. User creates intent
2. Solvers compete to fill
3. Winner executes on destination
4. Oracle verifies

For users:
const hash = await jeju.crosschain.createIntent({
  sourceChain: 8453,
  inputToken, inputAmount,
  outputChain: 420691,
  outputToken, minOutputAmount,
  deadline
});

For solvers:
await jeju.staking.registerSolver({ stake: parseEther('0.5'), chains, tokens });
Run: cd packages/bridge && bun run solver

Contracts:
- InputSettler: Locks funds on source
- OutputSettler: Releases on destination
- SolverRegistry: Manages solvers

Fees: 0.1% protocol + solver spread
Time: ~10 minutes
```

</details>
