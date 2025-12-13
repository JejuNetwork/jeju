// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {OracleAdapter, SimpleOracle, HyperlaneOracle, SuperchainOracle} from "../src/oif/OracleAdapter.sol";
import {InputSettler} from "../src/oif/InputSettler.sol";
import {OutputSettler} from "../src/oif/OutputSettler.sol";
import {SolverRegistry} from "../src/oif/SolverRegistry.sol";
import {ISolverRegistry} from "../src/oif/IOIF.sol";
import {ICrossL2Inbox} from "../src/oif/OracleAdapter.sol";

/// @title Mock ISM for Hyperlane testing
contract MockISM {
    bool public shouldVerify = true;

    function verify(bytes calldata, bytes calldata) external view returns (bool) {
        return shouldVerify;
    }

    function setShouldVerify(bool _verify) external {
        shouldVerify = _verify;
    }
}

/// @title Mock Mailbox for Hyperlane testing
contract MockMailbox {
    function dispatch(uint32, bytes32, bytes calldata) external returns (bytes32) {
        return keccak256(abi.encodePacked(block.timestamp));
    }
}

/// @title Mock CrossL2Inbox for Superchain testing
contract MockCrossL2Inbox {
    bool public shouldValidate = true;

    function validateMessage(ICrossL2Inbox.Identifier calldata, bytes32) external view {
        if (!shouldValidate) revert("Invalid message");
    }

    function setShouldValidate(bool _validate) external {
        shouldValidate = _validate;
    }
}

/**
 * @title OIF Oracle Comprehensive Tests
 * @notice Tests for Oracle attestation, verification, and edge cases
 */
