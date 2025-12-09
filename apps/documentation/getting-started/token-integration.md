# Token Integration

Make your ERC20 token usable for gas payments on Jeju.

## Overview

1. Register token in TokenRegistry
2. PaymasterFactory deploys your token's paymaster
3. LPs provide ETH liquidity
4. Users can now pay gas with your token

## Register Token

### Via Gateway

1. Go to https://gateway.jeju.network/tokens/register
2. Connect wallet
3. Enter token address, oracle, fee range
4. Pay 0.1 ETH registration fee
5. Click "Register"

### Via Contract

```bash
# Register with 0-2% fee range (0-200 basis points)
cast send $TOKEN_REGISTRY \
  "registerToken(address,address,uint256,uint256)" \
  $YOUR_TOKEN \
  $PRICE_ORACLE \
  0 \
  200 \
  --value 0.1ether \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Requirements

| Requirement | Details |
|-------------|---------|
| Token | Standard ERC20 with name(), symbol(), decimals() |
| Oracle | IPriceOracle compatible (returns token/USD price) |
| Fee range | Within 0-5% global bounds |
| Registration fee | 0.1 ETH |

## Fee Range

Set min/max fee margin in basis points (100 = 1%):

```
Global bounds: 0-500 (0-5%)
Your range: Choose within global bounds
Operator fee: Set within your range
```

Example: You set 0-200 (0-2%), operator can use any value 0-2%.

## After Registration

1. **Deploy paymaster**: PaymasterFactory deploys your token's paymaster
2. **Provide liquidity**: LPs stake ETH for gas sponsorship
3. **Users pay gas**: Your token is now a gas payment option

## Provide Initial Liquidity

```bash
cast send $LIQUIDITY_VAULT "addETHLiquidity(uint256)" 0 \
  --value 1ether \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Check Registration

```bash
cast call $TOKEN_REGISTRY "tokens(address)" $YOUR_TOKEN --rpc-url $RPC_URL
```

## Contracts

| Contract | Purpose |
|----------|---------|
| TokenRegistry | Permissionless token registration |
| PaymasterFactory | Deploys paymaster instances |
| LiquidityVault | LP staking and fee distribution |
