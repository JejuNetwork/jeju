// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IInsuranceFund} from "./interfaces/IPerpetualMarket.sol";
import {ISimplePriceOracle} from "../interfaces/IPriceOracle.sol";

/**
 * @title InsuranceFund
 * @notice Backstop fund for covering bad debt from liquidations
 */
contract InsuranceFund is IInsuranceFund, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;


    ISimplePriceOracle public priceOracle;

    // Balances per token
    mapping(address => uint256) public balances;
    address[] public supportedTokens;
    mapping(address => bool) public isSupported;

    // Authorized contracts that can draw from fund
    mapping(address => bool) public authorizedDrawers;

    // Stats
    uint256 public totalBadDebtCovered;
    uint256 public totalDeposited;

    // Rate limiting - max 20% of fund can be drawn per hour
    uint256 public constant RATE_LIMIT_PERIOD = 1 hours;
    uint256 public constant MAX_DRAW_BPS = 2000; // 20% per period
    uint256 public periodDrawnUSD;
    uint256 public periodStart;


    event TokenAdded(address indexed token);
    event DrawerAuthorized(address indexed drawer, bool authorized);
    event EmergencyWithdrawal(address indexed token, uint256 amount, address indexed recipient);


    error TokenNotSupported();
    error Unauthorized();
    error InsufficientFunds();
    error InvalidAmount();
    error RateLimitExceeded();


    constructor(
        address _priceOracle,
        address initialOwner
    ) Ownable(initialOwner) {
        priceOracle = ISimplePriceOracle(_priceOracle);
    }


    function deposit(address token, uint256 amount) external nonReentrant {
        if (!isSupported[token]) revert TokenNotSupported();
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        balances[token] += amount;
        totalDeposited += _getValueUSD(token, amount);

        emit FundsDeposited(token, amount);
    }

    /**
     * @notice Receive funds from liquidation or fees
     * @param token Token being deposited
     * @param amount Amount deposited
     * @dev Can be called by authorized contracts
     */
    function receiveFunds(address token, uint256 amount) external {
        if (!authorizedDrawers[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }

        // Token may already be transferred, just update balance
        balances[token] += amount;
        totalDeposited += _getValueUSD(token, amount);

        emit FundsDeposited(token, amount);
    }


    function coverBadDebt(address token, uint256 amount) external nonReentrant returns (uint256 covered) {
        if (!authorizedDrawers[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }

        if (balances[token] >= amount) {
            covered = amount;
        } else {
            covered = balances[token];
        }

        if (covered > 0) {
            uint256 coveredUSD = _getValueUSD(token, covered);
            _checkAndUpdateRateLimit(coveredUSD);

            balances[token] -= covered;
            totalBadDebtCovered += coveredUSD;

            IERC20(token).safeTransfer(msg.sender, covered);

            emit BadDebtCovered(bytes32(0), covered);
        }

        return covered;
    }

    /**
     * @notice Cover bad debt for a specific position
     * @param positionId Position that incurred bad debt
     * @param token Debt token
     * @param amount Amount to cover
     * @return covered Amount actually covered
     */
    function coverPositionBadDebt(
        bytes32 positionId,
        address token,
        uint256 amount
    ) external nonReentrant returns (uint256 covered) {
        if (!authorizedDrawers[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }

        if (balances[token] >= amount) {
            covered = amount;
        } else {
            covered = balances[token];
        }

        if (covered > 0) {
            uint256 coveredUSD = _getValueUSD(token, covered);
            _checkAndUpdateRateLimit(coveredUSD);

            balances[token] -= covered;
            totalBadDebtCovered += coveredUSD;

            IERC20(token).safeTransfer(msg.sender, covered);

            emit BadDebtCovered(positionId, covered);
        }

        return covered;
    }


    function getBalance(address token) external view returns (uint256) {
        return balances[token];
    }

    function getTotalValue() public view returns (uint256 totalValueUSD) {
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address token = supportedTokens[i];
            if (balances[token] > 0) {
                totalValueUSD += _getValueUSD(token, balances[token]);
            }
        }
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return supportedTokens;
    }

    function getStats() external view returns (
        uint256 _totalDeposited,
        uint256 _totalBadDebtCovered,
        uint256 currentValueUSD
    ) {
        return (totalDeposited, totalBadDebtCovered, getTotalValue());
    }


    function _getValueUSD(address token, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;

        uint256 price = priceOracle.getPrice(token);
        if (price == 0) return 0;

        // Assume 18 decimal tokens and 18 decimal prices
        return (amount * price) / 1e18;
    }


    /**
     * @notice Add a supported token
     * @param token Token address
     */
    function addSupportedToken(address token) external onlyOwner {
        if (!isSupported[token]) {
            isSupported[token] = true;
            supportedTokens.push(token);
            emit TokenAdded(token);
        }
    }

    /**
     * @notice Authorize a contract to draw from fund
     * @param drawer Contract address
     * @param authorized Whether authorized
     */
    function setAuthorizedDrawer(address drawer, bool authorized) external onlyOwner {
        authorizedDrawers[drawer] = authorized;
        emit DrawerAuthorized(drawer, authorized);
    }

    /**
     * @notice Emergency withdrawal by governance
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @param recipient Recipient address
     */
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address recipient
    ) external onlyOwner {
        if (balances[token] < amount) revert InsufficientFunds();

        balances[token] -= amount;
        IERC20(token).safeTransfer(recipient, amount);

        emit EmergencyWithdrawal(token, amount, recipient);
        emit FundsWithdrawn(token, amount, "Emergency withdrawal");
    }

    /**
     * @notice Update price oracle
     * @param _oracle New oracle address
     */
    function setPriceOracle(address _oracle) external onlyOwner {
        priceOracle = ISimplePriceOracle(_oracle);
    }

    function _checkAndUpdateRateLimit(uint256 amountUSD) internal {
        // Reset period if expired
        if (block.timestamp >= periodStart + RATE_LIMIT_PERIOD) {
            periodStart = block.timestamp;
            periodDrawnUSD = 0;
        }

        // Calculate max allowed draw
        uint256 totalValueUSD = getTotalValue();
        uint256 maxDrawUSD = (totalValueUSD * MAX_DRAW_BPS) / 10000;

        // Check rate limit
        if (periodDrawnUSD + amountUSD > maxDrawUSD) {
            revert RateLimitExceeded();
        }

        periodDrawnUSD += amountUSD;
    }

    function getRateLimitStatus() external view returns (
        uint256 periodRemaining,
        uint256 drawnThisPeriod,
        uint256 maxDraw
    ) {
        uint256 totalValueUSD = getTotalValue();
        maxDraw = (totalValueUSD * MAX_DRAW_BPS) / 10000;
        
        if (block.timestamp >= periodStart + RATE_LIMIT_PERIOD) {
            periodRemaining = 0;
            drawnThisPeriod = 0;
        } else {
            periodRemaining = (periodStart + RATE_LIMIT_PERIOD) - block.timestamp;
            drawnThisPeriod = periodDrawnUSD;
        }
    }
}