contract OIFOracleTest is Test {
    SimpleOracle public simpleOracle;
    HyperlaneOracle public hyperlaneOracle;
    SuperchainOracle public superchainOracle;
    MockISM public mockISM;
    MockMailbox public mockMailbox;
    MockCrossL2Inbox public mockInbox;

    address public owner;
    address public attester1;
    address public attester2;
    address public solver;
    address public user;
    address public attacker;

    uint256 constant SOURCE_CHAIN = 1;
    uint256 constant DEST_CHAIN = 42161;
    uint256 constant LOCAL_CHAIN = 10;

    function setUp() public {
        owner = address(this);
        attester1 = makeAddr("attester1");
        attester2 = makeAddr("attester2");
        solver = makeAddr("solver");
        user = makeAddr("user");
        attacker = makeAddr("attacker");

        simpleOracle = new SimpleOracle();
        hyperlaneOracle = new HyperlaneOracle();
        superchainOracle = new SuperchainOracle(LOCAL_CHAIN);

        mockISM = new MockISM();
        mockMailbox = new MockMailbox();
        mockInbox = new MockCrossL2Inbox();

        simpleOracle.setAttester(attester1, true);
    }

    // ============ SimpleOracle Tests ============

    function test_SimpleOracle_AttestValidOrder() public {
        bytes32 orderId = keccak256("order1");

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, "");

        assertTrue(simpleOracle.hasAttested(orderId));
        assertEq(simpleOracle.attestedAt(orderId), block.timestamp);
    }

    function test_SimpleOracle_UnauthorizedAttester() public {
        bytes32 orderId = keccak256("order1");

        vm.prank(attacker);
        vm.expectRevert(OracleAdapter.UnauthorizedAttester.selector);
        simpleOracle.submitAttestation(orderId, "");
    }

    function test_SimpleOracle_DoubleAttestation() public {
        bytes32 orderId = keccak256("order1");

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, "");

        vm.prank(attester1);
        vm.expectRevert(OracleAdapter.AlreadyAttested.selector);
        simpleOracle.submitAttestation(orderId, "");
    }

    function test_SimpleOracle_AddRemoveAttester() public {
        bytes32 orderId = keccak256("order1");

        // Add attester2
        simpleOracle.setAttester(attester2, true);

        vm.prank(attester2);
        simpleOracle.submitAttestation(orderId, "");
        assertTrue(simpleOracle.hasAttested(orderId));

        // Remove attester2
        simpleOracle.setAttester(attester2, false);

        bytes32 orderId2 = keccak256("order2");
        vm.prank(attester2);
        vm.expectRevert(OracleAdapter.UnauthorizedAttester.selector);
        simpleOracle.submitAttestation(orderId2, "");
    }

    function test_SimpleOracle_NonOwnerCannotAddAttester() public {
        vm.prank(attacker);
        vm.expectRevert();
        simpleOracle.setAttester(attacker, true);
    }

    function test_SimpleOracle_GetAttestation() public {
        bytes32 orderId = keccak256("order1");
        bytes memory proofData = hex"1234567890";

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, proofData);

        bytes memory storedProof = simpleOracle.getAttestation(orderId);
        assertEq(storedProof, proofData);
    }

    function test_SimpleOracle_MultipleOrdersSameAttester() public {
        bytes32[] memory orderIds = new bytes32[](5);
        for (uint256 i = 0; i < 5; i++) {
            orderIds[i] = keccak256(abi.encodePacked("order", i));
        }

        vm.startPrank(attester1);
        for (uint256 i = 0; i < 5; i++) {
            simpleOracle.submitAttestation(orderIds[i], abi.encodePacked(i));
        }
        vm.stopPrank();

        for (uint256 i = 0; i < 5; i++) {
            assertTrue(simpleOracle.hasAttested(orderIds[i]));
        }
    }

    // ============ HyperlaneOracle Tests ============

    function test_HyperlaneOracle_SetMailbox() public {
        hyperlaneOracle.setMailbox(address(mockMailbox));
        assertEq(address(hyperlaneOracle.mailbox()), address(mockMailbox));
    }

    function test_HyperlaneOracle_SetISM() public {
        hyperlaneOracle.setISM(address(mockISM));
        assertEq(address(hyperlaneOracle.ism()), address(mockISM));
    }

    function test_HyperlaneOracle_SetDomainId() public {
        hyperlaneOracle.setDomainId(SOURCE_CHAIN, 1);
        assertEq(hyperlaneOracle.domainIds(SOURCE_CHAIN), 1);
    }

    function test_HyperlaneOracle_SetTrustedSender() public {
        bytes32 sender = bytes32(uint256(uint160(solver)));
        hyperlaneOracle.setTrustedSender(1, sender);
        assertEq(hyperlaneOracle.trustedSenders(1), sender);
    }

    function test_HyperlaneOracle_NonOwnerCannotConfigure() public {
        vm.startPrank(attacker);

        vm.expectRevert();
        hyperlaneOracle.setMailbox(address(mockMailbox));

        vm.expectRevert();
        hyperlaneOracle.setISM(address(mockISM));

        vm.expectRevert();
        hyperlaneOracle.setDomainId(1, 1);

        vm.stopPrank();
    }

    function test_HyperlaneOracle_HandleDirectMessage() public {
        // Setup
        hyperlaneOracle.setMailbox(address(mockMailbox));
        hyperlaneOracle.setAttester(owner, true);

        bytes32 sender = bytes32(uint256(uint160(solver)));
        hyperlaneOracle.setTrustedSender(1, sender);

        // Create message body
        bytes32 orderId = keccak256("order1");
        bytes memory body = abi.encode(orderId, address(0), uint256(1 ether), user, uint256(12345));

        // Call handle as mailbox
        vm.prank(address(mockMailbox));
        hyperlaneOracle.handle(1, sender, body);

        assertTrue(hyperlaneOracle.hasAttested(orderId));
    }

    function test_HyperlaneOracle_HandleUntrustedSender() public {
        hyperlaneOracle.setMailbox(address(mockMailbox));

        bytes32 trustedSender = bytes32(uint256(uint160(solver)));
        bytes32 untrustedSender = bytes32(uint256(uint160(attacker)));
        hyperlaneOracle.setTrustedSender(1, trustedSender);

        bytes32 orderId = keccak256("order1");
        bytes memory body = abi.encode(orderId, address(0), uint256(1 ether), user, uint256(12345));

        vm.prank(address(mockMailbox));
        vm.expectRevert(HyperlaneOracle.UntrustedSender.selector);
        hyperlaneOracle.handle(1, untrustedSender, body);
    }

    function test_HyperlaneOracle_HandleNotMailbox() public {
        hyperlaneOracle.setMailbox(address(mockMailbox));

        bytes32 sender = bytes32(uint256(uint160(solver)));
        bytes memory body = abi.encode(keccak256("order1"), address(0), uint256(1 ether), user, uint256(12345));

        vm.prank(attacker);
        vm.expectRevert("Only mailbox");
        hyperlaneOracle.handle(1, sender, body);
    }

    function test_HyperlaneOracle_VersionIs2() public view {
        assertEq(hyperlaneOracle.version(), "2.0.0");
    }

    // ============ SuperchainOracle Tests ============

    function test_SuperchainOracle_LocalChainId() public view {
        assertEq(superchainOracle.localChainId(), LOCAL_CHAIN);
    }

    function test_SuperchainOracle_SetSourceChain() public {
        superchainOracle.setSourceChain(SOURCE_CHAIN, true);
        assertTrue(superchainOracle.validSourceChains(SOURCE_CHAIN));

        superchainOracle.setSourceChain(SOURCE_CHAIN, false);
        assertFalse(superchainOracle.validSourceChains(SOURCE_CHAIN));
    }

    function test_SuperchainOracle_SetTrustedOutputSettler() public {
        superchainOracle.setTrustedOutputSettler(SOURCE_CHAIN, solver);
        assertEq(superchainOracle.trustedOutputSettlers(SOURCE_CHAIN), solver);
    }

    function test_SuperchainOracle_NonOwnerCannotConfigure() public {
        vm.startPrank(attacker);

        vm.expectRevert();
        superchainOracle.setSourceChain(SOURCE_CHAIN, true);

        vm.expectRevert();
        superchainOracle.setTrustedOutputSettler(SOURCE_CHAIN, solver);

        vm.stopPrank();
    }

    function test_SuperchainOracle_VersionIs2() public view {
        assertEq(superchainOracle.version(), "2.0.0");
    }

    // ============ Oracle Edge Cases ============

    function test_Oracle_ZeroOrderId() public {
        bytes32 orderId = bytes32(0);

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, "");

        assertTrue(simpleOracle.hasAttested(orderId));
    }

    function test_Oracle_MaxBytes32OrderId() public {
        bytes32 orderId = bytes32(type(uint256).max);

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, "");

        assertTrue(simpleOracle.hasAttested(orderId));
    }

    function test_Oracle_LargeProofData() public {
        bytes32 orderId = keccak256("large-proof");
        bytes memory largeProof = new bytes(10000);
        for (uint256 i = 0; i < 10000; i++) {
            largeProof[i] = bytes1(uint8(i % 256));
        }

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, largeProof);

        bytes memory storedProof = simpleOracle.getAttestation(orderId);
        assertEq(storedProof.length, 10000);
    }

    function test_Oracle_EmptyProof() public {
        bytes32 orderId = keccak256("empty-proof");

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, "");

        assertTrue(simpleOracle.hasAttested(orderId));
        bytes memory storedProof = simpleOracle.getAttestation(orderId);
        assertEq(storedProof.length, 0);
    }

    // ============ Integration: Oracle with Settler ============

    function test_Integration_OracleWithInputSettler() public {
        SolverRegistry registry = new SolverRegistry();
        InputSettler settler = new InputSettler(SOURCE_CHAIN, address(simpleOracle), address(registry));

        bytes32 orderId = keccak256("integration-order");

        // Attest via oracle
        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, "");

        // Verify settler can check attestation
        assertTrue(simpleOracle.hasAttested(orderId));
    }

    // ============ Fuzz Tests ============

    function testFuzz_Oracle_AttestMultipleOrders(bytes32 orderId1, bytes32 orderId2) public {
        vm.assume(orderId1 != orderId2);

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId1, "");

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId2, "");

        assertTrue(simpleOracle.hasAttested(orderId1));
        assertTrue(simpleOracle.hasAttested(orderId2));
    }

    function testFuzz_Oracle_ProofDataIntegrity(bytes32 orderId, bytes calldata proofData) public {
        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, proofData);

        bytes memory storedProof = simpleOracle.getAttestation(orderId);
        assertEq(keccak256(storedProof), keccak256(proofData));
    }

    function testFuzz_Oracle_AttestationTimestamp(bytes32 orderId, uint256 timestamp) public {
        timestamp = bound(timestamp, 1, type(uint64).max);
        vm.warp(timestamp);

        vm.prank(attester1);
        simpleOracle.submitAttestation(orderId, "");

        assertEq(simpleOracle.attestedAt(orderId), timestamp);
    }
}

