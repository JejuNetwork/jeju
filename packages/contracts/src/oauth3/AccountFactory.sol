// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IOAuth3AccountFactory} from "./IOAuth3.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title AccountFactory
 * @notice Creates ERC-4337 smart accounts for OAuth3 identities
 * @dev Factory with session keys and social recovery
 */
contract AccountFactory is IOAuth3AccountFactory {
    using ECDSA for bytes32;

    address public immutable entryPoint;
    address public immutable identityRegistry;
    address public immutable defaultValidator;

    uint256 public constant RECOVERY_DELAY = 2 days;

    mapping(address => AccountData) private accounts;
    mapping(address => SessionKey[]) private sessionKeys;
    mapping(address => RecoveryRequest) private recoveryRequests;

    struct AccountData {
        bytes32 identityId;
        address owner;
        uint256 nonce;
        bool deployed;
    }

    struct RecoveryRequest {
        address newOwner;
        uint256 executeAfter;
        bool pending;
    }

    modifier onlyAccountOwner(address account) {
        require(accounts[account].owner == msg.sender, "Not account owner");
        _;
    }

    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "Only entry point");
        _;
    }

    constructor(address _entryPoint, address _identityRegistry, address _defaultValidator) {
        entryPoint = _entryPoint;
        identityRegistry = _identityRegistry;
        defaultValidator = _defaultValidator;
    }

    function createAccount(bytes32 identityId, address owner, uint256 salt) external returns (address account) {
        require(owner != address(0), "Invalid owner");

        bytes32 actualSalt = keccak256(abi.encodePacked(identityId, owner, salt));

        bytes memory bytecode = _getAccountBytecode(identityId, owner);
        account = Create2.computeAddress(actualSalt, keccak256(bytecode));

        if (account.code.length == 0) {
            account = Create2.deploy(0, actualSalt, bytecode);

            accounts[account] = AccountData({identityId: identityId, owner: owner, nonce: 0, deployed: true});

            emit AccountCreated(account, identityId, owner, block.timestamp);
        }
    }

    function getAccountAddress(bytes32 identityId, address owner, uint256 salt) external view returns (address) {
        bytes32 actualSalt = keccak256(abi.encodePacked(identityId, owner, salt));
        bytes memory bytecode = _getAccountBytecode(identityId, owner);
        return Create2.computeAddress(actualSalt, keccak256(bytecode));
    }

    function addSessionKey(address account, SessionKey calldata sessionKey) external onlyAccountOwner(account) {
        require(sessionKey.validUntil > block.timestamp, "Invalid expiry");
        require(sessionKey.validAfter < sessionKey.validUntil, "Invalid validity range");

        sessionKeys[account].push(sessionKey);

        emit SessionKeyAdded(account, sessionKey.publicKeyHash, sessionKey.validUntil, block.timestamp);
    }

    function revokeSessionKey(address account, bytes32 keyHash) external onlyAccountOwner(account) {
        SessionKey[] storage keys = sessionKeys[account];

        for (uint256 i = 0; i < keys.length; i++) {
            if (keys[i].publicKeyHash == keyHash) {
                keys[i].active = false;
                emit SessionKeyRevoked(account, keyHash, block.timestamp);
                return;
            }
        }

        revert("Session key not found");
    }

    function initiateRecovery(address account, address newOwner, bytes calldata recoveryProof) external {
        require(accounts[account].deployed, "Account not deployed");
        require(newOwner != address(0), "Invalid new owner");
        require(!recoveryRequests[account].pending, "Recovery already pending");

        _verifyRecoveryProof(account, newOwner, recoveryProof);

        uint256 executeAfter = block.timestamp + RECOVERY_DELAY;

        recoveryRequests[account] = RecoveryRequest({newOwner: newOwner, executeAfter: executeAfter, pending: true});

        emit RecoveryInitiated(account, newOwner, executeAfter, block.timestamp);
    }

    function executeRecovery(address account) external {
        RecoveryRequest storage request = recoveryRequests[account];

        require(request.pending, "No pending recovery");
        require(block.timestamp >= request.executeAfter, "Recovery delay not passed");

        address newOwner = request.newOwner;
        accounts[account].owner = newOwner;
        accounts[account].nonce++;

        delete recoveryRequests[account];
        delete sessionKeys[account];
    }

    function cancelRecovery(address account) external onlyAccountOwner(account) {
        require(recoveryRequests[account].pending, "No pending recovery");
        delete recoveryRequests[account];
    }

    function getAccountInfo(address account)
        external
        view
        returns (bytes32 identityId, address owner, uint256 nonce, bool deployed)
    {
        AccountData storage data = accounts[account];
        return (data.identityId, data.owner, data.nonce, data.deployed);
    }

    function getSessionKeys(address account) external view returns (SessionKey[] memory) {
        return sessionKeys[account];
    }

    function isValidSessionKey(address account, bytes32 keyHash, address target, bytes4 selector, uint256 value)
        external
        view
        returns (bool)
    {
        SessionKey[] storage keys = sessionKeys[account];

        for (uint256 i = 0; i < keys.length; i++) {
            SessionKey storage key = keys[i];

            if (key.publicKeyHash != keyHash) continue;
            if (!key.active) continue;
            if (block.timestamp < key.validAfter) continue;
            if (block.timestamp > key.validUntil) continue;
            if (key.target != address(0) && key.target != target) continue;
            if (key.selector != bytes4(0) && key.selector != selector) continue;
            if (value > key.maxValue) continue;

            return true;
        }

        return false;
    }

    function getRecoveryRequest(address account)
        external
        view
        returns (address newOwner, uint256 executeAfter, bool pending)
    {
        RecoveryRequest storage request = recoveryRequests[account];
        return (request.newOwner, request.executeAfter, request.pending);
    }

    function validateUserOp(address account, bytes32 userOpHash, bytes calldata signature)
        external
        view
        returns (bool)
    {
        if (signature.length == 65) {
            address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(userOpHash), signature);
            return signer == accounts[account].owner;
        }

        if (signature.length > 65) {
            bytes32 keyHash = bytes32(signature[:32]);

            SessionKey[] storage keys = sessionKeys[account];
            for (uint256 i = 0; i < keys.length; i++) {
                if (keys[i].publicKeyHash == keyHash && keys[i].active) {
                    if (block.timestamp >= keys[i].validAfter && block.timestamp <= keys[i].validUntil) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function _getAccountBytecode(bytes32 identityId, address owner) internal view returns (bytes memory) {
        return abi.encodePacked(
            type(OAuth3Account).creationCode, abi.encode(entryPoint, identityRegistry, owner, identityId)
        );
    }

    function _verifyRecoveryProof(address account, address newOwner, bytes calldata proof) internal view {
        require(proof.length >= 65, "Invalid recovery proof");

        bytes32 messageHash =
            keccak256(abi.encodePacked("OAuth3 Recovery", account, newOwner, block.chainid, accounts[account].nonce));

        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(messageHash), proof);

        require(signer != address(0), "Invalid signature");
    }
}

/**
 * @title OAuth3Account
 * @notice ERC-4337 smart account with OAuth3 identity integration
 */
contract OAuth3Account {
    address public immutable entryPoint;
    address public immutable identityRegistry;
    address public immutable factory;
    address public owner;
    bytes32 public identityId;
    uint256 public nonce;

    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "Only entry point");
        _;
    }

    modifier onlyOwnerOrEntryPoint() {
        require(msg.sender == owner || msg.sender == entryPoint, "Unauthorized");
        _;
    }

    constructor(address _entryPoint, address _identityRegistry, address _owner, bytes32 _identityId) {
        entryPoint = _entryPoint;
        identityRegistry = _identityRegistry;
        factory = msg.sender;
        owner = _owner;
        identityId = _identityId;
    }

    receive() external payable {}

    function execute(address target, uint256 value, bytes calldata data)
        external
        onlyOwnerOrEntryPoint
        returns (bytes memory)
    {
        nonce++;
        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, "Execution failed");
        return result;
    }

    function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata datas)
        external
        onlyOwnerOrEntryPoint
        returns (bytes[] memory results)
    {
        require(targets.length == values.length && values.length == datas.length, "Length mismatch");

        nonce++;
        results = new bytes[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, bytes memory result) = targets[i].call{value: values[i]}(datas[i]);
            require(success, "Batch execution failed");
            results[i] = result;
        }
    }

    function validateUserOp(bytes32 userOpHash, bytes calldata signature)
        external
        view
        returns (uint256 validationData)
    {
        bool valid = AccountFactory(factory).validateUserOp(address(this), userOpHash, signature);
        return valid ? 0 : 1;
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == factory, "Only factory");
        owner = newOwner;
    }
}
