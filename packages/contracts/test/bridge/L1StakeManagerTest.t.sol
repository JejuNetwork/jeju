// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {L1StakeManager} from "../../src/bridge/eil/L1StakeManager.sol";
import {L1CrossDomainMessenger} from "../../src/bridge/eil/L1CrossDomainMessenger.sol";

/**
 * @title L1StakeManagerTest
 * @notice Tests for L1StakeManager including XLP registration, staking, and slashing
 */
contract L1StakeManagerTest is Test {
    L1StakeManager public stakeManager;
    L1CrossDomainMessenger public messenger;

    address public owner = address(0x1);
    address public xlp = address(0x2);
    address public xlp2 = address(0x3);
    address public victim = address(0x4);
    address public slasher = address(0x5);
    address public paymaster = address(0x6);

    uint256 public constant L2_CHAIN_ID = 31337;

    function setUp() public {
        vm.deal(owner, 100 ether);
        vm.deal(xlp, 100 ether);
        vm.deal(xlp2, 100 ether);

        vm.startPrank(owner);
        stakeManager = new L1StakeManager();
        messenger = new L1CrossDomainMessenger();
        
        stakeManager.setMessenger(address(messenger));
        stakeManager.registerL2Paymaster(L2_CHAIN_ID, paymaster);
        stakeManager.setAuthorizedSlasher(slasher, true);
        vm.stopPrank();
    }

    // ============ Registration Tests ============

    function test_Register() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 2 ether}(chains);

        L1StakeManager.XLPStake memory stake = stakeManager.getStake(xlp);
        assertEq(stake.stakedAmount, 2 ether);
        assertTrue(stake.isActive);
    }

    function test_Register_InsufficientStake() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        vm.expectRevert(L1StakeManager.InsufficientStake.selector);
        stakeManager.register{value: 0.5 ether}(chains);
    }

    function test_Register_AlreadyRegistered() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 2 ether}(chains);

        vm.prank(xlp);
        vm.expectRevert(L1StakeManager.AlreadyRegistered.selector);
        stakeManager.register{value: 2 ether}(chains);
    }

    function test_Register_ChainNotSupported() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = 999; // Unsupported chain

        vm.prank(xlp);
        vm.expectRevert(L1StakeManager.ChainNotSupported.selector);
        stakeManager.register{value: 2 ether}(chains);
    }

    // ============ Add Stake Tests ============

    function test_AddStake() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.startPrank(xlp);
        stakeManager.register{value: 2 ether}(chains);
        stakeManager.addStake{value: 1 ether}();
        vm.stopPrank();

        L1StakeManager.XLPStake memory stake = stakeManager.getStake(xlp);
        assertEq(stake.stakedAmount, 3 ether);
    }

    function test_AddStake_NotRegistered() public {
        vm.prank(xlp);
        vm.expectRevert(L1StakeManager.NotRegistered.selector);
        stakeManager.addStake{value: 1 ether}();
    }

    // ============ Unbonding Tests ============

    function test_StartUnbonding() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 2 ether}(chains);

        vm.prank(xlp);
        stakeManager.startUnbonding(1 ether);

        L1StakeManager.XLPStake memory stake = stakeManager.getStake(xlp);
        assertEq(stake.stakedAmount, 1 ether);
        assertEq(stake.unbondingAmount, 1 ether);
        assertTrue(stake.unbondingStartTime > 0);
    }

    function test_CompleteUnbonding() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.startPrank(xlp);
        stakeManager.register{value: 2 ether}(chains);
        stakeManager.startUnbonding(1 ether);
        vm.stopPrank();

        // Fast forward past unbonding period
        vm.warp(block.timestamp + 8 days);

        uint256 balanceBefore = xlp.balance;
        vm.prank(xlp);
        stakeManager.completeUnbonding();

        assertEq(xlp.balance - balanceBefore, 1 ether);

        L1StakeManager.XLPStake memory stake = stakeManager.getStake(xlp);
        assertEq(stake.unbondingAmount, 0);
    }

    function test_CompleteUnbonding_TooEarly() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.startPrank(xlp);
        stakeManager.register{value: 2 ether}(chains);
        stakeManager.startUnbonding(1 ether);
        vm.stopPrank();

        // Try to complete before unbonding period
        vm.prank(xlp);
        vm.expectRevert(L1StakeManager.UnbondingNotComplete.selector);
        stakeManager.completeUnbonding();
    }

    function test_CancelUnbonding() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.startPrank(xlp);
        stakeManager.register{value: 2 ether}(chains);
        stakeManager.startUnbonding(1 ether);
        stakeManager.cancelUnbonding();
        vm.stopPrank();

        L1StakeManager.XLPStake memory stake = stakeManager.getStake(xlp);
        assertEq(stake.stakedAmount, 2 ether);
        assertEq(stake.unbondingAmount, 0);
    }

    // ============ Slashing Tests ============

    function test_Slash() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 5 ether}(chains);

        bytes32 voucherId = keccak256(abi.encodePacked("voucher1", block.timestamp));

        uint256 victimBalanceBefore = victim.balance;

        vm.prank(slasher);
        stakeManager.slash(xlp, L2_CHAIN_ID, voucherId, 1 ether, victim);

        L1StakeManager.XLPStake memory stake = stakeManager.getStake(xlp);
        assertEq(stake.stakedAmount, 4 ether);
        assertEq(stake.slashedAmount, 1 ether);
        assertEq(victim.balance - victimBalanceBefore, 1 ether);
    }

    function test_Slash_UnauthorizedSlasher() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 5 ether}(chains);

        bytes32 voucherId = keccak256(abi.encodePacked("voucher1"));

        vm.prank(xlp); // Not authorized
        vm.expectRevert(L1StakeManager.UnauthorizedSlasher.selector);
        stakeManager.slash(xlp, L2_CHAIN_ID, voucherId, 1 ether, victim);
    }

    function test_Slash_AlreadyExecuted() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 5 ether}(chains);

        bytes32 voucherId = keccak256(abi.encodePacked("voucher1", block.timestamp));

        vm.prank(slasher);
        stakeManager.slash(xlp, L2_CHAIN_ID, voucherId, 1 ether, victim);

        // Try to slash again with same voucherId
        vm.prank(slasher);
        vm.expectRevert(L1StakeManager.SlashAlreadyExecuted.selector);
        stakeManager.slash(xlp, L2_CHAIN_ID, voucherId, 1 ether, victim);
    }

    function test_Slash_NotRegistered() public {
        bytes32 voucherId = keccak256(abi.encodePacked("voucher1"));

        vm.prank(slasher);
        vm.expectRevert(L1StakeManager.NotRegistered.selector);
        stakeManager.slash(xlp, L2_CHAIN_ID, voucherId, 1 ether, victim);
    }

    function test_Slash_PartialAmount() public {
        // The slash function calculates 50% of stake or requested amount, whichever is smaller
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 2 ether}(chains);

        bytes32 voucherId = keccak256(abi.encodePacked("voucher_partial"));

        // Request 5 ether but XLP only has 2 ether, so only 50% = 1 ether will be slashed
        vm.prank(slasher);
        stakeManager.slash(xlp, L2_CHAIN_ID, voucherId, 5 ether, victim);

        L1StakeManager.XLPStake memory stake = stakeManager.getStake(xlp);
        // 2 ether stake, 50% penalty = 1 ether slashed
        assertEq(stake.stakedAmount, 1 ether);
        assertEq(stake.slashedAmount, 1 ether);
    }

    // ============ Cross-Chain Sync Tests ============

    function test_SyncStakeToL2() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 3 ether}(chains);

        // XLP can sync their own stake
        vm.prank(xlp);
        stakeManager.syncStakeToL2(L2_CHAIN_ID, xlp);

        // Check event was emitted (messenger sends message)
        // The actual relay would happen off-chain
    }

    function test_SyncStakeToL2_Unauthorized() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 3 ether}(chains);

        // Random address cannot sync someone else's stake
        vm.prank(xlp2);
        vm.expectRevert(L1StakeManager.UnauthorizedSlasher.selector);
        stakeManager.syncStakeToL2(L2_CHAIN_ID, xlp);
    }

    // ============ Admin Tests ============

    function test_RegisterL2Paymaster() public {
        address newPaymaster = address(0x999);
        uint256 newChainId = 42161;

        vm.prank(owner);
        stakeManager.registerL2Paymaster(newChainId, newPaymaster);

        assertEq(stakeManager.l2Paymasters(newChainId), newPaymaster);
    }

    function test_SetAuthorizedSlasher() public {
        address newSlasher = address(0x888);

        vm.prank(owner);
        stakeManager.setAuthorizedSlasher(newSlasher, true);

        assertTrue(stakeManager.authorizedSlashers(newSlasher));

        vm.prank(owner);
        stakeManager.setAuthorizedSlasher(newSlasher, false);

        assertFalse(stakeManager.authorizedSlashers(newSlasher));
    }

    function test_Pause() public {
        vm.prank(owner);
        stakeManager.pause();

        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        vm.expectRevert();
        stakeManager.register{value: 2 ether}(chains);
    }

    function test_Unpause() public {
        vm.prank(owner);
        stakeManager.pause();

        vm.prank(owner);
        stakeManager.unpause();

        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 2 ether}(chains);
    }

    // ============ View Functions ============

    function test_GetXLPChains() public {
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 2 ether}(chains);

        uint256[] memory registeredChains = stakeManager.getXLPChains(xlp);
        assertEq(registeredChains.length, 1);
        assertEq(registeredChains[0], L2_CHAIN_ID);
    }

    function test_IsXLPActive() public {
        assertFalse(stakeManager.isXLPActive(xlp));

        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.prank(xlp);
        stakeManager.register{value: 2 ether}(chains);

        assertTrue(stakeManager.isXLPActive(xlp));
    }
}