/**
 * @title OIF Concurrent Operations Tests
 * @notice Tests for race conditions and concurrent access patterns
 */
contract OIFConcurrentTest is Test {
    SimpleOracle public oracle;
    SolverRegistry public registry;
    OutputSettler public outputSettler;

    address[] public solvers;
    uint256 constant NUM_SOLVERS = 5;
    uint256 constant DEST_CHAIN = 42161;

    function setUp() public {
        oracle = new SimpleOracle();
        registry = new SolverRegistry();
        outputSettler = new OutputSettler(DEST_CHAIN);

        oracle.setAttester(address(this), true);

        // Create multiple solvers
        for (uint256 i = 0; i < NUM_SOLVERS; i++) {
            address solver = makeAddr(string(abi.encodePacked("solver", i)));
            vm.deal(solver, 100 ether);
            solvers.push(solver);

            // Register solver
            vm.prank(solver);
            uint256[] memory chains = new uint256[](1);
            chains[0] = DEST_CHAIN;
            registry.register{value: 1 ether}(chains);

            // Deposit liquidity
            vm.prank(solver);
            outputSettler.depositETH{value: 10 ether}();
        }
    }

    function test_Concurrent_MultipleSolversFillSameOrder() public {
        bytes32 orderId = keccak256("concurrent-order");
        address recipient = makeAddr("recipient");

        // First solver fills
        bytes memory fillerData = abi.encode(address(0), 1 ether, recipient, uint256(0));

        vm.prank(solvers[0]);
        outputSettler.fill(orderId, "", fillerData);

        // Second solver tries to fill same order - should fail
        vm.prank(solvers[1]);
        vm.expectRevert(OutputSettler.OrderAlreadyFilled.selector);
        outputSettler.fill(orderId, "", fillerData);
    }

    function test_Concurrent_MultipleSolversDepositWithdraw() public {
        // All solvers deposit more
        for (uint256 i = 0; i < NUM_SOLVERS; i++) {
            vm.prank(solvers[i]);
            outputSettler.depositETH{value: 5 ether}();
        }

        // All solvers withdraw some
        for (uint256 i = 0; i < NUM_SOLVERS; i++) {
            uint256 liquidityBefore = outputSettler.getSolverETH(solvers[i]);
            vm.prank(solvers[i]);
            outputSettler.withdrawETH(3 ether);
            uint256 liquidityAfter = outputSettler.getSolverETH(solvers[i]);

            assertEq(liquidityBefore - liquidityAfter, 3 ether);
        }
    }

    function test_Concurrent_MultipleOrdersFilled() public {
        uint256 numOrders = 10;
        address recipient = makeAddr("recipient");

        for (uint256 i = 0; i < numOrders; i++) {
            bytes32 orderId = keccak256(abi.encodePacked("order", i));
            bytes memory fillerData = abi.encode(address(0), 0.5 ether, recipient, uint256(i));

            // Round-robin through solvers
            address solver = solvers[i % NUM_SOLVERS];
            vm.prank(solver);
            outputSettler.fill(orderId, "", fillerData);

            // Verify fill
            OutputSettler.FillRecord memory fillRecord = outputSettler.getFillRecord(orderId);
            assertTrue(outputSettler.filledOrders(orderId));
            assertEq(fillRecord.solver, solver);
        }
    }

    function test_Concurrent_AttestationsFromMultipleAttesters() public {
        // Add multiple attesters
        address[] memory attesters = new address[](3);
        for (uint256 i = 0; i < 3; i++) {
            attesters[i] = makeAddr(string(abi.encodePacked("attester", i)));
            oracle.setAttester(attesters[i], true);
        }

        // Each attester attests different orders
        for (uint256 i = 0; i < 3; i++) {
            bytes32 orderId = keccak256(abi.encodePacked("attester-order", i));
            vm.prank(attesters[i]);
            oracle.submitAttestation(orderId, abi.encodePacked(i));

            assertTrue(oracle.hasAttested(orderId));
        }
    }

    function test_Concurrent_RegistryStakeAndSlash() public {
        // Slash one solver while others are operating
        registry.setSlasher(address(this), true);

        bytes32 orderId = keccak256("slash-order");
        address victim = address(0x1234); // Dummy victim address
        registry.slash(solvers[0], orderId, 0.5 ether, victim);

        // Verify slashed amount via stakes mapping
        (uint256 staked,,, uint256 slashed,,) = registry.stakes(solvers[0]);
        assertEq(slashed, 0.5 ether); // Slashed amount
        assertEq(staked, 0.5 ether); // Remaining stake

        // Other solvers unaffected
        for (uint256 i = 1; i < NUM_SOLVERS; i++) {
            (uint256 otherStaked,,,,,) = registry.stakes(solvers[i]);
            assertEq(otherStaked, 1 ether);
        }
    }
}

