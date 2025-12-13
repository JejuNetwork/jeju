# Staking Contracts

Node operator staking and performance tracking.

## Overview

Staking contracts enable RPC node operator registration, performance-based rewards, automatic slashing for downtime, and token-based staking with any registered token.

## NodeStakingManager

Main staking contract for RPC node operators.

**Location:** `src/node-staking/NodeStakingManager.sol`

Each node entry tracks the operator address, endpoint URL, staked token and amount, performance score, registration time, and active status.

```bash
# Register node with JEJU stake
cast send $NODE_STAKING_MANAGER \
  "register(string,address,uint256)" \
  "https://mynode.jeju.network" \
  $JEJU_TOKEN \
  $(cast --to-wei 1000) \
  --rpc-url $RPC_URL \
  --private-key $PK
```

See [Run an RPC Node Guide](/guides/run-rpc-node) for the full process.

## AutoSlasher

Automatic slashing for poor performance.

**Location:** `src/node-staking/AutoSlasher.sol`

The AutoSlasher monitors node uptime, slashes for extended downtime using gradual slashing (warnings before full slash), and provides an appeal mechanism.

The first warning has no penalty. The second warning slashes 1% of stake. The third warning slashes 5% of stake. Extended outage over 24 hours slashes 10% of stake. Repeated offenses can slash up to 100% of stake.

## MultiOracleConsensus

Oracle consensus for performance metrics.

**Location:** `src/node-staking/MultiOracleConsensus.sol`

Uses multiple oracle reporters with median aggregation, outlier rejection, and dispute resolution.

## Reward Distribution

Rewards come from protocol fees (a portion of transaction fees), staking pool returns, and slashed stakes (redistributed to good actors).

The reward calculation is: Node Reward = (Base Reward × Performance Score) + Bonus Rewards. Performance Score = (Uptime × 0.5) + (Latency Score × 0.3) + (Request Volume × 0.2).

```typescript
const pending = await client.readContract({
  address: nodeStakingManager,
  abi: NodeStakingManagerAbi,
  functionName: 'getPendingRewards',
  args: [operatorAddress],
});

const tx = await client.writeContract({
  address: nodeStakingManager,
  abi: NodeStakingManagerAbi,
  functionName: 'claimRewards',
});
```

## Staking Parameters

The minimum stake is 1,000 JEJU or equivalent. Unstaking cooldown is 7 days. The reward epoch is 24 hours. The slash appeal window is 48 hours.

## Deployment

```bash
cd packages/contracts

forge script script/DeployNodeStaking.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```

## Integration with Gateway

The Gateway app provides a UI for node registration, stake management, performance monitoring, and reward claiming. See [Gateway App](/applications/gateway) for details.
