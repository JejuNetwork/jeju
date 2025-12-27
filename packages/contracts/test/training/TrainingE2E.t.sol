// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {TrainingCoordinator} from "../../src/training/TrainingCoordinator.sol";
import {ITrainingCoordinator} from "../../src/training/interfaces/ITrainingCoordinator.sol";
import {TrainingRewards} from "../../src/training/TrainingRewards.sol";
import {NodePerformanceOracle} from "../../src/training/NodePerformanceOracle.sol";
import {TrainingRegistry} from "../../src/training/TrainingRegistry.sol";
import {ComputeRegistry} from "../../src/compute/ComputeRegistry.sol";
import {MPCKeyRegistry} from "../../src/kms/MPCKeyRegistry.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SimpleToken is ERC20 {
    constructor() ERC20("Reward", "RWD") {
        _mint(msg.sender, 100000 ether);
    }
}

/**
 * @title End-to-End Training Integration Test
 * @notice Tests deployment and basic integration of training contracts
 */
contract TrainingE2ETest is Test {
    TrainingCoordinator coordinator;
    TrainingRewards rewards;
    NodePerformanceOracle oracle;
    TrainingRegistry registry;
    ComputeRegistry computeRegistry;
    MPCKeyRegistry mpcRegistry;
    SimpleToken rewardToken;

    address owner = address(this);
    address provider1 = makeAddr("provider1");
    address provider2 = makeAddr("provider2");
    address provider3 = makeAddr("provider3");

    bytes32 runId = bytes32(uint256(1));

    function setUp() public {
        // Deploy core dependencies
        computeRegistry = new ComputeRegistry(owner, address(0), address(0), 0.01 ether);
        mpcRegistry = new MPCKeyRegistry(0.01 ether);
        rewardToken = new SimpleToken();

        // Deploy training contracts
        coordinator = new TrainingCoordinator(address(computeRegistry), address(mpcRegistry), owner);
        rewards = new TrainingRewards(address(coordinator), owner);
        registry = new TrainingRegistry(address(coordinator), address(mpcRegistry), owner);
        oracle = new NodePerformanceOracle(address(coordinator), address(computeRegistry), owner);

        // Fund and register providers
        vm.deal(provider1, 1 ether);
        vm.deal(provider2, 1 ether);
        vm.deal(provider3, 1 ether);

        vm.prank(provider1);
        computeRegistry.register{value: 0.01 ether}("provider1", "node1.jejunetwork.org", bytes32(0));
        vm.prank(provider2);
        computeRegistry.register{value: 0.01 ether}("provider2", "node2.jejunetwork.org", bytes32(0));
        vm.prank(provider3);
        computeRegistry.register{value: 0.01 ether}("provider3", "node3.jejunetwork.org", bytes32(0));

        console.log("Setup complete");
    }

    function getDefaultConfig() internal pure returns (ITrainingCoordinator.CoordinatorConfig memory) {
        return ITrainingCoordinator.CoordinatorConfig({
            warmupTime: 60,
            cooldownTime: 30,
            maxRoundTrainTime: 120,
            roundWitnessTime: 30,
            epochTime: 600,
            globalBatchSizeWarmupTokens: 1_000_000,
            totalSteps: 100,
            initMinClients: 3,
            minClients: 2,
            witnessNodes: 2,
            globalBatchSizeStart: 4,
            globalBatchSizeEnd: 16,
            verificationPercent: 10,
            waitingForMembersExtraTime: 30
        });
    }

    function getDefaultModel() internal pure returns (ITrainingCoordinator.ModelConfig memory) {
        return ITrainingCoordinator.ModelConfig({
            modelHash: keccak256("test-model"),
            hfRepo: "jeju/test-model",
            maxSeqLen: 2048,
            coldStartWarmupSteps: 10
        });
    }

    function testDeploymentIntegration() public {
        console.log("\n=== DEPLOYMENT INTEGRATION TEST ===\n");

        // Verify all contracts deployed correctly
        assertTrue(address(coordinator) != address(0), "Coordinator deployed");
        assertTrue(address(rewards) != address(0), "Rewards deployed");
        assertTrue(address(oracle) != address(0), "Oracle deployed");
        assertTrue(address(registry) != address(0), "Registry deployed");

        // Verify contract linkage
        assertEq(address(rewards.coordinator()), address(coordinator), "Rewards linked to coordinator");
        assertEq(address(oracle.coordinator()), address(coordinator), "Oracle linked to coordinator");

        console.log("All contracts deployed and linked correctly");
    }

    function testRunCreation() public {
        console.log("\n=== RUN CREATION TEST ===\n");

        coordinator.createRun(
            runId, getDefaultConfig(), getDefaultModel(), ITrainingCoordinator.PrivacyMode.Public, bytes32(0)
        );

        assertEq(uint256(coordinator.getRunState(runId)), uint256(ITrainingCoordinator.RunState.WaitingForMembers));
        console.log("Run created successfully");
    }

    function testClientJoining() public {
        console.log("\n=== CLIENT JOINING TEST ===\n");

        coordinator.createRun(
            runId, getDefaultConfig(), getDefaultModel(), ITrainingCoordinator.PrivacyMode.Public, bytes32(0)
        );

        vm.prank(provider1);
        coordinator.joinRun(runId, bytes32(uint256(101)));

        vm.prank(provider2);
        coordinator.joinRun(runId, bytes32(uint256(102)));

        vm.prank(provider3);
        coordinator.joinRun(runId, bytes32(uint256(103)));

        console.log("3 clients joined successfully");
    }

    function testNodePerformanceRegistration() public {
        console.log("\n=== NODE PERFORMANCE TEST ===\n");

        vm.prank(provider1);
        oracle.registerNode(NodePerformanceOracle.GPUTier.HighEnd, bytes32(0));

        vm.prank(provider2);
        oracle.registerNode(NodePerformanceOracle.GPUTier.Datacenter, bytes32(0));

        uint256 score1 = oracle.getNodeScore(provider1);
        uint256 score2 = oracle.getNodeScore(provider2);

        console.log("Provider1 score:", score1);
        console.log("Provider2 score:", score2);

        assertTrue(score1 > 0, "Provider1 has score");
        assertTrue(score2 > 0, "Provider2 has score");
    }

    function testRewardPoolCreation() public {
        console.log("\n=== REWARD POOL TEST ===\n");

        // Create run first
        coordinator.createRun(
            runId, getDefaultConfig(), getDefaultModel(), ITrainingCoordinator.PrivacyMode.Public, bytes32(0)
        );

        // Approve and create reward pool
        rewardToken.approve(address(rewards), 1000 ether);
        rewards.createRewardPool(runId, address(rewardToken), 1000 ether, 100);

        console.log("Reward pool created successfully");
    }

    function testOptimalNodeSelection() public {
        console.log("\n=== OPTIMAL NODE SELECTION TEST ===\n");

        // Register nodes with different performance
        vm.prank(provider1);
        oracle.registerNode(NodePerformanceOracle.GPUTier.HighEnd, bytes32(0));
        vm.prank(provider2);
        oracle.registerNode(NodePerformanceOracle.GPUTier.Datacenter, bytes32(0));
        vm.prank(provider3);
        oracle.registerNode(NodePerformanceOracle.GPUTier.Prosumer, bytes32(0));

        address[] memory optimalNodes = oracle.getOptimalNodes(3, NodePerformanceOracle.GPUTier.Unknown, 0, 0);

        console.log("Optimal nodes count:", optimalNodes.length);
        assertEq(optimalNodes.length, 3, "Got 3 optimal nodes");

        // With GPU tier filter
        address[] memory highEndNodes = oracle.getOptimalNodes(3, NodePerformanceOracle.GPUTier.Datacenter, 0, 0);
        console.log("High end nodes:", highEndNodes.length);
    }

    function testFullE2EFlow() public {
        console.log("\n=== FULL E2E FLOW TEST ===\n");

        // 1. Deploy and verify (done in setUp)
        console.log("Step 1: Deployment verified");

        // 2. Create training run
        coordinator.createRun(
            runId, getDefaultConfig(), getDefaultModel(), ITrainingCoordinator.PrivacyMode.Public, bytes32(0)
        );
        console.log("Step 2: Run created");

        // 3. Clients join
        vm.prank(provider1);
        coordinator.joinRun(runId, bytes32(uint256(101)));
        vm.prank(provider2);
        coordinator.joinRun(runId, bytes32(uint256(102)));
        vm.prank(provider3);
        coordinator.joinRun(runId, bytes32(uint256(103)));
        console.log("Step 3: Clients joined");

        // 4. Register nodes for performance tracking
        vm.prank(provider1);
        oracle.registerNode(NodePerformanceOracle.GPUTier.HighEnd, bytes32(0));
        vm.prank(provider2);
        oracle.registerNode(NodePerformanceOracle.GPUTier.Datacenter, bytes32(0));
        console.log("Step 4: Nodes registered in performance oracle");

        // 5. Create reward pool
        rewardToken.approve(address(rewards), 1000 ether);
        rewards.createRewardPool(runId, address(rewardToken), 1000 ether, 100);
        console.log("Step 5: Reward pool created");

        // 6. Verify state
        assertEq(uint256(coordinator.getRunState(runId)), uint256(ITrainingCoordinator.RunState.WaitingForMembers));

        address[] memory optimal = oracle.getOptimalNodes(5, NodePerformanceOracle.GPUTier.Unknown, 0, 0);
        assertTrue(optimal.length > 0, "Have optimal nodes");

        console.log("\n=== E2E FLOW COMPLETE ===");
    }
}
