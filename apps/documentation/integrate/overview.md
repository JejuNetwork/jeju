# Cross-Chain Integration

Add Jeju as a destination for your wallet, bridge, or DEX.

## Two Systems

| System | Use case | Speed |
|--------|----------|-------|
| **EIL** | Token transfers | ~30 seconds |
| **OIF** | Cross-chain swaps | ~10 minutes |

**EIL** (Ethereum Interop Layer): Liquidity providers front funds instantly.

**OIF** (Open Intents Framework): Solvers compete to fill complex intents.

## Quick Integration

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits, parseEther } from 'viem';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// Bridge ETH from Ethereum (EIL)
await jeju.crosschain.transfer({
  from: 'ethereum',
  to: 'jeju',
  token: 'ETH',
  amount: parseEther('1'),
});

// Cross-chain swap (OIF)
await jeju.crosschain.createIntent({
  sourceChain: 8453,
  inputToken: '0x...', // USDC on Base
  inputAmount: parseUnits('100', 6),
  outputChain: 420691,
  outputToken: '0x...', // JEJU
  minOutputAmount: parseUnits('95', 18),
  deadline: Math.floor(Date.now() / 1000) + 3600,
});
```

## Supported Chains

| Chain | Chain ID | Status |
|-------|----------|--------|
| Ethereum | 1 | Live |
| Base | 8453 | Live |
| Jeju Mainnet | 420691 | Live |
| Jeju Testnet | 420690 | Live |
| Base Sepolia | 84532 | Live |
| Ethereum Sepolia | 11155111 | Live |

## For Wallets

Add "Bridge to Jeju":

```typescript
const tx = await jeju.crosschain.transfer({
  from: 'ethereum',
  to: 'jeju',
  token: 'ETH',
  amount: userAmount,
});

const receipt = await jeju.crosschain.waitForTransfer(tx.hash);
```

## For Bridges

Add Jeju as destination. Use our contracts or run your own XLP.

→ [EIL Details](/integrate/eil)

## For DEX Aggregators

Add Jeju routes via OIF intents.

→ [OIF Details](/integrate/oif)

## For Liquidity Providers

Earn fees by providing liquidity:

| Role | What you do | Earnings |
|------|-------------|----------|
| **XLP** | Front bridge liquidity | 0.1-0.3% per transfer |
| **Solver** | Fill intents | Spread |

→ [XLP Guide](/operate/xlp)
→ [Solver Guide](/operate/solver)

## Fees

| Action | Fee |
|--------|-----|
| EIL transfer | 0.1-0.3% (to XLP) |
| OIF intent | 0.1% protocol + solver spread |

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Cross-Chain

Two systems:
- EIL: Token bridging, ~30s, LPs front liquidity
- OIF: Complex swaps, ~10min, solvers compete

SDK:
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits, parseEther } from 'viem';

// Bridge (EIL)
await jeju.crosschain.transfer({ from: 'ethereum', to: 'jeju', token: 'ETH', amount });

// Swap (OIF)
await jeju.crosschain.createIntent({
  sourceChain, inputToken, inputAmount,
  outputChain, outputToken, minOutputAmount, deadline
});

Chains: Ethereum (1), Base (8453), Jeju (420691/420690)
Fees: 0.1-0.3% EIL, 0.1% + spread OIF
```

</details>
