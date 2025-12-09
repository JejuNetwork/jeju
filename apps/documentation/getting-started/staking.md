# Staking & Earning Fees

Stake ETH and tokens to provide liquidity. Your stake is used for:
- **Paymaster gas sponsorship** - Users pay gas in tokens, you provide ETH
- **EIL cross-chain transfers** - Users bridge tokens, you provide liquidity

Earn fees from both systems proportionally to your stake.

## How It Works

```
User pays gas in TOKEN → Paymaster converts → Uses staker ETH → Staker earns fees
User bridges TOKEN → EIL uses staker liquidity → Staker earns fees
```

One stake, double the utility.

## Stake via Gateway

1. Go to https://gateway.jeju.network/stake
2. Connect wallet
3. Enter ETH and/or token amount
4. Click "Stake"

## Stake via Contract

```bash
# Stake 1 ETH + 1000 tokens
cast send $STAKING "stake(uint256)" 1000000000000000000000 \
  --value 1ether \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Fee Structure

| Source | LP Share |
|--------|----------|
| Paymaster fees | 50% (70% ETH / 30% token) |
| EIL bridge fees | XLP fulfillment fees |

## Claim Fees

```bash
cast send $STAKING "claimFees()" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Withdraw

Withdrawals have a 7-day unbonding period:

```bash
# Start unbonding
cast send $STAKING "startUnbonding(uint256,uint256)" 1000000000000000000 0 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# After 7 days
cast send $STAKING "withdraw()" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Minimums

| Asset | Minimum |
|-------|---------|
| ETH | 0.1 ETH |
| Tokens | 100 tokens |

## Utilization Limits

- ETH: Max 80% used for gas at once
- Tokens: Max 70% used for EIL at once

This ensures you can always withdraw.
