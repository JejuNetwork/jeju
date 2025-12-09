# Bridging (EIL)

Jeju uses the Ethereum Interop Layer (EIL) for trustless cross-chain transfers. No traditional bridge - atomic swaps via XLP liquidity.

## How It Works

```
1. User locks tokens on source chain (createVoucherRequest)
2. XLP sees request, issues voucher
3. Voucher used on both chains:
   - Source: XLP claims user's locked tokens
   - Destination: User receives XLP's tokens
4. Atomic swap complete
```

XLPs stake on Ethereum. Failed fulfillments = slashing.

## Bridge via Gateway

1. Go to https://gateway.jeju.network/bridge
2. Connect wallet
3. Select source/destination chain
4. Enter amount
5. Click "Bridge"

## Bridge via Contract

### Create Voucher Request (Source Chain)

```bash
cast send $CROSS_CHAIN_PAYMASTER \
  "createVoucherRequest(address,uint256,uint256,uint256)" \
  $TOKEN \
  $AMOUNT \
  $DESTINATION_CHAIN_ID \
  $DEADLINE \
  --rpc-url $SOURCE_RPC \
  --private-key $PRIVATE_KEY
```

## Become an XLP (Liquidity Provider)

XLPs earn fees by fulfilling cross-chain requests:

### Deposit ETH

```bash
cast send $CROSS_CHAIN_PAYMASTER "depositETH()" \
  --value 10ether \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Deposit Tokens

```bash
# Approve first
cast send $TOKEN "approve(address,uint256)" $CROSS_CHAIN_PAYMASTER $AMOUNT

# Deposit
cast send $CROSS_CHAIN_PAYMASTER "depositLiquidity(address,uint256)" $TOKEN $AMOUNT \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Fulfill Requests

XLP bot monitors for voucher requests and fulfills them:

```bash
cast send $CROSS_CHAIN_PAYMASTER \
  "fulfillVoucher(bytes32,address)" \
  $VOUCHER_HASH \
  $RECIPIENT \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## XLP Staking Requirements

XLPs must stake on Ethereum via L1StakeManager:

```bash
cast send $L1_STAKE_MANAGER "stake()" \
  --value 10ether \
  --rpc-url $ETHEREUM_RPC \
  --private-key $PRIVATE_KEY
```

## Security

| Mechanism | Protection |
|-----------|------------|
| XLP staking | Failed fulfillments = slashing |
| Voucher deadlines | Requests expire if unfulfilled |
| Atomic swaps | Either complete or refund |

## Fees

XLPs set their own fee rates. Users see total cost before bridging.

## Contracts

| Contract | Chain | Purpose |
|----------|-------|---------|
| CrossChainPaymaster | Jeju | Voucher creation, fulfillment |
| L1StakeManager | Ethereum | XLP staking, slashing |

## Standard Bridge (7-day)

For users who prefer the standard OP-Stack bridge:

**Deposit** (Ethereum → Jeju): ~15 minutes  
**Withdrawal** (Jeju → Ethereum): 7-day challenge period

```typescript
import { CrossChainMessenger } from '@eth-optimism/sdk';

const messenger = new CrossChainMessenger({
  l1ChainId: 1,  // Ethereum
  l2ChainId: 420691, // Jeju
  l1SignerOrProvider: ethereumSigner,
  l2SignerOrProvider: jejuSigner,
  bedrock: true,
});

await messenger.depositETH(ethers.parseEther('0.1'));
```
