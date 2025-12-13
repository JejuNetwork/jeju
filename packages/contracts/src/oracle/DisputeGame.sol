// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDisputeGame} from "./interfaces/IDisputeGame.sol";
import {IReportVerifier} from "./interfaces/IReportVerifier.sol";
import {IFeedRegistry} from "./interfaces/IFeedRegistry.sol";

/// @title DisputeGame
/// @notice Dispute resolution for oracle reports with bonds and slashing
contract DisputeGame is IDisputeGame, Ownable, Pausable, ReentrancyGuard {
    uint256 public constant MIN_BOND_USD = 100 ether;
    uint256 public constant CHALLENGE_WINDOW = 24 hours;
    uint256 public constant RESOLUTION_WINDOW = 72 hours;
    uint16 public constant DISPUTER_REWARD_BPS = 3000;
    uint16 public constant BPS_DENOMINATOR = 10000;

    IReportVerifier public immutable reportVerifier;
    IFeedRegistry public immutable feedRegistry;

    mapping(bytes32 => Dispute) private _disputes;
    mapping(bytes32 => DisputeResolution) private _resolutions;
    mapping(bytes32 => bytes32) private _reportDisputes;
    bytes32[] private _activeDisputes;
    mapping(bytes32 => bytes32[]) private _disputesByFeed;
    mapping(address => bytes32[]) private _disputesByDisputer;
    DisputeConfig private _config;
    uint256 private _disputeCounter;
    mapping(address => bool) public authorizedResolvers;
    address public futarchyMarketplace;
    mapping(bytes32 => bytes32) private _futarchyMarkets;

    constructor(address _reportVerifier, address _feedRegistry, address initialOwner) Ownable(initialOwner) {
        reportVerifier = IReportVerifier(_reportVerifier);
        feedRegistry = IFeedRegistry(_feedRegistry);
        _config = DisputeConfig({
            minBondUSD: MIN_BOND_USD,
            challengeWindowSeconds: CHALLENGE_WINDOW,
            resolutionWindowSeconds: RESOLUTION_WINDOW,
            slashDeviationBps: 500,
            maxSlashBps: 1000,
            disputerRewardBps: DISPUTER_REWARD_BPS,
            autoResolveEnabled: true
        });
        authorizedResolvers[initialOwner] = true;
    }

    function openDispute(bytes32 reportHash, DisputeReason reason, bytes32 evidenceHash)
        external payable nonReentrant whenNotPaused returns (bytes32 disputeId)
    {
        if (!reportVerifier.isReportProcessed(reportHash)) revert ReportNotDisputable(reportHash);
        if (_reportDisputes[reportHash] != bytes32(0)) revert DisputeAlreadyExists(reportHash);
        if (msg.value < _config.minBondUSD) revert InsufficientBond(msg.value, _config.minBondUSD);

        disputeId = keccak256(abi.encodePacked(reportHash, msg.sender, block.timestamp, ++_disputeCounter));

        Dispute storage d = _disputes[disputeId];
        d.disputeId = disputeId;
        d.reportHash = reportHash;
        d.disputer = msg.sender;
        d.bond = msg.value;
        d.reason = reason;
        d.evidenceHash = evidenceHash;
        d.status = DisputeStatus.OPEN;
        d.createdAt = block.timestamp;
        d.deadline = block.timestamp + _config.challengeWindowSeconds + _config.resolutionWindowSeconds;

        _reportDisputes[reportHash] = disputeId;
        _activeDisputes.push(disputeId);
        _disputesByDisputer[msg.sender].push(disputeId);
        emit DisputeOpened(disputeId, reportHash, bytes32(0), msg.sender, msg.value, reason);
    }

    function challengeDispute(bytes32 disputeId) external payable nonReentrant {
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == bytes32(0)) revert DisputeNotFound(disputeId);
        if (d.status != DisputeStatus.OPEN) revert DisputeNotOpen(disputeId);
        if (block.timestamp > d.createdAt + _config.challengeWindowSeconds) revert ChallengeWindowClosed(disputeId);
        if (msg.value < d.bond) revert InsufficientBond(msg.value, d.bond);

        d.status = DisputeStatus.CHALLENGED;
        d.bond += msg.value;
        emit DisputeChallenged(disputeId, msg.sender, msg.value);
    }

    function resolveDispute(bytes32 disputeId, ResolutionOutcome outcome, string calldata note) external nonReentrant {
        if (!authorizedResolvers[msg.sender] && msg.sender != owner()) revert NotAuthorizedResolver();
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == bytes32(0)) revert DisputeNotFound(disputeId);
        if (d.status != DisputeStatus.OPEN && d.status != DisputeStatus.CHALLENGED) revert DisputeNotOpen(disputeId);
        _resolve(disputeId, outcome, note);
    }

    function resolveDisputeAutomatic(bytes32 disputeId) external nonReentrant {
        if (!_config.autoResolveEnabled) revert NotAuthorizedResolver();
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == bytes32(0)) revert DisputeNotFound(disputeId);
        if (d.status != DisputeStatus.OPEN) revert DisputeNotOpen(disputeId);
        if (d.reason != DisputeReason.PRICE_DEVIATION) revert NotAuthorizedResolver();
        if (block.timestamp < d.createdAt + _config.challengeWindowSeconds) revert ResolutionWindowActive(disputeId);
        _resolve(disputeId, ResolutionOutcome.REPORT_INVALID, "Auto-resolved");
    }

    function escalateToFutarchy(bytes32 disputeId) external nonReentrant returns (bytes32 marketId) {
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == bytes32(0)) revert DisputeNotFound(disputeId);
        if (d.status != DisputeStatus.CHALLENGED) revert DisputeNotOpen(disputeId);
        if (futarchyMarketplace == address(0)) revert NotAuthorizedResolver();

        d.status = DisputeStatus.ESCALATED_TO_FUTARCHY;
        marketId = keccak256(abi.encodePacked(disputeId, block.timestamp));
        _futarchyMarkets[disputeId] = marketId;
        emit DisputeEscalated(disputeId, marketId);
    }

    function resolveFromFutarchy(bytes32 disputeId, bool reportValid) external nonReentrant {
        if (msg.sender != futarchyMarketplace && msg.sender != owner()) revert NotAuthorizedResolver();
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == bytes32(0)) revert DisputeNotFound(disputeId);
        if (d.status != DisputeStatus.ESCALATED_TO_FUTARCHY) revert DisputeNotOpen(disputeId);
        _resolve(disputeId, reportValid ? ResolutionOutcome.REPORT_VALID : ResolutionOutcome.REPORT_INVALID, "Futarchy");
    }

    function expireDispute(bytes32 disputeId) external nonReentrant {
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == bytes32(0)) revert DisputeNotFound(disputeId);
        if (d.status != DisputeStatus.OPEN && d.status != DisputeStatus.CHALLENGED) revert DisputeNotOpen(disputeId);
        if (block.timestamp < d.deadline) revert DisputeNotOpen(disputeId);

        d.status = DisputeStatus.EXPIRED;
        _transfer(d.disputer, d.bond);
        _removeActive(disputeId);
        emit DisputeExpired(disputeId);
    }

    function _resolve(bytes32 disputeId, ResolutionOutcome outcome, string memory note) internal {
        Dispute storage d = _disputes[disputeId];
        uint256 slashAmount;
        uint256 reward;

        if (outcome == ResolutionOutcome.REPORT_INVALID) {
            slashAmount = _calculateSlashAmount(d.affectedSigners);
            reward = (d.bond * _config.disputerRewardBps) / BPS_DENOMINATOR;
            uint256 payout = d.bond + reward;
            _transfer(d.disputer, payout > address(this).balance ? address(this).balance : payout);
            d.status = DisputeStatus.RESOLVED_INVALID;
            emit SignersSlashed(disputeId, d.affectedSigners, slashAmount);
            emit DisputerRewarded(disputeId, d.disputer, reward);
        } else if (outcome == ResolutionOutcome.REPORT_VALID) {
            d.status = DisputeStatus.RESOLVED_VALID;
        } else {
            _transfer(d.disputer, d.bond / 2);
            d.status = DisputeStatus.RESOLVED_VALID;
        }

        _resolutions[disputeId] = DisputeResolution(outcome, block.timestamp, msg.sender, slashAmount, reward, note);
        _removeActive(disputeId);
        emit DisputeResolved(disputeId, outcome, slashAmount, reward);
    }

    function _removeActive(bytes32 disputeId) internal {
        uint256 len = _activeDisputes.length;
        for (uint256 i; i < len; ++i) {
            if (_activeDisputes[i] == disputeId) {
                _activeDisputes[i] = _activeDisputes[len - 1];
                _activeDisputes.pop();
                return;
            }
        }
    }

    function _transfer(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert InsufficientBond(0, amount);
    }

    function getDispute(bytes32 id) external view returns (Dispute memory) { return _disputes[id]; }
    function getDisputeResolution(bytes32 id) external view returns (DisputeResolution memory) { return _resolutions[id]; }
    function getDisputeConfig() external view returns (DisputeConfig memory) { return _config; }
    function getDisputeByReport(bytes32 h) external view returns (Dispute memory) { return _disputes[_reportDisputes[h]]; }
    function getActiveDisputes() external view returns (bytes32[] memory) { return _activeDisputes; }
    function getDisputesByFeed(bytes32 id) external view returns (bytes32[] memory) { return _disputesByFeed[id]; }
    function getDisputesByDisputer(address d) external view returns (bytes32[] memory) { return _disputesByDisputer[d]; }
    function isReportDisputed(bytes32 h) external view returns (bool) { return _reportDisputes[h] != bytes32(0); }
    function canDispute(bytes32 h) external view returns (bool) { return _reportDisputes[h] == bytes32(0) && reportVerifier.isReportProcessed(h); }
    function getMinBond() external view returns (uint256) { return _config.minBondUSD; }
    function calculateSlashAmount(bytes32, address[] calldata signers) external pure returns (uint256) {
        return signers.length * 0.1 ether;
    }

    function _calculateSlashAmount(address[] memory signers) internal pure returns (uint256) {
        return signers.length * 0.1 ether;
    }

    function canResolve(bytes32 disputeId) external view returns (bool) {
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == bytes32(0)) return false;
        if (d.status != DisputeStatus.OPEN && d.status != DisputeStatus.CHALLENGED) return false;
        return block.timestamp >= d.createdAt + _config.challengeWindowSeconds;
    }

    function setDisputeConfig(DisputeConfig calldata c) external onlyOwner { _config = c; }
    function setAuthorizedResolver(address r, bool a) external onlyOwner { authorizedResolvers[r] = a; }
    function setFutarchyMarketplace(address m) external onlyOwner { futarchyMarketplace = m; }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}
}
