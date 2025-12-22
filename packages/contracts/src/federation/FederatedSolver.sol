// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {FederationBase} from "./FederationBase.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title FederatedSolver
 * @author Jeju Network
 * @notice Cross-network solver aggregation and routing
 * @dev Aggregates solver information from multiple Jeju networks
 *
 * Architecture:
 * - Each network has its local SolverRegistry with staking
 * - FederatedSolver aggregates solver data across networks
 * - Routes intent fills to best solver regardless of network
 * - Coordinates slashing across networks via governance
 */
contract FederatedSolver is FederationBase {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct FederatedSolverInfo {
        address solverAddress;
        uint256 homeChainId;
        uint256[] supportedChains;
        uint256 totalStake;
        uint256 totalFills;
        uint256 successfulFills;
        uint256 federatedAt;
        bool isActive;
    }

    struct RouteInfo {
        uint256 sourceChainId;
        uint256 destChainId;
        bytes32 federatedSolverId;
        uint256 stake;
        uint256 successRate;
        uint256 avgFillTime;
    }

    // ============================================================================
    // State
    // ============================================================================

    address public localSolverRegistry;

    mapping(bytes32 => FederatedSolverInfo) public federatedSolvers;
    mapping(address => mapping(uint256 => bytes32)) public solverToFederatedId;
    mapping(uint256 => mapping(uint256 => bytes32[])) public routeSolvers;

    bytes32[] public allSolverIds;
    uint256 public totalFederatedSolvers;

    mapping(address => bool) public authorizedReporters;

    // ============================================================================
    // Events
    // ============================================================================

    event SolverFederated(bytes32 indexed federatedId, address indexed solver, uint256 indexed homeChainId);
    event SolverUpdated(bytes32 indexed federatedId, uint256 stake, uint256 totalFills, uint256 successfulFills);
    event SolverDeactivated(bytes32 indexed federatedId);
    event RouteAdded(uint256 indexed sourceChainId, uint256 indexed destChainId, bytes32 indexed federatedSolverId);
    event FillReported(bytes32 indexed federatedId, bytes32 indexed orderId, bool success, uint256 fillTime);

    // ============================================================================
    // Errors
    // ============================================================================

    error SolverExists();
    error SolverNotFound();
    error UnauthorizedReporter();
    error SolverInactive();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        uint256 _localChainId,
        address _oracle,
        address _governance,
        address _networkRegistry,
        address _localSolverRegistry
    ) FederationBase(_localChainId, _oracle, _governance, _networkRegistry) {
        localSolverRegistry = _localSolverRegistry;
    }

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyAuthorizedReporter() {
        if (!authorizedReporters[msg.sender] && msg.sender != oracle) {
            revert UnauthorizedReporter();
        }
        _;
    }

    // ============================================================================
    // Federation Functions
    // ============================================================================

    function federateLocalSolver(uint256[] calldata supportedChains) external nonReentrant {
        bytes32 federatedId = computeFederatedSolverId(msg.sender, LOCAL_CHAIN_ID);
        if (federatedSolvers[federatedId].federatedAt != 0) revert SolverExists();

        federatedSolvers[federatedId] = FederatedSolverInfo({
            solverAddress: msg.sender,
            homeChainId: LOCAL_CHAIN_ID,
            supportedChains: supportedChains,
            totalStake: 0,
            totalFills: 0,
            successfulFills: 0,
            federatedAt: block.timestamp,
            isActive: true
        });

        solverToFederatedId[msg.sender][LOCAL_CHAIN_ID] = federatedId;
        allSolverIds.push(federatedId);
        totalFederatedSolvers++;

        _addRoutes(supportedChains, federatedId);

        emit SolverFederated(federatedId, msg.sender, LOCAL_CHAIN_ID);
    }

    function registerRemoteSolver(
        address solverAddress,
        uint256 homeChainId,
        uint256[] calldata supportedChains,
        uint256 stake,
        bytes calldata attestation
    ) external onlyAuthorizedReporter nonReentrant {
        if (homeChainId == LOCAL_CHAIN_ID) revert InvalidChain();

        bytes32 federatedId = computeFederatedSolverId(solverAddress, homeChainId);
        if (federatedSolvers[federatedId].federatedAt != 0) revert SolverExists();

        bytes32 attestationHash = keccak256(
            abi.encodePacked(solverAddress, homeChainId, supportedChains, stake)
        );
        address attester = attestationHash.toEthSignedMessageHash().recover(attestation);
        if (!authorizedReporters[attester] && attester != oracle) {
            revert UnauthorizedReporter();
        }

        federatedSolvers[federatedId] = FederatedSolverInfo({
            solverAddress: solverAddress,
            homeChainId: homeChainId,
            supportedChains: supportedChains,
            totalStake: stake,
            totalFills: 0,
            successfulFills: 0,
            federatedAt: block.timestamp,
            isActive: true
        });

        solverToFederatedId[solverAddress][homeChainId] = federatedId;
        allSolverIds.push(federatedId);
        totalFederatedSolvers++;

        _addRoutes(supportedChains, federatedId);

        emit SolverFederated(federatedId, solverAddress, homeChainId);
    }

    function updateSolverStats(
        bytes32 federatedId,
        uint256 stake,
        uint256 totalFills,
        uint256 successfulFills
    ) external onlyAuthorizedReporter {
        FederatedSolverInfo storage solver = federatedSolvers[federatedId];
        if (solver.federatedAt == 0) revert SolverNotFound();

        solver.totalStake = stake;
        solver.totalFills = totalFills;
        solver.successfulFills = successfulFills;

        emit SolverUpdated(federatedId, stake, totalFills, successfulFills);
    }

    function reportFill(
        bytes32 federatedId,
        bytes32 orderId,
        bool success,
        uint256 fillTime
    ) external onlyAuthorizedReporter {
        FederatedSolverInfo storage solver = federatedSolvers[federatedId];
        if (solver.federatedAt == 0) revert SolverNotFound();

        solver.totalFills++;
        if (success) {
            solver.successfulFills++;
        }

        emit FillReported(federatedId, orderId, success, fillTime);
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function deactivateSolver(bytes32 federatedId) external onlyGovernance {
        FederatedSolverInfo storage solver = federatedSolvers[federatedId];
        if (solver.federatedAt == 0) revert SolverNotFound();

        solver.isActive = false;
        emit SolverDeactivated(federatedId);
    }

    function setReporter(address reporter, bool authorized) external onlyGovernance {
        authorizedReporters[reporter] = authorized;
    }

    function setLocalSolverRegistry(address _registry) external onlyGovernance {
        localSolverRegistry = _registry;
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    function _addRoutes(uint256[] calldata supportedChains, bytes32 federatedId) internal {
        for (uint256 i = 0; i < supportedChains.length; i++) {
            for (uint256 j = 0; j < supportedChains.length; j++) {
                if (i != j) {
                    routeSolvers[supportedChains[i]][supportedChains[j]].push(federatedId);
                    emit RouteAdded(supportedChains[i], supportedChains[j], federatedId);
                }
            }
        }
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function computeFederatedSolverId(address solver, uint256 chainId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("jeju:solver:", chainId, ":", solver));
    }

    function getSolver(bytes32 federatedId) external view returns (FederatedSolverInfo memory) {
        return federatedSolvers[federatedId];
    }

    function getSolversForRoute(uint256 sourceChainId, uint256 destChainId) external view returns (bytes32[] memory) {
        return routeSolvers[sourceChainId][destChainId];
    }

    function getBestSolverForRoute(
        uint256 sourceChainId,
        uint256 destChainId
    ) external view returns (bytes32 bestSolverId, uint256 stake, uint256 successRate) {
        bytes32[] storage solvers = routeSolvers[sourceChainId][destChainId];
        if (solvers.length == 0) return (bytes32(0), 0, 0);

        uint256 bestScore = 0;

        for (uint256 i = 0; i < solvers.length; i++) {
            FederatedSolverInfo storage solver = federatedSolvers[solvers[i]];
            if (!solver.isActive) continue;

            uint256 rate = solver.totalFills > 0
                ? (solver.successfulFills * 10000) / solver.totalFills
                : 10000;

            uint256 score = (solver.totalStake * rate) / 1e18;

            if (score > bestScore) {
                bestScore = score;
                bestSolverId = solvers[i];
                stake = solver.totalStake;
                successRate = rate;
            }
        }
    }

    function getSolverSuccessRate(bytes32 federatedId) external view returns (uint256) {
        FederatedSolverInfo storage solver = federatedSolvers[federatedId];
        if (solver.totalFills == 0) return 10000;
        return (solver.successfulFills * 10000) / solver.totalFills;
    }

    function getAllSolverIds() external view returns (bytes32[] memory) {
        return allSolverIds;
    }

    function getActiveSolvers() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allSolverIds.length; i++) {
            if (federatedSolvers[allSolverIds[i]].isActive) count++;
        }

        bytes32[] memory active = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allSolverIds.length; i++) {
            if (federatedSolvers[allSolverIds[i]].isActive) {
                active[idx++] = allSolverIds[i];
            }
        }
        return active;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
