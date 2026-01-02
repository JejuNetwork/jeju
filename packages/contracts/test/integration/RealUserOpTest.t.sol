// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/interfaces/PackedUserOperation.sol";

/**
 * @title RealUserOpTest
 * @notice Tests ERC-4337 with REAL EntryPoint (not mock)
 * @dev Run with: forge test --match-contract RealUserOpTest --fork-url http://127.0.0.1:6546 -vvv
 *      These tests are skipped when not running with --fork-url
 */
contract RealUserOpTest is Test {
    // REAL deployed contracts on localnet
    IEntryPoint entryPoint = IEntryPoint(0x547382C0D1b23f707918D3c83A77317B71Aa8470);
    address paymaster = 0x7C8BaafA542c57fF9B2B90612bf8aB9E86e22C09;
    address user = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    uint256 userKey = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    modifier onlyFork() {
        // Skip if not forked - check if the EntryPoint has code
        if (address(entryPoint).code.length == 0) {
            vm.skip(true);
        }
        _;
    }

    function test_RealEntryPointNotMock() public onlyFork {
        console.log("=== Verifying REAL EntryPoint ===");

        // Create a dummy UserOperation
        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(500000) << 128 | uint256(500000)),
            preVerificationGas: 21000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData: abi.encodePacked(paymaster, uint128(100000), uint128(100000)),
            signature: ""
        });

        // Get the userOp hash - REAL EntryPoint returns non-zero hash
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        console.log("UserOp hash:");
        console.logBytes32(userOpHash);

        // CRITICAL: Mock returns 0, Real returns actual hash
        require(userOpHash != bytes32(0), "LARP DETECTED: Mock EntryPoint returns zero hash");

        console.log("SUCCESS: EntryPoint is REAL (not mock)");
    }

    function test_PaymasterFunded() public onlyFork {
        console.log("=== Verifying Paymaster Funding ===");

        uint256 deposit = entryPoint.balanceOf(paymaster);
        console.log("Paymaster deposit:", deposit / 1e18, "ETH");

        require(deposit >= 1 ether, "Paymaster needs at least 1 ETH deposit");
        console.log("SUCCESS: Paymaster is funded");
    }

    function test_SimulateHandleOps() public onlyFork {
        console.log("=== Simulating handleOps (bundler behavior) ===");

        // Note: This will revert because:
        // 1. The sender is not a smart contract wallet
        // 2. The signature is empty
        // BUT it proves the EntryPoint is real and processes the call

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(500000) << 128 | uint256(500000)),
            preVerificationGas: 21000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData: abi.encodePacked(paymaster, uint128(100000), uint128(100000)),
            signature: hex"00"
        });

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = userOp;

        // This should revert with a specific ERC-4337 error (not just silently succeed like mock)
        vm.expectRevert();
        entryPoint.handleOps(ops, payable(address(this)));

        console.log("SUCCESS: EntryPoint properly validates (reverts on invalid op)");
    }
}
