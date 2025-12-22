// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title EmailProviderStaking
 * @notice Permissionless staking for email relay operators and external providers
 * @dev Anyone can register as an email provider by staking tokens
 *
 * Provider Types:
 * - RELAY: Internal relay node for jeju.mail
 * - BRIDGE: Web2 SMTP bridge provider
 * - EXTERNAL: External email domain provider (e.g., company.jeju email)
 *
 * Slashing conditions:
 * - Spam origination (10%)
 * - Downtime > 24h (5%)
 * - CSAM/illegal content handling (100% + ban)
 * - Censorship/tampering (50%)
 */
contract EmailProviderStaking is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum ProviderType {
        RELAY,      // Internal relay node
        BRIDGE,     // Web2 SMTP bridge
        EXTERNAL    // External domain provider
    }

    enum ProviderStatus {
        INACTIVE,
        ACTIVE,
        SUSPENDED,
        BANNED
    }

    // ============ Structs ============

    struct Provider {
        address operator;
        ProviderType providerType;
        ProviderStatus status;
        string endpoint;            // API/SMTP endpoint
        string domain;              // Email domain (for EXTERNAL type)
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastActivityAt;
        uint256 emailsProcessed;
        uint256 spamReports;
        uint256 uptime;             // Basis points (10000 = 100%)
        uint256 slashCount;
        bytes teeAttestation;       // TEE attestation for relay nodes
    }

    struct PerformanceMetrics {
        uint256 totalEmailsProcessed;
        uint256 totalSpamBlocked;
        uint256 totalDeliveryFailures;
        uint256 averageLatencyMs;
        uint256 lastReportTimestamp;
    }

    // ============ Constants ============

    uint256 public constant MIN_RELAY_STAKE = 1000 ether;       // 1000 JEJU
    uint256 public constant MIN_BRIDGE_STAKE = 5000 ether;      // 5000 JEJU
    uint256 public constant MIN_EXTERNAL_STAKE = 2000 ether;    // 2000 JEJU

    uint256 public constant SPAM_SLASH_BPS = 1000;              // 10%
    uint256 public constant DOWNTIME_SLASH_BPS = 500;           // 5%
    uint256 public constant CENSORSHIP_SLASH_BPS = 5000;        // 50%
    uint256 public constant ILLEGAL_CONTENT_SLASH_BPS = 10000;  // 100%

    uint256 public constant UNSTAKE_COOLDOWN = 14 days;
    uint256 public constant MIN_UPTIME_BPS = 9500;              // 95% minimum uptime

    uint256 public constant BPS_DENOMINATOR = 10000;

    // ============ State ============

    /// @notice Identity registry for agent linking
    IIdentityRegistry public identityRegistry;

    /// @notice Staking token (address(0) for ETH)
    IERC20 public immutable stakingToken;

    /// @notice Treasury for slashed funds
    address public treasury;

    /// @notice Provider by operator address
    mapping(address => Provider) public providers;

    /// @notice Performance metrics by operator
    mapping(address => PerformanceMetrics) public metrics;

    /// @notice Pending unstake requests
    mapping(address => uint256) public unstakeRequestTime;

    /// @notice Domain to provider mapping (for EXTERNAL type)
    mapping(string => address) public domainToProvider;

    /// @notice All provider addresses
    address[] public allProviders;

    /// @notice Active relay count
    uint256 public activeRelayCount;

    /// @notice Active bridge count
    uint256 public activeBridgeCount;

    /// @notice Total staked
    uint256 public totalStaked;

    /// @notice Oracle addresses for performance reporting
    mapping(address => bool) public performanceOracles;

    // ============ Events ============

    event ProviderRegistered(
        address indexed operator,
        ProviderType providerType,
        string endpoint,
        string domain,
        uint256 stakedAmount
    );

    event ProviderUpdated(
        address indexed operator,
        string newEndpoint,
        bytes newAttestation
    );

    event ProviderStatusChanged(
        address indexed operator,
        ProviderStatus oldStatus,
        ProviderStatus newStatus,
        string reason
    );

    event StakeAdded(
        address indexed operator,
        uint256 amount,
        uint256 totalStake
    );

    event UnstakeRequested(
        address indexed operator,
        uint256 amount,
        uint256 availableAt
    );

    event Unstaked(
        address indexed operator,
        uint256 amount
    );

    event Slashed(
        address indexed operator,
        uint256 amount,
        string reason
    );

    event MetricsReported(
        address indexed operator,
        uint256 emailsProcessed,
        uint256 spamBlocked,
        uint256 uptime
    );

    // ============ Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error InsufficientStake();
    error InvalidProviderType();
    error DomainAlreadyRegistered();
    error DomainRequired();
    error UnstakeCooldownActive();
    error NoUnstakeRequest();
    error ProviderNotActive();
    error NotOracle();
    error InvalidAddress();

    // ============ Modifiers ============

    modifier onlyOracle() {
        if (!performanceOracles[msg.sender]) revert NotOracle();
        _;
    }

    modifier onlyActiveProvider() {
        if (providers[msg.sender].status != ProviderStatus.ACTIVE) revert ProviderNotActive();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _stakingToken,
        address _treasury,
        address _identityRegistry,
        address initialOwner
    ) Ownable(initialOwner) {
        stakingToken = IERC20(_stakingToken);
        treasury = _treasury;
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    // ============ Registration ============

    /**
     * @notice Register as an email provider
     * @param providerType Type of provider (RELAY, BRIDGE, EXTERNAL)
     * @param endpoint API/SMTP endpoint URL
     * @param domain Email domain (required for EXTERNAL type)
     * @param teeAttestation TEE attestation (required for RELAY type)
     */
    function register(
        ProviderType providerType,
        string calldata endpoint,
        string calldata domain,
        bytes calldata teeAttestation
    ) external payable whenNotPaused nonReentrant {
        if (providers[msg.sender].status != ProviderStatus.INACTIVE) revert AlreadyRegistered();

        uint256 minStake = _getMinStake(providerType);
        if (msg.value < minStake) revert InsufficientStake();

        // External providers must specify a domain
        if (providerType == ProviderType.EXTERNAL) {
            if (bytes(domain).length == 0) revert DomainRequired();
            if (domainToProvider[domain] != address(0)) revert DomainAlreadyRegistered();
            domainToProvider[domain] = msg.sender;
        }

        providers[msg.sender] = Provider({
            operator: msg.sender,
            providerType: providerType,
            status: ProviderStatus.ACTIVE,
            endpoint: endpoint,
            domain: domain,
            stakedAmount: msg.value,
            registeredAt: block.timestamp,
            lastActivityAt: block.timestamp,
            emailsProcessed: 0,
            spamReports: 0,
            uptime: BPS_DENOMINATOR, // Start at 100%
            slashCount: 0,
            teeAttestation: teeAttestation
        });

        metrics[msg.sender] = PerformanceMetrics({
            totalEmailsProcessed: 0,
            totalSpamBlocked: 0,
            totalDeliveryFailures: 0,
            averageLatencyMs: 0,
            lastReportTimestamp: block.timestamp
        });

        allProviders.push(msg.sender);
        totalStaked += msg.value;

        if (providerType == ProviderType.RELAY) {
            activeRelayCount++;
        } else if (providerType == ProviderType.BRIDGE) {
            activeBridgeCount++;
        }

        emit ProviderRegistered(msg.sender, providerType, endpoint, domain, msg.value);
    }

    /**
     * @notice Register with ERC20 staking token
     */
    function registerWithToken(
        ProviderType providerType,
        string calldata endpoint,
        string calldata domain,
        bytes calldata teeAttestation,
        uint256 stakeAmount
    ) external whenNotPaused nonReentrant {
        if (address(stakingToken) == address(0)) revert InvalidAddress();
        if (providers[msg.sender].status != ProviderStatus.INACTIVE) revert AlreadyRegistered();

        uint256 minStake = _getMinStake(providerType);
        if (stakeAmount < minStake) revert InsufficientStake();

        stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        if (providerType == ProviderType.EXTERNAL) {
            if (bytes(domain).length == 0) revert DomainRequired();
            if (domainToProvider[domain] != address(0)) revert DomainAlreadyRegistered();
            domainToProvider[domain] = msg.sender;
        }

        providers[msg.sender] = Provider({
            operator: msg.sender,
            providerType: providerType,
            status: ProviderStatus.ACTIVE,
            endpoint: endpoint,
            domain: domain,
            stakedAmount: stakeAmount,
            registeredAt: block.timestamp,
            lastActivityAt: block.timestamp,
            emailsProcessed: 0,
            spamReports: 0,
            uptime: BPS_DENOMINATOR,
            slashCount: 0,
            teeAttestation: teeAttestation
        });

        metrics[msg.sender] = PerformanceMetrics({
            totalEmailsProcessed: 0,
            totalSpamBlocked: 0,
            totalDeliveryFailures: 0,
            averageLatencyMs: 0,
            lastReportTimestamp: block.timestamp
        });

        allProviders.push(msg.sender);
        totalStaked += stakeAmount;

        if (providerType == ProviderType.RELAY) {
            activeRelayCount++;
        } else if (providerType == ProviderType.BRIDGE) {
            activeBridgeCount++;
        }

        emit ProviderRegistered(msg.sender, providerType, endpoint, domain, stakeAmount);
    }

    // ============ Provider Management ============

    /**
     * @notice Update provider endpoint and attestation
     */
    function updateProvider(
        string calldata newEndpoint,
        bytes calldata newAttestation
    ) external onlyActiveProvider {
        Provider storage provider = providers[msg.sender];
        provider.endpoint = newEndpoint;
        provider.teeAttestation = newAttestation;
        provider.lastActivityAt = block.timestamp;

        emit ProviderUpdated(msg.sender, newEndpoint, newAttestation);
    }

    /**
     * @notice Add more stake
     */
    function addStake() external payable onlyActiveProvider nonReentrant {
        Provider storage provider = providers[msg.sender];
        provider.stakedAmount += msg.value;
        totalStaked += msg.value;

        emit StakeAdded(msg.sender, msg.value, provider.stakedAmount);
    }

    /**
     * @notice Request unstake (starts cooldown)
     */
    function requestUnstake() external onlyActiveProvider {
        if (unstakeRequestTime[msg.sender] != 0) revert UnstakeCooldownActive();
        unstakeRequestTime[msg.sender] = block.timestamp;

        emit UnstakeRequested(
            msg.sender,
            providers[msg.sender].stakedAmount,
            block.timestamp + UNSTAKE_COOLDOWN
        );
    }

    /**
     * @notice Complete unstake and deregister
     */
    function unstake() external nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (provider.status == ProviderStatus.INACTIVE) revert NotRegistered();

        uint256 requestTime = unstakeRequestTime[msg.sender];
        if (requestTime == 0) revert NoUnstakeRequest();
        if (block.timestamp < requestTime + UNSTAKE_COOLDOWN) revert UnstakeCooldownActive();

        uint256 amount = provider.stakedAmount;
        ProviderType providerType = provider.providerType;

        // Clean up domain registration
        if (bytes(provider.domain).length > 0) {
            delete domainToProvider[provider.domain];
        }

        provider.status = ProviderStatus.INACTIVE;
        provider.stakedAmount = 0;
        totalStaked -= amount;
        delete unstakeRequestTime[msg.sender];

        if (providerType == ProviderType.RELAY) {
            activeRelayCount--;
        } else if (providerType == ProviderType.BRIDGE) {
            activeBridgeCount--;
        }

        // Transfer stake
        if (address(stakingToken) == address(0)) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed");
        } else {
            stakingToken.safeTransfer(msg.sender, amount);
        }

        emit Unstaked(msg.sender, amount);
    }

    // ============ Performance Reporting ============

    /**
     * @notice Report provider performance metrics (oracle only)
     */
    function reportMetrics(
        address operator,
        uint256 emailsProcessed,
        uint256 spamBlocked,
        uint256 deliveryFailures,
        uint256 latencyMs,
        uint256 uptimeBps
    ) external onlyOracle {
        Provider storage provider = providers[operator];
        if (provider.status == ProviderStatus.INACTIVE) revert NotRegistered();

        PerformanceMetrics storage m = metrics[operator];
        m.totalEmailsProcessed += emailsProcessed;
        m.totalSpamBlocked += spamBlocked;
        m.totalDeliveryFailures += deliveryFailures;
        m.averageLatencyMs = (m.averageLatencyMs + latencyMs) / 2;
        m.lastReportTimestamp = block.timestamp;

        provider.emailsProcessed += emailsProcessed;
        provider.uptime = (provider.uptime + uptimeBps) / 2;
        provider.lastActivityAt = block.timestamp;

        emit MetricsReported(operator, emailsProcessed, spamBlocked, uptimeBps);
    }

    /**
     * @notice Report spam origination (oracle only)
     */
    function reportSpam(
        address operator,
        uint256 count,
        bytes32 evidenceHash
    ) external onlyOracle {
        Provider storage provider = providers[operator];
        if (provider.status == ProviderStatus.INACTIVE) revert NotRegistered();

        provider.spamReports += count;

        // Auto-slash if spam threshold exceeded
        if (provider.spamReports > 10) {
            _slash(operator, SPAM_SLASH_BPS, "Excessive spam origination");
        }
    }

    // ============ Slashing ============

    /**
     * @notice Slash a provider for violations
     */
    function slash(
        address operator,
        uint256 slashBps,
        string calldata reason
    ) external onlyOwner {
        _slash(operator, slashBps, reason);
    }

    /**
     * @notice Slash for CSAM/illegal content (100% + ban)
     */
    function slashAndBanForIllegalContent(
        address operator,
        string calldata reason
    ) external onlyOwner {
        Provider storage provider = providers[operator];
        if (provider.status == ProviderStatus.INACTIVE) revert NotRegistered();

        uint256 amount = provider.stakedAmount;
        
        provider.stakedAmount = 0;
        provider.status = ProviderStatus.BANNED;
        provider.slashCount++;
        totalStaked -= amount;

        // Clean up domain registration
        if (bytes(provider.domain).length > 0) {
            delete domainToProvider[provider.domain];
        }

        if (provider.providerType == ProviderType.RELAY) {
            activeRelayCount--;
        } else if (provider.providerType == ProviderType.BRIDGE) {
            activeBridgeCount--;
        }

        // Transfer to treasury
        if (amount > 0) {
            if (address(stakingToken) == address(0)) {
                (bool success, ) = treasury.call{value: amount}("");
                require(success, "Transfer failed");
            } else {
                stakingToken.safeTransfer(treasury, amount);
            }
        }

        emit Slashed(operator, amount, reason);
        emit ProviderStatusChanged(operator, ProviderStatus.ACTIVE, ProviderStatus.BANNED, reason);
    }

    function _slash(address operator, uint256 slashBps, string memory reason) internal {
        Provider storage provider = providers[operator];
        if (provider.status == ProviderStatus.INACTIVE) revert NotRegistered();

        uint256 slashAmount = (provider.stakedAmount * slashBps) / BPS_DENOMINATOR;
        provider.stakedAmount -= slashAmount;
        provider.slashCount++;
        totalStaked -= slashAmount;

        // Suspend if below minimum stake
        uint256 minStake = _getMinStake(provider.providerType);
        if (provider.stakedAmount < minStake) {
            provider.status = ProviderStatus.SUSPENDED;
            
            if (provider.providerType == ProviderType.RELAY) {
                activeRelayCount--;
            } else if (provider.providerType == ProviderType.BRIDGE) {
                activeBridgeCount--;
            }

            emit ProviderStatusChanged(operator, ProviderStatus.ACTIVE, ProviderStatus.SUSPENDED, "Below minimum stake");
        }

        // Transfer to treasury
        if (slashAmount > 0) {
            if (address(stakingToken) == address(0)) {
                (bool success, ) = treasury.call{value: slashAmount}("");
                require(success, "Transfer failed");
            } else {
                stakingToken.safeTransfer(treasury, slashAmount);
            }
        }

        emit Slashed(operator, slashAmount, reason);
    }

    // ============ View Functions ============

    function getProvider(address operator) external view returns (Provider memory) {
        return providers[operator];
    }

    function getMetrics(address operator) external view returns (PerformanceMetrics memory) {
        return metrics[operator];
    }

    function isActiveRelay(address operator) external view returns (bool) {
        Provider storage provider = providers[operator];
        return provider.status == ProviderStatus.ACTIVE && 
               provider.providerType == ProviderType.RELAY;
    }

    function isActiveBridge(address operator) external view returns (bool) {
        Provider storage provider = providers[operator];
        return provider.status == ProviderStatus.ACTIVE && 
               provider.providerType == ProviderType.BRIDGE;
    }

    function getActiveRelays() external view returns (address[] memory) {
        address[] memory relays = new address[](activeRelayCount);
        uint256 idx = 0;
        
        for (uint256 i = 0; i < allProviders.length && idx < activeRelayCount; i++) {
            Provider storage p = providers[allProviders[i]];
            if (p.status == ProviderStatus.ACTIVE && p.providerType == ProviderType.RELAY) {
                relays[idx++] = allProviders[i];
            }
        }
        
        return relays;
    }

    function getProviderByDomain(string calldata domain) external view returns (Provider memory) {
        address operator = domainToProvider[domain];
        return providers[operator];
    }

    function _getMinStake(ProviderType providerType) internal pure returns (uint256) {
        if (providerType == ProviderType.RELAY) return MIN_RELAY_STAKE;
        if (providerType == ProviderType.BRIDGE) return MIN_BRIDGE_STAKE;
        return MIN_EXTERNAL_STAKE;
    }

    // ============ Admin Functions ============

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        treasury = _treasury;
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    function setPerformanceOracle(address oracle, bool authorized) external onlyOwner {
        performanceOracles[oracle] = authorized;
    }

    function suspendProvider(address operator, string calldata reason) external onlyOwner {
        Provider storage provider = providers[operator];
        if (provider.status == ProviderStatus.INACTIVE) revert NotRegistered();

        ProviderStatus oldStatus = provider.status;
        provider.status = ProviderStatus.SUSPENDED;

        if (oldStatus == ProviderStatus.ACTIVE) {
            if (provider.providerType == ProviderType.RELAY) {
                activeRelayCount--;
            } else if (provider.providerType == ProviderType.BRIDGE) {
                activeBridgeCount--;
            }
        }

        emit ProviderStatusChanged(operator, oldStatus, ProviderStatus.SUSPENDED, reason);
    }

    function restoreProvider(address operator) external onlyOwner {
        Provider storage provider = providers[operator];
        if (provider.status != ProviderStatus.SUSPENDED) revert NotRegistered();

        uint256 minStake = _getMinStake(provider.providerType);
        if (provider.stakedAmount < minStake) revert InsufficientStake();

        provider.status = ProviderStatus.ACTIVE;

        if (provider.providerType == ProviderType.RELAY) {
            activeRelayCount++;
        } else if (provider.providerType == ProviderType.BRIDGE) {
            activeBridgeCount++;
        }

        emit ProviderStatusChanged(operator, ProviderStatus.SUSPENDED, ProviderStatus.ACTIVE, "Restored");
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    receive() external payable {}
}
