# Become a Solver

Solvers fill cross-chain intents and earn fees.

## Overview

Solvers earn by monitoring for pending intents, filling intents on the destination chain, and claiming settlement from the source chain.

## Requirements

Minimum stake is 0.5 ETH. You need liquidity (tokens) on destination chains and a bot to monitor and fill intents.

## Earnings

Solvers earn from the spread (user slippage tolerance). First to fill wins in competitive filling.

## Step 1: Register as Solver

```bash
cast send $SOLVER_REGISTRY \
  "register(uint256[])" \
  "[420691,84532]" \
  --value 0.5ether \
  --rpc-url $RPC_URL \
  --private-key $PK
```

The `[420691,84532]` parameter specifies supported chains (Jeju mainnet, Base Sepolia).

## Step 2: Deposit Fill Liquidity

Deposit tokens on chains where you'll fill intents:

```bash
# Deposit ETH
cast send $OUTPUT_SETTLER "depositETH()" \
  --value 1ether \
  --rpc-url $RPC_URL \
  --private-key $PK

# Deposit tokens
cast send $OUTPUT_SETTLER "depositToken(address,uint256)" \
  $USDC_ADDRESS \
  "1000000000" \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Step 3: Run Solver Bot

### Monitor Intents

Via Indexer GraphQL:

```typescript
async function getPendingIntents() {
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query {
          intents(where: { status_eq: PENDING }) {
            hash user inputToken inputAmount
            outputToken minOutputAmount deadline
          }
        }
      `,
    }),
  });
  return (await response.json()).data.intents;
}
```

Via WebSocket for real-time updates.

### Fill Intent

```typescript
async function fillIntent(intent) {
  const outputAmount = calculateOutput(intent.inputAmount);
  const profit = outputAmount - intent.minOutputAmount;
  
  if (profit <= 0) {
    console.log('Not profitable, skipping');
    return;
  }
  
  const tx = await client.writeContract({
    address: OUTPUT_SETTLER,
    abi: OutputSettlerAbi,
    functionName: 'fillIntent',
    args: [intent.hash, intent.outputToken, outputAmount, intent.user],
  });
  
  console.log(`Filled intent ${intent.hash}: ${tx}`);
}
```

### Claim Settlement

After oracle attestation, get the proof and call `releaseFunds` on the source chain InputSettler with the intent hash, solver address, and proof.

## Managing Stake

Add stake with `cast send $SOLVER_REGISTRY "stake()" --value 0.5ether`. Unstake with the 7-day cooldown by calling `initiateUnstake`.

Check registration with `cast call $SOLVER_REGISTRY "isRegistered(address)" $YOUR_ADDRESS`. Check stake with `cast call $SOLVER_REGISTRY "getStake(address)" $YOUR_ADDRESS`. Check liquidity with `cast call $OUTPUT_SETTLER "getBalance(address,address)" $YOUR_ADDRESS $TOKEN`.

## Slashing Risks

Failed fill after accept slashes 10% of stake. Incorrect output amount slashes the difference plus 5%. Fraud (fake fill) slashes 100% of stake.

## Supported Chains

Jeju Mainnet (420691) and Jeju Testnet (420690) support both source and destination. Base Sepolia (84532) and Sepolia (11155111) are source only.

## Best Practices

Speed matters — first to fill wins. Monitor gas since high gas can eliminate profit. Diversify by supporting multiple token pairs. Use redundancy by running multiple instances. Set alerts to get notified of large intents.
