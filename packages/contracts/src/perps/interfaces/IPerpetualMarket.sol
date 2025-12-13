// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IPerpetualMarket
 * @notice Interface for the Perpetual Futures Trading Engine
 * @dev Core trading functionality for perps DEX
 */
interface IPerpetualMarket {
    // ============ Enums ============

    enum PositionSide {
        Long,
        Short
    }

    enum MarginType {
        Isolated,
        Cross
    }

    // ============ Structs ============

    struct Position {
        bytes32 positionId;
        address trader;
        bytes32 marketId;
        PositionSide side;
        MarginType marginType;
        uint256 size; // Position size in base asset (8 decimals)
        uint256 margin; // Collateral amount (token decimals)
        address marginToken; // Collateral token
        uint256 entryPrice; // Average entry price (8 decimals)
        int256 entryFundingIndex; // Funding index at entry
        uint256 lastUpdateTime;
        bool isOpen;
    }

    struct Market {
        bytes32 marketId;
        string symbol; // e.g., "BTC-PERP", "ETH-PERP"
        address baseAsset; // Underlying (address(0) for external like BTC)
        uint256 maxLeverage; // Max leverage (e.g., 20 = 20x)
        uint256 maintenanceMarginBps; // Maintenance margin ratio (e.g., 500 = 5%)
        uint256 takerFeeBps; // Taker fee (e.g., 5 = 0.05%)
        uint256 makerFeeBps; // Maker fee (e.g., 2 = 0.02%)
        uint256 maxOpenInterest; // Max open interest cap
        uint256 currentOpenInterest;
        bool isActive;
    }

    struct FundingState {
        int256 fundingRate; // Current hourly funding rate (scaled by 1e18)
        int256 cumulativeFundingIndex; // Cumulative funding (scaled by 1e18)
        uint256 lastFundingTime;
    }

    struct TradeResult {
        bytes32 positionId;
        uint256 executionPrice;
        uint256 fee;
        int256 realizedPnl;
        int256 fundingPaid;
    }

    // ============ Events ============

    event PositionOpened(
        bytes32 indexed positionId,
        address indexed trader,
        bytes32 indexed marketId,
        PositionSide side,
        uint256 size,
        uint256 margin,
        uint256 entryPrice,
        uint256 leverage
    );

    event PositionIncreased(
        bytes32 indexed positionId, uint256 sizeIncrease, uint256 marginAdded, uint256 newEntryPrice
    );

    event PositionDecreased(
        bytes32 indexed positionId, uint256 sizeDecrease, int256 realizedPnl, uint256 marginReturned
    );

    event PositionClosed(
        bytes32 indexed positionId,
        address indexed trader,
        int256 realizedPnl,
        int256 fundingPaid,
        uint256 marginReturned
    );

    event PositionLiquidated(
        bytes32 indexed positionId,
        address indexed trader,
        address indexed liquidator,
        uint256 size,
        uint256 liquidationPrice,
        uint256 liquidatorReward
    );

    event MarginAdded(bytes32 indexed positionId, uint256 amount, uint256 newMargin);

    event MarginRemoved(bytes32 indexed positionId, uint256 amount, uint256 newMargin);

    event FundingUpdated(bytes32 indexed marketId, int256 fundingRate, int256 cumulativeFundingIndex);

    event MarketAdded(bytes32 indexed marketId, string symbol, uint256 maxLeverage);

    event TradeFeeCollected(bytes32 indexed positionId, address indexed trader, uint256 fee, address feeToken);

    // ============ Trading Functions ============

    /**
     * @notice Open a new perpetual position
     * @param marketId Market to trade
     * @param marginToken Collateral token
     * @param marginAmount Collateral amount
     * @param size Position size in base asset
     * @param side Long or Short
     * @param leverage Desired leverage (must be <= maxLeverage)
     * @return result Trade execution result
     */
    function openPosition(
        bytes32 marketId,
        address marginToken,
        uint256 marginAmount,
        uint256 size,
        PositionSide side,
        uint256 leverage
    ) external returns (TradeResult memory result);

    /**
     * @notice Increase an existing position
     * @param positionId Position to increase
     * @param additionalMargin Extra collateral to add
     * @param sizeIncrease Additional size
     * @return result Trade execution result
     */
    function increasePosition(bytes32 positionId, uint256 additionalMargin, uint256 sizeIncrease)
        external
        returns (TradeResult memory result);

    /**
     * @notice Decrease or close a position
     * @param positionId Position to decrease
     * @param sizeDecrease Amount to close (use type(uint256).max for full close)
     * @return result Trade execution result
     */
    function decreasePosition(bytes32 positionId, uint256 sizeDecrease) external returns (TradeResult memory result);

