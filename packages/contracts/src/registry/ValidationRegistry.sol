// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import "./IdentityRegistry.sol";
import "./interfaces/IValidationRegistry.sol";

/**
 * @title ValidationRegistry
 * @notice ERC-8004 v1.0 Validation Registry - Generic validation hooks
 */
contract ValidationRegistry is IValidationRegistry {
    // ============ Constants ============

    /// @notice Maximum URI length to prevent gas griefing
    uint256 public constant MAX_URI_LENGTH = 2048;

    // ============ Errors ============

    error URITooLong();

    IdentityRegistry public immutable identityRegistry;

    struct Request {
        address validatorAddress;
        uint256 agentId;
        string requestUri;
        bytes32 requestHash;
        uint256 timestamp;
    }

    struct Response {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        bytes32 tag;
        uint256 lastUpdate;
    }

    mapping(bytes32 => Request) private _requests;
    mapping(bytes32 => Response) private _responses;
    mapping(uint256 => bytes32[]) private _agentValidations;
    mapping(address => bytes32[]) private _validatorRequests;
    mapping(bytes32 => bool) private _requestExists;

    constructor(address payable _identityRegistry) {
        require(_identityRegistry != address(0), "Invalid registry address");
        identityRegistry = IdentityRegistry(_identityRegistry);
    }

    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestUri,
        bytes32 requestHash
    ) external {
        require(validatorAddress != address(0), "Invalid validator address");
        require(bytes(requestUri).length > 0, "Empty request URI");
        if (bytes(requestUri).length > MAX_URI_LENGTH) revert URITooLong();
        require(identityRegistry.agentExists(agentId), "Agent does not exist");

        address agentOwner = identityRegistry.ownerOf(agentId);
        require(
            msg.sender == agentOwner || identityRegistry.isApprovedForAll(agentOwner, msg.sender)
                || identityRegistry.getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        require(validatorAddress != agentOwner, "Self-validation not allowed");
        require(validatorAddress != msg.sender, "Self-validation not allowed");

        bytes32 finalRequestHash = requestHash;
        if (finalRequestHash == bytes32(0)) {
            finalRequestHash =
                keccak256(abi.encodePacked(validatorAddress, agentId, requestUri, block.timestamp, msg.sender));
        }

        require(!_requestExists[finalRequestHash], "Request hash already exists");

        _requests[finalRequestHash] = Request({
            validatorAddress: validatorAddress,
            agentId: agentId,
            requestUri: requestUri,
            requestHash: finalRequestHash,
            timestamp: block.timestamp
        });

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
            responseHash: responseHash,
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
     * @dev Returns default values (address(0), 0, 0, 0, 0, 0) for pending requests without responses
     * @dev To distinguish pending from non-existent requests, check if request exists via _requestExists
     * @param requestHash The request hash
     * @return validatorAddress The validator address (address(0) if no response yet)
     * @return agentId The agent ID (0 if no response yet)
     * @return response The validation response (0-100, or 0 if no response yet)
     * @return responseHash The response hash (bytes32(0) if no response yet)
     * @return tag The response tag (bytes32(0) if no response yet)
     * @return lastUpdate Timestamp of last update (0 if no response yet)
     */
    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, bytes32 tag, uint256 lastUpdate)
    {
        Response storage resp = _responses[requestHash];
        return (resp.validatorAddress, resp.agentId, resp.response, resp.responseHash, resp.tag, resp.lastUpdate);
    }

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
            if (resp.validatorAddress == address(0)) continue;

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

            if (tag != bytes32(0) && resp.tag != tag) continue;

            totalResponse += resp.response;
            validCount++;
        }

        count = validCount;
        avgResponse = validCount > 0 ? uint8(totalResponse / validCount) : 0;
    }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }

    function requestExists(bytes32 requestHash) external view returns (bool) {
        return _requestExists[requestHash];
    }

    function getRequest(bytes32 requestHash)
        external
        view
        returns (address, uint256, string memory, uint256)
    {
        Request storage request = _requests[requestHash];
        require(request.validatorAddress != address(0), "Request not found");
        return (request.validatorAddress, request.agentId, request.requestUri, request.timestamp);
    }

    function getIdentityRegistry() external view returns (address) {
        return address(identityRegistry);
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
