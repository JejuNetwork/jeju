// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

// Oracle Marketplace
import {OracleStakingManager} from "../src/oracle-marketplace/OracleStakingManager.sol";
import {PriceFeedAggregator} from "../src/oracle-marketplace/PriceFeedAggregator.sol";

// Perps Engine
import {PerpetualMarket} from "../src/perps/PerpetualMarket.sol";
import {MarginManager} from "../src/perps/MarginManager.sol";
import {InsuranceFund} from "../src/perps/InsuranceFund.sol";
import {LiquidationEngine} from "../src/perps/LiquidationEngine.sol";

/**
 * @title DeployPerps
 * @notice Deployment script for the full Perps DEX infrastructure
 * @dev Deploys Oracle Marketplace + Perps Engine + configures integrations
 *
 * Usage:
 *   forge script script/DeployPerps.s.sol:DeployPerps --rpc-url $RPC_URL --broadcast
 *
 * Environment variables:
 *   - DEPLOYER_PRIVATE_KEY: Private key for deployment
 *   - TOKEN_REGISTRY: Address of existing TokenRegistry
 *   - PRICE_ORACLE: Address of existing ManualPriceOracle
 *   - IDENTITY_REGISTRY: Address of existing IdentityRegistry (optional)
 *   - REPUTATION_REGISTRY: Address of existing ReputationRegistry (optional)
 */
