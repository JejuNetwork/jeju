// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {SupremeCourt} from "../../src/moderation/SupremeCourt.sol";
import {IDAORegistry} from "../../src/governance/interfaces/IDAORegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockDAORegistry {
    mapping(bytes32 => mapping(address => bool)) public boardMembers;
    IDAORegistry.DirectorPersona public directorPersona;
    IDAORegistry.DAO public dao;
    IDAORegistry.BoardMember[] public members;

    function setBoardMember(bytes32 daoId, address member, bool isMember) external {
        boardMembers[daoId][member] = isMember;
    }

    function isBoardMember(bytes32 daoId, address member) external view returns (bool) {
        return boardMembers[daoId][member];
    }

    function setDirectorPersona(IDAORegistry.DirectorPersona memory persona) external {
        directorPersona = persona;
    }

    function getDirectorPersona(bytes32) external view returns (IDAORegistry.DirectorPersona memory) {
        return directorPersona;
    }

    function setDAO(IDAORegistry.DAO memory _dao) external {
        dao = _dao;
    }

    function getDAO(bytes32) external view returns (IDAORegistry.DAO memory) {
        return dao;
    }

    function addBoardMemberStruct(IDAORegistry.BoardMember memory member) external {
        members.push(member);
    }

    function getBoardMembers(bytes32) external view returns (IDAORegistry.BoardMember[] memory) {
        return members;
    }
}

