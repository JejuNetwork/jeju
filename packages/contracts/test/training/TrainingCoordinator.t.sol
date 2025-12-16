// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/training/TrainingCoordinator.sol";
import "../../src/training/TrainingRewards.sol";
import "../../src/training/NodePerformanceOracle.sol";
import "../../src/training/TrainingRegistry.sol";
import "../../src/compute/ComputeRegistry.sol";
import "../../src/kms/MPCKeyRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MOCK") {
        _mint(msg.sender, 1_000_000 ether);
    }
}

contract TrainingCoordinatorTest is Test {
    TrainingCoordinator public coordinator;
    TrainingRewards public rewards;
    NodePerformanceOracle public performance;
    TrainingRegistry public registry;
    ComputeRegistry public computeRegistry;
    MPCKeyRegistry public mpcKeyRegistry;
    MockToken public token;

    address public owner = address(this);
    address public creator = makeAddr("creator");
    address public client1 = makeAddr("client1");
    address public client2 = makeAddr("client2");
    address public client3 = makeAddr("client3");
    address public client4 = makeAddr("client4");

    bytes32 public runId = keccak256("test-run-1");
    bytes32 public p2pEndpoint1 = keccak256("endpoint-1");
    bytes32 public p2pEndpoint2 = keccak256("endpoint-2");
    bytes32 public p2pEndpoint3 = keccak256("endpoint-3");
    bytes32 public p2pEndpoint4 = keccak256("endpoint-4");

    function setUp() public {
        // Deploy compute registry (new constructor: owner, identityRegistry, banManager, minProviderStake)
        computeRegistry = new ComputeRegistry(owner, address(0), address(0), 0.01 ether);

        // Deploy MPC key registry
        mpcKeyRegistry = new MPCKeyRegistry(0.01 ether);

        // Deploy coordinator
        coordinator = new TrainingCoordinator(
            address(computeRegistry),
            address(mpcKeyRegistry),
            owner
        );

        // Deploy rewards
        rewards = new TrainingRewards(address(coordinator), owner);

        // Deploy performance oracle
        performance = new NodePerformanceOracle(
            address(coordinator),
            address(computeRegistry),
            owner
        );

        // Deploy registry
        registry = new TrainingRegistry(
            address(coordinator),
            address(mpcKeyRegistry),
            owner
        );

        // Deploy mock token
        token = new MockToken();

        // Register clients as compute providers
        vm.deal(client1, 1 ether);
        vm.deal(client2, 1 ether);
        vm.deal(client3, 1 ether);
        vm.deal(client4, 1 ether);

        vm.startPrank(client1);
        computeRegistry.register{value: 0.01 ether}("Client 1", "http://localhost:8001", bytes32(0));
        vm.stopPrank();

        vm.startPrank(client2);
        computeRegistry.register{value: 0.01 ether}("Client 2", "http://localhost:8002", bytes32(0));
        vm.stopPrank();

        vm.startPrank(client3);
        computeRegistry.register{value: 0.01 ether}("Client 3", "http://localhost:8003", bytes32(0));
        vm.stopPrank();

        vm.startPrank(client4);
        computeRegistry.register{value: 0.01 ether}("Client 4", "http://localhost:8004", bytes32(0));
        vm.stopPrank();
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
            initMinClients: 4,
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
            hfRepo: "test/model-v1",
            maxSeqLen: 2048,
            coldStartWarmupSteps: 10
        });
    }

    // ============ Run Creation Tests ============

    function testCreateRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.WaitingForMembers));
    }

    function testCannotCreateDuplicateRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.expectRevert(TrainingCoordinator.RunAlreadyExists.selector);
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );
    }

    // ============ Join Run Tests ============

    function testJoinRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);

        // Client should be pending until WaitingForMembers transitions
        // The client is not yet in the active client list
        assertEq(coordinator.getClientCount(runId), 0);
    }

    function testMultipleClientsJoin() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);

        vm.prank(client2);
        coordinator.joinRun(runId, p2pEndpoint2);

        vm.prank(client3);
        coordinator.joinRun(runId, p2pEndpoint3);

        vm.prank(client4);
        coordinator.joinRun(runId, p2pEndpoint4);
    }

    function testCannotJoinRunTwice() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);

        vm.expectRevert(TrainingCoordinator.ClientAlreadyJoined.selector);
        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);
    }

    // ============ State Transition Tests ============

    function testTickTransitionsToWarmup() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        // Join 4 clients
        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);
        vm.prank(client2);
        coordinator.joinRun(runId, p2pEndpoint2);
        vm.prank(client3);
        coordinator.joinRun(runId, p2pEndpoint3);
        vm.prank(client4);
        coordinator.joinRun(runId, p2pEndpoint4);

        // Advance time past the waiting period
        vm.warp(block.timestamp + 31);

        // Tick to transition
        coordinator.tick(runId);

        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.Warmup));
        assertEq(coordinator.getClientCount(runId), 4);
    }

    function testWarmupTransitionsToRoundTrain() public {
        // Create run and join clients
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);
        vm.prank(client2);
        coordinator.joinRun(runId, p2pEndpoint2);
        vm.prank(client3);
        coordinator.joinRun(runId, p2pEndpoint3);
        vm.prank(client4);
        coordinator.joinRun(runId, p2pEndpoint4);

        // Transition to Warmup
        vm.warp(block.timestamp + 31);
        coordinator.tick(runId);

        // Advance past warmup time
        vm.warp(block.timestamp + 61);
        coordinator.tick(runId);

        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.RoundTrain));
    }

    // ============ Pause/Resume Tests ============

    function testPauseRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.prank(creator);
        coordinator.pauseRun(runId);

        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.Paused));
    }

    function testResumeRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.prank(creator);
        coordinator.pauseRun(runId);

        vm.prank(creator);
        coordinator.resumeRun(runId);

        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.WaitingForMembers));
    }

    function testOnlyCreatorCanPause() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.expectRevert(TrainingCoordinator.NotRunCreator.selector);
        vm.prank(client1);
        coordinator.pauseRun(runId);
    }

    // ============ View Function Tests ============

    function testGetRunInfo() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        (
            address runCreator,
            ITrainingCoordinator.RunState state,
            uint16 epoch,
            uint32 step,
            uint16 clientCount,
            ITrainingCoordinator.PrivacyMode privacyMode
        ) = coordinator.getRun(runId);

        assertEq(runCreator, creator);
        assertEq(uint8(state), uint8(ITrainingCoordinator.RunState.WaitingForMembers));
        assertEq(epoch, 0);
        assertEq(step, 1);
        assertEq(clientCount, 0);
        assertEq(uint8(privacyMode), uint8(ITrainingCoordinator.PrivacyMode.Public));
    }

    function testGetActiveRunCount() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        assertEq(coordinator.getActiveRunCount(), 1);

        bytes32 runId2 = keccak256("test-run-2");
        vm.prank(creator);
        coordinator.createRun(
            runId2,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        assertEq(coordinator.getActiveRunCount(), 2);
    }

    // ============ Boundary Condition Tests ============

    function testInvalidConfigZeroSteps() public {
        ITrainingCoordinator.CoordinatorConfig memory config = getDefaultConfig();
        config.totalSteps = 0;

        vm.expectRevert(TrainingCoordinator.InvalidConfig.selector);
        vm.prank(creator);
        coordinator.createRun(
            runId,
            config,
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );
    }

    function testInvalidConfigZeroClients() public {
        ITrainingCoordinator.CoordinatorConfig memory config = getDefaultConfig();
        config.minClients = 0;

        vm.expectRevert(TrainingCoordinator.InvalidConfig.selector);
        vm.prank(creator);
        coordinator.createRun(
            runId,
            config,
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );
    }

    function testInvalidConfigInitClientsLessThanMin() public {
        ITrainingCoordinator.CoordinatorConfig memory config = getDefaultConfig();
        config.minClients = 10;
        config.initMinClients = 5;

        vm.expectRevert(TrainingCoordinator.InvalidConfig.selector);
        vm.prank(creator);
        coordinator.createRun(
            runId,
            config,
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );
    }

    function testInvalidConfigWitnessNodesExceedsMinClients() public {
        ITrainingCoordinator.CoordinatorConfig memory config = getDefaultConfig();
        config.minClients = 4;
        config.witnessNodes = 10;

        vm.expectRevert(TrainingCoordinator.InvalidConfig.selector);
        vm.prank(creator);
        coordinator.createRun(
            runId,
            config,
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );
    }

    function testInvalidConfigBatchSizeEndLessThanStart() public {
        ITrainingCoordinator.CoordinatorConfig memory config = getDefaultConfig();
        config.globalBatchSizeStart = 32;
        config.globalBatchSizeEnd = 16;

        vm.expectRevert(TrainingCoordinator.InvalidConfig.selector);
        vm.prank(creator);
        coordinator.createRun(
            runId,
            config,
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );
    }

    // ============ Error Handling Tests ============

    function testUnregisteredProviderCannotJoin() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        address unregistered = makeAddr("unregistered");
        vm.expectRevert(TrainingCoordinator.NotRegisteredProvider.selector);
        vm.prank(unregistered);
        coordinator.joinRun(runId, keccak256("unregistered-endpoint"));
    }

    function testCannotJoinNonExistentRun() public {
        bytes32 fakeRunId = keccak256("fake-run");
        vm.expectRevert(TrainingCoordinator.RunNotFound.selector);
        vm.prank(client1);
        coordinator.joinRun(fakeRunId, p2pEndpoint1);
    }

    function testCannotTickNonExistentRun() public {
        bytes32 fakeRunId = keccak256("fake-run");
        vm.expectRevert(TrainingCoordinator.RunNotFound.selector);
        coordinator.tick(fakeRunId);
    }

    function testCannotTickHaltedRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.prank(creator);
        coordinator.pauseRun(runId);

        vm.expectRevert(TrainingCoordinator.RunHalted.selector);
        coordinator.tick(runId);
    }

    function testCannotPauseAlreadyPausedRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.prank(creator);
        coordinator.pauseRun(runId);

        vm.expectRevert(TrainingCoordinator.CannotPause.selector);
        vm.prank(creator);
        coordinator.pauseRun(runId);
    }

    function testCannotResumeNonPausedRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.expectRevert(TrainingCoordinator.CannotResume.selector);
        vm.prank(creator);
        coordinator.resumeRun(runId);
    }

    function testCannotJoinDuringWrongState() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        // Join 4 clients and transition to Warmup
        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);
        vm.prank(client2);
        coordinator.joinRun(runId, p2pEndpoint2);
        vm.prank(client3);
        coordinator.joinRun(runId, p2pEndpoint3);
        vm.prank(client4);
        coordinator.joinRun(runId, p2pEndpoint4);

        vm.warp(block.timestamp + 31);
        coordinator.tick(runId);

        // Wait for warmup to complete and transition to RoundTrain
        vm.warp(block.timestamp + 61);
        coordinator.tick(runId);

        // Try to join during RoundTrain - should fail
        address client5 = makeAddr("client5");
        vm.deal(client5, 1 ether);
        vm.prank(client5);
        computeRegistry.register{value: 0.01 ether}("Client 5", "http://localhost:8005", bytes32(0));

        vm.expectRevert();
        vm.prank(client5);
        coordinator.joinRun(runId, keccak256("endpoint-5"));
    }

    // ============ Private Run Tests ============

    function testPrivateRunRequiresMPCKey() public {
        vm.expectRevert(TrainingCoordinator.MPCKeyRequired.selector);
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Private,
            bytes32(0)
        );
    }

    // ============ Full Workflow Tests ============

    function testCompleteTrainingWorkflow() public {
        // 1. Create run
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );
        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.WaitingForMembers));

        // 2. Join clients
        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);
        vm.prank(client2);
        coordinator.joinRun(runId, p2pEndpoint2);
        vm.prank(client3);
        coordinator.joinRun(runId, p2pEndpoint3);
        vm.prank(client4);
        coordinator.joinRun(runId, p2pEndpoint4);

        // 3. Transition to Warmup
        vm.warp(block.timestamp + 31);
        coordinator.tick(runId);
        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.Warmup));

        // 4. Verify clients are active
        assertEq(coordinator.getClientCount(runId), 4);
        assertTrue(coordinator.isClientInRun(runId, client1));
        assertTrue(coordinator.isClientInRun(runId, client2));
        assertTrue(coordinator.isClientInRun(runId, client3));
        assertTrue(coordinator.isClientInRun(runId, client4));

        // 5. Transition to RoundTrain
        vm.warp(block.timestamp + 61);
        coordinator.tick(runId);
        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.RoundTrain));

        // 6. Verify step is advancing
        assertEq(coordinator.getStep(runId), 1);

        // 7. Get current round data
        ITrainingCoordinator.Round memory round = coordinator.getCurrentRound(runId);
        assertEq(round.height, 0);
        assertEq(round.clientsLen, 4);
        assertGt(round.randomSeed, 0);
    }

    function testWithdrawFromRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        // Join 4 clients and transition
        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);
        vm.prank(client2);
        coordinator.joinRun(runId, p2pEndpoint2);
        vm.prank(client3);
        coordinator.joinRun(runId, p2pEndpoint3);
        vm.prank(client4);
        coordinator.joinRun(runId, p2pEndpoint4);

        vm.warp(block.timestamp + 31);
        coordinator.tick(runId);

        // Withdraw client1
        vm.prank(client1);
        coordinator.withdrawFromRun(runId);

        // Client1 should still be "in run" but marked as withdrawn
        ITrainingCoordinator.Client[] memory clients = coordinator.getClients(runId);
        bool found = false;
        for (uint256 i = 0; i < clients.length; i++) {
            if (clients[i].addr == client1) {
                found = true;
                assertEq(uint8(clients[i].state), uint8(ITrainingCoordinator.ClientState.Withdrawn));
            }
        }
        assertTrue(found);
    }

    function testCannotWithdrawIfNotInRun() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        address notInRun = makeAddr("notInRun");
        vm.expectRevert(TrainingCoordinator.ClientNotInRun.selector);
        vm.prank(notInRun);
        coordinator.withdrawFromRun(runId);
    }

    // ============ Timing Edge Cases ============

    function testTickBeforeTimeout() public {
        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        vm.prank(client1);
        coordinator.joinRun(runId, p2pEndpoint1);
        vm.prank(client2);
        coordinator.joinRun(runId, p2pEndpoint2);
        vm.prank(client3);
        coordinator.joinRun(runId, p2pEndpoint3);
        vm.prank(client4);
        coordinator.joinRun(runId, p2pEndpoint4);

        // Warp to 1 second before timeout - should still be waiting
        vm.warp(block.timestamp + 29);
        coordinator.tick(runId);

        // Should still be waiting
        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.WaitingForMembers));

        // Now 2 more seconds (past the 30 second threshold)
        vm.warp(block.timestamp + 2);
        coordinator.tick(runId);

        // Now should transition
        assertEq(uint8(coordinator.getRunState(runId)), uint8(ITrainingCoordinator.RunState.Warmup));
    }

    function testMultipleRunsSimultaneously() public {
        bytes32 run1 = keccak256("run-1");
        bytes32 run2 = keccak256("run-2");
        bytes32 run3 = keccak256("run-3");

        // Create 3 runs
        vm.prank(creator);
        coordinator.createRun(run1, getDefaultConfig(), getDefaultModel(), ITrainingCoordinator.PrivacyMode.Public, bytes32(0));
        vm.prank(creator);
        coordinator.createRun(run2, getDefaultConfig(), getDefaultModel(), ITrainingCoordinator.PrivacyMode.Public, bytes32(0));
        vm.prank(creator);
        coordinator.createRun(run3, getDefaultConfig(), getDefaultModel(), ITrainingCoordinator.PrivacyMode.Public, bytes32(0));

        assertEq(coordinator.getActiveRunCount(), 3);

        // Each run should be independent
        assertEq(uint8(coordinator.getRunState(run1)), uint8(ITrainingCoordinator.RunState.WaitingForMembers));
        assertEq(uint8(coordinator.getRunState(run2)), uint8(ITrainingCoordinator.RunState.WaitingForMembers));
        assertEq(uint8(coordinator.getRunState(run3)), uint8(ITrainingCoordinator.RunState.WaitingForMembers));

        // Pause one, others unaffected
        vm.prank(creator);
        coordinator.pauseRun(run2);

        assertEq(uint8(coordinator.getRunState(run1)), uint8(ITrainingCoordinator.RunState.WaitingForMembers));
        assertEq(uint8(coordinator.getRunState(run2)), uint8(ITrainingCoordinator.RunState.Paused));
        assertEq(uint8(coordinator.getRunState(run3)), uint8(ITrainingCoordinator.RunState.WaitingForMembers));
    }

    // ============ Data Verification Tests ============

    function testRunConfigPersistsCorrectly() public {
        ITrainingCoordinator.CoordinatorConfig memory inputConfig = ITrainingCoordinator.CoordinatorConfig({
            warmupTime: 120,
            cooldownTime: 45,
            maxRoundTrainTime: 300,
            roundWitnessTime: 60,
            epochTime: 1200,
            globalBatchSizeWarmupTokens: 2_000_000,
            totalSteps: 500,
            initMinClients: 8,
            minClients: 4,
            witnessNodes: 4,
            globalBatchSizeStart: 8,
            globalBatchSizeEnd: 32,
            verificationPercent: 20,
            waitingForMembersExtraTime: 45
        });

        vm.prank(creator);
        coordinator.createRun(
            runId,
            inputConfig,
            getDefaultModel(),
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        ITrainingCoordinator.CoordinatorConfig memory storedConfig = coordinator.getRunConfig(runId);

        assertEq(storedConfig.warmupTime, inputConfig.warmupTime);
        assertEq(storedConfig.cooldownTime, inputConfig.cooldownTime);
        assertEq(storedConfig.maxRoundTrainTime, inputConfig.maxRoundTrainTime);
        assertEq(storedConfig.roundWitnessTime, inputConfig.roundWitnessTime);
        assertEq(storedConfig.epochTime, inputConfig.epochTime);
        assertEq(storedConfig.globalBatchSizeWarmupTokens, inputConfig.globalBatchSizeWarmupTokens);
        assertEq(storedConfig.totalSteps, inputConfig.totalSteps);
        assertEq(storedConfig.initMinClients, inputConfig.initMinClients);
        assertEq(storedConfig.minClients, inputConfig.minClients);
        assertEq(storedConfig.witnessNodes, inputConfig.witnessNodes);
        assertEq(storedConfig.globalBatchSizeStart, inputConfig.globalBatchSizeStart);
        assertEq(storedConfig.globalBatchSizeEnd, inputConfig.globalBatchSizeEnd);
        assertEq(storedConfig.verificationPercent, inputConfig.verificationPercent);
        assertEq(storedConfig.waitingForMembersExtraTime, inputConfig.waitingForMembersExtraTime);
    }

    function testModelConfigPersistsCorrectly() public {
        ITrainingCoordinator.ModelConfig memory inputModel = ITrainingCoordinator.ModelConfig({
            modelHash: keccak256("custom-model-v2"),
            hfRepo: "custom/model-v2",
            maxSeqLen: 4096,
            coldStartWarmupSteps: 50
        });

        vm.prank(creator);
        coordinator.createRun(
            runId,
            getDefaultConfig(),
            inputModel,
            ITrainingCoordinator.PrivacyMode.Public,
            bytes32(0)
        );

        ITrainingCoordinator.ModelConfig memory storedModel = coordinator.getRunModel(runId);

        assertEq(storedModel.modelHash, inputModel.modelHash);
        assertEq(storedModel.hfRepo, inputModel.hfRepo);
        assertEq(storedModel.maxSeqLen, inputModel.maxSeqLen);
        assertEq(storedModel.coldStartWarmupSteps, inputModel.coldStartWarmupSteps);
    }
}

