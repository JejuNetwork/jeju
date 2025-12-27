// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/dispute/DisputeGameFactory.sol";
import "../mocks/MockProver.sol";

contract DisputeGameFactoryTest is Test {
    DisputeGameFactory public factory;
    MockProver public mockProver;

    address public owner = address(0x1);
    address public treasury = address(0x2);
    address public challenger = address(0x3);
    address public proposer = address(0x4);
    address public newTreasury = address(0x5);
    address public newProverImpl = address(0x6);

    function setUp() public {
        vm.startPrank(owner);
        factory = new DisputeGameFactory(treasury, owner);
        mockProver = new MockProver();

        // Use initializeProver for initial setup (before any games are created)
        factory.initializeProver(DisputeGameFactory.ProverType.CANNON, address(mockProver), true);

        vm.stopPrank();
    }

    // ==================== Prover Timelock Tests ====================

    function testCannotChangeProverInstantly() public {
        // There's no setProverImplementation function anymore - this is the core security fix
        // Verify the function signature doesn't exist by checking the factory interface
        bytes4 oldSelector = bytes4(keccak256("setProverImplementation(uint8,address,bool)"));

        // Low-level call to check if function exists
        (bool success,) = address(factory).call(abi.encodeWithSelector(oldSelector, 0, newProverImpl, true));
        assertFalse(success, "setProverImplementation should not exist");
    }

    function testProposalCreatesProverChange() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        (
            DisputeGameFactory.ProverType proverType,
            address implementation,
            bool enabled,
            uint256 executeAfter,
            bool executed
        ) = factory.pendingProverChanges(changeId);

        assertEq(uint8(proverType), uint8(DisputeGameFactory.ProverType.ALTERNATIVE));
        assertEq(implementation, newProverImpl);
        assertTrue(enabled);
        assertEq(executeAfter, block.timestamp + 30 days);
        assertFalse(executed);

        vm.stopPrank();
    }

    function testExecutionFailsBeforeTimelock() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        // Try to execute immediately
        vm.expectRevert(DisputeGameFactory.TimelockNotExpired.selector);
        factory.executeProverChange(changeId);

        // Try at 29 days
        vm.warp(block.timestamp + 29 days);
        vm.expectRevert(DisputeGameFactory.TimelockNotExpired.selector);
        factory.executeProverChange(changeId);

        vm.stopPrank();
    }

    function testExecutionSucceedsAfterTimelock() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        // Warp past timelock
        vm.warp(block.timestamp + 30 days + 1);

        // Execute should succeed
        factory.executeProverChange(changeId);

        // Verify the change was applied
        assertEq(factory.proverImplementations(DisputeGameFactory.ProverType.ALTERNATIVE), newProverImpl);
        assertTrue(factory.proverEnabled(DisputeGameFactory.ProverType.ALTERNATIVE));

        // Verify executed flag
        (,,,, bool executed) = factory.pendingProverChanges(changeId);
        assertTrue(executed);

        vm.stopPrank();
    }

    function testProverCancellationWorks() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        // Cancel the change
        factory.cancelProverChange(changeId);

        // Verify the change was deleted
        (,, bool enabled, uint256 executeAfter,) = factory.pendingProverChanges(changeId);
        assertEq(executeAfter, 0);
        assertFalse(enabled);

        vm.stopPrank();
    }

    function testCannotExecuteCancelledProverChange() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        // Cancel the change
        factory.cancelProverChange(changeId);

        // Warp past timelock
        vm.warp(block.timestamp + 30 days + 1);

        // Try to execute cancelled change
        vm.expectRevert(DisputeGameFactory.ChangeNotFound.selector);
        factory.executeProverChange(changeId);

        vm.stopPrank();
    }

    function testCannotExecuteProverChangeTwice() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        // Warp past timelock
        vm.warp(block.timestamp + 30 days + 1);

        // First execution succeeds
        factory.executeProverChange(changeId);

        // Second execution fails
        vm.expectRevert(DisputeGameFactory.ChangeAlreadyExecuted.selector);
        factory.executeProverChange(changeId);

        vm.stopPrank();
    }

    function testOnlyOwnerCanProposeProverChange() public {
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, challenger));
        factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);
    }

    function testOnlyOwnerCanCancelProverChange() public {
        vm.prank(owner);
        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, challenger));
        factory.cancelProverChange(changeId);
    }

    function testAnyoneCanExecuteProverChangeAfterTimelock() public {
        vm.prank(owner);
        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        // Warp past timelock
        vm.warp(block.timestamp + 30 days + 1);

        // Anyone can execute
        vm.prank(challenger);
        factory.executeProverChange(changeId);

        assertEq(factory.proverImplementations(DisputeGameFactory.ProverType.ALTERNATIVE), newProverImpl);
    }

    function testCancelNonExistentProverChangeFails() public {
        vm.prank(owner);
        vm.expectRevert(DisputeGameFactory.ChangeNotFound.selector);
        factory.cancelProverChange(bytes32(uint256(12345)));
    }

    // ==================== Treasury Timelock Tests ====================

    function testCannotChangeTreasuryInstantly() public {
        // There's no setTreasury function anymore
        bytes4 oldSelector = bytes4(keccak256("setTreasury(address)"));

        (bool success,) = address(factory).call(abi.encodeWithSelector(oldSelector, newTreasury));
        assertFalse(success, "setTreasury should not exist");
    }

    function testProposalCreatesTreasuryChange() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeTreasuryChange(newTreasury);

        (address treasuryAddr, uint256 executeAfter, bool executed) = factory.pendingTreasuryChanges(changeId);

        assertEq(treasuryAddr, newTreasury);
        assertEq(executeAfter, block.timestamp + 30 days);
        assertFalse(executed);

        vm.stopPrank();
    }

    function testTreasuryExecutionFailsBeforeTimelock() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeTreasuryChange(newTreasury);

        vm.expectRevert(DisputeGameFactory.TimelockNotExpired.selector);
        factory.executeTreasuryChange(changeId);

        vm.stopPrank();
    }

    function testTreasuryExecutionSucceedsAfterTimelock() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeTreasuryChange(newTreasury);

        vm.warp(block.timestamp + 30 days + 1);
        factory.executeTreasuryChange(changeId);

        assertEq(factory.treasury(), newTreasury);

        vm.stopPrank();
    }

    function testTreasuryCancellationWorks() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeTreasuryChange(newTreasury);
        factory.cancelTreasuryChange(changeId);

        (address treasuryAddr, uint256 executeAfter,) = factory.pendingTreasuryChanges(changeId);
        assertEq(executeAfter, 0);
        assertEq(treasuryAddr, address(0));

        vm.stopPrank();
    }

    function testCannotExecuteCancelledTreasuryChange() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeTreasuryChange(newTreasury);
        factory.cancelTreasuryChange(changeId);

        vm.warp(block.timestamp + 30 days + 1);

        vm.expectRevert(DisputeGameFactory.ChangeNotFound.selector);
        factory.executeTreasuryChange(changeId);

        vm.stopPrank();
    }

    function testCannotExecuteTreasuryChangeTwice() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeTreasuryChange(newTreasury);

        vm.warp(block.timestamp + 30 days + 1);
        factory.executeTreasuryChange(changeId);

        vm.expectRevert(DisputeGameFactory.ChangeAlreadyExecuted.selector);
        factory.executeTreasuryChange(changeId);

        vm.stopPrank();
    }

    function testCannotProposeTreasuryZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(DisputeGameFactory.InvalidTreasury.selector);
        factory.proposeTreasuryChange(address(0));
    }

    function testOnlyOwnerCanProposeTreasuryChange() public {
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, challenger));
        factory.proposeTreasuryChange(newTreasury);
    }

    function testCancelNonExistentTreasuryChangeFails() public {
        vm.prank(owner);
        vm.expectRevert(DisputeGameFactory.ChangeNotFound.selector);
        factory.cancelTreasuryChange(bytes32(uint256(12345)));
    }

    // ==================== Pause/Unpause Preserved ====================

    function testPauseUnpauseStillWorks() public {
        vm.startPrank(owner);

        factory.pause();
        assertTrue(factory.paused());

        factory.unpause();
        assertFalse(factory.paused());

        vm.stopPrank();
    }

    function testOnlyOwnerCanPause() public {
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, challenger));
        factory.pause();
    }

    function testOnlyOwnerCanUnpause() public {
        vm.prank(owner);
        factory.pause();

        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, challenger));
        factory.unpause();
    }

    // ==================== Game Creation Tests ====================

    function testCanCreateGameWithEnabledProver() public {
        vm.deal(challenger, 10 ether);
        vm.prank(challenger);

        bytes32 gameId = factory.createGame{value: 1 ether}(
            proposer,
            keccak256("state"),
            keccak256("claim"),
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        (address gameChallenger,,,,,,,,,,) = factory.games(gameId);
        assertEq(gameChallenger, challenger);
    }

    function testCannotCreateGameWithDisabledProver() public {
        // Propose to disable the prover
        vm.startPrank(owner);
        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.CANNON, address(mockProver), false);

        vm.warp(block.timestamp + 30 days + 1);
        factory.executeProverChange(changeId);
        vm.stopPrank();

        vm.deal(challenger, 10 ether);
        vm.prank(challenger);
        vm.expectRevert(DisputeGameFactory.ProverNotEnabled.selector);
        factory.createGame{value: 1 ether}(
            proposer,
            keccak256("state"),
            keccak256("claim"),
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
    }

    // ==================== Event Tests ====================

    function testProverChangeProposedEvent() public {
        vm.startPrank(owner);

        vm.expectEmit(true, false, false, true);
        emit DisputeGameFactory.ProverChangeProposed(
            keccak256(abi.encodePacked(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true, block.timestamp)),
            DisputeGameFactory.ProverType.ALTERNATIVE,
            newProverImpl,
            true,
            block.timestamp + 30 days
        );

        factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        vm.stopPrank();
    }

    function testProverChangeCancelledEvent() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeProverChange(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        vm.expectEmit(true, false, false, false);
        emit DisputeGameFactory.ProverChangeCancelled(changeId);

        factory.cancelProverChange(changeId);

        vm.stopPrank();
    }

    function testTreasuryChangeProposedEvent() public {
        vm.startPrank(owner);

        vm.expectEmit(true, false, false, true);
        emit DisputeGameFactory.TreasuryChangeProposed(
            keccak256(abi.encodePacked(newTreasury, block.timestamp)), newTreasury, block.timestamp + 30 days
        );

        factory.proposeTreasuryChange(newTreasury);

        vm.stopPrank();
    }

    function testTreasuryChangeCancelledEvent() public {
        vm.startPrank(owner);

        bytes32 changeId = factory.proposeTreasuryChange(newTreasury);

        vm.expectEmit(true, false, false, false);
        emit DisputeGameFactory.TreasuryChangeCancelled(changeId);

        factory.cancelTreasuryChange(changeId);

        vm.stopPrank();
    }

    // ==================== Constants Tests ====================

    function testTimelockConstants() public view {
        assertEq(factory.PROVER_CHANGE_DELAY(), 30 days);
        assertEq(factory.TREASURY_CHANGE_DELAY(), 30 days);
    }

    // ==================== Initialize Prover Tests ====================

    function testInitializeProverBeforeAnyGames() public {
        // Deploy fresh factory
        vm.prank(owner);
        DisputeGameFactory freshFactory = new DisputeGameFactory(treasury, owner);

        // Initialize prover before any games
        vm.prank(owner);
        freshFactory.initializeProver(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);

        assertEq(freshFactory.proverImplementations(DisputeGameFactory.ProverType.ALTERNATIVE), newProverImpl);
        assertTrue(freshFactory.proverEnabled(DisputeGameFactory.ProverType.ALTERNATIVE));
    }

    function testInitializeProverFailsAfterGameCreated() public {
        // Create a game first (factory already has CANNON enabled from setUp)
        vm.deal(challenger, 10 ether);
        vm.prank(challenger);
        factory.createGame{value: 1 ether}(
            proposer,
            keccak256("state"),
            keccak256("claim"),
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        // Now try to initialize ALTERNATIVE prover - should fail
        vm.prank(owner);
        vm.expectRevert(DisputeGameFactory.InitializationLocked.selector);
        factory.initializeProver(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);
    }

    function testOnlyOwnerCanInitializeProver() public {
        // Deploy fresh factory
        vm.prank(owner);
        DisputeGameFactory freshFactory = new DisputeGameFactory(treasury, owner);

        // Non-owner cannot initialize
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, challenger));
        freshFactory.initializeProver(DisputeGameFactory.ProverType.CANNON, newProverImpl, true);
    }

    function testInitializeMultipleProvers() public {
        // Deploy fresh factory
        vm.prank(owner);
        DisputeGameFactory freshFactory = new DisputeGameFactory(treasury, owner);

        // Initialize both prover types
        vm.startPrank(owner);
        freshFactory.initializeProver(DisputeGameFactory.ProverType.CANNON, address(mockProver), true);
        freshFactory.initializeProver(DisputeGameFactory.ProverType.ALTERNATIVE, newProverImpl, true);
        vm.stopPrank();

        assertEq(freshFactory.proverImplementations(DisputeGameFactory.ProverType.CANNON), address(mockProver));
        assertEq(freshFactory.proverImplementations(DisputeGameFactory.ProverType.ALTERNATIVE), newProverImpl);
    }

    function testInitializeProverEmitsEvent() public {
        // Deploy fresh factory
        vm.prank(owner);
        DisputeGameFactory freshFactory = new DisputeGameFactory(treasury, owner);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit DisputeGameFactory.ProverImplementationUpdated(
            DisputeGameFactory.ProverType.CANNON, address(mockProver), true
        );
        freshFactory.initializeProver(DisputeGameFactory.ProverType.CANNON, address(mockProver), true);
    }
}
