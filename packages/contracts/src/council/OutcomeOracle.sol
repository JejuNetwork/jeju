// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title OutcomeOracle
 * @author Jeju Network
 * @notice Measures actual outcomes of DAO decisions for AI CEO benchmarking
 * @dev Implements:
 *      - Outcome reporting by authorized evaluators
 *      - Multi-dimensional success metrics
 *      - Dispute period for contested outcomes
 *      - Integration with CEOAgent.recordBenchmark
 *
 * The oracle allows the community to evaluate how well AI CEO decisions
 * actually performed, enabling continuous improvement of the governance AI.
 *
 * Evaluation Dimensions:
 * - Did the decision achieve its stated goals?
 * - Were costs within expected range?
 * - Were there unexpected negative consequences?
 * - Did the community benefit?
 *
 * @custom:security-contact security@jeju.network
 */
contract OutcomeOracle is Ownable, ReentrancyGuard {

    // ============================================================================
    // Structs
    // ============================================================================

    struct OutcomeMetrics {
        uint256 goalAchievement;      // 0-100: Did it achieve stated goals?
        uint256 costEfficiency;        // 0-100: Was cost within expected range?
        uint256 communityImpact;       // 0-100: Net positive community impact?
        uint256 unexpectedConsequences; // 0-100: Score reduced by negative surprises
        uint256 timeliness;            // 0-100: Was it delivered on time?
    }

    struct OutcomeReport {
        bytes32 proposalId;
        bytes32 decisionId;
        address reporter;
        OutcomeMetrics metrics;
        uint256 overallScore;       // Weighted average 0-100
        bytes32 evidenceHash;       // IPFS hash of evidence/analysis
        string summary;
        uint256 reportedAt;
        bool disputed;
        bool finalized;
    }

    struct Dispute {
        bytes32 reportId;
        address disputer;
        bytes32 evidenceHash;
        string reason;
        uint256 stake;
        uint256 disputedAt;
        bool resolved;
        bool reportUpheld;
    }

    struct EvaluatorInfo {
        address evaluator;
        uint256 reportsSubmitted;
        uint256 reportsDisputed;
        uint256 disputesWon;
        uint256 disputesLost;
        uint256 reputation;
        bool isActive;
    }

    // ============================================================================
    // State Variables
    // ============================================================================

    /// @notice CEO Agent contract for benchmarking
    address public ceoAgent;

    /// @notice Council contract for proposal verification
    address public council;

    /// @notice All outcome reports
    mapping(bytes32 => OutcomeReport) public reports;
    bytes32[] public allReportIds;

    /// @notice Reports by proposal
    mapping(bytes32 => bytes32) public proposalReports;

    /// @notice Disputes for reports
    mapping(bytes32 => Dispute[]) public reportDisputes;

    /// @notice Evaluator information
    mapping(address => EvaluatorInfo) public evaluators;
    address[] public allEvaluators;

    /// @notice Authorized evaluators
    mapping(address => bool) public authorizedEvaluators;

    // ============================================================================
    // Parameters
    // ============================================================================

    /// @notice Minimum time after proposal execution before outcome can be reported
    uint256 public minEvaluationDelay = 7 days;

    /// @notice Dispute period after report submission
    uint256 public disputePeriod = 3 days;

    /// @notice Minimum stake required to dispute
    uint256 public minDisputeStake = 0.01 ether;

    /// @notice Threshold score that counts as "success" for benchmarking
    uint256 public successThreshold = 60;

    /// @notice Weights for metric categories (in BPS, should sum to 10000)
    uint256 public weightGoal = 3000;         // 30%
    uint256 public weightCost = 2000;         // 20%
    uint256 public weightCommunity = 2500;    // 25%
    uint256 public weightConsequences = 1500; // 15%
    uint256 public weightTimeliness = 1000;   // 10%

    // ============================================================================
    // Events
    // ============================================================================

    event OutcomeReported(
        bytes32 indexed reportId,
        bytes32 indexed proposalId,
        bytes32 indexed decisionId,
        address reporter,
        uint256 overallScore
    );

    event OutcomeDisputed(
        bytes32 indexed reportId,
        address indexed disputer,
        uint256 stake
    );

    event DisputeResolved(
        bytes32 indexed reportId,
        bool reportUpheld,
        address winner
    );

    event OutcomeFinalized(
        bytes32 indexed reportId,
        bytes32 indexed proposalId,
        bool success,
        uint256 score
    );

    event EvaluatorAuthorized(
        address indexed evaluator
    );

    event EvaluatorDeauthorized(
        address indexed evaluator
    );

    event BenchmarkSubmitted(
        bytes32 indexed decisionId,
        bool success
    );

    // ============================================================================
    // Errors
    // ============================================================================

    error NotAuthorized();
    error ReportNotFound();
    error ReportAlreadyExists();
    error AlreadyDisputed();
    error DisputePeriodActive();
    error DisputePeriodEnded();
    error InsufficientStake();
    error AlreadyFinalized();
    error TooEarly();
    error InvalidMetrics();

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyEvaluator() {
        if (!authorizedEvaluators[msg.sender]) revert NotAuthorized();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        address _ceoAgent,
        address _council,
        address initialOwner
    ) Ownable(initialOwner) {
        ceoAgent = _ceoAgent;
        council = _council;
    }

    // ============================================================================
    // Outcome Reporting
    // ============================================================================

    /**
     * @notice Report the outcome of an executed proposal
     * @param proposalId The proposal that was executed
     * @param decisionId The CEO decision ID (from CEOAgent)
     * @param metrics Detailed outcome metrics
     * @param evidenceHash IPFS hash of evidence/analysis supporting the report
     * @param summary Brief text summary of outcome
     */
    function reportOutcome(
        bytes32 proposalId,
        bytes32 decisionId,
        OutcomeMetrics calldata metrics,
        bytes32 evidenceHash,
        string calldata summary
    ) external onlyEvaluator nonReentrant returns (bytes32 reportId) {
        // Validate proposal exists and was executed (would require council interface)
        if (proposalReports[proposalId] != bytes32(0)) revert ReportAlreadyExists();
        
        // Validate metrics are in range
        if (metrics.goalAchievement > 100 ||
            metrics.costEfficiency > 100 ||
            metrics.communityImpact > 100 ||
            metrics.unexpectedConsequences > 100 ||
            metrics.timeliness > 100) {
            revert InvalidMetrics();
        }

        // Calculate weighted overall score
        uint256 overallScore = _calculateOverallScore(metrics);

        reportId = keccak256(abi.encodePacked(
            proposalId,
            decisionId,
            msg.sender,
            block.timestamp
        ));

        reports[reportId] = OutcomeReport({
            proposalId: proposalId,
            decisionId: decisionId,
            reporter: msg.sender,
            metrics: metrics,
            overallScore: overallScore,
            evidenceHash: evidenceHash,
            summary: summary,
            reportedAt: block.timestamp,
            disputed: false,
            finalized: false
        });

        allReportIds.push(reportId);
        proposalReports[proposalId] = reportId;

        // Update evaluator stats
        EvaluatorInfo storage evaluator = evaluators[msg.sender];
        evaluator.reportsSubmitted++;

        emit OutcomeReported(reportId, proposalId, decisionId, msg.sender, overallScore);
    }

    /**
     * @notice Dispute an outcome report
     * @param reportId Report to dispute
     * @param evidenceHash IPFS hash of counter-evidence
     * @param reason Text explanation of dispute
     */
    function disputeReport(
        bytes32 reportId,
        bytes32 evidenceHash,
        string calldata reason
    ) external payable nonReentrant {
        OutcomeReport storage report = reports[reportId];
        if (report.reportedAt == 0) revert ReportNotFound();
        if (report.finalized) revert AlreadyFinalized();
        if (block.timestamp > report.reportedAt + disputePeriod) {
            revert DisputePeriodEnded();
        }
        if (msg.value < minDisputeStake) revert InsufficientStake();

        report.disputed = true;

        reportDisputes[reportId].push(Dispute({
            reportId: reportId,
            disputer: msg.sender,
            evidenceHash: evidenceHash,
            reason: reason,
            stake: msg.value,
            disputedAt: block.timestamp,
            resolved: false,
            reportUpheld: false
        }));

        // Update evaluator stats
        evaluators[report.reporter].reportsDisputed++;

        emit OutcomeDisputed(reportId, msg.sender, msg.value);
    }

    /**
     * @notice Resolve a dispute (governance decision)
     * @param reportId Report with dispute
     * @param disputeIndex Which dispute to resolve
     * @param upholdReport Whether the original report is upheld
     */
    function resolveDispute(
        bytes32 reportId,
        uint256 disputeIndex,
        bool upholdReport
    ) external onlyOwner nonReentrant {
        OutcomeReport storage report = reports[reportId];
        if (report.reportedAt == 0) revert ReportNotFound();

        Dispute storage dispute = reportDisputes[reportId][disputeIndex];
        if (dispute.resolved) revert AlreadyFinalized();

        dispute.resolved = true;
        dispute.reportUpheld = upholdReport;

        address winner;
        if (upholdReport) {
            // Report was correct, disputer loses stake
            winner = report.reporter;
            evaluators[report.reporter].disputesWon++;
            evaluators[report.reporter].reputation += 10;
            
            // Transfer stake to reporter
            payable(report.reporter).transfer(dispute.stake);
        } else {
            // Dispute was correct, reporter was wrong
            winner = dispute.disputer;
            evaluators[report.reporter].disputesLost++;
            if (evaluators[report.reporter].reputation > 10) {
                evaluators[report.reporter].reputation -= 10;
            }
            
            // Return stake to disputer
            payable(dispute.disputer).transfer(dispute.stake);
        }

        emit DisputeResolved(reportId, upholdReport, winner);
    }

    /**
     * @notice Finalize an outcome report and submit to benchmarking
     * @param reportId Report to finalize
     */
    function finalizeReport(bytes32 reportId) external nonReentrant {
        OutcomeReport storage report = reports[reportId];
        if (report.reportedAt == 0) revert ReportNotFound();
        if (report.finalized) revert AlreadyFinalized();

        // Must be past dispute period
        if (block.timestamp < report.reportedAt + disputePeriod) {
            revert DisputePeriodActive();
        }

        // If disputed, all disputes must be resolved
        Dispute[] storage disputes = reportDisputes[reportId];
        for (uint256 i = 0; i < disputes.length; i++) {
            if (!disputes[i].resolved) revert DisputePeriodActive();
        }

        report.finalized = true;

        // Determine if this counts as success for benchmarking
        bool success = report.overallScore >= successThreshold;

        emit OutcomeFinalized(reportId, report.proposalId, success, report.overallScore);

        // Submit to CEOAgent for benchmarking
        if (ceoAgent != address(0) && report.decisionId != bytes32(0)) {
            _submitBenchmark(report.decisionId, success);
        }
    }

    /**
     * @notice Submit benchmark result to CEOAgent
     */
    function _submitBenchmark(bytes32 decisionId, bool success) internal {
        // Interface with CEOAgent.recordBenchmark
        // Note: This requires the OutcomeOracle to be the owner or have special privileges
        (bool ok,) = ceoAgent.call(
            abi.encodeWithSignature("recordBenchmark(bytes32,bool)", decisionId, success)
        );
        
        if (ok) {
            emit BenchmarkSubmitted(decisionId, success);
        }
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    function _calculateOverallScore(OutcomeMetrics calldata metrics) internal view returns (uint256) {
        uint256 score = 0;
        score += metrics.goalAchievement * weightGoal;
        score += metrics.costEfficiency * weightCost;
        score += metrics.communityImpact * weightCommunity;
        score += metrics.unexpectedConsequences * weightConsequences;
        score += metrics.timeliness * weightTimeliness;
        return score / 10000; // Divide by total weight
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function getReport(bytes32 reportId) external view returns (OutcomeReport memory) {
        return reports[reportId];
    }

    function getReportForProposal(bytes32 proposalId) external view returns (OutcomeReport memory) {
        bytes32 reportId = proposalReports[proposalId];
        return reports[reportId];
    }

    function getDisputes(bytes32 reportId) external view returns (Dispute[] memory) {
        return reportDisputes[reportId];
    }

    function getEvaluator(address evaluator) external view returns (EvaluatorInfo memory) {
        return evaluators[evaluator];
    }

    function getAllReports() external view returns (bytes32[] memory) {
        return allReportIds;
    }

    function getReportCount() external view returns (uint256) {
        return allReportIds.length;
    }

    function canFinalize(bytes32 reportId) external view returns (bool) {
        OutcomeReport storage report = reports[reportId];
        if (report.reportedAt == 0 || report.finalized) return false;
        if (block.timestamp < report.reportedAt + disputePeriod) return false;

        Dispute[] storage disputes = reportDisputes[reportId];
        for (uint256 i = 0; i < disputes.length; i++) {
            if (!disputes[i].resolved) return false;
        }
        return true;
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function authorizeEvaluator(address evaluator) external onlyOwner {
        authorizedEvaluators[evaluator] = true;
        
        if (evaluators[evaluator].evaluator == address(0)) {
            evaluators[evaluator] = EvaluatorInfo({
                evaluator: evaluator,
                reportsSubmitted: 0,
                reportsDisputed: 0,
                disputesWon: 0,
                disputesLost: 0,
                reputation: 100,
                isActive: true
            });
            allEvaluators.push(evaluator);
        } else {
            evaluators[evaluator].isActive = true;
        }

        emit EvaluatorAuthorized(evaluator);
    }

    function deauthorizeEvaluator(address evaluator) external onlyOwner {
        authorizedEvaluators[evaluator] = false;
        evaluators[evaluator].isActive = false;
        emit EvaluatorDeauthorized(evaluator);
    }

    function setCEOAgent(address _ceoAgent) external onlyOwner {
        ceoAgent = _ceoAgent;
    }

    function setCouncil(address _council) external onlyOwner {
        council = _council;
    }

    function setParameters(
        uint256 _minEvaluationDelay,
        uint256 _disputePeriod,
        uint256 _minDisputeStake,
        uint256 _successThreshold
    ) external onlyOwner {
        minEvaluationDelay = _minEvaluationDelay;
        disputePeriod = _disputePeriod;
        minDisputeStake = _minDisputeStake;
        successThreshold = _successThreshold;
    }

    function setWeights(
        uint256 _weightGoal,
        uint256 _weightCost,
        uint256 _weightCommunity,
        uint256 _weightConsequences,
        uint256 _weightTimeliness
    ) external onlyOwner {
        require(
            _weightGoal + _weightCost + _weightCommunity + _weightConsequences + _weightTimeliness == 10000,
            "Weights must sum to 10000"
        );
        weightGoal = _weightGoal;
        weightCost = _weightCost;
        weightCommunity = _weightCommunity;
        weightConsequences = _weightConsequences;
        weightTimeliness = _weightTimeliness;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
