// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../src/oracle/FeedRegistry.sol";
import {OracleFeeRouter} from "../../src/oracle/OracleFeeRouter.sol";
import {CommitteeManager} from "../../src/oracle/CommitteeManager.sol";
import {IFeedRegistry} from "../../src/oracle/interfaces/IFeedRegistry.sol";
import {IOracleFeeRouter} from "../../src/oracle/interfaces/IOracleFeeRouter.sol";
import {ICommitteeManager} from "../../src/oracle/interfaces/ICommitteeManager.sol";

/**
 * @title DelegationTests
 * @notice Tests for delegation functionality and operator assignments
 */
contract DelegationTests is Test {
    FeedRegistry public registry;
    OracleFeeRouter public feeRouter;
    CommitteeManager public committee;

    address public owner = address(0x1);
    address public delegator1 = address(0x10);
    address public delegator2 = address(0x20);
    address public delegator3 = address(0x30);
    address public operator1 = address(0x100);
    address public operator2 = address(0x200);

    bytes32 public operatorId1;
    bytes32 public operatorId2;
    bytes32 public feedId;

    address public constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address public constant USDC = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    function setUp() public {
        vm.warp(1700000000);

        vm.deal(delegator1, 100 ether);
        vm.deal(delegator2, 100 ether);
        vm.deal(delegator3, 100 ether);
        vm.deal(owner, 100 ether);

        operatorId1 = keccak256(abi.encodePacked("operator1"));
        operatorId2 = keccak256(abi.encodePacked("operator2"));

        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);
        committee = new CommitteeManager(address(registry), owner);

        feedId = registry.createFeed(
            IFeedRegistry.FeedCreateParams({
                symbol: "ETH-USD",
                baseToken: WETH,
                quoteToken: USDC,
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

        // Add operators to global allowlist and committee
        address[] memory operators = new address[](2);
        operators[0] = operator1;
        operators[1] = operator2;
        committee.setGlobalAllowlist(operators, true);
        vm.stopPrank();
    }

    // ==================== Delegation Basic Tests ====================

    function test_DelegateToOperator() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1);

        assertEq(feeRouter.getDelegation(delegator1, operatorId1), 5 ether);
        assertEq(feeRouter.getOperatorTotalDelegated(operatorId1), 5 ether);
    }

    function test_DelegateToOperator_MultipleDelegators() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1);

        vm.prank(delegator2);
        feeRouter.delegateToOperator{value: 3 ether}(operatorId1);

        vm.prank(delegator3);
        feeRouter.delegateToOperator{value: 2 ether}(operatorId1);

        assertEq(feeRouter.getDelegation(delegator1, operatorId1), 5 ether);
        assertEq(feeRouter.getDelegation(delegator2, operatorId1), 3 ether);
        assertEq(feeRouter.getDelegation(delegator3, operatorId1), 2 ether);
        assertEq(feeRouter.getOperatorTotalDelegated(operatorId1), 10 ether);
    }

    function test_DelegateToOperator_MultipleOperators() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1);

        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 3 ether}(operatorId2);

        assertEq(feeRouter.getDelegation(delegator1, operatorId1), 5 ether);
        assertEq(feeRouter.getDelegation(delegator1, operatorId2), 3 ether);
        assertEq(feeRouter.getOperatorTotalDelegated(operatorId1), 5 ether);
        assertEq(feeRouter.getOperatorTotalDelegated(operatorId2), 3 ether);
    }

    function test_DelegateToOperator_AdditiveDelegation() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 2 ether}(operatorId1);

        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 3 ether}(operatorId1);

        assertEq(feeRouter.getDelegation(delegator1, operatorId1), 5 ether);
        assertEq(feeRouter.getOperatorTotalDelegated(operatorId1), 5 ether);
    }

    function test_DelegateToOperator_RevertZeroAmount() public {
        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 0}(operatorId1);
    }

    // ==================== Undelegation Tests ====================

    function test_UndelegateFromOperator() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1);

        uint256 balanceBefore = delegator1.balance;

        vm.prank(delegator1);
        feeRouter.undelegateFromOperator(operatorId1, 2 ether);

        assertEq(delegator1.balance, balanceBefore + 2 ether);
        assertEq(feeRouter.getDelegation(delegator1, operatorId1), 3 ether);
        assertEq(feeRouter.getOperatorTotalDelegated(operatorId1), 3 ether);
    }

    function test_UndelegateFromOperator_FullAmount() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1);

        uint256 balanceBefore = delegator1.balance;

        vm.prank(delegator1);
        feeRouter.undelegateFromOperator(operatorId1, 5 ether);

        assertEq(delegator1.balance, balanceBefore + 5 ether);
        assertEq(feeRouter.getDelegation(delegator1, operatorId1), 0);
        assertEq(feeRouter.getOperatorTotalDelegated(operatorId1), 0);
    }

    function test_UndelegateFromOperator_RevertExceedsDelegation() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1);

        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(delegator1);
        feeRouter.undelegateFromOperator(operatorId1, 6 ether);
    }

    function test_UndelegateFromOperator_RevertNoDelegation() public {
        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(delegator1);
        feeRouter.undelegateFromOperator(operatorId1, 1 ether);
    }

    // ==================== Delegator Rewards Tests ====================

    function test_DistributeDelegatorRewards_ProportionalDistribution() public {
        // Delegate different amounts
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1); // 50%

        vm.prank(delegator2);
        feeRouter.delegateToOperator{value: 3 ether}(operatorId1); // 30%

        vm.prank(delegator3);
        feeRouter.delegateToOperator{value: 2 ether}(operatorId1); // 20%

        // Distribute 10 ether in rewards
        vm.prank(owner);
        feeRouter.distributeDelegatorRewards(operatorId1, 10 ether);

        // Verify proportional distribution
        assertEq(feeRouter.getDelegatorPendingRewards(delegator1, operatorId1), 5 ether); // 50%
        assertEq(feeRouter.getDelegatorPendingRewards(delegator2, operatorId1), 3 ether); // 30%
        assertEq(feeRouter.getDelegatorPendingRewards(delegator3, operatorId1), 2 ether); // 20%
    }

    function test_DistributeDelegatorRewards_MultipleDistributions() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1);

        vm.prank(delegator2);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1);

        // First distribution
        vm.prank(owner);
        feeRouter.distributeDelegatorRewards(operatorId1, 4 ether);

        assertEq(feeRouter.getDelegatorPendingRewards(delegator1, operatorId1), 2 ether);
        assertEq(feeRouter.getDelegatorPendingRewards(delegator2, operatorId1), 2 ether);

        // Second distribution
        vm.prank(owner);
        feeRouter.distributeDelegatorRewards(operatorId1, 6 ether);

        // Rewards should accumulate
        assertEq(feeRouter.getDelegatorPendingRewards(delegator1, operatorId1), 5 ether);
        assertEq(feeRouter.getDelegatorPendingRewards(delegator2, operatorId1), 5 ether);
    }

    function test_DistributeDelegatorRewards_NoDelegation() public {
        // Should not revert, just do nothing
        vm.prank(owner);
        feeRouter.distributeDelegatorRewards(operatorId1, 10 ether);

        assertEq(feeRouter.getDelegatorPendingRewards(delegator1, operatorId1), 0);
    }

    function test_ClaimDelegatorRewards() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 10 ether}(operatorId1);

        vm.prank(owner);
        feeRouter.distributeDelegatorRewards(operatorId1, 5 ether);

        // Fund the contract
        vm.deal(address(feeRouter), 10 ether);

        uint256 balanceBefore = delegator1.balance;

        vm.prank(delegator1);
        uint256 claimed = feeRouter.claimDelegatorRewards(operatorId1);

        assertEq(claimed, 5 ether);
        assertEq(delegator1.balance, balanceBefore + 5 ether);
        assertEq(feeRouter.getDelegatorPendingRewards(delegator1, operatorId1), 0);
    }

    function test_ClaimDelegatorRewards_RevertNothingToClaim() public {
        vm.expectRevert(IOracleFeeRouter.NoRewardsToClaim.selector);
        vm.prank(delegator1);
        feeRouter.claimDelegatorRewards(operatorId1);
    }

    // ==================== Concurrent Delegation Tests ====================

    function test_ConcurrentDelegationsAndUndelegations() public {
        // Multiple delegators delegate concurrently
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 10 ether}(operatorId1);

        vm.prank(delegator2);
        feeRouter.delegateToOperator{value: 10 ether}(operatorId1);

        // Distribute rewards
        vm.prank(owner);
        feeRouter.distributeDelegatorRewards(operatorId1, 10 ether);

        // Delegator1 undelegates partially
        vm.prank(delegator1);
        feeRouter.undelegateFromOperator(operatorId1, 5 ether);

        // Delegator3 joins
        vm.prank(delegator3);
        feeRouter.delegateToOperator{value: 5 ether}(operatorId1);

        // Distribute more rewards with new proportions
        vm.prank(owner);
        feeRouter.distributeDelegatorRewards(operatorId1, 20 ether);

        // Total: delegator1=5, delegator2=10, delegator3=5 (total=20)
        // New rewards: d1=5, d2=10, d3=5
        // Plus previous: d1=5, d2=5
        assertEq(feeRouter.getDelegatorPendingRewards(delegator1, operatorId1), 10 ether); // 5 + 5
        assertEq(feeRouter.getDelegatorPendingRewards(delegator2, operatorId1), 15 ether); // 5 + 10
        assertEq(feeRouter.getDelegatorPendingRewards(delegator3, operatorId1), 5 ether);  // 0 + 5
    }

    // ==================== Boundary Conditions ====================

    function test_DelegateMinAmount() public {
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 1 wei}(operatorId1);

        assertEq(feeRouter.getDelegation(delegator1, operatorId1), 1 wei);
    }

    function test_DelegateLargeAmount() public {
        vm.deal(delegator1, 1_000_000 ether);

        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 1_000_000 ether}(operatorId1);

        assertEq(feeRouter.getDelegation(delegator1, operatorId1), 1_000_000 ether);
    }

    function test_RewardDistributionWithTinyDelegation() public {
        // One large, one tiny delegation
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 100 ether}(operatorId1);

        vm.prank(delegator2);
        feeRouter.delegateToOperator{value: 1 wei}(operatorId1);

        // Distribute rewards
        vm.prank(owner);
        feeRouter.distributeDelegatorRewards(operatorId1, 100 ether);

        // Delegator1 should get almost all
        uint256 d1Rewards = feeRouter.getDelegatorPendingRewards(delegator1, operatorId1);
        uint256 d2Rewards = feeRouter.getDelegatorPendingRewards(delegator2, operatorId1);

        assertTrue(d1Rewards > 99 ether);
        assertEq(d2Rewards, 0); // Due to rounding
    }

    // ==================== Committee Assignment Tests ====================

    function test_GetOperatorAssignments_Empty() public view {
        bytes32 opId = bytes32(uint256(uint160(operator1)));
        ICommitteeManager.CommitteeAssignment[] memory assignments = committee.getOperatorAssignments(opId);
        assertEq(assignments.length, 0);
    }

    function test_GetOperatorAssignmentsByAddress_Empty() public view {
        ICommitteeManager.CommitteeAssignment[] memory assignments = committee.getOperatorAssignmentsByAddress(operator1);
        assertEq(assignments.length, 0);
    }

    // ==================== Integration: Delegation + Subscription ====================

    function test_DelegationAndSubscriptionIntegration() public {
        // Setup: delegate to operators
        vm.prank(delegator1);
        feeRouter.delegateToOperator{value: 10 ether}(operatorId1);

        // User subscribes
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId;
        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);

        vm.prank(delegator2);
        feeRouter.subscribe{value: price}(feedIds, 1);

        // Advance epoch and distribute
        vm.warp(block.timestamp + 1 days + 1);
        feeRouter.distributeEpochRewards(1);

        // Get epoch rewards
        IOracleFeeRouter.EpochRewards memory rewards = feeRouter.getEpochRewards(1);

        // Distribute delegator pool to operator's delegators
        vm.prank(owner);
        feeRouter.distributeDelegatorRewards(operatorId1, rewards.delegatorPool);

        // Delegator1 should have pending rewards
        uint256 pending = feeRouter.getDelegatorPendingRewards(delegator1, operatorId1);
        assertEq(pending, rewards.delegatorPool);
    }
}

