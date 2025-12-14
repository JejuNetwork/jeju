// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {FeedRegistry} from "../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../src/oracle/ReportVerifier.sol";
import {CommitteeManager} from "../src/oracle/CommitteeManager.sol";
import {OracleFeeRouter} from "../src/oracle/OracleFeeRouter.sol";
import {DisputeGame} from "../src/oracle/DisputeGame.sol";
import {OracleNetworkConnector} from "../src/oracle/OracleNetworkConnector.sol";
import {IFeedRegistry} from "../src/oracle/interfaces/IFeedRegistry.sol";

/**
 * @title DeployOracleNetwork
 * @notice Deploys complete Jeju Oracle Network (JON) contracts
 *
 * Usage:
 *   forge script script/DeployOracleNetwork.s.sol:DeployOracleNetwork \
 *     --rpc-url $RPC_URL \
 *     --broadcast \
 *     --verify
 */
contract DeployOracleNetwork is Script {
    // Deployed addresses
    FeedRegistry public feedRegistry;
    CommitteeManager public committeeManager;
    ReportVerifier public reportVerifier;
    OracleFeeRouter public feeRouter;
    DisputeGame public disputeGame;
    OracleNetworkConnector public connector;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        // Optional: existing ERC-8004 registries
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY_ADDRESS", address(0));
        address reputationRegistry = vm.envOr("REPUTATION_REGISTRY_ADDRESS", address(0));
        address stakingManager = vm.envOr("ORACLE_STAKING_ADDRESS", address(0));

        console.log("==========================================");
        console.log("Deploying Jeju Oracle Network (JON)");
        console.log("==========================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy FeedRegistry
        feedRegistry = new FeedRegistry(deployer);
        console.log("FeedRegistry:", address(feedRegistry));

        // 2. Deploy CommitteeManager
        committeeManager = new CommitteeManager(address(feedRegistry), deployer);
        console.log("CommitteeManager:", address(committeeManager));

        // 3. Deploy ReportVerifier
        reportVerifier = new ReportVerifier(address(feedRegistry), address(committeeManager), deployer);
        console.log("ReportVerifier:", address(reportVerifier));

        // 4. Deploy OracleFeeRouter
        feeRouter = new OracleFeeRouter(address(feedRegistry), deployer);
        console.log("OracleFeeRouter:", address(feeRouter));

        // 5. Deploy DisputeGame
        disputeGame = new DisputeGame(address(reportVerifier), address(feedRegistry), deployer);
        console.log("DisputeGame:", address(disputeGame));

        // 6. Deploy OracleNetworkConnector
        connector = new OracleNetworkConnector(
            address(feedRegistry),
            address(committeeManager),
            stakingManager,
            identityRegistry,
            reputationRegistry,
            deployer
        );
        console.log("OracleNetworkConnector:", address(connector));

        // 7. Wire connector to report verifier
        reportVerifier.setConnector(address(connector));
        console.log("Wired connector to ReportVerifier");

        // 8. Create standard feeds
        _createStandardFeeds();

        vm.stopBroadcast();

        _printSummary(identityRegistry, reputationRegistry, stakingManager);
    }

    function _createStandardFeeds() internal {
        console.log("");
        console.log("Creating standard feeds...");

        // ETH-USD
        bytes32 ethUsdId = feedRegistry.createFeed(
            IFeedRegistry.FeedCreateParams({
                symbol: "ETH-USD",
                baseToken: address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2),
                quoteToken: address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 100_000 ether,
                maxDeviationBps: 100,
                minOracles: 3,
                quorumThreshold: 2,
                requiresConfidence: true,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            })
        );
        console.log("  ETH-USD:", vm.toString(ethUsdId));

        // BTC-USD
        bytes32 btcUsdId = feedRegistry.createFeed(
            IFeedRegistry.FeedCreateParams({
                symbol: "BTC-USD",
                baseToken: address(0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599),
                quoteToken: address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 100_000 ether,
                maxDeviationBps: 100,
                minOracles: 3,
                quorumThreshold: 2,
                requiresConfidence: true,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            })
        );
        console.log("  BTC-USD:", vm.toString(btcUsdId));

        // USDC-USD (stablecoin peg)
        bytes32 usdcUsdId = feedRegistry.createFeed(
            IFeedRegistry.FeedCreateParams({
                symbol: "USDC-USD",
                baseToken: address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),
                quoteToken: address(0),
                decimals: 8,
                heartbeatSeconds: 86400,
                twapWindowSeconds: 3600,
                minLiquidityUSD: 10_000 ether,
                maxDeviationBps: 50,
                minOracles: 2,
                quorumThreshold: 2,
                requiresConfidence: false,
                category: IFeedRegistry.FeedCategory.STABLECOIN_PEG
            })
        );
        console.log("  USDC-USD:", vm.toString(usdcUsdId));
    }

    function _printSummary(address identityRegistry, address reputationRegistry, address stakingManager)
        internal
        view
    {
        console.log("");
        console.log("==========================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("==========================================");
        console.log("");
        console.log("Core Contracts:");
        console.log("  FeedRegistry:", address(feedRegistry));
        console.log("  CommitteeManager:", address(committeeManager));
        console.log("  ReportVerifier:", address(reportVerifier));
        console.log("  OracleFeeRouter:", address(feeRouter));
        console.log("  DisputeGame:", address(disputeGame));
        console.log("  OracleNetworkConnector:", address(connector));
        console.log("");

        if (identityRegistry == address(0) || reputationRegistry == address(0) || stakingManager == address(0)) {
            console.log("WARNINGS:");
            if (identityRegistry == address(0)) console.log("  - IdentityRegistry not set");
            if (reputationRegistry == address(0)) console.log("  - ReputationRegistry not set");
            if (stakingManager == address(0)) console.log("  - OracleStakingManager not set");
            console.log("");
        }

        console.log("Next steps:");
        console.log("  1. Save addresses to apps/gateway/src/lib/oracleNetwork.ts");
        console.log("  2. Register oracle operators via OracleNetworkConnector");
        console.log("  3. Form committees via CommitteeManager");
        console.log("  4. Start oracle node software to submit reports");
        console.log("==========================================");
    }
}
