// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

/**
 * @title DeployUniswapV4Periphery
 * @notice Deploys simplified Uniswap V4 periphery contracts for localnet development
 * @dev For production, use official Uniswap V4 periphery contracts
 *
 * This deploys mock/simplified versions for development:
 * - MockSwapRouter: Simplified swap routing
 * - MockPositionManager: Basic liquidity position management
 * - MockQuoter: Simple quote generation
 * - MockStateView: Pool state reading
 *
 * Usage:
 *   forge script script/DeployUniswapV4Periphery.s.sol:DeployUniswapV4Periphery \
 *     --rpc-url http://localhost:9545 \
 *     --broadcast \
 *     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 */
contract DeployUniswapV4Periphery is Script {
    function run()
        external
        returns (address swapRouter, address positionManager, address quoterV4, address stateView)
    {
        uint256 deployerPrivateKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);

        // Load PoolManager address from previous deployment
        address poolManager = vm.envOr("POOL_MANAGER", address(0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82));

        address weth = 0x4200000000000000000000000000000000000006;

        console.log("============================================================");
        console.log("DEPLOYING UNISWAP V4 PERIPHERY (DEVELOPMENT MODE)");
        console.log("============================================================");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", poolManager);
        console.log("WETH:", weth);
        console.log("");
        console.log("NOTE: Using simplified mock contracts for localnet development");
        console.log("      For production, use official Uniswap V4 periphery");
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock periphery contracts
        console.log("[1/4] Deploying MockSwapRouter...");
        MockSwapRouter router = new MockSwapRouter(poolManager);
        swapRouter = address(router);
        console.log("   SwapRouter:", swapRouter);
        console.log("");

        console.log("[2/4] Deploying MockPositionManager...");
        MockPositionManager posManager = new MockPositionManager(poolManager);
        positionManager = address(posManager);
        console.log("   PositionManager:", positionManager);
        console.log("");

        console.log("[3/4] Deploying MockQuoter...");
        MockQuoter quoter = new MockQuoter(poolManager);
        quoterV4 = address(quoter);
        console.log("   QuoterV4:", quoterV4);
        console.log("");

        console.log("[4/4] Deploying MockStateView...");
        MockStateView stateViewer = new MockStateView(poolManager);
        stateView = address(stateViewer);
        console.log("   StateView:", stateView);
        console.log("");

        vm.stopBroadcast();

        console.log("============================================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("============================================================");
        console.log("SwapRouter:       ", swapRouter);
        console.log("PositionManager:  ", positionManager);
        console.log("QuoterV4:         ", quoterV4);
        console.log("StateView:        ", stateView);
        console.log("");
        console.log("Update packages/contracts/deployments/uniswap-v4-1337.json with these addresses");
        console.log("============================================================");
    }
}

/**
 * @dev Simplified SwapRouter for development
 * For production, use official Uniswap V4 SwapRouter
 */
contract MockSwapRouter {
    address public immutable poolManager;

    constructor(address _poolManager) {
        poolManager = _poolManager;
    }

    // Add swap functions as needed for development
    function swap(address, address, uint256, uint256 minAmountOut, address) external pure returns (uint256 amountOut) {
        // Simplified swap logic for development
        // Production should use actual V4 routing
        amountOut = minAmountOut; // Placeholder
    }
}

/**
 * @dev Simplified PositionManager for development
 */
contract MockPositionManager {
    address public immutable poolManager;

    constructor(address _poolManager) {
        poolManager = _poolManager;
    }

    // Add position management functions as needed
    function addLiquidity(address, address, uint256 amount0, uint256 amount1, address)
        external
        pure
        returns (uint256 liquidity)
    {
        // Simplified liquidity logic for development
        liquidity = amount0 + amount1; // Placeholder
    }
}

/**
 * @dev Simplified Quoter for development
 */
contract MockQuoter {
    address public immutable poolManager;

    constructor(address _poolManager) {
        poolManager = _poolManager;
    }

    // Add quote functions as needed
    function quoteExactInput(address, address, uint256 amountIn) external pure returns (uint256 amountOut) {
        // Simplified quote logic for development
        amountOut = amountIn; // Placeholder
    }
}

/**
 * @dev Simplified StateView for development
 */
contract MockStateView {
    address public immutable poolManager;

    constructor(address _poolManager) {
        poolManager = _poolManager;
    }

    // Add state reading functions as needed
    function getPoolState(address, address)
        external
        pure
        returns (uint160 sqrtPriceX96, int24 tick, uint128 liquidity)
    {
        // Simplified state reading for development
        sqrtPriceX96 = 0; // Placeholder
        tick = 0;
        liquidity = 0;
    }
}
