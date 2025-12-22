// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import "../registry/IdentityRegistry.sol";

/**
 * @title IMailbox
 * @notice Hyperlane Mailbox interface for cross-chain messaging
 */
interface IMailbox {
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32);

    function process(bytes calldata metadata, bytes calldata message) external;

    function quoteDispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external view returns (uint256);
}

/**
 * @title IInterchainSecurityModule
 * @notice Hyperlane ISM interface for message verification
 */
interface IInterchainSecurityModule {
    function verify(bytes calldata metadata, bytes calldata message) external view returns (bool);
}

/**
 * @title CrossChainIdentitySync
 * @author Jeju Network
 * @notice Syncs ERC-8004 agent identities across chains via Hyperlane
 * @dev Enables agents registered on one chain to be recognized on all chains
 *
 * ## Features
 * - Broadcast agent registration to all connected chains
 * - Receive and verify agent registrations from other chains
 * - Maintain local cache of cross-chain agents
 * - Support for batch operations
 *
 * ## Message Types
 * - REGISTER: New agent registration
 * - UPDATE: Agent metadata update
 * - BAN: Agent ban propagation
 * - SLASH: Slash event propagation
 *
 * ## Security
 * - Uses Hyperlane's ISM for message verification
 * - Only accepts messages from trusted remote contracts
 * - Rate limiting on incoming registrations
 */
