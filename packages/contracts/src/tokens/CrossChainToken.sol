// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title IHyperlaneMailbox
 * @notice Interface for Hyperlane's cross-chain messaging
 */
interface IHyperlaneMailbox {
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32 messageId);

    function process(bytes calldata metadata, bytes calldata message) external;
    
    function localDomain() external view returns (uint32);
}

/**
 * @title IInterchainGasPaymaster
 * @notice Interface for Hyperlane gas payment
 */
interface IInterchainGasPaymaster {
    function payForGas(
        bytes32 messageId,
        uint32 destinationDomain,
        uint256 gasAmount,
        address refundAddress
    ) external payable;

    function quoteGasPayment(
        uint32 destinationDomain,
        uint256 gasAmount
    ) external view returns (uint256);
}

/**
 * @title IInterchainSecurityModule
 * @notice Interface for Hyperlane message verification
 */
interface IInterchainSecurityModule {
    function verify(
        bytes calldata metadata,
        bytes calldata message
    ) external returns (bool);

    function moduleType() external view returns (uint8);
}

/**
 * @title IFeeConfig
 * @notice Interface for DAO-governed fee configuration
 */
interface IFeeConfig {
    struct TokenFees {
        uint16 xlpRewardShareBps;
        uint16 protocolShareBps;
        uint16 burnShareBps;
        uint16 transferFeeBps;
        uint16 bridgeFeeMinBps;
        uint16 bridgeFeeMaxBps;
        uint16 xlpMinStakeBps;
        uint16 zkProofDiscountBps;
    }

    function getTokenFeesFor(address token) external view returns (TokenFees memory fees, bool hasOverride);
    function getTreasury() external view returns (address);
    function getBridgeFeeBounds(address token) external view returns (uint16 minBps, uint16 maxBps);
    function getZkProofDiscount(address token) external view returns (uint16);
}

/**
 * @title CrossChainToken
 * @author Jeju Network
 * @notice Abstract base contract for cross-chain tokens using Hyperlane Warp Routes
 * @dev 
 * - Supports both native (lock/unlock) and synthetic (burn/mint) modes
 * - DAO-governed bridge fees via FeeConfig
 * - ZK proof discount for trustless transfers
 * - XLP rewards distribution for liquidity providers
 *
 * Usage:
 * - Inherit from this contract
 * - Call _initializeCrossChain in constructor
 * - Override _isHomeChain() to specify home chain behavior
 *
 * @custom:security-contact security@jeju.network
 */
