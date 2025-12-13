// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IDisputeGame
 * @author Jeju Network
 * @notice Interface for oracle report disputes with bonds and slashing
 */
interface IDisputeGame {
    // ============ Enums ============

    enum DisputeReason {
        PRICE_DEVIATION,
        INVALID_SOURCE,
        LOW_LIQUIDITY,
        STALE_DATA,
        INVALID_SIGNATURE,
        MANIPULATION,
        OTHER
    }

    enum DisputeStatus {
        OPEN,
        CHALLENGED,
        RESOLVED_VALID,
        RESOLVED_INVALID,
        ESCALATED_TO_FUTARCHY,
        EXPIRED
    }

    enum ResolutionOutcome {
        REPORT_VALID,
        REPORT_INVALID,
        INCONCLUSIVE
    }

    // ============ Structs ============

    struct Dispute {
        bytes32 disputeId;
        bytes32 reportHash;
        bytes32 feedId;
        address disputer;
        uint256 bond;
        DisputeReason reason;
        bytes32 evidenceHash;
        DisputeStatus status;
        uint256 createdAt;
        uint256 deadline;
        address[] affectedSigners;
    }

    struct DisputeResolution {
        ResolutionOutcome outcome;
        uint256 resolvedAt;
        address resolvedBy;
        uint256 slashAmount;
        uint256 disputerReward;
        string resolutionNote;
    }

    struct DisputeConfig {
        uint256 minBondUSD;
        uint256 challengeWindowSeconds;
        uint256 resolutionWindowSeconds;
        uint16 slashDeviationBps;
        uint16 maxSlashBps;
        uint16 disputerRewardBps;
        bool autoResolveEnabled;
    }

    // ============ Events ============

    event DisputeOpened(
        bytes32 indexed disputeId,
        bytes32 indexed reportHash,
        bytes32 indexed feedId,
        address disputer,
        uint256 bond,
        DisputeReason reason
    );

    event DisputeChallenged(bytes32 indexed disputeId, address challenger, uint256 additionalBond);

    event DisputeResolved(
        bytes32 indexed disputeId, ResolutionOutcome outcome, uint256 slashAmount, uint256 disputerReward
    );

    event DisputeEscalated(bytes32 indexed disputeId, bytes32 indexed futarchyMarketId);

    event DisputeExpired(bytes32 indexed disputeId);

    event SignersSlashed(bytes32 indexed disputeId, address[] signers, uint256 totalSlashed);

    event DisputerRewarded(bytes32 indexed disputeId, address indexed disputer, uint256 amount);

    // ============ Errors ============

    error DisputeNotFound(bytes32 disputeId);
    error DisputeAlreadyExists(bytes32 reportHash);
    error DisputeNotOpen(bytes32 disputeId);
    error DisputeExpiredError(bytes32 disputeId);
    error InsufficientBond(uint256 provided, uint256 required);
    error ChallengeWindowClosed(bytes32 disputeId);
    error ResolutionWindowActive(bytes32 disputeId);
    error NotAuthorizedResolver();
    error ReportNotDisputable(bytes32 reportHash);
    error InvalidEvidence();

    // ============ Core Functions ============

    function openDispute(bytes32 reportHash, DisputeReason reason, bytes32 evidenceHash)
        external
        payable
        returns (bytes32 disputeId);

    function challengeDispute(bytes32 disputeId) external payable;

    function resolveDispute(bytes32 disputeId, ResolutionOutcome outcome, string calldata resolutionNote) external;

    function resolveDisputeAutomatic(bytes32 disputeId) external;

    function escalateToFutarchy(bytes32 disputeId) external returns (bytes32 marketId);

    function resolveFromFutarchy(bytes32 disputeId, bool reportValid) external;

    function expireDispute(bytes32 disputeId) external;

    // ============ View Functions ============

    function getDispute(bytes32 disputeId) external view returns (Dispute memory);

    function getDisputeResolution(bytes32 disputeId) external view returns (DisputeResolution memory);

    function getDisputeConfig() external view returns (DisputeConfig memory);

    function getDisputeByReport(bytes32 reportHash) external view returns (Dispute memory);

    function getActiveDisputes() external view returns (bytes32[] memory);

    function getDisputesByFeed(bytes32 feedId) external view returns (bytes32[] memory);

    function getDisputesByDisputer(address disputer) external view returns (bytes32[] memory);

    function isReportDisputed(bytes32 reportHash) external view returns (bool);

    function canDispute(bytes32 reportHash) external view returns (bool);

    function canResolve(bytes32 disputeId) external view returns (bool);

    function getMinBond() external view returns (uint256);

    function calculateSlashAmount(bytes32 disputeId, address[] calldata signers) external view returns (uint256);
}
