# Gasless Transactions

Users can pay gas in any token, or your app can pay for them.

## How It Works

Jeju uses ERC-4337 paymasters:

1. User signs a transaction
2. Paymaster pays the gas in ETH
3. User pays paymaster in their chosen token (or nothing if sponsored)

## Two Options

### Option 1: User Pays in Token

User pays gas in USDC, JEJU, or any registered token instead of ETH:

```typescript
import { createJejuClient } from '@jejunetwork/sdk';

const jeju = await createJejuClient({
  network: 'testnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

await jeju.payments.payWithToken({
  to: contractAddress,
  data: calldata,
  gasToken: 'USDC',
});
```

### Option 2: You Sponsor Gas

Your app pays gas so users transact for free:

```typescript
import { parseEther } from 'viem';

// 1. Deploy a paymaster (one time)
const paymaster = await jeju.payments.deployPaymaster({
  name: 'My App Paymaster',
});

// 2. Fund it with ETH
await jeju.payments.fundPaymaster({
  paymaster: paymaster.address,
  amount: parseEther('1'),
});

// 3. Sponsor user transactions
await jeju.payments.sponsoredCall({
  paymaster: paymaster.address,
  to: contractAddress,
  data: calldata,
});
```

## Cost

| Transaction Type | Gas Cost |
|------------------|----------|
| Simple transfer | ~0.0001 ETH |
| Swap | ~0.0002 ETH |
| Complex contract | ~0.0003-0.001 ETH |

1 ETH sponsors roughly 10,000 simple transactions.

## Registered Tokens

These tokens can be used for gas:

| Token | Status |
|-------|--------|
| USDC | ✅ |
| USDT | ✅ |
| JEJU | ✅ |
| DAI | ✅ |

Register your token via Gateway → Token Registry.

## Paymaster Types

| Type | Description |
|------|-------------|
| **TokenPaymaster** | Users pay in registered tokens |
| **SponsoredPaymaster** | App sponsors all gas |
| **ConditionalPaymaster** | Sponsor based on conditions |

## Managing Paymasters

```typescript
// Check balance
const balance = await jeju.payments.getPaymasterBalance(paymasterAddress);

// Add more funds
await jeju.payments.fundPaymaster({
  paymaster: paymasterAddress,
  amount: parseEther('0.5'),
});

// Withdraw funds
await jeju.payments.withdrawFromPaymaster({
  paymaster: paymasterAddress,
  amount: parseEther('0.1'),
});
```

## Contracts

| Contract | Address (Testnet) |
|----------|-------------------|
| EntryPoint | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| TokenPaymaster | `0x...` |

## Best Practices

1. **Set spending limits** — Prevent abuse by setting daily limits
2. **Monitor usage** — Track sponsorship costs
3. **Use allowlists** — Only sponsor for verified users/contracts

---

<details>
<summary>📋 Copy as Context</summary>

```
Gasless Transactions

Two options:
1. User pays in token: jeju.payments.payWithToken({ gasToken: 'USDC' })
2. You sponsor: jeju.payments.sponsoredCall({ paymaster })

Sponsor setup:
const paymaster = await jeju.payments.deployPaymaster({ name });
await jeju.payments.fundPaymaster({ paymaster: paymaster.address, amount: parseEther('1') });
await jeju.payments.sponsoredCall({ paymaster: paymaster.address, to, data });

Cost: ~0.0001 ETH per simple tx, 1 ETH sponsors ~10,000 txs
Supported tokens: USDC, USDT, JEJU, DAI
```

</details>
