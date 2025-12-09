// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./BanManager.sol";
import "./ReputationLabelManager.sol";
import "../registry/interfaces/IIdentityRegistry.sol";

interface IPredimarketReport {
    function createMarket(bytes32 sessionId, string memory question, uint256 liquidityParameter) external;
    function getMarket(bytes32 sessionId)
        external
        view
        returns (
            bytes32 id,
            string memory question,
            uint256 yesShares,
            uint256 noShares,
            uint256 liquidityParameter,
            uint256 totalVolume,
            uint256 createdAt,
            bool resolved,
            bool outcome
        );
}

/**
 * @title ReportingSystem
 * @author Jeju Network
 * @notice Cross-app reporting system with futarchy-based resolution
 * @dev Central hub for reporting bad actors across all Jeju apps
 *
 * Report Types:
 * - NETWORK_BAN: Ban from entire Jeju network (most severe)
 * - APP_BAN: Ban from specific app only
 * - LABEL_HACKER: Apply HACKER label (auto network ban)
 * - LABEL_SCAMMER: Apply SCAMMER label (warning)
 *
 * Severity Levels:
 * - LOW: 7 day voting period
 * - MEDIUM: 3 day voting period
 * - HIGH: 24 hour voting period
 * - CRITICAL: Immediate temp ban + 24 hour voting
 *
 * Process Flow:
 * 1. User submits report with evidence (IPFS) and stake
 * 2. System creates futarchy market in Predimarket
 * 3. Community votes via market trading (7 days default)
 * 4. Market resolves YES/NO
 * 5. If YES: trigger ban/label via governance
 * 6. If NO: refund reporter, maybe slash for false report
 *
 * @custom:security-contact security@jeju.network
 */