abstract contract CrossChainToken is ERC20, Ownable, ReentrancyGuard {
    // ============ Constants ============

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant GAS_LIMIT_BRIDGE = 300_000;

    // Message types
    bytes1 public constant MESSAGE_TYPE_TRANSFER = 0x01;
    bytes1 public constant MESSAGE_TYPE_TRANSFER_ZK = 0x02;

    // ============ State Variables ============

    /// @notice Hyperlane mailbox contract
    IHyperlaneMailbox public mailbox;

    /// @notice Hyperlane gas paymaster
    IInterchainGasPaymaster public igp;

    /// @notice Optional: Interchain security module
    IInterchainSecurityModule public ism;

    /// @notice DAO-governed fee configuration
    IFeeConfig public feeConfig;

    /// @notice Domain ID of the home chain
    uint32 public homeChainDomain;

    /// @notice Warp route addresses on remote chains
    mapping(uint32 => bytes32) public remoteRouters;

    /// @notice Supported destination domains
    mapping(uint32 => bool) public supportedDomains;

    /// @notice XLP reward pool for fee distribution
    address public xlpRewardPool;

    /// @notice Total bridge fees collected
    uint256 public totalBridgeFees;

    /// @notice Total tokens locked (only on home chain)
    uint256 public totalLocked;

    /// @notice Processed message IDs (replay protection)
    mapping(bytes32 => bool) public processedMessages;

    /// @notice Is this contract on the home chain?
    bool public isHomeChainInstance;

    // ============ Events ============

    event CrossChainTransferInitiated(
        bytes32 indexed messageId,
        address indexed sender,
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 amount,
        uint256 fee
    );

    event CrossChainTransferReceived(
        bytes32 indexed messageId,
        uint32 originDomain,
        address indexed recipient,
        uint256 amount
    );

    event RouterSet(uint32 indexed domain, bytes32 router);
    event DomainEnabled(uint32 indexed domain, bool enabled);
    event MailboxUpdated(address indexed oldMailbox, address indexed newMailbox);
    event IGPUpdated(address indexed oldIgp, address indexed newIgp);
    event ISMUpdated(address indexed oldIsm, address indexed newIsm);
    event FeeConfigUpdated(address indexed oldConfig, address indexed newConfig);
    event XlpRewardPoolUpdated(address indexed oldPool, address indexed newPool);
    event BridgeFeesDistributed(uint256 xlpAmount, uint256 protocolAmount, uint256 burnAmount);

    // ============ Errors ============

    error InvalidDomain();
    error UnsupportedDomain(uint32 domain);
    error RouterNotSet(uint32 domain);
    error InsufficientGasPayment(uint256 required, uint256 provided);
    error MessageAlreadyProcessed(bytes32 messageId);
    error OnlyMailbox();
    error InvalidMessageType();
    error InvalidRecipient();
    error TransferFailed();
    error InsufficientBalance();

    // ============ Modifiers ============

    modifier onlyMailbox() {
        if (msg.sender != address(mailbox)) revert OnlyMailbox();
        _;
    }

    // ============ Constructor ============

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner
    ) ERC20(name_, symbol_) Ownable(initialOwner) {}

    // ============ Initialization ============

    /**
     * @notice Initialize cross-chain infrastructure
     * @param _mailbox Hyperlane mailbox address
     * @param _igp Interchain gas paymaster address
     * @param _feeConfig Fee configuration contract
     * @param _homeChainDomain Domain ID of home chain
     * @param _isHomeChain Whether this instance is on the home chain
     */
    function _initializeCrossChain(
        address _mailbox,
        address _igp,
        address _feeConfig,
        uint32 _homeChainDomain,
        bool _isHomeChain
    ) internal {
        mailbox = IHyperlaneMailbox(_mailbox);
        igp = IInterchainGasPaymaster(_igp);
        feeConfig = IFeeConfig(_feeConfig);
        homeChainDomain = _homeChainDomain;
        isHomeChainInstance = _isHomeChain;
    }

    // ============ Cross-Chain Transfer ============

    /**
     * @notice Bridge tokens to another chain
     * @param destinationDomain Hyperlane domain ID of destination
     * @param recipient Recipient address (as bytes32)
     * @param amount Token amount to bridge
     * @param isZkVerified Whether this transfer has ZK verification
     */
    function bridgeTransfer(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 amount,
        bool isZkVerified
    ) external payable nonReentrant returns (bytes32 messageId) {
        if (recipient == bytes32(0)) revert InvalidRecipient();
        if (!supportedDomains[destinationDomain]) revert UnsupportedDomain(destinationDomain);
        if (remoteRouters[destinationDomain] == bytes32(0)) revert RouterNotSet(destinationDomain);

        // Calculate bridge fee
        uint256 fee = _calculateBridgeFee(amount, isZkVerified);
        uint256 netAmount = amount - fee;

        // Handle tokens based on home chain vs synthetic
        if (isHomeChainInstance) {
            // Lock tokens on home chain
            _transfer(msg.sender, address(this), amount);
            totalLocked += netAmount;
        } else {
            // Burn synthetic tokens
            _burn(msg.sender, amount);
        }

        // Distribute bridge fees
        if (fee > 0) {
            _distributeBridgeFees(fee);
        }

        // Construct message
        bytes memory messageBody = abi.encodePacked(
            isZkVerified ? MESSAGE_TYPE_TRANSFER_ZK : MESSAGE_TYPE_TRANSFER,
            recipient,
            netAmount
        );

        // Dispatch via Hyperlane
        messageId = mailbox.dispatch{value: 0}(
            destinationDomain,
            remoteRouters[destinationDomain],
            messageBody
        );

        // Pay for gas
        uint256 gasPayment = msg.value;
        uint256 requiredGas = igp.quoteGasPayment(destinationDomain, GAS_LIMIT_BRIDGE);
        if (gasPayment < requiredGas) revert InsufficientGasPayment(requiredGas, gasPayment);

        igp.payForGas{value: gasPayment}(
            messageId,
            destinationDomain,
            GAS_LIMIT_BRIDGE,
            msg.sender
        );

        emit CrossChainTransferInitiated(
            messageId,
            msg.sender,
            destinationDomain,
            recipient,
            netAmount,
            fee
        );
    }

    /**
     * @notice Handle incoming cross-chain message (called by Hyperlane mailbox)
     * @param origin Origin domain ID
     * @param sender Sender router address
     * @param body Message body
     */
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external onlyMailbox {
        // Verify sender is authorized router
        if (remoteRouters[origin] != sender) revert RouterNotSet(origin);

        // Extract message type
        bytes1 messageType = body[0];
        if (messageType != MESSAGE_TYPE_TRANSFER && messageType != MESSAGE_TYPE_TRANSFER_ZK) {
            revert InvalidMessageType();
        }

        // Decode recipient and amount
        bytes32 recipientBytes = bytes32(body[1:33]);
        uint256 amount = abi.decode(body[33:], (uint256));
        address recipient = address(uint160(uint256(recipientBytes)));

        // Generate message ID for replay protection
        bytes32 messageId = keccak256(abi.encodePacked(origin, sender, body, block.number));
        if (processedMessages[messageId]) revert MessageAlreadyProcessed(messageId);
        processedMessages[messageId] = true;

        // Handle tokens based on home chain vs synthetic
        if (isHomeChainInstance) {
            // Unlock tokens on home chain
            if (totalLocked < amount) revert InsufficientBalance();
            totalLocked -= amount;
            _transfer(address(this), recipient, amount);
        } else {
            // Mint synthetic tokens
            _mint(recipient, amount);
        }

        emit CrossChainTransferReceived(messageId, origin, recipient, amount);
    }

    // ============ Fee Calculation ============

    /**
     * @notice Calculate bridge fee for a transfer
     * @param amount Transfer amount
     * @param isZkVerified Whether transfer has ZK verification
     * @return fee Bridge fee amount
     */
    function _calculateBridgeFee(uint256 amount, bool isZkVerified) internal view returns (uint256 fee) {
        if (address(feeConfig) == address(0)) return 0;

        (uint16 minBps, uint16 maxBps) = feeConfig.getBridgeFeeBounds(address(this));
        
        // Use minimum fee by default
        uint16 feeBps = minBps;
        
        // Apply ZK discount if verified
        if (isZkVerified) {
            uint16 discount = feeConfig.getZkProofDiscount(address(this));
            feeBps = feeBps > discount ? feeBps - discount : 0;
        }

        // Cap at maximum
        if (feeBps > maxBps) feeBps = maxBps;

        fee = (amount * feeBps) / BPS_DENOMINATOR;
    }

    /**
     * @notice Distribute bridge fees according to DAO configuration
     * @param fee Total fee amount
     */
    function _distributeBridgeFees(uint256 fee) internal {
        if (address(feeConfig) == address(0)) return;

        (IFeeConfig.TokenFees memory fees,) = feeConfig.getTokenFeesFor(address(this));

        uint256 xlpAmount = (fee * fees.xlpRewardShareBps) / BPS_DENOMINATOR;
        uint256 protocolAmount = (fee * fees.protocolShareBps) / BPS_DENOMINATOR;
        uint256 burnAmount = fee - xlpAmount - protocolAmount;

        totalBridgeFees += fee;

        // Send to XLP reward pool
        if (xlpAmount > 0 && xlpRewardPool != address(0)) {
            if (isHomeChainInstance) {
                _transfer(address(this), xlpRewardPool, xlpAmount);
            } else {
                _mint(xlpRewardPool, xlpAmount);
            }
        }

        // Send to protocol treasury
        if (protocolAmount > 0) {
            address treasury = feeConfig.getTreasury();
            if (treasury != address(0)) {
                if (isHomeChainInstance) {
                    _transfer(address(this), treasury, protocolAmount);
                } else {
                    _mint(treasury, protocolAmount);
                }
            }
        }

        // Burn remainder
        if (burnAmount > 0) {
            // Don't transfer locked tokens, just reduce total (effective burn)
            if (!isHomeChainInstance) {
                // On synthetic chains, we never minted the burn amount
                // Nothing to do
            }
            // On home chain, tokens stay locked but unclaimed (effective burn)
        }

        emit BridgeFeesDistributed(xlpAmount, protocolAmount, burnAmount);
    }

    // ============ View Functions ============

    /**
     * @notice Get quote for bridging tokens
     * @param destinationDomain Target chain
     * @param amount Token amount
     * @param isZkVerified Whether using ZK verification
     * @return fee Bridge fee
     * @return gasPayment Required gas payment
     * @return netAmount Amount recipient will receive
     */
    function quoteBridge(
        uint32 destinationDomain,
        uint256 amount,
        bool isZkVerified
    ) external view returns (uint256 fee, uint256 gasPayment, uint256 netAmount) {
        fee = _calculateBridgeFee(amount, isZkVerified);
        gasPayment = igp.quoteGasPayment(destinationDomain, GAS_LIMIT_BRIDGE);
        netAmount = amount - fee;
    }

    /**
     * @notice Check if a domain is supported
     */
    function isSupportedDomain(uint32 domain) external view returns (bool) {
        return supportedDomains[domain] && remoteRouters[domain] != bytes32(0);
    }

    /**
     * @notice Get cross-chain stats
     */
    function getCrossChainStats() external view returns (
        uint256 locked,
        uint256 fees,
        uint32 homeDomain,
        bool isHome
    ) {
        return (totalLocked, totalBridgeFees, homeChainDomain, isHomeChainInstance);
    }

    // ============ Admin Functions ============

    function setRouter(uint32 domain, bytes32 router) external onlyOwner {
        remoteRouters[domain] = router;
        emit RouterSet(domain, router);
    }

    function setDomainEnabled(uint32 domain, bool enabled) external onlyOwner {
        supportedDomains[domain] = enabled;
        emit DomainEnabled(domain, enabled);
    }

    function setMailbox(address _mailbox) external onlyOwner {
        emit MailboxUpdated(address(mailbox), _mailbox);
        mailbox = IHyperlaneMailbox(_mailbox);
    }

    function setIGP(address _igp) external onlyOwner {
        emit IGPUpdated(address(igp), _igp);
        igp = IInterchainGasPaymaster(_igp);
    }

    function setISM(address _ism) external onlyOwner {
        emit ISMUpdated(address(ism), _ism);
        ism = IInterchainSecurityModule(_ism);
    }

    function setFeeConfig(address _feeConfig) external onlyOwner {
        emit FeeConfigUpdated(address(feeConfig), _feeConfig);
        feeConfig = IFeeConfig(_feeConfig);
    }

    function setXlpRewardPool(address _pool) external onlyOwner {
        emit XlpRewardPoolUpdated(xlpRewardPool, _pool);
        xlpRewardPool = _pool;
    }

    /**
     * @notice Batch configure routers for multiple chains
     */
    function configureRouters(
        uint32[] calldata domains,
        bytes32[] calldata routers
    ) external onlyOwner {
        require(domains.length == routers.length, "Length mismatch");
        for (uint256 i = 0; i < domains.length; i++) {
            remoteRouters[domains[i]] = routers[i];
            supportedDomains[domains[i]] = routers[i] != bytes32(0);
            emit RouterSet(domains[i], routers[i]);
            emit DomainEnabled(domains[i], routers[i] != bytes32(0));
        }
    }
}
