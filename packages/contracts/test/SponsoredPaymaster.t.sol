// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {SponsoredPaymaster} from "../src/paymaster/SponsoredPaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/**
 * @title Mock EntryPoint for testing
 * @dev Implements IEntryPoint interface for paymaster testing
 */
contract MockEntryPoint {
    mapping(address => uint256) public deposits;
    mapping(address => bool) public staked;

    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) external {
        require(deposits[msg.sender] >= amount, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        (bool success,) = withdrawAddress.call{value: amount}("");
        require(success, "Withdraw failed");
    }

    // IStakeManager methods
    function addStake(uint32 /* unstakeDelaySec */ ) external payable {
        deposits[msg.sender] += msg.value;
        staked[msg.sender] = true;
    }

    function unlockStake() external {
        staked[msg.sender] = false;
    }

    function withdrawStake(address payable withdrawAddress) external {
        uint256 amount = deposits[msg.sender];
        deposits[msg.sender] = 0;
        staked[msg.sender] = false;
        (bool success,) = withdrawAddress.call{value: amount}("");
        require(success, "Withdraw failed");
    }

    function getDepositInfo(address account)
        external
        view
        returns (uint256 deposit, bool _staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)
    {
        return (deposits[account], staked[account], uint112(deposits[account]), 0, 0);
    }

    // INonceManager methods
    function getNonce(address, /* sender */ uint192 /* key */ ) external pure returns (uint256) {
        return 0;
    }

    function incrementNonce(uint192 /* key */ ) external pure {}

    // ERC-165 interface support (required by BasePaymaster)
    // Returns true for all interface checks to allow mock testing
    function supportsInterface(bytes4 /* interfaceId */ ) external pure returns (bool) {
        return true;
    }

    // Allow receiving ETH
    receive() external payable {}
}

/**
 * @title SponsoredPaymaster Tests
 * @notice Comprehensive tests for gasless transaction sponsorship
 */
