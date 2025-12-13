// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IReportVerifier} from "./interfaces/IReportVerifier.sol";
import {IFeedRegistry} from "./interfaces/IFeedRegistry.sol";
import {ICommitteeManager} from "./interfaces/ICommitteeManager.sol";
import {IOracleNetworkConnector} from "./interfaces/IOracleNetworkConnector.sol";

/**
 * @title ReportVerifier
 * @author Jeju Network
 * @notice OCR-style report verification and price storage for Jeju Oracle Network
 * @dev Verifies quorum signatures from committee members and stores consensus prices
 *
 * Key Features:
 * - Multi-signature verification (ECDSA)
 * - Quorum enforcement per feed configuration
 * - Price deviation checks against previous values
 * - Historical price storage by round
 * - Integration with FeedRegistry and CommitteeManager
 */
contract ReportVerifier is IReportVerifier, Ownable, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;

    // ============ Constants ============

    uint256 public constant MAX_PRICE_AGE = 1 hours;
    uint256 public constant MIN_REPORT_INTERVAL = 10 seconds;
    uint16 public constant CIRCUIT_BREAKER_DEVIATION_BPS = 2000; // 20% max single update

    // ============ Immutable Dependencies ============

    IFeedRegistry public immutable feedRegistry;

    // ============ Configurable Dependencies ============

    ICommitteeManager public committeeManager;
    IOracleNetworkConnector public networkConnector;

    // ============ State Variables ============

    // Current consensus prices: feedId => ConsensusPrice
    mapping(bytes32 => ConsensusPrice) private _consensusPrices;

    // Historical prices: feedId => round => ConsensusPrice
    mapping(bytes32 => mapping(uint256 => ConsensusPrice)) private _historicalPrices;

    // Current round per feed: feedId => round
    mapping(bytes32 => uint256) private _currentRounds;

    // Last report timestamp per feed: feedId => timestamp
    mapping(bytes32 => uint256) private _lastReportTime;

    // Processed report hashes to prevent replay
    mapping(bytes32 => bool) private _processedReports;

    // Authorized transmitters (can submit reports)
    mapping(address => bool) public authorizedTransmitters;

    // Circuit breaker: maximum allowed deviation from last price
    uint16 public circuitBreakerBps = CIRCUIT_BREAKER_DEVIATION_BPS;

    // ============ Errors ============

    error Unauthorized();

    // ============ Constructor ============

    constructor(address _feedRegistry, address _committeeManager, address initialOwner) Ownable(initialOwner) {
        feedRegistry = IFeedRegistry(_feedRegistry);
        if (_committeeManager != address(0)) {
            committeeManager = ICommitteeManager(_committeeManager);
        }
        authorizedTransmitters[initialOwner] = true;
    }

    // ============ Modifiers ============

    modifier onlyAuthorizedTransmitter() {
        if (!authorizedTransmitters[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    // ============ Core Functions ============

    /**
     * @notice Submit a signed price report
     * @param submission Report data with signatures
     * @return accepted Whether the report was accepted
     */
    function submitReport(ReportSubmission calldata submission)
        external
        nonReentrant
        whenNotPaused
        onlyAuthorizedTransmitter
        returns (bool accepted)
    {
        return _processReport(submission);
    }

    /**
     * @notice Submit multiple reports in one transaction
     * @param submissions Array of report submissions
     * @return acceptedCount Number of accepted reports
     */
    function submitReportBatch(ReportSubmission[] calldata submissions)
        external
        nonReentrant
        whenNotPaused
        onlyAuthorizedTransmitter
        returns (uint256 acceptedCount)
    {
        for (uint256 i = 0; i < submissions.length; i++) {
            if (_processReport(submissions[i])) {
                acceptedCount++;
            }
        }
    }

    /**
     * @notice Verify signatures for a report
     * @param reportHash Hash of the report data
     * @param signatures Array of signatures
     * @return signers Array of recovered signer addresses
     * @return valid Whether all signatures are valid committee members
     */
    function verifySignatures(bytes32 reportHash, bytes[] calldata signatures)
        external
        view
        returns (address[] memory signers, bool valid)
    {
        signers = new address[](signatures.length);
        valid = true;

        bytes32 ethSignedHash = _toEthSignedMessageHash(reportHash);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ethSignedHash.recover(signatures[i]);
            signers[i] = signer;

            // Check for duplicates
            for (uint256 j = 0; j < i; j++) {
                if (signers[j] == signer) {
                    valid = false;
                    break;
                }
            }
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get latest price for a feed
     * @param feedId Feed identifier
     * @return price The price value
     * @return confidence Confidence band
     * @return timestamp When price was last updated
     * @return isValid Whether price is valid (not stale)
     */
    function getLatestPrice(bytes32 feedId)
        external
        view
        returns (uint256 price, uint256 confidence, uint256 timestamp, bool isValid)
    {
        ConsensusPrice storage cp = _consensusPrices[feedId];

        price = cp.price;
        confidence = cp.confidence;
        timestamp = cp.timestamp;

        // Check staleness
        IFeedRegistry.FeedSpec memory spec = feedRegistry.getFeed(feedId);
        isValid = cp.price > 0 && cp.timestamp > 0 && block.timestamp - cp.timestamp <= spec.heartbeatSeconds;
    }

    /**
     * @notice Get full consensus price data
     * @param feedId Feed identifier
     * @return Consensus price struct
     */
    function getConsensusPrice(bytes32 feedId) external view returns (ConsensusPrice memory) {
        return _consensusPrices[feedId];
    }

    /**
     * @notice Get current round for a feed
     * @param feedId Feed identifier
     * @return Current round number
     */
    function getCurrentRound(bytes32 feedId) external view returns (uint256) {
        return _currentRounds[feedId];
    }

    /**
     * @notice Compute hash for a price report
     * @param report Price report data
     * @return Report hash
     */
    function getReportHash(PriceReport calldata report) external pure returns (bytes32) {
        return _computeReportHash(report);
    }

    /**
     * @notice Check if a report has been processed
     * @param reportHash Report hash to check
     * @return Whether the report has been processed
     */
    function isReportProcessed(bytes32 reportHash) external view returns (bool) {
        return _processedReports[reportHash];
    }

    /**
     * @notice Get historical price at a specific round
     * @param feedId Feed identifier
     * @param round Round number
     * @return Consensus price at that round
     */
    function getHistoricalPrice(bytes32 feedId, uint256 round) external view returns (ConsensusPrice memory) {
        return _historicalPrices[feedId][round];
    }

    /**
     * @notice Check if current price is valid
     * @param feedId Feed identifier
     * @return Whether price is valid
     */
    function isPriceValid(bytes32 feedId) external view returns (bool) {
        ConsensusPrice storage cp = _consensusPrices[feedId];
        if (cp.price == 0 || cp.timestamp == 0) return false;

        IFeedRegistry.FeedSpec memory spec = feedRegistry.getFeed(feedId);
        return block.timestamp - cp.timestamp <= spec.heartbeatSeconds;
    }

    /**
     * @notice Check if current price is stale
     * @param feedId Feed identifier
     * @return Whether price is stale
     */
    function isPriceStale(bytes32 feedId) external view returns (bool) {
        ConsensusPrice storage cp = _consensusPrices[feedId];
        if (cp.price == 0 || cp.timestamp == 0) return true;

        IFeedRegistry.FeedSpec memory spec = feedRegistry.getFeed(feedId);
        return block.timestamp - cp.timestamp > spec.heartbeatSeconds;
    }

    // ============ Internal Functions ============

    function _processReport(ReportSubmission calldata submission) internal returns (bool) {
        PriceReport calldata report = submission.report;
        bytes[] calldata signatures = submission.signatures;

        // Validate feed exists and is active
        if (!feedRegistry.feedExists(report.feedId)) {
            emit ReportRejected(report.feedId, bytes32(0), "Feed not found");
            return false;
        }

        if (!feedRegistry.isFeedActive(report.feedId)) {
            revert FeedNotActive(report.feedId);
        }

        // Get feed spec
        IFeedRegistry.FeedSpec memory spec = feedRegistry.getFeed(report.feedId);

        // Validate basic report params
        if (report.price == 0) {
            revert InvalidReport();
        }

        // Check report timestamp
        if (report.timestamp > block.timestamp) {
            revert StaleReport(report.timestamp, block.timestamp);
        }
        if (block.timestamp - report.timestamp > MAX_PRICE_AGE) {
            revert StaleReport(report.timestamp, block.timestamp);
        }

        // Check minimum report interval
        if (block.timestamp - _lastReportTime[report.feedId] < MIN_REPORT_INTERVAL) {
            emit ReportRejected(report.feedId, bytes32(0), "Too frequent");
            return false;
        }

        // Check quorum
        if (signatures.length < spec.quorumThreshold) {
            revert InsufficientSignatures(signatures.length, spec.quorumThreshold);
        }

        // Compute report hash
        bytes32 reportHash = _computeReportHash(report);

        // Check for replay
        if (_processedReports[reportHash]) {
            revert ReportAlreadyProcessed(reportHash);
        }

        // Verify round
        uint256 expectedRound = _currentRounds[report.feedId] + 1;
        if (report.round != 0 && report.round != expectedRound) {
            // Allow round 0 for first report or explicit round matching
            if (_currentRounds[report.feedId] > 0) {
                revert RoundMismatch(expectedRound, report.round);
            }
        }

        // Verify signatures
        bytes32 ethSignedHash = _toEthSignedMessageHash(reportHash);
        address[] memory signers = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ethSignedHash.recover(signatures[i]);

            // Check for duplicate signers
            for (uint256 j = 0; j < i; j++) {
                if (signers[j] == signer) {
                    revert DuplicateSignature(signer);
                }
            }

            // If committee manager is set, verify membership
            if (address(committeeManager) != address(0)) {
                if (!committeeManager.isCommitteeMember(report.feedId, signer)) {
                    revert SignerNotCommitteeMember(signer);
                }
            }

            signers[i] = signer;
        }

        // Circuit breaker check
        ConsensusPrice storage lastPrice = _consensusPrices[report.feedId];
        if (lastPrice.price > 0) {
            uint256 deviation = _calculateDeviation(lastPrice.price, report.price);
            if (deviation > circuitBreakerBps) {
                revert PriceDeviationTooLarge(deviation, circuitBreakerBps);
            }
        }

        // Update state
        uint256 newRound = report.round > 0 ? report.round : _currentRounds[report.feedId] + 1;

        ConsensusPrice memory newConsensus = ConsensusPrice({
            price: report.price,
            confidence: report.confidence,
            timestamp: report.timestamp,
            round: newRound,
            oracleCount: signatures.length,
            reportHash: reportHash
        });

        _consensusPrices[report.feedId] = newConsensus;
        _historicalPrices[report.feedId][newRound] = newConsensus;
        _currentRounds[report.feedId] = newRound;
        _lastReportTime[report.feedId] = block.timestamp;
        _processedReports[reportHash] = true;

        emit ReportSubmitted(report.feedId, reportHash, report.price, report.confidence, newRound, signatures.length);

        emit ReportVerified(report.feedId, reportHash, report.price, report.timestamp);
        emit ConsensusUpdated(report.feedId, report.price, report.confidence, newRound);

        // Notify connector for performance tracking
        if (address(networkConnector) != address(0)) {
            for (uint256 i = 0; i < signers.length; i++) {
                bytes32 operatorId = networkConnector.workerToOperator(signers[i]);
                if (operatorId != bytes32(0)) {
                    networkConnector.recordReportSubmission(operatorId, true);
                }
            }
        }

        return true;
    }

    function _computeReportHash(PriceReport calldata report) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                report.feedId, report.price, report.confidence, report.timestamp, report.round, report.sourcesHash
            )
        );
    }

    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _calculateDeviation(uint256 oldPrice, uint256 newPrice) internal pure returns (uint256) {
        if (oldPrice == 0 || newPrice == 0) return 0;
        uint256 diff = oldPrice > newPrice ? oldPrice - newPrice : newPrice - oldPrice;
        return (diff * 10000) / oldPrice;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set committee manager
     * @param _committeeManager New committee manager address
     */
    function setCommitteeManager(address _committeeManager) external onlyOwner {
        committeeManager = ICommitteeManager(_committeeManager);
    }

    /**
     * @notice Set network connector for performance tracking
     * @param _connector New connector address
     */
    function setConnector(address _connector) external onlyOwner {
        networkConnector = IOracleNetworkConnector(_connector);
    }

    /**
     * @notice Add or remove authorized transmitter
     * @param transmitter Address to update
     * @param authorized Whether address can submit reports
     */
    function setAuthorizedTransmitter(address transmitter, bool authorized) external onlyOwner {
        authorizedTransmitters[transmitter] = authorized;
    }

    /**
     * @notice Set circuit breaker threshold
     * @param bps Maximum allowed deviation in basis points
     */
    function setCircuitBreakerBps(uint16 bps) external onlyOwner {
        circuitBreakerBps = bps;
    }

    /**
     * @notice Emergency price override (governance only)
     * @param feedId Feed to update
     * @param price New price
     * @param confidence Confidence band
     */
    function emergencyPriceUpdate(bytes32 feedId, uint256 price, uint256 confidence) external onlyOwner {
        uint256 newRound = _currentRounds[feedId] + 1;

        ConsensusPrice memory newConsensus = ConsensusPrice({
            price: price,
            confidence: confidence,
            timestamp: block.timestamp,
            round: newRound,
            oracleCount: 1,
            reportHash: keccak256(abi.encodePacked(feedId, price, block.timestamp, "emergency"))
        });

        _consensusPrices[feedId] = newConsensus;
        _historicalPrices[feedId][newRound] = newConsensus;
        _currentRounds[feedId] = newRound;
        _lastReportTime[feedId] = block.timestamp;

        emit ConsensusUpdated(feedId, price, confidence, newRound);
    }

    /**
     * @notice Pause report submissions
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause report submissions
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Returns the contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
