// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IPerps
 * @notice Interface definitions for perpetual futures trading
 */

/// @notice Side of a position
enum PositionSide {
    Long,
    Short
}

/// @notice Margin type for positions
enum MarginType {
    Isolated,
    Cross
}

/// @notice Status of an order
enum OrderStatus {
    Pending,
    Filled,
    Cancelled,
    Expired
}

/// @notice Order type
enum OrderType {
    Market,
    Limit,
    StopLoss,
    TakeProfit
}

/// @notice Market configuration
struct MarketConfig {
    bytes32 marketId;
    string symbol;
    address baseAsset;
    address quoteAsset;
    address oracle;
    uint256 maxLeverage;
    uint256 maintenanceMarginBps;
    uint256 initialMarginBps;
    uint256 takerFeeBps;
    uint256 makerFeeBps;
    uint256 maxOpenInterest;
    uint256 fundingInterval;
    bool isActive;
}

/// @notice Position data
struct Position {
    bytes32 positionId;
    address trader;
    bytes32 marketId;
    PositionSide side;
    MarginType marginType;
    uint256 size;
    uint256 margin;
    address marginToken;
    uint256 entryPrice;
    int256 entryFundingIndex;
    uint256 lastUpdateTime;
    bool isOpen;
}

/// @notice Trade execution result
struct TradeResult {
    bytes32 positionId;
    uint256 executionPrice;
    uint256 fee;
    int256 realizedPnl;
    int256 fundingPaid;
}

/// @notice Order data
struct Order {
    bytes32 orderId;
    address trader;
    bytes32 marketId;
    PositionSide side;
    OrderType orderType;
    uint256 size;
    uint256 price;
    uint256 triggerPrice;
    uint256 margin;
    address marginToken;
    uint256 leverage;
    uint256 deadline;
    OrderStatus status;
}

/// @notice Funding rate data
struct FundingData {
    int256 fundingRate;
    int256 fundingIndex;
    uint256 lastFundingTime;
    uint256 nextFundingTime;
}

/// @notice Open interest data
struct OpenInterest {
    uint256 longOI;
    uint256 shortOI;
    uint256 totalOI;
}

interface IPerpetualMarket {
    // Events
    event MarketCreated(bytes32 indexed marketId, string symbol, address baseAsset);
    event PositionOpened(bytes32 indexed positionId, address indexed trader, bytes32 indexed marketId, PositionSide side, uint256 size, uint256 price);
    event PositionClosed(bytes32 indexed positionId, address indexed trader, uint256 exitPrice, int256 pnl);
    event PositionModified(bytes32 indexed positionId, uint256 newSize, uint256 newMargin);
    event PositionLiquidated(bytes32 indexed positionId, address indexed liquidator, uint256 liquidationPrice, uint256 reward);
    event FundingPaid(bytes32 indexed marketId, int256 fundingRate, int256 fundingIndex);
    event OrderPlaced(bytes32 indexed orderId, address indexed trader, bytes32 indexed marketId, OrderType orderType);
    event OrderFilled(bytes32 indexed orderId, bytes32 indexed positionId, uint256 fillPrice);
    event OrderCancelled(bytes32 indexed orderId);
    
    // Market management
    function createMarket(MarketConfig calldata config) external returns (bytes32 marketId);
    function updateMarket(bytes32 marketId, MarketConfig calldata config) external;
    function pauseMarket(bytes32 marketId) external;
    function unpauseMarket(bytes32 marketId) external;
    
    // Trading
    function openPosition(
        bytes32 marketId,
        address marginToken,
        uint256 marginAmount,
        uint256 size,
        PositionSide side,
        uint256 leverage
    ) external returns (TradeResult memory);
    
    function closePosition(bytes32 positionId) external returns (TradeResult memory);
    
    function decreasePosition(bytes32 positionId, uint256 sizeDecrease) external returns (TradeResult memory);
    
    function addMargin(bytes32 positionId, uint256 amount) external;
    
    function removeMargin(bytes32 positionId, uint256 amount) external;
    
    // Orders
    function placeOrder(Order calldata order) external returns (bytes32 orderId);
    function cancelOrder(bytes32 orderId) external;
    function executeOrder(bytes32 orderId) external returns (TradeResult memory);
    
    // Liquidation
    function liquidate(bytes32 positionId) external returns (uint256 liquidatorReward);
    function isLiquidatable(bytes32 positionId) external view returns (bool canLiquidate, uint256 healthFactor);
    function getLiquidationPrice(bytes32 positionId) external view returns (uint256);
    
    // View functions
    function getPosition(bytes32 positionId) external view returns (Position memory);
    function getTraderPositions(address trader) external view returns (bytes32[] memory);
    function getMarket(bytes32 marketId) external view returns (MarketConfig memory);
    function getAllMarkets() external view returns (bytes32[] memory);
    function getMarkPrice(bytes32 marketId) external view returns (uint256);
    function getIndexPrice(bytes32 marketId) external view returns (uint256);
    function getPositionPnl(bytes32 positionId) external view returns (int256 unrealizedPnl, int256 fundingPnl);
    function getPositionLeverage(bytes32 positionId) external view returns (uint256);
    function getFundingRate(bytes32 marketId) external view returns (int256);
    function getFundingData(bytes32 marketId) external view returns (FundingData memory);
    function getMarketOpenInterest(bytes32 marketId) external view returns (uint256 longOI, uint256 shortOI);
}

interface IMarginManager {
    event Deposit(address indexed trader, address indexed token, uint256 amount);
    event Withdraw(address indexed trader, address indexed token, uint256 amount);
    event CollateralLocked(address indexed trader, bytes32 indexed positionId, uint256 amount);
    event CollateralReleased(address indexed trader, bytes32 indexed positionId, uint256 amount);
    
    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amount) external;
    function getCollateralBalance(address trader, address token) external view returns (uint256);
    function getTotalCollateralValue(address trader) external view returns (uint256 totalValueUSD);
    function getAvailableCollateral(address trader, address token) external view returns (uint256);
    function getAcceptedTokens() external view returns (address[] memory);
    function lockCollateral(address trader, address token, uint256 amount, bytes32 positionId) external;
    function releaseCollateral(address trader, address token, uint256 amount, bytes32 positionId) external;
}

interface IFundingRateEngine {
    function calculateFundingRate(bytes32 marketId) external view returns (int256);
    function updateFunding(bytes32 marketId) external returns (int256 fundingRate);
    function getFundingPayment(bytes32 positionId) external view returns (int256);
    function settleFunding(bytes32 positionId) external returns (int256 payment);
}

interface ILiquidationEngine {
    event Liquidation(bytes32 indexed positionId, address indexed liquidator, uint256 penalty, uint256 reward);
    
    function canLiquidate(bytes32 positionId) external view returns (bool);
    function liquidate(bytes32 positionId) external returns (uint256 liquidatorReward);
    function partialLiquidate(bytes32 positionId, uint256 percentage) external returns (uint256 liquidatorReward);
}

interface IInsuranceFund {
    event FundDeposit(address indexed token, uint256 amount);
    event FundWithdraw(address indexed token, uint256 amount);
    event DeficitCovered(bytes32 indexed positionId, uint256 amount);
    
    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amount) external;
    function coverDeficit(address token, uint256 amount) external;
    function getBalance(address token) external view returns (uint256);
    function getTotalValue() external view returns (uint256);
}

interface IPriceOracle {
    function getPrice(address asset) external view returns (uint256 price, uint256 timestamp);
    function getMarkPrice(bytes32 marketId) external view returns (uint256);
    function getIndexPrice(bytes32 marketId) external view returns (uint256);
}

