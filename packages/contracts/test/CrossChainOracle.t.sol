// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/oracle/PriceSource.sol";
import "../src/oracle/CrossChainPriceRelay.sol";
import "../src/oracle/ManualPriceOracle.sol";

contract CrossChainOracleTest is Test {
    PriceSource public priceSource;
    CrossChainPriceRelay public relay;
    ManualPriceOracle public oracle;

    address public owner = address(this);
    address public updater = address(0x1);
    address public elizaToken = address(0x2);

    // Mock CrossDomainMessenger
    MockCrossDomainMessenger public messenger;

    function setUp() public {
        // Deploy oracle with initial prices
        oracle = new ManualPriceOracle(
            324567000000, // Initial ETH price: $3,245.67
            8420000, // Initial elizaOS price: $0.0842
            owner
        );

        // Deploy mock messenger
        messenger = new MockCrossDomainMessenger();

        // Patch CrossChainPriceRelay to use our mock messenger
        // In real deployment, messenger is a predeploy at fixed address
        // For testing, we override the constant
        vm.etch(0x4200000000000000000000000000000000000007, address(messenger).code);

        // Deploy relay
        relay = new CrossChainPriceRelay(
            address(0), // Will set later
            address(oracle),
            owner
        );

        // Deploy price source
        priceSource = new PriceSource(elizaToken, address(relay), updater, owner);

        // Configure relay with price source
        relay.setPriceSource(address(priceSource));

        // Authorize relay to update oracle
        oracle.setPriceUpdater(address(relay));
    }

    function testRelayPriceUpdate() public {
        uint256 ethPrice = 324567000000; // $3,245.67
        uint256 elizaPrice = 8420000; // $0.0842

        // Simulate call from CrossDomainMessenger
        vm.prank(0x4200000000000000000000000000000000000007);
        vm.mockCall(
            0x4200000000000000000000000000000000000007,
            abi.encodeWithSelector(ICrossDomainMessenger.xDomainMessageSender.selector),
            abi.encode(address(priceSource))
        );

        relay.receivePriceUpdate(ethPrice, elizaPrice, block.timestamp);

        // Verify oracle was updated
        (uint256 storedEth, uint256 storedEliza,, bool fresh) = oracle.getPrices();

        assertEq(storedEth, ethPrice);
        assertEq(storedEliza, elizaPrice);
        assertTrue(fresh);
    }

    function testOnlyCrossDomainMessenger() public {
        uint256 ethPrice = 324567000000;
        uint256 elizaPrice = 8420000;

        // Try to call directly (should fail)
        vm.expectRevert(CrossChainPriceRelay.OnlyCrossChainMessenger.selector);
        relay.receivePriceUpdate(ethPrice, elizaPrice, block.timestamp);
    }

    function testOnlyAuthorizedSource() public {
        address unauthorizedSource = address(0x999);

        uint256 ethPrice = 324567000000;
        uint256 elizaPrice = 8420000;

        // Simulate call from CrossDomainMessenger with unauthorized sender
        vm.prank(0x4200000000000000000000000000000000000007);
        vm.mockCall(
            0x4200000000000000000000000000000000000007,
            abi.encodeWithSelector(ICrossDomainMessenger.xDomainMessageSender.selector),
            abi.encode(unauthorizedSource)
        );

        vm.expectRevert(CrossChainPriceRelay.InvalidCaller.selector);
        relay.receivePriceUpdate(ethPrice, elizaPrice, block.timestamp);
    }

    function testSetPriceSource() public {
        address newSource = address(0x888);

        relay.setPriceSource(newSource);

        (address storedSource,,,,,,) = relay.getRelayInfo();
        assertEq(storedSource, newSource);
    }
}

/**
 * @title MockCrossDomainMessenger
 * @notice Mock for testing cross-domain messages
 */
contract MockCrossDomainMessenger {
    address private _xDomainMessageSender;

    function xDomainMessageSender() external view returns (address) {
        return _xDomainMessageSender;
    }

    function relayMessage(address target, address sender, bytes memory message) external {
        _xDomainMessageSender = sender;
        (bool success, bytes memory returnData) = target.call(message);
        require(success, string(returnData));
        _xDomainMessageSender = address(0);
    }
}
