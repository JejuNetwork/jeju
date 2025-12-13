// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/council/QualityOracle.sol";

contract QualityOracleTest is Test {
    QualityOracle public oracle;
    address public owner;
    address public assessor;
    address public proposer;
    uint256 public assessorKey;

    function setUp() public {
        owner = address(this);
        assessorKey = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        assessor = vm.addr(assessorKey);
        proposer = address(0x2222);

        oracle = new QualityOracle(owner);
        oracle.addAssessor(assessor);
    }

    function test_AddAssessor() public {
        address newAssessor = address(0x3333);
        assertFalse(oracle.isAssessor(newAssessor));

        oracle.addAssessor(newAssessor);
        assertTrue(oracle.isAssessor(newAssessor));
        assertEq(oracle.assessorCount(), 2);
    }

    function test_RemoveAssessor() public {
        oracle.removeAssessor(assessor);
        assertFalse(oracle.isAssessor(assessor));
        assertEq(oracle.assessorCount(), 0);
    }

    function test_VerifyScore() public view {
        bytes32 contentHash = keccak256("test proposal");
        uint256 score = 95;
        uint256 timestamp = block.timestamp;

        bytes32 messageHash = keccak256(
            abi.encodePacked("JejuQualityAttestation", contentHash, score, timestamp, proposer, block.chainid)
        );

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(assessorKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Should not revert
        oracle.verifyScore(contentHash, score, timestamp, proposer, signature);
    }

    function test_VerifyScore_BelowMinimum() public {
        bytes32 contentHash = keccak256("test");
        uint256 score = 50; // Below minimum
        uint256 timestamp = block.timestamp;

        bytes32 messageHash = keccak256(
            abi.encodePacked("JejuQualityAttestation", contentHash, score, timestamp, proposer, block.chainid)
        );

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(assessorKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(abi.encodeWithSelector(QualityOracle.ScoreBelowMinimum.selector, score, 90));
        oracle.verifyScore(contentHash, score, timestamp, proposer, signature);
    }

    function test_VerifyScore_Expired() public {
        vm.warp(10000);

        bytes32 contentHash = keccak256("test");
        uint256 score = 95;
        uint256 timestamp = block.timestamp - 2 hours;

        bytes32 messageHash = keccak256(
            abi.encodePacked("JejuQualityAttestation", contentHash, score, timestamp, proposer, block.chainid)
        );

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(assessorKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(QualityOracle.AttestationExpired.selector);
        oracle.verifyScore(contentHash, score, timestamp, proposer, signature);
    }

    function test_VerifyScore_InvalidSignature() public {
        bytes32 contentHash = keccak256("test");
        uint256 score = 95;
        uint256 timestamp = block.timestamp;

        // Sign with a non-assessor key
        uint256 fakeKey = 0xdeadbeef;
        bytes32 messageHash = keccak256(
            abi.encodePacked("JejuQualityAttestation", contentHash, score, timestamp, proposer, block.chainid)
        );

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakeKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(QualityOracle.InvalidSignature.selector);
        oracle.verifyScore(contentHash, score, timestamp, proposer, signature);
    }

    function test_GetMessageHash() public view {
        bytes32 contentHash = keccak256("test");
        uint256 score = 95;
        uint256 timestamp = block.timestamp;

        bytes32 hash = oracle.getMessageHash(contentHash, score, timestamp, proposer);

        bytes32 expectedHash = keccak256(
            abi.encodePacked("JejuQualityAttestation", contentHash, score, timestamp, proposer, block.chainid)
        );

        assertEq(hash, expectedHash);
    }

    function test_SetMinScore() public {
        assertEq(oracle.minScore(), 90);
        oracle.setMinScore(80);
        assertEq(oracle.minScore(), 80);
    }

    function test_SetAttestationTTL() public {
        assertEq(oracle.attestationTTL(), 1 hours);
        oracle.setAttestationTTL(2 hours);
        assertEq(oracle.attestationTTL(), 2 hours);
    }
}
