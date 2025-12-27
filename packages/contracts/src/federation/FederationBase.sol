// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title FederationBase
 * @author Jeju Network
 * @notice Base contract for all federation contracts
 * @dev Provides common modifiers, errors, and state management
 *
 * Shared functionality:
 * - Governance access control
 * - Oracle integration
 * - Network registry reference
 * - Common error types
 */
abstract contract FederationBase is ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public immutable LOCAL_CHAIN_ID;
    address public oracle;
    address public governance;
    address public networkRegistry;

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);
    event NetworkRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    error NotGovernance();
    error NotOracle();
    error ZeroAddress();
    error Unauthorized();
    error InvalidChain();
    error AlreadyExists();
    error NotFound();
    error NotActive();
    error InvalidSignature();

    constructor(uint256 _localChainId, address _oracle, address _governance, address _networkRegistry) {
        LOCAL_CHAIN_ID = _localChainId;
        oracle = _oracle;
        governance = _governance;
        networkRegistry = _networkRegistry;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    modifier onlyOracleOrGovernance() {
        if (msg.sender != oracle && msg.sender != governance) revert Unauthorized();
        _;
    }

    function setOracle(address _oracle) external onlyGovernance {
        if (_oracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;
    }

    function setGovernance(address _governance) external onlyGovernance {
        if (_governance == address(0)) revert ZeroAddress();
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
    }

    function setNetworkRegistry(address _networkRegistry) external onlyGovernance {
        if (_networkRegistry == address(0)) revert ZeroAddress();
        emit NetworkRegistryUpdated(networkRegistry, _networkRegistry);
        networkRegistry = _networkRegistry;
    }

    function _verifySignature(bytes32 messageHash, bytes calldata signature, address expectedSigner)
        internal
        pure
        returns (bool)
    {
        address signer = messageHash.toEthSignedMessageHash().recover(signature);
        return signer == expectedSigner;
    }

    function _computeId(string memory prefix, uint256 chainId, bytes32 identifier) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(prefix, chainId, identifier));
    }

    function _computeId(string memory prefix, uint256 chainId, address identifier) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(prefix, chainId, identifier));
    }

    function _computeId(string memory prefix, uint256 chainId, uint256 identifier) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(prefix, chainId, identifier));
    }
}
