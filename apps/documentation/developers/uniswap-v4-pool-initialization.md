# Uniswap V4 Pool Initialization Guide

This guide explains how to initialize liquidity pools on Uniswap V4 deployed to Jeju.

## Prerequisites

Before initializing a pool, ensure you have:

1. **Deployed Contracts**
   - ✅ PoolManager deployed (check [uniswap-v4-1337.json](../../deployments/uniswap-v4-1337.json))
   - ✅ Token contracts deployed (e.g., ElizaOS Token)

2. **V4 Periphery Contracts** (Required!)
   - Uniswap V4 requires the `PositionManager` contract for pool initialization
   - Direct calls to `PoolManager.initialize()` will revert
   - Periphery repo: https://github.com/Uniswap/v4-periphery

3. **Required Information**
   - Token addresses (must be sorted: address(token0) < address(token1))
   - Fee tier (500 = 0.05%, 3000 = 0.3%, 10000 = 1%)
   - Tick spacing (correlates with fee tier)
   - Initial price (expressed as sqrtPriceX96)
   - Hook address (or address(0) for no hooks)

## Architecture Overview

### Uniswap V4 Unlock Pattern

Uniswap V4 uses a unique "unlock" pattern for gas efficiency:

```
User/Frontend
    ↓
PositionManager (v4-periphery)
    ↓
PoolManager.unlock(callback)
    ↓
[PoolManager becomes unlocked]
    ↓
PoolManager calls back to PositionManager
    ↓
PositionManager.unlockCallback()
    ↓
PoolManager.initialize() [succeeds because unlocked]
```

**Why this pattern?**
- Enables flash accounting (saves ~90% gas vs V3)
- Uses transient storage (EIP-1153)
- Allows batched operations in a single transaction
- All operations settle at the end of the unlock

### Direct vs Periphery Calls

| Method | Status | Reason |
|--------|--------|--------|
| `PoolManager.initialize()` directly | ❌ Reverts | Pool is locked |
| `PositionManager.initialize()` | ✅ Works | Uses unlock pattern |

## Installation

### 1. Install V4 Periphery

```bash
cd contracts
forge install Uniswap/v4-periphery
```

### 2. Add to Foundry Remappings

Add to `contracts/foundry.toml`:

```toml
remappings = [
    "@uniswap/v4-periphery/=lib/v4-periphery/src/",
    # ... existing remappings
]
```

### 3. Deploy PositionManager

Create `contracts/script/DeployV4Periphery.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@uniswap/v4-periphery/PositionManager.sol";
import "@uniswap/v4-core/interfaces/IPoolManager.sol";

contract DeployV4Periphery is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address poolManager = vm.envAddress("POOL_MANAGER");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy PositionManager
        PositionManager positionManager = new PositionManager(
            IPoolManager(poolManager)
        );

        console.log("PositionManager deployed:", address(positionManager));

        vm.stopBroadcast();
    }
}
```

Deploy:

```bash
# Set environment variables
export JEJU_RPC_URL=$(bun run scripts/shared/get-localnet-rpc.ts)
export POOL_MANAGER=0x5FbDB2315678afecb367f032d93F642f64180aa3

# Deploy periphery
forge script script/DeployV4Periphery.s.sol:DeployV4Periphery \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY \
    --broadcast \
    --use 0.8.26
```

## Pool Initialization

### Method 1: Using Forge Script (Recommended)

Create `contracts/script/InitializeV4Pool.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@uniswap/v4-periphery/PositionManager.sol";
import "@uniswap/v4-core/types/PoolKey.sol";
import "@uniswap/v4-core/types/Currency.sol";

contract InitializeV4Pool is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address positionManager = vm.envAddress("POSITION_MANAGER");
        address token0 = vm.envAddress("TOKEN0"); // Lower address
        address token1 = vm.envAddress("TOKEN1"); // Higher address

        vm.startBroadcast(deployerPrivateKey);

        // Define pool parameters
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000, // 0.3%
            tickSpacing: 60,
            hooks: IHooks(address(0)) // No hooks
        });

        // Initial price: 1 elizaOS = 0.0001 ETH
        // sqrtPriceX96 = sqrt(price) * 2^96
        uint160 sqrtPriceX96 = 792281625142643375935439503;

        // Initialize pool through PositionManager
        PositionManager(positionManager).initialize(
            key,
            sqrtPriceX96,
            ""
        );

        console.log("Pool initialized!");
        console.log("Currency0:", Currency.unwrap(key.currency0));
        console.log("Currency1:", Currency.unwrap(key.currency1));
        console.log("Fee:", key.fee);

        vm.stopBroadcast();
    }
}
```

Run the script:

```bash
# Sort token addresses
export TOKEN0=0x4200000000000000000000000000000000000006  # WETH (lower)
export TOKEN1=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512  # elizaOS (higher)

forge script script/InitializeV4Pool.s.sol:InitializeV4Pool \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY \
    --broadcast \
    --use 0.8.26
```

### Method 2: Using TypeScript/Bun

Create `scripts/initialize-v4-pool.ts`:

