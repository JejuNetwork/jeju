// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IStakeManager} from "account-abstraction/interfaces/IStakeManager.sol";
import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {OwnableUpgradeable} from "openzeppelin-contracts-upgradeable/contracts/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "openzeppelin-contracts-upgradeable/contracts/utils/PausableUpgradeable.sol";
import {Initializable} from "openzeppelin-contracts-upgradeable/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "openzeppelin-contracts-upgradeable/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ERC1967Utils} from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";

/**
 * @title CrossChainPaymasterUpgradeable
 * @notice Upgradeable version of CrossChainPaymaster for EIL cross-chain transfers
 * @dev Uses UUPS proxy pattern for upgradeability
 *
 * This contract enables:
 * 1. Cross-chain token transfers via XLP liquidity
 * 2. Multi-token gas payment
 * 3. Atomic swaps without bridges
 */
contract CrossChainPaymasterUpgradeable is Initializable, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuard, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant REQUEST_TIMEOUT = 50;
    uint256 public constant VOUCHER_TIMEOUT = 100;
    uint256 public constant MIN_XLP_STAKE = 1 ether;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_RATE = 100; // 1%

    // ============ State ============

    /// @notice L1 chain ID
    uint256 public l1ChainId;

    /// @notice L1 stake manager address
    address public l1StakeManager;

    /// @notice Entry point for ERC-4337
    IEntryPoint public entryPoint;

    /// @notice Supported tokens for payment
    mapping(address => bool) public supportedTokens;

    /// @notice XLP stakes (synced from L1)
    mapping(address => uint256) public xlpStakes;

    /// @notice XLP liquidity deposits
    mapping(address => mapping(address => uint256)) public xlpLiquidity; // xlp => token => amount

    /// @notice ETH deposits
    mapping(address => uint256) public xlpEthBalance;

    /// @notice Voucher requests
    mapping(bytes32 => VoucherRequest) public requests;

    /// @notice Issued vouchers
    mapping(bytes32 => Voucher) public vouchers;

    /// @notice Fee rate in basis points
    uint256 public feeRate;

    /// @notice L2 CrossDomainMessenger
    address public l2Messenger;

    /// @notice Price oracle for multi-token gas conversion
    IPriceOracle public priceOracle;

    /// @notice Cached token exchange rates (token => rate in ETH per 1 token, 18 decimals)
    mapping(address => uint256) public tokenExchangeRates;

    /// @notice Last time exchange rate was updated
    mapping(address => uint256) public exchangeRateUpdatedAt;

    /// @notice Exchange rate cache duration (1 hour)
    uint256 public constant RATE_CACHE_DURATION = 1 hours;

    // ============ Structs ============

    struct VoucherRequest {
        address requester;
        address sourceToken;
        uint256 amount;
        uint256 destinationChain;
        address destinationToken;
        address recipient;
        uint256 maxFee;
        uint256 deadline;
        bool claimed;
        bool expired;
        bool refunded;
    }

    struct Voucher {
        bytes32 requestId;
        address xlp;
        uint256 issuedBlock;
        bool fulfilled;
        bool expired;
    }

    // ============ Events ============

    event VoucherRequestCreated(
        bytes32 indexed requestId,
        address indexed requester,
        address sourceToken,
        uint256 amount,
        uint256 destinationChain
    );

    event VoucherIssued(bytes32 indexed voucherId, bytes32 indexed requestId, address indexed xlp);

    event VoucherFulfilled(bytes32 indexed voucherId, address indexed recipient, uint256 amount);

    event XLPStakeUpdated(address indexed xlp, uint256 stake);
    event LiquidityDeposited(address indexed xlp, address indexed token, uint256 amount);
    event LiquidityWithdrawn(address indexed xlp, address indexed token, uint256 amount);
    event TokenSupported(address indexed token, bool supported);
    event PriceOracleUpdated(address indexed oldOracle, address indexed newOracle);
    event ExchangeRateUpdated(address indexed token, uint256 rate);
    event TokenPaymentReceived(address indexed user, address indexed token, uint256 tokenAmount, uint256 ethEquivalent);

    // ============ Errors ============

    error InsufficientLiquidity();
    error InvalidRequest();
    error RequestExpired();
    error AlreadyClaimed();
    error NotXLP();
    error InvalidToken();
    error InvalidAmount();
    error OnlyL1StakeManager();
    error MessengerNotSet();
    error StalePrice();
    error OracleNotSet();

    // ============ Modifiers ============

    /// @notice Only allows calls from L1StakeManager via the cross-domain messenger
    modifier onlyL1StakeManager() {
        if (l2Messenger == address(0)) revert MessengerNotSet();
        if (msg.sender != l2Messenger) revert OnlyL1StakeManager();
        // Check xDomainMessageSender() is the L1StakeManager
        (bool success, bytes memory data) = l2Messenger.staticcall(
            abi.encodeWithSignature("xDomainMessageSender()")
        );
        if (!success || data.length != 32) revert OnlyL1StakeManager();
        address sender = abi.decode(data, (address));
        if (sender != l1StakeManager) revert OnlyL1StakeManager();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner, uint256 _l1ChainId, address _l1StakeManager, address _entryPoint)
        public
        initializer
    {
        __Ownable_init(owner);
        __Pausable_init();

        l1ChainId = _l1ChainId;
        l1StakeManager = _l1StakeManager;
        entryPoint = IEntryPoint(_entryPoint);
        feeRate = 30; // 0.3%

        // Support native ETH (address(0))
        supportedTokens[address(0)] = true;
    }

    /// @notice Pause the contract in case of emergency
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ XLP Functions ============

    /**
     * @notice Deposit ETH liquidity
     */
    function depositETH() external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();
        xlpEthBalance[msg.sender] += msg.value;
        emit LiquidityDeposited(msg.sender, address(0), msg.value);
    }

    /**
     * @notice Deposit token liquidity
     */
    function depositLiquidity(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (!supportedTokens[token]) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        xlpLiquidity[msg.sender][token] += amount;

        emit LiquidityDeposited(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw ETH liquidity
     */
    function withdrawETH(uint256 amount) external nonReentrant {
        if (amount > xlpEthBalance[msg.sender]) revert InsufficientLiquidity();

        xlpEthBalance[msg.sender] -= amount;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit LiquidityWithdrawn(msg.sender, address(0), amount);
    }

    /**
     * @notice Withdraw token liquidity
     */
    function withdrawLiquidity(address token, uint256 amount) external nonReentrant {
        if (amount > xlpLiquidity[msg.sender][token]) revert InsufficientLiquidity();

        xlpLiquidity[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, token, amount);
    }

    // ============ Cross-Chain Functions ============

    /**
     * @notice Create a voucher request for cross-chain transfer
     */
    function createVoucherRequest(
        address sourceToken,
        uint256 amount,
        uint256 destinationChain,
        address destinationToken,
        address recipient,
        uint256 maxFee
    ) external nonReentrant returns (bytes32 requestId) {
        if (amount == 0) revert InvalidAmount();

        // Lock tokens
        if (sourceToken == address(0)) {
            // ETH - must be sent with call
            revert("Use createVoucherRequestETH for ETH");
        } else {
            IERC20(sourceToken).safeTransferFrom(msg.sender, address(this), amount);
        }

        requestId = keccak256(
            abi.encodePacked(msg.sender, sourceToken, amount, destinationChain, block.number, block.timestamp)
        );

        requests[requestId] = VoucherRequest({
            requester: msg.sender,
            sourceToken: sourceToken,
            amount: amount,
            destinationChain: destinationChain,
            destinationToken: destinationToken,
            recipient: recipient,
            maxFee: maxFee,
            deadline: block.number + REQUEST_TIMEOUT,
            claimed: false,
            expired: false,
            refunded: false
        });

        emit VoucherRequestCreated(requestId, msg.sender, sourceToken, amount, destinationChain);
    }

    /**
     * @notice Create a voucher request for ETH transfer
     */
    function createVoucherRequestETH(
        uint256 destinationChain,
        address destinationToken,
        address recipient,
        uint256 maxFee
    ) external payable nonReentrant returns (bytes32 requestId) {
        if (msg.value == 0) revert InvalidAmount();

        requestId = keccak256(
            abi.encodePacked(msg.sender, address(0), msg.value, destinationChain, block.number, block.timestamp)
        );

        requests[requestId] = VoucherRequest({
            requester: msg.sender,
            sourceToken: address(0),
            amount: msg.value,
            destinationChain: destinationChain,
            destinationToken: destinationToken,
            recipient: recipient,
            maxFee: maxFee,
            deadline: block.number + REQUEST_TIMEOUT,
            claimed: false,
            expired: false,
            refunded: false
        });

        emit VoucherRequestCreated(requestId, msg.sender, address(0), msg.value, destinationChain);
    }

    /**
     * @notice XLP claims a voucher request and issues a voucher
     */
    function issueVoucher(bytes32 requestId) external nonReentrant returns (bytes32 voucherId) {
        VoucherRequest storage request = requests[requestId];

        if (request.requester == address(0)) revert InvalidRequest();
        if (request.claimed) revert AlreadyClaimed();
        if (block.number > request.deadline) revert RequestExpired();
        if (xlpStakes[msg.sender] < MIN_XLP_STAKE) revert NotXLP();

        request.claimed = true;

        voucherId = keccak256(abi.encodePacked(requestId, msg.sender, block.number));

        vouchers[voucherId] = Voucher({
            requestId: requestId,
            xlp: msg.sender,
            issuedBlock: block.number,
            fulfilled: false,
            expired: false
        });

        // Transfer locked tokens to XLP
        if (request.sourceToken == address(0)) {
            (bool success,) = msg.sender.call{value: request.amount}("");
            require(success, "Transfer failed");
        } else {
            IERC20(request.sourceToken).safeTransfer(msg.sender, request.amount);
        }

        emit VoucherIssued(voucherId, requestId, msg.sender);
    }

    /**
     * @notice Fulfill a voucher on destination chain
     */
    function fulfillVoucher(bytes32 voucherId, address recipient) external nonReentrant {
        Voucher storage voucher = vouchers[voucherId];
        VoucherRequest storage request = requests[voucher.requestId];

        if (voucher.xlp != msg.sender) revert NotXLP();
        if (voucher.fulfilled) revert AlreadyClaimed();
        if (block.number > voucher.issuedBlock + VOUCHER_TIMEOUT) revert RequestExpired();

        voucher.fulfilled = true;

        // Calculate fee
        uint256 fee = (request.amount * feeRate) / FEE_DENOMINATOR;
        uint256 amountAfterFee = request.amount - fee;

        // Transfer from XLP liquidity to recipient
        if (request.destinationToken == address(0)) {
            if (xlpEthBalance[msg.sender] < amountAfterFee) revert InsufficientLiquidity();
            xlpEthBalance[msg.sender] -= amountAfterFee;
            (bool success,) = recipient.call{value: amountAfterFee}("");
            require(success, "Transfer failed");
        } else {
            if (xlpLiquidity[msg.sender][request.destinationToken] < amountAfterFee) {
                revert InsufficientLiquidity();
            }
            xlpLiquidity[msg.sender][request.destinationToken] -= amountAfterFee;
            IERC20(request.destinationToken).safeTransfer(recipient, amountAfterFee);
        }

        emit VoucherFulfilled(voucherId, recipient, amountAfterFee);
    }

    // ============ Cross-Chain Stake Sync ============

    /// @notice Updates XLP stake - can only be called via L1 cross-chain message
    /// @dev Called by L1StakeManager.syncStakeToL2() via the CrossDomainMessenger
    function updateXLPStake(address xlp, uint256 stake) external onlyL1StakeManager {
        xlpStakes[xlp] = stake;
        emit XLPStakeUpdated(xlp, stake);
    }

    // ============ Admin Functions ============

    /// @notice Set the L2 messenger address
    function setL2Messenger(address _messenger) external onlyOwner {
        l2Messenger = _messenger;
    }

    /// @notice Emergency stake update by owner (only for initial setup/migration)
    function adminSetXLPStake(address xlp, uint256 stake) external onlyOwner {
        xlpStakes[xlp] = stake;
        emit XLPStakeUpdated(xlp, stake);
    }

    function setSupportedToken(address token, bool supported) external onlyOwner {
        supportedTokens[token] = supported;
        emit TokenSupported(token, supported);
    }

    function setFeeRate(uint256 _feeRate) external onlyOwner {
        require(_feeRate <= MAX_FEE_RATE, "Fee too high");
        feeRate = _feeRate;
    }

    /// @notice Set the price oracle for multi-token gas conversion
    /// @param _priceOracle Address of the price oracle
    function setPriceOracle(address _priceOracle) external onlyOwner {
        address oldOracle = address(priceOracle);
        priceOracle = IPriceOracle(_priceOracle);
        emit PriceOracleUpdated(oldOracle, _priceOracle);
    }

    /// @notice Update cached exchange rate for a token
    /// @param token Token address
    function updateExchangeRate(address token) public {
        if (address(priceOracle) == address(0)) revert OracleNotSet();
        if (!priceOracle.isPriceFresh(token)) revert StalePrice();
        
        // Get how many tokens equal 1 ETH
        uint256 rate = priceOracle.convertAmount(address(0), token, 1 ether);
        tokenExchangeRates[token] = rate;
        exchangeRateUpdatedAt[token] = block.timestamp;
        
        emit ExchangeRateUpdated(token, rate);
    }

    /// @notice Convert ETH amount to token amount
    /// @param ethAmount Amount in ETH
    /// @param token Token to convert to
    /// @return tokenAmount Equivalent token amount
    function convertEthToToken(uint256 ethAmount, address token) public view returns (uint256 tokenAmount) {
        if (token == address(0)) return ethAmount; // ETH -> ETH
        
        // Try cached rate first (valid for 1 hour)
        // Safe math: check if rate was updated within cache duration
        uint256 rateAge = block.timestamp > exchangeRateUpdatedAt[token] 
            ? block.timestamp - exchangeRateUpdatedAt[token] 
            : 0;
        if (rateAge < RATE_CACHE_DURATION && tokenExchangeRates[token] > 0) {
            return (ethAmount * tokenExchangeRates[token]) / 1 ether;
        }
        
        // Fall back to oracle
        if (address(priceOracle) != address(0)) {
            return priceOracle.convertAmount(address(0), token, ethAmount);
        }
        
        // Default 1:1 if no oracle
        return ethAmount;
    }

    /// @notice Convert token amount to ETH equivalent
    /// @param tokenAmount Amount in token
    /// @param token Token address
    /// @return ethAmount Equivalent ETH amount
    function convertTokenToEth(uint256 tokenAmount, address token) public view returns (uint256 ethAmount) {
        if (token == address(0)) return tokenAmount; // ETH -> ETH
        
        // Try cached rate first (safe math for age calculation)
        uint256 rateAge = block.timestamp > exchangeRateUpdatedAt[token] 
            ? block.timestamp - exchangeRateUpdatedAt[token] 
            : 0;
        if (rateAge < RATE_CACHE_DURATION && tokenExchangeRates[token] > 0) {
            return (tokenAmount * 1 ether) / tokenExchangeRates[token];
        }
        
        // Fall back to oracle
        if (address(priceOracle) != address(0)) {
            return priceOracle.convertAmount(token, address(0), tokenAmount);
        }
        
        // Default 1:1 if no oracle
        return tokenAmount;
    }

    // ============ ERC-4337 Paymaster Interface ============

    /// @notice Validates a UserOperation for gas sponsorship
    /// @dev XLPs with sufficient stake can sponsor UserOperations
    /// @param userOp The packed user operation
    /// @param userOpHash Hash of the user operation
    /// @param maxCost Maximum cost the paymaster must cover
    /// @return context Data to pass to postOp
    /// @return validationData 0 for success, 1 for failure, or packed sigFailed|validUntil|validAfter
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external whenNotPaused returns (bytes memory context, uint256 validationData) {
        // Only EntryPoint can call this
        require(msg.sender == address(entryPoint), "Only EntryPoint");

        // Decode paymasterAndData: 
        // [0:20] paymaster address
        // [20:36] paymasterVerificationGasLimit (16 bytes)
        // [36:52] paymasterPostOpGasLimit (16 bytes)
        // [52:72] XLP address (20 bytes)
        // [72:92] payment token (optional, address(0) = ETH)
        if (userOp.paymasterAndData.length < 72) {
            return ("", 1);
        }

        address xlp = address(bytes20(userOp.paymasterAndData[52:72]));
        
        // Extract payment token (optional - defaults to ETH)
        address paymentToken = address(0);
        if (userOp.paymasterAndData.length >= 92) {
            paymentToken = address(bytes20(userOp.paymasterAndData[72:92]));
        }

        // Check XLP has sufficient stake
        if (xlpStakes[xlp] < MIN_XLP_STAKE) {
            return ("", 1);
        }

        // Handle payment based on token type
        if (paymentToken == address(0)) {
            // ETH payment - simple case
            if (xlpEthBalance[xlp] < maxCost) {
                return ("", 1);
            }
            xlpEthBalance[xlp] -= maxCost;
            context = abi.encode(xlp, maxCost, userOp.sender, paymentToken, maxCost);
        } else {
            // Token payment - convert maxCost (ETH) to token amount
            if (!supportedTokens[paymentToken]) {
                return ("", 1);
            }
            
            uint256 tokenAmount = convertEthToToken(maxCost, paymentToken);
            
            // Check XLP has sufficient token liquidity
            if (xlpLiquidity[xlp][paymentToken] < tokenAmount) {
                return ("", 1);
            }
            
            // Deduct token from XLP
            xlpLiquidity[xlp][paymentToken] -= tokenAmount;
            
            context = abi.encode(xlp, maxCost, userOp.sender, paymentToken, tokenAmount);
        }

        return (context, 0);
    }

    /// @notice Post-operation hook called by EntryPoint
    /// @dev Refunds excess gas to XLP in the payment token
    /// @param mode 0=success, 1=revert in account, 2=revert in postOp
    /// @param context Data from validatePaymasterUserOp: (xlp, maxCostEth, sender, paymentToken, tokenAmount)
    /// @param actualGasCost Actual gas used in ETH
    /// @param actualUserOpFeePerGas Actual fee per gas
    function postOp(
        IPaymaster.PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external {
        require(msg.sender == address(entryPoint), "Only EntryPoint");

        (address xlp, uint256 maxCostEth, , address paymentToken, uint256 tokenAmountReserved) = 
            abi.decode(context, (address, uint256, address, address, uint256));

        if (paymentToken == address(0)) {
            // ETH payment - refund unused ETH
            uint256 refund = maxCostEth > actualGasCost ? maxCostEth - actualGasCost : 0;
            if (refund > 0) {
                xlpEthBalance[xlp] += refund;
            }
        } else {
            // Token payment - calculate actual token cost and refund excess
            uint256 actualTokenCost = convertEthToToken(actualGasCost, paymentToken);
            uint256 refund = tokenAmountReserved > actualTokenCost ? tokenAmountReserved - actualTokenCost : 0;
            if (refund > 0) {
                xlpLiquidity[xlp][paymentToken] += refund;
            }
        }
    }

    /// @notice Deposit ETH to EntryPoint for gas
    function depositToEntryPoint() external payable onlyOwner {
        IStakeManager(address(entryPoint)).depositTo{value: msg.value}(address(this));
    }

    /// @notice Get paymaster deposit on EntryPoint
    function getEntryPointDeposit() external view returns (uint256) {
        return IStakeManager(address(entryPoint)).balanceOf(address(this));
    }

    // ============ View Functions ============

    function getXLPLiquidity(address xlp, address token) external view returns (uint256) {
        if (token == address(0)) {
            return xlpEthBalance[xlp];
        }
        return xlpLiquidity[xlp][token];
    }

    function getRequest(bytes32 requestId) external view returns (VoucherRequest memory) {
        return requests[requestId];
    }

    function getVoucher(bytes32 voucherId) external view returns (Voucher memory) {
        return vouchers[voucherId];
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function getImplementation() external view returns (address) {
        return ERC1967Utils.getImplementation();
    }

    // ============ Receive ETH ============

    receive() external payable {}

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;
}
