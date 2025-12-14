# Become an XLP

Provide cross-chain liquidity and earn bridge fees.

## What is an XLP?

XLP = Cross-chain Liquidity Provider

XLPs enable instant bridging by:
1. Staking on L1 (Ethereum)
2. Providing liquidity on L2 (Jeju)
3. Filling bridge requests instantly
4. Earning fees on every transfer

## Requirements

| Requirement | Value |
|-------------|-------|
| L1 Stake | 1+ ETH |
| L2 Liquidity | Matching amount |
| Unstaking Period | 14 days |

## Economics

| Fee Type | Amount |
|----------|--------|
| Standard bridge fee | 0.05% |
| Fast bridge fee | 0.1-0.3% |
| XLP share | 80% of fees |

With $100k liquidity at 0.1% fee and $1M daily volume = ~$800/day.

## Step 1: Stake on L1

```bash
# Approve stake token
cast send $ETH_TOKEN "approve(address,uint256)" \
  $L1_STAKE_MANAGER $STAKE_AMOUNT \
  --rpc-url $L1_RPC --private-key $PK

# Stake
cast send $L1_STAKE_MANAGER "stake(uint256)" $STAKE_AMOUNT \
  --rpc-url $L1_RPC --private-key $PK
```

## Step 2: Provide L2 Liquidity

```bash
# Deposit to liquidity vault
cast send $LIQUIDITY_VAULT "deposit(address,uint256)" \
  $TOKEN $AMOUNT \
  --rpc-url $L2_RPC --private-key $PK
```

## Step 3: Configure

Set your fee preference:

```bash
cast send $XLP_REGISTRY "setFee(uint256)" 10 \  # 0.1% = 10 bps
  --rpc-url $L2_RPC --private-key $PK
```

## Step 4: Run Filler

```bash
cd jeju/packages/xlp-filler
bun install
PRIVATE_KEY=$PK bun run start
```

The filler:
- Watches for bridge requests
- Fills profitable ones
- Claims L1 deposits after confirmation

## Monitoring

```bash
# Check stake
cast call $L1_STAKE_MANAGER "getStake(address)" $YOUR_ADDRESS

# Check liquidity
cast call $LIQUIDITY_VAULT "getBalance(address,address)" $YOUR_ADDRESS $TOKEN

# Check pending fills
cast call $BRIDGE_REGISTRY "getPendingFills(address)" $YOUR_ADDRESS
```

## Claiming Rewards

```bash
# Claim filled deposits
cast send $INPUT_SETTLER "claimPayment(bytes32)" $INTENT_ID \
  --rpc-url $L1_RPC --private-key $PK
```

## Risks

| Risk | Mitigation |
|------|------------|
| Smart contract bug | Audited contracts |
| L2 reorg | Wait for confirmation |
| Price movement | Short exposure window |
| Slashing | Follow fill protocol |

## Unstaking

```bash
# L1: Initiate unstake (14-day wait)
cast send $L1_STAKE_MANAGER "initiateUnstake(uint256)" $AMOUNT

# After 14 days
cast send $L1_STAKE_MANAGER "completeUnstake()"

# L2: Withdraw liquidity
cast send $LIQUIDITY_VAULT "withdraw(address,uint256)" $TOKEN $AMOUNT
```

## Best Practices

1. **Monitor continuously** — Set up alerts for fill opportunities
2. **Manage exposure** — Don't overcommit liquidity
3. **Diversify tokens** — Support multiple assets
4. **Fast execution** — Speed matters for competitive fills