    /**
     * @notice Add margin to a position (reduce leverage)
     * @param positionId Position ID
     * @param amount Amount to add
     */
    function addMargin(bytes32 positionId, uint256 amount) external;

    /**
     * @notice Remove margin from a position (increase leverage)
     * @param positionId Position ID
     * @param amount Amount to remove
     */
    function removeMargin(bytes32 positionId, uint256 amount) external;

    // ============ Liquidation ============

    /**
     * @notice Liquidate an underwater position
     * @param positionId Position to liquidate
     * @return liquidatorReward Reward paid to liquidator
     */
    function liquidate(bytes32 positionId) external returns (uint256 liquidatorReward);

    /**
     * @notice Check if a position can be liquidated
     * @param positionId Position to check
     * @return canLiquidate Whether position is liquidatable
     * @return healthFactor Position health (< 1e18 = liquidatable)
     */
    function isLiquidatable(bytes32 positionId) external view returns (bool canLiquidate, uint256 healthFactor);

    // ============ Funding ============

    /**
     * @notice Update funding rate for a market
     * @param marketId Market to update
     * @dev Can be called by anyone, typically by keepers
     */
    function updateFunding(bytes32 marketId) external;

    /**
     * @notice Get current funding rate
     * @param marketId Market ID
     * @return rate Current hourly funding rate (positive = longs pay shorts)
     */
    function getFundingRate(bytes32 marketId) external view returns (int256 rate);

    /**
     * @notice Get pending funding for a position
     * @param positionId Position ID
     * @return pendingFunding Pending funding payment (positive = owes, negative = receives)
     */
    function getPendingFunding(bytes32 positionId) external view returns (int256 pendingFunding);

    // ============ View Functions ============

    /**
     * @notice Get position details
     * @param positionId Position ID
     * @return position Position data
     */
    function getPosition(bytes32 positionId) external view returns (Position memory position);

    /**
     * @notice Get all positions for a trader
     * @param trader Trader address
     * @return positionIds Array of position IDs
     */
    function getTraderPositions(address trader) external view returns (bytes32[] memory positionIds);

    /**
     * @notice Get market details
     * @param marketId Market ID
     * @return market Market data
     */
    function getMarket(bytes32 marketId) external view returns (Market memory market);

    /**
     * @notice Get current mark price for a market
     * @param marketId Market ID
     * @return markPrice Current mark price (8 decimals)
     */
    function getMarkPrice(bytes32 marketId) external view returns (uint256 markPrice);

    /**
     * @notice Get index (spot) price for a market
     * @param marketId Market ID
     * @return indexPrice Current index price (8 decimals)
     */
    function getIndexPrice(bytes32 marketId) external view returns (uint256 indexPrice);

    /**
     * @notice Calculate position PnL
     * @param positionId Position ID
     * @return unrealizedPnl Unrealized PnL (can be negative)
     * @return fundingPnl Pending funding PnL
     */
    function getPositionPnl(bytes32 positionId) external view returns (int256 unrealizedPnl, int256 fundingPnl);

    /**
     * @notice Get position leverage
     * @param positionId Position ID
     * @return leverage Current effective leverage
     */
    function getPositionLeverage(bytes32 positionId) external view returns (uint256 leverage);

    /**
     * @notice Get liquidation price for a position
     * @param positionId Position ID
     * @return liquidationPrice Price at which position gets liquidated
     */
    function getLiquidationPrice(bytes32 positionId) external view returns (uint256 liquidationPrice);

    // ============ Admin Functions ============

    function addMarket(
        bytes32 marketId,
        string calldata symbol,
        address baseAsset,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 takerFeeBps,
        uint256 makerFeeBps,
        uint256 maxOpenInterest
    ) external;

    function updateMarket(bytes32 marketId, bool isActive) external;

    function setMaxLeverage(bytes32 marketId, uint256 maxLeverage) external;

    function pause() external;

    function unpause() external;
}

/**
 * @title IMarginManager
 * @notice Interface for margin and collateral management
 */
interface IMarginManager {
    struct CollateralInfo {
        address token;
        uint256 balance;
        uint256 valueUSD;
        uint256 weight; // Collateral weight (e.g., 10000 = 100%, 9000 = 90%)
    }

    event CollateralDeposited(address indexed trader, address indexed token, uint256 amount);

    event CollateralWithdrawn(address indexed trader, address indexed token, uint256 amount);

    event CollateralTokenAdded(address indexed token, uint256 weight);

    /**
     * @notice Deposit collateral
     * @param token Collateral token
     * @param amount Amount to deposit
     */
    function deposit(address token, uint256 amount) external;

