// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VRFCoordinatorV2_5} from "../src/chainlink/VRFCoordinatorV2_5.sol";
import {AutomationRegistry} from "../src/chainlink/AutomationRegistry.sol";
import {OracleRouter} from "../src/chainlink/OracleRouter.sol";
import {ChainlinkGovernance} from "../src/chainlink/ChainlinkGovernance.sol";

/**
 * @title DeployChainlink
 * @notice Deploy all Chainlink-compatible contracts for Jeju L2
 * 
 * Usage:
 *   forge script script/DeployChainlink.s.sol --rpc-url $RPC_URL --broadcast
 * 
 * Environment:
 *   PRIVATE_KEY - Deployer private key
 *   LINK_TOKEN - LINK token address (or zero for new deployment)
 *   LINK_ETH_FEED - LINK/ETH price feed address (or zero)
 *   AUTOCRAT_ADDRESS - Autocrat governance contract
 *   TREASURY_ADDRESS - Treasury for fee collection
 */
contract DeployChainlink is Script {
    // Deployed addresses
    VRFCoordinatorV2_5 public vrfCoordinator;
    AutomationRegistry public automationRegistry;
    OracleRouter public oracleRouter;
    ChainlinkGovernance public chainlinkGovernance;

    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerKey);
        
        address linkToken = vm.envOr("LINK_TOKEN", address(0));
        address linkEthFeed = vm.envOr("LINK_ETH_FEED", address(0));
        address autocratAddress = vm.envOr("AUTOCRAT_ADDRESS", deployer);
        address treasuryAddress = vm.envOr("TREASURY_ADDRESS", deployer);
        
        console2.log("Deploying Chainlink contracts...");
        console2.log("Deployer:", deployer);
        console2.log("LINK Token:", linkToken);
        console2.log("Autocrat:", autocratAddress);
        console2.log("Treasury:", treasuryAddress);
        
        vm.startBroadcast(deployerKey);

        // 1. Deploy VRFCoordinatorV2_5
        vrfCoordinator = new VRFCoordinatorV2_5(
            linkToken,
            linkEthFeed,
            autocratAddress  // governance
        );
        console2.log("VRFCoordinatorV2_5 deployed:", address(vrfCoordinator));

        // 2. Deploy AutomationRegistry
        automationRegistry = new AutomationRegistry(autocratAddress);
        console2.log("AutomationRegistry deployed:", address(automationRegistry));

        // 3. Deploy OracleRouter
        oracleRouter = new OracleRouter(autocratAddress);
        console2.log("OracleRouter deployed:", address(oracleRouter));

        // 4. Deploy ChainlinkGovernance (master controller)
        chainlinkGovernance = new ChainlinkGovernance(
            autocratAddress,
            address(vrfCoordinator),
            address(automationRegistry),
            address(oracleRouter)
        );
        console2.log("ChainlinkGovernance deployed:", address(chainlinkGovernance));

        // 5. Configure contracts to use ChainlinkGovernance
        vrfCoordinator.setGovernance(address(chainlinkGovernance));
        automationRegistry.setGovernance(address(chainlinkGovernance));
        oracleRouter.setGovernance(address(chainlinkGovernance));
        console2.log("Governance set on all contracts");

        // 6. Set fee recipients to treasury
        vrfCoordinator.setFeeRecipient(treasuryAddress);
        automationRegistry.setFeeRecipient(treasuryAddress);
        oracleRouter.setFeeRecipient(treasuryAddress);
        console2.log("Fee recipients set to treasury");

        // 7. Register a default VRF proving key
        bytes32 defaultKeyHash = keccak256(abi.encodePacked("jeju-vrf-default-key"));
        vrfCoordinator.registerProvingKey(defaultKeyHash, deployer);
        console2.log("Default VRF key registered:", vm.toString(defaultKeyHash));

        // 8. Register default oracle jobs
        _registerDefaultJobs();

        vm.stopBroadcast();

        // Log all addresses
        console2.log("\n=== Chainlink Contracts Deployed ===");
        console2.log("VRFCoordinatorV2_5:   ", address(vrfCoordinator));
        console2.log("AutomationRegistry:   ", address(automationRegistry));
        console2.log("OracleRouter:         ", address(oracleRouter));
        console2.log("ChainlinkGovernance:  ", address(chainlinkGovernance));
        console2.log("=====================================\n");
        
        console2.log("Next steps:");
        console2.log("1. Transfer ownership to multisig/DAO");
        console2.log("2. Register additional VRF keys for production oracles");
        console2.log("3. Approve keepers for automation");
        console2.log("4. Approve oracles for data requests");
    }

    function _registerDefaultJobs() internal {
        // HTTP GET job
        bytes32 httpGetJob = keccak256("http-get");
        oracleRouter.registerJob(
            httpGetJob,
            "HTTP GET",
            "Fetch data from any HTTP endpoint",
            address(0),  // Any oracle can fulfill
            0.001 ether  // Min payment
        );
        console2.log("Registered job: HTTP GET");

        // Price Feed job
        bytes32 priceFeedJob = keccak256("price-feed");
        oracleRouter.registerJob(
            priceFeedJob,
            "Price Feed",
            "Get price data for any asset pair",
            address(0),
            0.0005 ether
        );
        console2.log("Registered job: Price Feed");

        // AI Inference job
        bytes32 aiJob = keccak256("ai-inference");
        oracleRouter.registerJob(
            aiJob,
            "AI Inference",
            "Run AI model inference via oracle",
            address(0),
            0.01 ether
        );
        console2.log("Registered job: AI Inference");

        // Cross-chain read job
        bytes32 crossChainJob = keccak256("cross-chain-read");
        oracleRouter.registerJob(
            crossChainJob,
            "Cross-Chain Read",
            "Read state from other EVM chains",
            address(0),
            0.002 ether
        );
        console2.log("Registered job: Cross-Chain Read");
    }
}