```typescript
#!/usr/bin/env bun

import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getLocalnetRpcUrl } from './shared/get-localnet-rpc';

const rpcUrl = getLocalnetRpcUrl();
const privateKey = process.env.PRIVATE_KEY || "0xac0974...";

const account = privateKeyToAccount(privateKey as `0x${string}`);
const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
});

const publicClient = createPublicClient({
    transport: http(rpcUrl),
});

// PositionManager ABI (simplified)
const positionManagerAbi = [
    {
        name: "initialize",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            {
                name: "key",
                type: "tuple",
                components: [
                    { name: "currency0", type: "address" },
                    { name: "currency1", type: "address" },
                    { name: "fee", type: "uint24" },
                    { name: "tickSpacing", type: "int24" },
                    { name: "hooks", type: "address" },
                ],
            },
            { name: "sqrtPriceX96", type: "uint160" },
            { name: "hookData", type: "bytes" },
        ],
        outputs: [{ name: "tick", type: "int24" }],
    },
];

async function initializePool() {
    const positionManager = "0x..."; // Your deployed PositionManager
    const weth = "0x4200000000000000000000000000000000000006";
    const eliza = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

    // Ensure token0 < token1
    const [token0, token1] = weth < eliza ? [weth, eliza] : [eliza, weth];

    const poolKey = {
        currency0: token0,
        currency1: token1,
        fee: 3000, // 0.3%
        tickSpacing: 60,
        hooks: "0x0000000000000000000000000000000000000000",
    };

    // Initial price: 1 elizaOS = 0.0001 ETH
    const sqrtPriceX96 = BigInt("792281625142643375935439503");

    console.log("Initializing pool...");
    console.log("Pool Key:", poolKey);

    const hash = await walletClient.writeContract({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "initialize",
        args: [poolKey, sqrtPriceX96, "0x"],
    });

    console.log("Transaction hash:", hash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("✅ Pool initialized! Block:", receipt.blockNumber);
}

initializePool().catch(console.error);
```

Run:

```bash
bun run scripts/initialize-v4-pool.ts
```

## Calculating sqrtPriceX96

The initial price must be expressed as `sqrtPriceX96`:

```
sqrtPriceX96 = sqrt(price) * 2^96
```

### Example: 1 elizaOS = 0.0001 ETH

```python
import math

# Price: 1 elizaOS = 0.0001 ETH
# If elizaOS is token1 and WETH is token0:
# price = token1/token0 = elizaOS/WETH = 0.0001

price = 0.0001
sqrt_price = math.sqrt(price)
sqrt_price_x96 = int(sqrt_price * (2 ** 96))

print(f"sqrtPriceX96: {sqrt_price_x96}")
# Output: 792281625142643375935439503
```

### Helpful Tool

```typescript
// scripts/shared/calculate-sqrt-price.ts
export function calculateSqrtPriceX96(price: number): bigint {
    const sqrtPrice = Math.sqrt(price);
    const Q96 = BigInt(2) ** BigInt(96);
    return BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

// Usage:
const price = 0.0001; // 1 elizaOS = 0.0001 ETH
const sqrtPriceX96 = calculateSqrtPriceX96(price);
console.log(sqrtPriceX96.toString());
```

## Fee Tiers and Tick Spacing

| Fee Tier | Fee % | Tick Spacing | Use Case |
|----------|-------|--------------|----------|
| 500 | 0.05% | 10 | Stablecoin pairs |
| 3000 | 0.3% | 60 | Most pairs |
| 10000 | 1% | 200 | Exotic/volatile pairs |

## Troubleshooting

### Error: "Pool is locked"

**Cause**: Trying to call `PoolManager.initialize()` directly

**Solution**: Use `PositionManager.initialize()` instead

### Error: "Invalid tick spacing"

**Cause**: Tick spacing doesn't match fee tier

**Solution**: Use standard combinations:
- 500 fee → 10 tick spacing
- 3000 fee → 60 tick spacing
- 10000 fee → 200 tick spacing

### Error: "Currencies out of order"

**Cause**: `currency0 > currency1`

**Solution**: Sort addresses:
```typescript
const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
```

### Error: "Pool already initialized"

**Cause**: Pool with these exact parameters already exists

**Solution**: Query existing pool instead of initializing new one

## Next Steps

After initializing a pool:

1. **Add Liquidity**
   - Use `PositionManager.modifyLiquidity()`
   - Specify tick range for concentrated liquidity
   - Approve tokens to PositionManager

2. **Deploy Hooks (Optional)**
   - Add custom logic to pool lifecycle
   - 8 hook points available
   - Must be deployed before pool initialization

3. **Integrate with Frontend**
   - Update pool addresses in constants
   - Add pool to liquidity interface
   - Enable swaps through PositionManager

## Resources

- [Uniswap V4 Documentation](https://docs.uniswap.org/contracts/v4/overview)
- [V4 Periphery Repository](https://github.com/Uniswap/v4-periphery)
- [V4 Core Repository](https://github.com/Uniswap/v4-core)
- [Hooks Examples](https://github.com/Uniswap/v4-periphery/tree/main/contracts/hooks)
- [Tick Math Library](https://github.com/Uniswap/v4-core/blob/main/src/libraries/TickMath.sol)

## See Also

- [Deploy Contracts](./deploy-contracts)
- [DeFi Protocols](./defi-protocols)
- [Uniswap V4 Documentation](https://docs.uniswap.org/contracts/v4/guides/hooks/)
