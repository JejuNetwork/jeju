# Cross-Chain Integration

Add Jeju as a destination chain for your protocol, wallet, or bridge.

## Two Systems

| System | Best for | Speed | How it works |
|--------|----------|-------|--------------|
| **EIL** | Token bridging | ~30 seconds | Liquidity providers front funds instantly |
| **OIF** | Complex swaps | ~10 minutes | Solvers compete to fill your intent |

Most integrations use **EIL** for simple transfers and **OIF** for cross-chain swaps.

## Quick Integration (SDK)

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits, parseEther } from 'viem';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// Bridge ETH from Ethereum to Jeju (EIL — instant)
await jeju.crosschain.transfer({
  from: 'ethereum',
  to: 'jeju',
  token: 'ETH',
  amount: parseEther('1'),
});

// Swap USDC on Base for JEJU on Jeju (OIF — solver fills)
await jeju.crosschain.createIntent({
  sourceChain: 8453, // Base
  inputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  inputAmount: parseUnits('100', 6),
  outputChain: 420691, // Jeju
  outputToken: '0x...', // JEJU token
  minOutputAmount: parseUnits('95', 18), // Willing to accept 95 JEJU
  deadline: Math.floor(Date.now() / 1000) + 3600,
});
```

## Supported Chains

| Chain | Chain ID | Status |
|-------|----------|--------|
| Ethereum Mainnet | 1 | ✅ Live |
| Base | 8453 | ✅ Live |
| Jeju Mainnet | 420691 | ✅ Live |
| Jeju Testnet | 420690 | ✅ Live |
| Base Sepolia | 84532 | ✅ Live |
| Ethereum Sepolia | 11155111 | ✅ Live |

## Contract Addresses (Testnet)

Use these for testnet integration:

| Contract | Address |
|----------|---------|
| InputSettler (Sepolia) | `0x742d35Cc6634C0532925a3b844Bc9e7595f7a1B2` |
| OutputSettler (Jeju) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| SolverRegistry (Jeju) | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| L1StakeManager (Sepolia) | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| CrossChainPaymaster (Jeju) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |

::: warning
Mainnet addresses will be published at launch. Join Discord for updates.
:::

## Integration Paths

### If you're a Wallet

Add "Bridge to Jeju" button:

```typescript
// User clicks "Bridge to Jeju"
const tx = await jeju.crosschain.transfer({
  from: 'ethereum',
  to: 'jeju',
  token: 'ETH',
  amount: userAmount,
});

// Wait for confirmation (usually <30s)
const receipt = await jeju.crosschain.waitForTransfer(tx.hash);
```

### If you're a Bridge

Add Jeju as destination. Use our contracts or run your own XLP:

→ [EIL Integration](/integrate/eil)

### If you're a DEX Aggregator

Add Jeju routes via OIF intents:

→ [OIF Integration](/integrate/oif)

### If you want to Earn

Provide liquidity (XLP) or fill intents (Solver):

→ [Become XLP](/integrate/eil#for-xlps-liquidity-providers)
→ [Become Solver](/integrate/oif#for-solvers)

## Economics

| Role | Requirement | Expected Earnings |
|------|-------------|-------------------|
| XLP | 1 ETH stake + liquidity | 0.1-0.3% per transfer |
| Solver | 0.5 ETH stake + liquidity | Spread on fills |
| Protocol | — | 0.05% fee |

## Fees

| Action | Fee |
|--------|-----|
| EIL transfer | 0.1-0.3% (goes to XLP) |
| OIF intent | 0.1% protocol + solver spread |

## Next Steps

- [EIL Deep Dive](/integrate/eil) — Instant bridging for LPs
- [OIF Deep Dive](/integrate/oif) — Intent system for solvers
- [SDK Reference](/packages/sdk) — Full API docs

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Cross-Chain Integration

Two systems:
- EIL: Token bridging, ~30s, LPs front liquidity
- OIF: Complex swaps, ~10min, solvers compete

SDK:
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits, parseEther } from 'viem';

// Bridge (EIL)
await jeju.crosschain.transfer({ from: 'ethereum', to: 'jeju', token: 'ETH', amount: parseEther('1') });

// Swap (OIF)
await jeju.crosschain.createIntent({
  sourceChain: 8453, inputToken: USDC_BASE, inputAmount: parseUnits('100', 6),
  outputChain: 420691, outputToken: JEJU, minOutputAmount: parseUnits('95', 18),
  deadline: Math.floor(Date.now()/1000) + 3600
});

Testnet contracts:
- InputSettler (Sepolia): 0x742d35Cc6634C0532925a3b844Bc9e7595f7a1B2
- OutputSettler (Jeju): 0x5FbDB2315678afecb367f032d93F642f64180aa3
- SolverRegistry (Jeju): 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512

Chains: Ethereum (1), Base (8453), Jeju (420691/420690), Base Sepolia (84532), Sepolia (11155111)

Fees: 0.1-0.3% EIL, 0.1% + spread OIF
Earnings: XLP 0.1-0.3% per transfer, Solver spread
```

</details>