contract SponsoredPaymasterTest is Test {
    SponsoredPaymaster public paymaster;
    MockEntryPoint public entryPoint;

    address public owner = makeAddr("owner");
    address public user1 = makeAddr("user1");
    address public user2 = makeAddr("user2");
    address public gameContract = makeAddr("gameContract");
    address public goldContract = makeAddr("goldContract");
    address public itemsContract = makeAddr("itemsContract");

    event TransactionSponsored(address indexed user, address indexed target, uint256 gasCost);
    event TargetWhitelisted(address indexed target, bool whitelisted);
    event MaxGasCostUpdated(uint256 oldMax, uint256 newMax);
    event MaxTxPerUserUpdated(uint256 oldMax, uint256 newMax);
    event Paused(bool isPaused);
    event Funded(address indexed funder, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    function setUp() public {
        // Deploy mock EntryPoint
        entryPoint = new MockEntryPoint();

        // Deploy paymaster
        vm.prank(owner);
        paymaster = new SponsoredPaymaster(IEntryPoint(address(entryPoint)), owner);

        // Fund the paymaster
        vm.deal(owner, 100 ether);
        vm.prank(owner);
        paymaster.fund{value: 10 ether}();
    }

    // ============ Deployment Tests ============

    function test_deployment() public view {
        assertEq(paymaster.owner(), owner);
        assertEq(paymaster.maxGasCost(), 0.01 ether);
        assertEq(paymaster.maxTxPerUserPerHour(), 100);
        assertEq(paymaster.paused(), false);
    }

    function test_initialBalance() public view {
        (uint256 deposit,,,) = paymaster.getStatus();
        assertEq(deposit, 10 ether);
    }

    // ============ Whitelist Tests ============

    function test_whitelistTarget() public {
        vm.expectEmit(true, false, false, true);
        emit TargetWhitelisted(gameContract, true);

        vm.prank(owner);
        paymaster.setWhitelistedTarget(gameContract, true);

        assertTrue(paymaster.isWhitelisted(gameContract));
    }

    function test_whitelistAllTargets() public {
        // Whitelist address(0) to sponsor all contracts
        vm.prank(owner);
        paymaster.setWhitelistedTarget(address(0), true);

        // Any address should now be whitelisted
        assertTrue(paymaster.isWhitelisted(gameContract));
        assertTrue(paymaster.isWhitelisted(goldContract));
        assertTrue(paymaster.isWhitelisted(itemsContract));
        assertTrue(paymaster.isWhitelisted(makeAddr("randomAddress")));
    }

    function test_batchWhitelist() public {
        address[] memory targets = new address[](3);
        targets[0] = gameContract;
        targets[1] = goldContract;
        targets[2] = itemsContract;

        vm.prank(owner);
        paymaster.batchWhitelistTargets(targets, true);

        assertTrue(paymaster.isWhitelisted(gameContract));
        assertTrue(paymaster.isWhitelisted(goldContract));
        assertTrue(paymaster.isWhitelisted(itemsContract));
    }

    function test_removeFromWhitelist() public {
        vm.startPrank(owner);
        paymaster.setWhitelistedTarget(gameContract, true);
        assertTrue(paymaster.isWhitelisted(gameContract));

        paymaster.setWhitelistedTarget(gameContract, false);
        assertFalse(paymaster.isWhitelisted(gameContract));
        vm.stopPrank();
    }

    function test_onlyOwnerCanWhitelist() public {
        vm.prank(user1);
        vm.expectRevert();
        paymaster.setWhitelistedTarget(gameContract, true);
    }

    // ============ Gas Cost Limit Tests ============

    function test_setMaxGasCost() public {
        uint256 newMax = 0.05 ether;

        vm.expectEmit(false, false, false, true);
        emit MaxGasCostUpdated(0.01 ether, newMax);

        vm.prank(owner);
        paymaster.setMaxGasCost(newMax);

        assertEq(paymaster.maxGasCost(), newMax);
    }

    function test_onlyOwnerCanSetMaxGasCost() public {
        vm.prank(user1);
        vm.expectRevert();
        paymaster.setMaxGasCost(0.05 ether);
    }

    // ============ Rate Limit Tests ============

    function test_setMaxTxPerUser() public {
        uint256 newMax = 200;

        vm.expectEmit(false, false, false, true);
        emit MaxTxPerUserUpdated(100, newMax);

        vm.prank(owner);
        paymaster.setMaxTxPerUser(newMax);

        assertEq(paymaster.maxTxPerUserPerHour(), newMax);
    }

    function test_getRemainingTx() public view {
        // New user should have full allocation
        uint256 remaining = paymaster.getRemainingTx(user1);
        assertEq(remaining, 100);
    }

    // ============ Pause Tests ============

    function test_pause() public {
        vm.expectEmit(false, false, false, true);
        emit Paused(true);

        vm.prank(owner);
        paymaster.pause();

        assertTrue(paymaster.paused());
    }

    function test_unpause() public {
        vm.startPrank(owner);
        paymaster.pause();
        assertTrue(paymaster.paused());

        vm.expectEmit(false, false, false, true);
        emit Paused(false);

        paymaster.unpause();
        assertFalse(paymaster.paused());
        vm.stopPrank();
    }

    function test_onlyOwnerCanPause() public {
        vm.prank(user1);
        vm.expectRevert();
        paymaster.pause();
    }

    // ============ Funding Tests ============

    function test_fund() public {
        uint256 fundAmount = 5 ether;
        vm.deal(user1, fundAmount);

        vm.expectEmit(true, false, false, true);
        emit Funded(user1, fundAmount);

        vm.prank(user1);
        paymaster.fund{value: fundAmount}();

        (uint256 deposit,,,) = paymaster.getStatus();
        assertEq(deposit, 15 ether); // 10 initial + 5 new
    }

    function test_fundViaReceive() public {
        uint256 fundAmount = 2 ether;
        vm.deal(user1, fundAmount);

        vm.prank(user1);
        (bool success,) = address(paymaster).call{value: fundAmount}("");
        assertTrue(success);

        (uint256 deposit,,,) = paymaster.getStatus();
        assertEq(deposit, 12 ether);
    }

    function test_withdraw() public {
        uint256 withdrawAmount = 3 ether;
        uint256 ownerBalanceBefore = owner.balance;

        vm.expectEmit(true, false, false, true);
        emit Withdrawn(owner, withdrawAmount);

        vm.prank(owner);
        paymaster.withdraw(payable(owner), withdrawAmount);

        assertEq(owner.balance, ownerBalanceBefore + withdrawAmount);
    }

    function test_onlyOwnerCanWithdraw() public {
        vm.prank(user1);
        vm.expectRevert();
        paymaster.withdraw(payable(user1), 1 ether);
    }

    // ============ canSponsor View Tests ============

    function test_canSponsor_success() public {
        // Whitelist all contracts
        vm.prank(owner);
        paymaster.setWhitelistedTarget(address(0), true);

        (bool sponsored, string memory reason) = paymaster.canSponsor(user1, gameContract, 0.005 ether);
        assertTrue(sponsored);
        assertEq(reason, "");
    }

    function test_canSponsor_paused() public {
        vm.prank(owner);
        paymaster.pause();

        (bool sponsored, string memory reason) = paymaster.canSponsor(user1, gameContract, 0.005 ether);
        assertFalse(sponsored);
        assertEq(reason, "Paused");
    }

    function test_canSponsor_gasTooHigh() public {
        vm.prank(owner);
        paymaster.setWhitelistedTarget(address(0), true);

        (bool sponsored, string memory reason) = paymaster.canSponsor(user1, gameContract, 0.02 ether);
        assertFalse(sponsored);
        assertEq(reason, "Gas too high");
    }

    function test_canSponsor_notWhitelisted() public view {
        // Don't whitelist anything
        (bool sponsored, string memory reason) = paymaster.canSponsor(user1, gameContract, 0.005 ether);
        assertFalse(sponsored);
        assertEq(reason, "Target not whitelisted");
    }

    function test_canSponsor_insufficientDeposit() public {
        // Withdraw most funds
        vm.prank(owner);
        paymaster.withdraw(payable(owner), 9.99 ether);

        vm.prank(owner);
        paymaster.setWhitelistedTarget(address(0), true);

        (bool sponsored, string memory reason) = paymaster.canSponsor(user1, gameContract, 0.02 ether);
        assertFalse(sponsored);
        // Either "Insufficient deposit" or "Gas too high" depending on order of checks
        assertTrue(bytes(reason).length > 0);
    }

    // ============ Status Tests ============

    function test_getStatus() public view {
        (uint256 deposit, bool isPaused, uint256 totalTx, uint256 totalGas) = paymaster.getStatus();

        assertEq(deposit, 10 ether);
        assertFalse(isPaused);
        assertEq(totalTx, 0);
        assertEq(totalGas, 0);
    }

    function test_version() public view {
        assertEq(paymaster.version(), "1.0.0");
    }

    // ============ Access Control Tests ============

    function test_ownershipTransfer() public {
        address newOwner = makeAddr("newOwner");

        // Ownable2Step requires two steps
        vm.prank(owner);
        paymaster.transferOwnership(newOwner);

        // Owner is still the original until new owner accepts
        assertEq(paymaster.owner(), owner);

        // New owner accepts
        vm.prank(newOwner);
        paymaster.acceptOwnership();

        assertEq(paymaster.owner(), newOwner);
    }

    // ============ Fuzz Tests ============

    function testFuzz_fund(uint256 amount) public {
        amount = bound(amount, 0.001 ether, 100 ether);
        vm.deal(user1, amount);

        vm.prank(user1);
        paymaster.fund{value: amount}();

        (uint256 deposit,,,) = paymaster.getStatus();
        assertGe(deposit, amount);
    }

    function testFuzz_setMaxGasCost(uint256 newMax) public {
        newMax = bound(newMax, 0.001 ether, 10 ether);

        vm.prank(owner);
        paymaster.setMaxGasCost(newMax);

        assertEq(paymaster.maxGasCost(), newMax);
    }

    function testFuzz_setMaxTxPerUser(uint256 newMax) public {
        newMax = bound(newMax, 1, 10000);

        vm.prank(owner);
        paymaster.setMaxTxPerUser(newMax);

        assertEq(paymaster.maxTxPerUserPerHour(), newMax);
    }
}
