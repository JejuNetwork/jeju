// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title MultisigISM
 * @notice Multisig Interchain Security Module for Hyperlane
 * @dev Validates messages using a set of validators with threshold
 */
contract MultisigISM is Ownable2Step {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Validators
    address[] public validators;
    mapping(address => bool) public isValidator;

    // Threshold per domain
    mapping(uint32 => uint8) public threshold;

    // Default threshold
    uint8 public defaultThreshold;

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event ThresholdSet(uint32 indexed domain, uint8 threshold);
    event DefaultThresholdSet(uint8 threshold);

    constructor(address _owner, address[] memory _validators, uint8 _threshold) Ownable(_owner) {
        require(_threshold <= _validators.length, "Threshold too high");
        require(_threshold > 0, "Threshold must be positive");

        for (uint256 i = 0; i < _validators.length; i++) {
            _addValidator(_validators[i]);
        }
        defaultThreshold = _threshold;
    }

    /**
     * @notice Add a validator
     */
    function addValidator(address _validator) external onlyOwner {
        _addValidator(_validator);
    }

    function _addValidator(address _validator) internal {
        require(!isValidator[_validator], "Already validator");
        validators.push(_validator);
        isValidator[_validator] = true;
        emit ValidatorAdded(_validator);
    }

    /**
     * @notice Remove a validator
     */
    function removeValidator(address _validator) external onlyOwner {
        require(isValidator[_validator], "Not validator");

        // Find and remove
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] == _validator) {
                validators[i] = validators[validators.length - 1];
                validators.pop();
                break;
            }
        }

        isValidator[_validator] = false;
        emit ValidatorRemoved(_validator);
    }

    /**
     * @notice Set threshold for a domain
     */
    function setThreshold(uint32 _domain, uint8 _threshold) external onlyOwner {
        require(_threshold <= validators.length, "Threshold too high");
        threshold[_domain] = _threshold;
        emit ThresholdSet(_domain, _threshold);
    }

    /**
     * @notice Set default threshold
     */
    function setDefaultThreshold(uint8 _threshold) external onlyOwner {
        require(_threshold <= validators.length, "Threshold too high");
        require(_threshold > 0, "Threshold must be positive");
        defaultThreshold = _threshold;
        emit DefaultThresholdSet(_threshold);
    }

    /**
     * @notice Verify a message with validator signatures
     * @param _metadata Encoded validator signatures
     * @param _message The message bytes
     * @return True if verification passes
     */
    function verify(bytes calldata _metadata, bytes calldata _message) external view returns (bool) {
        bytes32 messageHash = keccak256(_message);
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        // Parse origin domain from message
        uint32 origin = uint32(bytes4(_message[5:9]));

        // Get threshold for this domain
        uint8 requiredThreshold = threshold[origin];
        if (requiredThreshold == 0) requiredThreshold = defaultThreshold;

        // Count valid signatures
        uint8 validSignatures = 0;
        uint256 offset = 0;

        // Metadata format: signature1 (65 bytes) + signature2 (65 bytes) + ...
        while (offset + 65 <= _metadata.length && validSignatures < requiredThreshold) {
            bytes memory signature = _metadata[offset:offset + 65];
            address signer = ethSignedHash.recover(signature);

            if (isValidator[signer]) {
                validSignatures++;
            }

            offset += 65;
        }

        return validSignatures >= requiredThreshold;
    }

    /**
     * @notice Get all validators
     */
    function getValidators() external view returns (address[] memory) {
        return validators;
    }

    /**
     * @notice Get validator count
     */
    function validatorCount() external view returns (uint256) {
        return validators.length;
    }

    /**
     * @notice Get threshold for a domain
     */
    function getThreshold(uint32 _domain) external view returns (uint8) {
        uint8 t = threshold[_domain];
        return t == 0 ? defaultThreshold : t;
    }
}




