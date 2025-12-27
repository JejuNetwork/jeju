// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/services/ProofOfCloudValidator.sol";
import "../src/registry/IdentityRegistry.sol";

contract ProofOfCloudTest is Test {
    ProofOfCloudValidator public validator;
    IdentityRegistry public identityRegistry;

    address public owner = address(1);
    address public signer1;
    address public signer2;
    address public signer3;
    uint256 public signer1Key = 0x1;
    uint256 public signer2Key = 0x2;
    uint256 public signer3Key = 0x3;

    address public agentOwner = address(100);
    uint256 public agentId;

    bytes32 public hardwareIdHash = keccak256("test-hardware-id");
    bytes32 public evidenceHash = keccak256("test-evidence");

    function setUp() public {
        signer1 = vm.addr(signer1Key);
        signer2 = vm.addr(signer2Key);
        signer3 = vm.addr(signer3Key);

        // Deploy identity registry
        identityRegistry = new IdentityRegistry();

        // Deploy validator with 2-of-3 threshold
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;

        validator = new ProofOfCloudValidator(
            payable(address(identityRegistry)),
            signers,
            2, // threshold
            owner
        );

        // Register a test agent
        vm.prank(agentOwner);
        agentId = identityRegistry.register("test://agent");
    }

    // ============================================================================
    // Signer Management Tests
    // ============================================================================

    function test_InitialSigners() public view {
        address[] memory signers = validator.getSigners();
        assertEq(signers.length, 3);
        assertTrue(validator.isSigner(signer1));
        assertTrue(validator.isSigner(signer2));
        assertTrue(validator.isSigner(signer3));
    }

    function test_AddSigner() public {
        address newSigner = address(200);

        vm.prank(owner);
        validator.addSigner(newSigner);

        assertTrue(validator.isSigner(newSigner));
        assertEq(validator.getSigners().length, 4);
    }

    function test_AddSigner_RevertNotOwner() public {
        address newSigner = address(200);

        vm.prank(signer1);
        vm.expectRevert();
        validator.addSigner(newSigner);
    }

    function test_AddSigner_RevertAlreadyExists() public {
        vm.prank(owner);
        vm.expectRevert(ProofOfCloudValidator.SignerAlreadyExists.selector);
        validator.addSigner(signer1);
    }

    function test_RemoveSigner() public {
        vm.prank(owner);
        validator.removeSigner(signer3);

        assertFalse(validator.isSigner(signer3));
        assertEq(validator.getSigners().length, 2);
    }

    function test_RemoveSigner_RevertBelowThreshold() public {
        // Remove one signer first
        vm.prank(owner);
        validator.removeSigner(signer3);

        // Try to remove another - would go below threshold
        vm.prank(owner);
        vm.expectRevert(ProofOfCloudValidator.InvalidThreshold.selector);
        validator.removeSigner(signer2);
    }

    function test_SetThreshold() public {
        vm.prank(owner);
        validator.setThreshold(3);

        assertEq(validator.threshold(), 3);
    }

    function test_SetThreshold_RevertTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(ProofOfCloudValidator.InvalidThreshold.selector);
        validator.setThreshold(4); // Only 3 signers
    }

    // ============================================================================
    // Verification Request Tests
    // ============================================================================

    function test_RequestVerification() public {
        string memory requestUri = "ipfs://QmTest";

        vm.prank(agentOwner);
        bytes32 requestHash = validator.requestVerification(agentId, hardwareIdHash, requestUri);

        assertNotEq(requestHash, bytes32(0));
    }

    function test_RequestVerification_RevertNotOwner() public {
        string memory requestUri = "ipfs://QmTest";

        vm.prank(address(999)); // Not the agent owner
        vm.expectRevert(ProofOfCloudValidator.InvalidSigner.selector);
        validator.requestVerification(agentId, hardwareIdHash, requestUri);
    }

    function test_RequestVerification_RevertAgentNotFound() public {
        vm.prank(agentOwner);
        vm.expectRevert(ProofOfCloudValidator.AgentNotFound.selector);
        validator.requestVerification(999, hardwareIdHash, "ipfs://QmTest");
    }

    // ============================================================================
    // Verification Submission Tests
    // ============================================================================

    function test_SubmitVerification_SingleSigner() public {
        // First request verification
        vm.prank(agentOwner);
        bytes32 requestHash = validator.requestVerification(agentId, hardwareIdHash, "ipfs://QmTest");

        // Submit from signer1
        bytes memory sig1 = _signVerification(
            signer1Key,
            requestHash,
            agentId,
            hardwareIdHash,
            2, // level
            "aws",
            "us-east-1",
            evidenceHash,
            0 // nonce
        );

        vm.prank(signer1);
        validator.submitVerification(requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, sig1);

        // Check pending verification
        (uint256 pendingAgentId, uint256 sigCount, bool executed) = validator.getPendingVerification(requestHash);
        assertEq(pendingAgentId, agentId);
        assertEq(sigCount, 1);
        assertFalse(executed);
    }

    function test_SubmitVerification_ThresholdReached() public {
        // First request verification
        vm.prank(agentOwner);
        bytes32 requestHash = validator.requestVerification(agentId, hardwareIdHash, "ipfs://QmTest");

        // Submit from signer1
        bytes memory sig1 =
            _signVerification(signer1Key, requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, 0);

        vm.prank(signer1);
        validator.submitVerification(requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, sig1);

        // Submit from signer2 - should execute
        bytes memory sig2 =
            _signVerification(signer2Key, requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, 0);

        vm.prank(signer2);
        validator.submitVerification(requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, sig2);

        // Check execution
        (,, bool executed) = validator.getPendingVerification(requestHash);
        assertTrue(executed);

        // Check agent status
        (bool verified, uint8 level, bytes32 hwHash,) = validator.getAgentStatus(agentId);
        assertTrue(verified);
        assertEq(level, 2);
        assertEq(hwHash, hardwareIdHash);
    }

    function test_SubmitVerification_RevertDuplicateSignature() public {
        vm.prank(agentOwner);
        bytes32 requestHash = validator.requestVerification(agentId, hardwareIdHash, "ipfs://QmTest");

        bytes memory sig1 =
            _signVerification(signer1Key, requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, 0);

        vm.prank(signer1);
        validator.submitVerification(requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, sig1);

        // Try to submit again with same signer (new nonce)
        bytes memory sig1Again = _signVerification(
            signer1Key,
            requestHash,
            agentId,
            hardwareIdHash,
            2,
            "aws",
            "us-east-1",
            evidenceHash,
            1 // New nonce
        );

        vm.prank(signer1);
        vm.expectRevert(ProofOfCloudValidator.SignatureAlreadySubmitted.selector);
        validator.submitVerification(
            requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, sig1Again
        );
    }

    // ============================================================================
    // Revocation Tests
    // ============================================================================

    function test_RevokeHardware() public {
        // First complete a verification
        _completeVerification();

        // Revoke
        vm.prank(signer1);
        validator.revokeHardware(hardwareIdHash, "Security breach detected");

        // Check status
        (bool verified,,,) = validator.getAgentStatus(agentId);
        assertFalse(verified);

        ProofOfCloudValidator.HardwareRecord memory record = validator.getHardwareRecord(hardwareIdHash);
        assertTrue(record.revoked);
    }

    function test_RevokeHardware_RevertNotSigner() public {
        _completeVerification();

        vm.prank(address(999));
        vm.expectRevert(ProofOfCloudValidator.InvalidSigner.selector);
        validator.revokeHardware(hardwareIdHash, "Invalid attempt");
    }

    function test_RevokeHardware_RevertNotRegistered() public {
        vm.prank(signer1);
        vm.expectRevert(ProofOfCloudValidator.HardwareNotRegistered.selector);
        validator.revokeHardware(hardwareIdHash, "Not registered");
    }

    // ============================================================================
    // View Function Tests
    // ============================================================================

    function test_NeedsReverification_Unverified() public view {
        assertTrue(validator.needsReverification(agentId));
    }

    function test_NeedsReverification_Verified() public {
        _completeVerification();
        assertFalse(validator.needsReverification(agentId));
    }

    function test_NeedsReverification_Expired() public {
        _completeVerification();

        // Fast forward past expiry
        vm.warp(block.timestamp + 8 days);

        assertTrue(validator.needsReverification(agentId));
    }

    function test_GetHardwareRecord() public {
        _completeVerification();

        ProofOfCloudValidator.HardwareRecord memory record = validator.getHardwareRecord(hardwareIdHash);
        assertEq(record.hardwareIdHash, hardwareIdHash);
        assertEq(record.level, 2);
        assertEq(record.agentId, agentId);
        assertEq(record.cloudProvider, "aws");
        assertEq(record.region, "us-east-1");
        assertFalse(record.revoked);
    }

    // ============================================================================
    // Pause Tests
    // ============================================================================

    function test_Pause() public {
        vm.prank(owner);
        validator.pause();

        vm.prank(agentOwner);
        vm.expectRevert();
        validator.requestVerification(agentId, hardwareIdHash, "ipfs://QmTest");
    }

    function test_Unpause() public {
        vm.prank(owner);
        validator.pause();

        vm.prank(owner);
        validator.unpause();

        vm.prank(agentOwner);
        bytes32 requestHash = validator.requestVerification(agentId, hardwareIdHash, "ipfs://QmTest");
        assertNotEq(requestHash, bytes32(0));
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    function _completeVerification() internal {
        vm.prank(agentOwner);
        bytes32 requestHash = validator.requestVerification(agentId, hardwareIdHash, "ipfs://QmTest");

        bytes memory sig1 =
            _signVerification(signer1Key, requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, 0);

        vm.prank(signer1);
        validator.submitVerification(requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, sig1);

        bytes memory sig2 =
            _signVerification(signer2Key, requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, 0);

        vm.prank(signer2);
        validator.submitVerification(requestHash, agentId, hardwareIdHash, 2, "aws", "us-east-1", evidenceHash, sig2);
    }

    function _signVerification(
        uint256 signerKey,
        bytes32 requestHash,
        uint256 _agentId,
        bytes32 _hardwareIdHash,
        uint8 level,
        string memory cloudProvider,
        string memory region,
        bytes32 _evidenceHash,
        uint256 nonce
    ) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(
            abi.encode(
                requestHash,
                _agentId,
                _hardwareIdHash,
                level,
                cloudProvider,
                region,
                _evidenceHash,
                block.chainid,
                address(validator),
                nonce
            )
        );

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }
}
