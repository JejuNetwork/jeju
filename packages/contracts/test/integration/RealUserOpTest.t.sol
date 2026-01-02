// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "account-abstraction/core/EntryPoint.sol";
import "account-abstraction/interfaces/PackedUserOperation.sol";
import {CrossChainPaymasterUpgradeable} from "../../src/bridge/eil/CrossChainPaymasterUpgradeable.sol";
import {ERC1967Proxy} from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title RealUserOpTest
 * @notice Tests ERC-4337 with REAL EntryPoint (not mock)
 * @dev These tests deploy fresh contracts to ensure proper coverage
 */
contract RealUserOpTest is Test {
    EntryPoint public entryPoint;
    CrossChainPaymasterUpgradeable public paymaster;
    
    address public owner = address(0x1);
    address public xlp = address(0x2);
    address public user = address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8);

    function setUp() public {
        vm.deal(owner, 100 ether);
        vm.deal(xlp, 100 ether);
        vm.deal(user, 10 ether);

        // Deploy REAL EntryPoint
        entryPoint = new EntryPoint();

        // Deploy CrossChainPaymasterUpgradeable via proxy
        CrossChainPaymasterUpgradeable impl = new CrossChainPaymasterUpgradeable();
        bytes memory initData = abi.encodeCall(
            CrossChainPaymasterUpgradeable.initialize,
            (owner, 1, address(0x123), address(entryPoint))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        paymaster = CrossChainPaymasterUpgradeable(payable(address(proxy)));

        // Setup paymaster with XLP stake
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        // XLP deposits ETH liquidity
        vm.prank(xlp);
        paymaster.depositETH{value: 5 ether}();

        // Fund paymaster in EntryPoint
        vm.prank(owner);
        paymaster.depositToEntryPoint{value: 2 ether}();
    }

    function test_RealEntryPointNotMock() public view {
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
            paymasterAndData: abi.encodePacked(address(paymaster), uint128(100000), uint128(100000), xlp),
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

    function test_PaymasterFunded() public view {
        console.log("=== Verifying Paymaster Funding ===");

        uint256 deposit = entryPoint.balanceOf(address(paymaster));
        console.log("Paymaster deposit:", deposit / 1e18, "ETH");

        require(deposit >= 1 ether, "Paymaster needs at least 1 ETH deposit");
        console.log("SUCCESS: Paymaster is funded");
    }

    function test_SimulateHandleOps() public {
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
            paymasterAndData: abi.encodePacked(address(paymaster), uint128(100000), uint128(100000), xlp),
            signature: hex"00"
        });

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = userOp;

        // This should revert with a specific ERC-4337 error (not just silently succeed like mock)
        vm.expectRevert();
        entryPoint.handleOps(ops, payable(address(this)));

        console.log("SUCCESS: EntryPoint properly validates (reverts on invalid op)");
    }

    function test_ValidPaymasterValidation() public {
        console.log("=== Testing Paymaster Validation ===");

        // Build a UserOp with XLP address in paymasterAndData
        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 21000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(2 gwei)),
            paymasterAndData: abi.encodePacked(
                address(paymaster),
                uint128(100000), // verificationGasLimit
                uint128(50000),  // postOpGasLimit  
                xlp              // XLP address
            ),
            signature: ""
        });

        // Get userOp hash
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        require(userOpHash != bytes32(0), "Invalid userOpHash");

        // Simulate validation by calling paymaster directly (as EntryPoint would)
        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(
            userOp,
            userOpHash,
            0.01 ether // maxCost
        );

        require(validationData == 0, "Validation should succeed");
        require(context.length > 0, "Context should not be empty");

        console.log("SUCCESS: Paymaster validation works");
    }

    function test_PaymasterPostOp() public {
        console.log("=== Testing Paymaster PostOp ===");

        // First, validate a userOp
        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 21000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(2 gwei)),
            paymasterAndData: abi.encodePacked(
                address(paymaster),
                uint128(100000),
                uint128(50000),
                xlp
            ),
            signature: ""
        });

        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);

        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(
            userOp,
            userOpHash,
            0.1 ether
        );

        // Track XLP balance before postOp
        uint256 balanceBefore = paymaster.xlpEthBalance(xlp);

        // Simulate postOp with lower actual cost (should refund)
        vm.prank(address(entryPoint));
        paymaster.postOp(
            IPaymaster.PostOpMode.opSucceeded,
            context,
            0.05 ether, // actualGasCost (less than maxCost)
            1 gwei
        );

        uint256 balanceAfter = paymaster.xlpEthBalance(xlp);

        // Should have refunded the difference
        require(balanceAfter > balanceBefore, "XLP should receive refund");
        console.log("Refund amount:", (balanceAfter - balanceBefore) / 1e18, "ETH");

        console.log("SUCCESS: PostOp refund works");
    }
}
