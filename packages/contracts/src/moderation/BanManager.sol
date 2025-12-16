// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BanManager
 * @notice Manages network-level and app-specific bans for agent identity system
 */
contract BanManager is Ownable, Pausable {
    enum BanType {
        NONE,
        ON_NOTICE,
        CHALLENGED,
        PERMANENT
    }

    struct BanRecord {
        bool isBanned;
        uint256 bannedAt;
        string reason;
        bytes32 proposalId;
    }

    struct ExtendedBanRecord {
        bool isBanned;
        BanType banType;
        uint256 bannedAt;
        uint256 expiresAt;
        string reason;
        bytes32 proposalId;
        address reporter;
        bytes32 caseId;
    }

    mapping(uint256 => BanRecord) public networkBans;
    mapping(uint256 => ExtendedBanRecord) public extendedBans;
    mapping(address => ExtendedBanRecord) public addressBans;
    mapping(uint256 => mapping(bytes32 => BanRecord)) public appBans;
    mapping(uint256 => bytes32[]) private _agentAppBans;
    address public governance;
    mapping(address => bool) public authorizedModerators;

    event NetworkBanApplied(uint256 indexed agentId, string reason, bytes32 indexed proposalId, uint256 timestamp);

    event AppBanApplied(
        uint256 indexed agentId, bytes32 indexed appId, string reason, bytes32 indexed proposalId, uint256 timestamp
    );

    event NetworkBanRemoved(uint256 indexed agentId, uint256 timestamp);

    event AppBanRemoved(uint256 indexed agentId, bytes32 indexed appId, uint256 timestamp);

    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);

    event ModeratorUpdated(address indexed moderator, bool authorized);

    event OnNoticeBanApplied(address indexed target, address indexed reporter, bytes32 indexed caseId, string reason);

    event AddressBanApplied(address indexed target, BanType banType, bytes32 indexed caseId, string reason);

    event AddressBanUpdated(address indexed target, BanType oldType, BanType newType);

    event AddressBanRemoved(address indexed target);


    error OnlyGovernance();
    error OnlyModerator();
    error AlreadyBanned();
    error NotBanned();
    error InvalidAppId();
    error InvalidAgentId();
    error InvalidAddress();


    modifier onlyGovernance() {
        if (msg.sender != governance && msg.sender != owner()) {
            revert OnlyGovernance();
        }
        _;
    }

    modifier onlyModerator() {
        if (!authorizedModerators[msg.sender] && msg.sender != governance && msg.sender != owner()) {
            revert OnlyModerator();
        }
        _;
    }


    constructor(address _governance, address initialOwner) Ownable(initialOwner) {
        require(_governance != address(0), "Invalid governance");
        governance = _governance;
    }

    function banFromNetwork(uint256 agentId, string calldata reason, bytes32 proposalId)
        external
        onlyGovernance
        whenNotPaused
    {
        if (agentId == 0) revert InvalidAgentId();
        if (networkBans[agentId].isBanned) revert AlreadyBanned();

        networkBans[agentId] =
            BanRecord({isBanned: true, bannedAt: block.timestamp, reason: reason, proposalId: proposalId});

        emit NetworkBanApplied(agentId, reason, proposalId, block.timestamp);
    }

    function banFromApp(uint256 agentId, bytes32 appId, string calldata reason, bytes32 proposalId)
        external
        onlyGovernance
        whenNotPaused
    {
        if (agentId == 0) revert InvalidAgentId();
        if (appId == bytes32(0)) revert InvalidAppId();
        if (appBans[agentId][appId].isBanned) revert AlreadyBanned();

        appBans[agentId][appId] =
            BanRecord({isBanned: true, bannedAt: block.timestamp, reason: reason, proposalId: proposalId});

        // Track app ban for querying
        _agentAppBans[agentId].push(appId);

        emit AppBanApplied(agentId, appId, reason, proposalId, block.timestamp);
    }

    /**
     * @notice Remove network-wide ban (via appeal)
     * @param agentId Agent ID to unban
     */
    function unbanFromNetwork(uint256 agentId) external onlyGovernance {
        if (!networkBans[agentId].isBanned) revert NotBanned();

        delete networkBans[agentId];

        emit NetworkBanRemoved(agentId, block.timestamp);
    }

    /**
     * @notice Remove app-specific ban
     * @param agentId Agent ID to unban
     * @param appId App identifier
     */
    function unbanFromApp(uint256 agentId, bytes32 appId) external onlyGovernance {
        if (!appBans[agentId][appId].isBanned) revert NotBanned();

        delete appBans[agentId][appId];

        // Remove from tracking array
        bytes32[] storage bans = _agentAppBans[agentId];
        for (uint256 i = 0; i < bans.length; i++) {
            if (bans[i] == appId) {
                bans[i] = bans[bans.length - 1];
                bans.pop();
                break;
            }
        }

        emit AppBanRemoved(agentId, appId, block.timestamp);
    }

    // ============ Access Control Checks ============

    /**
     * @notice Check if agent has access to specific app
     * @param agentId Agent ID to check
     * @param appId App identifier
     * @return allowed True if access allowed, false if banned
     * @dev This is the main function apps call to check access
     */
    function isAccessAllowed(uint256 agentId, bytes32 appId) external view returns (bool allowed) {
        // Network ban denies access to ALL apps
        if (networkBans[agentId].isBanned) {
            return false;
        }

        // App-specific ban
        if (appBans[agentId][appId].isBanned) {
            return false;
        }

        return true;
    }

    /**
     * @notice Check if agent is network banned
     * @param agentId Agent ID to check
     * @return True if network banned
     */
    function isNetworkBanned(uint256 agentId) external view returns (bool) {
        return networkBans[agentId].isBanned;
    }

    /**
     * @notice Check if agent is banned from specific app
     * @param agentId Agent ID to check
     * @param appId App identifier
     * @return True if banned from app
     */
    function isAppBanned(uint256 agentId, bytes32 appId) external view returns (bool) {
        return appBans[agentId][appId].isBanned;
    }

    // ============ Query Functions ============

    /**
     * @notice Get list of apps agent is banned from
     * @param agentId Agent ID
     * @return Array of app IDs
     */
    function getAppBans(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentAppBans[agentId];
    }

    /**
     * @notice Get network ban details
     * @param agentId Agent ID
     * @return ban Full ban record
     */
    function getNetworkBan(uint256 agentId) external view returns (BanRecord memory ban) {
        return networkBans[agentId];
    }

    /**
     * @notice Get app ban details
     * @param agentId Agent ID
     * @param appId App identifier
     * @return ban Full ban record
     */
    function getAppBan(uint256 agentId, bytes32 appId) external view returns (BanRecord memory ban) {
        return appBans[agentId][appId];
    }

    /**
     * @notice Get ban reason for agent (network or app)
     * @param agentId Agent ID
     * @param appId App identifier (bytes32(0) for network ban)
     * @return reason Ban reason string
     */
    function getBanReason(uint256 agentId, bytes32 appId) external view returns (string memory reason) {
        // Check network ban first
        if (networkBans[agentId].isBanned) {
            return networkBans[agentId].reason;
        }

        // Check app-specific ban
        if (appId != bytes32(0) && appBans[agentId][appId].isBanned) {
            return appBans[agentId][appId].reason;
        }

        return "";
    }

    // ============ Address-Based Ban Functions (ModerationMarketplace) ============

    /**
     * @notice Place an address on notice (immediate ban pending market)
     * @param target Address to ban
     * @param reporter Address of the staked reporter
     * @param caseId ModerationMarketplace case ID
     * @param reason Ban reason
     */
    function placeOnNotice(address target, address reporter, bytes32 caseId, string calldata reason)
        external
        onlyModerator
        whenNotPaused
    {
        if (target == address(0)) revert InvalidAddress();
        if (addressBans[target].isBanned && addressBans[target].banType == BanType.PERMANENT) {
            revert AlreadyBanned();
        }

        addressBans[target] = ExtendedBanRecord({
            isBanned: true,
            banType: BanType.ON_NOTICE,
            bannedAt: block.timestamp,
            expiresAt: 0,
            reason: reason,
            proposalId: caseId,
            reporter: reporter,
            caseId: caseId
        });

        emit OnNoticeBanApplied(target, reporter, caseId, reason);
    }

    /**
     * @notice Update ban status (e.g., from ON_NOTICE to CHALLENGED or PERMANENT)
     * @param target Address to update
     * @param newType New ban type
     */
    function updateBanStatus(address target, BanType newType) external onlyModerator {
        ExtendedBanRecord storage ban = addressBans[target];
        if (!ban.isBanned) revert NotBanned();

        BanType oldType = ban.banType;
        ban.banType = newType;

        if (newType == BanType.NONE) {
            ban.isBanned = false;
        }

        emit AddressBanUpdated(target, oldType, newType);
    }

    /**
     * @notice Apply permanent address ban (after market resolution)
     * @param target Address to ban
     * @param caseId Case ID
     * @param reason Ban reason
     */
    function applyAddressBan(address target, bytes32 caseId, string calldata reason)
        external
        onlyModerator
        whenNotPaused
    {
        if (target == address(0)) revert InvalidAddress();

        ExtendedBanRecord storage ban = addressBans[target];
        ban.isBanned = true;
        ban.banType = BanType.PERMANENT;
        ban.bannedAt = block.timestamp;
        ban.reason = reason;
        ban.caseId = caseId;

        emit AddressBanApplied(target, BanType.PERMANENT, caseId, reason);
    }

    /**
     * @notice Remove address ban (after successful appeal)
     * @param target Address to unban
     */
    function removeAddressBan(address target) external onlyModerator {
        if (!addressBans[target].isBanned) revert NotBanned();

        delete addressBans[target];

        emit AddressBanRemoved(target);
    }

    /**
     * @notice Check if address is banned (any type)
     * @param target Address to check
     * @return True if banned
     */
    function isAddressBanned(address target) external view returns (bool) {
        return addressBans[target].isBanned;
    }

    /**
     * @notice Check if address is on notice
     * @param target Address to check
     * @return True if on notice
     */
    function isOnNotice(address target) external view returns (bool) {
        ExtendedBanRecord storage ban = addressBans[target];
        return ban.isBanned && ban.banType == BanType.ON_NOTICE;
    }

    /**
     * @notice Check if address has permanent ban
     * @param target Address to check
     * @return True if permanently banned
     */
    function isPermanentlyBanned(address target) external view returns (bool) {
        ExtendedBanRecord storage ban = addressBans[target];
        return ban.isBanned && ban.banType == BanType.PERMANENT;
    }

    /**
     * @notice Get extended ban record for address
     * @param target Address to query
     * @return ban Extended ban record
     */
    function getAddressBan(address target) external view returns (ExtendedBanRecord memory ban) {
        return addressBans[target];
    }

    /**
     * @notice Check if address has access (not banned at all)
     * @param target Address to check
     * @param appId App ID (for app-specific check)
     * @return True if access allowed
     */
    function isAddressAccessAllowed(address target, bytes32 appId) external view returns (bool) {
        // Check address ban first
        if (addressBans[target].isBanned) {
            return false;
        }

        // If appId provided, could also check app-specific bans
        // For now, address bans are network-wide
        if (appId != bytes32(0)) {
            // Future: check address-based app bans
        }

        return true;
    }

    // ============ Admin Functions ============

    /**
     * @notice Add or remove authorized moderator
     * @param moderator Moderator address (e.g., ModerationMarketplace)
     * @param authorized Whether to authorize or deauthorize
     */
    function setModerator(address moderator, bool authorized) external onlyOwner {
        require(moderator != address(0), "Invalid moderator");
        authorizedModerators[moderator] = authorized;
        emit ModeratorUpdated(moderator, authorized);
    }

    /**
     * @notice Update governance contract address
     * @param newGovernance New governance contract
     */
    function setGovernance(address newGovernance) external onlyOwner {
        require(newGovernance != address(0), "Invalid governance");
        address oldGovernance = governance;
        governance = newGovernance;
        emit GovernanceUpdated(oldGovernance, newGovernance);
    }

    /**
     * @notice Pause contract in emergency
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Get contract version
     */
    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
