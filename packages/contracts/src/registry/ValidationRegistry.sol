// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import "./IdentityRegistry.sol";
import "./interfaces/IValidationRegistry.sol";

/**
 * @title ValidationRegistry
 * @dev ERC-8004 v1.0 Validation Registry - Reference Implementation
 * @notice Generic hooks for requesting and recording independent validation
 *
 * This contract implements the Validation Registry as specified in ERC-8004 v1.0.
 * It enables agents to request verification of their work and allows validator
 * smart contracts to provide responses that can be tracked on-chain.
 *
 * Key Features:
 * - Validation requests with URI and hash commitments
 * - Multiple responses per request (progressive validation)
 * - Tag-based categorization
 * - On-chain aggregation for composability
 * - Support for various validation methods (stake-secured, zkML, TEE)
 *
 * @author ChaosChain Labs
 */
contract ValidationRegistry is IValidationRegistry {
    // ============ Constants ============

    /// @notice Maximum URI length to prevent gas griefing
    uint256 public constant MAX_URI_LENGTH = 2048;

    // ============ Errors ============

    error URITooLong();

    // ============ State Variables ============

    /// @dev Reference to the IdentityRegistry
    IdentityRegistry public immutable identityRegistry;

    /// @dev Struct to store validation request data
    struct Request {
        address validatorAddress;
        uint256 agentId;
        string requestUri;
        bytes32 requestHash;
        uint256 timestamp;
    }

    /// @dev Struct to store validation response data
    struct Response {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 tag;
        uint256 lastUpdate;
    }

    /// @dev requestHash => Request
    mapping(bytes32 => Request) private _requests;

    /// @dev requestHash => Response
    mapping(bytes32 => Response) private _responses;

    /// @dev agentId => array of requestHashes
    mapping(uint256 => bytes32[]) private _agentValidations;

    /// @dev validatorAddress => array of requestHashes
    mapping(address => bytes32[]) private _validatorRequests;

    /// @dev requestHash => exists in arrays
    mapping(bytes32 => bool) private _requestExists;

    // ============ Constructor ============

    /**
     * @dev Constructor sets the identity registry reference
     * @param _identityRegistry Address of the IdentityRegistry contract
     */
    constructor(address payable _identityRegistry) {
        require(_identityRegistry != address(0), "Invalid registry address");
        identityRegistry = IdentityRegistry(_identityRegistry);
    }

    // ============ Core Functions ============

    /**
     * @notice Request validation for an agent's work
     * @dev Must be called by the owner or operator of the agent
     * @param validatorAddress The address of the validator (can be EOA or contract)
     * @param agentId The agent requesting validation
     * @param requestUri URI pointing to off-chain validation data
     * @param requestHash KECCAK-256 hash of request data (optional for IPFS)
     */
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestUri,
        bytes32 requestHash
    ) external {
        // Validate inputs
        require(validatorAddress != address(0), "Invalid validator address");
        require(bytes(requestUri).length > 0, "Empty request URI");
        if (bytes(requestUri).length > MAX_URI_LENGTH) revert URITooLong();
        require(identityRegistry.agentExists(agentId), "Agent does not exist");

        // Verify caller is owner or approved operator
        address agentOwner = identityRegistry.ownerOf(agentId);
        require(
            msg.sender == agentOwner || identityRegistry.isApprovedForAll(agentOwner, msg.sender)
                || identityRegistry.getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        // SECURITY: Prevent self-validation (defeats purpose of independent validation)
        // As per ERC-8004 v1.0 intent: "independent validators checks"
        require(validatorAddress != agentOwner, "Self-validation not allowed");
        require(validatorAddress != msg.sender, "Self-validation not allowed");

        // Generate requestHash if not provided (for non-IPFS URIs)
        bytes32 finalRequestHash = requestHash;
        if (finalRequestHash == bytes32(0)) {
            finalRequestHash =
                keccak256(abi.encodePacked(validatorAddress, agentId, requestUri, block.timestamp, msg.sender));
        }

        // SECURITY: Prevent requestHash hijacking
        // Once a request exists, it cannot be overwritten
        require(!_requestExists[finalRequestHash], "Request hash already exists");

        // Store request
        _requests[finalRequestHash] = Request({
            validatorAddress: validatorAddress,
            agentId: agentId,
            requestUri: requestUri,
            requestHash: finalRequestHash,
            timestamp: block.timestamp
        });

        // Add to tracking arrays
        _agentValidations[agentId].push(finalRequestHash);
        _validatorRequests[validatorAddress].push(finalRequestHash);
        _requestExists[finalRequestHash] = true;

        emit ValidationRequest(validatorAddress, agentId, requestUri, finalRequestHash);
    }

    /**
     * @notice Provide a validation response
     * @dev Must be called by the validator address specified in the request
     * @dev Can be called multiple times for progressive validation states
     * @param requestHash The hash of the validation request
     * @param response The validation result (0-100)
     * @param responseUri URI pointing to validation evidence (optional)
     * @param responseHash KECCAK-256 hash of response data (optional for IPFS)
     * @param tag Custom tag for categorization (optional)
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseUri,
        bytes32 responseHash,
        bytes32 tag
    ) external {
        // Validate response range
        require(response <= 100, "Response must be 0-100");

        // Prevent gas griefing (responseUri is optional)
        if (bytes(responseUri).length > MAX_URI_LENGTH) revert URITooLong();

        // Get request
        Request storage request = _requests[requestHash];
        require(request.validatorAddress != address(0), "Request not found");

        // Verify caller is the designated validator
        require(msg.sender == request.validatorAddress, "Not authorized validator");

        // Store or update response
        _responses[requestHash] = Response({
            validatorAddress: request.validatorAddress,
            agentId: request.agentId,
            response: response,
            tag: tag,
            lastUpdate: block.timestamp
        });

        emit ValidationResponse(
            request.validatorAddress, request.agentId, requestHash, response, responseUri, responseHash, tag
        );
    }

    // ============ Read Functions ============

    /**
     * @notice Get validation status for a request
     * @dev Returns default values (address(0), 0, 0, 0, 0) for pending requests without responses
     * @dev To distinguish pending from non-existent requests, check if request exists via _requestExists
     * @param requestHash The request hash
     * @return validatorAddress The validator address (address(0) if no response yet)
     * @return agentId The agent ID (0 if no response yet)
     * @return response The validation response (0-100, or 0 if no response yet)
     * @return tag The response tag (bytes32(0) if no response yet)
     * @return lastUpdate Timestamp of last update (0 if no response yet)
     */
    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 tag, uint256 lastUpdate)
    {
        Response storage resp = _responses[requestHash];

        // Return default values for pending requests (no revert)
        // This allows callers to distinguish between:
        // - Non-existent request: validatorAddress == 0 && !_requestExists[requestHash]
        // - Pending request: validatorAddress == 0 && _requestExists[requestHash]
        // - Responded request: validatorAddress != 0
        return (resp.validatorAddress, resp.agentId, resp.response, resp.tag, resp.lastUpdate);
    }

    /**
     * @notice Get aggregated validation summary for an agent
     * @dev IMPORTANT: This function is designed for OFF-CHAIN consumption.
     *      For agents with many validation requests, calling without filters may exceed gas limits.
     *      Use the `validatorAddresses` and/or `tag` filters for popular agents to prevent DoS.
     *      As per ERC-8004 v1.0 spec: validation aggregation is expected to happen off-chain.
     * @param agentId The agent ID (mandatory)
     * @param validatorAddresses Filter by validators (RECOMMENDED for popular agents)
     * @param tag Filter by tag (optional, bytes32(0) to skip)
     * @return count Number of validations
     * @return avgResponse Average response value (0-100)
     */
    function getSummary(uint256 agentId, address[] calldata validatorAddresses, bytes32 tag)
        external
        view
        returns (uint64 count, uint8 avgResponse)
    {
        bytes32[] memory requestHashes = _agentValidations[agentId];

        uint256 totalResponse = 0;
        uint64 validCount = 0;

        for (uint256 i = 0; i < requestHashes.length; i++) {
            Response storage resp = _responses[requestHashes[i]];

            // Skip if no response yet
            if (resp.validatorAddress == address(0)) continue;

            // Apply validator filter
            if (validatorAddresses.length > 0) {
                bool matchesValidator = false;
                for (uint256 j = 0; j < validatorAddresses.length; j++) {
                    if (resp.validatorAddress == validatorAddresses[j]) {
                        matchesValidator = true;
                        break;
                    }
                }
                if (!matchesValidator) continue;
            }

            // Apply tag filter
            if (tag != bytes32(0) && resp.tag != tag) continue;

            totalResponse += resp.response;
            validCount++;
        }

        count = validCount;
        avgResponse = validCount > 0 ? uint8(totalResponse / validCount) : 0;
    }

    /**
     * @notice Get all validation request hashes for an agent
     * @param agentId The agent ID
     * @return requestHashes Array of request hashes
     */
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory requestHashes) {
        return _agentValidations[agentId];
    }

    /**
     * @notice Get all validation request hashes for a validator
     * @param validatorAddress The validator address
     * @return requestHashes Array of request hashes
     */
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory requestHashes) {
        return _validatorRequests[validatorAddress];
    }

    /**
     * @notice Check if a validation request exists
     * @param requestHash The request hash
     * @return exists True if the request has been created
     */
    function requestExists(bytes32 requestHash) external view returns (bool exists) {
        return _requestExists[requestHash];
    }

    /**
     * @notice Get validation request details
     * @param requestHash The request hash
     * @return validatorAddress The validator address
     * @return agentId The agent ID
     * @return requestUri The request URI
     * @return timestamp The request timestamp
     */
    function getRequest(bytes32 requestHash)
        external
        view
        returns (address validatorAddress, uint256 agentId, string memory requestUri, uint256 timestamp)
    {
        Request storage request = _requests[requestHash];
        require(request.validatorAddress != address(0), "Request not found");

        return (request.validatorAddress, request.agentId, request.requestUri, request.timestamp);
    }

    /**
     * @notice Get the identity registry address
     * @return registry The identity registry address
     */
    function getIdentityRegistry() external view returns (address registry) {
        return address(identityRegistry);
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
