# DeFi Contracts

Uniswap V4 integration and liquidity management.

## Overview

Jeju integrates Uniswap V4 for token swaps with hooks, concentrated liquidity pools, custom pool logic via hooks, and native fee collection for paymasters.

## Uniswap V4 Integration

Jeju uses Uniswap V4's singleton PoolManager pattern. Key contracts include **PoolManager** (core Uniswap V4 singleton), **PositionManager** (LP position NFTs), **SwapRouter** (swap execution), and **Quoter** (price quotes).

```typescript
import { getContract } from '@jejunetwork/config';

const poolManager = getContract('defi', 'poolManager');
const swapRouter = getContract('defi', 'swapRouter');

const tx = await client.writeContract({
  address: swapRouter,
  abi: SwapRouterAbi,
  functionName: 'swap',
  args: [poolKey, swapParams, deadline],
});
```

## LiquidityVault

Managed liquidity for paymasters and XLPs.

**Location:** `src/liquidity/LiquidityVault.sol`

Aggregates liquidity from multiple sources, performs automatic rebalancing, handles fee distribution to depositors, and integrates with the paymaster system.

## XLPRouter

Routes swaps for cross-chain liquidity providers.

**Location:** `src/amm/XLPRouter.sol`

Provides optimal routing across pools, MEV protection, slippage control, and multi-hop swaps.

## RouterRegistry

Registry of approved DEX routers.

**Location:** `src/amm/RouterRegistry.sol`

Whitelists approved routers, tracks router performance, and optimizes routes.

## LiquidityAggregator

Aggregate liquidity from multiple sources.

**Location:** `src/amm/LiquidityAggregator.sol`

Queries liquidity across pools, finds best prices, and executes optimal swaps.

## Pool Hooks

Jeju can deploy custom Uniswap V4 hooks for fee collection for the protocol, oracle price feeds, access control, and custom swap logic.

```solidity
contract JejuFeeHook is BaseHook {
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external override returns (bytes4) {
        // Collect 0.01% protocol fee
        uint256 fee = params.amountSpecified * 1 / 10000;
        // ... fee collection logic
        return BaseHook.beforeSwap.selector;
    }
}
```

## Perpetuals

Jeju includes perpetual futures contracts in `src/perps/`. **PerpetualMarket** handles core perp trading. **MarginManager** manages margin and collateral. **LiquidationEngine** handles position liquidation. **InsuranceFund** covers socialized losses.

## Deployment

```bash
cd packages/contracts

forge script script/DeployUniswapV4Periphery.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast

forge script script/DeployLiquiditySystem.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```

See [Bazaar App](/applications/bazaar) for the DeFi frontend.
