# Become an XLP

Cross-chain Liquidity Providers (XLPs) earn fees by providing instant bridging liquidity.

## Overview

XLPs enable instant cross-chain transfers by staking ETH on L1 (Ethereum), depositing liquidity on L2 (Jeju), crediting users instantly when they deposit on L1, and claiming L1 deposits after message finalization.

## Requirements

Minimum stake is 1 ETH on L1. Recommended liquidity is 0.5+ ETH on L2. You'll need a bot to monitor L1 deposits.

## Earnings

XLPs earn 0.1% to 0.5% per transfer from bridge spread, plus 50% of gas fees in staked tokens from paymaster fees.

## Step 1: Register on L1

Register as XLP on Ethereum (or Sepolia for testnet):

```bash
cast send $L1_STAKE_MANAGER \
  "register(uint256[])" \
  "[420691]" \
  --value 1ether \
  --rpc-url $L1_RPC \
  --private-key $PK
```

The `[420691]` parameter specifies supported destination chains (Jeju mainnet). For testnet, use Sepolia RPC and chain ID 420690.

## Step 2: Deposit Liquidity on L2

Deposit ETH on Jeju to fulfill transfers:

```bash
cast send $CROSS_CHAIN_PAYMASTER \
  "depositETH()" \
  --value 0.5ether \
  --rpc-url $L2_RPC \
  --private-key $PK
```

## Step 3: Run XLP Bot

Monitor L1 deposits and credit users on L2:

```typescript
import { createPublicClient, http } from 'viem';
import { L1StakeManagerAbi, CrossChainPaymasterAbi } from '@jejunetwork/contracts';

l1Client.watchContractEvent({
  address: L1_STAKE_MANAGER,
  abi: L1StakeManagerAbi,
  eventName: 'DepositForUser',
  onLogs: async (logs) => {
    for (const log of logs) {
      const { user, amount, destinationChainId } = log.args;
      if (destinationChainId !== 420691n) continue;
      
      const credited = await checkIfCredited(log.transactionHash);
      if (credited) continue;
      
      const tx = await l2Client.writeContract({
        address: CROSS_CHAIN_PAYMASTER,
        abi: CrossChainPaymasterAbi,
        functionName: 'creditUser',
        args: [user, amount, log.transactionHash],
      });
      
      console.log(`Credited ${user} with ${amount}: ${tx}`);
    }
  },
});
```

## Step 4: Claim Settlements

After L1→L2 messages finalize (~15 min), claim your funds by getting pending claims and calling `claimSettlement` for each with the deposit hash and proof.

## Managing Stake

Add stake with `cast send $L1_STAKE_MANAGER "stake()" --value 1ether`. Initiate unstake with `cast send $L1_STAKE_MANAGER "initiateUnstake(uint256)" "1000000000000000000"`, then complete after the 7-day cooldown with `cast send $L1_STAKE_MANAGER "completeUnstake()"`.

Check L1 stake with `cast call $L1_STAKE_MANAGER "getStake(address)" $YOUR_ADDRESS`. Check L2 liquidity with `cast call $CROSS_CHAIN_PAYMASTER "getBalance(address,address)" $YOUR_ADDRESS $ZERO_ADDRESS`.

## Slashing Risks

Failing to credit a user results in 110% of deposit slashed. Double credit (fraud) slashes 100% of stake. Incorrect amount slashes the difference plus 10%.

## Best Practices

Monitor continuously by running your bot 24/7 with redundancy. Maintain liquidity at 2x expected daily volume. Set alerts to get notified of large deposits. Track gas to ensure your L2 wallet has ETH for gas.

## Troubleshooting

**Credit Transaction Fails**: Check that your L2 wallet has enough ETH for gas, verify the deposit hash is correct, and ensure you haven't already credited this deposit.

**Not Receiving Claims**: Wait for the L1→L2 message to finalize (~15 min), check that the message proof is valid, and verify the claim wasn't already processed.