    /**
     * @notice Deposit collateral via EIL (cross-chain)
     * @param token Collateral token
     * @param amount Amount to deposit
     * @param voucherId EIL voucher ID
     */
    function depositCrossChain(address token, uint256 amount, bytes32 voucherId) external;

    /**
     * @notice Withdraw collateral
     * @param token Collateral token
     * @param amount Amount to withdraw
     */
    function withdraw(address token, uint256 amount) external;

    /**
     * @notice Reserve margin for a position
     * @param trader Trader address
     * @param token Margin token
     * @param amount Amount to reserve
     */
    function reserveMargin(address trader, address token, uint256 amount) external;

    /**
     * @notice Release reserved margin
     * @param trader Trader address
     * @param token Margin token
     * @param amount Amount to release
     */
    function releaseMargin(address trader, address token, uint256 amount) external;

    /**
     * @notice Transfer margin between accounts
     * @param from Source trader
     * @param to Destination address
     * @param token Margin token
     * @param amount Amount to transfer
     */
    function transferMargin(address from, address to, address token, uint256 amount) external;

    /**
     * @notice Deduct margin for fees/losses
     * @param trader Trader address
     * @param token Margin token
     * @param amount Amount to deduct
     * @param recipient Fee recipient
     */
    function deductMargin(address trader, address token, uint256 amount, address recipient) external;

    /**
     * @notice Credit margin (e.g., from PnL)
     * @param trader Trader address
     * @param token Margin token
     * @param amount Amount to credit
     */
    function creditMargin(address trader, address token, uint256 amount) external;

    /**
     * @notice Get trader's collateral balance
     * @param trader Trader address
     * @param token Collateral token
     * @return balance Token balance
     */
    function getCollateralBalance(address trader, address token) external view returns (uint256 balance);

    /**
     * @notice Get trader's total collateral value in USD
     * @param trader Trader address
     * @return totalValueUSD Total collateral value
     */
    function getTotalCollateralValue(address trader) external view returns (uint256 totalValueUSD);

    /**
     * @notice Get available (withdrawable) collateral
     * @param trader Trader address
     * @param token Collateral token
     * @return available Withdrawable amount
     */
    function getAvailableCollateral(address trader, address token) external view returns (uint256 available);

    /**
     * @notice Check if token is accepted as collateral
     * @param token Token address
     * @return accepted Whether token is accepted
     * @return weight Collateral weight
     */
    function isCollateralAccepted(address token) external view returns (bool accepted, uint256 weight);
}

/**
 * @title ILiquidationEngine
 * @notice Interface for liquidation management
 */
interface ILiquidationEngine {
    event LiquidationExecuted(
        bytes32 indexed positionId,
        address indexed liquidator,
        uint256 liquidationPrice,
        uint256 liquidatorReward,
        uint256 insuranceFundContribution
    );

    event BadDebtSocialized(bytes32 indexed positionId, uint256 badDebtAmount);

    /**
     * @notice Execute liquidation
     * @param positionId Position to liquidate
     * @return reward Liquidator reward
     */
    function liquidate(bytes32 positionId) external returns (uint256 reward);

    /**
     * @notice Batch liquidate multiple positions
     * @param positionIds Positions to liquidate
     * @return rewards Array of rewards
     */
    function batchLiquidate(bytes32[] calldata positionIds) external returns (uint256[] memory rewards);

    /**
     * @notice Get liquidation parameters
     * @return liquidationBonus Bonus to liquidators (bps)
     * @return insuranceFee Fee to insurance fund (bps)
     * @return maxLiquidationSize Max size per liquidation
     */
    function getLiquidationParams()
        external
        view
        returns (uint256 liquidationBonus, uint256 insuranceFee, uint256 maxLiquidationSize);
}

/**
 * @title IInsuranceFund
 * @notice Interface for the insurance fund
 */
interface IInsuranceFund {
    event FundsDeposited(address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed token, uint256 amount, string reason);
    event BadDebtCovered(bytes32 indexed positionId, uint256 amount);

    /**
     * @notice Deposit funds into insurance
     * @param token Token to deposit
     * @param amount Amount to deposit
     */
    function deposit(address token, uint256 amount) external;

    /**
     * @notice Cover bad debt from liquidation
     * @param token Debt token
     * @param amount Amount to cover
     * @return covered Amount actually covered
     */
    function coverBadDebt(address token, uint256 amount) external returns (uint256 covered);

    /**
     * @notice Get insurance fund balance
     * @param token Token to check
     * @return balance Current balance
     */
    function getBalance(address token) external view returns (uint256 balance);

    /**
     * @notice Get total insurance fund value in USD
     * @return totalValueUSD Total value
     */
    function getTotalValue() external view returns (uint256 totalValueUSD);
}
