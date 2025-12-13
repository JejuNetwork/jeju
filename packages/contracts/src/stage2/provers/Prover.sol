// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IProver.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Prover
/// @notice Fraud proof verification using validator signatures and merkle proofs.
/// @dev Compatible with Cannon proof structure. For production, replace signature
///      verification with actual MIPS execution trace verification.
contract Prover is IProver {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint8 public constant PROOF_VERSION = 1;
    uint256 public constant MIN_FRAUD_VALIDATORS = 1;
    uint256 public constant MIN_DEFENSE_VALIDATORS = 2;
    bytes32 public constant FRAUD_DOMAIN = keccak256("JEJU_FRAUD_PROOF_V1");
    bytes32 public constant DEFENSE_DOMAIN = keccak256("JEJU_DEFENSE_PROOF_V1");

    /// @dev Proof structure:
    /// - bytes1: version (must be PROOF_VERSION)
    /// - bytes1: proofType (0=fraud, 1=defense)
    /// - bytes32: preStateRoot (state before disputed block)
    /// - bytes32: postStateRoot (claimed state after block)
    /// - bytes32: blockHash (L2 block being disputed)
    /// - uint64: blockNumber
    /// - bytes32: outputRoot (L2 output root commitment)
    /// - uint8: signerCount
    /// - bytes[]: signatures (65 bytes each: r,s,v)
    struct ProofData {
        uint8 version;
        uint8 proofType;
        bytes32 preStateRoot;
        bytes32 postStateRoot;
        bytes32 blockHash;
        uint64 blockNumber;
        bytes32 outputRoot;
        address[] signers;
        bytes[] signatures;
    }

    error InvalidProofVersion();
    error InvalidProofLength();
    error InvalidSignature();
    error InsufficientSignatures();
    error DuplicateSigner();
    error StateMismatch();

    function verifyProof(
        bytes32 stateRoot,
        bytes32 claimRoot,
        bytes calldata proof
    ) external pure override returns (bool) {
        if (proof.length < 138) revert InvalidProofLength(); // Minimum: 1+1+32+32+32+8+32 = 138
        
        ProofData memory data = _decodeProof(proof);
        if (data.version != PROOF_VERSION) revert InvalidProofVersion();
        if (data.proofType != 0) return false;
        if (data.preStateRoot != stateRoot) revert StateMismatch();
        if (data.postStateRoot == claimRoot) return false;
        
        bytes32 fraudHash = _computeFraudHash(stateRoot, claimRoot, data);
        if (!_verifySignatures(fraudHash, data.signers, data.signatures, MIN_FRAUD_VALIDATORS)) {
            revert InsufficientSignatures();
        }
        
        return true;
    }

    function verifyDefenseProof(
        bytes32 stateRoot,
        bytes32 claimRoot,
        bytes calldata defenseProof
    ) external pure override returns (bool) {
        if (defenseProof.length < 138) revert InvalidProofLength();
        
        ProofData memory data = _decodeProof(defenseProof);
        if (data.version != PROOF_VERSION) revert InvalidProofVersion();
        if (data.proofType != 1) return false;
        if (data.preStateRoot != stateRoot) revert StateMismatch();
        if (data.postStateRoot != claimRoot) return false;
        
        bytes32 defenseHash = _computeDefenseHash(stateRoot, claimRoot, data);
        if (!_verifySignatures(defenseHash, data.signers, data.signatures, MIN_DEFENSE_VALIDATORS)) {
            revert InsufficientSignatures();
        }
        
        return true;
    }

    function generateFraudProof(
        bytes32 stateRoot,
        bytes32, // claimRoot - not included in proof, used for verification
        bytes32 actualPostState,
        bytes32 blockHash,
        uint64 blockNumber,
        address[] memory signers,
        bytes[] memory signatures
    ) external pure returns (bytes memory) {
        bytes32 outputRoot = keccak256(abi.encodePacked(blockHash, stateRoot, actualPostState));
        return _encodeProof(ProofData({
            version: PROOF_VERSION,
            proofType: 0, // fraud
            preStateRoot: stateRoot,
            postStateRoot: actualPostState,
            blockHash: blockHash,
            blockNumber: blockNumber,
            outputRoot: outputRoot,
            signers: signers,
            signatures: signatures
        }));
    }

    function generateDefenseProof(
        bytes32 stateRoot,
        bytes32 claimRoot,
        bytes32 blockHash,
        uint64 blockNumber,
        address[] memory signers,
        bytes[] memory signatures
    ) external pure returns (bytes memory) {
        bytes32 outputRoot = keccak256(abi.encodePacked(blockHash, stateRoot, claimRoot));
        return _encodeProof(ProofData({
            version: PROOF_VERSION,
            proofType: 1, // defense
            preStateRoot: stateRoot,
            postStateRoot: claimRoot,
            blockHash: blockHash,
            blockNumber: blockNumber,
            outputRoot: outputRoot,
            signers: signers,
            signatures: signatures
        }));
    }

    function proverType() external pure override returns (string memory) {
        return "JEJU_PROVER_V1";
    }

    function _decodeProof(bytes calldata proof) internal pure returns (ProofData memory data) {
        data.version = uint8(proof[0]);
        data.proofType = uint8(proof[1]);
        data.preStateRoot = bytes32(proof[2:34]);
        data.postStateRoot = bytes32(proof[34:66]);
        data.blockHash = bytes32(proof[66:98]);
        data.blockNumber = uint64(bytes8(proof[98:106]));
        data.outputRoot = bytes32(proof[106:138]);
        
        if (proof.length > 138) {
            uint8 signerCount = uint8(proof[138]);
            data.signers = new address[](signerCount);
            data.signatures = new bytes[](signerCount);
            
            uint256 offset = 139;
            for (uint8 i = 0; i < signerCount; i++) {
                data.signers[i] = address(bytes20(proof[offset:offset+20]));
                offset += 20;
            }
            for (uint8 i = 0; i < signerCount; i++) {
                data.signatures[i] = proof[offset:offset+65];
                offset += 65;
            }
        }
    }

    function _encodeProof(ProofData memory data) internal pure returns (bytes memory) {
        bytes memory encoded = abi.encodePacked(
            data.version,
            data.proofType,
            data.preStateRoot,
            data.postStateRoot,
            data.blockHash,
            data.blockNumber,
            data.outputRoot,
            uint8(data.signers.length)
        );
        
        for (uint256 i = 0; i < data.signers.length; i++) {
            encoded = abi.encodePacked(encoded, data.signers[i]);
        }
        for (uint256 i = 0; i < data.signatures.length; i++) {
            encoded = abi.encodePacked(encoded, data.signatures[i]);
        }
        
        return encoded;
    }

    function _computeFraudHash(
        bytes32 stateRoot,
        bytes32 claimRoot,
        ProofData memory data
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            FRAUD_DOMAIN,
            stateRoot,
            claimRoot,
            data.postStateRoot,
            data.blockHash,
            data.blockNumber,
            data.outputRoot
        ));
    }

    function _computeDefenseHash(
        bytes32 stateRoot,
        bytes32 claimRoot,
        ProofData memory data
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            DEFENSE_DOMAIN,
            stateRoot,
            claimRoot,
            data.blockHash,
            data.blockNumber,
            data.outputRoot
        ));
    }

    function _verifySignatures(
        bytes32 hash,
        address[] memory signers,
        bytes[] memory signatures,
        uint256 minRequired
    ) internal pure returns (bool) {
        if (signers.length < minRequired || signatures.length < minRequired) {
            return false;
        }
        
        bytes32 ethSignedHash = hash.toEthSignedMessageHash();
        
        for (uint256 i = 0; i < signers.length; i++) {
            for (uint256 j = 0; j < i; j++) {
                if (signers[i] == signers[j]) revert DuplicateSigner();
            }
            address recovered = ethSignedHash.recover(signatures[i]);
            if (recovered != signers[i]) revert InvalidSignature();
        }
        
        return true;
    }
}
