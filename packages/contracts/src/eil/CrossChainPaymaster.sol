// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ICrossDomainMessenger} from "./ICrossDomainMessenger.sol";

/**
 * @title CrossChainPaymaster
 * @author Jeju Network
 * @notice EIL-compliant paymaster enabling trustless cross-chain transfers without bridges
 * @dev Implements the Ethereum Interop Layer (EIL) protocol for atomic cross-chain swaps
 *
 * ## How it works:
 *
 * 1. User locks tokens on source chain by calling `createVoucherRequest()`
 * 2. XLP (Cross-chain Liquidity Provider) sees the request and issues a voucher
 * 3. Voucher is used on both chains:
 *    - Source: XLP claims user's locked tokens
 *    - Destination: User receives XLP's tokens
 * 4. Atomic swap complete - no trust required
 *
 * ## Security:
 * - XLPs must stake on L1 via L1StakeManager
 * - Failed fulfillments result in XLP stake slashing
 * - Users' funds are safe: either swap completes or they get refund
 *
 * @custom:security-contact security@jeju.network
 */
contract CrossChainPaymaster is BasePaymaster, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    /// @notice Blocks until a voucher request expires if no XLP responds
    uint256 public constant REQUEST_TIMEOUT = 50; // ~100 seconds on L2

    /// @notice Blocks until a voucher expires after being issued
    uint256 public constant VOUCHER_TIMEOUT = 100;

    /// @notice Blocks before XLP can claim source funds (fraud proof window)
    uint256 public constant CLAIM_DELAY = 150; // ~5 minutes

    /// @notice Minimum fee for cross-chain transfer (prevents dust)
    uint256 public constant MIN_FEE = 0.0001 ether;

    // ============ State Variables ============

    /// @notice L1 stake manager contract address (for stake verification)
    address public immutable l1StakeManager;

    /// @notice Chain ID of this deployment
    uint256 public immutable chainId;

    /// @notice Cross-domain messenger for L1↔L2 communication
    /// @dev On OP Stack L2s, this is 0x4200000000000000000000000000000000000007
    ICrossDomainMessenger public messenger;

    /// @notice Mapping of supported tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Voucher request storage: requestId => VoucherRequest
    mapping(bytes32 => VoucherRequest) public voucherRequests;

    /// @notice Voucher storage: voucherId => Voucher
    mapping(bytes32 => Voucher) public vouchers;

    /// @notice XLP liquidity deposits: xlp => token => amount
    mapping(address => mapping(address => uint256)) public xlpDeposits;

    /// @notice XLP ETH deposits for gas sponsorship
    mapping(address => uint256) public xlpETHDeposits;

    /// @notice Active request count per XLP (for stake requirements)
    mapping(address => uint256) public xlpActiveRequests;

    /// @notice Verified XLP stakes (cached from L1)
    mapping(address => uint256) public xlpVerifiedStake;

    /// @notice Request ID to claiming XLP
    mapping(bytes32 => address) public requestClaimedBy;

    /// @notice Track fulfilled voucher hashes to prevent replay attacks
    mapping(bytes32 => bool) public fulfilledVoucherHashes;

    // ============ Structs ============

    struct VoucherRequest {
        address requester;
        address token;
        uint256 amount;
        address destinationToken;
        uint256 destinationChainId;
        address recipient;
        uint256 gasOnDestination;
        uint256 maxFee;
        uint256 feeIncrement;
        uint256 deadline;
        uint256 createdBlock;
        bool claimed;
        bool expired;
        bool refunded;
    }

    struct Voucher {
        bytes32 requestId;
        address xlp;
        uint256 sourceChainId;
        uint256 destinationChainId;
        address sourceToken;
        address destinationToken;
        uint256 amount;
        uint256 fee;
        uint256 gasProvided;
        uint256 issuedBlock;
        uint256 expiresBlock;
        bool fulfilled;
        bool slashed;
        bool claimed; // Track if source funds have been claimed
    }

    // ============ Events ============

    event VoucherRequested(
        bytes32 indexed requestId,
        address indexed requester,
        address token,
        uint256 amount,
        uint256 destinationChainId,
        address recipient,
        uint256 maxFee,
        uint256 deadline
    );

    event VoucherIssued(bytes32 indexed voucherId, bytes32 indexed requestId, address indexed xlp, uint256 fee);

    event VoucherFulfilled(bytes32 indexed voucherId, address indexed recipient, uint256 amount);

    event VoucherExpired(bytes32 indexed requestId, address indexed requester);

    event FundsRefunded(bytes32 indexed requestId, address indexed requester, uint256 amount);

    event XLPDeposit(address indexed xlp, address indexed token, uint256 amount);

    event XLPWithdraw(address indexed xlp, address indexed token, uint256 amount);

    event XLPStakeVerified(address indexed xlp, uint256 stake);

    event SourceFundsClaimed(bytes32 indexed requestId, address indexed xlp, uint256 amount, uint256 fee);

    event TokenSupportUpdated(address indexed token, bool supported);

    // ============ Errors ============

    error UnsupportedToken();
    error InsufficientAmount();
    error InsufficientFee();
    error RequestExpired();
    error RequestNotExpired();
    error RequestAlreadyClaimed();
    error RequestAlreadyRefunded();
    error VoucherExpiredError();
    error VoucherAlreadyFulfilled();
    error InvalidVoucherSignature();
    error InsufficientXLPLiquidity();
    error InsufficientXLPStake();
    error ClaimDelayNotPassed();
    error InvalidDestinationChain();
    error OnlyXLP();
    error Unauthorized();
    error TransferFailed();
    error InvalidRecipient();
    error VoucherAlreadyClaimed();

    // ============ Constructor ============

    /**
     * @notice Initialize the CrossChainPaymaster
     * @param _entryPoint ERC-4337 EntryPoint address
     * @param _l1StakeManager L1 stake manager address for XLP verification
     * @param _chainId Chain ID of this deployment
     */
    constructor(IEntryPoint _entryPoint, address _l1StakeManager, uint256 _chainId) BasePaymaster(_entryPoint) {
        require(_l1StakeManager != address(0), "Invalid stake manager");
        l1StakeManager = _l1StakeManager;
        chainId = _chainId;
        // Default OP Stack L2 messenger address
        messenger = ICrossDomainMessenger(0x4200000000000000000000000000000000000007);
    }

    /**
     * @notice Set the cross-domain messenger address
     * @param _messenger New messenger address
     * @dev Only needed if not using default OP Stack address
     */
    function setMessenger(address _messenger) external onlyOwner {
        messenger = ICrossDomainMessenger(_messenger);
    }

    // ============ Token Management ============

    /**
     * @notice Add or remove token support
     * @param token Token address
     * @param supported Whether to support this token
     */
    function setTokenSupport(address token, bool supported) external onlyOwner {
        supportedTokens[token] = supported;
        emit TokenSupportUpdated(token, supported);
    }

    // ============ Voucher Request (Source Chain) ============

    /**
     * @notice Create a cross-chain transfer request
     * @param token Token to transfer (locked on this chain)
     * @param amount Amount to transfer
     * @param destinationToken Token to receive on destination
     * @param destinationChainId Destination chain ID
     * @param recipient Address to receive funds on destination
     * @param gasOnDestination ETH needed for gas on destination
     * @param maxFee Maximum fee willing to pay
     * @param feeIncrement Fee increase per block (reverse Dutch auction)
     * @return requestId Unique request identifier
     */
    /**
     * @custom:security CEI pattern: Store request and emit event before external refunds
     */
    function createVoucherRequest(
        address token,
        uint256 amount,
        address destinationToken,
        uint256 destinationChainId,
        address recipient,
        uint256 gasOnDestination,
        uint256 maxFee,
        uint256 feeIncrement
    ) external payable nonReentrant returns (bytes32 requestId) {
        if (!supportedTokens[token]) revert UnsupportedToken();
        if (amount == 0) revert InsufficientAmount();
        if (maxFee < MIN_FEE) revert InsufficientFee();
        if (destinationChainId == chainId) revert InvalidDestinationChain();
        if (recipient == address(0)) revert InvalidRecipient();

        // Validate ETH amount
        uint256 excessRefund = 0;
        if (token == address(0)) {
            uint256 required = amount + maxFee;
            if (msg.value < required) revert InsufficientAmount();
            excessRefund = msg.value - required;
        } else {
            if (msg.value < maxFee) revert InsufficientFee();
            excessRefund = msg.value - maxFee;
        }

        // Generate unique request ID
        requestId =
            keccak256(abi.encodePacked(msg.sender, token, amount, destinationChainId, block.number, block.timestamp));

        // EFFECTS: Store request FIRST (CEI pattern)
        voucherRequests[requestId] = VoucherRequest({
            requester: msg.sender,
            token: token,
            amount: amount,
            destinationToken: destinationToken,
            destinationChainId: destinationChainId,
            recipient: recipient,
            gasOnDestination: gasOnDestination,
            maxFee: maxFee,
            feeIncrement: feeIncrement,
            deadline: block.number + REQUEST_TIMEOUT,
            createdBlock: block.number,
            claimed: false,
            expired: false,
            refunded: false
        });

        // Emit event before external calls
        emit VoucherRequested(
            requestId, msg.sender, token, amount, destinationChainId, recipient, maxFee, block.number + REQUEST_TIMEOUT
        );

        // INTERACTIONS: External calls LAST
        // Transfer ERC20 tokens from user
        if (token != address(0)) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        // Refund excess ETH
        if (excessRefund > 0) {
            (bool refundSuccess,) = msg.sender.call{value: excessRefund}("");
            if (!refundSuccess) revert TransferFailed();
        }
    }

    /**
     * @notice Get current fee for a request (increases over time)
     * @param requestId Request to check
     * @return currentFee Current fee based on elapsed blocks
     */
    function getCurrentFee(bytes32 requestId) public view returns (uint256 currentFee) {
        VoucherRequest storage request = voucherRequests[requestId];
        if (request.requester == address(0)) return 0;

        uint256 elapsedBlocks = block.number - request.createdBlock;
        currentFee = MIN_FEE + (elapsedBlocks * request.feeIncrement);

        if (currentFee > request.maxFee) {
            currentFee = request.maxFee;
        }
    }

    /**
     * @notice Refund expired request to user
     * @param requestId Request to refund
     * @custom:security CEI pattern: Update state and emit events before external calls
     */
    function refundExpiredRequest(bytes32 requestId) external nonReentrant {
        VoucherRequest storage request = voucherRequests[requestId];

        if (request.requester == address(0)) revert Unauthorized();
        if (request.claimed) revert RequestAlreadyClaimed();
        if (request.refunded) revert RequestAlreadyRefunded();
        if (block.number <= request.deadline) revert RequestNotExpired();

        // Cache values
        address requester = request.requester;
        address token = request.token;
        uint256 amount = request.amount;
        uint256 maxFee = request.maxFee;

        // EFFECTS: Update state first
        request.expired = true;
        request.refunded = true;

        // Emit events before external calls
        emit VoucherExpired(requestId, requester);
        emit FundsRefunded(requestId, requester, amount);

        // INTERACTIONS: External calls last
        if (token == address(0)) {
            // Native ETH - refund amount + maxFee
            (bool success,) = requester.call{value: amount + maxFee}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20 - refund tokens AND the ETH fee that was collected
            IERC20(token).safeTransfer(requester, amount);
            // Also refund the ETH fee
            if (maxFee > 0) {
                (bool feeSuccess,) = requester.call{value: maxFee}("");
                if (!feeSuccess) revert TransferFailed();
            }
        }
    }

    // ============ XLP Liquidity Management ============

    /**
     * @notice Deposit tokens as XLP liquidity
     * @param token Token to deposit
     * @param amount Amount to deposit
     */
    function depositLiquidity(address token, uint256 amount) external nonReentrant {
        if (!supportedTokens[token]) revert UnsupportedToken();
        if (amount == 0) revert InsufficientAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        xlpDeposits[msg.sender][token] += amount;

        emit XLPDeposit(msg.sender, token, amount);
    }

    /**
     * @notice Deposit ETH for gas sponsorship
     */
    function depositETH() external payable nonReentrant {
        if (msg.value == 0) revert InsufficientAmount();
        xlpETHDeposits[msg.sender] += msg.value;

        emit XLPDeposit(msg.sender, address(0), msg.value);
    }

    /**
     * @notice Withdraw XLP token liquidity
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @custom:security CEI pattern: Update state and emit events before external calls
     */
    function withdrawLiquidity(address token, uint256 amount) external nonReentrant {
        if (xlpDeposits[msg.sender][token] < amount) revert InsufficientXLPLiquidity();

        // EFFECTS: Update state first
        xlpDeposits[msg.sender][token] -= amount;

        // Emit event before external call
        emit XLPWithdraw(msg.sender, token, amount);

        // INTERACTIONS: External call last
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Withdraw XLP ETH
     * @param amount Amount to withdraw
     * @custom:security CEI pattern: Update state and emit events before external calls
     */
    function withdrawETH(uint256 amount) external nonReentrant {
        if (xlpETHDeposits[msg.sender] < amount) revert InsufficientXLPLiquidity();

        // EFFECTS: Update state first
        xlpETHDeposits[msg.sender] -= amount;

        // Emit event before external call
        emit XLPWithdraw(msg.sender, address(0), amount);

        // INTERACTIONS: External call last
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Update verified stake for an XLP (called via cross-chain message from L1)
     * @param xlp XLP address
     * @param stake Verified stake amount
     * @dev Can be called by:
     *      - Owner (for testing/emergencies)
     *      - L1StakeManager via CrossDomainMessenger
     */
    function updateXLPStake(address xlp, uint256 stake) external {
        bool isOwner = msg.sender == owner();
        bool isL1Message = msg.sender == address(messenger) && messenger.xDomainMessageSender() == l1StakeManager;

        require(isOwner || isL1Message, "Only owner or L1 message");

        xlpVerifiedStake[xlp] = stake;
        emit XLPStakeVerified(xlp, stake);
    }

    /**
     * @notice Mark a voucher as fulfilled (cross-chain verification)
     * @param voucherId Voucher to mark as fulfilled
     * @dev Can be called by:
     *      - Owner (for testing/emergencies)
     *      - L1StakeManager via CrossDomainMessenger (relays fulfillment proof from destination)
     *
     * Note: In a full multi-L2 setup, this would integrate with a cross-L2 messaging
     * protocol. For L1↔L2 flows, the L1 acts as a hub to relay fulfillment proofs.
     */
    function markVoucherFulfilled(bytes32 voucherId) external {
        bool isOwner = msg.sender == owner();
        bool isL1Message = msg.sender == address(messenger) && messenger.xDomainMessageSender() == l1StakeManager;

        require(isOwner || isL1Message, "Only owner or L1 message");
        require(vouchers[voucherId].xlp != address(0), "Voucher not found");
        require(!vouchers[voucherId].fulfilled, "Already fulfilled");

        vouchers[voucherId].fulfilled = true;
        // Get recipient from the original request
        VoucherRequest storage request = voucherRequests[vouchers[voucherId].requestId];
        emit VoucherFulfilled(voucherId, request.recipient, vouchers[voucherId].amount);
    }

    // ============ Voucher Issuance (XLP) ============

    /**
     * @notice Issue a voucher to fulfill a request (XLP only)
     * @param requestId Request to fulfill
     * @param signature XLP's signature on the voucher commitment
     * @return voucherId Unique voucher identifier
     */
    function issueVoucher(bytes32 requestId, bytes calldata signature)
        external
        nonReentrant
        returns (bytes32 voucherId)
    {
        VoucherRequest storage request = voucherRequests[requestId];

        if (request.requester == address(0)) revert Unauthorized();
        if (request.claimed) revert RequestAlreadyClaimed();
        if (request.expired || block.number > request.deadline) revert RequestExpired();

        // Verify XLP has sufficient stake (10% of transfer amount, minimum 0.01 ETH)
        uint256 requiredStake = request.amount / 10;
        if (requiredStake < 0.01 ether) requiredStake = 0.01 ether;
        if (xlpVerifiedStake[msg.sender] < requiredStake) revert InsufficientXLPStake();

        // Calculate fee based on current block
        uint256 fee = getCurrentFee(requestId);

        // Generate voucher ID
        voucherId = keccak256(abi.encodePacked(requestId, msg.sender, block.number, signature));

        // Verify signature (XLP commits to fulfill)
        bytes32 commitment =
            keccak256(abi.encodePacked(requestId, msg.sender, request.amount, fee, request.destinationChainId));
        address signer = commitment.toEthSignedMessageHash().recover(signature);
        if (signer != msg.sender) revert InvalidVoucherSignature();

        // Mark request as claimed
        request.claimed = true;
        requestClaimedBy[requestId] = msg.sender;
        xlpActiveRequests[msg.sender]++;

        // Store voucher
        vouchers[voucherId] = Voucher({
            requestId: requestId,
            xlp: msg.sender,
            sourceChainId: chainId,
            destinationChainId: request.destinationChainId,
            sourceToken: request.token,
            destinationToken: request.destinationToken,
            amount: request.amount,
            fee: fee,
            gasProvided: request.gasOnDestination,
            issuedBlock: block.number,
            expiresBlock: block.number + VOUCHER_TIMEOUT,
            fulfilled: false,
            slashed: false,
            claimed: false
        });

        emit VoucherIssued(voucherId, requestId, msg.sender, fee);
    }

    /**
     * @notice Claim source funds after claim delay (XLP only)
     * @param voucherId Voucher ID
     * @dev Only callable after CLAIM_DELAY blocks and if voucher was fulfilled on destination
     *      XLP receives: amount (locked tokens) + fee (for their service)
     * @custom:security CEI pattern: Update all state before external calls
     */
    function claimSourceFunds(bytes32 voucherId) external nonReentrant {
        Voucher storage voucher = vouchers[voucherId];
        VoucherRequest storage request = voucherRequests[voucher.requestId];

        if (voucher.xlp != msg.sender) revert OnlyXLP();
        if (!voucher.fulfilled) revert VoucherExpiredError(); // Must be fulfilled first
        if (voucher.slashed) revert Unauthorized();
        if (voucher.claimed) revert VoucherAlreadyClaimed(); // Prevent double-claim
        if (block.number < voucher.issuedBlock + CLAIM_DELAY) revert ClaimDelayNotPassed();

        // Cache values
        uint256 xlpReceives = request.amount;
        uint256 feeReceived = voucher.fee;
        address token = request.token;
        bytes32 requestId = voucher.requestId;

        // EFFECTS: Update ALL state BEFORE external calls (CEI pattern)
        voucher.claimed = true;
        xlpActiveRequests[msg.sender]--;

        // Emit event before external calls
        emit SourceFundsClaimed(requestId, msg.sender, xlpReceives, feeReceived);

        // INTERACTIONS: External calls last
        if (token == address(0)) {
            // Native ETH - amount was locked, fee was also locked in maxFee
            // XLP gets amount + fee
            (bool success,) = msg.sender.call{value: xlpReceives + feeReceived}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20 - transfer the locked tokens
            IERC20(token).safeTransfer(msg.sender, xlpReceives);
            // Fee was paid in ETH for ERC20 transfers
            if (feeReceived > 0) {
                (bool feeSuccess,) = msg.sender.call{value: feeReceived}("");
                if (!feeSuccess) revert TransferFailed();
            }
        }
    }

    // ============ Voucher Fulfillment (Destination Chain) ============

    /**
     * @notice Fulfill a voucher on the destination chain
     * @param voucherId Voucher to fulfill
     * @param xlpSignature XLP's signature proving voucher validity
     * @dev Called by user's UserOp on destination chain
     * @custom:security CEI pattern: Update all state before external calls
     */
    function fulfillVoucher(
        bytes32 voucherId,
        bytes32 requestId,
        address xlp,
        address token,
        uint256 amount,
        address recipient,
        uint256 gasAmount,
        bytes calldata xlpSignature
    ) external nonReentrant {
        // Verify voucher signature from XLP
        bytes32 voucherHash =
            keccak256(abi.encodePacked(voucherId, requestId, xlp, token, amount, recipient, gasAmount, chainId));

        // Prevent replay attacks
        if (fulfilledVoucherHashes[voucherHash]) revert VoucherAlreadyFulfilled();

        address signer = voucherHash.toEthSignedMessageHash().recover(xlpSignature);
        if (signer != xlp) revert InvalidVoucherSignature();

        // Verify XLP has liquidity first
        if (token == address(0)) {
            if (xlpETHDeposits[xlp] < amount + gasAmount) revert InsufficientXLPLiquidity();
        } else {
            if (xlpDeposits[xlp][token] < amount) revert InsufficientXLPLiquidity();
            if (gasAmount > 0 && xlpETHDeposits[xlp] < gasAmount) revert InsufficientXLPLiquidity();
        }

        // EFFECTS: Update ALL state BEFORE external calls (CEI pattern)
        fulfilledVoucherHashes[voucherHash] = true;
        vouchers[voucherId].fulfilled = true;

        if (token == address(0)) {
            xlpETHDeposits[xlp] -= amount + gasAmount;
        } else {
            xlpDeposits[xlp][token] -= amount;
            if (gasAmount > 0) {
                xlpETHDeposits[xlp] -= gasAmount;
            }
        }

        // Emit event before external calls
        emit VoucherFulfilled(voucherId, recipient, amount);

        // INTERACTIONS: External calls last
        if (token == address(0)) {
            (bool success,) = recipient.call{value: amount + gasAmount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
            if (gasAmount > 0) {
                (bool gasSuccess,) = recipient.call{value: gasAmount}("");
                if (!gasSuccess) revert TransferFailed();
            }
        }
    }

    // ============ Paymaster Validation (ERC-4337) ============

    /**
     * @notice Validate cross-chain UserOp
     * @dev Part of ERC-4337 paymaster interface
     */
    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, /*userOpHash*/ uint256 maxCost)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        // Parse paymasterAndData to get voucher info
        // Format: [paymaster(20)][verificationGas(16)][postOpGas(16)][voucherId(32)][xlp(20)]
        if (userOp.paymasterAndData.length < 104) {
            return ("", 1); // Invalid
        }

        bytes32 voucherId = bytes32(userOp.paymasterAndData[52:84]);
        address xlp = address(bytes20(userOp.paymasterAndData[84:104]));

        // Verify XLP has enough ETH to cover gas
        if (xlpETHDeposits[xlp] < maxCost) {
            return ("", 1); // Insufficient gas funds
        }

        context = abi.encode(voucherId, xlp, maxCost);
        validationData = 0; // Accept
    }

    /**
     * @notice Post-operation callback
     * @dev Deducts gas cost from XLP's ETH deposit
     */
    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256 /*actualUserOpFeePerGas*/ )
        internal
        override
    {
        (bytes32 voucherId, address xlp,) = abi.decode(context, (bytes32, address, uint256));

        // Always deduct gas cost from XLP (they pay for gas even on revert)
        if (xlpETHDeposits[xlp] >= actualGasCost) {
            xlpETHDeposits[xlp] -= actualGasCost;
        }

        // Only mark as fulfilled if operation succeeded
        // On revert, the voucher should remain unfulfilled so XLP can retry
        if (mode == PostOpMode.opSucceeded) {
            vouchers[voucherId].fulfilled = true;
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get XLP liquidity for a token
     * @param xlp XLP address
     * @param token Token address
     * @return amount Liquidity amount
     */
    function getXLPLiquidity(address xlp, address token) external view returns (uint256) {
        return xlpDeposits[xlp][token];
    }

    /**
     * @notice Get XLP ETH balance
     * @param xlp XLP address
     * @return amount ETH balance
     */
    function getXLPETH(address xlp) external view returns (uint256) {
        return xlpETHDeposits[xlp];
    }

    /**
     * @notice Check if a request can be fulfilled
     * @param requestId Request ID
     * @return canFulfill Whether request is open for fulfillment
     */
    function canFulfillRequest(bytes32 requestId) external view returns (bool) {
        VoucherRequest storage request = voucherRequests[requestId];
        return
            request.requester != address(0) && !request.claimed && !request.expired && block.number <= request.deadline;
    }

    /**
     * @notice Get request details
     * @param requestId Request ID
     * @return request Full request details
     */
    function getRequest(bytes32 requestId) external view returns (VoucherRequest memory) {
        return voucherRequests[requestId];
    }

    /**
     * @notice Get voucher details
     * @param voucherId Voucher ID
     * @return voucher Full voucher details
     */
    function getVoucher(bytes32 voucherId) external view returns (Voucher memory) {
        return vouchers[voucherId];
    }

    // ============ Receive ETH ============

    receive() external payable {
        // Accept ETH for deposits
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
