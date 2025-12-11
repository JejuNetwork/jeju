// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./LaunchpadToken.sol";
import "./BondingCurve.sol";
import "./ICOPresale.sol";
import "./LPLocker.sol";

/**
 * @title TokenLaunchpad
 * @author Jeju Network
 * @notice Unified launchpad for creating tokens with configurable fee splits
 * @dev Supports two launch types:
 *      1. Pump-style bonding curve → graduates to AMM LP
 *      2. ICO-style presale → funds LP directly
 *
 * Fee Structure:
 * - 100% of trading fees go to creator + community (no platform cut)
 * - Creator/community split is configurable (0-100%)
 * - Default: 80% creator, 20% community
 *
 * Key Features:
 * - Zero platform fees
 * - Configurable creator/community fee split
 * - LP locking with configurable duration
 * - Presale buyer tokens locked separately from LP
 */
contract TokenLaunchpad is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    enum LaunchType {
        BONDING_CURVE,  // Pump.fun style - bonding curve then graduate to LP
        ICO_PRESALE     // Traditional presale - funds LP directly
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct FeeConfig {
        uint16 creatorFeeBps;    // Creator's share in basis points (0-10000)
        uint16 communityFeeBps;  // Community's share in basis points (0-10000)
        address communityVault;   // Address receiving community fees
    }

    struct BondingCurveConfig {
        uint256 virtualEthReserves;   // Starting virtual ETH (determines initial price)
        uint256 graduationTarget;      // ETH threshold to graduate to LP
        uint256 tokenSupply;           // Total token supply for curve
    }

    struct ICOConfig {
        uint256 presaleAllocationBps;  // % of supply for presale (max 5000 = 50%)
        uint256 presalePrice;           // Price per token in wei
        uint256 lpFundingBps;           // % of raised ETH going to LP (rest to creator)
        uint256 lpLockDuration;         // How long LP tokens are locked
        uint256 buyerLockDuration;      // How long buyer tokens are locked
        uint256 softCap;                // Minimum ETH to raise
        uint256 hardCap;                // Maximum ETH to raise
        uint256 presaleDuration;        // Duration of presale in seconds
    }

    struct Launch {
        uint256 id;
        address creator;
        address token;
        LaunchType launchType;
        FeeConfig feeConfig;
        address bondingCurve;    // Only for BONDING_CURVE type
        address presale;         // Only for ICO_PRESALE type
        address lpLocker;        // LP locker address
        uint256 createdAt;
        bool graduated;          // True if bonding curve graduated or ICO completed
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice XLP V2 Factory for creating LP pairs
    address public immutable xlpV2Factory;

    /// @notice WETH address for LP pairing
    address public immutable weth;

    /// @notice LP Locker template (for cloning)
    address public lpLockerTemplate;

    /// @notice Next launch ID
    uint256 public nextLaunchId = 1;

    /// @notice All launches by ID
    mapping(uint256 => Launch) public launches;

    /// @notice Launches by token address
    mapping(address => uint256) public tokenToLaunchId;

    /// @notice Launches by creator
    mapping(address => uint256[]) public creatorLaunches;

    /// @notice Default community vault (for tokens without specified vault)
    address public defaultCommunityVault;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event LaunchCreated(
        uint256 indexed launchId,
        address indexed creator,
        address indexed token,
        LaunchType launchType,
        uint16 creatorFeeBps,
        uint16 communityFeeBps
    );

    event LaunchGraduated(
        uint256 indexed launchId,
        address indexed token,
        address lpPair,
        uint256 lpTokensLocked
    );

    event FeeDistributed(
        uint256 indexed launchId,
        address indexed token,
        uint256 creatorAmount,
        uint256 communityAmount
    );

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidFeeConfig();
    error InvalidConfig();
    error LaunchNotFound();
    error AlreadyGraduated();
    error NotGraduated();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _xlpV2Factory,
        address _weth,
        address _lpLockerTemplate,
        address _defaultCommunityVault,
        address _owner
    ) Ownable(_owner) {
        xlpV2Factory = _xlpV2Factory;
        weth = _weth;
        lpLockerTemplate = _lpLockerTemplate;
        defaultCommunityVault = _defaultCommunityVault;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         BONDING CURVE LAUNCH
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Launch a token with pump.fun style bonding curve
     * @param name Token name
     * @param symbol Token symbol
     * @param creatorFeeBps Creator's fee share in basis points (default 8000 = 80%)
     * @param communityVault Address to receive community fees (0 = default vault)
     * @param curveConfig Bonding curve configuration
     * @return launchId The ID of the created launch
     * @return tokenAddress The address of the created token
     */
    function launchBondingCurve(
        string calldata name,
        string calldata symbol,
        uint16 creatorFeeBps,
        address communityVault,
        BondingCurveConfig calldata curveConfig
    ) external nonReentrant returns (uint256 launchId, address tokenAddress) {
        // Validate fee config (must sum to 10000)
        if (creatorFeeBps > 10000) revert InvalidFeeConfig();
        uint16 communityFeeBps = 10000 - creatorFeeBps;

        // Create the token
        LaunchpadToken token = new LaunchpadToken(
            name,
            symbol,
            curveConfig.tokenSupply,
            address(this) // Launchpad holds tokens initially
        );
        tokenAddress = address(token);

        // Create bonding curve
        BondingCurve curve = new BondingCurve(
            tokenAddress,
            curveConfig.virtualEthReserves,
            curveConfig.graduationTarget,
            address(this),
            xlpV2Factory,
            weth
        );

        // Transfer tokens to bonding curve
        token.transfer(address(curve), curveConfig.tokenSupply);

        // Store launch data
        launchId = nextLaunchId++;
        
        FeeConfig memory feeConfig = FeeConfig({
            creatorFeeBps: creatorFeeBps,
            communityFeeBps: communityFeeBps,
            communityVault: communityVault == address(0) ? defaultCommunityVault : communityVault
        });

        launches[launchId] = Launch({
            id: launchId,
            creator: msg.sender,
            token: tokenAddress,
            launchType: LaunchType.BONDING_CURVE,
            feeConfig: feeConfig,
            bondingCurve: address(curve),
            presale: address(0),
            lpLocker: address(0), // Created on graduation
            createdAt: block.timestamp,
            graduated: false
        });

        tokenToLaunchId[tokenAddress] = launchId;
        creatorLaunches[msg.sender].push(launchId);

        emit LaunchCreated(launchId, msg.sender, tokenAddress, LaunchType.BONDING_CURVE, creatorFeeBps, communityFeeBps);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ICO PRESALE LAUNCH
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Launch a token with ICO-style presale
     * @param name Token name
     * @param symbol Token symbol
     * @param totalSupply Total token supply (18 decimals)
     * @param creatorFeeBps Creator's fee share in basis points (default 8000 = 80%)
     * @param communityVault Address to receive community fees (0 = default vault)
     * @param icoConfig ICO configuration
     * @return launchId The ID of the created launch
     * @return tokenAddress The address of the created token
     */
    function launchICO(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        uint16 creatorFeeBps,
        address communityVault,
        ICOConfig calldata icoConfig
    ) external nonReentrant returns (uint256 launchId, address tokenAddress) {
        // Validate config
        if (creatorFeeBps > 10000) revert InvalidFeeConfig();
        uint16 communityFeeBps = 10000 - creatorFeeBps;
        if (icoConfig.presaleAllocationBps > 5000) revert InvalidConfig(); // Max 50%
        if (icoConfig.lpFundingBps > 10000) revert InvalidConfig();
        if (icoConfig.lpLockDuration < 1 weeks || icoConfig.lpLockDuration > 180 days) {
            revert InvalidConfig();
        }

        // Create the token
        LaunchpadToken token = new LaunchpadToken(
            name,
            symbol,
            totalSupply,
            address(this)
        );
        tokenAddress = address(token);

        // Calculate allocations
        uint256 presaleTokens = (totalSupply * icoConfig.presaleAllocationBps) / 10000;
        uint256 lpTokens = (totalSupply * 2000) / 10000; // 20% to LP
        uint256 creatorTokens = totalSupply - presaleTokens - lpTokens;

        // Create LP locker
        LPLocker locker = new LPLocker(address(this));

        // Create ICO presale - convert to ICOPresale.Config
        ICOPresale.Config memory presaleConfig = ICOPresale.Config({
            presaleAllocationBps: icoConfig.presaleAllocationBps,
            presalePrice: icoConfig.presalePrice,
            lpFundingBps: icoConfig.lpFundingBps,
            lpLockDuration: icoConfig.lpLockDuration,
            buyerLockDuration: icoConfig.buyerLockDuration,
            softCap: icoConfig.softCap,
            hardCap: icoConfig.hardCap,
            presaleDuration: icoConfig.presaleDuration
        });

        ICOPresale presale = new ICOPresale(
            tokenAddress,
            msg.sender,
            xlpV2Factory,
            weth,
            address(locker),
            presaleConfig
        );

        // Transfer tokens
        token.transfer(address(presale), presaleTokens + lpTokens); // Presale holds buyer + LP tokens
        token.transfer(msg.sender, creatorTokens); // Creator gets remaining

        // Store launch data
        launchId = nextLaunchId++;
        
        FeeConfig memory feeConfig = FeeConfig({
            creatorFeeBps: creatorFeeBps,
            communityFeeBps: communityFeeBps,
            communityVault: communityVault == address(0) ? defaultCommunityVault : communityVault
        });

        launches[launchId] = Launch({
            id: launchId,
            creator: msg.sender,
            token: tokenAddress,
            launchType: LaunchType.ICO_PRESALE,
            feeConfig: feeConfig,
            bondingCurve: address(0),
            presale: address(presale),
            lpLocker: address(locker),
            createdAt: block.timestamp,
            graduated: false
        });

        tokenToLaunchId[tokenAddress] = launchId;
        creatorLaunches[msg.sender].push(launchId);

        emit LaunchCreated(launchId, msg.sender, tokenAddress, LaunchType.ICO_PRESALE, creatorFeeBps, communityFeeBps);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get launch details
     */
    function getLaunch(uint256 launchId) external view returns (Launch memory) {
        return launches[launchId];
    }

    /**
     * @notice Get fee configuration for a token
     */
    function getTokenFeeConfig(address token) external view returns (FeeConfig memory) {
        uint256 launchId = tokenToLaunchId[token];
        if (launchId == 0) revert LaunchNotFound();
        return launches[launchId].feeConfig;
    }

    /**
     * @notice Get all launches by creator
     */
    function getCreatorLaunches(address creator) external view returns (uint256[] memory) {
        return creatorLaunches[creator];
    }

    /**
     * @notice Get total launch count
     */
    function launchCount() external view returns (uint256) {
        return nextLaunchId - 1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    function setDefaultCommunityVault(address vault) external onlyOwner {
        defaultCommunityVault = vault;
    }

    function setLPLockerTemplate(address template) external onlyOwner {
        lpLockerTemplate = template;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
