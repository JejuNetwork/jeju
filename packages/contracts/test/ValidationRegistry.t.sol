// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";
import {ValidationRegistry} from "../src/registry/ValidationRegistry.sol";

/**
 * @title ValidationRegistryTest
 * @notice Comprehensive tests for ERC-8004 Validation Registry
 * @dev Tests validation requests, responses, TEE attestation, and aggregation
 */
contract ValidationRegistryTest is Test {
    IdentityRegistry public identityRegistry;
    ValidationRegistry public validationRegistry;

    address public serviceOwner = address(0x1);
    address public teeValidator = address(0x2);
    address public zkMLValidator = address(0x3);
    address public stakeValidator = address(0x4);
    address public randomUser = address(0x5);

    uint256 public serviceId;

    function setUp() public {
        // Deploy registries
        identityRegistry = new IdentityRegistry();
        validationRegistry = new ValidationRegistry(payable(address(identityRegistry)));

        // Register a service for testing
        vm.prank(serviceOwner);
        serviceId = identityRegistry.register("ipfs://test-service");
    }

    // ============ Validation Request Tests ============

    function testValidationRequest() public {
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(
            teeValidator, serviceId, "ipfs://validation-request", keccak256("request-data")
        );

        // Check request was stored
        bytes32[] memory validations = validationRegistry.getAgentValidations(serviceId);
        assertEq(validations.length, 1);

        bytes32 requestHash = validations[0];
        assertTrue(validationRegistry.requestExists(requestHash));

        // Check request details
        (address validatorAddr, uint256 agentId, string memory requestUri, uint256 timestamp) =
            validationRegistry.getRequest(requestHash);

        assertEq(validatorAddr, teeValidator);
        assertEq(agentId, serviceId);
        assertEq(requestUri, "ipfs://validation-request");
        assertGt(timestamp, 0);
    }

    function testMultipleValidationRequests() public {
        vm.startPrank(serviceOwner);

        // Request from TEE validator
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://tee-validation", keccak256("tee-data"));

        // Request from zkML validator
        validationRegistry.validationRequest(zkMLValidator, serviceId, "ipfs://zkml-validation", keccak256("zkml-data"));

        // Request from stake validator
        validationRegistry.validationRequest(
            stakeValidator, serviceId, "ipfs://stake-validation", keccak256("stake-data")
        );

        vm.stopPrank();

        // Service should have 3 validations
        bytes32[] memory validations = validationRegistry.getAgentValidations(serviceId);
        assertEq(validations.length, 3);
    }

    function testOnlyOwnerCanRequestValidation() public {
        // Non-owner cannot request validation
        vm.prank(randomUser);
        vm.expectRevert("Not authorized");
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://unauthorized", keccak256("data"));

        // Owner can request
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://authorized", keccak256("data"));

        assertEq(validationRegistry.getAgentValidations(serviceId).length, 1);
    }

    function testCannotRequestForNonExistentService() public {
        vm.prank(serviceOwner);
        vm.expectRevert("Agent does not exist");
        validationRegistry.validationRequest(
            teeValidator,
            999, // Non-existent
            "ipfs://request",
            keccak256("data")
        );
    }

    function testCannotRequestWithEmptyURI() public {
        vm.prank(serviceOwner);
        vm.expectRevert("Empty request URI");
        validationRegistry.validationRequest(
            teeValidator,
            serviceId,
            "", // Empty!
            keccak256("data")
        );
    }

    function testCannotRequestWithZeroValidator() public {
        vm.prank(serviceOwner);
        vm.expectRevert("Invalid validator address");
        validationRegistry.validationRequest(
            address(0), // Invalid!
            serviceId,
            "ipfs://request",
            keccak256("data")
        );
    }

    // ============ Validation Response Tests ============

    function testValidationResponse() public {
        // Create validation request
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://tee-request", keccak256("request"));

        bytes32 requestHash = validationRegistry.getAgentValidations(serviceId)[0];

        // Validator responds
        vm.prank(teeValidator);
        validationRegistry.validationResponse(
            requestHash,
            100, // Fully validated
            "ipfs://tee-attestation",
            keccak256("attestation"),
            bytes32("tee-verified")
        );

        // Check response
        (address validatorAddr, uint256 agentId, uint8 response, bytes32 tag, uint256 lastUpdate) =
            validationRegistry.getValidationStatus(requestHash);

        assertEq(validatorAddr, teeValidator);
        assertEq(agentId, serviceId);
        assertEq(response, 100);
        assertEq(tag, bytes32("tee-verified"));
        assertGt(lastUpdate, 0);
    }

    function testProgressiveValidation() public {
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://request", keccak256("data"));

        bytes32 requestHash = validationRegistry.getAgentValidations(serviceId)[0];

        // Initial response (partial validation)
        vm.prank(teeValidator);
        validationRegistry.validationResponse(requestHash, 50, "ipfs://partial", bytes32(0), bytes32("in-progress"));

        (,, uint8 response1, bytes32 tag1,) = validationRegistry.getValidationStatus(requestHash);
        assertEq(response1, 50);
        assertEq(tag1, bytes32("in-progress"));

        // Update to fully validated
        vm.prank(teeValidator);
        validationRegistry.validationResponse(requestHash, 100, "ipfs://complete", bytes32(0), bytes32("verified"));

        (,, uint8 response2, bytes32 tag2,) = validationRegistry.getValidationStatus(requestHash);
        assertEq(response2, 100);
        assertEq(tag2, bytes32("verified"));
    }

    function testOnlyValidatorCanRespond() public {
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://request", keccak256("data"));

        bytes32 requestHash = validationRegistry.getAgentValidations(serviceId)[0];

        // Wrong validator can't respond
        vm.prank(zkMLValidator);
        vm.expectRevert("Not authorized validator");
        validationRegistry.validationResponse(requestHash, 100, "ipfs://response", bytes32(0), bytes32("tag"));

        // Correct validator can respond
        vm.prank(teeValidator);
        validationRegistry.validationResponse(requestHash, 100, "ipfs://response", bytes32(0), bytes32("tag"));
    }

    function testResponseMustBe0to100() public {
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://request", keccak256("data"));

        bytes32 requestHash = validationRegistry.getAgentValidations(serviceId)[0];

        // Invalid response score
        vm.prank(teeValidator);
        vm.expectRevert("Response must be 0-100");
        validationRegistry.validationResponse(
            requestHash,
            101, // Invalid!
            "ipfs://response",
            bytes32(0),
            bytes32("tag")
        );

        // Valid scores
        vm.prank(teeValidator);
        validationRegistry.validationResponse(requestHash, 0, "", bytes32(0), bytes32(0));

        vm.prank(teeValidator);
        validationRegistry.validationResponse(requestHash, 100, "", bytes32(0), bytes32(0));
    }

    // ============ TEE Attestation Tests ============

    function testTEEAttestationWorkflow() public {
        // Service requests TEE attestation
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(
            teeValidator,
            serviceId,
            "ipfs://sgx-code-package",
            keccak256(abi.encodePacked("source-code", "config", "dependencies"))
        );

        bytes32 requestHash = validationRegistry.getAgentValidations(serviceId)[0];

        // TEE provider validates the code
        vm.prank(teeValidator);
        validationRegistry.validationResponse(
            requestHash,
            100, // Fully validated
            "ipfs://sgx-attestation-report",
            keccak256("attestation-report"),
            bytes32("sgx-verified")
        );

        // Service can now display "TEE Verified ✓" badge
        (,, uint8 validationScore, bytes32 attestationType,) = validationRegistry.getValidationStatus(requestHash);

        assertEq(validationScore, 100);
        assertEq(attestationType, bytes32("sgx-verified"));
    }

    function testMultipleTEEProviders() public {
        // Service requests validation from multiple TEE providers
        vm.startPrank(serviceOwner);

        validationRegistry.validationRequest(
            teeValidator, // Intel SGX
            serviceId,
            "ipfs://sgx-package",
            keccak256("sgx-data")
        );

        validationRegistry.validationRequest(
            zkMLValidator, // AMD SEV
            serviceId,
            "ipfs://sev-package",
            keccak256("sev-data")
        );

        validationRegistry.validationRequest(
            stakeValidator, // ARM TrustZone
            serviceId,
            "ipfs://trustzone-package",
            keccak256("tz-data")
        );

        vm.stopPrank();

        // Get all validations
        bytes32[] memory validations = validationRegistry.getAgentValidations(serviceId);
        assertEq(validations.length, 3);

        // Each validator responds
        vm.prank(teeValidator);
        validationRegistry.validationResponse(validations[0], 100, "", bytes32(0), bytes32("sgx"));

        vm.prank(zkMLValidator);
        validationRegistry.validationResponse(validations[1], 98, "", bytes32(0), bytes32("sev"));

        vm.prank(stakeValidator);
        validationRegistry.validationResponse(validations[2], 95, "", bytes32(0), bytes32("trustzone"));

        // Get summary
        address[] memory noFilter = new address[](0);
        (uint64 count, uint8 avgResponse) = validationRegistry.getSummary(serviceId, noFilter, bytes32(0));

        assertEq(count, 3);
        assertEq(avgResponse, 97); // (100 + 98 + 95) / 3 = 97.67 → 97
    }

    // ============ Aggregation Tests ============

    function testSummaryWithValidatorFilter() public {
        // Create multiple validation requests
        vm.startPrank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://req1", keccak256("d1"));
        validationRegistry.validationRequest(zkMLValidator, serviceId, "ipfs://req2", keccak256("d2"));
        validationRegistry.validationRequest(stakeValidator, serviceId, "ipfs://req3", keccak256("d3"));
        vm.stopPrank();

        bytes32[] memory validations = validationRegistry.getAgentValidations(serviceId);

        // Validators respond
        vm.prank(teeValidator);
        validationRegistry.validationResponse(validations[0], 100, "", bytes32(0), bytes32("tee"));

        vm.prank(zkMLValidator);
        validationRegistry.validationResponse(validations[1], 80, "", bytes32(0), bytes32("zkml"));

        vm.prank(stakeValidator);
        validationRegistry.validationResponse(validations[2], 90, "", bytes32(0), bytes32("stake"));

        // Filter by specific validators (only TEE and zkML)
        address[] memory filteredValidators = new address[](2);
        filteredValidators[0] = teeValidator;
        filteredValidators[1] = zkMLValidator;

        (uint64 count, uint8 avgResponse) = validationRegistry.getSummary(serviceId, filteredValidators, bytes32(0));

        assertEq(count, 2);
        assertEq(avgResponse, 90); // (100 + 80) / 2
    }

    function testSummaryWithTagFilter() public {
        vm.startPrank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://req1", keccak256("d1"));
        validationRegistry.validationRequest(zkMLValidator, serviceId, "ipfs://req2", keccak256("d2"));
        vm.stopPrank();

        bytes32[] memory validations = validationRegistry.getAgentValidations(serviceId);

        // Validators respond with different tags
        vm.prank(teeValidator);
        validationRegistry.validationResponse(validations[0], 100, "", bytes32(0), bytes32("tee-verified"));

        vm.prank(zkMLValidator);
        validationRegistry.validationResponse(validations[1], 95, "", bytes32(0), bytes32("zkml-verified"));

        // Filter by TEE tag only
        address[] memory noFilter = new address[](0);
        (uint64 count, uint8 avgResponse) = validationRegistry.getSummary(serviceId, noFilter, bytes32("tee-verified"));

        assertEq(count, 1);
        assertEq(avgResponse, 100);
    }

    // ============ Validator Tracking Tests ============

    function testGetValidatorRequests() public {
        // Same validator validates multiple services
        vm.startPrank(serviceOwner);
        uint256 service2 = identityRegistry.register("ipfs://service2");
        uint256 service3 = identityRegistry.register("ipfs://service3");
        vm.stopPrank();

        // All request same validator
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://req1", keccak256("d1"));

        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, service2, "ipfs://req2", keccak256("d2"));

        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, service3, "ipfs://req3", keccak256("d3"));

        // Validator should have 3 requests
        bytes32[] memory requests = validationRegistry.getValidatorRequests(teeValidator);
        assertEq(requests.length, 3);
    }

    function testRequestExistence() public {
        bytes32 randomHash = keccak256("random");
        assertFalse(validationRegistry.requestExists(randomHash));

        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://request", keccak256("data"));

        bytes32 requestHash = validationRegistry.getAgentValidations(serviceId)[0];
        assertTrue(validationRegistry.requestExists(requestHash));
    }

    // ============ Service Discovery Tests ============

    function testServiceDiscoveryByValidation() public {
        // Register multiple services
        vm.startPrank(serviceOwner);
        uint256 service1 = identityRegistry.register("ipfs://service1");
        identityRegistry.setMetadata(service1, "type", abi.encode("api"));

        uint256 service2 = identityRegistry.register("ipfs://service2");
        identityRegistry.setMetadata(service2, "type", abi.encode("api"));

        uint256 service3 = identityRegistry.register("ipfs://service3");
        identityRegistry.setMetadata(service3, "type", abi.encode("api"));
        vm.stopPrank();

        // Services request TEE validation
        vm.startPrank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, service1, "ipfs://r1", keccak256("d1"));
        validationRegistry.validationRequest(teeValidator, service2, "ipfs://r2", keccak256("d2"));
        validationRegistry.validationRequest(teeValidator, service3, "ipfs://r3", keccak256("d3"));
        vm.stopPrank();

        // TEE validator validates all
        bytes32 req1 = validationRegistry.getAgentValidations(service1)[0];
        bytes32 req2 = validationRegistry.getAgentValidations(service2)[0];
        bytes32 req3 = validationRegistry.getAgentValidations(service3)[0];

        vm.startPrank(teeValidator);
        validationRegistry.validationResponse(req1, 100, "", bytes32(0), bytes32("verified"));
        validationRegistry.validationResponse(req2, 85, "", bytes32(0), bytes32("verified"));
        validationRegistry.validationResponse(req3, 95, "", bytes32(0), bytes32("verified"));
        vm.stopPrank();

        // Frontend can query and sort by validation score
        address[] memory noFilter = new address[](0);

        (, uint8 score1) = validationRegistry.getSummary(service1, noFilter, bytes32(0));
        (, uint8 score2) = validationRegistry.getSummary(service2, noFilter, bytes32(0));
        (, uint8 score3) = validationRegistry.getSummary(service3, noFilter, bytes32(0));

        assertTrue(score1 > score3); // 100 > 95
        assertTrue(score3 > score2); // 95 > 85

        // Can show: "Top Validated Services: Service1 (100%), Service3 (95%), Service2 (85%)"
    }

    // ============ TEE-Specific Scenarios ============

    function testTEEAttestationRegistry() public {
        // Register TEE attestation service
        vm.startPrank(serviceOwner);
        uint256 teeServiceId = identityRegistry.register("ipfs://tee-attestation-service");
        identityRegistry.setMetadata(teeServiceId, "name", abi.encode("SGX Attestation Service"));
        identityRegistry.setMetadata(teeServiceId, "type", abi.encode("tee-attestation"));
        identityRegistry.setMetadata(teeServiceId, "provider", abi.encode("Intel SGX"));
        identityRegistry.setMetadata(teeServiceId, "enclave-version", abi.encode("v2.15"));
        vm.stopPrank();

        // Service itself gets validated by another TEE provider
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(
            teeValidator, teeServiceId, "ipfs://tee-service-code", keccak256("attestation-service-code")
        );

        bytes32 requestHash = validationRegistry.getAgentValidations(teeServiceId)[0];

        // TEE validator verifies the attestation service's enclave
        vm.prank(teeValidator);
        validationRegistry.validationResponse(
            requestHash, 100, "ipfs://enclave-measurement-report", keccak256("mrenclave-hash"), bytes32("sgx-attested")
        );

        // Verify TEE service is fully validated
        (,, uint8 validation, bytes32 tag,) = validationRegistry.getValidationStatus(requestHash);
        assertEq(validation, 100);
        assertEq(tag, bytes32("sgx-attested"));

        // TEE service can now be trusted to attest other services
    }

    // ============ Real-World Application Scenarios ============

    function testApplicationValidationPipeline() public {
        // DeFi app requests multiple validations
        vm.startPrank(serviceOwner);
        uint256 defiApp = identityRegistry.register("ipfs://defi-protocol");
        identityRegistry.setMetadata(defiApp, "type", abi.encode("defi-application"));
        identityRegistry.setMetadata(defiApp, "category", abi.encode("dex"));

        // Request different types of validation
        validationRegistry.validationRequest(
            teeValidator, defiApp, "ipfs://tee-security-audit", keccak256("security-audit")
        );

        validationRegistry.validationRequest(
            zkMLValidator, defiApp, "ipfs://zkml-proof", keccak256("zkml-verification")
        );

        validationRegistry.validationRequest(
            stakeValidator, defiApp, "ipfs://stake-based-audit", keccak256("audit-data")
        );
        vm.stopPrank();

        // All validators respond
        bytes32[] memory validations = validationRegistry.getAgentValidations(defiApp);

        vm.prank(teeValidator);
        validationRegistry.validationResponse(
            validations[0], 100, "ipfs://tee-report", bytes32(0), bytes32("tee-secure")
        );

        vm.prank(zkMLValidator);
        validationRegistry.validationResponse(
            validations[1], 95, "ipfs://zkml-proof", bytes32(0), bytes32("zkml-proven")
        );

        vm.prank(stakeValidator);
        validationRegistry.validationResponse(validations[2], 90, "ipfs://audit-report", bytes32(0), bytes32("audited"));

        // App can display multiple trust badges:
        // ✓ TEE Verified (100%)
        // ✓ zkML Proven (95%)
        // ✓ Audited (90%)

        address[] memory noFilter = new address[](0);
        (uint64 count, uint8 avgValidation) = validationRegistry.getSummary(defiApp, noFilter, bytes32(0));

        assertEq(count, 3);
        assertEq(avgValidation, 95); // (100 + 95 + 90) / 3
    }

    // ============ Helper Function Tests ============

    function testGetIdentityRegistry() public view {
        assertEq(validationRegistry.getIdentityRegistry(), address(identityRegistry));
    }

    function testVersion() public view {
        assertEq(validationRegistry.version(), "1.0.0");
    }

    // ============ Edge Cases ============

    function testResponseToNonExistentRequest() public {
        bytes32 fakeHash = keccak256("fake");

        vm.prank(teeValidator);
        vm.expectRevert("Request not found");
        validationRegistry.validationResponse(fakeHash, 100, "ipfs://response", bytes32(0), bytes32(0));
    }

    function testEmptyResponseURIAllowed() public {
        vm.prank(serviceOwner);
        validationRegistry.validationRequest(teeValidator, serviceId, "ipfs://request", keccak256("data"));

        bytes32 requestHash = validationRegistry.getAgentValidations(serviceId)[0];

        // Empty response URI is OK
        vm.prank(teeValidator);
        validationRegistry.validationResponse(
            requestHash,
            100,
            "", // Empty URI
            bytes32(0),
            bytes32("verified")
        );

        (,, uint8 response,,) = validationRegistry.getValidationStatus(requestHash);
        assertEq(response, 100);
    }

    function testServiceWithNoValidations() public {
        vm.prank(serviceOwner);
        uint256 newService = identityRegistry.register("ipfs://new-service");

        bytes32[] memory validations = validationRegistry.getAgentValidations(newService);
        assertEq(validations.length, 0);

        address[] memory noFilter = new address[](0);
        (uint64 count, uint8 avg) = validationRegistry.getSummary(newService, noFilter, bytes32(0));
        assertEq(count, 0);
        assertEq(avg, 0);
    }
}
