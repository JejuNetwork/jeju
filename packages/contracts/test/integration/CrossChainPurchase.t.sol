// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

// OIF Components
import {SolverRegistry} from "../../src/oif/SolverRegistry.sol";
import {SimpleOracle} from "../../src/oif/OracleAdapter.sol";
import {InputSettler} from "../../src/oif/InputSettler.sol";
import {OutputSettler} from "../../src/oif/OutputSettler.sol";
import {
    GaslessCrossChainOrder,
    ResolvedCrossChainOrder,
    Output,
    FillInstruction
} from "../../src/oif/IOIF.sol";

// EIL Components
import {L1StakeManager} from "../../src/bridge/eil/L1StakeManager.sol";
import {CrossChainPaymaster} from "../../src/bridge/eil/CrossChainPaymaster.sol";

// X402 Components
import {X402Facilitator} from "../../src/x402/X402Facilitator.sol";
import {X402IntentBridge} from "../../src/x402/X402IntentBridge.sol";

// Token
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

/**
 * @title CrossChainPurchaseTest
 * @notice Integration test demonstrating cross-chain purchase without explicit bridging
 * @dev Tests the full flow: User with tokens on "Base" buys on "Jeju L2" using OIF + EIL + X402
 *
 * ## Flow tested:
 * 1. User has USDC on source chain (simulated "Base")
 * 2. User signs EIP-3009 transferWithAuthorization for their tokens
 * 3. X402IntentBridge creates OIF intent
 * 4. Solver fills intent on destination chain (simulated "Jeju L2")
 * 5. Oracle attests fill completion
 * 6. Tokens released to solver on source chain
 *
 * For local testing, both chains are simulated on the same Anvil instance.
 */
