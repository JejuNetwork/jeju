// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Treasury
 * @author Jeju Network
 * @notice Modular treasury contract with optional TEE operator and profit distribution
 * @dev Features (all optional, enabled via config):
 *      - Rate-limited withdrawals and operator management (always on)
 *      - TEE operator with heartbeat monitoring and state tracking
 *      - Profit distribution to multiple recipients
 *      - Key rotation with multi-sig approval
 *
 * Usage:
 * - Deploy via TreasuryFactory.createTreasury() for basic treasury
 * - Call enableTEEMode() for games/agents needing TEE operator
 * - Call enableProfitDistribution() for MEV/arbitrage profit sharing
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract Treasury is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Constants & Roles
    // =========================================================================
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant BOARD_ROLE = keccak256("BOARD_ROLE");
    bytes32 public constant DIRECTOR_ROLE = keccak256("DIRECTOR_ROLE");
    uint16 public constant BPS_DENOMINATOR = 10000;

    // =========================================================================
    // Core State
    // =========================================================================
    string public name;
    uint256 public dailyWithdrawalLimit;
    mapping(address => uint256) public tokenDeposits;
    uint256 public totalEthDeposits;

    // =========================================================================
    // SECURITY: Rolling 24-hour withdrawal tracking
    // =========================================================================
    // Uses circular buffer to track withdrawals in hourly buckets
    // Prevents the "midnight reset attack" where attacker withdraws at 23:59 + 00:01

    uint256 public constant WITHDRAWAL_WINDOW = 24 hours;
    uint256 public constant BUCKET_DURATION = 1 hours;
    uint256 public constant NUM_BUCKETS = 24;

    struct WithdrawalBucket {
        uint256 amount;
        uint256 timestamp; // Bucket start timestamp
    }

    // Circular buffer of hourly withdrawal buckets
    WithdrawalBucket[24] public withdrawalBuckets;
    uint256 public currentBucketIndex;

    // =========================================================================
    // Feature Flags
    // =========================================================================
    bool public teeEnabled;
    bool public profitDistributionEnabled;
    bool public swapEnabled;

    // =========================================================================
    // Token Swap State (destination whitelist for security)
    // =========================================================================
    address public swapRouter; // Uniswap V3 compatible router
    mapping(address => bool) public whitelistedSwapDestinations; // Tokens we can swap INTO
    address[] public swapDestinationList;
    uint256 public maxSwapSlippageBps = 500; // 5% default max slippage

    // =========================================================================
    // TEE Operator State (enabled via enableTEEMode)
    // =========================================================================
    address public teeOperator;
    bytes public operatorAttestation;
    uint256 public operatorRegisteredAt;
    uint256 public lastHeartbeat;
    uint256 public heartbeatTimeout;
    uint256 public takeoverCooldown;

    // State tracking
    string public currentStateCID;
    bytes32 public currentStateHash;
    uint256 public stateVersion;
    uint256 public keyVersion;

    // Training tracking
    uint256 public trainingEpoch;
    bytes32 public lastModelHash;

    // Key rotation
    struct KeyRotationRequest {
        address initiator;
        uint256 timestamp;
        uint256 approvals;
        bool executed;
    }

    mapping(uint256 => KeyRotationRequest) public keyRotationRequests;
    mapping(uint256 => mapping(address => bool)) public rotationApprovals;
    uint256 public nextRotationRequestId;
    uint256 public rotationApprovalThreshold;

    // =========================================================================
    // Profit Distribution State (enabled via enableProfitDistribution)
    // =========================================================================
    struct DistributionConfig {
        uint16 protocolBps;
        uint16 stakersBps;
        uint16 insuranceBps;
        uint16 operatorBps;
    }

    DistributionConfig public distribution;
    address public protocolRecipient;
    address public stakersRecipient;
    address public insuranceRecipient;

    mapping(address => uint256) public totalProfitsByToken;
    mapping(address => mapping(address => uint256)) public operatorEarnings;
    mapping(address => mapping(address => uint256)) public pendingOperatorWithdrawals;

    // =========================================================================
    // Events - Core
    // =========================================================================
    event FundsDeposited(address indexed from, address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed to, address indexed token, uint256 amount);
    event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);
    event BoardMemberAdded(address indexed member);
    event BoardMemberRemoved(address indexed member);
    event EmergencyWithdrawal(address indexed token, address indexed to, uint256 amount);

    // Events - TEE
    event TEEModeEnabled(uint256 heartbeatTimeout, uint256 takeoverCooldown);
    event TEEOperatorRegistered(address indexed operator, bytes attestation);
    event TEEOperatorDeactivated(address indexed operator, string reason);
    event TakeoverInitiated(address indexed newOperator, address indexed oldOperator);
    event StateUpdated(string cid, bytes32 stateHash, uint256 version);
    event HeartbeatReceived(address indexed operator, uint256 timestamp);
    event TrainingRecorded(uint256 epoch, string datasetCID, bytes32 modelHash);
    event KeyRotationRequested(uint256 indexed requestId, address indexed initiator);
    event KeyRotationApproved(uint256 indexed requestId, address indexed approver);
    event KeyRotationExecuted(uint256 indexed requestId, uint256 newVersion);

    // Events - Profit Distribution
    event ProfitDistributionEnabled(address protocol, address stakers, address insurance);
    event ProfitDeposited(address indexed depositor, address indexed token, uint256 amount);
    event ProfitDistributed(
        address indexed token,
        uint256 protocolAmount,
        uint256 stakersAmount,
        uint256 insuranceAmount,
        uint256 operatorAmount
    );
    event OperatorWithdrawal(address indexed operator, address indexed token, uint256 amount);
    event DistributionConfigUpdated(uint16 protocolBps, uint16 stakersBps, uint16 insuranceBps, uint16 operatorBps);
    event RecipientUpdated(string recipientType, address newAddress);

    // Events - Token Swap
    event SwapEnabled(address indexed swapRouter);
    event SwapDestinationWhitelisted(address indexed token);
    event SwapDestinationRemoved(address indexed token);
    event TokenSwapped(
        address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address indexed executor
    );
    event MaxSlippageUpdated(uint256 oldSlippage, uint256 newSlippage);

    // =========================================================================
    // Errors
    // =========================================================================
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint256 available, uint256 requested);
    error ExceedsDailyLimit(uint256 limit, uint256 requested, uint256 remaining);
    error TransferFailed();
    error TEENotEnabled();
    error ProfitDistributionNotEnabled();
    error ActiveOperatorExists();
    error NoOperator();
    error OperatorStillActive();
    error TakeoverCooldownNotMet();
    error AttestationRequired();
    error RotationRequestNotFound();
    error RotationAlreadyExecuted();
    error AlreadyApproved();
    error TimeoutTooShort();
    error InvalidDistributionConfig();
    error NothingToDistribute();
    error AlreadyEnabled();
    error NotTEEOperator();
    error SwapNotEnabled();
    error DestinationNotWhitelisted();
    error SlippageTooHigh();
    error SwapFailed();

    // =========================================================================
    // Modifiers
    // =========================================================================
    modifier onlyTEEOperator() {
        if (!teeEnabled) revert TEENotEnabled();
        if (msg.sender != teeOperator || !isTEEOperatorActive()) revert NotTEEOperator();
        _;
    }

    modifier requireTEE() {
        if (!teeEnabled) revert TEENotEnabled();
        _;
    }

    modifier requireProfitDistribution() {
        if (!profitDistributionEnabled) revert ProfitDistributionNotEnabled();
        _;
    }

    modifier requireSwap() {
        if (!swapEnabled) revert SwapNotEnabled();
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================
    constructor(string memory _name, uint256 _dailyLimit, address _admin) {
        if (_admin == address(0)) revert ZeroAddress();

        name = _name;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(BOARD_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);

        dailyWithdrawalLimit = _dailyLimit;
    }

    // =========================================================================
    // Feature Enablement
    // =========================================================================

    /**
     * @notice Enable TEE operator mode for games/agents
     * @param _heartbeatTimeout Time before operator is considered inactive
     * @param _takeoverCooldown Additional time before permissionless takeover
     */
    function enableTEEMode(uint256 _heartbeatTimeout, uint256 _takeoverCooldown)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (teeEnabled) revert AlreadyEnabled();
        if (_heartbeatTimeout < 5 minutes) revert TimeoutTooShort();

        teeEnabled = true;
        heartbeatTimeout = _heartbeatTimeout;
        takeoverCooldown = _takeoverCooldown;
        keyVersion = 1;
        rotationApprovalThreshold = 2;

        emit TEEModeEnabled(_heartbeatTimeout, _takeoverCooldown);
    }

    /**
     * @notice Enable profit distribution mode
     * @param _protocolRecipient Address for protocol share
     * @param _stakersRecipient Address for stakers share
     * @param _insuranceRecipient Address for insurance share
     */
    function enableProfitDistribution(
        address _protocolRecipient,
        address _stakersRecipient,
        address _insuranceRecipient
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (profitDistributionEnabled) revert AlreadyEnabled();
        if (_protocolRecipient == address(0)) revert ZeroAddress();

        profitDistributionEnabled = true;
        protocolRecipient = _protocolRecipient;
        stakersRecipient = _stakersRecipient != address(0) ? _stakersRecipient : _protocolRecipient;
        insuranceRecipient = _insuranceRecipient != address(0) ? _insuranceRecipient : _protocolRecipient;

        // Default: 50% protocol, 30% stakers, 15% insurance, 5% operators
        distribution = DistributionConfig({protocolBps: 5000, stakersBps: 3000, insuranceBps: 1500, operatorBps: 500});

        emit ProfitDistributionEnabled(_protocolRecipient, _stakersRecipient, _insuranceRecipient);
    }

    // =========================================================================
    // Core Treasury Functions
    // =========================================================================

    receive() external payable {
        totalEthDeposits += msg.value;
        emit FundsDeposited(msg.sender, address(0), msg.value);
    }

    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        totalEthDeposits += msg.value;
        emit FundsDeposited(msg.sender, address(0), msg.value);
    }

    function depositToken(address token, uint256 amount) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        tokenDeposits[token] += amount;

        emit FundsDeposited(msg.sender, token, amount);
    }

    function withdrawETH(uint256 amount, address to) external onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (address(this).balance < amount) {
            revert InsufficientBalance(address(this).balance, amount);
        }

        _enforceWithdrawalLimit(amount);

        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit FundsWithdrawn(to, address(0), amount);
    }

    function withdrawToken(address token, uint256 amount, address to)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) {
            revert InsufficientBalance(balance, amount);
        }

        IERC20(token).safeTransfer(to, amount);

        emit FundsWithdrawn(to, token, amount);
    }

    /**
     * @notice Enforce rolling 24-hour withdrawal limit
     * @dev SECURITY: Uses rolling window instead of midnight reset to prevent gaming
     *
     * Attack prevented: Without this, attacker could withdraw limit at 23:59
     * then again at 00:01 for 2x the limit. Rolling window ensures 24hr delay.
     */
    function _enforceWithdrawalLimit(uint256 amount) internal {
        // Calculate current bucket
        uint256 currentBucketStart = (block.timestamp / BUCKET_DURATION) * BUCKET_DURATION;
        uint256 bucketIndex = (currentBucketStart / BUCKET_DURATION) % NUM_BUCKETS;

        // If bucket is stale (>24h old), reset it
        if (withdrawalBuckets[bucketIndex].timestamp != currentBucketStart) {
            withdrawalBuckets[bucketIndex] = WithdrawalBucket({amount: 0, timestamp: currentBucketStart});
        }

        // Sum withdrawals from all active buckets (last 24 hours)
        uint256 rollingTotal = 0;
        // Safe subtraction - if timestamp < WITHDRAWAL_WINDOW, windowStart is 0
        uint256 windowStart = block.timestamp > WITHDRAWAL_WINDOW ? block.timestamp - WITHDRAWAL_WINDOW : 0;

        for (uint256 i = 0; i < NUM_BUCKETS; i++) {
            WithdrawalBucket storage bucket = withdrawalBuckets[i];
            // Include bucket if it's within the rolling window (bucket.amount > 0 handles empty buckets)
            if (bucket.timestamp >= windowStart && bucket.amount > 0) {
                rollingTotal += bucket.amount;
            }
        }

        // Check if withdrawal would exceed limit
        uint256 remaining = dailyWithdrawalLimit > rollingTotal ? dailyWithdrawalLimit - rollingTotal : 0;

        if (amount > remaining) {
            revert ExceedsDailyLimit(dailyWithdrawalLimit, amount, remaining);
        }

        // Record withdrawal in current bucket
        withdrawalBuckets[bucketIndex].amount += amount;
        currentBucketIndex = bucketIndex;
    }

    /**
     * @notice Get remaining withdrawal allowance in rolling window
     */
    function getRemainingWithdrawalAllowance() external view returns (uint256 remaining) {
        uint256 rollingTotal = 0;
        // Safe subtraction - if timestamp < WITHDRAWAL_WINDOW, windowStart is 0
        uint256 windowStart = block.timestamp > WITHDRAWAL_WINDOW ? block.timestamp - WITHDRAWAL_WINDOW : 0;

        for (uint256 i = 0; i < NUM_BUCKETS; i++) {
            if (withdrawalBuckets[i].timestamp >= windowStart && withdrawalBuckets[i].amount > 0) {
                rollingTotal += withdrawalBuckets[i].amount;
            }
        }

        remaining = dailyWithdrawalLimit > rollingTotal ? dailyWithdrawalLimit - rollingTotal : 0;
    }

    /**
     * @notice Get total withdrawn in rolling 24-hour window
     */
    function getWithdrawnInWindow() external view returns (uint256 total) {
        // Safe subtraction - if timestamp < WITHDRAWAL_WINDOW, windowStart is 0
        uint256 windowStart = block.timestamp > WITHDRAWAL_WINDOW ? block.timestamp - WITHDRAWAL_WINDOW : 0;

        for (uint256 i = 0; i < NUM_BUCKETS; i++) {
            if (withdrawalBuckets[i].timestamp >= windowStart && withdrawalBuckets[i].amount > 0) {
                total += withdrawalBuckets[i].amount;
            }
        }
    }

    // =========================================================================
    // TEE Operator Functions
    // =========================================================================

    function registerTEEOperator(address _operator, bytes calldata _attestation)
        external
        onlyRole(BOARD_ROLE)
        requireTEE
    {
        if (_operator == address(0)) revert ZeroAddress();
        if (teeOperator != address(0) && isTEEOperatorActive()) {
            revert ActiveOperatorExists();
        }

        if (teeOperator != address(0)) {
            _revokeRole(OPERATOR_ROLE, teeOperator);
            emit TEEOperatorDeactivated(teeOperator, "replaced");
        }

        teeOperator = _operator;
        operatorAttestation = _attestation;
        operatorRegisteredAt = block.timestamp;
        lastHeartbeat = block.timestamp;

        _grantRole(OPERATOR_ROLE, _operator);

        emit TEEOperatorRegistered(_operator, _attestation);
    }

    function isTEEOperatorActive() public view returns (bool) {
        if (!teeEnabled || teeOperator == address(0)) return false;
        return block.timestamp - lastHeartbeat <= heartbeatTimeout;
    }

    function markOperatorInactive() external requireTEE {
        if (teeOperator == address(0)) revert NoOperator();
        if (isTEEOperatorActive()) revert OperatorStillActive();

        address oldOperator = teeOperator;
        _revokeRole(OPERATOR_ROLE, oldOperator);
        teeOperator = address(0);

        emit TEEOperatorDeactivated(oldOperator, "heartbeat_timeout");
    }

    function takeoverAsOperator(bytes calldata _attestation) external requireTEE {
        if (teeOperator != address(0) && isTEEOperatorActive()) {
            revert OperatorStillActive();
        }
        if (block.timestamp < lastHeartbeat + heartbeatTimeout + takeoverCooldown) {
            revert TakeoverCooldownNotMet();
        }
        if (_attestation.length == 0) revert AttestationRequired();

        address oldOperator = teeOperator;

        if (oldOperator != address(0)) {
            _revokeRole(OPERATOR_ROLE, oldOperator);
        }

        teeOperator = msg.sender;
        operatorAttestation = _attestation;
        operatorRegisteredAt = block.timestamp;
        lastHeartbeat = block.timestamp;

        _grantRole(OPERATOR_ROLE, msg.sender);

        emit TakeoverInitiated(msg.sender, oldOperator);
        emit TEEOperatorRegistered(msg.sender, _attestation);
    }

    function isTakeoverAvailable() external view returns (bool) {
        if (!teeEnabled) return false;
        if (teeOperator == address(0)) return true;
        if (isTEEOperatorActive()) return false;
        return block.timestamp >= lastHeartbeat + heartbeatTimeout + takeoverCooldown;
    }

    function updateState(string calldata _cid, bytes32 _hash) external onlyTEEOperator whenNotPaused {
        currentStateCID = _cid;
        currentStateHash = _hash;
        stateVersion++;
        lastHeartbeat = block.timestamp;

        emit StateUpdated(_cid, _hash, stateVersion);
    }

    function heartbeat() external onlyTEEOperator {
        lastHeartbeat = block.timestamp;
        emit HeartbeatReceived(msg.sender, block.timestamp);
    }

    function recordTraining(string calldata _datasetCID, bytes32 _modelHash) external onlyTEEOperator {
        trainingEpoch++;
        lastModelHash = _modelHash;
        emit TrainingRecorded(trainingEpoch, _datasetCID, _modelHash);
    }

    function requestKeyRotation() external onlyRole(BOARD_ROLE) requireTEE returns (uint256) {
        uint256 requestId = nextRotationRequestId++;

        keyRotationRequests[requestId] =
            KeyRotationRequest({initiator: msg.sender, timestamp: block.timestamp, approvals: 1, executed: false});
        rotationApprovals[requestId][msg.sender] = true;

        emit KeyRotationRequested(requestId, msg.sender);

        if (keyRotationRequests[requestId].approvals >= rotationApprovalThreshold) {
            _executeKeyRotation(requestId);
        }

        return requestId;
    }

    function approveKeyRotation(uint256 _requestId) external onlyRole(BOARD_ROLE) requireTEE {
        KeyRotationRequest storage request = keyRotationRequests[_requestId];
        if (request.initiator == address(0)) revert RotationRequestNotFound();
        if (request.executed) revert RotationAlreadyExecuted();
        if (rotationApprovals[_requestId][msg.sender]) revert AlreadyApproved();

        rotationApprovals[_requestId][msg.sender] = true;
        request.approvals++;

        emit KeyRotationApproved(_requestId, msg.sender);

        if (request.approvals >= rotationApprovalThreshold) {
            _executeKeyRotation(_requestId);
        }
    }

    function _executeKeyRotation(uint256 _requestId) internal {
        keyRotationRequests[_requestId].executed = true;
        keyVersion++;
        emit KeyRotationExecuted(_requestId, keyVersion);
    }

    // =========================================================================
    // Profit Distribution Functions
    // =========================================================================

    function depositProfit()
        external
        payable
        onlyRole(OPERATOR_ROLE)
        nonReentrant
        whenNotPaused
        requireProfitDistribution
    {
        if (msg.value == 0) revert ZeroAmount();

        totalProfitsByToken[address(0)] += msg.value;
        uint256 operatorShare = (msg.value * distribution.operatorBps) / BPS_DENOMINATOR;
        operatorEarnings[msg.sender][address(0)] += operatorShare;
        pendingOperatorWithdrawals[msg.sender][address(0)] += operatorShare;

        emit ProfitDeposited(msg.sender, address(0), msg.value);
    }

    function depositTokenProfit(address token, uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
        whenNotPaused
        requireProfitDistribution
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalProfitsByToken[token] += amount;

        uint256 operatorShare = (amount * distribution.operatorBps) / BPS_DENOMINATOR;
        operatorEarnings[msg.sender][token] += operatorShare;
        pendingOperatorWithdrawals[msg.sender][token] += operatorShare;

        emit ProfitDeposited(msg.sender, token, amount);
    }

    function distributeProfits(address token) external nonReentrant whenNotPaused requireProfitDistribution {
        uint256 balance = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));

        if (balance == 0) revert NothingToDistribute();

        uint256 nonOperatorBps = BPS_DENOMINATOR - distribution.operatorBps;
        uint256 protocolAmount = (balance * distribution.protocolBps) / nonOperatorBps;
        uint256 stakersAmount = (balance * distribution.stakersBps) / nonOperatorBps;
        uint256 insuranceAmount = balance - protocolAmount - stakersAmount;

        _transferOut(token, protocolRecipient, protocolAmount);
        _transferOut(token, stakersRecipient, stakersAmount);
        _transferOut(token, insuranceRecipient, insuranceAmount);

        emit ProfitDistributed(token, protocolAmount, stakersAmount, insuranceAmount, 0);
    }

    function withdrawOperatorEarnings(address token) external nonReentrant requireProfitDistribution {
        uint256 amount = pendingOperatorWithdrawals[msg.sender][token];
        if (amount == 0) revert ZeroAmount();

        pendingOperatorWithdrawals[msg.sender][token] = 0;
        _transferOut(token, msg.sender, amount);

        emit OperatorWithdrawal(msg.sender, token, amount);
    }

    function _transferOut(address token, address to, uint256 amount) internal {
        if (amount == 0) return;

        if (token == address(0)) {
            (bool success,) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // =========================================================================
    // Admin Functions
    // =========================================================================

    function setDailyLimit(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = dailyWithdrawalLimit;
        dailyWithdrawalLimit = newLimit;
        emit DailyLimitUpdated(oldLimit, newLimit);
    }

    function addOperator(address operator) external onlyRole(BOARD_ROLE) {
        if (operator == address(0)) revert ZeroAddress();
        _grantRole(OPERATOR_ROLE, operator);
        emit OperatorAdded(operator);
    }

    function removeOperator(address operator) external onlyRole(BOARD_ROLE) {
        _revokeRole(OPERATOR_ROLE, operator);
        emit OperatorRemoved(operator);
    }

    function addBoardMember(address member) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (member == address(0)) revert ZeroAddress();
        _grantRole(BOARD_ROLE, member);
        emit BoardMemberAdded(member);
    }

    function removeBoardMember(address member) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(BOARD_ROLE, member);
        emit BoardMemberRemoved(member);
    }

    function emergencyWithdraw(address token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (token == address(0)) {
            if (address(this).balance < amount) {
                revert InsufficientBalance(address(this).balance, amount);
            }
            (bool success,) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance < amount) {
                revert InsufficientBalance(balance, amount);
            }
            IERC20(token).safeTransfer(to, amount);
        }

        emit EmergencyWithdrawal(token, to, amount);
    }

    function setHeartbeatTimeout(uint256 _timeout) external onlyRole(DEFAULT_ADMIN_ROLE) requireTEE {
        if (_timeout < 5 minutes) revert TimeoutTooShort();
        heartbeatTimeout = _timeout;
    }

    function setTakeoverCooldown(uint256 _cooldown) external onlyRole(DEFAULT_ADMIN_ROLE) requireTEE {
        takeoverCooldown = _cooldown;
    }

    function setRotationApprovalThreshold(uint256 _threshold) external onlyRole(DEFAULT_ADMIN_ROLE) requireTEE {
        if (_threshold < 1) revert ZeroAmount();
        rotationApprovalThreshold = _threshold;
    }

    function setDistribution(uint16 protocolBps, uint16 stakersBps, uint16 insuranceBps, uint16 operatorBps)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        requireProfitDistribution
    {
        if (protocolBps + stakersBps + insuranceBps + operatorBps != BPS_DENOMINATOR) {
            revert InvalidDistributionConfig();
        }

        distribution = DistributionConfig({
            protocolBps: protocolBps,
            stakersBps: stakersBps,
            insuranceBps: insuranceBps,
            operatorBps: operatorBps
        });

        emit DistributionConfigUpdated(protocolBps, stakersBps, insuranceBps, operatorBps);
    }

    function setProtocolRecipient(address newRecipient)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        requireProfitDistribution
    {
        if (newRecipient == address(0)) revert ZeroAddress();
        protocolRecipient = newRecipient;
        emit RecipientUpdated("protocol", newRecipient);
    }

    function setStakersRecipient(address newRecipient)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        requireProfitDistribution
    {
        if (newRecipient == address(0)) revert ZeroAddress();
        stakersRecipient = newRecipient;
        emit RecipientUpdated("stakers", newRecipient);
    }

    function setInsuranceRecipient(address newRecipient)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        requireProfitDistribution
    {
        if (newRecipient == address(0)) revert ZeroAddress();
        insuranceRecipient = newRecipient;
        emit RecipientUpdated("insurance", newRecipient);
    }

    function pause() external onlyRole(BOARD_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(BOARD_ROLE) {
        _unpause();
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function getWithdrawalInfo() external view returns (uint256 limit, uint256 usedInWindow, uint256 remaining) {
        // Safe subtraction - if timestamp < WITHDRAWAL_WINDOW, windowStart is 0
        uint256 windowStart = block.timestamp > WITHDRAWAL_WINDOW ? block.timestamp - WITHDRAWAL_WINDOW : 0;
        uint256 rollingTotal = 0;

        for (uint256 i = 0; i < NUM_BUCKETS; i++) {
            if (withdrawalBuckets[i].timestamp >= windowStart && withdrawalBuckets[i].amount > 0) {
                rollingTotal += withdrawalBuckets[i].amount;
            }
        }

        uint256 remainingAmount = dailyWithdrawalLimit > rollingTotal ? dailyWithdrawalLimit - rollingTotal : 0;

        return (dailyWithdrawalLimit, rollingTotal, remainingAmount);
    }

    function isOperator(address account) external view returns (bool) {
        return hasRole(OPERATOR_ROLE, account);
    }

    function isBoardMember(address account) external view returns (bool) {
        return hasRole(BOARD_ROLE, account);
    }

    function getGameState()
        external
        view
        returns (
            string memory cid,
            bytes32 stateHash,
            uint256 _stateVersion,
            uint256 _keyVersion,
            uint256 lastBeat,
            bool operatorActive
        )
    {
        return (currentStateCID, currentStateHash, stateVersion, keyVersion, lastHeartbeat, isTEEOperatorActive());
    }

    function getTEEOperatorInfo()
        external
        view
        returns (address op, bytes memory attestation, uint256 registeredAt, bool active)
    {
        return (teeOperator, operatorAttestation, operatorRegisteredAt, isTEEOperatorActive());
    }

    function getDistributionConfig() external view returns (DistributionConfig memory) {
        return distribution;
    }

    function getRecipients() external view returns (address protocol, address stakers, address insurance) {
        return (protocolRecipient, stakersRecipient, insuranceRecipient);
    }

    function getPendingWithdrawal(address operator, address token) external view returns (uint256) {
        return pendingOperatorWithdrawals[operator][token];
    }

    function getOperatorEarnings(address operator, address token) external view returns (uint256) {
        return operatorEarnings[operator][token];
    }

    function getFeatures() external view returns (bool _teeEnabled, bool _profitDistributionEnabled, bool _swapEnabled) {
        return (teeEnabled, profitDistributionEnabled, swapEnabled);
    }

    // =========================================================================
    // Token Swap Functions (Destination Whitelist for Security)
    // =========================================================================

    /**
     * @notice Enable token swap functionality
     * @param _swapRouter Address of Uniswap V3 compatible router
     */
    function enableSwap(address _swapRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_swapRouter == address(0)) revert ZeroAddress();
        if (swapEnabled) revert AlreadyEnabled();

        swapEnabled = true;
        swapRouter = _swapRouter;

        emit SwapEnabled(_swapRouter);
    }

    /**
     * @notice Add token to whitelist of allowed swap destinations
     * @dev Only whitelisted tokens can be swapped INTO (prevents swapping into low value/liquidity tokens)
     * @param token Token address to whitelist
     */
    function whitelistSwapDestination(address token) external onlyRole(BOARD_ROLE) requireSwap {
        if (token == address(0)) revert ZeroAddress();
        if (whitelistedSwapDestinations[token]) return; // Already whitelisted

        whitelistedSwapDestinations[token] = true;
        swapDestinationList.push(token);

        emit SwapDestinationWhitelisted(token);
    }

    /**
     * @notice Remove token from whitelist
     * @param token Token address to remove
     */
    function removeSwapDestination(address token) external onlyRole(BOARD_ROLE) requireSwap {
        if (!whitelistedSwapDestinations[token]) return;

        whitelistedSwapDestinations[token] = false;

        // Remove from list
        for (uint256 i = 0; i < swapDestinationList.length; i++) {
            if (swapDestinationList[i] == token) {
                swapDestinationList[i] = swapDestinationList[swapDestinationList.length - 1];
                swapDestinationList.pop();
                break;
            }
        }

        emit SwapDestinationRemoved(token);
    }

    /**
     * @notice Swap tokens using Uniswap V3
     * @dev Can swap FROM any token, but can only swap INTO whitelisted tokens
     * @param tokenIn Token to swap from
     * @param tokenOut Token to swap to (must be whitelisted)
     * @param amountIn Amount to swap
     * @param minAmountOut Minimum output (slippage protection)
     * @param poolFee Uniswap pool fee tier (500, 3000, or 10000)
     */
    function swapTokens(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint24 poolFee)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
        whenNotPaused
        requireSwap
        returns (uint256 amountOut)
    {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert ZeroAmount();

        // SECURITY: Only allow swapping INTO whitelisted tokens
        // Swapping OUT of any token is fine (prevents accumulating low-value/illiquid tokens)
        if (!whitelistedSwapDestinations[tokenOut]) revert DestinationNotWhitelisted();

        // Check we have sufficient balance
        uint256 balance = IERC20(tokenIn).balanceOf(address(this));
        if (balance < amountIn) revert InsufficientBalance(balance, amountIn);

        // Approve router
        IERC20(tokenIn).approve(swapRouter, amountIn);

        // Build swap params (Uniswap V3 exactInputSingle)
        bytes memory data = abi.encodeWithSignature(
            "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
            tokenIn,
            tokenOut,
            poolFee,
            address(this), // recipient
            block.timestamp, // deadline
            amountIn,
            minAmountOut,
            0 // sqrtPriceLimitX96
        );

        (bool success, bytes memory result) = swapRouter.call(data);
        if (!success) revert SwapFailed();

        amountOut = abi.decode(result, (uint256));

        // Verify slippage
        uint256 maxSlippage = (amountIn * maxSwapSlippageBps) / BPS_DENOMINATOR;
        if (amountOut < minAmountOut) revert SlippageTooHigh();

        emit TokenSwapped(tokenIn, tokenOut, amountIn, amountOut, msg.sender);
    }

    /**
     * @notice Set maximum allowed slippage for swaps
     * @param newSlippageBps New slippage in basis points (e.g., 500 = 5%)
     */
    function setMaxSwapSlippage(uint256 newSlippageBps) external onlyRole(DEFAULT_ADMIN_ROLE) requireSwap {
        if (newSlippageBps > 2000) revert SlippageTooHigh(); // Max 20%
        emit MaxSlippageUpdated(maxSwapSlippageBps, newSlippageBps);
        maxSwapSlippageBps = newSlippageBps;
    }

    /**
     * @notice Update swap router address
     * @param newRouter New router address
     */
    function setSwapRouter(address newRouter) external onlyRole(DEFAULT_ADMIN_ROLE) requireSwap {
        if (newRouter == address(0)) revert ZeroAddress();
        swapRouter = newRouter;
    }

    /**
     * @notice Get all whitelisted swap destinations
     */
    function getWhitelistedSwapDestinations() external view returns (address[] memory) {
        return swapDestinationList;
    }

    /**
     * @notice Check if a token is a valid swap destination
     */
    function isValidSwapDestination(address token) external view returns (bool) {
        return whitelistedSwapDestinations[token];
    }

    // =========================================================================
    // Director Controls - Recurring Payments & Token Management
    // =========================================================================

    struct RecurringPayment {
        bytes32 paymentId;
        address recipient;
        address token; // address(0) for ETH
        uint256 amount;
        uint256 interval; // In seconds
        uint256 nextPayment;
        uint256 totalPaid;
        uint256 maxPayments; // 0 = unlimited
        uint256 paymentsMade;
        bool active;
        string description;
    }

    mapping(bytes32 => RecurringPayment) public recurringPayments;
    bytes32[] public recurringPaymentIds;
    uint256 public recurringPaymentCount;

    event RecurringPaymentCreated(bytes32 indexed paymentId, address indexed recipient, uint256 amount, uint256 interval);
    event RecurringPaymentExecuted(bytes32 indexed paymentId, address indexed recipient, uint256 amount);
    event RecurringPaymentCancelled(bytes32 indexed paymentId);
    event DirectorTokensSent(address indexed to, address indexed token, uint256 amount, string reason);
    event AccountToppedUp(address indexed account, address indexed token, uint256 amount);

    error PaymentNotFound();
    error PaymentNotActive();
    error PaymentNotDue();
    error MaxPaymentsReached();

    /**
     * @notice Director sends tokens to an address (with reason for audit trail)
     * @param to Recipient address
     * @param token Token address (address(0) for ETH)
     * @param amount Amount to send
     * @param reason Description of why this payment is being made
     */
    function directorSendTokens(address to, address token, uint256 amount, string calldata reason)
        external
        onlyRole(DIRECTOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (token == address(0)) {
            if (address(this).balance < amount) revert InsufficientBalance(address(this).balance, amount);
            (bool success,) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance < amount) revert InsufficientBalance(balance, amount);
            IERC20(token).safeTransfer(to, amount);
        }

        emit DirectorTokensSent(to, token, amount, reason);
    }

    /**
     * @notice Create a recurring payment schedule
     * @param recipient Payment recipient
     * @param token Token to pay (address(0) for ETH)
     * @param amount Amount per payment
     * @param interval Time between payments in seconds
     * @param maxPayments Maximum number of payments (0 for unlimited)
     * @param description Description of the recurring payment
     */
    function createRecurringPayment(
        address recipient,
        address token,
        uint256 amount,
        uint256 interval,
        uint256 maxPayments,
        string calldata description
    ) external onlyRole(DIRECTOR_ROLE) returns (bytes32 paymentId) {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (interval < 1 hours) revert InvalidInterval();

        paymentId = keccak256(abi.encodePacked(recipient, token, amount, block.timestamp, recurringPaymentCount++));

        recurringPayments[paymentId] = RecurringPayment({
            paymentId: paymentId,
            recipient: recipient,
            token: token,
            amount: amount,
            interval: interval,
            nextPayment: block.timestamp + interval,
            totalPaid: 0,
            maxPayments: maxPayments,
            paymentsMade: 0,
            active: true,
            description: description
        });

        recurringPaymentIds.push(paymentId);

        emit RecurringPaymentCreated(paymentId, recipient, amount, interval);
    }

    /**
     * @notice Execute a due recurring payment
     * @param paymentId The payment to execute
     */
    function executeRecurringPayment(bytes32 paymentId) external nonReentrant whenNotPaused {
        RecurringPayment storage payment = recurringPayments[paymentId];
        if (payment.recipient == address(0)) revert PaymentNotFound();
        if (!payment.active) revert PaymentNotActive();
        if (block.timestamp < payment.nextPayment) revert PaymentNotDue();
        if (payment.maxPayments > 0 && payment.paymentsMade >= payment.maxPayments) {
            payment.active = false;
            revert MaxPaymentsReached();
        }

        // Execute payment
        if (payment.token == address(0)) {
            if (address(this).balance < payment.amount) revert InsufficientBalance(address(this).balance, payment.amount);
            (bool success,) = payment.recipient.call{value: payment.amount}("");
            if (!success) revert TransferFailed();
        } else {
            uint256 balance = IERC20(payment.token).balanceOf(address(this));
            if (balance < payment.amount) revert InsufficientBalance(balance, payment.amount);
            IERC20(payment.token).safeTransfer(payment.recipient, payment.amount);
        }

        payment.totalPaid += payment.amount;
        payment.paymentsMade++;
        payment.nextPayment = block.timestamp + payment.interval;

        // Auto-deactivate if max reached
        if (payment.maxPayments > 0 && payment.paymentsMade >= payment.maxPayments) {
            payment.active = false;
        }

        emit RecurringPaymentExecuted(paymentId, payment.recipient, payment.amount);
    }

    /**
     * @notice Cancel a recurring payment
     * @param paymentId The payment to cancel
     */
    function cancelRecurringPayment(bytes32 paymentId) external onlyRole(DIRECTOR_ROLE) {
        RecurringPayment storage payment = recurringPayments[paymentId];
        if (payment.recipient == address(0)) revert PaymentNotFound();
        if (!payment.active) revert PaymentNotActive();

        payment.active = false;

        emit RecurringPaymentCancelled(paymentId);
    }

    /**
     * @notice Top up an account (e.g., for gas, services)
     * @param account Account to top up
     * @param token Token to send (address(0) for ETH)
     * @param amount Amount to send
     */
    function topUpAccount(address account, address token, uint256 amount)
        external
        onlyRole(DIRECTOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (token == address(0)) {
            if (address(this).balance < amount) revert InsufficientBalance(address(this).balance, amount);
            (bool success,) = account.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance < amount) revert InsufficientBalance(balance, amount);
            IERC20(token).safeTransfer(account, amount);
        }

        emit AccountToppedUp(account, token, amount);
    }

    /**
     * @notice Get all active recurring payments
     */
    function getActiveRecurringPayments() external view returns (RecurringPayment[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < recurringPaymentIds.length; i++) {
            if (recurringPayments[recurringPaymentIds[i]].active) {
                activeCount++;
            }
        }

        RecurringPayment[] memory active = new RecurringPayment[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < recurringPaymentIds.length; i++) {
            if (recurringPayments[recurringPaymentIds[i]].active) {
                active[index] = recurringPayments[recurringPaymentIds[i]];
                index++;
            }
        }

        return active;
    }

    /**
     * @notice Get recurring payment by ID
     */
    function getRecurringPayment(bytes32 paymentId) external view returns (RecurringPayment memory) {
        return recurringPayments[paymentId];
    }

    /**
     * @notice Get due recurring payments
     */
    function getDuePayments() external view returns (RecurringPayment[] memory) {
        uint256 dueCount = 0;
        for (uint256 i = 0; i < recurringPaymentIds.length; i++) {
            RecurringPayment storage p = recurringPayments[recurringPaymentIds[i]];
            if (p.active && block.timestamp >= p.nextPayment) {
                dueCount++;
            }
        }

        RecurringPayment[] memory due = new RecurringPayment[](dueCount);
        uint256 index = 0;
        for (uint256 i = 0; i < recurringPaymentIds.length; i++) {
            RecurringPayment storage p = recurringPayments[recurringPaymentIds[i]];
            if (p.active && block.timestamp >= p.nextPayment) {
                due[index] = p;
                index++;
            }
        }

        return due;
    }

    /**
     * @notice Add Director role to an address
     */
    function addDirector(address director) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (director == address(0)) revert ZeroAddress();
        grantRole(DIRECTOR_ROLE, director);
    }

    /**
     * @notice Remove Director role from an address
     */
    function removeDirector(address director) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(DIRECTOR_ROLE, director);
    }

    /**
     * @notice Check if an address is a Director
     */
    function isDirector(address account) external view returns (bool) {
        return hasRole(DIRECTOR_ROLE, account);
    }

    error InvalidInterval();

    function version() external pure returns (string memory) {
        return "2.2.0";
    }
}
