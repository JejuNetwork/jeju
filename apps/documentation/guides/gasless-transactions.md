# Gasless Transactions

Enable users to transact without holding ETH.

## Overview

Jeju supports gasless transactions via:
- **Multi-token paymasters**: Pay gas in JEJU, USDC, or registered tokens
- **Sponsored paymasters**: Apps pay gas for users
- **x402 payments**: HTTP micropayments cover gas

## ERC-4337 Paymasters

### How It Works

```
User signs UserOperation
        ↓
Bundler submits to EntryPoint
        ↓
EntryPoint calls Paymaster
        ↓
Paymaster validates payment
        ↓
Transaction executes
        ↓
Paymaster receives tokens/payment
```

### Using Multi-Token Paymaster

Users pay gas in any registered token:

```typescript
import { encodeFunctionData } from 'viem';

// Encode your call
const callData = encodeFunctionData({
  abi: SomeContractAbi,
  functionName: 'someFunction',
  args: [arg1, arg2],
});

// Create UserOperation with paymaster
const userOp = {
  sender: smartWalletAddress,
  nonce: await getNonce(smartWalletAddress),
  callData,
  callGasLimit: 100000n,
  verificationGasLimit: 100000n,
  preVerificationGas: 50000n,
  maxFeePerGas: parseGwei('1'),
  maxPriorityFeePerGas: parseGwei('0.1'),
  paymasterAndData: encodePaymasterData(
    MULTI_TOKEN_PAYMASTER,
    USDC_ADDRESS,      // Token to pay with
    parseUnits('10', 6) // Max amount
  ),
};

// Sign and send via bundler
const hash = await bundler.sendUserOperation(userOp);
```

### Supported Tokens

JEJU, USDC, and elizaOS are supported by default. Addresses are in `packages/config/contracts.json`.

Check all tokens:

```bash
curl http://localhost:4003/api/paymasters/tokens
```

## Sponsored Transactions

### App Sponsorship

Apps can sponsor user transactions:

```typescript
// 1. Deploy sponsored paymaster
const paymaster = await factory.createSponsoredPaymaster(
  appAddress,
  [gameContract, marketplaceContract], // Contracts to sponsor
);

// 2. Deposit ETH
await paymaster.deposit({ value: parseEther('1') });

// 3. Whitelist users (optional)
await paymaster.addSponsoredUser(userAddress);
```

### User Experience

Users interact normally - gas is invisible:

```typescript
// From user's perspective - no gas needed
await gameContract.playGame({ value: 0n });
```

## x402 Payments

For pay-per-request APIs:

```typescript
import { X402Client } from '@jeju/x402-client';

const client = new X402Client({ wallet });

// Automatically handles 402 Payment Required
const response = await client.fetch('https://api.example.com/expensive-call', {
  method: 'POST',
  body: JSON.stringify(data),
});
```

## Integration

### Frontend (wagmi + viem)

```typescript
import { useWriteContract, usePrepareContractWrite } from 'wagmi';

function GaslessButton() {
  const { config } = usePrepareContractWrite({
    address: contractAddress,
    abi: ContractAbi,
    functionName: 'action',
    // Include paymaster data
    paymaster: MULTI_TOKEN_PAYMASTER,
    paymasterInput: encodePaymasterInput(USDC, maxAmount),
  });
  
  const { write } = useWriteContract(config);
  
  return <button onClick={() => write()}>Execute (USDC gas)</button>;
}
```

### Smart Wallet SDK

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

// All transactions use USDC for gas
const hash = await client.sendTransaction({
  to: recipient,
  value: amount,
});
```

### Bazaar Hook

```typescript
import { useGasless } from '@jeju/bazaar/hooks';

function TradeButton() {
  const { execute, isLoading, paymentToken, setPaymentToken } = useGasless();
  
  return (
    <>
      <select onChange={(e) => setPaymentToken(e.target.value)}>
        <option value="ETH">ETH</option>
        <option value="USDC">USDC</option>
        <option value="JEJU">JEJU</option>
      </select>
      
      <button onClick={() => execute(swapParams)}>
        Swap (pay gas in {paymentToken})
      </button>
    </>
  );
}
```

## Checking Support

### Token Supported?

```typescript
const isSupported = await client.readContract({
  address: tokenRegistry,
  abi: TokenRegistryAbi,
  functionName: 'isTokenEnabled',
  args: [tokenAddress],
});
```

### Paymaster Balance?

```typescript
const deposit = await client.readContract({
  address: entryPoint,
  abi: EntryPointAbi,
  functionName: 'getDepositInfo',
  args: [paymasterAddress],
});

console.log('Paymaster balance:', deposit.deposit);
```

### Price Quote

```typescript
const quote = await fetch('http://localhost:4003/api/paymasters/quote', {
  method: 'POST',
  body: JSON.stringify({
    token: USDC_ADDRESS,
    gasLimit: 100000,
  }),
});
// Returns: {"tokenAmount": "1500000", "ethEquivalent": "..."}
```

## Error Handling

**AA21** indicates insufficient token balance - user needs more tokens. **AA31** means paymaster validation failed - check token and oracle configuration. **AA33** indicates paymaster deposit is too low - operator needs to refill.

## Best Practices

1. **Quote first**: Show users the cost before execution
2. **Fallback to ETH**: If paymaster fails, allow ETH payment
3. **Monitor deposits**: Keep paymaster funded
4. **Set limits**: Cap max gas per transaction

