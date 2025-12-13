// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/games/BabylonTreasury.sol";

contract BabylonTreasuryTest is Test {
    BabylonTreasury public treasury;

    address public admin = address(0x1);
    address public council1 = address(0x2);
    address public council2 = address(0x3);
    address public council3 = address(0x4);
    address public operator = address(0x5);
    address public newOperator = address(0x6);
    address public attacker = address(0x7);

    bytes public attestation = hex"deadbeef";
    uint256 public dailyLimit = 10 ether;

    function setUp() public {
        vm.startPrank(admin);
        treasury = new BabylonTreasury(dailyLimit);

        // Add council members
        treasury.addCouncilMember(council1);
        treasury.addCouncilMember(council2);
        treasury.addCouncilMember(council3);

        vm.stopPrank();

        // Fund the treasury
        vm.deal(address(treasury), 100 ether);
    }

    // =========================================================================
    // Deposit Tests
    // =========================================================================

    function test_Deposit() public {
        uint256 balanceBefore = address(treasury).balance;

        vm.deal(address(this), 5 ether);
        treasury.deposit{value: 5 ether}();

        assertEq(address(treasury).balance, balanceBefore + 5 ether);
    }

    function test_ReceiveDeposit() public {
        uint256 balanceBefore = address(treasury).balance;

        vm.deal(address(this), 5 ether);
        (bool success,) = address(treasury).call{value: 5 ether}("");
        assertTrue(success);

        assertEq(address(treasury).balance, balanceBefore + 5 ether);
    }

    function testRevert_DepositZero() public {
        vm.expectRevert("Must deposit something");
        treasury.deposit{value: 0}();
    }

    // =========================================================================
    // Operator Registration Tests
    // =========================================================================

    function test_RegisterOperator() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        assertEq(treasury.operator(), operator);
        assertTrue(treasury.isOperatorActive());
    }

    function testRevert_RegisterOperator_NotCouncil() public {
        vm.prank(attacker);
        vm.expectRevert();
        treasury.registerOperator(operator, attestation);
    }

    function testRevert_RegisterOperator_ZeroAddress() public {
        vm.prank(council1);
        vm.expectRevert("Invalid operator");
        treasury.registerOperator(address(0), attestation);
    }

    function testRevert_RegisterOperator_ActiveOperatorExists() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(council1);
        vm.expectRevert("Active operator exists");
        treasury.registerOperator(newOperator, attestation);
    }

    // =========================================================================
    // Heartbeat Tests
    // =========================================================================

    function test_Heartbeat() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.warp(block.timestamp + 30 minutes);

        vm.prank(operator);
        treasury.heartbeat();

        assertTrue(treasury.isOperatorActive());
    }

    function test_OperatorInactive_AfterTimeout() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Fast forward past heartbeat timeout (1 hour)
        vm.warp(block.timestamp + 2 hours);

        assertFalse(treasury.isOperatorActive());
    }

    function test_MarkOperatorInactive() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.warp(block.timestamp + 2 hours);

        treasury.markOperatorInactive();

        assertEq(treasury.operator(), address(0));
    }

    function testRevert_MarkOperatorInactive_StillActive() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.expectRevert("Operator still active");
        treasury.markOperatorInactive();
    }

    // =========================================================================
    // State Update Tests
    // =========================================================================

    function test_UpdateState() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        string memory cid = "QmTest123";
        bytes32 hash = keccak256("state data");

        vm.prank(operator);
        treasury.updateState(cid, hash);

        assertEq(treasury.currentStateCID(), cid);
        assertEq(treasury.currentStateHash(), hash);
        assertEq(treasury.stateVersion(), 1);
    }

    function testRevert_UpdateState_NotOperator() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(attacker);
        vm.expectRevert();
        treasury.updateState("QmTest", bytes32(0));
    }

    // =========================================================================
    // Withdrawal Tests
    // =========================================================================

    function test_Withdraw() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        uint256 balanceBefore = operator.balance;

        vm.prank(operator);
        treasury.withdraw(1 ether);

        assertEq(operator.balance, balanceBefore + 1 ether);
    }

    function test_WithdrawDailyLimit() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Withdraw up to daily limit
        vm.prank(operator);
        treasury.withdraw(dailyLimit);

        // Try to withdraw more - should fail
        vm.prank(operator);
        vm.expectRevert("Exceeds daily limit");
        treasury.withdraw(1 ether);
    }

    function test_WithdrawNextDay() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Withdraw daily limit
        vm.prank(operator);
        treasury.withdraw(dailyLimit);

        // Fast forward to next day
        vm.warp(block.timestamp + 1 days);

        // Should be able to withdraw again
        vm.prank(operator);
        treasury.withdraw(1 ether);
    }

    function testRevert_Withdraw_NotOperator() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(attacker);
        vm.expectRevert();
        treasury.withdraw(1 ether);
    }

    // =========================================================================
    // Permissionless Takeover Tests
    // =========================================================================

    function test_TakeoverAsOperator() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Fast forward past heartbeat timeout + takeover cooldown (3 hours total)
        vm.warp(block.timestamp + 4 hours);

        vm.prank(newOperator);
        treasury.takeoverAsOperator(attestation);

        assertEq(treasury.operator(), newOperator);
        assertTrue(treasury.isOperatorActive());
    }

    function testRevert_Takeover_OperatorStillActive() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(newOperator);
        vm.expectRevert("Operator still active");
        treasury.takeoverAsOperator(attestation);
    }

    function testRevert_Takeover_CooldownNotMet() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Fast forward past heartbeat timeout but not cooldown
        vm.warp(block.timestamp + 2 hours);

        vm.prank(newOperator);
        vm.expectRevert("Takeover cooldown not met");
        treasury.takeoverAsOperator(attestation);
    }

    function testRevert_Takeover_NoAttestation() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.warp(block.timestamp + 4 hours);

        vm.prank(newOperator);
        vm.expectRevert("Attestation required");
        treasury.takeoverAsOperator("");
    }

    // =========================================================================
    // Key Rotation Tests
    // =========================================================================

    function test_KeyRotation_SingleApprover() public {
        vm.prank(admin);
        treasury.setRotationApprovalThreshold(1);

        uint256 keyVersionBefore = treasury.keyVersion();

        vm.prank(council1);
        treasury.requestKeyRotation();

        assertEq(treasury.keyVersion(), keyVersionBefore + 1);
    }

    function test_KeyRotation_MultipleApprovers() public {
        vm.prank(admin);
        treasury.setRotationApprovalThreshold(2);

        uint256 keyVersionBefore = treasury.keyVersion();

        vm.prank(council1);
        uint256 requestId = treasury.requestKeyRotation();

        // Key version should not change yet
        assertEq(treasury.keyVersion(), keyVersionBefore);

        vm.prank(council2);
        treasury.approveKeyRotation(requestId);

        // Now key version should be incremented
        assertEq(treasury.keyVersion(), keyVersionBefore + 1);
    }

    function testRevert_KeyRotation_NotCouncil() public {
        vm.prank(attacker);
        vm.expectRevert();
        treasury.requestKeyRotation();
    }

    // =========================================================================
    // Training Record Tests
    // =========================================================================

    function test_RecordTraining() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        string memory datasetCID = "QmTrainingData";
        bytes32 modelHash = keccak256("model weights");

        vm.prank(operator);
        treasury.recordTraining(datasetCID, modelHash);

        assertEq(treasury.trainingEpoch(), 1);
        assertEq(treasury.lastModelHash(), modelHash);
    }

    // =========================================================================
    // Pause Tests
    // =========================================================================

    function test_Pause() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(council1);
        treasury.pause();

        vm.prank(operator);
        vm.expectRevert();
        treasury.updateState("QmTest", bytes32(0));
    }

    function test_Unpause() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(council1);
        treasury.pause();

        vm.prank(council1);
        treasury.unpause();

        vm.prank(operator);
        treasury.updateState("QmTest", keccak256("data"));
    }

    // =========================================================================
    // View Function Tests
    // =========================================================================

    function test_GetGameState() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(operator);
        treasury.updateState("QmTest", keccak256("data"));

        (string memory cid, bytes32 stateHash, uint256 version, uint256 keyVer, uint256 lastBeat, bool active) =
            treasury.getGameState();

        assertEq(cid, "QmTest");
        assertEq(stateHash, keccak256("data"));
        assertEq(version, 1);
        assertEq(keyVer, 1);
        assertTrue(active);
        assertGt(lastBeat, 0);
    }

    function test_GetOperatorInfo() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        (address op, bytes memory att, uint256 registeredAt, bool active) = treasury.getOperatorInfo();

        assertEq(op, operator);
        assertEq(att, attestation);
        assertGt(registeredAt, 0);
        assertTrue(active);
    }

    function test_GetWithdrawalInfo() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(operator);
        treasury.withdraw(3 ether);

        (uint256 limit, uint256 used, uint256 remaining) = treasury.getWithdrawalInfo();

        assertEq(limit, dailyLimit);
        assertEq(used, 3 ether);
        assertEq(remaining, dailyLimit - 3 ether);
    }

    function test_IsTakeoverAvailable() public {
        // No operator - should be available
        assertTrue(treasury.isTakeoverAvailable());

        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Active operator - not available
        assertFalse(treasury.isTakeoverAvailable());

        // Past timeout (1 hour) but not cooldown (2 hours) - not available
        vm.warp(block.timestamp + 90 minutes);
        assertFalse(treasury.isTakeoverAvailable());

        // Past timeout + cooldown (3 hours total) - available
        vm.warp(block.timestamp + 2 hours);
        assertTrue(treasury.isTakeoverAvailable());
    }

    // =========================================================================
    // IGameTreasury Interface Tests
    // =========================================================================

    function test_GetBalance() public view {
        assertEq(treasury.getBalance(), 100 ether);
    }

    function test_GetBalanceAfterDeposit() public {
        vm.deal(address(this), 5 ether);
        treasury.deposit{value: 5 ether}();
        assertEq(treasury.getBalance(), 105 ether);
    }

    function test_GetBalanceAfterWithdraw() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(operator);
        treasury.withdraw(5 ether);

        assertEq(treasury.getBalance(), 95 ether);
    }

    // =========================================================================
    // Boundary Condition Tests
    // =========================================================================

    function test_WithdrawExactDailyLimit() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(operator);
        treasury.withdraw(dailyLimit);

        (, uint256 used, uint256 remaining) = treasury.getWithdrawalInfo();
        assertEq(used, dailyLimit);
        assertEq(remaining, 0);
    }

    function test_WithdrawOneWeiOverLimit() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(operator);
        vm.expectRevert("Exceeds daily limit");
        treasury.withdraw(dailyLimit + 1);
    }

    function test_WithdrawZeroAmount() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(operator);
        vm.expectRevert("Amount must be positive");
        treasury.withdraw(0);
    }

    function test_WithdrawAllTreasuryBalance() public {
        vm.prank(admin);
        treasury.setDailyLimit(200 ether);

        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(operator);
        treasury.withdraw(100 ether);

        assertEq(treasury.getBalance(), 0);
    }

    function test_HeartbeatExactlyAtTimeout() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Warp to exactly heartbeat timeout (1 hour)
        vm.warp(block.timestamp + 1 hours);

        // At exactly 1 hour, operator is still considered active (boundary is exclusive)
        assertTrue(treasury.isOperatorActive());

        // One second later, inactive
        vm.warp(block.timestamp + 1);
        assertFalse(treasury.isOperatorActive());
    }

    function test_HeartbeatJustBeforeTimeout() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Warp to just before timeout
        vm.warp(block.timestamp + 1 hours - 1);

        assertTrue(treasury.isOperatorActive());
    }

    // =========================================================================
    // Multiple Takeover Scenarios
    // =========================================================================

    function test_MultipleTakeovers() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // First takeover after timeout (4 hours from start)
        uint256 time1 = block.timestamp + 4 hours;
        vm.warp(time1);
        vm.prank(newOperator);
        treasury.takeoverAsOperator(attestation);
        assertEq(treasury.operator(), newOperator);
        assertTrue(treasury.isOperatorActive()); // New operator is active

        // Second takeover by another operator after new operator times out
        // Note: Takeover resets the heartbeat, so need full timeout again
        uint256 time2 = time1 + 4 hours; // 8 hours from start
        address thirdOperator = address(0x100);
        vm.warp(time2);
        assertFalse(treasury.isOperatorActive()); // newOperator timed out
        vm.prank(thirdOperator);
        treasury.takeoverAsOperator(attestation);
        assertEq(treasury.operator(), thirdOperator);
    }

    function test_TakeoverPreservesDailyUsage() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Withdraw some amount
        vm.prank(operator);
        treasury.withdraw(5 ether);

        // Takeover
        vm.warp(block.timestamp + 4 hours);
        vm.prank(newOperator);
        treasury.takeoverAsOperator(attestation);

        // Daily usage is preserved (per-contract, not per-operator)
        (uint256 limit, uint256 used,) = treasury.getWithdrawalInfo();
        assertEq(used, 5 ether);

        // New operator can still withdraw remaining allowance
        vm.prank(newOperator);
        treasury.withdraw(limit - 5 ether);
    }

    // =========================================================================
    // State Update Edge Cases
    // =========================================================================

    function test_UpdateStateWithEmptyCID() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.prank(operator);
        treasury.updateState("", bytes32(0));

        assertEq(treasury.currentStateCID(), "");
    }

    function test_UpdateStateMultipleTimes() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        vm.startPrank(operator);
        treasury.updateState("QmV1", keccak256("v1"));
        treasury.updateState("QmV2", keccak256("v2"));
        treasury.updateState("QmV3", keccak256("v3"));
        vm.stopPrank();

        assertEq(treasury.stateVersion(), 3);
        assertEq(treasury.currentStateCID(), "QmV3");
    }

    // =========================================================================
    // Council Management Edge Cases
    // =========================================================================

    function test_RemoveCouncilMember() public {
        vm.prank(admin);
        treasury.removeCouncilMember(council3);

        vm.prank(council3);
        vm.expectRevert();
        treasury.registerOperator(newOperator, attestation);
    }

    function test_AddAndRemoveSameCouncilMember() public {
        address newCouncil = address(0x200);

        vm.startPrank(admin);
        treasury.addCouncilMember(newCouncil);
        treasury.removeCouncilMember(newCouncil);
        vm.stopPrank();

        vm.prank(newCouncil);
        vm.expectRevert();
        treasury.registerOperator(operator, attestation);
    }

    // =========================================================================
    // Reentrancy Protection Tests
    // =========================================================================

    function test_WithdrawNoReentrancy() public {
        vm.prank(council1);
        treasury.registerOperator(operator, attestation);

        // Multiple sequential withdrawals should work
        vm.startPrank(operator);
        treasury.withdraw(1 ether);
        treasury.withdraw(1 ether);
        treasury.withdraw(1 ether);
        vm.stopPrank();

        (, uint256 used,) = treasury.getWithdrawalInfo();
        assertEq(used, 3 ether);
    }
}