contract DeployPerps is Script {
    // Deployed addresses
    OracleStakingManager public oracleStakingManager;
    PriceFeedAggregator public priceFeedAggregator;
    PerpetualMarket public perpMarket;
    MarginManager public marginManager;
    InsuranceFund public insuranceFund;
    LiquidationEngine public liquidationEngine;

    // Market IDs (keccak256 of symbol)
    bytes32 public constant BTC_PERP = keccak256("BTC-PERP");
    bytes32 public constant ETH_PERP = keccak256("ETH-PERP");
    bytes32 public constant BTC_USD = keccak256("BTC-USD");
    bytes32 public constant ETH_USD = keccak256("ETH-USD");

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Get existing contract addresses
        address tokenRegistry = vm.envAddress("TOKEN_REGISTRY");
        address priceOracle = vm.envAddress("PRICE_ORACLE");

        // Optional addresses
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        address reputationRegistry = vm.envOr("REPUTATION_REGISTRY", address(0));

        // Optional: Chainlink feeds for fallback
        address chainlinkBtcUsd = vm.envOr("CHAINLINK_BTC_USD", address(0));
        address chainlinkEthUsd = vm.envOr("CHAINLINK_ETH_USD", address(0));

        console.log("Deploying Perps DEX Infrastructure");
        console.log("Deployer:", deployer);
        console.log("TokenRegistry:", tokenRegistry);
        console.log("PriceOracle:", priceOracle);

        vm.startBroadcast(deployerPrivateKey);

        // ============ Phase 1: Oracle Marketplace ============

        console.log("\n=== Phase 1: Oracle Marketplace ===");

        // Deploy OracleStakingManager
        oracleStakingManager = new OracleStakingManager(tokenRegistry, priceOracle, deployer);
        console.log("OracleStakingManager:", address(oracleStakingManager));

        // Configure reputation integration if available
        if (identityRegistry != address(0)) {
            oracleStakingManager.setIdentityRegistry(identityRegistry);
            console.log("  - IdentityRegistry configured");
        }
        if (reputationRegistry != address(0)) {
            oracleStakingManager.setReputationRegistry(reputationRegistry);
            console.log("  - ReputationRegistry configured");
        }

        // Add oracle markets
        oracleStakingManager.addMarket(
            BTC_USD,
            "BTC-USD",
            address(0), // External asset
            3600, // 1 hour heartbeat
            100, // 1% deviation threshold
            3 // Min 3 oracles
        );
        console.log("  - BTC-USD market added");

        oracleStakingManager.addMarket(ETH_USD, "ETH-USD", address(0), 3600, 100, 3);
        console.log("  - ETH-USD market added");

        // Deploy PriceFeedAggregator
        priceFeedAggregator = new PriceFeedAggregator(address(oracleStakingManager), deployer);
        console.log("PriceFeedAggregator:", address(priceFeedAggregator));

        // Configure price feeds
        priceFeedAggregator.configureFeed(
            "BTC-USD",
            BTC_USD,
            chainlinkBtcUsd,
            3600, // 1 hour max staleness
            200, // 2% max deviation between sources
            false // Don't require Jeju oracle (allow Chainlink fallback)
        );

        priceFeedAggregator.configureFeed("ETH-USD", ETH_USD, chainlinkEthUsd, 3600, 200, false);

        // ============ Phase 2: Perps Engine ============

        console.log("\n=== Phase 2: Perps Engine ===");

        // Deploy InsuranceFund first (needed by others)
        insuranceFund = new InsuranceFund(priceOracle, deployer);
        console.log("InsuranceFund:", address(insuranceFund));

        // Deploy MarginManager
        marginManager = new MarginManager(priceOracle, tokenRegistry, deployer);
        console.log("MarginManager:", address(marginManager));

        // Deploy PerpetualMarket
        perpMarket = new PerpetualMarket(
            address(marginManager),
            address(priceFeedAggregator),
            address(insuranceFund),
            deployer, // Fee receiver
            deployer
        );
        console.log("PerpetualMarket:", address(perpMarket));

        // Deploy LiquidationEngine
        liquidationEngine =
            new LiquidationEngine(address(perpMarket), address(marginManager), address(insuranceFund), deployer);
        console.log("LiquidationEngine:", address(liquidationEngine));

        // ============ Phase 3: Configure Integrations ============

        console.log("\n=== Phase 3: Configure Integrations ===");

        // Authorize PerpetualMarket to manage margin
        marginManager.setAuthorizedContract(address(perpMarket), true);
        console.log("  - PerpMarket authorized on MarginManager");

        // Authorize LiquidationEngine
        marginManager.setAuthorizedContract(address(liquidationEngine), true);
        console.log("  - LiquidationEngine authorized on MarginManager");

        // Authorize contracts to draw from insurance fund
        insuranceFund.setAuthorizedDrawer(address(perpMarket), true);
        insuranceFund.setAuthorizedDrawer(address(liquidationEngine), true);
        console.log("  - Contracts authorized on InsuranceFund");

        // ============ Phase 4: Add Perp Markets ============

        console.log("\n=== Phase 4: Add Perp Markets ===");

        // Add BTC-PERP market
        perpMarket.addMarket(
            BTC_PERP,
            "BTC-USD", // Symbol for price feed
            address(0), // External asset
            20, // 20x max leverage
            500, // 5% maintenance margin
            5, // 0.05% taker fee
            2, // 0.02% maker fee
            1000000 * 1e8 // $1M max open interest
        );
        console.log("  - BTC-PERP market added (20x leverage)");

        // Add ETH-PERP market
        perpMarket.addMarket(ETH_PERP, "ETH-USD", address(0), 20, 500, 5, 2, 1000000 * 1e8);
        console.log("  - ETH-PERP market added (20x leverage)");

        vm.stopBroadcast();

        // ============ Summary ============

        console.log("\n=== Deployment Summary ===");
        console.log("Oracle Marketplace:");
        console.log("  OracleStakingManager:", address(oracleStakingManager));
        console.log("  PriceFeedAggregator:", address(priceFeedAggregator));
        console.log("\nPerps Engine:");
        console.log("  PerpetualMarket:", address(perpMarket));
        console.log("  MarginManager:", address(marginManager));
        console.log("  InsuranceFund:", address(insuranceFund));
        console.log("  LiquidationEngine:", address(liquidationEngine));
        console.log("\nMarkets:");
        console.log("  BTC-PERP:", vm.toString(BTC_PERP));
        console.log("  ETH-PERP:", vm.toString(ETH_PERP));
    }
}

// Simple mocks for localnet deployment
contract MockTokenRegistry {
    mapping(address => bool) public isRegistered;

    function setRegistered(address token, bool status) external {
        isRegistered[token] = status;
    }
}

contract MockPriceOracle {
    mapping(address => uint256) public prices;

    function setPrice(address token, uint256 price) external {
        prices[token] = price;
    }

    function getPrice(address token) external view returns (uint256) {
        return prices[token];
    }
}

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/**
 * @title DeployPerpsLocalnet
 * @notice Full deployment for localnet testing with mock dependencies
 */
