// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {VRFCoordinatorV2_5, VRFConsumerBaseV2_5} from "../../src/chainlink/VRFCoordinatorV2_5.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockVRFConsumer is VRFConsumerBaseV2_5 {
    uint256[] public randomWords;
    uint256 public requestId;
    bool public fulfilled;

    constructor(address coordinator) VRFConsumerBaseV2_5(coordinator) {}

    function requestRandomness(
        bytes32 keyHash,
        uint64 subId,
        uint16 confirmations,
        uint32 callbackGas,
        uint32 numWords
    ) external returns (uint256) {
        requestId = VRFCoordinatorV2_5(msg.sender).requestRandomWords(
            keyHash,
            subId,
            confirmations,
            callbackGas,
            numWords,
            ""
        );
        return requestId;
    }

    function fulfillRandomWords(uint256 _requestId, uint256[] memory _randomWords) internal override {
        requestId = _requestId;
        randomWords = _randomWords;
        fulfilled = true;
    }

    function getRandomWords() external view returns (uint256[] memory) {
        return randomWords;
    }
}

contract VRFCoordinatorTest is Test {
    VRFCoordinatorV2_5 public coordinator;
    MockVRFConsumer public consumer;

    address public owner = address(0x1001);
    address public user = address(0x1002);
    address public oracle = address(0x1003);
    address public governance = address(0x1004);

    bytes32 public keyHash = keccak256("test-key");

    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy coordinator with zero addresses for LINK (native payment only)
        coordinator = new VRFCoordinatorV2_5(
            address(0),  // LINK token
            address(0),  // LINK/ETH feed
            governance
        );

        // Register proving key and oracle (with timelock)
        bytes32 changeId = coordinator.proposeRegisterProvingKey(keyHash, oracle);
        vm.warp(block.timestamp + 24 hours + 1);
        coordinator.executeRegisterProvingKey(changeId);
        
        vm.stopPrank();

        // Deploy consumer
        vm.prank(user);
        consumer = new MockVRFConsumer(address(coordinator));
    }

    function test_CreateSubscription() public {
        vm.prank(user);
        uint64 subId = coordinator.createSubscription();
        
        assertEq(subId, 1);
        
        (,,, address subOwner,) = coordinator.getSubscription(subId);
        assertEq(subOwner, user);
    }

    function test_FundSubscriptionNative() public {
        // Create subscription
        vm.prank(user);
        uint64 subId = coordinator.createSubscription();

        // Fund with native token
        vm.deal(user, 1 ether);
        vm.prank(user);
        coordinator.fundSubscriptionNative{value: 0.5 ether}(subId);

        (, uint96 nativeBalance,,,) = coordinator.getSubscription(subId);
        assertEq(nativeBalance, 0.5 ether);
    }

    function test_AddConsumer() public {
        vm.startPrank(user);
        uint64 subId = coordinator.createSubscription();
        coordinator.addConsumer(subId, address(consumer));
        vm.stopPrank();

        (,,,, address[] memory consumers) = coordinator.getSubscription(subId);
        assertEq(consumers.length, 1);
        assertEq(consumers[0], address(consumer));
    }

    function test_RequestRandomWords() public {
        // Setup subscription
        vm.startPrank(user);
        uint64 subId = coordinator.createSubscription();
        vm.deal(user, 1 ether);
        coordinator.fundSubscriptionNative{value: 1 ether}(subId);
        coordinator.addConsumer(subId, address(consumer));
        vm.stopPrank();

        // Request random words
        vm.prank(address(consumer));
        uint256 requestId = coordinator.requestRandomWords(
            keyHash,
            subId,
            3,      // confirmations
            100000, // callback gas
            1,      // num words
            ""
        );

        assertGt(requestId, 0);
        
        // Check pending request exists
        assertTrue(coordinator.pendingRequestExists(subId));
    }

    function test_FulfillRandomWords() public {
        // Setup subscription
        vm.startPrank(user);
        uint64 subId = coordinator.createSubscription();
        vm.deal(user, 1 ether);
        coordinator.fundSubscriptionNative{value: 1 ether}(subId);
        coordinator.addConsumer(subId, address(consumer));
        vm.stopPrank();

        // Request random words
        vm.prank(address(consumer));
        uint256 requestId = coordinator.requestRandomWords(
            keyHash,
            subId,
            3,
            100000,
            1,
            ""
        );

        // Oracle fulfills
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = 12345;

        vm.prank(oracle);
        coordinator.fulfillRandomWords(requestId, randomWords, address(consumer));

        // Verify consumer received callback
        assertTrue(consumer.fulfilled());
        assertEq(consumer.getRandomWords()[0], 12345);
    }

    function test_CancelSubscription() public {
        vm.startPrank(user);
        uint64 subId = coordinator.createSubscription();
        vm.deal(user, 1 ether);
        coordinator.fundSubscriptionNative{value: 0.5 ether}(subId);
        
        uint256 balanceBefore = user.balance;
        coordinator.cancelSubscription(subId, user);
        uint256 balanceAfter = user.balance;
        
        assertEq(balanceAfter - balanceBefore, 0.5 ether);
        vm.stopPrank();
    }

    function test_SetConfig() public {
        VRFCoordinatorV2_5.FeeConfig memory feeConfig = VRFCoordinatorV2_5.FeeConfig({
            fulfillmentFlatFeeLinkPPM: 100000,
            fulfillmentFlatFeeNativePPM: 100000,
            premiumPercentage: 5,
            nativePremiumPercentage: 5
        });

        vm.prank(governance);
        coordinator.setConfig(5, 3000000, feeConfig);

        assertEq(coordinator.minimumRequestConfirmations(), 5);
        assertEq(coordinator.maxGasLimit(), 3000000);
    }

    function test_RevertWhen_NonOracleCantFulfill() public {
        // Setup subscription and request
        vm.startPrank(user);
        uint64 subId = coordinator.createSubscription();
        vm.deal(user, 1 ether);
        coordinator.fundSubscriptionNative{value: 1 ether}(subId);
        coordinator.addConsumer(subId, address(consumer));
        vm.stopPrank();

        vm.prank(address(consumer));
        uint256 requestId = coordinator.requestRandomWords(keyHash, subId, 3, 100000, 1, "");

        // Non-oracle tries to fulfill - should fail
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = 12345;

        vm.expectRevert();
        vm.prank(user);  // Not an oracle
        coordinator.fulfillRandomWords(requestId, randomWords, address(consumer));
    }
}

