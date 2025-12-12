// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

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
contract CrossChainPaymasterUpgradeable is Initializable, OwnableUpgradeable, ReentrancyGuard, UUPSUpgradeable {
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

    // ============ Errors ============

    error InsufficientLiquidity();
    error InvalidRequest();
    error RequestExpired();
    error AlreadyClaimed();
    error NotXLP();
    error InvalidToken();
    error InvalidAmount();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner, uint256 _l1ChainId, address _l1StakeManager, address _entryPoint)
        public
        initializer
    {
        __Ownable_init();
        _transferOwnership(owner);

        l1ChainId = _l1ChainId;
        l1StakeManager = _l1StakeManager;
        entryPoint = IEntryPoint(_entryPoint);
        feeRate = 30; // 0.3%

        // Support native ETH (address(0))
        supportedTokens[address(0)] = true;
    }

    // ============ XLP Functions ============

    /**
     * @notice Deposit ETH liquidity
     */
    function depositETH() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        xlpEthBalance[msg.sender] += msg.value;
        emit LiquidityDeposited(msg.sender, address(0), msg.value);
    }

    /**
     * @notice Deposit token liquidity
     */
    function depositLiquidity(address token, uint256 amount) external nonReentrant {
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

    // ============ Admin Functions ============

    function updateXLPStake(address xlp, uint256 stake) external onlyOwner {
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
