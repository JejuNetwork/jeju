# EIL (Ethereum Interop Layer)

Instant cross-chain transfers via liquidity providers.

## How It Works

1. User deposits on source chain (Ethereum/Base)
2. XLP (liquidity provider) sees deposit
3. XLP credits user instantly on Jeju
4. XLP claims deposit from source chain later

Transfer time: ~30 seconds.

## For Users

Use the SDK:

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseEther } from 'viem';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

await jeju.crosschain.transfer({
  from: 'ethereum',
  to: 'jeju',
  token: 'ETH',
  amount: parseEther('1'),
});

// Wait for completion
const receipt = await jeju.crosschain.waitForTransfer(tx.hash);
```

## For DApps

Add bridging to your app:

```typescript
// Show available liquidity
const liquidity = await jeju.crosschain.getAvailableLiquidity({
  from: 'ethereum',
  to: 'jeju',
  token: 'ETH',
});

// Check fee
const fee = await jeju.crosschain.estimateFee({
  from: 'ethereum',
  to: 'jeju',
  token: 'ETH',
  amount: parseEther('1'),
});

// Execute
const tx = await jeju.crosschain.transfer({
  from: 'ethereum',
  to: 'jeju',
  token: 'ETH',
  amount: parseEther('1'),
});
```

## For XLPs (Liquidity Providers)

Provide liquidity and earn fees.

### Requirements

- 1 ETH stake
- Liquidity capital on Jeju (minimum 5 ETH worth)
- Running infrastructure

### Register

```typescript
import { parseEther } from 'viem';

await jeju.staking.registerXLP({
  stake: parseEther('1'),
  chains: ['ethereum', 'base'],
  tokens: ['ETH', 'USDC'],
});
```

### Provide Liquidity

```typescript
await jeju.crosschain.provideLiquidity({
  token: 'ETH',
  amount: parseEther('10'),
});
```

### Run XLP Bot

```bash
cd packages/bridge
bun run xlp
```

The bot:
- Monitors source chains for deposits
- Credits users on Jeju
- Claims deposits from source chains
- Manages liquidity across chains

### Earnings

XLPs earn 0.1-0.3% per transfer.

| Transfer Size | Fee | XLP Earnings |
|---------------|-----|--------------|
| 1 ETH | 0.002 ETH | 0.002 ETH |
| 10 ETH | 0.02 ETH | 0.02 ETH |
| 100 ETH | 0.2 ETH | 0.2 ETH |

## Contracts

| Contract | Description |
|----------|-------------|
| `L1StakeManager` | Manages XLP stakes on L1 |
| `CrossChainPaymaster` | Handles credits on Jeju |
| `LiquidityPaymaster` | Manages liquidity pools |

### Testnet Addresses

| Contract | Address |
|----------|---------|
| L1StakeManager (Sepolia) | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| CrossChainPaymaster (Jeju) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |

## Supported Tokens

| Token | Ethereum | Base | Jeju |
|-------|----------|------|------|
| ETH | ✅ | ✅ | ✅ |
| USDC | ✅ | ✅ | ✅ |
| USDT | ✅ | ✅ | ✅ |
| WBTC | ✅ | — | ✅ |

## Slashing

XLPs can be slashed for:

| Offense | Penalty |
|---------|---------|
| Failure to credit within 5 minutes | 10% |
| Invalid credit amount | 25% |
| Fraud | 100% |

---

<details>
<summary>📋 Copy as Context</summary>

```
EIL - Instant Bridging

How it works:
1. User deposits on source chain
2. XLP sees deposit
3. XLP credits user on Jeju instantly
4. XLP claims deposit later

For users:
await jeju.crosschain.transfer({
  from: 'ethereum', to: 'jeju', token: 'ETH', amount: parseEther('1')
});

For XLPs:
await jeju.staking.registerXLP({ stake: parseEther('1'), chains, tokens });
await jeju.crosschain.provideLiquidity({ token, amount });
Run: cd packages/bridge && bun run xlp

Earnings: 0.1-0.3% per transfer
Time: ~30 seconds
Tokens: ETH, USDC, USDT, WBTC
```

</details>
