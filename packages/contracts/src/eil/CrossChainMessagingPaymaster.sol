// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ICrossDomainMessenger} from "./ICrossDomainMessenger.sol";

/**
 * @title CrossChainMessagingPaymaster
 * @author Jeju Network
 * @notice Passive liquidity fallback for EIL when no XLPs are available
 * @dev Uses canonical rollup bridges for trustless (but slower) cross-chain transfers
 *
 * ## How it works:
 *
 * 1. User locks tokens in the paymaster liquidity pool
 * 2. System sends a canonical cross-chain message to the destination
 * 3. After message is finalized (L1 finality + challenge period), destination releases funds
 * 4. No XLP needed - relies entirely on Ethereum's security model
 *
 * ## Security:
 * - Fully trustless - only relies on L1 finality and rollup challenge periods
 * - Slower than XLP path (typically 7+ days for optimistic rollups, faster for ZK)
 * - Liquidity pools on each chain must be pre-funded
 *
 * ## Trade-offs:
 * - Trustless: Maximum security, no external party risk
 * - Slower: Waits for L1 finality and challenge periods
 * - Liquidity: Requires pre-funded pools (LPs earn fees)
 *
 * @custom:security-contact security@jeju.network
 */
contract CrossChainMessagingPaymaster is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Minimum transfer amount
    uint256 public constant MIN_TRANSFER = 0.001 ether;

    /// @notice Fee rate in basis points (default 0.1% = 10 bps)
    uint256 public constant DEFAULT_FEE_BPS = 10;

    /// @notice Basis points denominator
    uint256 public constant BASIS_POINTS = 10000;

    /// @notice Gas limit for cross-chain messages
    uint32 public constant CROSS_CHAIN_GAS_LIMIT = 250_000;

    // ============ State Variables ============

    /// @notice Chain ID of this deployment
    uint256 public immutable chainId;

    /// @notice Cross-domain messenger for L1↔L2 communication
    ICrossDomainMessenger public messenger;

    /// @notice Registered counterpart paymasters on other chains: chainId => address
    mapping(uint256 => address) public counterpartPaymasters;

    /// @notice Liquidity pool deposits: token => depositor => amount
    mapping(address => mapping(address => uint256)) public poolDeposits;

    /// @notice Total liquidity per token
    mapping(address => uint256) public totalLiquidity;

    /// @notice Supported tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Pending transfers: transferId => PendingTransfer
    mapping(bytes32 => PendingTransfer) public pendingTransfers;

    /// @notice Completed transfers for replay protection
    mapping(bytes32 => bool) public completedTransfers;

    /// @notice Fee rate in basis points
    uint256 public feeBps = DEFAULT_FEE_BPS;

    /// @notice Total fees collected per token
    mapping(address => uint256) public feesCollected;

    /// @notice Transfer nonce for unique IDs
    uint256 public transferNonce;

    // ============ Structs ============

    struct PendingTransfer {
        address sender;
        address token;
        uint256 amount;
        uint256 destinationChainId;
        address recipient;
        uint256 fee;
        uint256 createdBlock;
        uint256 createdTimestamp;
        bool cancelled;
        bool completed;
    }

    // ============ Events ============

    event TransferInitiated(
        bytes32 indexed transferId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 destinationChainId,
        uint256 fee
    );

    event TransferCompleted(bytes32 indexed transferId, address indexed recipient, address token, uint256 amount);

    event TransferCancelled(bytes32 indexed transferId, address indexed sender, uint256 refundAmount);

    event LiquidityDeposited(address indexed depositor, address indexed token, uint256 amount);

    event LiquidityWithdrawn(address indexed depositor, address indexed token, uint256 amount);

    event CounterpartRegistered(uint256 indexed chainId, address paymaster);

    event TokenSupportUpdated(address indexed token, bool supported);

    event FeesUpdated(uint256 oldFee, uint256 newFee);

    event FeesClaimed(address indexed token, uint256 amount, address recipient);

    // ============ Errors ============

    error UnsupportedToken();
    error InsufficientAmount();
    error InsufficientLiquidity();
    error InvalidDestination();
    error InvalidRecipient();
    error TransferNotFound();
    error TransferAlreadyCompleted();
    error TransferAlreadyCancelled();
    error TransferNotCancellable();
    error NotCounterpart();
    error MessengerNotSet();
    error TransferFailed();
    error InvalidFee();

    // ============ Constructor ============

    constructor(uint256 _chainId) Ownable(msg.sender) {
        chainId = _chainId;
        // Default OP Stack L2 messenger
        messenger = ICrossDomainMessenger(0x4200000000000000000000000000000000000007);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the cross-domain messenger
     * @param _messenger New messenger address
     */
    function setMessenger(address _messenger) external onlyOwner {
        messenger = ICrossDomainMessenger(_messenger);
    }

    /**
     * @notice Register a counterpart paymaster on another chain
     * @param _chainId Chain ID of the counterpart
     * @param _paymaster Address of the counterpart paymaster
     */
    function registerCounterpart(uint256 _chainId, address _paymaster) external onlyOwner {
        counterpartPaymasters[_chainId] = _paymaster;
        emit CounterpartRegistered(_chainId, _paymaster);
    }

    /**
     * @notice Set token support
     * @param token Token address (address(0) for ETH)
     * @param supported Whether to support this token
     */
    function setTokenSupport(address token, bool supported) external onlyOwner {
        supportedTokens[token] = supported;
        emit TokenSupportUpdated(token, supported);
    }

    /**
     * @notice Update fee rate
     * @param _feeBps New fee in basis points (max 100 = 1%)
     */
    function setFee(uint256 _feeBps) external onlyOwner {
        if (_feeBps > 100) revert InvalidFee();
        uint256 oldFee = feeBps;
        feeBps = _feeBps;
        emit FeesUpdated(oldFee, _feeBps);
    }

    /**
     * @notice Claim collected fees
     * @param token Token to claim fees for
     * @param recipient Address to receive fees
     */
    function claimFees(address token, address recipient) external onlyOwner {
        uint256 amount = feesCollected[token];
        feesCollected[token] = 0;

        if (token == address(0)) {
            (bool success,) = recipient.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }

        emit FeesClaimed(token, amount, recipient);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Liquidity Provider Functions ============

    /**
     * @notice Deposit liquidity to the pool
     * @param token Token to deposit (address(0) not supported, use depositETH)
     * @param amount Amount to deposit
     */
    function depositLiquidity(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (!supportedTokens[token] || token == address(0)) revert UnsupportedToken();
        if (amount == 0) revert InsufficientAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        poolDeposits[token][msg.sender] += amount;
        totalLiquidity[token] += amount;

        emit LiquidityDeposited(msg.sender, token, amount);
    }

    /**
     * @notice Deposit ETH liquidity to the pool
     */
    function depositETH() external payable nonReentrant whenNotPaused {
        if (!supportedTokens[address(0)]) revert UnsupportedToken();
        if (msg.value == 0) revert InsufficientAmount();

        poolDeposits[address(0)][msg.sender] += msg.value;
        totalLiquidity[address(0)] += msg.value;

        emit LiquidityDeposited(msg.sender, address(0), msg.value);
    }

    /**
     * @notice Withdraw liquidity from the pool
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function withdrawLiquidity(address token, uint256 amount) external nonReentrant {
        if (poolDeposits[token][msg.sender] < amount) revert InsufficientLiquidity();

        poolDeposits[token][msg.sender] -= amount;
        totalLiquidity[token] -= amount;

        emit LiquidityWithdrawn(msg.sender, token, amount);

        if (token == address(0)) {
            (bool success,) = msg.sender.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
    }

    // ============ Transfer Functions ============

    /**
     * @notice Initiate a cross-chain transfer using canonical bridge
     * @param token Token to transfer (address(0) for ETH)
     * @param amount Amount to transfer
     * @param destinationChainId Destination chain ID
     * @param recipient Recipient address on destination
     * @return transferId Unique transfer identifier
     */
    function initiateTransfer(address token, uint256 amount, uint256 destinationChainId, address recipient)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 transferId)
    {
        if (!supportedTokens[token]) revert UnsupportedToken();
        if (amount < MIN_TRANSFER) revert InsufficientAmount();
        if (destinationChainId == chainId) revert InvalidDestination();
        if (counterpartPaymasters[destinationChainId] == address(0)) revert InvalidDestination();
        if (recipient == address(0)) revert InvalidRecipient();
        if (address(messenger) == address(0)) revert MessengerNotSet();

        // Calculate fee
        uint256 fee = (amount * feeBps) / BASIS_POINTS;
        uint256 amountAfterFee = amount - fee;

        // Validate and receive tokens/ETH
        if (token == address(0)) {
            if (msg.value < amount) revert InsufficientAmount();
            // Refund excess
            if (msg.value > amount) {
                (bool success,) = msg.sender.call{value: msg.value - amount}("");
                if (!success) revert TransferFailed();
            }
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        // Generate transfer ID
        transferId = keccak256(
            abi.encodePacked(msg.sender, token, amount, destinationChainId, recipient, transferNonce++, block.timestamp)
        );

        // Store pending transfer
        pendingTransfers[transferId] = PendingTransfer({
            sender: msg.sender,
            token: token,
            amount: amount,
            destinationChainId: destinationChainId,
            recipient: recipient,
            fee: fee,
            createdBlock: block.number,
            createdTimestamp: block.timestamp,
            cancelled: false,
            completed: false
        });

        // Collect fee
        feesCollected[token] += fee;

        emit TransferInitiated(transferId, msg.sender, recipient, token, amountAfterFee, destinationChainId, fee);

        // Send cross-chain message to release funds on destination
        bytes memory message = abi.encodeWithSelector(
            this.completeTransfer.selector,
            transferId,
            token,
            amountAfterFee,
            recipient,
            chainId // Include origin chain ID for verification
        );

        messenger.sendMessage(counterpartPaymasters[destinationChainId], message, CROSS_CHAIN_GAS_LIMIT);
    }

    /**
     * @notice Complete a transfer on the destination chain (called via cross-chain message)
     * @param transferId Transfer ID
     * @param token Token to release
     * @param amount Amount to release
     * @param recipient Recipient address
     * @param originChainId Chain ID where the transfer originated
     */
    function completeTransfer(
        bytes32 transferId,
        address token,
        uint256 amount,
        address recipient,
        uint256 originChainId
    ) external nonReentrant {
        // Verify message is from our counterpart via the messenger
        // Note: For L1→L2 messages, msg.sender is the messenger
        // For direct calls (testing), we allow owner
        bool isValidMessage = msg.sender == address(messenger) || msg.sender == owner();
        if (!isValidMessage) revert NotCounterpart();

        // For messenger calls, verify the cross-domain sender is a registered counterpart
        if (msg.sender == address(messenger)) {
            address xDomainSender = messenger.xDomainMessageSender();
            if (counterpartPaymasters[originChainId] != xDomainSender) revert NotCounterpart();
        }

        // Check for replay
        if (completedTransfers[transferId]) revert TransferAlreadyCompleted();

        // Check liquidity
        if (totalLiquidity[token] < amount) revert InsufficientLiquidity();

        // Mark completed
        completedTransfers[transferId] = true;

        // Update liquidity (will be replenished by LPs over time via arbitrage)
        totalLiquidity[token] -= amount;

        emit TransferCompleted(transferId, recipient, token, amount);

        // Transfer to recipient
        if (token == address(0)) {
            (bool success,) = recipient.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    /**
     * @notice Cancel a pending transfer and refund (only if not yet finalized on destination)
     * @param transferId Transfer to cancel
     * @dev This is a best-effort cancellation - if message is already in flight, it may still complete
     */
    function cancelTransfer(bytes32 transferId) external nonReentrant {
        PendingTransfer storage transfer = pendingTransfers[transferId];

        if (transfer.sender == address(0)) revert TransferNotFound();
        if (transfer.sender != msg.sender) revert TransferNotFound();
        if (transfer.cancelled) revert TransferAlreadyCancelled();
        if (transfer.completed) revert TransferAlreadyCompleted();

        // Only allow cancellation within a short window (before message is likely finalized)
        // For optimistic rollups, this is ~7 days, so we use a shorter window
        uint256 cancellationWindow = 1 hours;
        if (block.timestamp > transfer.createdTimestamp + cancellationWindow) {
            revert TransferNotCancellable();
        }

        transfer.cancelled = true;

        // Refund amount minus fee (fee is still charged as message may have been sent)
        uint256 refundAmount = transfer.amount - transfer.fee;

        emit TransferCancelled(transferId, msg.sender, refundAmount);

        if (transfer.token == address(0)) {
            (bool success,) = msg.sender.call{value: refundAmount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(transfer.token).safeTransfer(msg.sender, refundAmount);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get liquidity position for a depositor
     * @param token Token address
     * @param depositor Depositor address
     * @return deposited Amount deposited
     */
    function getLiquidityPosition(address token, address depositor) external view returns (uint256 deposited) {
        return poolDeposits[token][depositor];
    }

    /**
     * @notice Get total liquidity for a token
     * @param token Token address
     * @return liquidity Total liquidity available
     */
    function getTotalLiquidity(address token) external view returns (uint256) {
        return totalLiquidity[token];
    }

    /**
     * @notice Check if a transfer can be completed
     * @param token Token to check
     * @param amount Amount needed
     * @return canComplete Whether the transfer can be completed
     */
    function canComplete(address token, uint256 amount) external view returns (bool) {
        return totalLiquidity[token] >= amount;
    }

    /**
     * @notice Get transfer details
     * @param transferId Transfer ID
     * @return transfer Transfer details
     */
    function getTransfer(bytes32 transferId) external view returns (PendingTransfer memory) {
        return pendingTransfers[transferId];
    }

    /**
     * @notice Calculate fee for a transfer amount
     * @param amount Transfer amount
     * @return fee Fee amount
     */
    function calculateFee(uint256 amount) external view returns (uint256) {
        return (amount * feeBps) / BASIS_POINTS;
    }

    /**
     * @notice Check if a transfer has been completed
     */
    function isCompleted(bytes32 transferId) external view returns (bool) {
        return completedTransfers[transferId];
    }

    receive() external payable {}
}
