// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

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
    
    // SECURITY: Timelock for validator changes
    uint256 public constant VALIDATOR_CHANGE_DELAY = 24 hours;
    
    struct PendingValidatorChange {
        address validator;
        bool isAddition; // true = add, false = remove
        uint256 executeAfter;
        bool executed;
    }
    mapping(bytes32 => PendingValidatorChange) public pendingValidatorChanges;

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event ThresholdSet(uint32 indexed domain, uint8 threshold);
    event DefaultThresholdSet(uint8 threshold);
    event ValidatorChangeProposed(bytes32 indexed changeId, address validator, bool isAddition, uint256 executeAfter);
    event ValidatorChangeCancelled(bytes32 indexed changeId);
    
    error ChangeNotFound();
    error ChangeNotReady();
    error ChangeAlreadyExecuted();

    constructor(address _owner, address[] memory _validators, uint8 _threshold) Ownable(_owner) {
        require(_threshold <= _validators.length, "Threshold too high");
        require(_threshold > 0, "Threshold must be positive");

        for (uint256 i = 0; i < _validators.length; i++) {
            _addValidator(_validators[i]);
        }
        defaultThreshold = _threshold;
    }

    /**
     * @notice Propose adding a validator - requires 24-hour delay
     * @dev SECURITY: Prevents instant validator set manipulation
     */
    function proposeAddValidator(address _validator) external onlyOwner returns (bytes32 changeId) {
        require(!isValidator[_validator], "Already validator");
        
        changeId = keccak256(abi.encodePacked(_validator, true, block.timestamp));
        pendingValidatorChanges[changeId] = PendingValidatorChange({
            validator: _validator,
            isAddition: true,
            executeAfter: block.timestamp + VALIDATOR_CHANGE_DELAY,
            executed: false
        });
        
        emit ValidatorChangeProposed(changeId, _validator, true, block.timestamp + VALIDATOR_CHANGE_DELAY);
    }
    
    /**
     * @notice Execute pending validator addition
     */
    function executeAddValidator(bytes32 changeId) external {
        PendingValidatorChange storage change = pendingValidatorChanges[changeId];
        if (change.executeAfter == 0) revert ChangeNotFound();
        if (change.executed) revert ChangeAlreadyExecuted();
        if (block.timestamp < change.executeAfter) revert ChangeNotReady();
        if (!change.isAddition) revert ChangeNotFound();
        
        change.executed = true;
        _addValidator(change.validator);
    }
    
    /**
     * @notice Legacy addValidator - now requires timelock
     */
    function addValidator(address _validator) external onlyOwner {
        proposeAddValidator(_validator);
    }

    function _addValidator(address _validator) internal {
        require(!isValidator[_validator], "Already validator");
        validators.push(_validator);
        isValidator[_validator] = true;
        emit ValidatorAdded(_validator);
    }

    /**
     * @notice Propose removing a validator - requires 24-hour delay
     * @dev SECURITY: Prevents instant validator removal attacks
     */
    function proposeRemoveValidator(address _validator) external onlyOwner returns (bytes32 changeId) {
        require(isValidator[_validator], "Not validator");
        
        changeId = keccak256(abi.encodePacked(_validator, false, block.timestamp));
        pendingValidatorChanges[changeId] = PendingValidatorChange({
            validator: _validator,
            isAddition: false,
            executeAfter: block.timestamp + VALIDATOR_CHANGE_DELAY,
            executed: false
        });
        
        emit ValidatorChangeProposed(changeId, _validator, false, block.timestamp + VALIDATOR_CHANGE_DELAY);
    }
    
    /**
     * @notice Execute pending validator removal
     */
    function executeRemoveValidator(bytes32 changeId) external {
        PendingValidatorChange storage change = pendingValidatorChanges[changeId];
        if (change.executeAfter == 0) revert ChangeNotFound();
        if (change.executed) revert ChangeAlreadyExecuted();
        if (block.timestamp < change.executeAfter) revert ChangeNotReady();
        if (change.isAddition) revert ChangeNotFound();
        
        change.executed = true;
        _removeValidatorInternal(change.validator);
    }
    
    /**
     * @notice Cancel pending validator change
     */
    function cancelValidatorChange(bytes32 changeId) external onlyOwner {
        PendingValidatorChange storage change = pendingValidatorChanges[changeId];
        if (change.executeAfter == 0) revert ChangeNotFound();
        if (change.executed) revert ChangeAlreadyExecuted();
        
        delete pendingValidatorChanges[changeId];
        emit ValidatorChangeCancelled(changeId);
    }

    /**
     * @notice Legacy removeValidator - now requires timelock
     */
    function removeValidator(address _validator) external onlyOwner {
        proposeRemoveValidator(_validator);
    }
    
    function _removeValidatorInternal(address _validator) internal {
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