contract DeployPerpsLocalnet is Script {
    bytes32 public constant BTC_PERP = keccak256("BTC-PERP");
    bytes32 public constant ETH_PERP = keccak256("ETH-PERP");
    bytes32 public constant BTC_USD = keccak256("BTC-USD");
    bytes32 public constant ETH_USD = keccak256("ETH-USD");

    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying Perps DEX to Localnet");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock dependencies
        MockTokenRegistry tokenRegistry = new MockTokenRegistry();
        MockPriceOracle priceOracle = new MockPriceOracle();
        MockUSDC usdc = new MockUSDC();

        // Configure mocks
        tokenRegistry.setRegistered(address(usdc), true);
        priceOracle.setPrice(address(usdc), 1e18); // $1

        console.log("MockTokenRegistry:", address(tokenRegistry));
        console.log("MockPriceOracle:", address(priceOracle));
        console.log("MockUSDC:", address(usdc));

        // Deploy OracleStakingManager
        OracleStakingManager oracleStakingManager =
            new OracleStakingManager(address(tokenRegistry), address(priceOracle), deployer);
        console.log("OracleStakingManager:", address(oracleStakingManager));

        // Add oracle markets
        oracleStakingManager.addMarket(BTC_USD, "BTC-USD", address(0), 3600, 100, 1);
        oracleStakingManager.addMarket(ETH_USD, "ETH-USD", address(0), 3600, 100, 1);

        // Deploy PriceFeedAggregator
        PriceFeedAggregator priceFeedAggregator = new PriceFeedAggregator(address(oracleStakingManager), deployer);
        console.log("PriceFeedAggregator:", address(priceFeedAggregator));

        // Configure price feeds (asset, marketId, chainlinkFeed, staleness, deviation, requireJejuOracle)
        priceFeedAggregator.configureFeed("BTC-USD", BTC_USD, address(0), 3600, 500, false);
        priceFeedAggregator.configureFeed("ETH-USD", ETH_USD, address(0), 3600, 500, false);

        // Deploy InsuranceFund
        InsuranceFund insuranceFund = new InsuranceFund(address(priceOracle), deployer);
        insuranceFund.addSupportedToken(address(usdc));
        console.log("InsuranceFund:", address(insuranceFund));

        // Deploy MarginManager
        MarginManager marginManager = new MarginManager(address(priceOracle), address(tokenRegistry), deployer);
        marginManager.addCollateralToken(address(usdc), 10000, 0); // 100% weight, no max
        console.log("MarginManager:", address(marginManager));

        // Deploy PerpetualMarket
        PerpetualMarket perpMarket = new PerpetualMarket(
            address(marginManager),
            address(priceFeedAggregator),
            address(insuranceFund),
            deployer, // feeReceiver
            deployer // initialOwner
        );
        console.log("PerpetualMarket:", address(perpMarket));

        // Add markets (marketId, symbol, baseAsset, maxLeverage, maintenanceMarginBps, takerFeeBps, makerFeeBps, maxOpenInterest)
        perpMarket.addMarket(BTC_PERP, "BTC-PERP", address(0), 20, 100, 10, 5, 1000000 ether);
        perpMarket.addMarket(ETH_PERP, "ETH-PERP", address(0), 20, 100, 10, 5, 1000000 ether);

        // Deploy LiquidationEngine
        LiquidationEngine liquidationEngine =
            new LiquidationEngine(address(perpMarket), address(marginManager), address(insuranceFund), deployer);
        console.log("LiquidationEngine:", address(liquidationEngine));

        // Configure authorizations
        marginManager.setAuthorizedContract(address(perpMarket), true);
        marginManager.setAuthorizedContract(address(liquidationEngine), true);
        insuranceFund.setAuthorizedDrawer(address(perpMarket), true);
        insuranceFund.setAuthorizedDrawer(address(liquidationEngine), true);

        // Mint test USDC to deployer
        usdc.mint(deployer, 1_000_000 * 1e6);

        vm.stopBroadcast();

        console.log("\n=== Localnet Deployment Complete ===");
        console.log("Set these in your .env:");
        console.log("NEXT_PUBLIC_PERPETUAL_MARKET_ADDRESS=%s", address(perpMarket));
        console.log("NEXT_PUBLIC_MARGIN_MANAGER_ADDRESS=%s", address(marginManager));
        console.log("NEXT_PUBLIC_INSURANCE_FUND_ADDRESS=%s", address(insuranceFund));
        console.log("NEXT_PUBLIC_LIQUIDATION_ENGINE_ADDRESS=%s", address(liquidationEngine));
        console.log("NEXT_PUBLIC_ORACLE_STAKING_MANAGER_ADDRESS=%s", address(oracleStakingManager));
        console.log("NEXT_PUBLIC_PRICE_FEED_AGGREGATOR_ADDRESS=%s", address(priceFeedAggregator));
    }
}