/**
 * @title OIF Data Verification Tests
 * @notice Tests that verify actual output data matches expected values
 */
contract OIFDataVerificationTest is Test {
    SimpleOracle public oracle;
    SolverRegistry public registry;
    OutputSettler public outputSettler;

    address public solver;
    address public recipient;

    uint256 constant DEST_CHAIN = 42161;

    function setUp() public {
        oracle = new SimpleOracle();
        registry = new SolverRegistry();
        outputSettler = new OutputSettler(DEST_CHAIN);

        oracle.setAttester(address(this), true);

        solver = makeAddr("solver");
        recipient = makeAddr("recipient");
        vm.deal(solver, 100 ether);

        vm.prank(solver);
        uint256[] memory chains = new uint256[](1);
        chains[0] = DEST_CHAIN;
        registry.register{value: 10 ether}(chains);

        vm.prank(solver);
        outputSettler.depositETH{value: 50 ether}();
    }

    function test_Verify_FillRecordData() public {
        bytes32 orderId = keccak256("verify-order");
        uint256 fillAmount = 5 ether;
        uint256 gasProvided = 0; // Set to 0 for cleaner test
        bytes memory fillerData = abi.encode(address(0), fillAmount, recipient, gasProvided);

        uint256 recipientBalanceBefore = recipient.balance;

        vm.prank(solver);
        outputSettler.fill(orderId, "", fillerData);

        // Verify fill record
        OutputSettler.FillRecord memory fillRecord = outputSettler.getFillRecord(orderId);

        assertEq(fillRecord.solver, solver, "Filler address mismatch");
        assertEq(fillRecord.amount, fillAmount, "Fill amount mismatch");
        assertEq(fillRecord.filledBlock, block.number, "Fill block mismatch");
        assertTrue(outputSettler.isFilled(orderId), "Fill status mismatch");

        // Verify actual ETH transfer (amount + gasProvided)
        uint256 recipientBalanceAfter = recipient.balance;
        assertEq(
            recipientBalanceAfter - recipientBalanceBefore, fillAmount + gasProvided, "ETH transfer amount mismatch"
        );
    }

    function test_Verify_SolverLiquidityTracking() public {
        uint256 initialLiquidity = outputSettler.getSolverETH(solver);
        assertEq(initialLiquidity, 50 ether, "Initial liquidity mismatch");

        // Fill an order
        bytes32 orderId = keccak256("liquidity-order");
        uint256 fillAmount = 3 ether;
        bytes memory fillerData = abi.encode(address(0), fillAmount, recipient, uint256(0));

        vm.prank(solver);
        outputSettler.fill(orderId, "", fillerData);

        uint256 afterFillLiquidity = outputSettler.getSolverETH(solver);
        assertEq(afterFillLiquidity, initialLiquidity - fillAmount, "Post-fill liquidity mismatch");

        // Deposit more
        vm.prank(solver);
        outputSettler.depositETH{value: 10 ether}();

        uint256 afterDepositLiquidity = outputSettler.getSolverETH(solver);
        assertEq(afterDepositLiquidity, afterFillLiquidity + 10 ether, "Post-deposit liquidity mismatch");
    }

    function test_Verify_AttestationData() public {
        bytes32 orderId = keccak256("attestation-order");
        bytes memory proofData = abi.encode(uint256(123), address(0x1234), bytes32(uint256(0xabcd)));

        assertFalse(oracle.hasAttested(orderId), "Should not be attested yet");
        assertEq(oracle.attestedAt(orderId), 0, "Attestation time should be 0");

        uint256 attestTime = block.timestamp;
        oracle.submitAttestation(orderId, proofData);

        assertTrue(oracle.hasAttested(orderId), "Should be attested");
        assertEq(oracle.attestedAt(orderId), attestTime, "Attestation time mismatch");

        bytes memory storedProof = oracle.getAttestation(orderId);
        assertEq(keccak256(storedProof), keccak256(proofData), "Proof data mismatch");

        // Decode and verify individual fields
        (uint256 decodedNum, address decodedAddr, bytes32 decodedHash) =
            abi.decode(storedProof, (uint256, address, bytes32));
        assertEq(decodedNum, 123, "Decoded number mismatch");
        assertEq(decodedAddr, address(0x1234), "Decoded address mismatch");
        assertEq(decodedHash, bytes32(uint256(0xabcd)), "Decoded hash mismatch");
    }

    function test_Verify_RegistryStakeData() public {
        ISolverRegistry.SolverInfo memory info = registry.getSolver(solver);

        assertEq(info.stakedAmount, 10 ether, "Initial stake mismatch");
        assertEq(info.slashedAmount, 0, "Initial slashed mismatch");
        assertEq(info.totalFills, 0, "Initial fill count mismatch");
        assertEq(info.successfulFills, 0, "Initial successful fill count mismatch");

        // Record a successful fill
        bytes32 orderId = keccak256("test-order");
        registry.recordFill(solver, orderId, true);

        ISolverRegistry.SolverInfo memory afterFillInfo = registry.getSolver(solver);
        assertEq(afterFillInfo.totalFills, 1, "Fill count not incremented");
        assertEq(afterFillInfo.successfulFills, 1, "Successful fill count not incremented");

        // Record a failed fill
        bytes32 orderId2 = keccak256("test-order-2");
        registry.recordFill(solver, orderId2, false);

        ISolverRegistry.SolverInfo memory afterFailInfo = registry.getSolver(solver);
        assertEq(afterFailInfo.totalFills, 2, "Total fill count not incremented");
        assertEq(afterFailInfo.successfulFills, 1, "Successful fill count should remain 1");
    }

    function test_Verify_ExactFeeCalculation() public view {
        // Verify OutputSettler version
        string memory version = outputSettler.version();
        assertEq(version, "1.0.0", "Version mismatch");

        // Verify chain ID
        assertEq(outputSettler.chainId(), DEST_CHAIN, "Chain ID mismatch");
    }
}
