// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {ComputeStaking} from "../../src/compute/ComputeStaking.sol";

// Mock BanManager
contract MockBanManager {
    mapping(uint256 => bool) public banned;

    function setBanned(uint256 agentId, bool isBanned) external {
        banned[agentId] = isBanned;
    }

    function isNetworkBanned(uint256 agentId) external view returns (bool) {
        return banned[agentId];
    }
}

contract ComputeStakingTest is Test {
    ComputeStaking public staking;
    MockBanManager public banManager;

    address public owner;
    address public user1;
    address public user2;
    address public provider;
    address public guardian;

    // Allow this contract to receive ETH (slashed funds go to owner)
    receive() external payable {}

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        provider = makeAddr("provider");
        guardian = makeAddr("guardian");

        banManager = new MockBanManager();
        staking = new ComputeStaking(address(banManager), owner);

        // Fund test accounts
        vm.deal(user1, 10 ether);
        vm.deal(user2, 10 ether);
        vm.deal(provider, 10 ether);
        vm.deal(guardian, 10 ether);
    }

    // ============ User Staking Tests ============

    function test_stakeAsUser() public {
        vm.startPrank(user1);
        staking.stakeAsUser{value: 0.01 ether}();
        vm.stopPrank();

        ComputeStaking.Stake memory stake = staking.getStake(user1);
        assertEq(stake.amount, 0.01 ether);
        assertEq(uint8(stake.stakeType), uint8(ComputeStaking.StakeType.USER));
        assertFalse(stake.slashed);
        assertTrue(staking.isStaked(user1));
    }

    function test_stakeAsUser_insufficientStake() public {
        vm.startPrank(user1);
        vm.expectRevert(abi.encodeWithSelector(ComputeStaking.InsufficientStake.selector, 0.005 ether, 0.01 ether));
        staking.stakeAsUser{value: 0.005 ether}();
        vm.stopPrank();
    }

    function test_stakeAsUser_alreadyStaked() public {
        vm.startPrank(user1);
        staking.stakeAsUser{value: 0.01 ether}();

        vm.expectRevert(ComputeStaking.AlreadyStaked.selector);
        staking.stakeAsUser{value: 0.01 ether}();
        vm.stopPrank();
    }

    // ============ Provider Staking Tests ============

    function test_stakeAsProvider() public {
        vm.startPrank(provider);
        staking.stakeAsProvider{value: 0.1 ether}();
        vm.stopPrank();

        ComputeStaking.Stake memory stake = staking.getStake(provider);
        assertEq(stake.amount, 0.1 ether);
        assertEq(uint8(stake.stakeType), uint8(ComputeStaking.StakeType.PROVIDER));
        assertTrue(staking.isProvider(provider));
    }

    function test_stakeAsProvider_insufficientStake() public {
        vm.startPrank(provider);
        vm.expectRevert(abi.encodeWithSelector(ComputeStaking.InsufficientStake.selector, 0.05 ether, 0.1 ether));
        staking.stakeAsProvider{value: 0.05 ether}();
        vm.stopPrank();
    }

    // ============ Guardian Staking Tests ============

    function test_stakeAsGuardian() public {
        vm.startPrank(guardian);
        staking.stakeAsGuardian{value: 1 ether}();
        vm.stopPrank();

        ComputeStaking.Stake memory stake = staking.getStake(guardian);
        assertEq(stake.amount, 1 ether);
        assertEq(uint8(stake.stakeType), uint8(ComputeStaking.StakeType.GUARDIAN));
        assertTrue(staking.isGuardian(guardian));

        address[] memory guardians = staking.getGuardians();
        assertEq(guardians.length, 1);
        assertEq(guardians[0], guardian);
    }

    function test_stakeAsGuardian_insufficientStake() public {
        vm.startPrank(guardian);
        vm.expectRevert(abi.encodeWithSelector(ComputeStaking.InsufficientStake.selector, 0.5 ether, 1 ether));
        staking.stakeAsGuardian{value: 0.5 ether}();
        vm.stopPrank();
    }

    // ============ Add Stake Tests ============

    function test_addStake() public {
        vm.startPrank(user1);
        staking.stakeAsUser{value: 0.01 ether}();
        staking.addStake{value: 0.05 ether}();
        vm.stopPrank();

        assertEq(staking.getStakeAmount(user1), 0.06 ether);
    }

    function test_addStake_notStaked() public {
        vm.startPrank(user1);
        vm.expectRevert(ComputeStaking.NotStaked.selector);
        staking.addStake{value: 0.01 ether}();
        vm.stopPrank();
    }

    // ============ Unstake Tests ============

    function test_unstake() public {
        vm.startPrank(user1);
        staking.stakeAsUser{value: 0.02 ether}();

        // Wait for lock period
        vm.warp(block.timestamp + 8 days);

        uint256 balanceBefore = user1.balance;
        staking.unstake(0.01 ether);

        assertEq(user1.balance, balanceBefore + 0.01 ether);
        assertEq(staking.getStakeAmount(user1), 0.01 ether);
        vm.stopPrank();
    }

    function test_unstake_locked() public {
        vm.startPrank(user1);
        staking.stakeAsUser{value: 0.02 ether}();

        ComputeStaking.Stake memory stake = staking.getStake(user1);

        vm.expectRevert(abi.encodeWithSelector(ComputeStaking.StakeLocked.selector, stake.lockedUntil));
        staking.unstake(0.01 ether);
        vm.stopPrank();
    }

    function test_unstake_full() public {
        vm.startPrank(user1);
        staking.stakeAsUser{value: 0.01 ether}();

        vm.warp(block.timestamp + 8 days);
        staking.unstake(0.01 ether);

        assertFalse(staking.isStaked(user1));
        vm.stopPrank();
    }

    function test_unstake_belowMinimum() public {
        vm.startPrank(user1);
        staking.stakeAsUser{value: 0.02 ether}();

        vm.warp(block.timestamp + 8 days);

        // Try to unstake to 0.005 (below minimum of 0.01)
        vm.expectRevert(abi.encodeWithSelector(ComputeStaking.InsufficientStake.selector, 0.005 ether, 0.01 ether));
        staking.unstake(0.015 ether);
        vm.stopPrank();
    }

    // ============ Slashing Tests ============

    function test_slash_byOwner() public {
        vm.prank(user1);
        staking.stakeAsUser{value: 1 ether}();

        uint256 ownerBalanceBefore = owner.balance;

        staking.slash(user1, 50, "Bad behavior");

        assertEq(staking.getStakeAmount(user1), 0.5 ether);
        assertEq(owner.balance, ownerBalanceBefore + 0.5 ether);

        ComputeStaking.Stake memory stake = staking.getStake(user1);
        assertTrue(stake.slashed);
    }

    function test_slash_byGuardian() public {
        // First, set up a guardian
        vm.prank(guardian);
        staking.stakeAsGuardian{value: 1 ether}();

        // Set up a user to slash
        vm.prank(user1);
        staking.stakeAsUser{value: 1 ether}();

        // Guardian slashes user
        vm.prank(guardian);
        staking.slash(user1, 25, "Minor violation");

        assertEq(staking.getStakeAmount(user1), 0.75 ether);
    }

    function test_slash_notGuardian() public {
        vm.prank(user1);
        staking.stakeAsUser{value: 1 ether}();

        vm.prank(user2);
        vm.expectRevert(ComputeStaking.NotGuardian.selector);
        staking.slash(user1, 50, "Unauthorized");
    }

    function test_slash_deactivatesGuardian() public {
        vm.prank(guardian);
        staking.stakeAsGuardian{value: 1 ether}();

        assertTrue(staking.isGuardian(guardian));

        staking.slash(guardian, 50, "Guardian misbehavior");

        assertFalse(staking.isGuardian(guardian));
    }

    // ============ View Function Tests ============

    function test_getTotalStaked() public {
        vm.prank(user1);
        staking.stakeAsUser{value: 0.01 ether}();

        vm.prank(provider);
        staking.stakeAsProvider{value: 0.1 ether}();

        vm.prank(guardian);
        staking.stakeAsGuardian{value: 1 ether}();

        (uint256 userTotal, uint256 providerTotal, uint256 guardianTotal, uint256 total) = staking.getTotalStaked();

        assertEq(userTotal, 0.01 ether);
        assertEq(providerTotal, 0.1 ether);
        assertEq(guardianTotal, 1 ether);
        assertEq(total, 1.11 ether);
    }

    function test_getGuardianCount() public {
        assertEq(staking.getGuardianCount(), 0);

        vm.prank(guardian);
        staking.stakeAsGuardian{value: 1 ether}();

        assertEq(staking.getGuardianCount(), 1);
    }

    // ============ Admin Tests ============

    function test_setLockPeriod() public {
        staking.setLockPeriod(14 days);
        assertEq(staking.lockPeriod(), 14 days);
    }

    function test_setBanManager() public {
        MockBanManager newBanManager = new MockBanManager();
        staking.setBanManager(address(newBanManager));
        assertEq(address(staking.banManager()), address(newBanManager));
    }

    function test_pauseUnpause() public {
        staking.pause();

        vm.prank(user1);
        vm.expectRevert();
        staking.stakeAsUser{value: 0.01 ether}();

        staking.unpause();

        vm.prank(user1);
        staking.stakeAsUser{value: 0.01 ether}();

        assertTrue(staking.isStaked(user1));
    }

    function test_version() public view {
        assertEq(staking.version(), "1.0.0");
    }
}
