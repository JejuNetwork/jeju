// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../../src/da/DACommitmentVerifier.sol";
import "../../src/da/CalldataFallback.sol";
import "../../src/da/DABlobRegistry.sol";
import "../../src/da/DAOperatorRegistry.sol";
import "../../src/da/IDATypes.sol";

/**
 * @title DACommitmentVerifierTest
 * @notice Tests for DA commitment verification system
 */

// Mock blob registry for testing
contract MockDABlobRegistry {
    mapping(bytes32 => IDATypes.BlobMetadata) private _blobs;
    mapping(bytes32 => bool) private _available;
    mapping(bytes32 => bytes32) private _commitments;

    function setBlob(
        bytes32 blobId,
        bytes32 commitment,
        bytes32 merkleRoot,
        bool available
    ) external {
        _blobs[blobId] = IDATypes.BlobMetadata({
            blobId: blobId,
            status: available ? IDATypes.BlobStatus.AVAILABLE : IDATypes.BlobStatus.PENDING,
            size: 1024,
            commitment: IDATypes.BlobCommitment({
                commitment: commitment,
                dataChunkCount: 4,
                parityChunkCount: 2,
                totalChunkCount: 6,
                chunkSize: 256,
                merkleRoot: merkleRoot,
                timestamp: block.timestamp
            }),
            submitter: msg.sender,
            submittedAt: block.timestamp,
            confirmedAt: available ? block.timestamp : 0,
            expiresAt: block.timestamp + 7 days,
            namespace: bytes32(0)
        });
        _available[blobId] = available;
        _commitments[blobId] = commitment;
    }

    function verifyCommitment(bytes32 blobId, bytes32 expectedCommitment) external view returns (bool) {
        return _commitments[blobId] == expectedCommitment;
    }

    function verifyAvailability(bytes32 blobId) external view returns (bool, uint256, uint256) {
        return (_available[blobId], 5, 4);
    }

    function getBlob(bytes32 blobId) external view returns (IDATypes.BlobMetadata memory) {
        return _blobs[blobId];
    }
}