contract TrainingRewardsTest is Test {
    TrainingRewards public rewards;
    TrainingCoordinator public coordinator;
    ComputeRegistry public computeRegistry;
    MPCKeyRegistry public mpcKeyRegistry;
    MockToken public token;

    address public owner = address(this);
    address public creator = makeAddr("creator");
    address public participant1 = makeAddr("participant1");
    address public participant2 = makeAddr("participant2");

    bytes32 public runId = keccak256("reward-test-run");

    function setUp() public {
        computeRegistry = new ComputeRegistry(owner, address(0), address(0), 0.01 ether);
        mpcKeyRegistry = new MPCKeyRegistry(0.01 ether);
        coordinator = new TrainingCoordinator(
            address(computeRegistry),
            address(mpcKeyRegistry),
            owner
        );
        rewards = new TrainingRewards(address(coordinator), owner);
        token = new MockToken();
    }

    function testCreateRewardPool() public {
        uint256 amount = 1000 ether;
        token.approve(address(rewards), amount);

        rewards.createRewardPool(runId, address(token), amount, 100);

        (
            address rewardToken,
            uint256 totalDeposited,
            ,
            uint256 pointsPerEpoch,
            ,
            address depositor,
            bool active
        ) = rewards.getRewardPool(runId);

        assertEq(rewardToken, address(token));
        assertEq(totalDeposited, amount);
        assertEq(pointsPerEpoch, 100);
        assertEq(depositor, address(this));
        assertTrue(active);
    }

    function testRecordEpochRewards() public {
        // Create pool
        uint256 amount = 1000 ether;
        token.approve(address(rewards), amount);
        rewards.createRewardPool(runId, address(token), amount, 1000);

        // Record rewards for participants
        address[] memory participants = new address[](2);
        participants[0] = participant1;
        participants[1] = participant2;

        rewards.recordEpochRewards(runId, 0, participants);

        // Check participant rewards
        (uint256 earnedPoints1,,,) = rewards.getParticipantRewards(runId, participant1);
        (uint256 earnedPoints2,,,) = rewards.getParticipantRewards(runId, participant2);

        assertEq(earnedPoints1, 500); // 1000 / 2 = 500 per participant
        assertEq(earnedPoints2, 500);
    }

    function testClaimRewards() public {
        // Create pool
        uint256 amount = 1000 ether;
        token.approve(address(rewards), amount);
        rewards.createRewardPool(runId, address(token), amount, 1000);

        // Record rewards
        address[] memory participants = new address[](1);
        participants[0] = participant1;
        rewards.recordEpochRewards(runId, 0, participants);

        // Claim rewards
        vm.prank(participant1);
        rewards.claim(runId);

        // Check balance
        assertGt(token.balanceOf(participant1), 0);
    }

    function testGetClaimable() public {
        // Create pool
        uint256 amount = 1000 ether;
        token.approve(address(rewards), amount);
        rewards.createRewardPool(runId, address(token), amount, 1000);

        // Record rewards
        address[] memory participants = new address[](1);
        participants[0] = participant1;
        rewards.recordEpochRewards(runId, 0, participants);

        // Check claimable
        (uint256 claimableAmount, uint256 claimablePoints) = rewards.claimable(runId, participant1);

        assertGt(claimableAmount, 0);
        assertEq(claimablePoints, 1000);
    }

    // ============ Edge Cases ============

    function testClaimableReturnsZeroForNonParticipant() public {
        uint256 amount = 1000 ether;
        token.approve(address(rewards), amount);
        rewards.createRewardPool(runId, address(token), amount, 1000);

        address[] memory participants = new address[](1);
        participants[0] = participant1;
        rewards.recordEpochRewards(runId, 0, participants);

        // participant2 didn't participate
        (uint256 claimableAmount, uint256 claimablePoints) = rewards.claimable(runId, participant2);
        assertEq(claimableAmount, 0);
        assertEq(claimablePoints, 0);
    }

    function testCannotClaimTwice() public {
        uint256 amount = 1000 ether;
        token.approve(address(rewards), amount);
        rewards.createRewardPool(runId, address(token), amount, 1000);

        address[] memory participants = new address[](1);
        participants[0] = participant1;
        rewards.recordEpochRewards(runId, 0, participants);

        // First claim succeeds
        vm.prank(participant1);
        rewards.claim(runId);

        uint256 balanceAfterFirst = token.balanceOf(participant1);
        assertGt(balanceAfterFirst, 0);

        // Second claim should revert with NoRewardsToClaim
        vm.expectRevert(TrainingRewards.NoRewardsToClaim.selector);
        vm.prank(participant1);
        rewards.claim(runId);

        // Balance unchanged
        assertEq(token.balanceOf(participant1), balanceAfterFirst);
    }

    function testMultipleEpochRewards() public {
        uint256 amount = 10000 ether;
        token.approve(address(rewards), amount);
        rewards.createRewardPool(runId, address(token), amount, 1000);

        address[] memory participants = new address[](2);
        participants[0] = participant1;
        participants[1] = participant2;

        // Record 3 epochs
        rewards.recordEpochRewards(runId, 0, participants);
        rewards.recordEpochRewards(runId, 1, participants);
        rewards.recordEpochRewards(runId, 2, participants);

        // Each participant should have 3 * (1000 / 2) = 1500 points
        (uint256 earnedPoints1,,,) = rewards.getParticipantRewards(runId, participant1);
        assertEq(earnedPoints1, 1500);
    }

    function testClaimMultipleRuns() public {
        bytes32 run1 = keccak256("run-1");
        bytes32 run2 = keccak256("run-2");

        // Create two reward pools
        token.approve(address(rewards), 2000 ether);
        rewards.createRewardPool(run1, address(token), 1000 ether, 1000);
        rewards.createRewardPool(run2, address(token), 1000 ether, 1000);

        // Record rewards for participant1 in both
        address[] memory participants = new address[](1);
        participants[0] = participant1;
        rewards.recordEpochRewards(run1, 0, participants);
        rewards.recordEpochRewards(run2, 0, participants);

        // Claim both at once
        bytes32[] memory runIds = new bytes32[](2);
        runIds[0] = run1;
        runIds[1] = run2;

        uint256 balanceBefore = token.balanceOf(participant1);
        vm.prank(participant1);
        rewards.claimMultiple(runIds);
        uint256 balanceAfter = token.balanceOf(participant1);

        assertGt(balanceAfter, balanceBefore);
    }

    function testRewardPoolDataIntegrity() public {
        uint256 amount = 5000 ether;
        uint256 pointsPerEpoch = 250;

        token.approve(address(rewards), amount);
        rewards.createRewardPool(runId, address(token), amount, pointsPerEpoch);

        (
            address storedToken,
            uint256 totalDeposited,
            uint256 totalDistributed,
            uint256 storedPointsPerEpoch,
            uint256 totalPoints,
            address depositor,
            bool active
        ) = rewards.getRewardPool(runId);

        assertEq(storedToken, address(token));
        assertEq(totalDeposited, amount);
        assertEq(totalDistributed, 0);
        assertEq(storedPointsPerEpoch, pointsPerEpoch);
        assertEq(totalPoints, 0);
        assertEq(depositor, address(this));
        assertTrue(active);
    }
}

