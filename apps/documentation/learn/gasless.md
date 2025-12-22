# Gasless Transactions

On Jeju, users never need ETH. They pay gas in USDC, JEJU, or any token — or your app pays for them.

## How It Works

Jeju uses [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) with custom paymasters:

1. User signs a transaction (no ETH balance needed)
2. Paymaster checks user has payment token
3. Bundler submits to chain, paymaster pays ETH for gas
4. User's payment token is transferred to paymaster

```
User (no ETH) → Paymaster (pays ETH) → Blockchain
                    ↑
              User pays in USDC
              (or free if sponsored)
```

## Two Options

### Option 1: User Pays in Token

User needs USDC, JEJU, or another registered token. They pay gas from that balance.

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits } from 'viem';

const jeju = await createJejuClient({ 
  network: 'mainnet', 
  privateKey: '0x...' 
});

// Any transaction — gas paid in USDC
await jeju.payments.payWithToken({
  to: '0x...',
  data: '0x...',
  gasToken: 'USDC', // or 'JEJU', 'WETH', etc.
});

// Swap with gas in USDC
await jeju.defi.swap({
  tokenIn: 'USDC',
  tokenOut: 'JEJU',
  amountIn: parseUnits('100', 6),
  gasToken: 'USDC',
});
```

**Supported tokens:** USDC, JEJU, WETH, and any token registered via Gateway.

### Option 2: You Sponsor Gas

Your app pays gas for users. Users don't pay anything.

```typescript
import { parseEther } from 'viem';

// 1. Deploy your paymaster (one time)
const paymaster = await jeju.payments.deployPaymaster({
  name: 'My App Paymaster',
});

console.log('Paymaster:', paymaster.address);

// 2. Fund it with ETH (this pays for user gas)
await jeju.payments.fundPaymaster({
  paymaster: paymaster.address,
  amount: parseEther('1'), // Sponsors ~10,000 simple transactions
});

// 3. Your users transact for FREE
await jeju.payments.sponsoredCall({
  paymaster: paymaster.address,
  to: yourContractAddress,
  data: calldata,
});
```

## Cost Breakdown

| Transaction Type | Approximate Gas Cost |
|------------------|---------------------|
| Simple transfer | 0.00005 ETH (~$0.10) |
| ERC-20 transfer | 0.00008 ETH (~$0.15) |
| Swap | 0.00015 ETH (~$0.30) |
| Complex DeFi | 0.0003 ETH (~$0.60) |

**1 ETH sponsors ~10,000 simple transactions** or ~3,000 swaps.

## For DApp Developers

### Step 1: Deploy Paymaster

```bash
# Via CLI
jeju paymaster deploy --name "My App"

# Or via SDK
const paymaster = await jeju.payments.deployPaymaster({
  name: 'My App Paymaster',
});
```

### Step 2: Fund It

```typescript
await jeju.payments.fundPaymaster({
  paymaster: paymasterAddress,
  amount: parseEther('1'),
});
```

### Step 3: (Optional) Whitelist Contracts

Only sponsor gas for specific contracts:

```typescript
await jeju.payments.whitelistContract({
  paymaster: paymasterAddress,
  contract: myContractAddress,
});
```

### Step 4: Set Spend Limits

Prevent abuse:

```typescript
await jeju.payments.setSpendLimit({
  paymaster: paymasterAddress,
  perTransaction: parseEther('0.001'), // Max 0.001 ETH per tx
  daily: parseEther('0.1'), // Max 0.1 ETH per day
});
```

### Step 5: Users Transact Free

```typescript
// In your frontend
await jeju.payments.sponsoredCall({
  paymaster: paymasterAddress,
  to: myContract,
  data: calldata,
});
```

## Token Pricing

Paymaster uses Chainlink oracles:

```
tokenAmount = (gasUsed × gasPrice × tokenPrice) / ethPrice × 1.2
```

The 1.2× buffer covers price fluctuations during tx processing.

## Register a New Token

Register your token for gas payments via Gateway UI, or:

```typescript
await jeju.payments.registerToken({
  token: myTokenAddress,
  oracle: chainlinkOracleAddress, // Must be Chainlink-compatible
  minLiquidity: parseEther('10000'), // Token must have this much liquidity
});
```

Requirements:
- Chainlink-compatible price oracle
- Minimum liquidity threshold
- Registration fee (100 JEJU)

## Smart Contract Integration

If you're writing Solidity, users can call your contract normally. The SDK handles paymaster logic:

```solidity
// Your contract doesn't change
function doSomething(uint256 amount) external {
    // Normal logic
    // User doesn't need ETH — SDK + paymaster handle gas
}
```

## Monitoring Your Paymaster

```typescript
// Check balance
const balance = await jeju.payments.getPaymasterBalance(paymasterAddress);
console.log('ETH remaining:', balance);

// Get usage stats
const stats = await jeju.payments.getPaymasterStats(paymasterAddress);
console.log('Transactions sponsored:', stats.txCount);
console.log('ETH spent:', stats.totalSpent);
```

Set up alerts when balance is low:

```typescript
if (balance < parseEther('0.1')) {
  // Send alert, auto-refill, etc.
}
```

## Best Practices

1. **Set spend limits** — Prevent single users from draining your paymaster
2. **Whitelist contracts** — Only sponsor your own contracts
3. **Monitor balance** — Set up low-balance alerts
4. **Rate limit** — Use IP or wallet-based rate limiting in your app

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Gasless Transactions

How it works:
- User signs tx (no ETH needed)
- Paymaster pays ETH gas
- User pays in token (or free if sponsored)

Option 1 — User pays in token:
await jeju.payments.payWithToken({
  to, data, gasToken: 'USDC'
});

Option 2 — You sponsor:
const paymaster = await jeju.payments.deployPaymaster({ name: 'My App' });
await jeju.payments.fundPaymaster({ paymaster: address, amount: parseEther('1') });
await jeju.payments.sponsoredCall({ paymaster: address, to, data });

Costs:
- Simple transfer: ~0.00005 ETH
- ERC-20 transfer: ~0.00008 ETH
- Swap: ~0.00015 ETH
- 1 ETH sponsors ~10,000 simple txs

Setup for DApps:
1. Deploy paymaster
2. Fund with ETH
3. Optional: whitelist contracts, set spend limits
4. Users transact free

Supported tokens: USDC, JEJU, WETH, any registered token
Token pricing: (gas × gasPrice × tokenPrice) / ethPrice × 1.2
```

</details>