/**
 * @title ConfigureChainlinkOracles
 * @notice Register oracles and keepers for production use
 */
contract ConfigureChainlinkOracles is Script {
    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        
        address chainlinkGovernanceAddr = vm.envAddress("CHAINLINK_GOVERNANCE");
        
        // Oracle addresses to approve
        address oracle1 = vm.envOr("ORACLE_1", address(0));
        address oracle2 = vm.envOr("ORACLE_2", address(0));
        address keeper1 = vm.envOr("KEEPER_1", address(0));
        address keeper2 = vm.envOr("KEEPER_2", address(0));
        
        ChainlinkGovernance governance = ChainlinkGovernance(chainlinkGovernanceAddr);
        
        vm.startBroadcast(deployerKey);

        // Approve oracles
        if (oracle1 != address(0)) {
            governance.approveOracle(oracle1);
            console2.log("Approved oracle:", oracle1);
        }
        if (oracle2 != address(0)) {
            governance.approveOracle(oracle2);
            console2.log("Approved oracle:", oracle2);
        }

        // Approve keepers
        if (keeper1 != address(0)) {
            governance.approveKeeper(keeper1);
            console2.log("Approved keeper:", keeper1);
        }
        if (keeper2 != address(0)) {
            governance.approveKeeper(keeper2);
            console2.log("Approved keeper:", keeper2);
        }

        vm.stopBroadcast();

        console2.log("Oracle and keeper configuration complete!");
    }
}

/**
 * @title CreateVRFSubscription
 * @notice Create and fund a VRF subscription
 */
contract CreateVRFSubscription is Script {
    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address vrfCoordinatorAddr = vm.envAddress("VRF_COORDINATOR");
        address consumer = vm.envOr("VRF_CONSUMER", address(0));
        
        VRFCoordinatorV2_5 vrf = VRFCoordinatorV2_5(vrfCoordinatorAddr);
        
        vm.startBroadcast(deployerKey);

        // Create subscription
        uint64 subId = vrf.createSubscription();
        console2.log("Created VRF subscription:", subId);

        // Fund with native token
        vrf.fundSubscriptionNative{value: 0.1 ether}(subId);
        console2.log("Funded subscription with 0.1 ETH");

        // Add consumer if provided
        if (consumer != address(0)) {
            vrf.addConsumer(subId, consumer);
            console2.log("Added consumer:", consumer);
        }

        vm.stopBroadcast();

        console2.log("\nVRF Subscription created!");
        console2.log("Subscription ID:", subId);
        console2.log("Use this ID in your consumer contract");
    }
}

/**
 * @title RegisterAutomationUpkeep
 * @notice Register an automation upkeep
 */
contract RegisterAutomationUpkeep is Script {
    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address automationRegistryAddr = vm.envAddress("AUTOMATION_REGISTRY");
        address target = vm.envAddress("UPKEEP_TARGET");
        uint32 gasLimit = uint32(vm.envOr("UPKEEP_GAS_LIMIT", uint256(500000)));
        uint32 interval = uint32(vm.envOr("UPKEEP_INTERVAL", uint256(3600)));  // 1 hour default
        
        AutomationRegistry registry = AutomationRegistry(automationRegistryAddr);
        
        vm.startBroadcast(deployerKey);

        // Register upkeep with initial funding
        uint256 upkeepId = registry.registerUpkeep{value: 0.1 ether}(
            target,
            gasLimit,
            interval,
            "",  // checkData
            AutomationRegistry.UpkeepType.CONDITIONAL
        );
        
        console2.log("Registered upkeep ID:", upkeepId);
        console2.log("Target:", target);
        console2.log("Gas limit:", gasLimit);
        console2.log("Interval:", interval, "seconds");

        vm.stopBroadcast();
    }
}