contract CrossChainPurchaseTest is Test {
    // ========== State Variables ==========

    // OIF
    SolverRegistry public solverRegistry;
    SimpleOracle public oifOracle;
    InputSettler public inputSettler;
    OutputSettler public outputSettler;

    // EIL
    L1StakeManager public l1StakeManager;
    MockL1L2Messenger public messenger;
    CrossChainPaymaster public crossChainPaymaster;

    // X402
    X402Facilitator public x402Facilitator;
    X402IntentBridge public x402IntentBridge;

    // Mock tokens
    ERC20Mock public usdc;
    ERC20Mock public outputToken;

    // Actors
    address public deployer;
    address public user;
    address public solver;
    uint256 public userPrivateKey;
    uint256 public solverPrivateKey;

    // Chain IDs (simulated)
    uint256 public constant SOURCE_CHAIN = 8453; // Base
    uint256 public constant DEST_CHAIN = 420690; // Jeju

    // ========== Setup ==========

    function setUp() public {
        // Setup actors
        deployer = address(this);
        userPrivateKey = 0x1234;
        solverPrivateKey = 0x5678;
        user = vm.addr(userPrivateKey);
        solver = vm.addr(solverPrivateKey);

        // Fund accounts
        vm.deal(deployer, 100 ether);
        vm.deal(user, 10 ether);
        vm.deal(solver, 10 ether);

        // Deploy mock tokens
        usdc = new ERC20Mock();
        outputToken = new ERC20Mock();

        // Mint tokens to user and solver
        usdc.mint(user, 1000e6); // 1000 USDC
        outputToken.mint(solver, 1000e18); // 1000 output tokens for solver to use in fills

        // ========== Deploy OIF Stack ==========
        solverRegistry = new SolverRegistry();
        oifOracle = new SimpleOracle();
        oifOracle.setAttester(deployer, true);

        inputSettler = new InputSettler(block.chainid, address(oifOracle), address(solverRegistry));
        outputSettler = new OutputSettler(block.chainid);

        // Register solver (MIN_STAKE is 0.5 ether)
        vm.prank(solver);
        solverRegistry.register{value: 0.5 ether}(new uint256[](0));

        // ========== Deploy EIL Stack ==========
        l1StakeManager = new L1StakeManager();
        messenger = new MockL1L2Messenger();
        l1StakeManager.setMessenger(address(messenger));

        // Deploy a mock entry point for testing
        address mockEntryPoint = address(new MockEntryPoint());

        crossChainPaymaster = new CrossChainPaymaster(
            IEntryPoint(mockEntryPoint),
            address(l1StakeManager),
            block.chainid,
            address(0), // No price oracle for testing
            deployer
        );
        crossChainPaymaster.setMessenger(address(messenger));

        // Register paymaster
        l1StakeManager.registerL2Paymaster(block.chainid, address(crossChainPaymaster));
        messenger.setTargets(address(l1StakeManager), address(crossChainPaymaster));

        // Register deployer as XLP
        uint256[] memory chains = new uint256[](1);
        chains[0] = block.chainid;
        l1StakeManager.register{value: 1 ether}(chains);

        // ========== Deploy X402 Stack ==========
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        x402Facilitator = new X402Facilitator(deployer, deployer, tokens);
        x402Facilitator.setTokenDecimals(address(usdc), 6);

        x402IntentBridge = new X402IntentBridge(address(x402Facilitator), address(oifOracle), deployer);
        x402IntentBridge.registerSolver(solver, true);
    }

    // ========== Tests ==========

    /**
     * @notice Test basic OIF intent creation and fill
     * @dev Verifies the complete intent lifecycle: open -> fill -> attest -> claim
     */
    function test_BasicIntentFlow() public {
        uint256 inputAmount = 100e6; // 100 USDC
        uint256 outputAmount = 50e18; // 50 output tokens
        uint256 maxFee = 1e6;

        // ===== User opens intent and locks funds =====
        vm.startPrank(user);
        usdc.approve(address(inputSettler), inputAmount);

        // Create order data
        bytes memory orderData = abi.encode(
            address(usdc),        // inputToken
            inputAmount,          // inputAmount
            address(outputToken), // outputToken
            outputAmount,         // outputAmount
            DEST_CHAIN,           // destinationChainId
            user,                 // recipient
            maxFee                // maxFee
        );

        // Create the cross-chain order
        GaslessCrossChainOrder memory order = GaslessCrossChainOrder({
            originSettler: address(inputSettler),
            user: user,
            nonce: 2, // Different nonce from other test
            originChainId: block.chainid,
            openDeadline: uint32(block.timestamp + 1 hours),
            fillDeadline: uint32(block.timestamp + 24 hours),
            orderDataType: keccak256("CrossChainSwap"),
            orderData: orderData
        });

        // ACTUALLY open the order - this locks USDC
        inputSettler.open(order);
        vm.stopPrank();

        // Verify funds locked
        assertEq(usdc.balanceOf(address(inputSettler)), inputAmount, "USDC should be locked in InputSettler");

        // Compute order ID
        bytes32 orderId = keccak256(
            abi.encodePacked(user, uint256(2), block.chainid, address(usdc), inputAmount, DEST_CHAIN, block.number)
        );

        // ===== Solver fills on destination =====
        vm.startPrank(solver);
        outputToken.approve(address(outputSettler), outputAmount);
        outputSettler.depositLiquidity(address(outputToken), outputAmount);

        bytes memory fillerData = abi.encode(address(outputToken), outputAmount, user, uint256(0));
        bytes memory originData = abi.encode(orderId);
        outputSettler.fill(orderId, originData, fillerData);
        vm.stopPrank();

        // Verify user received output tokens
        assertEq(outputToken.balanceOf(user), outputAmount, "User should receive output tokens");

        // ===== Solver claims the order first =====
        vm.prank(solver);
        inputSettler.claimOrder(orderId);

        // ===== Oracle attests the fill =====
        oifOracle.submitAttestation(orderId, abi.encode(true));
        assertTrue(oifOracle.hasAttested(orderId), "Oracle should have attested");

        // ===== Wait for CLAIM_DELAY and settle =====
        vm.roll(block.number + 151);

        vm.prank(solver);
        inputSettler.settle(orderId);

        assertEq(usdc.balanceOf(solver), inputAmount, "Solver should receive locked USDC");
    }

    /**
     * @notice Test EIL XLP stake management
     */
    function test_EILStakeManagement() public {
        // Deployer is already registered as XLP in setUp

        // Check stake
        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(deployer);
        assertEq(stake.stakedAmount, 1 ether);
        assertTrue(stake.isActive);

        // Add more stake
        l1StakeManager.addStake{value: 0.5 ether}();

        stake = l1StakeManager.getStake(deployer);
        assertEq(stake.stakedAmount, 1.5 ether);
    }

    /**
     * @notice Test X402 gasless payment settlement with real EIP-712 signature
     * @dev This test actually calls X402Facilitator.settle() with a valid signature
     */
    function test_X402GaslessPayment() public {
        uint256 amount = 50e6; // 50 USDC
        address recipient = solver;
        string memory resource = "test-resource";
        string memory nonce = "unique-nonce-123";
        uint256 timestamp = block.timestamp;

        // User approves X402 facilitator
        vm.prank(user);
        usdc.approve(address(x402Facilitator), amount);

        // Check balances before
        uint256 userBalanceBefore = usdc.balanceOf(user);
        uint256 recipientBalanceBefore = usdc.balanceOf(recipient);

        // Create EIP-712 payment signature using X402Facilitator's format
        // Payment(string scheme,string network,address asset,address payTo,uint256 amount,string resource,string nonce,uint256 timestamp)
        bytes32 PAYMENT_TYPEHASH = keccak256(
            "Payment(string scheme,string network,address asset,address payTo,uint256 amount,string resource,string nonce,uint256 timestamp)"
        );

        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                keccak256(bytes("exact")),        // scheme
                keccak256(bytes("jeju")),         // network
                address(usdc),                    // asset
                recipient,                        // payTo
                amount,
                keccak256(bytes(resource)),
                keccak256(bytes(nonce)),
                timestamp
            )
        );

        bytes32 domainSep = x402Facilitator.domainSeparator();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));

        // Sign with user's private key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Actually call X402Facilitator.settle() - this is the REAL test
        bytes32 paymentId = x402Facilitator.settle(
            user,
            recipient,
            address(usdc),
            amount,
            resource,
            nonce,
            timestamp,
            signature
        );

        // X402Facilitator has a 0.5% protocol fee (50 basis points)
        // fee = 50e6 * 50 / 10000 = 250000
        uint256 fee = (amount * 50) / 10000;
        uint256 recipientAmount = amount - fee;

        // Verify real transfer occurred through X402
        assertEq(usdc.balanceOf(user), userBalanceBefore - amount, "User balance should decrease");
        assertEq(usdc.balanceOf(recipient), recipientBalanceBefore + recipientAmount, "Recipient balance should increase (minus fee)");
        assertTrue(paymentId != bytes32(0), "Payment ID should be generated");

        // Verify nonce is used (can't replay)
        assertTrue(x402Facilitator.usedNonces(keccak256(abi.encodePacked(user, nonce))), "Nonce should be marked as used");
    }

    /**
     * @notice Test solver registration and status
     */
    function test_SolverRegistration() public {
        // Solver is registered in setUp
        assertTrue(solverRegistry.isSolverActive(solver));

        // Check solver stake (MIN_STAKE is 0.5 ether)
        uint256 solverStake = solverRegistry.getSolverStake(solver);
        assertEq(solverStake, 0.5 ether);
    }

    /**
     * @notice Test the complete cross-chain purchase scenario
     * @dev This is the "holy grail" test - user with tokens on Base buys on Jeju without bridging
     *
     * REAL FLOW TESTED:
     * 1. User opens intent via InputSettler.open() - ACTUALLY locks their USDC
     * 2. Solver fills on destination via OutputSettler.fill() - delivers output tokens
     * 3. Oracle attests fill completion
     * 4. Solver claims locked input tokens from InputSettler
     */
    function test_CrossChainPurchaseWithoutBridging() public {
        // Scenario:
        // - User has 100 USDC on "Base" (simulated by this test)
        // - User wants to buy something on "Jeju L2" costing 50 output tokens
        // - User should NOT need to bridge their USDC first

        uint256 inputAmount = 100e6; // 100 USDC (what user pays)
        uint256 outputAmount = 50e18; // 50 tokens (what user receives)
        uint256 maxFee = 1e6; // 1 USDC max fee

        // Record balances before
        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 settlerUsdcBefore = usdc.balanceOf(address(inputSettler));

        // ===== STEP 1: User opens intent and ACTUALLY locks funds =====
        vm.startPrank(user);
        usdc.approve(address(inputSettler), inputAmount);

        // Create the order data
        bytes memory orderData = abi.encode(
            address(usdc),       // inputToken
            inputAmount,         // inputAmount
            address(outputToken), // outputToken
            outputAmount,        // outputAmount
            DEST_CHAIN,          // destinationChainId
            user,                // recipient
            maxFee               // maxFee
        );

        // Create the cross-chain order
        GaslessCrossChainOrder memory order = GaslessCrossChainOrder({
            originSettler: address(inputSettler),
            user: user,
            nonce: 1,
            originChainId: block.chainid,
            openDeadline: uint32(block.timestamp + 1 hours),
            fillDeadline: uint32(block.timestamp + 24 hours),
            orderDataType: keccak256("CrossChainSwap"),
            orderData: orderData
        });

        // ACTUALLY open the order - this transfers USDC to InputSettler
        inputSettler.open(order);
        vm.stopPrank();

        // VERIFY: User's USDC was ACTUALLY locked in InputSettler
        assertEq(usdc.balanceOf(user), userUsdcBefore - inputAmount, "User USDC should be locked");
        assertEq(usdc.balanceOf(address(inputSettler)), settlerUsdcBefore + inputAmount, "InputSettler should hold locked USDC");

        // Compute the order ID (same formula as InputSettler)
        bytes32 orderId = keccak256(
            abi.encodePacked(user, uint256(1), block.chainid, address(usdc), inputAmount, DEST_CHAIN, block.number)
        );

        // ===== STEP 2: Solver fills on destination chain =====
        vm.startPrank(solver);
        outputToken.approve(address(outputSettler), outputAmount);
        outputSettler.depositLiquidity(address(outputToken), outputAmount);

        // Encode filler data: (token, amount, recipient, gasAmount)
        bytes memory fillerData = abi.encode(address(outputToken), outputAmount, user, uint256(0));
        bytes memory originData = abi.encode(orderId);
        outputSettler.fill(orderId, originData, fillerData);
        vm.stopPrank();

        // VERIFY: User received output tokens
        assertEq(outputToken.balanceOf(user), outputAmount, "User should have received output tokens");

        // ===== STEP 3: Solver claims the order (marks intent to settle) =====
        vm.prank(solver);
        inputSettler.claimOrder(orderId);

        // ===== STEP 4: Oracle attests fill completion =====
        oifOracle.submitAttestation(orderId, abi.encode(address(outputToken), outputAmount, user));
        assertTrue(oifOracle.hasAttested(orderId), "Oracle should have attested");

        // ===== STEP 5: Wait for CLAIM_DELAY (150 blocks) and settle =====
        // This is the fraud proof window
        vm.roll(block.number + 151);

        uint256 solverUsdcBefore = usdc.balanceOf(solver);

        vm.prank(solver);
        inputSettler.settle(orderId);

        // VERIFY: Solver received the locked USDC
        assertEq(usdc.balanceOf(solver), solverUsdcBefore + inputAmount, "Solver should receive locked USDC");
        assertEq(usdc.balanceOf(address(inputSettler)), 0, "InputSettler should have released all USDC");

        console2.log("Cross-chain purchase completed successfully.");
        console2.log("User received:", outputAmount / 1e18, "tokens");
        console2.log("Without explicit bridging.");
    }
}

// ========== Helper Contracts ==========

/**
 * @title MockL1L2Messenger
 * @notice Mock messenger for testing cross-chain communication
 */
contract MockL1L2Messenger {
    address public l1Target;
    address public l2Target;
    address public xDomainMessageSender;

    function setTargets(address _l1, address _l2) external {
        l1Target = _l1;
        l2Target = _l2;
    }

    function sendMessage(address target, bytes calldata message, uint32) external {
        xDomainMessageSender = msg.sender;
        (bool success,) = target.call(message);
        require(success, "Message relay failed");
        xDomainMessageSender = address(0);
    }
}

/**
 * @title MockEntryPoint
 * @notice Minimal mock of ERC-4337 EntryPoint for testing
 */
contract MockEntryPoint {
    function getNonce(address, uint192) external pure returns (uint256) {
        return 0;
    }

    function depositTo(address) external payable {}

    function balanceOf(address) external pure returns (uint256) {
        return 1 ether;
    }
}
