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

/// @title TokenLaunchpad
/// @notice Token launchpad with bonding curve and ICO presale options
/// @dev 100% of fees go to creator + community (no platform cut)
contract TokenLaunchpad is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum LaunchType {
        BONDING_CURVE,
        ICO_PRESALE
    }

    struct FeeConfig {
        uint16 creatorFeeBps;
        uint16 communityFeeBps;
        address communityVault;
    }

    struct BondingCurveConfig {
        uint256 virtualEthReserves;
        uint256 graduationTarget;
        uint256 tokenSupply;
    }

    struct ICOConfig {
        uint256 presaleAllocationBps;
        uint256 presalePrice;
        uint256 lpFundingBps;
        uint256 lpLockDuration;
        uint256 buyerLockDuration;
        uint256 softCap;
        uint256 hardCap;
        uint256 presaleDuration;
    }

    struct Launch {
        uint256 id;
        address creator;
        address token;
        LaunchType launchType;
        FeeConfig feeConfig;
        address bondingCurve;
        address presale;
        address lpLocker;
        uint256 createdAt;
        bool graduated;
    }

    address public immutable xlpV2Factory;
    address public immutable weth;
    address public lpLockerTemplate;
    uint256 public nextLaunchId = 1;
    address public defaultCommunityVault;

    mapping(uint256 => Launch) public launches;
    mapping(address => uint256) public tokenToLaunchId;
    mapping(address => uint256[]) public creatorLaunches;

    event LaunchCreated(
        uint256 indexed launchId,
        address indexed creator,
        address indexed token,
        LaunchType launchType,
        uint16 creatorFeeBps,
        uint16 communityFeeBps
    );
    event LaunchGraduated(uint256 indexed launchId, address indexed token, address lpPair, uint256 lpTokensLocked);
    event FeeDistributed(
        uint256 indexed launchId, address indexed token, uint256 creatorAmount, uint256 communityAmount
    );

    error InvalidFeeConfig();
    error InvalidConfig();
    error LaunchNotFound();
    error AlreadyGraduated();
    error NotGraduated();

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

    /// @notice Launch token with bonding curve (pump.fun style)
    function launchBondingCurve(
        string calldata name,
        string calldata symbol,
        uint16 creatorFeeBps,
        address communityVault,
        BondingCurveConfig calldata curveConfig
    ) external nonReentrant returns (uint256 launchId, address tokenAddress) {
        if (creatorFeeBps > 10000) revert InvalidFeeConfig();
        uint16 communityFeeBps = 10000 - creatorFeeBps;

        LaunchpadToken token = new LaunchpadToken(name, symbol, curveConfig.tokenSupply, address(this));
        tokenAddress = address(token);

        BondingCurve curve = new BondingCurve(
            tokenAddress,
            curveConfig.virtualEthReserves,
            curveConfig.graduationTarget,
            address(this),
            xlpV2Factory,
            weth
        );

        IERC20(address(token)).safeTransfer(address(curve), curveConfig.tokenSupply);

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
            lpLocker: address(0),
            createdAt: block.timestamp,
            graduated: false
        });

        tokenToLaunchId[tokenAddress] = launchId;
        creatorLaunches[msg.sender].push(launchId);
        emit LaunchCreated(launchId, msg.sender, tokenAddress, LaunchType.BONDING_CURVE, creatorFeeBps, communityFeeBps);
    }

    /// @notice Launch token with ICO-style presale
    function launchICO(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        uint16 creatorFeeBps,
        address communityVault,
        ICOConfig calldata icoConfig
    ) external nonReentrant returns (uint256 launchId, address tokenAddress) {
        if (creatorFeeBps > 10000) revert InvalidFeeConfig();
        uint16 communityFeeBps = 10000 - creatorFeeBps;
        if (icoConfig.presaleAllocationBps > 5000) revert InvalidConfig();
        if (icoConfig.lpFundingBps > 10000) revert InvalidConfig();
        if (icoConfig.lpLockDuration < 1 weeks || icoConfig.lpLockDuration > 180 days) revert InvalidConfig();

        LaunchpadToken token = new LaunchpadToken(name, symbol, totalSupply, address(this));
        tokenAddress = address(token);

        uint256 presaleTokens = (totalSupply * icoConfig.presaleAllocationBps) / 10000;
        uint256 lpTokens = (totalSupply * 2000) / 10000;
        uint256 creatorTokens = totalSupply - presaleTokens - lpTokens;

        LPLocker locker = new LPLocker(address(this));
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

        ICOPresale presale =
            new ICOPresale(tokenAddress, msg.sender, xlpV2Factory, weth, address(locker), presaleConfig);

        // Authorize presale to lock LP tokens
        locker.setAuthorizedLocker(address(presale), true);

        IERC20(address(token)).safeTransfer(address(presale), presaleTokens + lpTokens);
        IERC20(address(token)).safeTransfer(msg.sender, creatorTokens);

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

    function getLaunch(uint256 launchId) external view returns (Launch memory) {
        return launches[launchId];
    }

    function getTokenFeeConfig(address token) external view returns (FeeConfig memory) {
        uint256 launchId = tokenToLaunchId[token];
        if (launchId == 0) revert LaunchNotFound();
        return launches[launchId].feeConfig;
    }

    function getCreatorLaunches(address creator) external view returns (uint256[] memory) {
        return creatorLaunches[creator];
    }

    function launchCount() external view returns (uint256) {
        return nextLaunchId - 1;
    }

    function setDefaultCommunityVault(address vault) external onlyOwner {
        defaultCommunityVault = vault;
    }

    function setLPLockerTemplate(address template) external onlyOwner {
        lpLockerTemplate = template;
    }
}
