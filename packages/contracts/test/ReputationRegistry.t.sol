// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/registry/ReputationRegistry.sol";
import {IIdentityRegistry} from "../src/registry/interfaces/IIdentityRegistry.sol";

/**
 * @title ReputationRegistryTest
 * @notice Comprehensive tests for ERC-8004 Reputation Registry
 * @dev Tests feedback system, signatures, aggregation, and revocation
 */
contract ReputationRegistryTest is Test {
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;

    address public serviceOwner = address(0x1);
    address public client1 = address(0x2);
    address public client2 = address(0x3);
    address public client3 = address(0x4);

    uint256 public serviceId;
    uint256 serviceOwnerPK = 0x1234;

    function setUp() public {
        // Deploy registries
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));

        // Register a service
        vm.prank(serviceOwner);
        serviceId = identityRegistry.register("ipfs://service-config");

        // Set service owner private key for signing
        serviceOwner = vm.addr(serviceOwnerPK);

        // Re-register with correct owner
        vm.prank(serviceOwner);
        serviceId = identityRegistry.register("ipfs://tee-service");
    }

    // ============ Signature Helper ============

    function createFeedbackAuth(uint256 agentId, address clientAddress, uint64 indexLimit, uint256 expiry)
        internal
        view
        returns (bytes memory)
    {
        // Create struct hash as per ERC-8004 spec
        bytes32 structHash = keccak256(
            abi.encode(
                agentId, clientAddress, indexLimit, expiry, block.chainid, address(identityRegistry), serviceOwner
            )
        );

        // EIP-191 personal sign format
        bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", structHash));

        // Sign with service owner's key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(serviceOwnerPK, messageHash);

        // Encode struct (224 bytes = 7 fields * 32 bytes)
        bytes memory structData = abi.encode(
            agentId, clientAddress, indexLimit, expiry, block.chainid, address(identityRegistry), serviceOwner
        );

        // Append signature (65 bytes: r + s + v)
        bytes memory signature = abi.encodePacked(r, s, v);

        // Return: structData (224 bytes) + signature (65 bytes) = 289 bytes
        return bytes.concat(structData, signature);
    }

    // ============ Basic Feedback Tests ============

    function testGiveFeedback() public {
        bytes memory feedbackAuth = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(
            serviceId,
            95,
            bytes32("quality"),
            bytes32("fast"),
            "ipfs://feedback-details",
            keccak256("feedback-data"),
            feedbackAuth
        );

        // Verify feedback stored
        (uint8 score, bytes32 tag1, bytes32 tag2, bool isRevoked) =
            reputationRegistry.readFeedback(serviceId, client1, 1);

        assertEq(score, 95);
        assertEq(tag1, bytes32("quality"));
        assertEq(tag2, bytes32("fast"));
        assertFalse(isRevoked);
    }

    function testGiveMultipleFeedback() public {
        bytes memory auth1 = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);
        bytes memory auth2 = createFeedbackAuth(serviceId, client2, 10, block.timestamp + 1 days);
        bytes memory auth3 = createFeedbackAuth(serviceId, client3, 10, block.timestamp + 1 days);

        // Multiple clients give feedback
        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32("quality"), bytes32(0), "", bytes32(0), auth1);

        vm.prank(client2);
        reputationRegistry.giveFeedback(serviceId, 85, bytes32("speed"), bytes32(0), "", bytes32(0), auth2);

        vm.prank(client3);
        reputationRegistry.giveFeedback(serviceId, 90, bytes32("reliability"), bytes32(0), "", bytes32(0), auth3);

        // Check summary
        address[] memory clients = new address[](0);
        (uint64 count, uint8 avgScore) = reputationRegistry.getSummary(serviceId, clients, bytes32(0), bytes32(0));

        assertEq(count, 3);
        assertEq(avgScore, 90); // (95 + 85 + 90) / 3 = 90
    }

    function testScoreValidation() public {
        bytes memory auth = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);

        // Score must be 0-100
        vm.prank(client1);
        vm.expectRevert("Score must be 0-100");
        reputationRegistry.giveFeedback(
            serviceId,
            101, // Invalid!
            bytes32(0),
            bytes32(0),
            "",
            bytes32(0),
            auth
        );

        // Score 0 is valid
        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 0, bytes32(0), bytes32(0), "", bytes32(0), auth);

        // Score 100 is valid
        bytes memory auth2 = createFeedbackAuth(serviceId, client2, 10, block.timestamp + 1 days);
        vm.prank(client2);
        reputationRegistry.giveFeedback(serviceId, 100, bytes32(0), bytes32(0), "", bytes32(0), auth2);
    }

    // ============ Revocation Tests ============

    function testRevokeFeedback() public {
        bytes memory auth = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32("quality"), bytes32(0), "", bytes32(0), auth);

        // Client revokes their feedback
        vm.prank(client1);
        reputationRegistry.revokeFeedback(serviceId, 1);

        // Check it's revoked
        (,,, bool isRevoked) = reputationRegistry.readFeedback(serviceId, client1, 1);
        assertTrue(isRevoked);

        // Revoked feedback not counted in summary
        address[] memory noClients = new address[](0);
        (uint64 count,) = reputationRegistry.getSummary(serviceId, noClients, bytes32(0), bytes32(0));

        assertEq(count, 0); // Revoked feedback excluded
    }

    function testOnlyClientCanRevoke() public {
        bytes memory auth = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32(0), bytes32(0), "", bytes32(0), auth);

        // Other client can't revoke (feedback doesn't exist for them)
        vm.prank(client2);
        vm.expectRevert("Invalid index");
        reputationRegistry.revokeFeedback(serviceId, 1);

        // Service owner can't revoke (feedback doesn't exist for them)
        vm.prank(serviceOwner);
        vm.expectRevert("Invalid index");
        reputationRegistry.revokeFeedback(serviceId, 1);

        // Client1 can revoke their own
        vm.prank(client1);
        reputationRegistry.revokeFeedback(serviceId, 1);
    }

    // ============ Response Tests ============

    function testAppendResponse() public {
        bytes memory auth = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);

        // Client gives feedback
        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 80, bytes32("issue"), bytes32(0), "", bytes32(0), auth);

        // Service owner responds
        vm.prank(serviceOwner);
        reputationRegistry.appendResponse(serviceId, client1, 1, "ipfs://our-response", keccak256("response-data"));

        // Check response count
        address[] memory responders = new address[](1);
        responders[0] = serviceOwner;

        uint64 responseCount = reputationRegistry.getResponseCount(serviceId, client1, 1, responders);

        assertEq(responseCount, 1);
    }

    function testMultipleResponses() public {
        bytes memory auth = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 70, bytes32("slow"), bytes32(0), "", bytes32(0), auth);

        // Multiple parties respond
        vm.prank(serviceOwner);
        reputationRegistry.appendResponse(serviceId, client1, 1, "ipfs://owner-response", bytes32(0));

        vm.prank(client2);
        reputationRegistry.appendResponse(serviceId, client1, 1, "ipfs://client2-response", bytes32(0));

        vm.prank(client3);
        reputationRegistry.appendResponse(serviceId, client1, 1, "ipfs://client3-response", bytes32(0));

        // Check responses by responder
        address[] memory responders = new address[](3);
        responders[0] = serviceOwner;
        responders[1] = client2;
        responders[2] = client3;

        uint64 serviceOwnerResponses = reputationRegistry.getResponseCount(serviceId, client1, 1, responders);
        assertEq(serviceOwnerResponses, 3); // Each responder responded once
    }

    // ============ Aggregation Tests ============

    function testSummaryWithTagFilter() public {
        // Create feedback with different tags
        bytes memory auth1 = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);
        bytes memory auth2 = createFeedbackAuth(serviceId, client2, 10, block.timestamp + 1 days);
        bytes memory auth3 = createFeedbackAuth(serviceId, client3, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32("tee"), bytes32("secure"), "", bytes32(0), auth1);

        vm.prank(client2);
        reputationRegistry.giveFeedback(serviceId, 90, bytes32("tee"), bytes32("fast"), "", bytes32(0), auth2);

        vm.prank(client3);
        reputationRegistry.giveFeedback(serviceId, 85, bytes32("other"), bytes32("slow"), "", bytes32(0), auth3);

        // Filter by "tee" tag
        address[] memory noClients = new address[](0);
        (uint64 count, uint8 avgScore) = reputationRegistry.getSummary(serviceId, noClients, bytes32("tee"), bytes32(0));

        assertEq(count, 2); // Only 2 with "tee" tag
        assertEq(avgScore, 92); // (95 + 90) / 2
    }

    function testSummaryWithClientFilter() public {
        bytes memory auth1 = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);
        bytes memory auth2 = createFeedbackAuth(serviceId, client2, 10, block.timestamp + 1 days);
        bytes memory auth3 = createFeedbackAuth(serviceId, client3, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32(0), bytes32(0), "", bytes32(0), auth1);

        vm.prank(client2);
        reputationRegistry.giveFeedback(serviceId, 85, bytes32(0), bytes32(0), "", bytes32(0), auth2);

        vm.prank(client3);
        reputationRegistry.giveFeedback(serviceId, 75, bytes32(0), bytes32(0), "", bytes32(0), auth3);

        // Filter by specific clients
        address[] memory filteredClients = new address[](2);
        filteredClients[0] = client1;
        filteredClients[1] = client2;

        (uint64 count, uint8 avgScore) =
            reputationRegistry.getSummary(serviceId, filteredClients, bytes32(0), bytes32(0));

        assertEq(count, 2);
        assertEq(avgScore, 90); // (95 + 85) / 2
    }

    function testReadAllFeedback() public {
        bytes memory auth1 = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);
        bytes memory auth2 = createFeedbackAuth(serviceId, client2, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32("excellent"), bytes32("fast"), "", bytes32(0), auth1);

        vm.prank(client2);
        reputationRegistry.giveFeedback(serviceId, 85, bytes32("good"), bytes32("slow"), "", bytes32(0), auth2);

        // Read all feedback
        address[] memory noFilter = new address[](0);
        (address[] memory clients, uint8[] memory scores, bytes32[] memory tag1s,,) = reputationRegistry.readAllFeedback(
            serviceId,
            noFilter,
            bytes32(0),
            bytes32(0),
            false // Don't include revoked
        );

        assertEq(clients.length, 2);
        assertEq(scores.length, 2);
        assertEq(scores[0], 95);
        assertEq(scores[1], 85);
        assertEq(tag1s[0], bytes32("excellent"));
        assertEq(tag1s[1], bytes32("good"));
    }

    // ============ Authorization Tests ============

    function testCannotGiveFeedbackWithoutAuth() public {
        // Empty or invalid signature
        bytes memory invalidAuth = new bytes(289); // Wrong size

        vm.prank(client1);
        vm.expectRevert(); // Will revert during signature verification
        reputationRegistry.giveFeedback(serviceId, 95, bytes32(0), bytes32(0), "", bytes32(0), invalidAuth);
    }

    function testCannotExceedIndexLimit() public {
        // Auth allows only 2 feedback entries
        bytes memory auth = createFeedbackAuth(serviceId, client1, 2, block.timestamp + 1 days);

        // First feedback OK
        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32(0), bytes32(0), "", bytes32(0), auth);

        // Second feedback OK
        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 90, bytes32(0), bytes32(0), "", bytes32(0), auth);

        // Third feedback should fail
        vm.prank(client1);
        vm.expectRevert("Index limit exceeded");
        reputationRegistry.giveFeedback(serviceId, 85, bytes32(0), bytes32(0), "", bytes32(0), auth);
    }

    function testCannotUseExpiredAuth() public {
        // Auth expires immediately
        bytes memory auth = createFeedbackAuth(serviceId, client1, 10, block.timestamp);

        // Move forward in time
        vm.warp(block.timestamp + 1);

        vm.prank(client1);
        vm.expectRevert("Authorization expired");
        reputationRegistry.giveFeedback(serviceId, 95, bytes32(0), bytes32(0), "", bytes32(0), auth);
    }

    // ============ TEE Attestation Use Cases ============

    function testTEEServiceReputation() public {
        // Register TEE service
        vm.startPrank(serviceOwner);
        uint256 teeServiceId = identityRegistry.register("ipfs://tee-service");
        identityRegistry.setMetadata(teeServiceId, "type", abi.encode("tee-attestation"));
        identityRegistry.setMetadata(teeServiceId, "provider", abi.encode("Intel SGX"));
        vm.stopPrank();

        // Multiple clients attest to TEE security
        bytes memory auth1 = createFeedbackAuth(teeServiceId, client1, 10, block.timestamp + 1 days);
        bytes memory auth2 = createFeedbackAuth(teeServiceId, client2, 10, block.timestamp + 1 days);
        bytes memory auth3 = createFeedbackAuth(teeServiceId, client3, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(
            teeServiceId, 100, bytes32("tee-verified"), bytes32("sgx"), "", bytes32(0), auth1
        );

        vm.prank(client2);
        reputationRegistry.giveFeedback(
            teeServiceId, 98, bytes32("tee-verified"), bytes32("sgx"), "", bytes32(0), auth2
        );

        vm.prank(client3);
        reputationRegistry.giveFeedback(
            teeServiceId, 100, bytes32("tee-verified"), bytes32("sgx"), "", bytes32(0), auth3
        );

        // Get TEE-specific summary
        address[] memory noFilter = new address[](0);
        (uint64 count, uint8 avgScore) =
            reputationRegistry.getSummary(teeServiceId, noFilter, bytes32("tee-verified"), bytes32(0));

        assertEq(count, 3);
        assertEq(avgScore, 99); // (100 + 98 + 100) / 3

        // Service can display: "TEE Verified - 99/100 ⭐⭐⭐⭐⭐"
    }

    function testServiceDiscoveryByReputation() public {
        // Register multiple services
        vm.startPrank(serviceOwner);
        uint256 service1 = identityRegistry.register("ipfs://service1");
        identityRegistry.setMetadata(service1, "type", abi.encode("api"));

        uint256 service2 = identityRegistry.register("ipfs://service2");
        identityRegistry.setMetadata(service2, "type", abi.encode("api"));

        uint256 service3 = identityRegistry.register("ipfs://service3");
        identityRegistry.setMetadata(service3, "type", abi.encode("api"));
        vm.stopPrank();

        // Services get different ratings
        bytes memory auth1 = createFeedbackAuth(service1, client1, 10, block.timestamp + 1 days);
        bytes memory auth2 = createFeedbackAuth(service2, client1, 10, block.timestamp + 1 days);
        bytes memory auth3 = createFeedbackAuth(service3, client1, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(service1, 95, bytes32("api"), bytes32(0), "", bytes32(0), auth1);

        vm.prank(client1);
        reputationRegistry.giveFeedback(service2, 70, bytes32("api"), bytes32(0), "", bytes32(0), auth2);

        vm.prank(client1);
        reputationRegistry.giveFeedback(service3, 85, bytes32("api"), bytes32(0), "", bytes32(0), auth3);

        // Query each service reputation
        address[] memory noFilter = new address[](0);

        (, uint8 score1) = reputationRegistry.getSummary(service1, noFilter, bytes32(0), bytes32(0));
        (, uint8 score2) = reputationRegistry.getSummary(service2, noFilter, bytes32(0), bytes32(0));
        (, uint8 score3) = reputationRegistry.getSummary(service3, noFilter, bytes32(0), bytes32(0));

        // Can sort by score for discovery
        assertTrue(score1 > score3); // 95 > 85
        assertTrue(score3 > score2); // 85 > 70

        // Frontend can show: "Best Rated APIs: Service1 (95), Service3 (85), Service2 (70)"
    }

    // ============ Helper Function Tests ============

    function testGetClients() public {
        bytes memory auth1 = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);
        bytes memory auth2 = createFeedbackAuth(serviceId, client2, 10, block.timestamp + 1 days);

        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32(0), bytes32(0), "", bytes32(0), auth1);

        vm.prank(client2);
        reputationRegistry.giveFeedback(serviceId, 85, bytes32(0), bytes32(0), "", bytes32(0), auth2);

        address[] memory clients = reputationRegistry.getClients(serviceId);
        assertEq(clients.length, 2);
        assertEq(clients[0], client1);
        assertEq(clients[1], client2);
    }

    function testGetLastIndex() public {
        bytes memory auth = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);

        // Give multiple feedback
        vm.startPrank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32(0), bytes32(0), "", bytes32(0), auth);
        reputationRegistry.giveFeedback(serviceId, 90, bytes32(0), bytes32(0), "", bytes32(0), auth);
        reputationRegistry.giveFeedback(serviceId, 92, bytes32(0), bytes32(0), "", bytes32(0), auth);
        vm.stopPrank();

        uint64 lastIndex = reputationRegistry.getLastIndex(serviceId, client1);
        assertEq(lastIndex, 3);
    }

    function testGetIdentityRegistry() public view {
        assertEq(reputationRegistry.getIdentityRegistry(), address(identityRegistry));
    }

    function testVersion() public view {
        assertEq(reputationRegistry.version(), "1.0.0");
    }

    // ============ Edge Cases ============

    function testFeedbackForNonExistentService() public {
        bytes memory auth = createFeedbackAuth(999, client1, 10, block.timestamp + 1 days);

        vm.prank(client1);
        vm.expectRevert("Agent does not exist");
        reputationRegistry.giveFeedback(999, 95, bytes32(0), bytes32(0), "", bytes32(0), auth);
    }

    function testRevokeNonExistentFeedback() public {
        vm.prank(client1);
        vm.expectRevert("Invalid index");
        reputationRegistry.revokeFeedback(serviceId, 999);
    }

    function testAppendResponseToNonExistentFeedback() public {
        vm.prank(serviceOwner);
        vm.expectRevert("Invalid index");
        reputationRegistry.appendResponse(serviceId, client1, 999, "ipfs://response", bytes32(0));
    }

    function testEmptyURIAllowed() public {
        bytes memory auth = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);

        // Empty URI is OK
        vm.prank(client1);
        reputationRegistry.giveFeedback(serviceId, 95, bytes32(0), bytes32(0), "", bytes32(0), auth);

        (uint8 score,,,) = reputationRegistry.readFeedback(serviceId, client1, 1);
        assertEq(score, 95);
    }

    // ============ Real-World Scenario Tests ============

    function testCompleteServiceReputationLifecycle() public {
        // 1. Service gets initial feedback
        bytes memory auth1 = createFeedbackAuth(serviceId, client1, 10, block.timestamp + 1 days);
        vm.prank(client1);
        reputationRegistry.giveFeedback(
            serviceId, 95, bytes32("quality"), bytes32(0), "ipfs://review1", keccak256("data1"), auth1
        );

        // 2. Service responds to feedback
        vm.prank(serviceOwner);
        reputationRegistry.appendResponse(serviceId, client1, 1, "ipfs://thanks", bytes32(0));

        // 3. More feedback comes in
        bytes memory auth2 = createFeedbackAuth(serviceId, client2, 10, block.timestamp + 1 days);
        vm.prank(client2);
        reputationRegistry.giveFeedback(
            serviceId, 90, bytes32("quality"), bytes32(0), "ipfs://review2", keccak256("data2"), auth2
        );

        // 4. One client has issue and gives low score
        bytes memory auth3 = createFeedbackAuth(serviceId, client3, 10, block.timestamp + 1 days);
        vm.prank(client3);
        reputationRegistry.giveFeedback(
            serviceId, 60, bytes32("issue"), bytes32("downtime"), "ipfs://complaint", keccak256("data3"), auth3
        );

        // 5. Service responds to complaint
        vm.prank(serviceOwner);
        reputationRegistry.appendResponse(serviceId, client3, 1, "ipfs://fix-applied", keccak256("fix"));

        // 6. Client updates feedback after fix (new feedback entry)
        vm.prank(client3);
        reputationRegistry.giveFeedback(
            serviceId, 85, bytes32("improved"), bytes32("fixed"), "ipfs://updated", keccak256("data4"), auth3
        );

        // 7. Client revokes original complaint
        vm.prank(client3);
        reputationRegistry.revokeFeedback(serviceId, 1);

        // 8. Calculate current reputation (excluding revoked)
        address[] memory noFilter = new address[](0);
        (uint64 count, uint8 avgScore) = reputationRegistry.getSummary(serviceId, noFilter, bytes32(0), bytes32(0));

        assertEq(count, 3); // 3 non-revoked feedbacks
        assertEq(avgScore, 90); // (95 + 90 + 85) / 3

        // Result: Service reputation improved after addressing complaint!
    }
}
