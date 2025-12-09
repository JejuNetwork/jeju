// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";

/**
 * @title DeployTest
 * @notice Basic test to verify Foundry setup works
 */
contract DeployTest is Test {
    function setUp() public {
        // Setup runs before each test
    }

    function testFoundrySetup() public pure {
        // Basic test to verify Foundry is working
        assert(true);
    }

    function testDeployerHasBalance() public {
        // Check deployer has ETH
        address deployer = address(this);
        vm.deal(deployer, 100 ether);
        assertEq(deployer.balance, 100 ether);
    }

    function testCanDeployContract() public {
        // Test contract deployment works
        TestContract test = new TestContract();
        assertEq(test.getValue(), 42);
    }
}

contract TestContract {
    function getValue() external pure returns (uint256) {
        return 42;
    }
}
