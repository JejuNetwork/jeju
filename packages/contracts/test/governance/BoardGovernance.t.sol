// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {BoardGovernance} from "../../src/governance/BoardGovernance.sol";
import {IBoardGovernance} from "../../src/governance/interfaces/IBoardGovernance.sol";

contract BoardGovernanceTest is Test {
    BoardGovernance public governance;
    address public owner = address(1);
    address public operator = address(2);
    address public randomUser = address(3);

    bytes32 public daoId = keccak256("test-dao");
    bytes32 public contentHash = keccak256("proposal-content");

    function setUp() public {
        vm.prank(owner);
        governance = new BoardGovernance(owner, operator);
    }

    // ============ Helpers ============

    function _submitProposal() internal returns (bytes32) {
        vm.prank(operator);
        return governance.submitProposal(daoId, 0, contentHash, address(0), "", 0);
    }

    function _advanceToStatus(bytes32 proposalId, IBoardGovernance.ProposalStatus status) internal {
        vm.startPrank(operator);
        governance.updateProposalStatus(proposalId, status);
        vm.stopPrank();
    }

    // ============ Terminal State Protection Tests ============

    function testUpdateProposalStatusRevertsOnCompleted() public {
        bytes32 proposalId = _submitProposal();

        // Move to APPROVED -> warp past grace period -> EXECUTING -> COMPLETED
        vm.startPrank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.APPROVED);
        vm.warp(block.timestamp + 4 days + 1);
        governance.markExecuting(proposalId);
        governance.markCompleted(proposalId);

        // Now try to update from COMPLETED - should revert
        vm.expectRevert(BoardGovernance.InvalidStatusTransition.selector);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.SUBMITTED);
        vm.stopPrank();
    }

    function testUpdateProposalStatusRevertsOnRejected() public {
        bytes32 proposalId = _submitProposal();

        vm.startPrank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.REJECTED);

        vm.expectRevert(BoardGovernance.InvalidStatusTransition.selector);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.SUBMITTED);
        vm.stopPrank();
    }

    function testUpdateProposalStatusRevertsOnVetoed() public {
        bytes32 proposalId = _submitProposal();

        vm.startPrank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.VETOED);

        vm.expectRevert(BoardGovernance.InvalidStatusTransition.selector);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.APPROVED);
        vm.stopPrank();
    }

    function testUpdateProposalStatusRevertsOnDuplicate() public {
        bytes32 proposalId = _submitProposal();

        vm.startPrank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.DUPLICATE);

        vm.expectRevert(BoardGovernance.InvalidStatusTransition.selector);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.SUBMITTED);
        vm.stopPrank();
    }

    function testUpdateProposalStatusRevertsOnSpam() public {
        bytes32 proposalId = _submitProposal();

        vm.startPrank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.SPAM);

        vm.expectRevert(BoardGovernance.InvalidStatusTransition.selector);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.SUBMITTED);
        vm.stopPrank();
    }

    function testMarkFailedRevertsOnTerminalState() public {
        bytes32 proposalId = _submitProposal();

        // Move to COMPLETED
        vm.startPrank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.APPROVED);
        vm.warp(block.timestamp + 4 days + 1);
        governance.markExecuting(proposalId);
        governance.markCompleted(proposalId);

        // markFailed should revert on COMPLETED
        vm.expectRevert(BoardGovernance.InvalidStatusTransition.selector);
        governance.markFailed(proposalId, "test reason");
        vm.stopPrank();
    }

    function testUpdateProposalStatusWorksOnNonTerminal() public {
        bytes32 proposalId = _submitProposal();

        vm.startPrank(operator);
        // SUBMITTED -> AUTOCRAT_REVIEW should work
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.AUTOCRAT_REVIEW);

        IBoardGovernance.Proposal memory p = governance.getProposal(proposalId);
        assertEq(uint8(p.status), uint8(IBoardGovernance.ProposalStatus.AUTOCRAT_REVIEW));
        vm.stopPrank();
    }

    // ============ Director Status Guard Tests ============

    function testDirectorApprovalRevertsOnSubmittedStatus() public {
        bytes32 proposalId = _submitProposal();
        // Proposal is in SUBMITTED status - director shouldn't be able to approve yet

        vm.prank(operator);
        vm.expectRevert(BoardGovernance.InvalidStatus.selector);
        governance.setDirectorApproval(proposalId, true, keccak256("decision"));
    }

    function testDirectorApprovalRevertsOnCompletedStatus() public {
        bytes32 proposalId = _submitProposal();

        vm.startPrank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.APPROVED);
        vm.warp(block.timestamp + 4 days + 1);
        governance.markExecuting(proposalId);
        governance.markCompleted(proposalId);
        vm.stopPrank();

        vm.prank(operator);
        vm.expectRevert(BoardGovernance.InvalidStatus.selector);
        governance.setDirectorApproval(proposalId, true, keccak256("decision"));
    }

    function testDirectorApprovalRevertsOnVetoedStatus() public {
        bytes32 proposalId = _submitProposal();

        vm.prank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.VETOED);

        vm.prank(operator);
        vm.expectRevert(BoardGovernance.InvalidStatus.selector);
        governance.setDirectorApproval(proposalId, true, keccak256("decision"));
    }

    function testDirectorApprovalWorksOnDirectorQueue() public {
        bytes32 proposalId = _submitProposal();

        vm.prank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.DIRECTOR_QUEUE);

        vm.prank(operator);
        governance.setDirectorApproval(proposalId, true, keccak256("decision"));

        IBoardGovernance.Proposal memory p = governance.getProposal(proposalId);
        assertTrue(p.directorApproved);
        assertTrue(p.directorDecided);
    }

    function testDirectorApprovalWorksOnAutocratFinal() public {
        bytes32 proposalId = _submitProposal();

        vm.prank(operator);
        governance.updateProposalStatus(proposalId, IBoardGovernance.ProposalStatus.AUTOCRAT_FINAL);

        vm.prank(operator);
        governance.setDirectorApproval(proposalId, false, keccak256("rejection"));

        IBoardGovernance.Proposal memory p = governance.getProposal(proposalId);
        assertFalse(p.directorApproved);
        assertTrue(p.directorDecided);
        assertEq(uint8(p.status), uint8(IBoardGovernance.ProposalStatus.REJECTED));
    }

    // ============ submitProposal Access Control Tests ============

    function testSubmitProposalRevertsForRandomUser() public {
        vm.prank(randomUser);
        vm.expectRevert(BoardGovernance.NotAuthorized.selector);
        governance.submitProposal(daoId, 0, contentHash, address(0), "", 0);
    }

    function testSubmitProposalWorksForOperator() public {
        vm.prank(operator);
        bytes32 proposalId = governance.submitProposal(daoId, 0, contentHash, address(0), "", 0);
        assertTrue(proposalId != bytes32(0));

        IBoardGovernance.Proposal memory p = governance.getProposal(proposalId);
        assertEq(uint8(p.status), uint8(IBoardGovernance.ProposalStatus.SUBMITTED));
    }

    function testSubmitProposalWorksForOwner() public {
        vm.prank(owner);
        bytes32 proposalId = governance.submitProposal(daoId, 0, contentHash, address(0), "", 0);
        assertTrue(proposalId != bytes32(0));
    }
}
