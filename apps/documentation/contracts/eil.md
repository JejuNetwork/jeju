# Ethereum Interop Layer (EIL)

Trustless cross-chain transfers without traditional bridges.

## Overview

EIL enables instant cross-chain transfers using liquidity providers (XLPs). A user on Ethereum deposits to L1StakeManager, an XLP provides liquidity, and the user receives funds instantly on L2. Unlike traditional bridges with 7-day withdrawal periods, EIL transfers are instant because XLPs front the liquidity.

## Architecture

On L1 (Ethereum), **L1StakeManager** handles XLP staking and deposit locking. On L2 (Jeju), **CrossChainPaymaster** verifies L1 deposits, credits users, and pays XLPs. L1 to L2 messaging connects them.

XLPs stake ETH on L1 and provide liquidity on L2.

## L1StakeManager

Deployed on Ethereum L1. Handles XLP registration and staking.

**Location:** `src/eil/L1StakeManager.sol`

```bash
# Register as XLP on L1 (requires 1+ ETH stake)
cast send $L1_STAKE_MANAGER "register(uint256[])" "[420691]" \
  --value 1ether \
  --rpc-url $L1_RPC \
  --private-key $PK
```

See [Become an XLP Guide](/guides/become-xlp) for the full process.

## CrossChainPaymaster

Deployed on Jeju L2. Credits users and pays XLPs.

**Location:** `src/eil/CrossChainPaymaster.sol`

```bash
# Deposit ETH liquidity on L2
cast send $CROSS_CHAIN_PAYMASTER "depositETH()" \
  --value 0.5ether \
  --rpc-url $L2_RPC \
  --private-key $PK
```

## LiquidityPaymaster

Alternative paymaster for token-based liquidity.

**Location:** `src/eil/LiquidityPaymaster.sol`

Accepts token deposits from XLPs, supports multiple tokens (USDC, WETH, etc.), and provides automatic pricing via oracles.

## User Flow

1. **Deposit on L1**: User sends ETH to L1StakeManager with destination chain
2. **XLP Detection**: XLP monitors L1 deposits
3. **Instant Credit**: XLP calls CrossChainPaymaster.creditUser() on L2
4. **User Receives**: User gets funds instantly on L2
5. **XLP Settlement**: After L1→L2 message finalizes, XLP claims from L1

## XLP Economics

The minimum stake is 1 ETH. Fee range is 0.1% to 0.5%. Slashing risk is up to 100% of stake. Settlement time is approximately 15 minutes.

XLPs earn from the transfer spread (user pays slightly more than received) and protocol fee share (50% of paymaster fees).

## Security

### Slashing Conditions

XLPs are slashed for failing to credit users after L1 deposit, double-crediting (fraud), or providing incorrect amounts.

### Dispute Resolution

If a user reports missing credit, the protocol verifies the L1 deposit. If the XLP failed to credit within the time limit, the XLP is slashed and the user receives funds from the slash.

## Deployment

```bash
cd packages/contracts

# Deploy L1StakeManager to Sepolia
forge script script/DeployEIL.s.sol:DeployL1 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast --verify

# Deploy CrossChainPaymaster to Jeju testnet
forge script script/DeployEIL.s.sol:DeployL2 \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast --verify
```

## Integration

### Frontend (Bridge UI)

```typescript
import { L1StakeManagerAbi } from '@jejunetwork/contracts';

const tx = await l1Client.writeContract({
  address: l1StakeManager,
  abi: L1StakeManagerAbi,
  functionName: 'depositForUser',
  args: [userAddress, 420691n, xlpAddress],
  value: parseEther('1'),
});
```

### XLP Bot

```typescript
l1Client.watchContractEvent({
  address: l1StakeManager,
  abi: L1StakeManagerAbi,
  eventName: 'DepositForUser',
  onLogs: async (logs) => {
    for (const log of logs) {
      await l2Client.writeContract({
        address: crossChainPaymaster,
        abi: CrossChainPaymasterAbi,
        functionName: 'creditUser',
        args: [log.args.user, log.args.token, log.args.amount, log.transactionHash],
      });
    }
  },
});
```