contract NodePerformanceOracleTest is Test {
    NodePerformanceOracle public performance;
    ComputeRegistry public computeRegistry;
    TrainingCoordinator public coordinator;
    MPCKeyRegistry public mpcKeyRegistry;

    address public owner = address(this);
    address public node1 = makeAddr("node1");
    address public node2 = makeAddr("node2");

    function setUp() public {
        computeRegistry = new ComputeRegistry(owner, address(0), address(0), 0.01 ether);
        mpcKeyRegistry = new MPCKeyRegistry(0.01 ether);
        coordinator = new TrainingCoordinator(
            address(computeRegistry),
            address(mpcKeyRegistry),
            owner
        );
        performance = new NodePerformanceOracle(
            address(coordinator),
            address(computeRegistry),
            owner
        );

        // Register nodes as compute providers
        vm.deal(node1, 1 ether);
        vm.deal(node2, 1 ether);

        vm.prank(node1);
        computeRegistry.register{value: 0.01 ether}("Node 1", "http://node1:8000", bytes32(0));

        vm.prank(node2);
        computeRegistry.register{value: 0.01 ether}("Node 2", "http://node2:8000", bytes32(0));
    }

    function testRegisterNode() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        NodePerformanceOracle.NodeMetrics memory metrics = performance.getNodeMetrics(node1);

        assertEq(uint8(metrics.gpuTier), uint8(NodePerformanceOracle.GPUTier.HighEnd));
        assertGt(metrics.registeredAt, 0);
        assertEq(metrics.score, 50); // Default score
    }

    function testReportMetrics() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        NodePerformanceOracle.MetricReport memory report = NodePerformanceOracle.MetricReport({
            latencyMs: 50,
            bandwidthMbps: 5000,
            tokensPerSec: 500,
            roundHeight: 1,
            runId: keccak256("test-run")
        });

        performance.reportMetrics(node1, report);

        NodePerformanceOracle.NodeMetrics memory metrics = performance.getNodeMetrics(node1);

        assertEq(metrics.averageLatencyMs, 50);
        assertEq(metrics.averageBandwidthMbps, 5000);
        assertEq(metrics.averageTokensPerSec, 500);
    }

    function testGetOptimalNodes() public {
        // Register both nodes
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        vm.prank(node2);
        performance.registerNode(NodePerformanceOracle.GPUTier.Datacenter, keccak256("attestation2"));

        // Report metrics to update scores
        NodePerformanceOracle.MetricReport memory report1 = NodePerformanceOracle.MetricReport({
            latencyMs: 10,
            bandwidthMbps: 10000,
            tokensPerSec: 1000,
            roundHeight: 1,
            runId: keccak256("test-run")
        });

        NodePerformanceOracle.MetricReport memory report2 = NodePerformanceOracle.MetricReport({
            latencyMs: 100,
            bandwidthMbps: 1000,
            tokensPerSec: 100,
            roundHeight: 1,
            runId: keccak256("test-run")
        });

        performance.reportMetrics(node1, report1);
        performance.reportMetrics(node2, report2);

        // Get optimal nodes (should return node1 first due to better metrics)
        address[] memory optimal = performance.getOptimalNodes(
            2,
            NodePerformanceOracle.GPUTier.Consumer,
            100,
            0
        );

        assertEq(optimal.length, 2);
    }

    function testNodeScore() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        // Report multiple metrics to build up rounds
        NodePerformanceOracle.MetricReport memory report = NodePerformanceOracle.MetricReport({
            latencyMs: 10,
            bandwidthMbps: 10000,
            tokensPerSec: 1000,
            roundHeight: 1,
            runId: keccak256("test-run")
        });

        bytes32 testRunId = keccak256("score-test-run");

        // Record 10 successful rounds
        for (uint256 i = 0; i < 10; i++) {
            performance.recordRoundParticipation(testRunId, node1, true);
            performance.reportMetrics(node1, report);
        }

        uint8 score = performance.getNodeScore(node1);

        // Score should be high due to good GPU tier and metrics
        assertGt(score, 70);
    }

    // ============ Edge Cases ============

    function testUnregisteredNodeHasZeroScore() public {
        address unregistered = makeAddr("unregistered");
        uint8 score = performance.getNodeScore(unregistered);
        assertEq(score, 0);
    }

    function testNodeNotActiveBeforeRegistration() public {
        address unregistered = makeAddr("unregistered");
        bool active = performance.isNodeActive(unregistered);
        assertFalse(active);
    }

    function testNodeActiveAfterRegistration() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.Datacenter, keccak256("attestation1"));

        bool active = performance.isNodeActive(node1);
        assertTrue(active);
    }

    function testCannotRegisterTwice() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        vm.expectRevert(NodePerformanceOracle.AlreadyRegistered.selector);
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation2"));
    }

    function testMetricsAveraging() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        // Report two metrics with different values
        NodePerformanceOracle.MetricReport memory report1 = NodePerformanceOracle.MetricReport({
            latencyMs: 100,
            bandwidthMbps: 1000,
            tokensPerSec: 500,
            roundHeight: 1,
            runId: keccak256("test-run")
        });

        NodePerformanceOracle.MetricReport memory report2 = NodePerformanceOracle.MetricReport({
            latencyMs: 200,
            bandwidthMbps: 2000,
            tokensPerSec: 1000,
            roundHeight: 2,
            runId: keccak256("test-run")
        });

        performance.reportMetrics(node1, report1);
        performance.reportMetrics(node1, report2);

        NodePerformanceOracle.NodeMetrics memory metrics = performance.getNodeMetrics(node1);

        // EMA formula: (2 * new + 8 * old) / 10
        // First report sets values directly
        // Second: latency = (2 * 200 + 8 * 100) / 10 = 120
        assertEq(metrics.averageLatencyMs, 120);
        // bandwidth = (2 * 2000 + 8 * 1000) / 10 = 1200
        assertEq(metrics.averageBandwidthMbps, 1200);
        // tps = (2 * 1000 + 8 * 500) / 10 = 600
        assertEq(metrics.averageTokensPerSec, 600);
    }

    function testSuccessRateTracking() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        bytes32 testRunId = keccak256("success-rate-test");

        // Record 8 successful and 2 failed rounds
        for (uint256 i = 0; i < 8; i++) {
            performance.recordRoundParticipation(testRunId, node1, true);
        }
        for (uint256 i = 0; i < 2; i++) {
            performance.recordRoundParticipation(testRunId, node1, false);
        }

        NodePerformanceOracle.NodeMetrics memory metrics = performance.getNodeMetrics(node1);

        assertEq(metrics.totalRoundsParticipated, 10);
        assertEq(metrics.successfulRounds, 8);
        assertEq(metrics.droppedRounds, 2);
    }

    function testGetOptimalNodesWithMinScore() public {
        // Register two nodes with different quality
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        vm.prank(node2);
        performance.registerNode(NodePerformanceOracle.GPUTier.Consumer, keccak256("attestation2"));

        // Report excellent metrics for node1
        NodePerformanceOracle.MetricReport memory goodReport = NodePerformanceOracle.MetricReport({
            latencyMs: 10,
            bandwidthMbps: 10000,
            tokensPerSec: 2000,
            roundHeight: 1,
            runId: keccak256("test-run")
        });

        // Record successful rounds for node1
        for (uint256 i = 0; i < 20; i++) {
            performance.recordRoundParticipation(keccak256("test-run"), node1, true);
            performance.reportMetrics(node1, goodReport);
        }

        // Report poor metrics for node2 (no rounds recorded, defaults to 50 score)

        // Get nodes with minimum score of 70 - should only get node1
        address[] memory optimal = performance.getOptimalNodes(
            2,
            NodePerformanceOracle.GPUTier.Unknown,
            70,
            0
        );

        // Should only have high-scoring node(s)
        bool foundNode1 = false;
        for (uint256 i = 0; i < optimal.length; i++) {
            if (optimal[i] == node1) foundNode1 = true;
        }
        assertTrue(foundNode1);
    }

    function testGetOptimalNodesWithGPUFilter() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        vm.prank(node2);
        performance.registerNode(NodePerformanceOracle.GPUTier.Consumer, keccak256("attestation2"));

        // Get only HighEnd nodes
        address[] memory optimal = performance.getOptimalNodes(
            10,
            NodePerformanceOracle.GPUTier.HighEnd,
            0,
            0
        );

        // Should only contain node1
        assertEq(optimal.length, 1);
        assertEq(optimal[0], node1);
    }

    function testNodeMetricsIntegrity() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.Datacenter, keccak256("attestation-xyz"));

        NodePerformanceOracle.NodeMetrics memory metrics = performance.getNodeMetrics(node1);

        assertEq(metrics.totalRoundsParticipated, 0);
        assertEq(metrics.successfulRounds, 0);
        assertEq(metrics.droppedRounds, 0);
        assertEq(metrics.witnessSubmissions, 0);
        assertEq(metrics.successfulWitnesses, 0);
        assertEq(metrics.averageLatencyMs, 0);
        assertEq(metrics.averageBandwidthMbps, 0);
        assertEq(metrics.averageTokensPerSec, 0);
        assertEq(uint8(metrics.gpuTier), uint8(NodePerformanceOracle.GPUTier.Datacenter));
        assertEq(metrics.attestationHash, keccak256("attestation-xyz"));
        assertGt(metrics.registeredAt, 0);
        assertEq(metrics.score, 50); // Default score
    }

    function testWitnessSubmissionTracking() public {
        vm.prank(node1);
        performance.registerNode(NodePerformanceOracle.GPUTier.HighEnd, keccak256("attestation1"));

        bytes32 testRunId = keccak256("witness-test");

        // Record 5 successful and 2 failed witness submissions
        for (uint256 i = 0; i < 5; i++) {
            performance.recordWitness(testRunId, node1, true);
        }
        for (uint256 i = 0; i < 2; i++) {
            performance.recordWitness(testRunId, node1, false);
        }

        NodePerformanceOracle.NodeMetrics memory metrics = performance.getNodeMetrics(node1);

        assertEq(metrics.witnessSubmissions, 7);
        assertEq(metrics.successfulWitnesses, 5);
    }
}

