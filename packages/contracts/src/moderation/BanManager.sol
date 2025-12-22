// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IHyperlaneMailbox {
    function dispatch(uint32 destinationDomain, bytes32 recipient, bytes calldata body) external payable returns (bytes32);
}

interface IHyperlaneReceiver {
    function handle(uint32 origin, bytes32 sender, bytes calldata body) external;
}

/**
 * @title BanManager
 * @notice Manages network-level and app-specific bans for agent identity system
 * @dev Supports cross-chain ban sync via Hyperlane
 */
contract BanManager is Ownable, Pausable, IHyperlaneReceiver {
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

    // Cross-chain ban sync
    IHyperlaneMailbox public hyperlaneMailbox;
    mapping(uint32 => bytes32) public remoteBanManagers; // chainId => BanManager address
    mapping(bytes32 => bool) public syncedBans; // messageHash => processed

    // Ban sync message types
    uint8 constant MSG_BAN_ADDRESS = 1;
    uint8 constant MSG_UNBAN_ADDRESS = 2;
    uint8 constant MSG_BAN_AGENT = 3;
    uint8 constant MSG_UNBAN_AGENT = 4;

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

    event CrossChainBanSynced(uint32 indexed chainId, bytes32 messageId);
    event RemoteBanManagerSet(uint32 indexed chainId, bytes32 manager);
    event BanExpired(address indexed target, uint256 timestamp);

    error OnlyGovernance();
    error OnlyModerator();
    error AlreadyBanned();
    error NotBanned();
    error InvalidAppId();
    error InvalidAgentId();
    error InvalidAddress();
    error OnlyMailbox();
    error UnauthorizedSender();


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

        _agentAppBans[agentId].push(appId);

        emit AppBanApplied(agentId, appId, reason, proposalId, block.timestamp);
    }

    function unbanFromNetwork(uint256 agentId) external onlyGovernance {
        if (!networkBans[agentId].isBanned) revert NotBanned();

        delete networkBans[agentId];

        emit NetworkBanRemoved(agentId, block.timestamp);
    }

    function unbanFromApp(uint256 agentId, bytes32 appId) external onlyGovernance {
        if (!appBans[agentId][appId].isBanned) revert NotBanned();

        delete appBans[agentId][appId];

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

    function isAccessAllowed(uint256 agentId, bytes32 appId) external view returns (bool) {
        if (networkBans[agentId].isBanned) return false;
        if (appBans[agentId][appId].isBanned) return false;
        return true;
    }

    function isNetworkBanned(uint256 agentId) external view returns (bool) {
        return networkBans[agentId].isBanned;
    }

    function isAppBanned(uint256 agentId, bytes32 appId) external view returns (bool) {
        return appBans[agentId][appId].isBanned;
    }

    function getAppBans(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentAppBans[agentId];
    }

    function getNetworkBan(uint256 agentId) external view returns (BanRecord memory) {
        return networkBans[agentId];
    }

    function getAppBan(uint256 agentId, bytes32 appId) external view returns (BanRecord memory) {
        return appBans[agentId][appId];
    }

    function getBanReason(uint256 agentId, bytes32 appId) external view returns (string memory) {
        if (networkBans[agentId].isBanned) {
            return networkBans[agentId].reason;
        }
        if (appId != bytes32(0) && appBans[agentId][appId].isBanned) {
            return appBans[agentId][appId].reason;
        }
        return "";
    }

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

    function removeAddressBan(address target) external onlyModerator {
        if (!addressBans[target].isBanned) revert NotBanned();

        delete addressBans[target];

        emit AddressBanRemoved(target);
    }

    function isAddressBanned(address target) external view returns (bool) {
        return addressBans[target].isBanned;
    }

    function isOnNotice(address target) external view returns (bool) {
        ExtendedBanRecord storage ban = addressBans[target];
        return ban.isBanned && ban.banType == BanType.ON_NOTICE;
    }

    function isPermanentlyBanned(address target) external view returns (bool) {
        ExtendedBanRecord storage ban = addressBans[target];
        return ban.isBanned && ban.banType == BanType.PERMANENT;
    }

    function getAddressBan(address target) external view returns (ExtendedBanRecord memory ban) {
        return addressBans[target];
    }

    function isAddressAccessAllowed(address target, bytes32 appId) external view returns (bool) {
        if (addressBans[target].isBanned) return false;
        if (appId != bytes32(0)) {}
        return true;
    }

    function setModerator(address moderator, bool authorized) external onlyOwner {
        require(moderator != address(0), "Invalid moderator");
        authorizedModerators[moderator] = authorized;
        emit ModeratorUpdated(moderator, authorized);
    }

    function setGovernance(address newGovernance) external onlyOwner {
        require(newGovernance != address(0), "Invalid governance");
        address oldGovernance = governance;
        governance = newGovernance;
        emit GovernanceUpdated(oldGovernance, newGovernance);
    }

    // ============ Cross-Chain Ban Sync ============

    /**
     * @notice Set Hyperlane mailbox for cross-chain messaging
     */
    function setHyperlaneMailbox(address _mailbox) external onlyOwner {
        hyperlaneMailbox = IHyperlaneMailbox(_mailbox);
    }

    /**
     * @notice Set remote BanManager address for a chain
     */
    function setRemoteBanManager(uint32 chainId, bytes32 manager) external onlyOwner {
        remoteBanManagers[chainId] = manager;
        emit RemoteBanManagerSet(chainId, manager);
    }

    /**
     * @notice Sync an address ban to remote chains
     * @param target Address to ban
     * @param chainIds Array of destination chain IDs
     */
    function syncBanToChains(address target, uint32[] calldata chainIds) external payable onlyModerator {
        ExtendedBanRecord storage ban = addressBans[target];
        require(ban.isBanned, "Not banned");

        bytes memory payload = abi.encode(MSG_BAN_ADDRESS, target, ban.banType, ban.reason, ban.expiresAt);

        uint256 feePerChain = msg.value / chainIds.length;

        for (uint256 i = 0; i < chainIds.length; i++) {
            bytes32 remote = remoteBanManagers[chainIds[i]];
            require(remote != bytes32(0), "Remote not set");

            bytes32 messageId = hyperlaneMailbox.dispatch{value: feePerChain}(
                chainIds[i],
                remote,
                payload
            );

            emit CrossChainBanSynced(chainIds[i], messageId);
        }
    }

    /**
     * @notice Handle incoming cross-chain message
     * @dev Called by Hyperlane mailbox
     */
    function handle(uint32 origin, bytes32 sender, bytes calldata body) external override {
        if (address(hyperlaneMailbox) != address(0) && msg.sender != address(hyperlaneMailbox)) {
            revert OnlyMailbox();
        }
        if (remoteBanManagers[origin] != sender) revert UnauthorizedSender();

        bytes32 messageHash = keccak256(abi.encodePacked(origin, sender, body));
        require(!syncedBans[messageHash], "Already processed");
        syncedBans[messageHash] = true;

        (uint8 msgType, address target, BanType banType, string memory reason, uint256 expiresAt) =
            abi.decode(body, (uint8, address, BanType, string, uint256));

        if (msgType == MSG_BAN_ADDRESS) {
            addressBans[target] = ExtendedBanRecord({
                isBanned: true,
                banType: banType,
                bannedAt: block.timestamp,
                expiresAt: expiresAt,
                reason: reason,
                proposalId: bytes32(0),
                reporter: address(0),
                caseId: bytes32(0)
            });
            emit AddressBanApplied(target, banType, bytes32(0), reason);
        } else if (msgType == MSG_UNBAN_ADDRESS) {
            delete addressBans[target];
            emit AddressBanRemoved(target);
        }
    }

    // ============ Ban Expiration ============

    /**
     * @notice Apply a temporary ban with expiration
     * @param target Address to ban
     * @param duration Duration in seconds
     * @param reason Ban reason
     */
    function applyTemporaryBan(address target, uint256 duration, string calldata reason)
        external
        onlyModerator
        whenNotPaused
    {
        if (target == address(0)) revert InvalidAddress();

        addressBans[target] = ExtendedBanRecord({
            isBanned: true,
            banType: BanType.ON_NOTICE,
            bannedAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            reason: reason,
            proposalId: bytes32(0),
            reporter: msg.sender,
            caseId: bytes32(0)
        });

        emit AddressBanApplied(target, BanType.ON_NOTICE, bytes32(0), reason);
    }

    /**
     * @notice Check if a ban has expired and clear it
     * @param target Address to check
     * @return True if ban was expired and cleared
     */
    function checkAndClearExpiredBan(address target) external returns (bool) {
        ExtendedBanRecord storage ban = addressBans[target];

        if (!ban.isBanned) return false;
        if (ban.expiresAt == 0) return false; // Permanent ban
        if (block.timestamp < ban.expiresAt) return false; // Not expired

        delete addressBans[target];
        emit BanExpired(target, block.timestamp);
        return true;
    }

    /**
     * @notice Check if address ban is active (considers expiration)
     * @param target Address to check
     * @return True if banned and not expired
     */
    function isAddressBannedActive(address target) external view returns (bool) {
        ExtendedBanRecord storage ban = addressBans[target];
        if (!ban.isBanned) return false;
        if (ban.expiresAt > 0 && block.timestamp >= ban.expiresAt) return false;
        return true;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "3.0.0";
    }
}