contract MockToken is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract SupremeCourtTest is Test {
    SupremeCourt public court;
    MockDAORegistry public registry;
    MockToken public token;

    address public owner = address(1);
    address public appellant = address(2);
    address public boardMember1 = address(3);
    address public boardMember2 = address(4);
    address public boardMember3 = address(5);
    address public boardMember4 = address(6);
    address public director = address(7);
    address public insuranceFund = address(8);

    bytes32 public networkDaoId = keccak256("jeju");
    bytes32 public originalCaseId = keccak256("case1");

    function setUp() public {
        registry = new MockDAORegistry();
        token = new MockToken();

        vm.prank(owner);
        court = new SupremeCourt(
            address(registry),
            address(token),
            address(0), // moderationMarketplace
            insuranceFund,
            networkDaoId,
            owner
        );

        // Setup board members
        registry.setBoardMember(networkDaoId, boardMember1, true);
        registry.setBoardMember(networkDaoId, boardMember2, true);
        registry.setBoardMember(networkDaoId, boardMember3, true);
        registry.setBoardMember(networkDaoId, boardMember4, true);

        // Add board member structs for isHuman check
        string[] memory traits = new string[](0);
        registry.addBoardMemberStruct(IDAORegistry.BoardMember({
            member: boardMember1,
            agentId: 0,
            role: "Treasury",
            weight: 100,
            addedAt: block.timestamp,
            isActive: true,
            isHuman: true
        }));
        registry.addBoardMemberStruct(IDAORegistry.BoardMember({
            member: boardMember2,
            agentId: 1,
            role: "Code",
            weight: 100,
            addedAt: block.timestamp,
            isActive: true,
            isHuman: false
        }));
        registry.addBoardMemberStruct(IDAORegistry.BoardMember({
            member: boardMember3,
            agentId: 2,
            role: "Community",
            weight: 100,
            addedAt: block.timestamp,
            isActive: true,
            isHuman: false
        }));
        registry.addBoardMemberStruct(IDAORegistry.BoardMember({
            member: boardMember4,
            agentId: 3,
            role: "Security",
            weight: 100,
            addedAt: block.timestamp,
            isActive: true,
            isHuman: true
        }));

        // Setup director (AI)
        registry.setDirectorPersona(IDAORegistry.DirectorPersona({
            name: "Test Director",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: traits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 100,
            decisionFallbackDays: 7
        }));

        registry.setDAO(IDAORegistry.DAO({
            daoId: networkDaoId,
            name: "Jeju",
            displayName: "Jeju Network",
            description: "Main network DAO",
            treasury: address(0),
            board: address(0),
            directorAgent: director,
            feeConfig: address(0),
            directorModelId: bytes32(0),
            manifestCid: "",
            status: IDAORegistry.DAOStatus.ACTIVE,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            creator: owner
        }));

        // Fund appellant
        token.mint(appellant, 10000e18);
        vm.prank(appellant);
        token.approve(address(court), type(uint256).max);
    }

    function test_FileAppeal() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        SupremeCourt.Appeal memory appeal = court.getAppeal(appealId);
        assertEq(appeal.appellant, appellant);
        assertEq(appeal.stakeAmount, 1000e18);
        assertEq(appeal.originalCaseId, originalCaseId);
        assertEq(uint8(appeal.status), uint8(SupremeCourt.AppealStatus.BOARD_REVIEW));
    }

    function test_FileAppeal_InsufficientStake() public {
        vm.prank(appellant);
        vm.expectRevert(abi.encodeWithSelector(SupremeCourt.InsufficientStake.selector, 100e18, 1000e18));
        court.fileAppeal(originalCaseId, "ipfs://evidence", 100e18);
    }

    function test_FileAppeal_DuplicateAppeal() public {
        vm.prank(appellant);
        court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        vm.prank(appellant);
        vm.expectRevert(SupremeCourt.AppealAlreadyExists.selector);
        court.fileAppeal(originalCaseId, "ipfs://evidence2", 1000e18);
    }

    function test_CastBoardVote() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        vm.prank(boardMember1);
        court.castBoardVote(appealId, true, "Support appellant");

        SupremeCourt.Appeal memory appeal = court.getAppeal(appealId);
        assertEq(appeal.boardVotesFor, 1);
        assertEq(appeal.boardVotesAgainst, 0);
    }

    function test_CastBoardVote_NotBoardMember() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        vm.prank(address(99)); // Not a board member
        vm.expectRevert(SupremeCourt.NotBoardMember.selector);
        court.castBoardVote(appealId, true, "Support");
    }

    function test_CastBoardVote_AlreadyVoted() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        vm.prank(boardMember1);
        court.castBoardVote(appealId, true, "Support");

        vm.prank(boardMember1);
        vm.expectRevert(SupremeCourt.AlreadyVoted.selector);
        court.castBoardVote(appealId, false, "Changed mind");
    }

    function test_CompleteReview() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        // Cast 3 votes
        vm.prank(boardMember1);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember2);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember3);
        court.castBoardVote(appealId, false, "Against");

        // Advance past voting period
        vm.warp(block.timestamp + 8 days);

        court.completeReview(appealId);

        SupremeCourt.Appeal memory appeal = court.getAppeal(appealId);
        assertEq(uint8(appeal.status), uint8(SupremeCourt.AppealStatus.DIRECTOR_DECISION));
    }

    function test_CompleteReview_VotingPeriodNotEnded() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        vm.prank(boardMember1);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember2);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember3);
        court.castBoardVote(appealId, false, "Against");

        // Don't advance time
        vm.expectRevert(SupremeCourt.VotingPeriodNotEnded.selector);
        court.completeReview(appealId);
    }

    function test_CompleteReview_InsufficientVotes() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        // Only 2 votes (less than MIN_BOARD_VOTES)
        vm.prank(boardMember1);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember2);
        court.castBoardVote(appealId, true, "Support");

        vm.warp(block.timestamp + 8 days);

        vm.expectRevert(SupremeCourt.InsufficientBoardVotes.selector);
        court.completeReview(appealId);
    }

    function test_DirectorDecision_Approve() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        // Board voting
        vm.prank(boardMember1);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember2);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember3);
        court.castBoardVote(appealId, false, "Against");

        vm.warp(block.timestamp + 8 days);
        court.completeReview(appealId);

        uint256 appellantBalanceBefore = token.balanceOf(appellant);

        // Director approves appeal
        vm.prank(director);
        court.makeDirectorDecision(appealId, true, "Appeal granted");

        SupremeCourt.Appeal memory appeal = court.getAppeal(appealId);
        assertEq(uint8(appeal.status), uint8(SupremeCourt.AppealStatus.RESOLVED));
        assertTrue(appeal.outcome);
        assertTrue(appeal.directorDecision);

        // Stake should be returned
        assertEq(token.balanceOf(appellant), appellantBalanceBefore + 1000e18);
    }

    function test_DirectorDecision_Reject() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        // Board voting
        vm.prank(boardMember1);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember2);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember3);
        court.castBoardVote(appealId, false, "Against");

        vm.warp(block.timestamp + 8 days);
        court.completeReview(appealId);

        uint256 insuranceFundBefore = token.balanceOf(insuranceFund);

        // Director rejects appeal
        vm.prank(director);
        court.makeDirectorDecision(appealId, false, "Appeal denied");

        SupremeCourt.Appeal memory appeal = court.getAppeal(appealId);
        assertEq(uint8(appeal.status), uint8(SupremeCourt.AppealStatus.RESOLVED));
        assertFalse(appeal.outcome);

        // Stake should go to insurance fund
        assertEq(token.balanceOf(insuranceFund), insuranceFundBefore + 1000e18);
    }

    function test_DirectorDecision_NotDirector() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        vm.prank(boardMember1);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember2);
        court.castBoardVote(appealId, true, "Support");
        vm.prank(boardMember3);
        court.castBoardVote(appealId, false, "Against");

        vm.warp(block.timestamp + 8 days);
        court.completeReview(appealId);

        vm.prank(address(99)); // Not director
        vm.expectRevert(SupremeCourt.NotDirector.selector);
        court.makeDirectorDecision(appealId, true, "Trying to approve");
    }

    function test_GetBoardVotes() public {
        vm.prank(appellant);
        bytes32 appealId = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        vm.prank(boardMember1);
        court.castBoardVote(appealId, true, "Support 1");
        vm.prank(boardMember2);
        court.castBoardVote(appealId, false, "Against 1");

        SupremeCourt.BoardVote[] memory votes = court.getBoardVotes(appealId);
        assertEq(votes.length, 2);
    }

    function test_GetUserAppeals() public {
        vm.prank(appellant);
        court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        vm.prank(appellant);
        court.fileAppeal(keccak256("case2"), "ipfs://evidence2", 1000e18);

        bytes32[] memory appeals = court.getUserAppeals(appellant);
        assertEq(appeals.length, 2);
    }

    function test_GetAppealStats() public {
        // File and resolve 2 appeals
        vm.prank(appellant);
        bytes32 appeal1 = court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);

        vm.prank(boardMember1);
        court.castBoardVote(appeal1, true, "Support");
        vm.prank(boardMember2);
        court.castBoardVote(appeal1, true, "Support");
        vm.prank(boardMember3);
        court.castBoardVote(appeal1, false, "Against");

        vm.warp(block.timestamp + 8 days);
        court.completeReview(appeal1);

        vm.prank(director);
        court.makeDirectorDecision(appeal1, true, "Approved");

        // File another appeal (pending)
        vm.prank(appellant);
        court.fileAppeal(keccak256("case2"), "ipfs://evidence2", 1000e18);

        (uint256 total, uint256 pending, uint256 approved, uint256 rejected) = court.getAppealStats();
        assertEq(total, 2);
        assertEq(pending, 1);
        assertEq(approved, 1);
        assertEq(rejected, 0);
    }

    function test_SetAppealStakeMinimum() public {
        vm.prank(owner);
        court.setAppealStakeMinimum(2000e18);

        assertEq(court.appealStakeMinimum(), 2000e18);
    }

    function test_Pause() public {
        vm.prank(owner);
        court.pause();

        vm.prank(appellant);
        vm.expectRevert(); // EnforcedPause
        court.fileAppeal(originalCaseId, "ipfs://evidence", 1000e18);
    }
}

