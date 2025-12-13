// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/GovernanceTimelock.sol";

contract MockTarget {
    uint256 public value;
    bool public shouldRevert;

    function setValue(uint256 _value) external {
        if (shouldRevert) revert("Execution failed");
        value = _value;
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }
}

contract GovernanceTimelockTest is Test {
    GovernanceTimelock public timelock;
    MockTarget public target;

    address public owner = makeAddr("owner");
    address public governance = makeAddr("governance");
    address public securityCouncil = makeAddr("securityCouncil");
    address public nonGovernance = makeAddr("nonGovernance");

    uint256 public constant STANDARD_DELAY = 30 days;
    uint256 public constant LOCALNET_DELAY = 2 hours; // Must be > EMERGENCY_MIN_DELAY (1 hour)

    function setUp() public {
        target = new MockTarget();
        timelock = new GovernanceTimelock(governance, securityCouncil, owner, LOCALNET_DELAY);
    }

    // ============ Proposal Creation Tests ============

    function testProposeUpgrade() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        string memory description = "Set value to 42";

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, description);

        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertEq(proposal.target, address(target));
        assertEq(proposal.executeAfter, block.timestamp + LOCALNET_DELAY);
        assertFalse(proposal.executed);
        assertFalse(proposal.cancelled);
        assertEq(uint256(proposal.proposalType), uint256(GovernanceTimelock.ProposalType.UPGRADE));
    }

    function testProposeUpgradeOnlyGovernance() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        vm.prank(nonGovernance);
        vm.expectRevert(GovernanceTimelock.NotGovernance.selector);
        timelock.proposeUpgrade(address(target), data, "test");
    }

    function testProposeUpgradeInvalidTarget() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        vm.prank(governance);
        vm.expectRevert(GovernanceTimelock.InvalidTarget.selector);
        timelock.proposeUpgrade(address(0), data, "test");
    }

    function testProposeEmergencyBugfix() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        bytes32 bugProof = keccak256("bug proof");

        vm.prank(securityCouncil);
        bytes32 proposalId = timelock.proposeEmergencyBugfix(address(target), data, "Fix bug", bugProof);

        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertEq(proposal.executeAfter, block.timestamp + timelock.EMERGENCY_MIN_DELAY());
        assertEq(uint256(proposal.proposalType), uint256(GovernanceTimelock.ProposalType.EMERGENCY_BUGFIX));
    }

    function testProposeEmergencyBugfixOnlySecurityCouncil() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        vm.prank(governance);
        vm.expectRevert(GovernanceTimelock.NotSecurityCouncil.selector);
        timelock.proposeEmergencyBugfix(address(target), data, "test", bytes32(0));
    }

    function testMultipleProposals() public {
        bytes memory data1 = abi.encodeWithSelector(MockTarget.setValue.selector, 1);
        bytes memory data2 = abi.encodeWithSelector(MockTarget.setValue.selector, 2);

        vm.startPrank(governance);
        bytes32 proposalId1 = timelock.proposeUpgrade(address(target), data1, "Proposal 1");
        bytes32 proposalId2 = timelock.proposeUpgrade(address(target), data2, "Proposal 2");
        vm.stopPrank();

        bytes32[] memory allIds = timelock.getAllProposalIds();
        assertEq(allIds.length, 2);
        assertTrue(allIds[0] == proposalId1 || allIds[1] == proposalId1);
        assertTrue(allIds[0] == proposalId2 || allIds[1] == proposalId2);
    }

    // ============ Execution Tests ============

    function testExecuteAfterTimelock() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        // Fast forward past timelock
        vm.warp(block.timestamp + LOCALNET_DELAY + 1);

        // Anyone can execute
        timelock.execute(proposalId);

        assertEq(target.value(), 42);
        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertTrue(proposal.executed);
    }

    function testExecuteBeforeTimelock() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        // Try to execute immediately
        vm.expectRevert(GovernanceTimelock.TimelockNotExpired.selector);
        timelock.execute(proposalId);
    }

    function testExecuteExactlyAtTimelock() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        // Execute exactly at timelock boundary
        vm.warp(block.timestamp + LOCALNET_DELAY);

        timelock.execute(proposalId);
        assertEq(target.value(), 42);
    }

    function testExecuteTwice() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.warp(block.timestamp + LOCALNET_DELAY + 1);
        timelock.execute(proposalId);

        vm.expectRevert(GovernanceTimelock.ProposalAlreadyExecuted.selector);
        timelock.execute(proposalId);
    }

    function testExecuteWithRevert() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        target.setShouldRevert(true);

        vm.warp(block.timestamp + LOCALNET_DELAY + 1);
        vm.expectRevert(GovernanceTimelock.ExecutionFailed.selector);
        timelock.execute(proposalId);
    }

    function testExecuteCancelledProposal() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.prank(governance);
        timelock.cancel(proposalId);

        vm.warp(block.timestamp + LOCALNET_DELAY + 1);
        vm.expectRevert(GovernanceTimelock.ProposalAlreadyCancelled.selector);
        timelock.execute(proposalId);
    }

    function testExecuteNonExistentProposal() public {
        bytes32 fakeId = keccak256("fake");
        vm.expectRevert(GovernanceTimelock.ProposalNotFound.selector);
        timelock.execute(fakeId);
    }

    // ============ Cancellation Tests ============

    function testCancelProposal() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.prank(governance);
        timelock.cancel(proposalId);

        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertTrue(proposal.cancelled);
    }

    function testCancelOnlyGovernance() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.prank(nonGovernance);
        vm.expectRevert(GovernanceTimelock.NotGovernance.selector);
        timelock.cancel(proposalId);
    }

    function testCancelExecutedProposal() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.warp(block.timestamp + LOCALNET_DELAY + 1);
        timelock.execute(proposalId);

        vm.prank(governance);
        vm.expectRevert(GovernanceTimelock.ProposalAlreadyExecuted.selector);
        timelock.cancel(proposalId);
    }

    // ============ View Function Tests ============

    function testCanExecute() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        assertFalse(timelock.canExecute(proposalId));

        vm.warp(block.timestamp + LOCALNET_DELAY + 1);
        assertTrue(timelock.canExecute(proposalId));
    }

    function testCanExecuteAfterExecution() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.warp(block.timestamp + LOCALNET_DELAY + 1);
        timelock.execute(proposalId);

        assertFalse(timelock.canExecute(proposalId)); // Already executed
    }

    function testCanExecuteCancelled() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.prank(governance);
        timelock.cancel(proposalId);

        vm.warp(block.timestamp + LOCALNET_DELAY + 1);
        assertFalse(timelock.canExecute(proposalId));
    }

    function testTimeRemaining() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        uint256 remaining = timelock.timeRemaining(proposalId);
        assertEq(remaining, LOCALNET_DELAY);

        vm.warp(block.timestamp + 30);
        remaining = timelock.timeRemaining(proposalId);
        assertEq(remaining, LOCALNET_DELAY - 30);
    }

    function testTimeRemainingZeroAfterExpiry() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.warp(block.timestamp + LOCALNET_DELAY + 1);
        assertEq(timelock.timeRemaining(proposalId), 0);
    }

    function testTimeRemainingMaxForNonExistent() public view {
        bytes32 fakeId = keccak256("fake");
        assertEq(timelock.timeRemaining(fakeId), type(uint256).max);
    }

    // ============ Emergency Bugfix Tests ============

    function testEmergencyBugfixShorterDelay() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        bytes32 bugProof = keccak256("proof");

        vm.prank(securityCouncil);
        bytes32 proposalId = timelock.proposeEmergencyBugfix(address(target), data, "fix", bugProof);

        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        uint256 emergencyDelay = timelock.EMERGENCY_MIN_DELAY();
        assertEq(proposal.executeAfter, block.timestamp + emergencyDelay);
        assertLt(emergencyDelay, timelock.timelockDelay());
    }

    function testEmergencyBugfixExecution() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        bytes32 bugProof = keccak256("proof");

        vm.prank(securityCouncil);
        bytes32 proposalId = timelock.proposeEmergencyBugfix(address(target), data, "fix", bugProof);

        uint256 emergencyDelay = timelock.EMERGENCY_MIN_DELAY();
        vm.warp(block.timestamp + emergencyDelay + 1);

        timelock.execute(proposalId);
        assertEq(target.value(), 42);
    }

    // ============ Edge Cases ============

    function testProposalIdUniqueness() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        
        vm.startPrank(governance);
        bytes32 id1 = timelock.proposeUpgrade(address(target), data, "test1");
        vm.warp(block.timestamp + 1);
        bytes32 id2 = timelock.proposeUpgrade(address(target), data, "test2");
        vm.stopPrank();

        assertNotEq(id1, id2);
    }

    function testConcurrentProposals() public {
        bytes memory data1 = abi.encodeWithSelector(MockTarget.setValue.selector, 1);
        bytes memory data2 = abi.encodeWithSelector(MockTarget.setValue.selector, 2);

        vm.startPrank(governance);
        timelock.proposeUpgrade(address(target), data1, "test1");
        timelock.proposeUpgrade(address(target), data2, "test2");
        vm.stopPrank();

        bytes32[] memory allIds = timelock.getAllProposalIds();
        assertEq(allIds.length, 2);
    }

    function testExecuteWithValue() public {
        // Create proposal that sends ETH
        bytes memory data = "";
        vm.deal(address(timelock), 10 ether);

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        // Modify proposal to have value (would need setter in real contract)
        // For now, test that value field exists
        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertEq(proposal.value, 0);
    }

    // ============ Admin Functions ============

    function testSetTimelockDelay() public {
        uint256 newDelay = 3 hours;
        vm.prank(owner);
        timelock.setTimelockDelay(newDelay);

        assertEq(timelock.timelockDelay(), newDelay);
    }

    function testSetTimelockDelayBelowMinimum() public {
        vm.prank(owner);
        vm.expectRevert(GovernanceTimelock.InvalidDelay.selector);
        timelock.setTimelockDelay(30 minutes); // Below EMERGENCY_MIN_DELAY (1 hour)
    }

    function testSetGovernance() public {
        address newGov = makeAddr("newGov");
        vm.prank(owner);
        timelock.setGovernance(newGov);

        assertEq(timelock.governance(), newGov);
    }

    function testSetSecurityCouncil() public {
        address newCouncil = makeAddr("newCouncil");
        vm.prank(owner);
        timelock.setSecurityCouncil(newCouncil);

        assertEq(timelock.securityCouncil(), newCouncil);
    }

    // ============ Integration Tests ============

    function testFullUpgradeFlow() public {
        // 1. Propose
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 100);
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "Upgrade to 100");

        // 2. Check status
        assertFalse(timelock.canExecute(proposalId));
        uint256 remaining = timelock.timeRemaining(proposalId);
        assertEq(remaining, LOCALNET_DELAY);

        // 3. Wait
        vm.warp(block.timestamp + LOCALNET_DELAY + 1);

        // 4. Execute
        assertTrue(timelock.canExecute(proposalId));
        timelock.execute(proposalId);

        // 5. Verify
        assertEq(target.value(), 100);
        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertTrue(proposal.executed);
    }

    function testCancelBeforeExecution() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 100);
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        // Cancel before timelock expires
        vm.prank(governance);
        timelock.cancel(proposalId);

        vm.warp(block.timestamp + LOCALNET_DELAY + 1);
        vm.expectRevert(GovernanceTimelock.ProposalAlreadyCancelled.selector);
        timelock.execute(proposalId);
    }
}

