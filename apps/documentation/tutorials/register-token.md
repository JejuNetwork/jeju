# Tutorial: Register a Token for Gas Payments

Enable your token for use as gas payment via paymasters.

**Time:** 15 minutes  
**Level:** Beginner  
**You'll Learn:**
- Create a price oracle
- Register token in TokenRegistry
- Test gas payments

## What We're Building

After this tutorial, users will be able to pay transaction gas in your token instead of ETH.

## Prerequisites

- [Jeju running locally](/build/quick-start) or testnet access
- A deployed ERC-20 token

## Step 1: Create Price Oracle

If your token doesn't have a Chainlink feed, deploy a manual oracle:

```solidity
// contracts/MyTokenOracle.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MyTokenOracle is AggregatorV3Interface {
    int256 public price;
    address public owner;
    uint8 public constant override decimals = 8;
    string public constant override description = "MTK/ETH";
    uint256 public constant override version = 1;
    
    constructor(int256 _initialPrice) {
        price = _initialPrice;
        owner = msg.sender;
    }
    
    function updatePrice(int256 _price) external {
        require(msg.sender == owner, "Not owner");
        price = _price;
    }
    
    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
    
    function getRoundData(uint80) external view override returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
}
```

Deploy:

```bash
forge create src/MyTokenOracle.sol:MyTokenOracle \
  --constructor-args 100000000 \  # 1 MTK = 0.01 ETH (8 decimals)
  --rpc-url http://127.0.0.1:9545 \
  --private-key $PRIVATE_KEY
```

Save the oracle address:
```bash
export ORACLE_ADDRESS=0x...
```

## Step 2: Register Token

```bash
export TOKEN_ADDRESS=0x...  # Your ERC-20
export ORACLE_ADDRESS=0x...  # From step 1
export TOKEN_REGISTRY=0x...  # From packages/config/contracts.json

cast send $TOKEN_REGISTRY \
  "registerToken(address,address,uint256,uint256)" \
  $TOKEN_ADDRESS \
  $ORACLE_ADDRESS \
  $(cast --to-wei 1)   \  # Min fee: 1 token
  $(cast --to-wei 100) \  # Max fee: 100 tokens
  --value 0.1ether \       # Registration fee
  --rpc-url http://127.0.0.1:9545 \
  --private-key $PRIVATE_KEY
```

## Step 3: Verify Registration

```bash
# Check if enabled
cast call $TOKEN_REGISTRY "isTokenEnabled(address)" $TOKEN_ADDRESS

# Get config
cast call $TOKEN_REGISTRY "getTokenConfig(address)" $TOKEN_ADDRESS
```

## Step 4: Test Gas Payment

```typescript
import { createWalletClient, http } from 'viem';

const userOp = {
  sender: walletAddress,
  callData: encodedCall,
  paymasterAndData: encodePaymasterData(
    MULTI_TOKEN_PAYMASTER,
    TOKEN_ADDRESS,  // Your token
    parseUnits('10', 18),  // Max 10 tokens for gas
  ),
};

// Send via bundler
const hash = await bundler.sendUserOperation(userOp);
```

## Keep Oracle Updated

Run a price updater:

```typescript
async function updateOraclePrice() {
  // Fetch price from exchange or DEX
  const ethPrice = await getEthPrice();
  const tokenPrice = await getTokenPrice(TOKEN_ADDRESS);
  const ratio = Math.floor((tokenPrice / ethPrice) * 1e8);
  
  await oracle.updatePrice(ratio);
}

// Update every hour
setInterval(updateOraclePrice, 60 * 60 * 1000);
```

## Configuration Options

| Parameter | Description |
|-----------|-------------|
| `minFee` | Minimum tokens accepted per tx |
| `maxFee` | Maximum tokens charged per tx |
| `oracle` | Price feed contract |

## Troubleshooting

**Token not showing in wallet:**
- Verify `isTokenEnabled()` returns true
- Check oracle returns valid price

**Transaction fails:**
- User needs sufficient token balance
- Check oracle price is fresh
- Verify paymaster has ETH deposited

## Next Steps

- [Gasless NFT Tutorial](/tutorials/gasless-nft) — Use your token in an app
- [Paymaster Concepts](/learn/gasless) — Understand gas abstraction

