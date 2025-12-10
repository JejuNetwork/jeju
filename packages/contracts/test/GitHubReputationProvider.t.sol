// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/registry/GitHubReputationProvider.sol";
import "../src/registry/ValidationRegistry.sol";
import "../src/registry/IdentityRegistry.sol";

contract GitHubReputationProviderTest is Test {
    GitHubReputationProvider public provider;
    ValidationRegistry public validationRegistry;
    IdentityRegistry public identityRegistry;

    address public owner = address(0x1);
    address public oracle = address(0x2);
    address public user1 = address(0x3);
    address public user2 = address(0x4);

    uint256 public oraclePrivateKey = 0xA11CE;

    function setUp() public {
        vm.startPrank(owner);

        // Deploy registries
        identityRegistry = new IdentityRegistry();
        validationRegistry = new ValidationRegistry(payable(address(identityRegistry)));

        // Get oracle address from private key
        address derivedOracle = vm.addr(oraclePrivateKey);

        // Deploy provider
        provider = new GitHubReputationProvider(
            address(validationRegistry),
            address(identityRegistry),
            derivedOracle,
            owner
        );

        vm.stopPrank();

        // Register user1 as an agent
        vm.prank(user1);
        identityRegistry.register("ipfs://test-agent-1");
    }

    function testSubmitAttestation() public {
        uint256 agentId = 1;
        uint8 score = 75;
        uint256 totalScore = 15000;
        uint256 mergedPrs = 50;
        uint256 totalCommits = 200;
        uint256 timestamp = block.timestamp;

        // Create attestation hash
        bytes32 attestationHash = keccak256(
            abi.encodePacked(
                user1,
                agentId,
                score,
                totalScore,
                mergedPrs,
                totalCommits,
                timestamp,
                block.chainid,
                address(provider)
            )
        );

        // Sign with oracle
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", attestationHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Submit attestation
        vm.prank(user1);
        provider.submitAttestation(
            agentId,
            score,
            totalScore,
            mergedPrs,
            totalCommits,
            timestamp,
            signature
        );

        // Verify attestation stored
        (uint8 storedScore, bool isValid, uint256 lastUpdated) = provider.getAgentReputation(agentId);
        assertEq(storedScore, score);
        assertTrue(isValid);
        assertGt(lastUpdated, 0);

        // Verify stake discount
        uint256 discount = provider.getStakeDiscount(user1);
        assertEq(discount, 3500); // 35% for score 71-90
    }

    function testRejectInvalidSignature() public {
        uint256 agentId = 1;
        uint8 score = 75;
        uint256 totalScore = 15000;
        uint256 mergedPrs = 50;
        uint256 totalCommits = 200;
        uint256 timestamp = block.timestamp;

        // Create fake signature
        bytes memory fakeSignature = abi.encodePacked(
            keccak256("fake_r"),
            keccak256("fake_s"),
            uint8(27)
        );

        // Should revert
        vm.prank(user1);
        vm.expectRevert(GitHubReputationProvider.InvalidSignature.selector);
        provider.submitAttestation(
            agentId,
            score,
            totalScore,
            mergedPrs,
            totalCommits,
            timestamp,
            fakeSignature
        );
    }

    function testRejectExpiredAttestation() public {
        // Warp to the future to avoid underflow
        vm.warp(block.timestamp + 30 days);

        uint256 agentId = 1;
        uint8 score = 75;
        uint256 totalScore = 15000;
        uint256 mergedPrs = 50;
        uint256 totalCommits = 200;
        uint256 timestamp = block.timestamp - 8 days; // Expired (8 days ago)

        bytes32 attestationHash = keccak256(
            abi.encodePacked(
                user1,
                agentId,
                score,
                totalScore,
                mergedPrs,
                totalCommits,
                timestamp,
                block.chainid,
                address(provider)
            )
        );

        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", attestationHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(user1);
        vm.expectRevert(GitHubReputationProvider.AttestationExpired.selector);
        provider.submitAttestation(
            agentId,
            score,
            totalScore,
            mergedPrs,
            totalCommits,
            timestamp,
            signature
        );
    }

    function testRejectNonOwner() public {
        uint256 agentId = 1; // Owned by user1
        uint8 score = 75;
        uint256 totalScore = 15000;
        uint256 mergedPrs = 50;
        uint256 totalCommits = 200;
        uint256 timestamp = block.timestamp;

        bytes32 attestationHash = keccak256(
            abi.encodePacked(
                user2, // Wrong user
                agentId,
                score,
                totalScore,
                mergedPrs,
                totalCommits,
                timestamp,
                block.chainid,
                address(provider)
            )
        );

        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", attestationHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // user2 tries to submit for agent owned by user1
        vm.prank(user2);
        vm.expectRevert(GitHubReputationProvider.AgentNotOwned.selector);
        provider.submitAttestation(
            agentId,
            score,
            totalScore,
            mergedPrs,
            totalCommits,
            timestamp,
            signature
        );
    }

    function testStakeDiscountTiers() public {
        // Score 30-50: 10%
        _submitAttestationWithScore(30);
        assertEq(provider.getStakeDiscount(user1), 1000);

        // Score 51-70: 20%
        _submitAttestationWithScore(55);
        assertEq(provider.getStakeDiscount(user1), 2000);

        // Score 71-90: 35%
        _submitAttestationWithScore(80);
        assertEq(provider.getStakeDiscount(user1), 3500);

        // Score 91-100: 50%
        _submitAttestationWithScore(95);
        assertEq(provider.getStakeDiscount(user1), 5000);

        // Score < 30: 0%
        _submitAttestationWithScore(20);
        assertEq(provider.getStakeDiscount(user1), 0);
    }

    function testLinkProfile() public {
        vm.prank(owner);
        provider.linkProfile(user2, "testuser", 0);

        GitHubReputationProvider.GitHubProfile memory profile = provider.getProfile(user2);
        assertEq(profile.username, "testuser");
        assertTrue(profile.isLinked);
    }

    function testInvalidateAttestation() public {
        _submitAttestationWithScore(75);

        // Verify it's valid
        (uint8 score,, ) = provider.getAgentReputation(1);
        assertEq(score, 75);

        // Invalidate
        vm.prank(owner);
        provider.invalidateAttestation(user1);

        // Check hasReputationBoost returns false
        (bool hasBoost, ) = provider.hasReputationBoost(user1);
        assertFalse(hasBoost);
    }

    function _submitAttestationWithScore(uint8 score) internal {
        uint256 agentId = 1;
        uint256 totalScore = uint256(score) * 100;
        uint256 mergedPrs = 50;
        uint256 totalCommits = 200;
        uint256 timestamp = block.timestamp;

        bytes32 attestationHash = keccak256(
            abi.encodePacked(
                user1,
                agentId,
                score,
                totalScore,
                mergedPrs,
                totalCommits,
                timestamp,
                block.chainid,
                address(provider)
            )
        );

        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", attestationHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(user1);
        provider.submitAttestation(
            agentId,
            score,
            totalScore,
            mergedPrs,
            totalCommits,
            timestamp,
            signature
        );
    }
}
