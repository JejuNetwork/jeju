// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../bridges/CrossChainBridge.sol";
import "../bridges/SolanaLightClient.sol";
import "../tokens/CrossChainToken.sol";
import "../interfaces/ISolanaLightClient.sol";
import "../interfaces/IGroth16Verifier.sol";
import "../interfaces/ICrossChainBridge.sol";

/**
 * @title CrossChainBridgeTest
 * @notice Foundry tests for the cross-chain bridge contracts
 */
contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    SolanaLightClient public lightClient;
    MockGroth16Verifier public verifier;
    CrossChainToken public testToken;

    address public admin;
    address public user;
    address public relayer;

    bytes32 public constant SOLANA_MINT = bytes32(uint256(1));
    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;
    uint256 public constant SOLANA_CHAIN_ID = 101;

    function setUp() public {
        admin = address(this);
        user = address(0x456);
        relayer = address(0x789);

        // Deploy mock verifier
        verifier = new MockGroth16Verifier();

        // Deploy light client (constructor takes 1 argument)
        lightClient = new SolanaLightClient(address(verifier));

        // Deploy bridge (constructor takes 4 arguments)
        bridge = new CrossChainBridge(
            address(lightClient),
            address(verifier),
            100 gwei,  // baseFee
            1 gwei     // feePerByte
        );

        // Deploy wrapped token (constructor takes 6 arguments)
        testToken = new CrossChainToken(
            "Wrapped SOL",
            "wSOL",
            18, // decimals
            block.chainid, // homeChainId
            0, // no initial supply
            address(0) // no initial holder
        );

        // Authorize bridge to mint/burn
        testToken.setBridgeAuthorization(address(bridge), true);

        // Register token in bridge
        bridge.registerToken(address(testToken), SOLANA_MINT, false);

        // Give user some tokens by minting from bridge
        vm.prank(address(bridge));
        testToken.bridgeMint(user, INITIAL_SUPPLY);
        
        vm.prank(user);
        testToken.approve(address(bridge), type(uint256).max);
    }

    // =============================================================================
    // INITIALIZATION TESTS
    // =============================================================================

    function test_BridgeInitialization() public view {
        assertEq(address(bridge.solanaLightClient()), address(lightClient));
        assertEq(address(bridge.transferVerifier()), address(verifier));
        assertEq(bridge.baseFee(), 100 gwei);
        assertEq(bridge.feePerByte(), 1 gwei);
    }

    function test_TokenRegistration() public {
        CrossChainToken newToken = new CrossChainToken(
            "Test", 
            "TST", 
            18, 
            block.chainid, 
            0, 
            address(0)
        );
        bytes32 newMint = bytes32(uint256(2));

        bridge.registerToken(address(newToken), newMint, true);

        assertEq(bridge.tokenToSolanaMint(address(newToken)), newMint);
        assertEq(bridge.solanaMintToToken(newMint), address(newToken));
        assertTrue(bridge.isTokenHome(address(newToken)));
    }

    function test_RevertWhen_RegisterTokenUnauthorized() public {
        vm.prank(user);
        vm.expectRevert();
        bridge.registerToken(address(testToken), SOLANA_MINT, true);
    }

    // =============================================================================
    // INITIATE TRANSFER TESTS
    // =============================================================================

    function test_InitiateTransfer() public {
        uint256 amount = 100 ether;
        bytes32 recipient = bytes32(uint256(0xdeadbeef));
        bytes memory payload = "";

        uint256 fee = bridge.getTransferFee(SOLANA_CHAIN_ID, payload.length);
        uint256 userBalanceBefore = testToken.balanceOf(user);

        vm.deal(user, fee);
        vm.prank(user);
        bytes32 transferId = bridge.initiateTransfer{value: fee}(
            address(testToken),
            recipient,
            amount,
            SOLANA_CHAIN_ID,
            payload
        );

        // Verify transfer was recorded
        assertTrue(transferId != bytes32(0));
        
        // Verify balances changed (wrapped token gets burned)
        assertEq(testToken.balanceOf(user), userBalanceBefore - amount);
        
        // Verify nonce incremented
        assertEq(bridge.transferNonce(), 1);
    }

    function test_InitiateTransferWithPayload() public {
        uint256 amount = 100 ether;
        bytes32 recipient = bytes32(uint256(0xdeadbeef));
        bytes memory payload = hex"deadbeef1234";

        uint256 fee = bridge.getTransferFee(SOLANA_CHAIN_ID, payload.length);

        vm.deal(user, fee);
        vm.prank(user);
        bytes32 transferId = bridge.initiateTransfer{value: fee}(
            address(testToken),
            recipient,
            amount,
            SOLANA_CHAIN_ID,
            payload
        );

        assertTrue(transferId != bytes32(0));
    }

    function test_InitiateTransferZeroAmount() public {
        // Note: Zero amount transfers are currently allowed by the contract
        // This test verifies the current behavior (consider adding validation)
        bytes32 recipient = bytes32(uint256(0xdeadbeef));
        uint256 fee = bridge.getTransferFee(SOLANA_CHAIN_ID, 0);

        vm.deal(user, fee);
        vm.prank(user);
        bytes32 transferId = bridge.initiateTransfer{value: fee}(
            address(testToken),
            recipient,
            0,
            SOLANA_CHAIN_ID,
            ""
        );
        // Currently succeeds - consider adding zero amount validation
        assertTrue(transferId != bytes32(0));
    }

    function test_RevertWhen_InitiateTransferInsufficientFee() public {
        bytes32 recipient = bytes32(uint256(0xdeadbeef));

        vm.prank(user);
        vm.expectRevert();
        bridge.initiateTransfer{value: 0}( // no fee
            address(testToken),
            recipient,
            100 ether,
            SOLANA_CHAIN_ID,
            ""
        );
    }

    function test_RevertWhen_InitiateTransferUnregisteredToken() public {
        address unregisteredToken = address(0x999);
        bytes32 recipient = bytes32(uint256(0xdeadbeef));
        uint256 fee = bridge.getTransferFee(SOLANA_CHAIN_ID, 0);

        vm.deal(user, fee);
        vm.prank(user);
        vm.expectRevert();
        bridge.initiateTransfer{value: fee}(
            unregisteredToken,
            recipient,
            100 ether,
            SOLANA_CHAIN_ID,
            ""
        );
    }

    // =============================================================================
    // FEE TESTS
    // =============================================================================

    function test_GetTransferFee() public view {
        uint256 payloadLength = 100;
        // Fee is 2x for cross-ecosystem (EVM <-> Solana) transfers
        uint256 baseFeeCalc = bridge.baseFee() + (bridge.feePerByte() * payloadLength);
        uint256 expectedFee = baseFeeCalc * 2; // 2x for ZK proof costs
        assertEq(bridge.getTransferFee(SOLANA_CHAIN_ID, payloadLength), expectedFee);
    }

    function test_SetFees() public {
        uint256 newBaseFee = 200 gwei;
        uint256 newFeePerByte = 2 gwei;

        bridge.setFees(newBaseFee, newFeePerByte);

        assertEq(bridge.baseFee(), newBaseFee);
        assertEq(bridge.feePerByte(), newFeePerByte);
    }

    function test_RevertWhen_SetFeesUnauthorized() public {
        vm.prank(user);
        vm.expectRevert();
        bridge.setFees(200 gwei, 2 gwei);
    }

    function test_CollectFees() public {
        // Generate some fees
        uint256 amount = 100 ether;
        bytes32 recipient = bytes32(uint256(0xdeadbeef));
        uint256 fee = bridge.getTransferFee(SOLANA_CHAIN_ID, 0);

        vm.deal(user, fee);
        vm.prank(user);
        bridge.initiateTransfer{value: fee}(
            address(testToken),
            recipient,
            amount,
            SOLANA_CHAIN_ID,
            ""
        );

        // Fee collector is admin (this contract) by default
        // Set a new fee collector that can receive ETH
        FeeReceiver receiver = new FeeReceiver();
        bridge.setFeeCollector(address(receiver));
        
        // Collect fees
        uint256 collectorBalanceBefore = address(receiver).balance;
        bridge.collectFees();
        
        assertEq(address(receiver).balance, collectorBalanceBefore + fee);
    }

    // =============================================================================
    // ADMIN TESTS
    // =============================================================================

    function test_TransferAdmin() public {
        address newAdmin = address(0xAAA);
        bridge.transferAdmin(newAdmin);
        assertEq(bridge.admin(), newAdmin);
    }

    function test_RevertWhen_TransferAdminUnauthorized() public {
        vm.prank(user);
        vm.expectRevert();
        bridge.transferAdmin(user);
    }

    // =============================================================================
    // FUZZ TESTS
    // =============================================================================

    function testFuzz_InitiateTransfer(uint256 amount) public {
        vm.assume(amount > 0);
        vm.assume(amount <= INITIAL_SUPPLY);

        bytes32 recipient = bytes32(uint256(0xdeadbeef));
        uint256 fee = bridge.getTransferFee(SOLANA_CHAIN_ID, 0);

        vm.deal(user, fee);
        vm.prank(user);
        bytes32 transferId = bridge.initiateTransfer{value: fee}(
            address(testToken),
            recipient,
            amount,
            SOLANA_CHAIN_ID,
            ""
        );

        assertTrue(transferId != bytes32(0));
    }

    function testFuzz_GetTransferFee(uint256 payloadLength) public view {
        vm.assume(payloadLength <= 10000); // reasonable max
        uint256 fee = bridge.getTransferFee(SOLANA_CHAIN_ID, payloadLength);
        // 2x for cross-ecosystem transfers
        uint256 baseFeeCalc = bridge.baseFee() + (bridge.feePerByte() * payloadLength);
        assertEq(fee, baseFeeCalc * 2);
    }

    // =============================================================================
    // COMPLETE TRANSFER TESTS
    // =============================================================================

    function test_CompleteTransfer() public {
        // Setup: Create a valid transfer scenario
        bytes32 transferId = keccak256("test_transfer_1");
        bytes32 sender = bytes32(uint256(0x12345)); // Solana sender
        address recipient = user;
        uint256 amount = 50 ether;
        uint64 slot = 100;
        bytes32 bankHash = keccak256("bank_hash_100");

        // Setup mock light client to verify the slot
        MockSolanaLightClient mockLC = new MockSolanaLightClient();
        mockLC.setSlotVerified(slot, true);
        mockLC.setBankHash(slot, bankHash);

        // Deploy new bridge with mock light client
        CrossChainBridge testBridge = new CrossChainBridge(
            address(mockLC),
            address(verifier),
            100 gwei,
            1 gwei
        );

        // Register and setup token
        CrossChainToken bridgeToken = new CrossChainToken(
            "Bridge Token",
            "BT",
            18,
            block.chainid,
            0,
            address(0)
        );
        bridgeToken.setBridgeAuthorization(address(testBridge), true);
        testBridge.registerToken(address(bridgeToken), SOLANA_MINT, false);

        // Create proof and public inputs (must match completeTransfer validation)
        // Order: transferId, slot, tokenMint, sender, recipient, amount, bankHash
        uint256[8] memory proof;
        uint256[] memory publicInputs = new uint256[](7);
        publicInputs[0] = uint256(transferId);
        publicInputs[1] = slot;
        publicInputs[2] = uint256(SOLANA_MINT);
        publicInputs[3] = uint256(sender);
        publicInputs[4] = uint256(uint160(recipient));
        publicInputs[5] = amount;
        publicInputs[6] = uint256(bankHash);

        // Complete the transfer
        testBridge.completeTransfer(
            transferId,
            address(bridgeToken),
            sender,
            recipient,
            amount,
            slot,
            proof,
            publicInputs
        );

        // Verify recipient received tokens
        assertEq(bridgeToken.balanceOf(recipient), amount);
        
        // Verify transfer is marked complete
        assertTrue(testBridge.completedTransfers(transferId));
    }

    function test_RevertWhen_CompleteTransferTwice() public {
        bytes32 transferId = keccak256("test_transfer_double");
        bytes32 sender = bytes32(uint256(0x12345));
        uint256 amount = 50 ether;
        uint64 slot = 100;
        bytes32 bankHash = keccak256("bank_hash_double");

        MockSolanaLightClient mockLC = new MockSolanaLightClient();
        mockLC.setSlotVerified(slot, true);
        mockLC.setBankHash(slot, bankHash);

        CrossChainBridge testBridge = new CrossChainBridge(
            address(mockLC),
            address(verifier),
            100 gwei,
            1 gwei
        );

        CrossChainToken bridgeToken = new CrossChainToken(
            "Bridge Token",
            "BT",
            18,
            block.chainid,
            0,
            address(0)
        );
        bridgeToken.setBridgeAuthorization(address(testBridge), true);
        testBridge.registerToken(address(bridgeToken), SOLANA_MINT, false);

        uint256[8] memory proof;
        uint256[] memory publicInputs = new uint256[](7);
        publicInputs[0] = uint256(transferId);
        publicInputs[1] = slot;
        publicInputs[2] = uint256(SOLANA_MINT);
        publicInputs[3] = uint256(sender);
        publicInputs[4] = uint256(uint160(user));
        publicInputs[5] = amount;
        publicInputs[6] = uint256(bankHash);

        // First completion should succeed
        testBridge.completeTransfer(
            transferId,
            address(bridgeToken),
            sender,
            user,
            amount,
            slot,
            proof,
            publicInputs
        );

        // Second completion should fail
        vm.expectRevert(CrossChainBridge.TransferAlreadyCompleted.selector);
        testBridge.completeTransfer(
            transferId,
            address(bridgeToken),
            sender,
            user,
            amount,
            slot,
            proof,
            publicInputs
        );
    }

    function test_RevertWhen_CompleteTransferSlotNotVerified() public {
        bytes32 transferId = keccak256("test_transfer_unverified");
        bytes32 sender = bytes32(uint256(0x12345));
        uint256 amount = 50 ether;
        uint64 slot = 100;

        // Light client does NOT have slot verified
        MockSolanaLightClient mockLC = new MockSolanaLightClient();
        // mockLC.setSlotVerified(slot, true); // NOT CALLED

        CrossChainBridge testBridge = new CrossChainBridge(
            address(mockLC),
            address(verifier),
            100 gwei,
            1 gwei
        );

        CrossChainToken bridgeToken = new CrossChainToken(
            "Bridge Token",
            "BT",
            18,
            block.chainid,
            0,
            address(0)
        );
        bridgeToken.setBridgeAuthorization(address(testBridge), true);
        testBridge.registerToken(address(bridgeToken), SOLANA_MINT, false);

        uint256[8] memory proof;
        uint256[] memory publicInputs = new uint256[](5);

        vm.expectRevert(CrossChainBridge.SlotNotVerified.selector);
        testBridge.completeTransfer(
            transferId,
            address(bridgeToken),
            sender,
            user,
            amount,
            slot,
            proof,
            publicInputs
        );
    }

    function test_RevertWhen_CompleteTransferInvalidProof() public {
        bytes32 transferId = keccak256("test_transfer_bad_proof");
        bytes32 sender = bytes32(uint256(0x12345));
        uint256 amount = 50 ether;
        uint64 slot = 100;

        MockSolanaLightClient mockLC = new MockSolanaLightClient();
        mockLC.setSlotVerified(slot, true);

        // Use a verifier that rejects proofs
        MockGroth16Verifier rejectingVerifier = new MockGroth16Verifier();
        rejectingVerifier.setVerifyResult(false);

        CrossChainBridge testBridge = new CrossChainBridge(
            address(mockLC),
            address(rejectingVerifier),
            100 gwei,
            1 gwei
        );

        CrossChainToken bridgeToken = new CrossChainToken(
            "Bridge Token",
            "BT",
            18,
            block.chainid,
            0,
            address(0)
        );
        bridgeToken.setBridgeAuthorization(address(testBridge), true);
        testBridge.registerToken(address(bridgeToken), SOLANA_MINT, false);

        uint256[8] memory proof;
        uint256[] memory publicInputs = new uint256[](5);
        publicInputs[0] = uint256(transferId);
        publicInputs[1] = slot;
        publicInputs[2] = uint256(SOLANA_MINT);
        publicInputs[3] = uint256(sender);
        publicInputs[4] = amount;

        vm.expectRevert(CrossChainBridge.InvalidProof.selector);
        testBridge.completeTransfer(
            transferId,
            address(bridgeToken),
            sender,
            user,
            amount,
            slot,
            proof,
            publicInputs
        );
    }

    function test_RevertWhen_CompleteTransferUnregisteredToken() public {
        bytes32 transferId = keccak256("test_transfer_unreg");
        bytes32 sender = bytes32(uint256(0x12345));
        uint256 amount = 50 ether;
        uint64 slot = 100;

        MockSolanaLightClient mockLC = new MockSolanaLightClient();
        mockLC.setSlotVerified(slot, true);

        CrossChainBridge testBridge = new CrossChainBridge(
            address(mockLC),
            address(verifier),
            100 gwei,
            1 gwei
        );

        // Token NOT registered
        address unregisteredToken = address(0x999);

        uint256[8] memory proof;
        uint256[] memory publicInputs = new uint256[](5);

        vm.expectRevert(CrossChainBridge.TokenNotRegistered.selector);
        testBridge.completeTransfer(
            transferId,
            unregisteredToken,
            sender,
            user,
            amount,
            slot,
            proof,
            publicInputs
        );
    }

    // =============================================================================
    // LIGHT CLIENT TESTS
    // =============================================================================

    function test_LightClientSlotVerification() public {
        MockSolanaLightClient mockLC = new MockSolanaLightClient();
        
        // Initially slot is not verified
        assertFalse(mockLC.isSlotVerified(100));
        
        // Set slot as verified
        mockLC.setSlotVerified(100, true);
        assertTrue(mockLC.isSlotVerified(100));
        
        // Other slots still unverified
        assertFalse(mockLC.isSlotVerified(101));
    }

    function test_LightClientGetBankHash() public {
        MockSolanaLightClient mockLC = new MockSolanaLightClient();
        bytes32 bankHash = keccak256("bank_hash_100");
        
        mockLC.setBankHash(100, bankHash);
        assertEq(mockLC.getBankHash(100), bankHash);
    }

    // =============================================================================
    // PAUSE TESTS
    // =============================================================================

    function test_Pause() public {
        assertFalse(bridge.paused());
        bridge.pause();
        assertTrue(bridge.paused());
    }

    function test_Unpause() public {
        bridge.pause();
        assertTrue(bridge.paused());
        bridge.unpause();
        assertFalse(bridge.paused());
    }

    function test_RevertWhen_PauseByNonAdmin() public {
        vm.prank(user);
        vm.expectRevert(CrossChainBridge.OnlyAdmin.selector);
        bridge.pause();
    }

    function test_RevertWhen_UnpauseByNonAdmin() public {
        bridge.pause();
        vm.prank(user);
        vm.expectRevert(CrossChainBridge.OnlyAdmin.selector);
        bridge.unpause();
    }

    function test_RevertWhen_InitiateTransferWhilePaused() public {
        bridge.pause();
        
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(CrossChainBridge.ContractPaused.selector);
        bridge.initiateTransfer{value: 200 gwei}(
            address(testToken),
            bytes32(uint256(uint160(user))),
            1 ether,
            SOLANA_CHAIN_ID,
            ""
        );
    }

    function test_RevertWhen_CompleteTransferWhilePaused() public {
        MockSolanaLightClient mockLC = new MockSolanaLightClient();
        MockGroth16Verifier mockVerifier = new MockGroth16Verifier();
        
        CrossChainBridge pausableBridge = new CrossChainBridge(
            address(mockLC),
            address(mockVerifier),
            100 gwei,
            1 gwei
        );
        
        CrossChainToken pausableToken = new CrossChainToken(
            "Test",
            "TST",
            18,
            block.chainid,
            0,
            address(0)
        );
        
        pausableToken.setBridgeAuthorization(address(pausableBridge), true);
        pausableBridge.registerToken(address(pausableToken), SOLANA_MINT, false);
        mockLC.setSlotVerified(100, true);
        
        pausableBridge.pause();
        
        bytes32 transferId = keccak256("test");
        uint256[8] memory proof;
        uint256[] memory publicInputs = new uint256[](0);
        
        vm.expectRevert(CrossChainBridge.ContractPaused.selector);
        pausableBridge.completeTransfer(
            transferId,
            address(pausableToken),
            bytes32(uint256(1)),
            user,
            1 ether,
            100,
            proof,
            publicInputs
        );
    }

    function test_InitiateTransferAfterUnpause() public {
        bridge.pause();
        bridge.unpause();
        
        uint256 fee = bridge.getTransferFee(SOLANA_CHAIN_ID, 0);
        
        vm.deal(user, 1 ether);
        vm.prank(user);
        bytes32 transferId = bridge.initiateTransfer{value: fee}(
            address(testToken),
            bytes32(uint256(uint160(user))),
            1 ether,
            SOLANA_CHAIN_ID,
            ""
        );
        
        assertNotEq(transferId, bytes32(0));
    }
}

