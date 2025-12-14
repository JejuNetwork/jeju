// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IReportVerifier
 * @author Jeju Network
 * @notice Interface for verifying and storing oracle price reports (OCR-style)
 */
interface IReportVerifier {
    // ============ Structs ============

    struct PriceReport {
        bytes32 feedId;
        uint256 price;
        uint256 confidence;
        uint256 timestamp;
        uint256 round;
        bytes32 sourcesHash;
    }

    struct ConsensusPrice {
        uint256 price;
        uint256 confidence;
        uint256 timestamp;
        uint256 round;
        uint256 oracleCount;
        bytes32 reportHash;
    }

    struct ReportSubmission {
        PriceReport report;
        bytes[] signatures;
    }

    // ============ Events ============

    event ReportSubmitted(
        bytes32 indexed feedId,
        bytes32 indexed reportHash,
        uint256 price,
        uint256 confidence,
        uint256 round,
        uint256 signerCount
    );

    event ReportVerified(bytes32 indexed feedId, bytes32 indexed reportHash, uint256 price, uint256 timestamp);

    event ReportRejected(bytes32 indexed feedId, bytes32 indexed reportHash, string reason);

    event ConsensusUpdated(bytes32 indexed feedId, uint256 price, uint256 confidence, uint256 round);

    // ============ Errors ============

    error InvalidReport();
    error InsufficientSignatures(uint256 provided, uint256 required);
    error InvalidSignature(address signer);
    error SignerNotCommitteeMember(address signer);
    error DuplicateSignature(address signer);
    error StaleReport(uint256 reportTime, uint256 currentTime);
    error RoundMismatch(uint256 expected, uint256 provided);
    error PriceDeviationTooLarge(uint256 deviation, uint256 maxAllowed);
    error FeedNotActive(bytes32 feedId);
    error ReportAlreadyProcessed(bytes32 reportHash);

    // ============ Core Functions ============

    function submitReport(ReportSubmission calldata submission) external returns (bool accepted);

    function submitReportBatch(ReportSubmission[] calldata submissions) external returns (uint256 accepted);

    function verifySignatures(bytes32 reportHash, bytes[] calldata signatures)
        external
        view
        returns (address[] memory signers, bool valid);

    // ============ View Functions ============

    function getLatestPrice(bytes32 feedId)
        external
        view
        returns (uint256 price, uint256 confidence, uint256 timestamp, bool isValid);

    function getConsensusPrice(bytes32 feedId) external view returns (ConsensusPrice memory);

    function getCurrentRound(bytes32 feedId) external view returns (uint256);

    function getReportHash(PriceReport calldata report) external pure returns (bytes32);

    function isReportProcessed(bytes32 reportHash) external view returns (bool);

    function getHistoricalPrice(bytes32 feedId, uint256 round) external view returns (ConsensusPrice memory);

    function isPriceValid(bytes32 feedId) external view returns (bool);

    function isPriceStale(bytes32 feedId) external view returns (bool);
}