contract DACommitmentVerifierTest is Test {
    DACommitmentVerifier public verifier;
    CalldataFallback public calldataFallback;
    MockDABlobRegistry public blobRegistry;

    address public admin;
    address public proposer;
    address public challenger;

    bytes32 public constant TEST_BLOB_ID = keccak256("test-blob");
    bytes32 public constant TEST_COMMITMENT = keccak256("test-commitment");
    bytes32 public constant TEST_MERKLE_ROOT = keccak256("test-merkle-root");
    bytes32 public constant TEST_OUTPUT_ROOT = keccak256("test-output-root");

    // Allow test contract to receive ETH
    receive() external payable {}

    function setUp() public {
        admin = address(this);
        proposer = address(0x1);
        challenger = address(0x2);

        // Deploy mock blob registry
        blobRegistry = new MockDABlobRegistry();

        // Deploy calldata fallback
        calldataFallback = new CalldataFallback(
            0.001 ether,  // submission fee
            128 * 1024,   // max blob size
            admin
        );

        // Deploy verifier
        verifier = new DACommitmentVerifier(
            address(blobRegistry),
            address(calldataFallback),
            admin
        );

        // Setup mock blob
        blobRegistry.setBlob(TEST_BLOB_ID, TEST_COMMITMENT, TEST_MERKLE_ROOT, true);

        // Authorize proposer for calldata fallback
        calldataFallback.setAuthorizedSubmitter(proposer, true);

        // Fund accounts
        vm.deal(proposer, 10 ether);
        vm.deal(challenger, 10 ether);
    }

    // ============ Commitment Registration Tests ============

    function test_RegisterCommitment() public {
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });

        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        IDACommitmentVerifier.DACommitment memory stored = verifier.getCommitment(TEST_OUTPUT_ROOT);
        assertEq(stored.blobId, TEST_BLOB_ID);
        assertEq(stored.commitment, TEST_COMMITMENT);
        assertFalse(stored.isCalldata);
    }

    function test_RevertWhen_DuplicateCommitment() public {
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });

        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        vm.expectRevert(DACommitmentVerifier.InvalidCommitment.selector);
        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);
    }

    // ============ Commitment Verification Tests ============

    function test_VerifyCommitment() public {
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });

        // Verify with empty proof (basic verification)
        bool isValid = verifier.verifyCommitment(TEST_OUTPUT_ROOT, commitment, "");
        assertTrue(isValid);
    }

    function test_VerifyCommitment_InvalidBlob() public {
        bytes32 invalidBlobId = keccak256("invalid-blob");

        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: invalidBlobId,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });

        bool isValid = verifier.verifyCommitment(TEST_OUTPUT_ROOT, commitment, "");
        assertFalse(isValid);
    }

    function test_VerifyCommitment_UnavailableBlob() public {
        bytes32 unavailableBlobId = keccak256("unavailable-blob");
        blobRegistry.setBlob(unavailableBlobId, TEST_COMMITMENT, TEST_MERKLE_ROOT, false);

        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: unavailableBlobId,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });

        bool isValid = verifier.verifyCommitment(TEST_OUTPUT_ROOT, commitment, "");
        assertFalse(isValid);
    }

    // ============ Calldata Fallback Tests ============

    function test_CalldataFallback_PostAndVerify() public {
        bytes memory testData = "test batch data for fallback";

        vm.prank(proposer);
        bytes32 blobId = calldataFallback.postCalldata{value: 0.001 ether}(testData);

        assertTrue(calldataFallback.blobExists(blobId));

        // Verify calldata
        bool isValid = calldataFallback.verifyCalldata(blobId, testData);
        assertTrue(isValid);
    }

    function test_CalldataFallback_InvalidData() public {
        bytes memory testData = "original data";
        bytes memory wrongData = "wrong data";

        vm.prank(proposer);
        bytes32 blobId = calldataFallback.postCalldata{value: 0.001 ether}(testData);

        bool isValid = calldataFallback.verifyCalldata(blobId, wrongData);
        assertFalse(isValid);
    }

    function test_RevertWhen_CalldataFallback_Unauthorized() public {
        bytes memory testData = "test data";

        vm.prank(challenger); // Not authorized
        vm.expectRevert(CalldataFallback.UnauthorizedSubmitter.selector);
        calldataFallback.postCalldata{value: 0.001 ether}(testData);
    }

    function test_RevertWhen_CalldataFallback_BlobTooLarge() public {
        bytes memory largeData = new bytes(200 * 1024); // 200KB > max 128KB

        vm.prank(proposer);
        vm.expectRevert(CalldataFallback.BlobTooLarge.selector);
        calldataFallback.postCalldata{value: 0.001 ether}(largeData);
    }

    function test_RevertWhen_CalldataFallback_InsufficientFee() public {
        bytes memory testData = "test data";

        vm.prank(proposer);
        vm.expectRevert(CalldataFallback.InsufficientFee.selector);
        calldataFallback.postCalldata{value: 0.0001 ether}(testData); // Less than 0.001 ether
    }

    // ============ Challenge Tests ============

    function test_ChallengeUnavailability() public {
        // First register a commitment
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });
        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        // Challenge the output
        vm.prank(challenger);
        verifier.challengeUnavailability{value: 0.1 ether}(TEST_OUTPUT_ROOT, TEST_BLOB_ID);

        assertTrue(verifier.isOutputChallenged(TEST_OUTPUT_ROOT));
    }

    function test_RevertWhen_ChallengeUnavailability_InsufficientBond() public {
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });
        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        vm.prank(challenger);
        vm.expectRevert(DACommitmentVerifier.InsufficientBond.selector);
        verifier.challengeUnavailability{value: 0.01 ether}(TEST_OUTPUT_ROOT, TEST_BLOB_ID);
    }

    function test_RevertWhen_ChallengeUnavailability_OutputNotFound() public {
        bytes32 nonExistentOutput = keccak256("non-existent");

        vm.prank(challenger);
        vm.expectRevert(DACommitmentVerifier.CommitmentNotFound.selector);
        verifier.challengeUnavailability{value: 0.1 ether}(nonExistentOutput, TEST_BLOB_ID);
    }

    function test_RevertWhen_ChallengeUnavailability_AlreadyChallenged() public {
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });
        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        vm.prank(challenger);
        verifier.challengeUnavailability{value: 0.1 ether}(TEST_OUTPUT_ROOT, TEST_BLOB_ID);

        vm.prank(challenger);
        vm.expectRevert(DACommitmentVerifier.OutputAlreadyChallenged.selector);
        verifier.challengeUnavailability{value: 0.1 ether}(TEST_OUTPUT_ROOT, TEST_BLOB_ID);
    }

    // ============ Challenge Resolution Tests ============

    function test_ResolveChallenge_DataAvailable() public {
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });
        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        // Create challenge
        vm.prank(challenger);
        verifier.challengeUnavailability{value: 0.1 ether}(TEST_OUTPUT_ROOT, TEST_BLOB_ID);

        // Get challenge ID
        bytes32 challengeId = keccak256(abi.encodePacked(
            TEST_OUTPUT_ROOT,
            TEST_BLOB_ID,
            challenger,
            block.timestamp
        ));

        // Resolve with availability proof (empty proof uses registry verification)
        vm.prank(proposer);
        verifier.resolveChallenge(challengeId, "");

        DACommitmentVerifier.Challenge memory challenge = verifier.getChallenge(challengeId);
        assertTrue(challenge.resolved);
        assertFalse(challenge.successful);
        assertFalse(verifier.isOutputChallenged(TEST_OUTPUT_ROOT));
    }

    function test_FinalizeChallenge_DataUnavailable() public {
        // Set up unavailable blob
        bytes32 unavailableBlobId = keccak256("unavailable");
        blobRegistry.setBlob(unavailableBlobId, TEST_COMMITMENT, TEST_MERKLE_ROOT, false);

        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: unavailableBlobId,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });
        
        bytes32 outputRoot = keccak256("unavailable-output");
        verifier.registerCommitment(outputRoot, commitment);

        uint256 challengeTime = block.timestamp;

        // Create challenge
        vm.prank(challenger);
        verifier.challengeUnavailability{value: 0.1 ether}(outputRoot, unavailableBlobId);

        bytes32 challengeId = keccak256(abi.encodePacked(
            outputRoot,
            unavailableBlobId,
            challenger,
            challengeTime
        ));

        uint256 challengerBalanceBefore = challenger.balance;

        // Fast forward past response period (12 hours)
        vm.warp(block.timestamp + 13 hours);

        // Finalize challenge
        verifier.finalizeChallenge(challengeId);

        DACommitmentVerifier.Challenge memory challenge = verifier.getChallenge(challengeId);
        assertTrue(challenge.resolved);
        assertTrue(challenge.successful);

        // Challenger should get bond back
        assertEq(challenger.balance, challengerBalanceBefore + 0.1 ether);
    }

    function test_RevertWhen_FinalizeChallenge_TooEarly() public {
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });
        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        vm.prank(challenger);
        verifier.challengeUnavailability{value: 0.1 ether}(TEST_OUTPUT_ROOT, TEST_BLOB_ID);

        bytes32 challengeId = keccak256(abi.encodePacked(
            TEST_OUTPUT_ROOT,
            TEST_BLOB_ID,
            challenger,
            block.timestamp
        ));

        // Try to finalize too early
        vm.expectRevert(DACommitmentVerifier.ChallengePeriodNotExpired.selector);
        verifier.finalizeChallenge(challengeId);
    }

    // ============ View Functions Tests ============

    function test_HasValidCommitment() public {
        assertFalse(verifier.hasValidCommitment(TEST_OUTPUT_ROOT));

        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });
        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        assertTrue(verifier.hasValidCommitment(TEST_OUTPUT_ROOT));
    }

    function test_HasValidCommitment_WhenChallenged() public {
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });
        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        assertTrue(verifier.hasValidCommitment(TEST_OUTPUT_ROOT));

        // Challenge
        vm.prank(challenger);
        verifier.challengeUnavailability{value: 0.1 ether}(TEST_OUTPUT_ROOT, TEST_BLOB_ID);

        assertFalse(verifier.hasValidCommitment(TEST_OUTPUT_ROOT));
    }

    // ============ Admin Functions Tests ============

    function test_SetCalldataFallback() public {
        address newFallback = address(0x999);
        verifier.setCalldataFallback(newFallback);
        assertEq(verifier.calldataFallback(), newFallback);
    }

    function test_MarkVerified() public {
        IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
            blobId: TEST_BLOB_ID,
            commitment: TEST_COMMITMENT,
            merkleRoot: TEST_MERKLE_ROOT,
            submittedAt: block.timestamp,
            isCalldata: false
        });
        verifier.registerCommitment(TEST_OUTPUT_ROOT, commitment);

        assertFalse(verifier.isCommitmentVerified(TEST_OUTPUT_ROOT));

        verifier.markVerified(TEST_OUTPUT_ROOT);

        assertTrue(verifier.isCommitmentVerified(TEST_OUTPUT_ROOT));
    }

    function test_RevertWhen_MarkVerified_NotFound() public {
        bytes32 nonExistent = keccak256("non-existent");
        
        vm.expectRevert(DACommitmentVerifier.CommitmentNotFound.selector);
        verifier.markVerified(nonExistent);
    }

    // ============ Calldata Fallback Admin Tests ============

    function test_CalldataFallback_SetAuthorizedSubmitters() public {
        address[] memory submitters = new address[](2);
        submitters[0] = address(0x100);
        submitters[1] = address(0x200);

        calldataFallback.setAuthorizedSubmitters(submitters, true);

        assertTrue(calldataFallback.authorizedSubmitters(submitters[0]));
        assertTrue(calldataFallback.authorizedSubmitters(submitters[1]));
    }

    function test_CalldataFallback_WithdrawFees() public {
        // Post some data to collect fees
        vm.prank(proposer);
        calldataFallback.postCalldata{value: 0.01 ether}("test data");

        uint256 balanceBefore = admin.balance;
        calldataFallback.withdrawFees(admin, 0.01 ether);
        assertEq(admin.balance, balanceBefore + 0.01 ether);
    }

    function test_CalldataFallback_RetrieveCalldata() public {
        bytes memory testData = "test batch data";

        vm.prank(proposer);
        bytes32 blobId = calldataFallback.postCalldata{value: 0.001 ether}(testData);

        bytes memory retrieved = calldataFallback.retrieveCalldata(blobId);
        assertEq(keccak256(retrieved), keccak256(testData));
    }

    function test_CalldataFallback_GetAllBlobIds() public {
        vm.startPrank(proposer);
        calldataFallback.postCalldata{value: 0.001 ether}("data1");
        calldataFallback.postCalldata{value: 0.001 ether}("data2");
        vm.stopPrank();

        bytes32[] memory blobIds = calldataFallback.getAllBlobIds();
        assertEq(blobIds.length, 2);
    }
}
