# Gasless Transactions

How Jeju enables transactions without ETH.

## The Problem

On most blockchains:
1. User needs ETH for gas
2. User must acquire ETH first
3. Friction kills onboarding

## Jeju's Solution

Jeju has **native paymaster support**:
- Users pay gas in any token (USDC, JEJU, etc.)
- Apps can sponsor all user gas
- No ETH required ever

## How It Works

```
Traditional                         With Paymaster
──────────────────────────────────────────────────────────
User has ETH ──► Transaction        User has USDC ──► Transaction
     │                                   │
     ▼                                   ▼
Pay gas in ETH                     Paymaster pays ETH
     │                                   │
     ▼                                   ▼
Transaction executes               User pays Paymaster in USDC
                                         │
                                         ▼
                                   Transaction executes
```

## Two Paymaster Types

### 1. Multi-Token Paymaster

Users choose their gas token:

```typescript
const tx = await wallet.sendTransaction({
  to: recipient,
  value: amount,
  // User pays gas in USDC
  paymaster: MULTI_TOKEN_PAYMASTER,
  paymasterToken: USDC_ADDRESS,
  maxTokenAmount: parseUnits("5", 6), // Max 5 USDC
});
```

**How it works:**
1. Paymaster checks user's USDC balance
2. Queries oracle for ETH/USDC price
3. Calculates required USDC
4. Executes transaction
5. Pulls USDC from user

### 2. Sponsored Paymaster

Apps pay for users:

```typescript
// App creates paymaster
const paymaster = await factory.createSponsoredPaymaster(
  appWallet,
  [gameContract, marketContract], // Contracts to sponsor
);

// App deposits ETH
await paymaster.deposit({ value: parseEther("10") });

// Now all user calls to these contracts are free
```

**Use cases:**
- Onboarding new users
- Game transactions
- Promotional campaigns

## Supported Tokens

| Token | How to Pay |
|-------|------------|
| ETH | Native (no paymaster) |
| USDC | Multi-token paymaster |
| JEJU | Multi-token paymaster |
| elizaOS | Multi-token paymaster |
| Your Token | [Register it](/tutorials/register-token) |

## Integration

### Frontend (wagmi)

```typescript
import { useWriteContract } from 'wagmi';

function GaslessButton() {
  const { writeContract } = useWriteContract();
  
  return (
    <button onClick={() => writeContract({
      address: contractAddress,
      abi: ContractAbi,
      functionName: 'action',
      paymaster: MULTI_TOKEN_PAYMASTER,
      paymasterInput: encodePaymasterInput(USDC, maxAmount),
    })}>
      Execute (Pay in USDC)
    </button>
  );
}
```

### Smart Account SDK

```typescript
import { createSmartAccountClient } from 'permissionless';

const client = createSmartAccountClient({
  account: smartAccount,
  bundlerTransport: http(BUNDLER_URL),
  paymaster: {
    getPaymasterData: async () => ({
      paymaster: MULTI_TOKEN_PAYMASTER,
      paymasterData: encodePaymasterData(USDC, maxAmount),
    }),
  },
});

// All transactions now use USDC for gas
const hash = await client.sendTransaction({ to, value });
```

## Cost Comparison

| Gas Price | ETH Cost | USDC Cost |
|-----------|----------|-----------|
| ~0.001 gwei | ~$0.0001 | ~$0.0001 |

Paymaster adds ~0.001% overhead for oracle query.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| AA21 | Insufficient token balance | Get more tokens |
| AA31 | Paymaster validation failed | Check token/oracle |
| AA33 | Paymaster needs refill | Operator deposits more ETH |

## Best Practices

1. **Quote first** — Show users expected cost before tx
2. **Fallback** — Allow ETH payment if paymaster fails
3. **Set limits** — Cap max gas per transaction
4. **Monitor deposits** — Keep paymasters funded

## Next Steps

- [Tutorial: Gasless NFT](/tutorials/gasless-nft) — Build a gasless app
- [Register a Token](/tutorials/register-token) — Enable your token for gas
- [Core Concepts](/learn/concepts) — Understand ERC-4337