/**
 * @notice Mock Groth16 verifier that accepts all proofs (for testing)
 */
contract MockGroth16Verifier is IGroth16Verifier {
    bool public shouldVerify = true;

    function setVerifyResult(bool result) external {
        shouldVerify = result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[] calldata
    ) external view returns (bool) {
        return shouldVerify;
    }

    function getVerificationKeyHash() external pure returns (bytes32) {
        return keccak256("mock_vkey");
    }
}

/**
 * @notice Simple contract that can receive ETH (for fee collection tests)
 */
contract FeeReceiver {
    receive() external payable {}
}

/**
 * @notice Mock Solana Light Client for testing
 */
contract MockSolanaLightClient is ISolanaLightClient {
    mapping(uint64 => bool) private _verifiedSlots;
    mapping(uint64 => bytes32) private _bankHashes;
    uint64 private _latestSlot;
    bytes32 private _epochStakesRoot;

    function setSlotVerified(uint64 slot, bool verified) external {
        _verifiedSlots[slot] = verified;
        if (verified && slot > _latestSlot) {
            _latestSlot = slot;
        }
    }

    function setBankHash(uint64 slot, bytes32 bankHash) external {
        _bankHashes[slot] = bankHash;
    }

    function setEpochStakesRoot(bytes32 root) external {
        _epochStakesRoot = root;
    }

    // ISolanaLightClient implementation
    function isSlotVerified(uint64 slot) external view override returns (bool) {
        return _verifiedSlots[slot];
    }

    function getBankHash(uint64 slot) external view override returns (bytes32) {
        return _bankHashes[slot];
    }

    function getLatestSlot() external view override returns (uint64) {
        return _latestSlot;
    }

    function getCurrentEpoch() external view override returns (uint64, bytes32) {
        return (_latestSlot / 432000, _epochStakesRoot);
    }

    function updateState(
        uint64 slot,
        bytes32 bankHash,
        bytes32 epochStakesRoot,
        uint256[8] calldata,
        uint256[] calldata
    ) external override {
        _verifiedSlots[slot] = true;
        _bankHashes[slot] = bankHash;
        _epochStakesRoot = epochStakesRoot;
        if (slot > _latestSlot) {
            _latestSlot = slot;
        }
    }

    function verifyAccountProof(
        bytes32,
        uint64 slot,
        bytes calldata,
        bytes32[] calldata
    ) external view override returns (bool) {
        return _verifiedSlots[slot];
    }
}
