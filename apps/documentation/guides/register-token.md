# Register a Token

Enable your token for gas payments via paymasters.

## Overview

Once registered, users can pay transaction gas in your token instead of ETH.

## Requirements

Token must be ERC-20 compliant. A Chainlink-compatible price oracle is required. Registration fee is 0.1 ETH.

## Step 1: Deploy Price Oracle

If your token doesn't have a Chainlink feed, deploy a manual oracle:

```solidity
// contracts/MyTokenOracle.sol
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MyTokenOracle is AggregatorV3Interface {
    int256 public price;
    address public owner;
    
    constructor(int256 _initialPrice) {
        price = _initialPrice;
        owner = msg.sender;
    }
    
    function updatePrice(int256 _price) external {
        require(msg.sender == owner);
        price = _price;
    }
    
    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (0, price, 0, block.timestamp, 0);
    }
    
    function decimals() external pure returns (uint8) {
        return 8;
    }
    
    // ... other interface methods
}
```

Deploy:

```bash
forge create src/MyTokenOracle.sol:MyTokenOracle \
  --constructor-args 100000000 \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Step 2: Register Token

### Via Gateway UI

1. Go to https://gateway.jeju.network/tokens
2. Click "Register Token"
3. Enter:
   - Token address
   - Oracle address
   - Min fee (in token units)
   - Max fee (in token units)
4. Pay 0.1 ETH registration fee
5. Confirm transaction

### Via Script

```bash
cast send $TOKEN_REGISTRY \
  "registerToken(address,address,uint256,uint256)" \
  $TOKEN_ADDRESS \
  $ORACLE_ADDRESS \
  $MIN_FEE \
  $MAX_FEE \
  --value 0.1ether \
  --rpc-url $RPC_URL \
  --private-key $PK
```

Parameters:
- `$TOKEN_ADDRESS` - Your ERC-20 token
- `$ORACLE_ADDRESS` - Price feed contract
- `$MIN_FEE` - Minimum fee in token units
- `$MAX_FEE` - Maximum fee in token units

## Step 3: Verify Registration

```bash
# Check registration
cast call $TOKEN_REGISTRY "getTokenConfig(address)" $TOKEN_ADDRESS

# Check if enabled
cast call $TOKEN_REGISTRY "isTokenEnabled(address)" $TOKEN_ADDRESS
```

## Using Registered Tokens

### Users

Users can now select your token for gas in supported wallets:

```typescript
// Create UserOperation with paymaster
const userOp = {
  sender: walletAddress,
  callData: encodedCall,
  paymasterAndData: encodePaymasterData(
    paymasterAddress,
    tokenAddress,  // Your token
    maxTokenAmount
  ),
};
```

### Apps

Apps can sponsor users with your token:

```typescript
// App creates sponsored paymaster
const paymaster = await factory.createSponsoredPaymaster(
  appAddress,
  [gameContract],
  [tokenAddress],  // Supported tokens
);
```

## Fee Calculation

Fees are calculated as:

```
Token Fee = (Gas Cost in ETH) × (ETH/Token Price) × (1 + Fee Margin)
```

The paymaster queries your oracle for the current price.

## Updating Configuration

### Update Oracle

```bash
cast send $TOKEN_REGISTRY "updateOracle(address,address)" \
  $TOKEN_ADDRESS \
  $NEW_ORACLE \
  --rpc-url $RPC_URL \
  --private-key $PK
```

### Update Fees

```bash
cast send $TOKEN_REGISTRY "updateFees(address,uint256,uint256)" \
  $TOKEN_ADDRESS \
  $NEW_MIN_FEE \
  $NEW_MAX_FEE \
  --rpc-url $RPC_URL \
  --private-key $PK
```

### Disable Token

```bash
cast send $TOKEN_REGISTRY "setEnabled(address,bool)" \
  $TOKEN_ADDRESS \
  false \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Oracle Maintenance

Keep your oracle price updated:

```typescript
import { ethers } from 'ethers';

async function updateOraclePrice() {
  // Fetch price from exchange API
  const price = await fetchPriceFromExchange();
  
  // Update oracle
  const oracle = new ethers.Contract(ORACLE_ADDRESS, OracleAbi, wallet);
  await oracle.updatePrice(price);
}

// Run every hour
setInterval(updateOraclePrice, 60 * 60 * 1000);
```

## Best Practices

1. **Reliable oracle**: Keep price fresh (at least hourly)
2. **Reasonable fees**: Set competitive min/max
3. **Monitor usage**: Track gas payments in your token
4. **Liquidity**: Ensure paymaster operators can swap tokens

## Troubleshooting

### Token Not Showing

- Verify registration transaction succeeded
- Check `isTokenEnabled()` returns true
- Ensure oracle returns valid price

### Price Stale

- Check oracle `latestRoundData()` timestamp
- Update oracle more frequently
- Consider using Chainlink automation

### Transactions Failing

- Check token has sufficient liquidity
- Verify min/max fees are reasonable
- Ensure oracle price is accurate