contract CrossChainIdentitySync is Ownable, ReentrancyGuard, Pausable {
    // ============================================================================
    // Types
    // ============================================================================

    /// @notice Message types for cross-chain communication
    enum MessageType {
        REGISTER,
        UPDATE,
        BAN,
        UNBAN,
        SLASH
    }

    /// @notice Cross-chain agent record
    struct CrossChainAgent {
        uint256 agentId;          // Agent ID on origin chain
        uint32 originDomain;      // Hyperlane domain of origin
        address owner;            // Owner address on origin chain
        string tokenUri;          // IPFS/HTTP URI to registration file
        IdentityRegistry.StakeTier tier;
        uint256 syncedAt;
        bool isBanned;
        bool isActive;
    }

    /// @notice Pending registration that needs confirmation
    struct PendingRegistration {
        bytes32 messageId;
        uint32 originDomain;
        address owner;
        string tokenUri;
        IdentityRegistry.StakeTier tier;
        uint256 requestedAt;
        bool processed;
    }

    // ============================================================================
    // Constants
    // ============================================================================

    /// @notice Message version for upgradability
    uint8 public constant MESSAGE_VERSION = 1;

    /// @notice Maximum message size (32KB)
    uint256 public constant MAX_MESSAGE_SIZE = 32768;

    /// @notice Rate limit: max registrations per hour
    uint256 public constant RATE_LIMIT_REGISTRATIONS = 100;

    /// @notice Rate limit window (1 hour)
    uint256 public constant RATE_LIMIT_WINDOW = 3600;

    // ============================================================================
    // State
    // ============================================================================

    /// @notice Local identity registry
    IdentityRegistry public immutable identityRegistry;

    /// @notice Hyperlane mailbox
    IMailbox public mailbox;

    /// @notice Interchain Security Module
    IInterchainSecurityModule public ism;

    /// @notice This contract's Hyperlane domain
    uint32 public localDomain;

    /// @notice Trusted remote contracts by domain
    mapping(uint32 => bytes32) public trustedRemotes;

    /// @notice Connected domains
    uint32[] public connectedDomains;

    /// @notice Cross-chain agents: keccak256(originDomain, originAgentId) => agent
    mapping(bytes32 => CrossChainAgent) public crossChainAgents;

    /// @notice All cross-chain agent keys
    bytes32[] public crossChainAgentKeys;

    /// @notice Pending registrations by message ID
    mapping(bytes32 => PendingRegistration) public pendingRegistrations;

    /// @notice Rate limiting: domain => (window start => count)
    mapping(uint32 => mapping(uint256 => uint256)) public registrationCounts;

    /// @notice Total synced agents
    uint256 public totalSyncedAgents;

    /// @notice Processed message hashes (replay protection)
    mapping(bytes32 => bool) public processedMessages;

    // ============================================================================
    // Events
    // ============================================================================

    event AgentSynced(
        bytes32 indexed crossChainKey,
        uint32 indexed originDomain,
        uint256 originAgentId,
        address owner
    );

    event AgentBanSynced(bytes32 indexed crossChainKey, uint32 originDomain);

    event AgentSlashSynced(bytes32 indexed crossChainKey, uint32 originDomain, uint256 slashAmount);

    event MessageDispatched(
        uint32 indexed destinationDomain,
        bytes32 indexed messageId,
        MessageType messageType
    );

    event MessageReceived(
        uint32 indexed originDomain,
        bytes32 indexed messageId,
        MessageType messageType
    );

    event TrustedRemoteSet(uint32 indexed domain, bytes32 remote);

    event DomainConnected(uint32 indexed domain);

    // ============================================================================
    // Errors
    // ============================================================================

    error UntrustedRemote();
    error MessageTooLarge();
    error AlreadyProcessed();
    error RateLimitExceeded();
    error InvalidMessageVersion();
    error InvalidMessageType();
    error InsufficientFee();
    error AgentNotFound();
    error NotAgentOwner();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        address _identityRegistry,
        address _mailbox,
        uint32 _localDomain
    ) Ownable(msg.sender) {
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        mailbox = IMailbox(_mailbox);
        localDomain = _localDomain;
    }

    // ============================================================================
    // External Functions
    // ============================================================================

    /**
     * @notice Broadcast local agent registration to all connected chains
     * @param agentId The local agent ID to broadcast
     */
    function broadcastRegistration(uint256 agentId) external payable nonReentrant whenNotPaused {
        // Verify caller owns the agent
        address agentOwner = identityRegistry.ownerOf(agentId);
        if (msg.sender != agentOwner && !identityRegistry.isApprovedForAll(agentOwner, msg.sender)) {
            revert NotAgentOwner();
        }

        IdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);
        string memory tokenUri = identityRegistry.tokenURI(agentId);

        // Build message payload
        bytes memory payload = _encodeRegistrationMessage(
            agentId,
            agentOwner,
            tokenUri,
            agent.tier
        );

        // Dispatch to all connected domains
        uint256 totalFee = 0;
        for (uint256 i = 0; i < connectedDomains.length; i++) {
            uint32 domain = connectedDomains[i];
            bytes32 recipient = trustedRemotes[domain];
            if (recipient != bytes32(0)) {
                uint256 fee = mailbox.quoteDispatch(domain, recipient, payload);
                totalFee += fee;
            }
        }

        if (msg.value < totalFee) revert InsufficientFee();

        // Dispatch messages
        for (uint256 i = 0; i < connectedDomains.length; i++) {
            uint32 domain = connectedDomains[i];
            bytes32 recipient = trustedRemotes[domain];
            if (recipient != bytes32(0)) {
                uint256 fee = mailbox.quoteDispatch(domain, recipient, payload);
                bytes32 messageId = mailbox.dispatch{value: fee}(domain, recipient, payload);
                emit MessageDispatched(domain, messageId, MessageType.REGISTER);
            }
        }

        // Refund excess
        if (msg.value > totalFee) {
            (bool success, ) = msg.sender.call{value: msg.value - totalFee}("");
            require(success, "Refund failed");
        }
    }

    /**
     * @notice Broadcast agent ban to all connected chains
     * @param agentId The local agent ID that was banned
     */
    function broadcastBan(uint256 agentId) external payable {
        // Only governance can broadcast bans
        if (msg.sender != identityRegistry.governance()) revert NotAgentOwner();

        bytes memory payload = _encodeBanMessage(agentId);

        _dispatchToAll(payload, MessageType.BAN);
    }

    /**
     * @notice Handle incoming Hyperlane message
     * @dev Called by the Mailbox after ISM verification
     */
    function handle(
        uint32 _origin,
        bytes32 _sender,
        bytes calldata _message
    ) external whenNotPaused {
        // Verify caller is mailbox
        require(msg.sender == address(mailbox), "Only mailbox");

        // Verify sender is trusted
        if (trustedRemotes[_origin] != _sender) revert UntrustedRemote();

        // Check replay
        bytes32 messageHash = keccak256(_message);
        if (processedMessages[messageHash]) revert AlreadyProcessed();
        processedMessages[messageHash] = true;

        // Check rate limit
        uint256 window = block.timestamp / RATE_LIMIT_WINDOW;
        if (registrationCounts[_origin][window] >= RATE_LIMIT_REGISTRATIONS) {
            revert RateLimitExceeded();
        }
        registrationCounts[_origin][window]++;

        // Decode and process message
        _processMessage(_origin, _message);
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    /**
     * @notice Set trusted remote for a domain
     */
    function setTrustedRemote(uint32 domain, bytes32 remote) external onlyOwner {
        bool isNew = trustedRemotes[domain] == bytes32(0);
        trustedRemotes[domain] = remote;
        
        if (isNew && remote != bytes32(0)) {
            connectedDomains.push(domain);
            emit DomainConnected(domain);
        }
        
        emit TrustedRemoteSet(domain, remote);
    }

    /**
     * @notice Update mailbox address
     */
    function setMailbox(address _mailbox) external onlyOwner {
        mailbox = IMailbox(_mailbox);
    }

    /**
     * @notice Update ISM address
     */
    function setISM(address _ism) external onlyOwner {
        ism = IInterchainSecurityModule(_ism);
    }

    /// @notice Pause cross-chain sync operations
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause cross-chain sync operations
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /**
     * @notice Get cross-chain agent by origin
     */
    function getCrossChainAgent(uint32 originDomain, uint256 originAgentId) 
        external 
        view 
        returns (CrossChainAgent memory) 
    {
        bytes32 key = _computeAgentKey(originDomain, originAgentId);
        return crossChainAgents[key];
    }

    /**
     * @notice Check if an agent from another chain is recognized locally
     */
    function isRecognized(uint32 originDomain, uint256 originAgentId) external view returns (bool) {
        bytes32 key = _computeAgentKey(originDomain, originAgentId);
        return crossChainAgents[key].isActive;
    }

    /**
     * @notice Get all connected domains
     */
    function getConnectedDomains() external view returns (uint32[] memory) {
        return connectedDomains;
    }

    /**
     * @notice Quote fee for broadcasting to all domains
     */
    function quoteBroadcastFee(bytes calldata payload) external view returns (uint256 totalFee) {
        for (uint256 i = 0; i < connectedDomains.length; i++) {
            uint32 domain = connectedDomains[i];
            bytes32 recipient = trustedRemotes[domain];
            if (recipient != bytes32(0)) {
                totalFee += mailbox.quoteDispatch(domain, recipient, payload);
            }
        }
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    /**
     * @notice Process an incoming cross-chain message
     */
    function _processMessage(uint32 origin, bytes calldata message) internal {
        // Check version
        uint8 msgVersion = uint8(message[0]);
        if (msgVersion != MESSAGE_VERSION) revert InvalidMessageVersion();

        // Get message type
        MessageType msgType = MessageType(uint8(message[1]));

        if (msgType == MessageType.REGISTER) {
            _handleRegistration(origin, message[2:]);
        } else if (msgType == MessageType.UPDATE) {
            _handleUpdate(origin, message[2:]);
        } else if (msgType == MessageType.BAN) {
            _handleBan(origin, message[2:]);
        } else if (msgType == MessageType.UNBAN) {
            _handleUnban(origin, message[2:]);
        } else if (msgType == MessageType.SLASH) {
            _handleSlash(origin, message[2:]);
        } else {
            revert InvalidMessageType();
        }

        emit MessageReceived(origin, keccak256(message), msgType);
    }

    function _handleRegistration(uint32 origin, bytes calldata data) internal {
        // Decode: agentId (32) + owner (20) + tier (1) + uriLen (2) + uri (var)
        uint256 agentId = uint256(bytes32(data[0:32]));
        address owner = address(uint160(bytes20(data[32:52])));
        IdentityRegistry.StakeTier tier = IdentityRegistry.StakeTier(uint8(data[52]));
        uint16 uriLen = uint16(bytes2(data[53:55]));
        string memory tokenUri = string(data[55:55+uriLen]);

        bytes32 key = _computeAgentKey(origin, agentId);

        crossChainAgents[key] = CrossChainAgent({
            agentId: agentId,
            originDomain: origin,
            owner: owner,
            tokenUri: tokenUri,
            tier: tier,
            syncedAt: block.timestamp,
            isBanned: false,
            isActive: true
        });

        crossChainAgentKeys.push(key);
        totalSyncedAgents++;

        emit AgentSynced(key, origin, agentId, owner);
    }

    function _handleUpdate(uint32 origin, bytes calldata data) internal {
        uint256 agentId = uint256(bytes32(data[0:32]));
        bytes32 key = _computeAgentKey(origin, agentId);
        
        CrossChainAgent storage agent = crossChainAgents[key];
        if (!agent.isActive) revert AgentNotFound();

        // Update tier
        agent.tier = IdentityRegistry.StakeTier(uint8(data[32]));
        
        // Update URI if provided
        uint16 uriLen = uint16(bytes2(data[33:35]));
        if (uriLen > 0) {
            agent.tokenUri = string(data[35:35+uriLen]);
        }
        
        agent.syncedAt = block.timestamp;
    }

    function _handleBan(uint32 origin, bytes calldata data) internal {
        uint256 agentId = uint256(bytes32(data[0:32]));
        bytes32 key = _computeAgentKey(origin, agentId);
        
        CrossChainAgent storage agent = crossChainAgents[key];
        if (!agent.isActive) revert AgentNotFound();
        
        agent.isBanned = true;
        agent.syncedAt = block.timestamp;

        emit AgentBanSynced(key, origin);
    }

    function _handleUnban(uint32 origin, bytes calldata data) internal {
        uint256 agentId = uint256(bytes32(data[0:32]));
        bytes32 key = _computeAgentKey(origin, agentId);
        
        CrossChainAgent storage agent = crossChainAgents[key];
        if (!agent.isActive) revert AgentNotFound();
        
        agent.isBanned = false;
        agent.syncedAt = block.timestamp;
    }

    function _handleSlash(uint32 origin, bytes calldata data) internal {
        uint256 agentId = uint256(bytes32(data[0:32]));
        uint256 slashAmount = uint256(bytes32(data[32:64]));
        bytes32 key = _computeAgentKey(origin, agentId);
        
        CrossChainAgent storage agent = crossChainAgents[key];
        if (!agent.isActive) revert AgentNotFound();
        
        // Downgrade tier based on slash
        if (slashAmount > 0) {
            // Assume significant slash means tier downgrade
            if (agent.tier == IdentityRegistry.StakeTier.HIGH) {
                agent.tier = IdentityRegistry.StakeTier.MEDIUM;
            } else if (agent.tier == IdentityRegistry.StakeTier.MEDIUM) {
                agent.tier = IdentityRegistry.StakeTier.SMALL;
            } else {
                agent.tier = IdentityRegistry.StakeTier.NONE;
            }
        }
        
        agent.syncedAt = block.timestamp;

        emit AgentSlashSynced(key, origin, slashAmount);
    }

    function _encodeRegistrationMessage(
        uint256 agentId,
        address owner,
        string memory tokenUri,
        IdentityRegistry.StakeTier tier
    ) internal pure returns (bytes memory) {
        bytes memory uri = bytes(tokenUri);
        require(uri.length <= 65535, "URI too long");
        
        return abi.encodePacked(
            MESSAGE_VERSION,
            uint8(MessageType.REGISTER),
            bytes32(agentId),
            bytes20(owner),
            uint8(tier),
            uint16(uri.length),
            uri
        );
    }

    function _encodeBanMessage(uint256 agentId) internal pure returns (bytes memory) {
        return abi.encodePacked(
            MESSAGE_VERSION,
            uint8(MessageType.BAN),
            bytes32(agentId)
        );
    }

    function _dispatchToAll(bytes memory payload, MessageType msgType) internal {
        uint256 totalFee = 0;
        for (uint256 i = 0; i < connectedDomains.length; i++) {
            uint32 domain = connectedDomains[i];
            bytes32 recipient = trustedRemotes[domain];
            if (recipient != bytes32(0)) {
                uint256 fee = mailbox.quoteDispatch(domain, recipient, payload);
                totalFee += fee;
            }
        }

        if (msg.value < totalFee) revert InsufficientFee();

        for (uint256 i = 0; i < connectedDomains.length; i++) {
            uint32 domain = connectedDomains[i];
            bytes32 recipient = trustedRemotes[domain];
            if (recipient != bytes32(0)) {
                uint256 fee = mailbox.quoteDispatch(domain, recipient, payload);
                bytes32 messageId = mailbox.dispatch{value: fee}(domain, recipient, payload);
                emit MessageDispatched(domain, messageId, msgType);
            }
        }

        if (msg.value > totalFee) {
            (bool success, ) = msg.sender.call{value: msg.value - totalFee}("");
            require(success, "Refund failed");
        }
    }

    function _computeAgentKey(uint32 domain, uint256 agentId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(domain, agentId));
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
