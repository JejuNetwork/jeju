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

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256 priceUSD, uint256 decimals);
    function isPriceFresh(address token) external view returns (bool);
    function convertAmount(address fromToken, address toToken, uint256 amount) external view returns (uint256);
}

interface IFeeDistributor {
    function distributeFees(uint256 amount, address appAddress) external;
}

interface IAppTokenPreference {
    struct TokenBalance {
        address token;
        uint256 balance;
    }

    function getBestPaymentToken(address appAddress, address user, TokenBalance[] calldata userBalances)
        external
        view
        returns (address bestToken, string memory reason);

    function hasPreferredToken(address appAddress, address user, address token, uint256 balance)
        external
        view
        returns (bool hasPreferred);

    function getAppPreference(address appAddress)
        external
        view
        returns (
            address appAddr,
            address preferredToken,
            string memory tokenSymbol,
            uint8 tokenDecimals,
            bool allowFallback,
            uint256 minBalance,
            bool isActive,
            address registrant,
            uint256 registrationTime
        );
}

/**
 * @title CrossChainPaymaster
 * @author Jeju Network
 * @notice EIL-compliant paymaster enabling trustless cross-chain transfers AND multi-token gas sponsorship
 * @dev Implements the Ethereum Interop Layer (EIL) protocol for atomic cross-chain swaps
 *      AND enables users to pay gas fees with any XLP-provided token.
 *
 * ## How Cross-Chain Works:
 *
 * 1. User locks tokens on source chain by calling `createVoucherRequest()`
 * 2. XLP (Cross-chain Liquidity Provider) sees the request and issues a voucher
 * 3. Voucher is used on both chains:
 *    - Source: XLP claims user's locked tokens
 *    - Destination: User receives XLP's tokens
 * 4. Atomic swap complete - no trust required
 *
 * ## How Gas Sponsorship Works:
 *
 * 1. XLPs deposit tokens and ETH into this paymaster
 * 2. Users can pay gas with ANY supported token (not just ETH)
 * 3. Paymaster converts token to ETH using oracle prices
 * 4. XLPs earn fees from both cross-chain transfers AND gas sponsorship
 * 5. Users never need to bridge - use whatever token gives best rate
 *
 * ## Security:
 * - XLPs must stake on L1 via L1StakeManager
 * - Failed fulfillments result in XLP stake slashing
 * - Users' funds are safe: either swap completes or they get refund
 * - Oracle price freshness checks prevent stale price exploitation
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

    /// @notice Basis points denominator for percentage calculations
    uint256 public constant BASIS_POINTS = 10000;

    /// @notice Default fee margin for gas sponsorship (10% = 1000 basis points)
    uint256 public constant DEFAULT_FEE_MARGIN = 1000;

    // ============ State Variables ============

    /// @notice L1 stake manager contract address (for stake verification)
    address public immutable l1StakeManager;

    /// @notice Chain ID of this deployment
    uint256 public immutable chainId;

    /// @notice Cross-domain messenger for L1↔L2 communication
    /// @dev On OP Stack L2s, this is 0x4200000000000000000000000000000000000007
    ICrossDomainMessenger public messenger;

    /// @notice Price oracle for token conversions
    IPriceOracle public priceOracle;

    /// @notice Fee distributor for LP rewards
    IFeeDistributor public feeDistributor;

    /// @notice App token preference registry for app-specific payment tokens
    IAppTokenPreference public appTokenPreference;

    /// @notice Fee margin for gas sponsorship (basis points)
    uint256 public feeMargin = DEFAULT_FEE_MARGIN;

    /// @notice Maximum gas cost allowed per transaction
    uint256 public maxGasCost = 0.1 ether;

    /// @notice Mapping of supported tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Token exchange rates cached for gas efficiency: token => tokensPerETH (scaled by 1e18)
    mapping(address => uint256) public tokenExchangeRates;

    /// @notice Last exchange rate update timestamp per token
    mapping(address => uint256) public exchangeRateUpdatedAt;

    /// @notice Voucher request storage: requestId => VoucherRequest
    mapping(bytes32 => VoucherRequest) public voucherRequests;

    /// @notice Voucher storage: voucherId => Voucher
    mapping(bytes32 => Voucher) public vouchers;

    /// @notice XLP liquidity deposits: xlp => token => amount
    mapping(address => mapping(address => uint256)) public xlpDeposits;

    /// @notice XLP ETH deposits for gas sponsorship
    mapping(address => uint256) public xlpETHDeposits;

    /// @notice Total liquidity per token across all XLPs
    mapping(address => uint256) public totalTokenLiquidity;

    /// @notice Total ETH liquidity across all XLPs
    uint256 public totalETHLiquidity;

    /// @notice Active request count per XLP (for stake requirements)
    mapping(address => uint256) public xlpActiveRequests;

    /// @notice Verified XLP stakes (cached from L1)
    mapping(address => uint256) public xlpVerifiedStake;

    /// @notice Request ID to claiming XLP
    mapping(bytes32 => address) public requestClaimedBy;

    /// @notice Track fulfilled voucher hashes to prevent replay attacks
    mapping(bytes32 => bool) public fulfilledVoucherHashes;

    /// @notice Gas sponsorship earnings per XLP (in ETH equivalent)
    mapping(address => uint256) public xlpGasEarnings;

    /// @notice Total gas fees collected (in selected tokens)
    uint256 public totalGasFeesCollected;

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

    /// @notice Gas payment context for 4337 UserOperations
    struct GasPaymentContext {
        address user;
        address paymentToken;
        uint256 maxTokenAmount;
        address appAddress;
        bool useCrossChainLiquidity;
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

    event GasSponsored(
        address indexed user,
        address indexed paymentToken,
        uint256 gasCostETH,
        uint256 tokensCharged,
        address appAddress
    );

    event ExchangeRateUpdated(address indexed token, uint256 newRate, uint256 timestamp);

    event PriceOracleUpdated(address indexed oldOracle, address indexed newOracle);

    event FeeDistributorUpdated(address indexed oldDistributor, address indexed newDistributor);

    event AppTokenPreferenceUpdated(address indexed oldPreference, address indexed newPreference);

    event FeeMarginUpdated(uint256 oldMargin, uint256 newMargin);

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
    error StaleOraclePrice();
    error GasCostTooHigh();
    error InsufficientTokenBalance();
    error InsufficientTokenAllowance();
    error InvalidPaymasterData();
    error InsufficientPoolLiquidity();

    // ============ Constructor ============

    /**
     * @notice Initialize the CrossChainPaymaster
     * @param _entryPoint ERC-4337 EntryPoint address
     * @param _l1StakeManager L1 stake manager address for XLP verification
     * @param _chainId Chain ID of this deployment
     * @param _priceOracle Price oracle for token conversions (can be address(0) initially)
     */
    constructor(IEntryPoint _entryPoint, address _l1StakeManager, uint256 _chainId, address _priceOracle)
        BasePaymaster(_entryPoint)
    {
        require(_l1StakeManager != address(0), "Invalid stake manager");
        l1StakeManager = _l1StakeManager;
        chainId = _chainId;
        // Default OP Stack L2 messenger address
        messenger = ICrossDomainMessenger(0x4200000000000000000000000000000000000007);
        if (_priceOracle != address(0)) {
            priceOracle = IPriceOracle(_priceOracle);
        }
    }

    /**
     * @notice Set the cross-domain messenger address
     * @param _messenger New messenger address
     * @dev Only needed if not using default OP Stack address
     */
    function setMessenger(address _messenger) external onlyOwner {
        messenger = ICrossDomainMessenger(_messenger);
    }

    /**
     * @notice Set the price oracle for token conversions
     * @param _priceOracle New oracle address
     */
    function setPriceOracle(address _priceOracle) external onlyOwner {
        require(_priceOracle != address(0), "Invalid oracle");
        address oldOracle = address(priceOracle);
        priceOracle = IPriceOracle(_priceOracle);
        emit PriceOracleUpdated(oldOracle, _priceOracle);
    }

    /**
     * @notice Set the fee distributor for LP rewards
     * @param _feeDistributor New distributor address
     */
    function setFeeDistributor(address _feeDistributor) external onlyOwner {
        require(_feeDistributor != address(0), "Invalid distributor");
        address oldDistributor = address(feeDistributor);
        feeDistributor = IFeeDistributor(_feeDistributor);
        emit FeeDistributorUpdated(oldDistributor, _feeDistributor);
    }

    /**
     * @notice Set the app token preference registry
     * @param _appTokenPreference New preference registry address
     */
    function setAppTokenPreference(address _appTokenPreference) external onlyOwner {
        address oldPreference = address(appTokenPreference);
        appTokenPreference = IAppTokenPreference(_appTokenPreference);
        emit AppTokenPreferenceUpdated(oldPreference, _appTokenPreference);
    }

    /**
     * @notice Set the fee margin for gas sponsorship
     * @param _feeMargin New margin in basis points (max 2000 = 20%)
     */
    function setFeeMargin(uint256 _feeMargin) external onlyOwner {
        require(_feeMargin <= 2000, "Margin too high");
        uint256 oldMargin = feeMargin;
        feeMargin = _feeMargin;
        emit FeeMarginUpdated(oldMargin, _feeMargin);
    }

    /**
     * @notice Set maximum gas cost per transaction
     * @param _maxGasCost New max gas cost in wei
     */
    function setMaxGasCost(uint256 _maxGasCost) external onlyOwner {
        maxGasCost = _maxGasCost;
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
     * @notice Deposit tokens as XLP liquidity (enables gas payment + cross-chain transfers)
     * @param token Token to deposit
     * @param amount Amount to deposit
     * @dev XLPs earn fees from both cross-chain transfers AND gas sponsorship
     */
    function depositLiquidity(address token, uint256 amount) external nonReentrant {
        if (!supportedTokens[token]) revert UnsupportedToken();
        if (amount == 0) revert InsufficientAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        xlpDeposits[msg.sender][token] += amount;
        totalTokenLiquidity[token] += amount;

        emit XLPDeposit(msg.sender, token, amount);
    }

    /**
     * @notice Deposit ETH for gas sponsorship and cross-chain transfers
     * @dev ETH liquidity is used to sponsor gas for 4337 UserOperations
     *      AND to provide gas on destination chains for cross-chain transfers
     */
    function depositETH() external payable nonReentrant {
        if (msg.value == 0) revert InsufficientAmount();
        xlpETHDeposits[msg.sender] += msg.value;
        totalETHLiquidity += msg.value;

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
        totalTokenLiquidity[token] -= amount;

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
        totalETHLiquidity -= amount;

        // Emit event before external call
        emit XLPWithdraw(msg.sender, address(0), amount);

        // INTERACTIONS: External call last
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Update cached exchange rate for a token
     * @param token Token address
     * @dev Permissionless - anyone can update. Uses oracle price.
     */
    function updateExchangeRate(address token) external {
        require(address(priceOracle) != address(0), "Oracle not set");
        require(supportedTokens[token], "Token not supported");

        uint256 rate = priceOracle.convertAmount(address(0), token, 1 ether);
        tokenExchangeRates[token] = rate;
        exchangeRateUpdatedAt[token] = block.timestamp;

        emit ExchangeRateUpdated(token, rate, block.timestamp);
    }

    /**
     * @notice Batch update exchange rates for all supported tokens
     * @param tokens Array of token addresses to update
     */
    function batchUpdateExchangeRates(address[] calldata tokens) external {
        require(address(priceOracle) != address(0), "Oracle not set");

        for (uint256 i = 0; i < tokens.length; i++) {
            if (supportedTokens[tokens[i]]) {
                uint256 rate = priceOracle.convertAmount(address(0), tokens[i], 1 ether);
                tokenExchangeRates[tokens[i]] = rate;
                exchangeRateUpdatedAt[tokens[i]] = block.timestamp;
                emit ExchangeRateUpdated(tokens[i], rate, block.timestamp);
            }
        }
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
     * @notice Validate UserOp with multi-token gas payment support
     * @dev Supports two modes:
     *      1. Cross-chain voucher mode (legacy): User pays via voucher
     *      2. Token payment mode (new): User pays gas with any supported token
     *
     * paymasterAndData format for token payment:
     * [paymaster(20)][verificationGas(16)][postOpGas(16)][mode(1)][token(20)][appAddress(20)]
     *
     * paymasterAndData format for voucher mode (legacy):
     * [paymaster(20)][verificationGas(16)][postOpGas(16)][voucherId(32)][xlp(20)]
     */
    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, /*userOpHash*/ uint256 maxCost)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        // Check gas cost limit
        if (maxCost > maxGasCost) revert GasCostTooHigh();

        // Minimum data: paymaster(20) + verificationGas(16) + postOpGas(16) + mode(1) = 53 bytes
        if (userOp.paymasterAndData.length < 53) {
            return ("", 1); // Invalid
        }

        // Parse mode byte (position 52)
        uint8 mode = uint8(userOp.paymasterAndData[52]);

        if (mode == 0) {
            // Token payment mode: [mode(1)][token(20)][appAddress(20)]
            return _validateTokenPayment(userOp, maxCost);
        } else if (mode == 1) {
            // Legacy voucher mode: [mode(1)][voucherId(32)][xlp(20)]
            return _validateVoucherPayment(userOp, maxCost);
        }

        return ("", 1); // Invalid mode
    }

    /**
     * @notice Validate token payment for gas sponsorship
     * @dev User pays gas with any supported token. XLP pool provides ETH.
     */
    function _validateTokenPayment(PackedUserOperation calldata userOp, uint256 maxCost)
        internal
        view
        returns (bytes memory context, uint256 validationData)
    {
        // Format: [mode(1)][token(20)][appAddress(20)] starting at position 52
        if (userOp.paymasterAndData.length < 93) {
            return ("", 1);
        }

        address paymentToken = address(bytes20(userOp.paymasterAndData[53:73]));
        address appAddress = address(bytes20(userOp.paymasterAndData[73:93]));

        // Verify token is supported
        if (!supportedTokens[paymentToken]) {
            return ("", 1);
        }

        // Check oracle freshness if oracle is set
        if (address(priceOracle) != address(0) && !priceOracle.isPriceFresh(paymentToken)) {
            return ("", 1);
        }

        // Calculate token cost with fee margin
        uint256 maxTokenAmount = _calculateTokenCost(maxCost, paymentToken);

        // Verify user has sufficient balance and allowance
        address sender = userOp.sender;
        uint256 userBalance = IERC20(paymentToken).balanceOf(sender);
        if (userBalance < maxTokenAmount) {
            return ("", 1);
        }

        uint256 userAllowance = IERC20(paymentToken).allowance(sender, address(this));
        if (userAllowance < maxTokenAmount) {
            return ("", 1);
        }

        // Verify pool has enough ETH liquidity to sponsor gas
        // Use totalETHLiquidity as the available pool
        uint256 entryPointDeposit = entryPoint.balanceOf(address(this));
        if (entryPointDeposit < maxCost) {
            return ("", 1);
        }

        context = abi.encode(
            GasPaymentContext({
                user: sender,
                paymentToken: paymentToken,
                maxTokenAmount: maxTokenAmount,
                appAddress: appAddress,
                useCrossChainLiquidity: true
            })
        );

        return (context, 0);
    }

    /**
     * @notice Validate legacy voucher-based payment
     * @dev For cross-chain transfer operations
     */
    function _validateVoucherPayment(PackedUserOperation calldata userOp, uint256 maxCost)
        internal
        view
        returns (bytes memory context, uint256 validationData)
    {
        // Format: [mode(1)][voucherId(32)][xlp(20)] starting at position 52
        if (userOp.paymasterAndData.length < 105) {
            return ("", 1);
        }

        bytes32 voucherId = bytes32(userOp.paymasterAndData[53:85]);
        address xlp = address(bytes20(userOp.paymasterAndData[85:105]));

        // Verify XLP has enough ETH to cover gas
        if (xlpETHDeposits[xlp] < maxCost) {
            return ("", 1);
        }

        // Legacy context format
        context = abi.encode(voucherId, xlp, maxCost, uint8(1)); // mode=1 for voucher
        return (context, 0);
    }

    /**
     * @notice Post-operation callback - collect tokens and distribute fees
     * @dev Handles both token payment and voucher modes
     */
    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256 /*actualUserOpFeePerGas*/ )
        internal
        override
    {
        // Check if this is legacy voucher mode (shorter context)
        if (context.length <= 128) {
            // Try legacy decode
            (bytes32 voucherId, address xlp, /* unused maxCost */, uint8 paymentMode) =
                abi.decode(context, (bytes32, address, uint256, uint8));

            if (paymentMode == 1) {
                _handleVoucherPostOp(mode, voucherId, xlp, actualGasCost);
                return;
            }
        }

        // Token payment mode
        GasPaymentContext memory ctx = abi.decode(context, (GasPaymentContext));
        _handleTokenPaymentPostOp(mode, ctx, actualGasCost);
    }

    /**
     * @notice Handle post-op for token payment mode
     */
    function _handleTokenPaymentPostOp(PostOpMode mode, GasPaymentContext memory ctx, uint256 actualGasCost) internal {
        // Only charge if operation succeeded or reverted (not on postOp revert)
        if (mode == PostOpMode.opSucceeded || mode == PostOpMode.opReverted) {
            // Calculate actual token cost
            uint256 actualTokenCost = _calculateTokenCost(actualGasCost, ctx.paymentToken);

            // Cap at max to prevent overcharging
            if (actualTokenCost > ctx.maxTokenAmount) {
                actualTokenCost = ctx.maxTokenAmount;
            }

            // Collect tokens from user
            IERC20(ctx.paymentToken).safeTransferFrom(ctx.user, address(this), actualTokenCost);

            // Update totals
            totalGasFeesCollected += actualTokenCost;
            totalTokenLiquidity[ctx.paymentToken] += actualTokenCost;

            // Distribute fees if distributor is set
            if (address(feeDistributor) != address(0) && ctx.appAddress != address(0)) {
                IERC20(ctx.paymentToken).forceApprove(address(feeDistributor), actualTokenCost);
                feeDistributor.distributeFees(actualTokenCost, ctx.appAddress);
            }

            emit GasSponsored(ctx.user, ctx.paymentToken, actualGasCost, actualTokenCost, ctx.appAddress);
        }
    }

    /**
     * @notice Handle post-op for legacy voucher mode
     */
    function _handleVoucherPostOp(PostOpMode mode, bytes32 voucherId, address xlp, uint256 actualGasCost) internal {
        // Always deduct gas cost from XLP (they pay for gas even on revert)
        if (xlpETHDeposits[xlp] >= actualGasCost) {
            xlpETHDeposits[xlp] -= actualGasCost;
            totalETHLiquidity -= actualGasCost;
        }

        // Only mark as fulfilled if operation succeeded
        if (mode == PostOpMode.opSucceeded && voucherId != bytes32(0)) {
            vouchers[voucherId].fulfilled = true;
        }
    }

    /**
     * @notice Calculate token amount needed for gas cost
     * @param gasCostETH Gas cost in ETH (wei)
     * @param token Payment token address
     * @return tokenAmount Amount of tokens needed
     */
    function _calculateTokenCost(uint256 gasCostETH, address token) internal view returns (uint256 tokenAmount) {
        // Use cached exchange rate if fresh (< 1 hour old)
        if (exchangeRateUpdatedAt[token] > block.timestamp - 1 hours && tokenExchangeRates[token] > 0) {
            tokenAmount = (gasCostETH * tokenExchangeRates[token]) / 1 ether;
        } else if (address(priceOracle) != address(0)) {
            // Fall back to oracle
            tokenAmount = priceOracle.convertAmount(address(0), token, gasCostETH);
        } else {
            // Default 1:1 if no oracle
            tokenAmount = gasCostETH;
        }

        // Add fee margin
        tokenAmount = (tokenAmount * (BASIS_POINTS + feeMargin)) / BASIS_POINTS;
    }

    /**
     * @notice Preview token cost for a given gas estimate
     * @param estimatedGas Estimated gas units
     * @param gasPrice Gas price in wei
     * @param token Payment token address
     * @return tokenCost Estimated token cost
     */
    function previewTokenCost(uint256 estimatedGas, uint256 gasPrice, address token)
        external
        view
        returns (uint256 tokenCost)
    {
        uint256 gasCostETH = estimatedGas * gasPrice;
        return _calculateTokenCost(gasCostETH, token);
    }

    /**
     * @notice Get the best token option for gas payment based on user balances
     * @param user User address
     * @param gasCostETH Gas cost in ETH
     * @param tokens Array of tokens to check
     * @return bestToken Best token to use
     * @return tokenCost Cost in that token
     */
    function getBestGasToken(address user, uint256 gasCostETH, address[] calldata tokens)
        external
        view
        returns (address bestToken, uint256 tokenCost)
    {
        uint256 lowestUsdCost = type(uint256).max;

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            if (!supportedTokens[token]) continue;

            uint256 cost = _calculateTokenCost(gasCostETH, token);
            uint256 userBalance = IERC20(token).balanceOf(user);

            if (userBalance < cost) continue;

            // Get USD value of cost
            uint256 usdCost = cost;
            if (address(priceOracle) != address(0)) {
                // slither-disable-next-line unused-return
                (uint256 price,) = priceOracle.getPrice(token);
                usdCost = (cost * price) / 1e18;
            }

            if (usdCost < lowestUsdCost) {
                lowestUsdCost = usdCost;
                bestToken = token;
                tokenCost = cost;
            }
        }
    }

    /**
     * @notice Get the best payment token for a user considering app preferences
     * @dev Priority order:
     *      1. App's preferred token (if user has it with sufficient balance)
     *      2. App's fallback tokens (in priority order)
     *      3. Cheapest token from user's wallet with XLP liquidity
     * @param appAddress The app requesting payment
     * @param user User's address
     * @param gasCostETH Gas cost in ETH
     * @param tokens Array of tokens user has
     * @param balances Array of balances corresponding to tokens
     * @return bestToken Best token to use
     * @return tokenCost Cost in that token
     * @return reason Why this token was selected
     */
    function getBestPaymentTokenForApp(
        address appAddress,
        address user,
        uint256 gasCostETH,
        address[] calldata tokens,
        uint256[] calldata balances
    ) external view returns (address bestToken, uint256 tokenCost, string memory reason) {
        require(tokens.length == balances.length, "Arrays must match");

        // Check app token preference first
        if (address(appTokenPreference) != address(0) && appAddress != address(0)) {
            // Build token balance array for preference check
            IAppTokenPreference.TokenBalance[] memory tokenBalances = new IAppTokenPreference.TokenBalance[](tokens.length);
            for (uint256 i = 0; i < tokens.length; i++) {
                tokenBalances[i] = IAppTokenPreference.TokenBalance({token: tokens[i], balance: balances[i]});
            }

            (address preferredToken, string memory preferenceReason) =
                appTokenPreference.getBestPaymentToken(appAddress, user, tokenBalances);

            // If we got a preferred token and it's supported, use it
            if (preferredToken != address(0) && supportedTokens[preferredToken]) {
                uint256 cost = _calculateTokenCost(gasCostETH, preferredToken);

                // Find user's balance for this token
                for (uint256 i = 0; i < tokens.length; i++) {
                    if (tokens[i] == preferredToken && balances[i] >= cost) {
                        return (preferredToken, cost, preferenceReason);
                    }
                }
            }
        }

        // Fall back to cheapest available token
        uint256 lowestUsdCost = type(uint256).max;

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            if (!supportedTokens[token]) continue;

            uint256 cost = _calculateTokenCost(gasCostETH, token);
            if (balances[i] < cost) continue;

            // Get USD value of cost
            uint256 usdCost = cost;
            if (address(priceOracle) != address(0)) {
                // slither-disable-next-line unused-return
                (uint256 price,) = priceOracle.getPrice(token);
                usdCost = (cost * price) / 1e18;
            }

            if (usdCost < lowestUsdCost) {
                lowestUsdCost = usdCost;
                bestToken = token;
                tokenCost = cost;
                reason = "Cheapest available token";
            }
        }

        if (bestToken == address(0)) {
            reason = "No suitable token found";
        }
    }

    /**
     * @notice Check if user has app's preferred token
     * @param appAddress The app's address
     * @param user User's address
     * @param token Token to check
     * @param balance User's balance
     * @return hasPreferred Whether user has the preferred token
     * @return preferredToken The app's preferred token (if set)
     */
    function checkAppPreference(address appAddress, address user, address token, uint256 balance)
        external
        view
        returns (bool hasPreferred, address preferredToken)
    {
        if (address(appTokenPreference) == address(0)) {
            return (false, address(0));
        }

        hasPreferred = appTokenPreference.hasPreferredToken(appAddress, user, token, balance);

        // Get the preferred token - we only need the preferredToken field
        // slither-disable-next-line unused-return
        (,address prefToken,,,,,,,) = appTokenPreference.getAppPreference(appAddress);
        preferredToken = prefToken;
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

    /**
     * @notice Get total liquidity for a token across all XLPs
     * @param token Token address (address(0) for ETH)
     * @return liquidity Total liquidity
     */
    function getTotalLiquidity(address token) external view returns (uint256) {
        if (token == address(0)) {
            return totalETHLiquidity;
        }
        return totalTokenLiquidity[token];
    }

    /**
     * @notice Get all supported tokens
     * @param tokens Array of token addresses to check
     * @return supported Array of booleans indicating support
     * @return rates Array of exchange rates (tokens per ETH)
     */
    function getTokensInfo(address[] calldata tokens)
        external
        view
        returns (bool[] memory supported, uint256[] memory rates)
    {
        supported = new bool[](tokens.length);
        rates = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            supported[i] = supportedTokens[tokens[i]];
            rates[i] = tokenExchangeRates[tokens[i]];
        }
    }

    /**
     * @notice Check if paymaster can sponsor a transaction
     * @param gasCost Estimated gas cost in ETH
     * @param paymentToken Token user will pay with
     * @param userAddress User's address
     * @return canSponsorTx Whether sponsorship is possible
     * @return tokenCost Cost in payment token
     * @return userBal User's balance of payment token
     */
    function canSponsor(uint256 gasCost, address paymentToken, address userAddress)
        external
        view
        returns (bool canSponsorTx, uint256 tokenCost, uint256 userBal)
    {
        if (!supportedTokens[paymentToken]) {
            return (false, 0, 0);
        }

        tokenCost = _calculateTokenCost(gasCost, paymentToken);
        userBal = IERC20(paymentToken).balanceOf(userAddress);
        uint256 userAllowance = IERC20(paymentToken).allowance(userAddress, address(this));
        uint256 entryPointBalance = entryPoint.balanceOf(address(this));

        canSponsorTx = userBal >= tokenCost && userAllowance >= tokenCost && entryPointBalance >= gasCost;
    }

    /**
     * @notice Get paymaster status for dashboard display
     * @return ethLiquidity Total ETH in pool
     * @return entryPointBalance ETH deposited in EntryPoint
     * @return supportedTokenCount Number of supported tokens
     * @return totalGasFees Total gas fees collected
     * @return oracleSet Whether price oracle is configured
     */
    function getPaymasterStatus()
        external
        view
        returns (
            uint256 ethLiquidity,
            uint256 entryPointBalance,
            uint256 supportedTokenCount,
            uint256 totalGasFees,
            bool oracleSet
        )
    {
        ethLiquidity = totalETHLiquidity;
        entryPointBalance = entryPoint.balanceOf(address(this));
        supportedTokenCount = 0; // Requires off-chain enumeration
        totalGasFees = totalGasFeesCollected;
        oracleSet = address(priceOracle) != address(0);
    }

    // ============ EntryPoint Funding ============

    /**
     * @notice Deposit ETH to EntryPoint for gas sponsorship
     * @dev Called by owner or XLPs to fund gas sponsorship
     */
    function fundEntryPoint() external payable onlyOwner {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    /**
     * @notice Auto-fund EntryPoint from XLP ETH pool
     * @param amount Amount to transfer from pool to EntryPoint
     */
    function refillEntryPoint(uint256 amount) external onlyOwner {
        require(totalETHLiquidity >= amount, "Insufficient pool liquidity");
        // Note: This uses aggregate pool, not individual XLP balance
        // In production, implement pro-rata tracking
        entryPoint.depositTo{value: amount}(address(this));
    }

    // ============ Receive ETH ============

    receive() external payable {
        // Accept ETH for deposits and EntryPoint refunds
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