contract ReportingSystem is Ownable, Pausable, ReentrancyGuard {
    // ============ Enums ============

    enum ReportType {
        NETWORK_BAN, // Ban from all apps
        APP_BAN, // Ban from specific app
        LABEL_HACKER, // Apply hacker label
        LABEL_SCAMMER // Apply scammer label

    }

    enum ReportSeverity {
        LOW, // 7 day vote
        MEDIUM, // 3 day vote
        HIGH, // 24 hour vote
        CRITICAL // Immediate temp ban + 24 hour vote

    }

    enum ReportStatus {
        PENDING, // Voting in progress
        RESOLVED_YES, // Action approved
        RESOLVED_NO, // Action denied
        EXECUTED // Action taken

    }

    // ============ Structs ============

    struct Report {
        uint256 reportId;
        ReportType reportType;
        ReportSeverity severity;
        uint256 targetAgentId;
        bytes32 sourceAppId; // Which app reported from
        address reporter;
        uint256 reporterAgentId; // Reporter's agent ID (0 if none)
        bytes32 evidenceHash; // IPFS hash
        string details; // Additional context
        bytes32 marketId; // Predimarket market
        uint256 reportBond; // Stake amount
        uint256 createdAt;
        uint256 votingEnds;
        ReportStatus status;
    }

    // ============ State Variables ============

    BanManager public immutable banManager;
    ReputationLabelManager public immutable labelManager;
    IPredimarketReport public immutable predimarket;
    IIdentityRegistry public immutable identityRegistry;
    address public governance;

    /// @notice All reports
    mapping(uint256 => Report) public reports;

    /// @notice Reports per target agent
    mapping(uint256 => uint256[]) private _agentReports;

    /// @notice Reports by reporter address
    mapping(address => uint256[]) private _reporterReports;

    /// @notice Active reports per app
    mapping(bytes32 => uint256[]) private _appReports;

    /// @notice Report counter
    uint256 private _nextReportId = 1;

    /// @notice All report IDs
    uint256[] public allReportIds;

    /// @notice Report bond requirements by severity
    mapping(ReportSeverity => uint256) public reportBonds;

    /// @notice Voting periods by severity
    mapping(ReportSeverity => uint256) public votingPeriods;

    /// @notice Default market liquidity
    uint256 public defaultLiquidity = 1000 ether;

    /// @notice Reporter reputation tracking (successful reports)
    mapping(address => uint256) public reporterScore;

    // ============ Events ============

    event ReportCreated(
        uint256 indexed reportId,
        uint256 indexed targetAgentId,
        ReportType reportType,
        ReportSeverity severity,
        address indexed reporter,
        bytes32 marketId,
        bytes32 evidenceHash
    );

    event ReportResolved(uint256 indexed reportId, bool actionApproved, uint256 timestamp);

    event ReportExecuted(
        uint256 indexed reportId, uint256 indexed targetAgentId, ReportType reportType, uint256 timestamp
    );

    event ReporterRewarded(uint256 indexed reportId, address indexed reporter, uint256 amount);

    event ReporterSlashed(uint256 indexed reportId, address indexed reporter, uint256 amount);

    event CriticalTempBan(uint256 indexed reportId, uint256 indexed targetAgentId, bytes32 indexed appId);

    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);
    event DefaultLiquidityUpdated(uint256 oldLiquidity, uint256 newLiquidity);

    // ============ Errors ============

    error InsufficientBond();
    error InvalidAgentId();
    error InvalidAppId();
    error ReportNotFound();
    error ReportNotPending();
    error ReportNotResolved();
    error VotingNotEnded();
    error OnlyGovernance();

    // ============ Modifiers ============

    modifier onlyGovernance() {
        if (msg.sender != governance && msg.sender != owner()) {
            revert OnlyGovernance();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _banManager,
        address _labelManager,
        address _predimarket,
        address _identityRegistry,
        address _governance,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_banManager != address(0), "Invalid BanManager");
        require(_labelManager != address(0), "Invalid LabelManager");
        require(_predimarket != address(0), "Invalid Predimarket");
        require(_identityRegistry != address(0), "Invalid IdentityRegistry");
        require(_governance != address(0), "Invalid governance");

        banManager = BanManager(_banManager);
        labelManager = ReputationLabelManager(payable(_labelManager));
        predimarket = IPredimarketReport(_predimarket);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        governance = _governance;

        // Set default report bonds
        reportBonds[ReportSeverity.LOW] = 0.001 ether;
        reportBonds[ReportSeverity.MEDIUM] = 0.01 ether;
        reportBonds[ReportSeverity.HIGH] = 0.05 ether;
        reportBonds[ReportSeverity.CRITICAL] = 0.1 ether;

        // Set voting periods
        votingPeriods[ReportSeverity.LOW] = 7 days;
        votingPeriods[ReportSeverity.MEDIUM] = 3 days;
        votingPeriods[ReportSeverity.HIGH] = 1 days;
        votingPeriods[ReportSeverity.CRITICAL] = 1 days;
    }

    // ============ Core Functions ============

    /**
     * @notice Submit a report against an agent
     * @param targetAgentId Agent to report
     * @param reportType Type of action requested
     * @param severity Severity level
     * @param sourceAppId App reporting from
     * @param evidenceHash IPFS hash of evidence
     * @param details Additional details/context
     * @return reportId Report identifier
     * @return marketId Created market identifier
     * @dev State writes after external call are benign - protected by nonReentrant
     */
    // slither-disable-next-line reentrancy-benign
    function submitReport(
        uint256 targetAgentId,
        ReportType reportType,
        ReportSeverity severity,
        bytes32 sourceAppId,
        bytes32 evidenceHash,
        string calldata details
    ) external payable nonReentrant whenNotPaused returns (uint256 reportId, bytes32 marketId) {
        if (targetAgentId == 0) revert InvalidAgentId();
        if (sourceAppId == bytes32(0)) revert InvalidAppId();

        uint256 requiredBond = reportBonds[severity];
        if (msg.value < requiredBond) revert InsufficientBond();

        reportId = _nextReportId++;

        // Generate market question
        string memory question = _generateMarketQuestion(targetAgentId, reportType);
        marketId = bytes32(uint256(uint160(address(this))) | reportId);

        // Create futarchy market
        predimarket.createMarket(marketId, question, defaultLiquidity);

        // Store report
        uint256 votingPeriod = votingPeriods[severity];
        reports[reportId] = Report({
            reportId: reportId,
            reportType: reportType,
            severity: severity,
            targetAgentId: targetAgentId,
            sourceAppId: sourceAppId,
            reporter: msg.sender,
            reporterAgentId: 0, // Reporter agent ID determined at voting
            evidenceHash: evidenceHash,
            details: details,
            marketId: marketId,
            reportBond: msg.value,
            createdAt: block.timestamp,
            votingEnds: block.timestamp + votingPeriod,
            status: ReportStatus.PENDING
        });

        // Track report
        allReportIds.push(reportId);
        _agentReports[targetAgentId].push(reportId);
        _reporterReports[msg.sender].push(reportId);
        _appReports[sourceAppId].push(reportId);

        emit ReportCreated(reportId, targetAgentId, reportType, severity, msg.sender, marketId, evidenceHash);

        // Handle CRITICAL severity - apply temp ban immediately
        if (severity == ReportSeverity.CRITICAL) {
            if (reportType == ReportType.NETWORK_BAN) {
                // Temp network ban (will be made permanent if vote passes)
                // slither-disable-next-line encode-packed-collision
                // @audit-ok String concatenation for ban reason, not hashed
                banManager.banFromNetwork(
                    targetAgentId,
                    string(abi.encodePacked("TEMP BAN - Critical report #", _uint2str(reportId), " pending vote")),
                    bytes32(reportId)
                );
            } else if (reportType == ReportType.APP_BAN) {
                // Temp app ban
                // slither-disable-next-line encode-packed-collision
                // @audit-ok String concatenation for ban reason, not hashed
                banManager.banFromApp(
                    targetAgentId,
                    sourceAppId,
                    string(abi.encodePacked("TEMP BAN - Critical report #", _uint2str(reportId), " pending vote")),
                    bytes32(reportId)
                );
            }

            emit CriticalTempBan(reportId, targetAgentId, sourceAppId);
        }

        return (reportId, marketId);
    }

    /**
     * @notice Resolve report based on market outcome
     * @param reportId Report to resolve
     * @custom:security CEI pattern: Update all state before external calls
     * @dev Sends ETH to reporter (reward) and owner (treasury) - intentional design
     *      Ignores return values from predimarket.getMarket() - only needs resolved/outcome
     *      Uses timestamp for voting period check - intentional
     */
    // slither-disable-next-line arbitrary-send-eth,unused-return,timestamp,low-level-calls
    function resolveReport(uint256 reportId) external nonReentrant {
        Report storage report = reports[reportId];
        if (report.reportId == 0) revert ReportNotFound();
        if (report.status != ReportStatus.PENDING) revert ReportNotPending();
        if (block.timestamp < report.votingEnds) revert VotingNotEnded();

        // Get market outcome
        (,,,,,,, bool resolved, bool outcome) = predimarket.getMarket(report.marketId);
        if (!resolved) revert ReportNotResolved();

        // Cache values before state changes
        address reporter = report.reporter;
        uint256 reportBond = report.reportBond;
        ReportSeverity severity = report.severity;
        ReportType reportType = report.reportType;
        uint256 targetAgentId = report.targetAgentId;
        bytes32 sourceAppId = report.sourceAppId;

        if (outcome) {
            // YES: Action approved
            // EFFECTS: Update ALL state BEFORE external calls
            report.status = ReportStatus.RESOLVED_YES;
            reporterScore[reporter]++;

            // Calculate reward
            uint256 bonus = reportBond / 10; // 10% target bonus
            uint256 maxReward = reportBond + bonus;
            uint256 reward = address(this).balance >= maxReward ? maxReward : reportBond;

            // Emit events before external calls
            emit ReporterRewarded(reportId, reporter, reward);
            emit ReportResolved(reportId, outcome, block.timestamp);

            // INTERACTIONS: External calls last
            (bool success,) = reporter.call{value: reward}("");
            require(success, "Reward transfer failed");
        } else {
            // NO: Action denied
            // EFFECTS: Update state BEFORE external calls
            report.status = ReportStatus.RESOLVED_NO;

            uint256 halfBond = reportBond / 2;

            // Emit events before external calls
            emit ReporterSlashed(reportId, reporter, reportBond);
            emit ReportResolved(reportId, outcome, block.timestamp);

            // INTERACTIONS: External calls last
            (bool success1,) = owner().call{value: halfBond}("");
            require(success1, "Treasury transfer failed");

            // If was temp ban from CRITICAL, remove it
            if (severity == ReportSeverity.CRITICAL) {
                if (reportType == ReportType.NETWORK_BAN) {
                    banManager.unbanFromNetwork(targetAgentId);
                } else if (reportType == ReportType.APP_BAN) {
                    banManager.unbanFromApp(targetAgentId, sourceAppId);
                }
            }
        }
    }

    /**
     * @notice Execute approved report action (governance only)
     * @param reportId Report to execute
     * @dev Called by governance after resolution and timelock
     *      Ignores return values from labelManager.proposeLabel() - fire and forget
     * @custom:security CEI pattern: Update all state before external calls
     */
    // slither-disable-next-line unused-return
    function executeReport(uint256 reportId) external nonReentrant onlyGovernance {
        Report storage report = reports[reportId];
        if (report.status != ReportStatus.RESOLVED_YES) revert ReportNotResolved();

        // Cache values before state changes
        ReportType reportType = report.reportType;
        uint256 targetAgentId = report.targetAgentId;
        bytes32 sourceAppId = report.sourceAppId;
        bytes32 evidenceHash = report.evidenceHash;
        string memory details = report.details;

        // EFFECTS: Update state BEFORE external calls (CEI pattern)
        report.status = ReportStatus.EXECUTED;

        // Emit event before external calls
        emit ReportExecuted(reportId, targetAgentId, reportType, block.timestamp);

        // INTERACTIONS: Execute based on report type
        if (reportType == ReportType.NETWORK_BAN) {
            // slither-disable-next-line encode-packed-collision
            // @audit-ok String concatenation for ban reason, not hashed
            banManager.banFromNetwork(
                targetAgentId,
                string(abi.encodePacked("Report #", _uint2str(reportId), ": ", details)),
                bytes32(reportId)
            );
        } else if (reportType == ReportType.APP_BAN) {
            // slither-disable-next-line encode-packed-collision
            // @audit-ok String concatenation for ban reason, not hashed
            banManager.banFromApp(
                targetAgentId,
                sourceAppId,
                string(abi.encodePacked("Report #", _uint2str(reportId), ": ", details)),
                bytes32(reportId)
            );
        } else if (reportType == ReportType.LABEL_HACKER) {
            labelManager.proposeLabel{value: 0.1 ether}(
                targetAgentId, ReputationLabelManager.Label.HACKER, evidenceHash
            );
        } else if (reportType == ReportType.LABEL_SCAMMER) {
            labelManager.proposeLabel{value: 0.05 ether}(
                targetAgentId, ReputationLabelManager.Label.SCAMMER, evidenceHash
            );
        }
    }

    // ============ Internal Functions ============

    // slither-disable-next-line encode-packed-collision
    // @audit-ok All abi.encodePacked uses are for string concatenation, not hashed - no collision risk
    function _generateMarketQuestion(uint256 agentId, ReportType reportType) internal pure returns (string memory) {
        if (reportType == ReportType.NETWORK_BAN) {
            return string(
                abi.encodePacked("Should Agent #", _uint2str(agentId), " be BANNED from the entire Jeju network?")
            );
        } else if (reportType == ReportType.APP_BAN) {
            return string(abi.encodePacked("Should Agent #", _uint2str(agentId), " be BANNED from this app?"));
        } else if (reportType == ReportType.LABEL_HACKER) {
            return string(abi.encodePacked("Should Agent #", _uint2str(agentId), " be labeled as HACKER?"));
        } else {
            return string(abi.encodePacked("Should Agent #", _uint2str(agentId), " be labeled as SCAMMER?"));
        }
    }

    function _uint2str(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    // ============ Query Functions ============

    /**
     * @notice Get all reports for a target agent
     */
    function getReportsByTarget(uint256 agentId) external view returns (uint256[] memory) {
        return _agentReports[agentId];
    }

    /**
     * @notice Get all reports by a reporter
     */
    function getReportsByReporter(address reporter) external view returns (uint256[] memory) {
        return _reporterReports[reporter];
    }

    /**
     * @notice Get active reports for an app
     */
    function getActiveReports(bytes32 appId) external view returns (uint256[] memory) {
        return _appReports[appId];
    }

    /**
     * @notice Get all reports
     */
    function getAllReports() external view returns (uint256[] memory) {
        return allReportIds;
    }

    /**
     * @notice Get report details
     */
    function getReport(uint256 reportId) external view returns (Report memory) {
        return reports[reportId];
    }

    // ============ Admin Functions ============

    function setReportBond(ReportSeverity severity, uint256 amount) external onlyOwner {
        reportBonds[severity] = amount;
    }

    function setVotingPeriod(ReportSeverity severity, uint256 period) external onlyOwner {
        votingPeriods[severity] = period;
    }

    function setDefaultLiquidity(uint256 liquidity) external onlyOwner {
        uint256 oldLiquidity = defaultLiquidity;
        defaultLiquidity = liquidity;
        emit DefaultLiquidityUpdated(oldLiquidity, liquidity);
    }

    function setGovernance(address newGovernance) external onlyOwner {
        require(newGovernance != address(0), "Invalid governance");
        address oldGovernance = governance;
        governance = newGovernance;
        emit GovernanceUpdated(oldGovernance, newGovernance);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
