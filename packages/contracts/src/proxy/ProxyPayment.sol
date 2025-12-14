// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IProxyRegistry} from "./interfaces/IProxyRegistry.sol";

/**
 * @title ProxyPayment
 * @author Jeju Network
 * @notice Payment and escrow system for the decentralized proxy network
 * @dev Handles session-based payments between clients and proxy nodes
 *
 * Payment Flow:
 * 1. Client opens session with deposit
 * 2. Coordinator routes requests to node
 * 3. Session is closed with actual usage
 * 4. Node claims payment, excess refunded to client
 *
 * @custom:security-contact security@jeju.network
 */
contract ProxyPayment is Ownable, Pausable, ReentrancyGuard {
    // ============ Structs ============

    struct Session {
        bytes32 sessionId;
        address client;
        address node;
        bytes32 regionCode;
        uint256 deposit;
        uint256 usedAmount;
        uint256 bytesServed;
        uint256 createdAt;
        uint256 closedAt;
        SessionStatus status;
    }

    enum SessionStatus {
        PENDING,    // Created, waiting for node assignment
        ACTIVE,     // Node assigned, serving requests
        COMPLETED,  // Successfully closed
        CANCELLED,  // Cancelled by client before use
        EXPIRED,    // Timed out
        DISPUTED    // Under dispute
    }

    // ============ State Variables ============

    /// @notice Proxy registry contract
    IProxyRegistry public registry;

    /// @notice Coordinator address authorized to manage sessions
    address public coordinator;

    /// @notice Price per gigabyte in wei (1 GB = 1e9 bytes)
    uint256 public pricePerGb = 0.001 ether;

    /// @notice Minimum deposit to open a session
    uint256 public minDeposit = 0.0001 ether;

    /// @notice Protocol fee in basis points (100 = 1%)
    uint256 public protocolFeeBps = 500; // 5%

    /// @notice Session timeout in seconds
    uint256 public sessionTimeout = 1 hours;

    /// @notice Treasury for protocol fees
    address public treasury;

    /// @notice Session data by ID
    mapping(bytes32 => Session) public sessions;

    /// @notice Client sessions
    mapping(address => bytes32[]) private _clientSessions;

    /// @notice Node sessions
    mapping(address => bytes32[]) private _nodeSessions;

    /// @notice Node pending payouts
    mapping(address => uint256) public pendingPayouts;

    /// @notice Total protocol fees collected
    uint256 public totalFeesCollected;

    /// @notice Session nonce for unique IDs
    uint256 private _sessionNonce;

    // ============ Events ============

    event SessionOpened(
        bytes32 indexed sessionId,
        address indexed client,
        bytes32 regionCode,
        uint256 deposit
    );

    event SessionAssigned(
        bytes32 indexed sessionId,
        address indexed node
    );

    event SessionClosed(
        bytes32 indexed sessionId,
        address indexed node,
        uint256 bytesServed,
        uint256 nodePayout,
        uint256 protocolFee,
        uint256 clientRefund
    );

    event SessionCancelled(
        bytes32 indexed sessionId,
        address indexed client,
        uint256 refund
    );

    event PayoutClaimed(
        address indexed node,
        uint256 amount
    );

    event PriceUpdated(uint256 oldPrice, uint256 newPrice);

    // ============ Errors ============

    error InvalidDeposit(uint256 provided, uint256 required);
    error SessionNotFound();
    error SessionNotPending();
    error SessionNotActive();
    error SessionAlreadyClosed();
    error NotSessionClient();
    error NotSessionNode();
    error NotAuthorized();
    error InvalidNode();
    error TransferFailed();
    error NoPendingPayout();
    error SessionExpired();

    // ============ Constructor ============

    constructor(
        address initialOwner,
        address _registry,
        address _treasury
    ) Ownable(initialOwner) {
        registry = IProxyRegistry(_registry);
        treasury = _treasury;
    }

    // ============ Modifiers ============

    modifier onlyCoordinator() {
        if (msg.sender != coordinator && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    // ============ Session Management ============

    /**
     * @notice Open a new proxy session with deposit
     * @param regionCode Desired region for proxy node
     * @return sessionId Unique session identifier
     */
    function openSession(
        bytes32 regionCode
    ) external payable nonReentrant whenNotPaused returns (bytes32 sessionId) {
        if (msg.value < minDeposit) revert InvalidDeposit(msg.value, minDeposit);

        sessionId = keccak256(abi.encodePacked(
            msg.sender,
            block.timestamp,
            _sessionNonce++
        ));

        sessions[sessionId] = Session({
            sessionId: sessionId,
            client: msg.sender,
            node: address(0),
            regionCode: regionCode,
            deposit: msg.value,
            usedAmount: 0,
            bytesServed: 0,
            createdAt: block.timestamp,
            closedAt: 0,
            status: SessionStatus.PENDING
        });

        _clientSessions[msg.sender].push(sessionId);

        emit SessionOpened(sessionId, msg.sender, regionCode, msg.value);
    }

    /**
     * @notice Assign a node to a pending session (coordinator only)
     * @param sessionId Session to assign
     * @param node Node address to assign
     */
    function assignNode(
        bytes32 sessionId,
        address node
    ) external onlyCoordinator {
        Session storage session = sessions[sessionId];
        if (session.createdAt == 0) revert SessionNotFound();
        if (session.status != SessionStatus.PENDING) revert SessionNotPending();
        if (!registry.isActive(node)) revert InvalidNode();

        session.node = node;
        session.status = SessionStatus.ACTIVE;

        _nodeSessions[node].push(sessionId);

        emit SessionAssigned(sessionId, node);
    }

    /**
     * @notice Close an active session with usage data (coordinator only)
     * @param sessionId Session to close
     * @param bytesServed Total bytes transferred
     */
    function closeSession(
        bytes32 sessionId,
        uint256 bytesServed
    ) external onlyCoordinator nonReentrant {
        Session storage session = sessions[sessionId];
        if (session.createdAt == 0) revert SessionNotFound();
        if (session.status != SessionStatus.ACTIVE) revert SessionNotActive();

        session.bytesServed = bytesServed;
        session.closedAt = block.timestamp;
        session.status = SessionStatus.COMPLETED;

        // Calculate cost based on bytes served
        uint256 rawCost = (bytesServed * pricePerGb) / 1e9;
        uint256 usedAmount = rawCost > session.deposit ? session.deposit : rawCost;
        session.usedAmount = usedAmount;

        // Calculate splits
        uint256 protocolFee = (usedAmount * protocolFeeBps) / 10000;
        uint256 nodePayout = usedAmount - protocolFee;
        uint256 clientRefund = session.deposit - usedAmount;

        // Accumulate node payout
        pendingPayouts[session.node] += nodePayout;

        // Accumulate protocol fees
        totalFeesCollected += protocolFee;

        // Refund excess to client immediately
        if (clientRefund > 0) {
            (bool success,) = session.client.call{value: clientRefund}("");
            if (!success) revert TransferFailed();
        }

        // Record session in registry
        registry.recordSession(session.node, bytesServed, true);

        emit SessionClosed(
            sessionId,
            session.node,
            bytesServed,
            nodePayout,
            protocolFee,
            clientRefund
        );
    }

    /**
     * @notice Cancel a pending session and get full refund
     * @param sessionId Session to cancel
     */
    function cancelSession(bytes32 sessionId) external nonReentrant {
        Session storage session = sessions[sessionId];
        if (session.createdAt == 0) revert SessionNotFound();
        if (session.client != msg.sender) revert NotSessionClient();
        if (session.status != SessionStatus.PENDING) revert SessionNotPending();

        session.status = SessionStatus.CANCELLED;
        session.closedAt = block.timestamp;

        // Full refund
        (bool success,) = msg.sender.call{value: session.deposit}("");
        if (!success) revert TransferFailed();

        emit SessionCancelled(sessionId, msg.sender, session.deposit);
    }

    /**
     * @notice Expire a timed-out session (anyone can call)
     * @param sessionId Session to expire
     */
    function expireSession(bytes32 sessionId) external nonReentrant {
        Session storage session = sessions[sessionId];
        if (session.createdAt == 0) revert SessionNotFound();
        if (session.status == SessionStatus.COMPLETED ||
            session.status == SessionStatus.CANCELLED ||
            session.status == SessionStatus.EXPIRED) {
            revert SessionAlreadyClosed();
        }
        if (block.timestamp < session.createdAt + sessionTimeout) {
            revert SessionNotFound(); // Not expired yet
        }

        session.status = SessionStatus.EXPIRED;
        session.closedAt = block.timestamp;

        // Refund client
        (bool success,) = session.client.call{value: session.deposit}("");
        if (!success) revert TransferFailed();

        // Record failed session if node was assigned
        if (session.node != address(0)) {
            registry.recordSession(session.node, 0, false);
        }

        emit SessionCancelled(sessionId, session.client, session.deposit);
    }

    // ============ Payouts ============

    /**
     * @notice Claim accumulated payouts (for nodes)
     */
    function claimPayout() external nonReentrant {
        uint256 amount = pendingPayouts[msg.sender];
        if (amount == 0) revert NoPendingPayout();

        pendingPayouts[msg.sender] = 0;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit PayoutClaimed(msg.sender, amount);
    }

    /**
     * @notice Withdraw protocol fees to treasury
     */
    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = totalFeesCollected;
        if (amount == 0) revert NoPendingPayout();

        totalFeesCollected = 0;

        (bool success,) = treasury.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // ============ View Functions ============

    /**
     * @notice Get session details
     */
    function getSession(bytes32 sessionId) external view returns (Session memory) {
        return sessions[sessionId];
    }

    /**
     * @notice Get client's sessions
     */
    function getClientSessions(address client) external view returns (bytes32[] memory) {
        return _clientSessions[client];
    }

    /**
     * @notice Get node's sessions
     */
    function getNodeSessions(address node) external view returns (bytes32[] memory) {
        return _nodeSessions[node];
    }

    /**
     * @notice Estimate cost for given bytes
     * @param estimatedBytes Expected bytes to transfer
     */
    function estimateCost(uint256 estimatedBytes) external view returns (uint256) {
        return (estimatedBytes * pricePerGb) / 1e9;
    }

    /**
     * @notice Check if session is expired
     */
    function isSessionExpired(bytes32 sessionId) external view returns (bool) {
        Session storage session = sessions[sessionId];
        if (session.createdAt == 0) return false;
        if (session.status == SessionStatus.COMPLETED ||
            session.status == SessionStatus.CANCELLED ||
            session.status == SessionStatus.EXPIRED) {
            return false; // Already closed
        }
        return block.timestamp >= session.createdAt + sessionTimeout;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the coordinator address
     */
    function setCoordinator(address _coordinator) external onlyOwner {
        coordinator = _coordinator;
    }

    /**
     * @notice Set the registry address
     */
    function setRegistry(address _registry) external onlyOwner {
        registry = IProxyRegistry(_registry);
    }

    /**
     * @notice Set the treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /**
     * @notice Update price per GB
     */
    function setPricePerGb(uint256 newPrice) external onlyOwner {
        uint256 oldPrice = pricePerGb;
        pricePerGb = newPrice;
        emit PriceUpdated(oldPrice, newPrice);
    }

    /**
     * @notice Update minimum deposit
     */
    function setMinDeposit(uint256 newMinDeposit) external onlyOwner {
        minDeposit = newMinDeposit;
    }

    /**
     * @notice Update protocol fee
     */
    function setProtocolFeeBps(uint256 newFeeBps) external onlyOwner {
        protocolFeeBps = newFeeBps;
    }

    /**
     * @notice Update session timeout
     */
    function setSessionTimeout(uint256 newTimeout) external onlyOwner {
        sessionTimeout = newTimeout;
    }

    /**
     * @notice Pause/unpause
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    /**
     * @notice Allow contract to receive ETH
     */
    receive() external payable {}
}

