// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {
    IPerpetualMarket,
    IMarginManager,
    IFundingRateEngine,
    ILiquidationEngine,
    IInsuranceFund,
    IPriceOracle,
    MarketConfig,
    Position,
    TradeResult,
    Order,
    FundingData,
    OpenInterest,
    PositionSide,
    MarginType,
    OrderType,
    OrderStatus
} from "./interfaces/IPerps.sol";
import {PerpMath} from "./libraries/PerpMath.sol";

/**
 * @title PerpetualMarket
 * @notice Main perpetual futures trading engine
 * @dev Supports isolated and cross-margin, market and limit orders, up to 50x leverage
 */
contract PerpetualMarket is IPerpetualMarket, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using PerpMath for *;

    // Constants
    uint256 public constant MAX_LEVERAGE = 50;
    uint256 public constant MIN_MARGIN = 1e15; // 0.001 in 18 decimals
    uint256 public constant LIQUIDATION_PENALTY_BPS = 50; // 0.5%
    uint256 public constant LIQUIDATOR_REWARD_BPS = 25; // 0.25% to liquidator
    uint256 public constant FUNDING_INTERVAL = 1 hours;
    uint256 public constant ORACLE_CHANGE_DELAY = 48 hours; // SECURITY: Oracle change timelock

    // External contracts
    IMarginManager public immutable marginManager;
    IInsuranceFund public immutable insuranceFund;
    IPriceOracle public priceOracle;

    // SECURITY: Oracle change timelock
    address public pendingOracle;
    uint256 public oracleChangeTime;

    // SECURITY: Global pause
    bool public globalPaused;

    // Storage
    mapping(bytes32 => MarketConfig) public markets;
    mapping(bytes32 => Position) public positions;
    mapping(bytes32 => Order) public orders;
    mapping(bytes32 => FundingData) public fundingData;
    mapping(bytes32 => OpenInterest) public openInterest;
    mapping(address => bytes32[]) public traderPositions;
    mapping(address => bytes32[]) public traderOrders;

    bytes32[] public allMarkets;
    uint256 public positionCounter;
    uint256 public orderCounter;

    // Paused markets
    mapping(bytes32 => bool) public marketPaused;

    // Events for security features
    event OracleChangeProposed(address indexed currentOracle, address indexed newOracle, uint256 effectiveTime);
    event OracleChangeExecuted(address indexed oldOracle, address indexed newOracle);
    event OracleChangeCancelled(address indexed cancelledOracle);
    event GlobalPaused(address indexed by);
    event GlobalUnpaused(address indexed by);

    error OracleChangePending();
    error NoOracleChangePending();
    error OracleChangeNotReady();
    error GloballyPaused();

    constructor(address _marginManager, address _insuranceFund, address _priceOracle, address _owner) Ownable(_owner) {
        marginManager = IMarginManager(_marginManager);
        insuranceFund = IInsuranceFund(_insuranceFund);
        priceOracle = IPriceOracle(_priceOracle);
    }

    modifier marketActive(bytes32 marketId) {
        require(!globalPaused, "Globally paused");
        require(markets[marketId].isActive, "Market inactive");
        require(!marketPaused[marketId], "Market paused");
        _;
    }

    modifier notGloballyPaused() {
        if (globalPaused) revert GloballyPaused();
        _;
    }

    modifier positionExists(bytes32 positionId) {
        require(positions[positionId].isOpen, "Position not found");
        _;
    }

    function createMarket(MarketConfig calldata config) external onlyOwner returns (bytes32 marketId) {
        marketId = keccak256(abi.encodePacked(config.symbol, block.timestamp, allMarkets.length));

        require(markets[marketId].marketId == bytes32(0), "Market exists");
        require(config.maxLeverage <= MAX_LEVERAGE, "Leverage too high");
        require(config.maxLeverage > 0, "Leverage must be > 0");
        require(config.maintenanceMarginBps > 0 && config.maintenanceMarginBps < 10000, "Invalid maintenance margin");

        markets[marketId] = MarketConfig({
            marketId: marketId,
            symbol: config.symbol,
            baseAsset: config.baseAsset,
            quoteAsset: config.quoteAsset,
            oracle: config.oracle,
            maxLeverage: config.maxLeverage,
            maintenanceMarginBps: config.maintenanceMarginBps,
            initialMarginBps: config.initialMarginBps,
            takerFeeBps: config.takerFeeBps,
            makerFeeBps: config.makerFeeBps,
            maxOpenInterest: config.maxOpenInterest,
            fundingInterval: config.fundingInterval > 0 ? config.fundingInterval : FUNDING_INTERVAL,
            isActive: true
        });

        fundingData[marketId] = FundingData({
            fundingRate: 0,
            fundingIndex: 0,
            lastFundingTime: block.timestamp,
            nextFundingTime: block.timestamp + FUNDING_INTERVAL
        });

        allMarkets.push(marketId);

        emit MarketCreated(marketId, config.symbol, config.baseAsset);
    }

    function updateMarket(bytes32 marketId, MarketConfig calldata config) external onlyOwner {
        require(markets[marketId].marketId != bytes32(0), "Market not found");
        require(config.maxLeverage <= MAX_LEVERAGE, "Leverage too high");

        markets[marketId] = config;
    }

    function pauseMarket(bytes32 marketId) external onlyOwner {
        marketPaused[marketId] = true;
    }

    function unpauseMarket(bytes32 marketId) external onlyOwner {
        marketPaused[marketId] = false;
    }

    /// @notice Propose a new price oracle - requires 48-hour delay
    /// @dev SECURITY: Prevents instant oracle manipulation attacks
    function proposePriceOracle(address _priceOracle) public onlyOwner {
        require(_priceOracle != address(0), "Invalid oracle");
        if (pendingOracle != address(0)) revert OracleChangePending();

        pendingOracle = _priceOracle;
        oracleChangeTime = block.timestamp + ORACLE_CHANGE_DELAY;

        emit OracleChangeProposed(address(priceOracle), _priceOracle, oracleChangeTime);
    }

    /// @notice Execute oracle change after timelock expires
    function executePriceOracleChange() external onlyOwner {
        if (pendingOracle == address(0)) revert NoOracleChangePending();
        if (block.timestamp < oracleChangeTime) revert OracleChangeNotReady();

        address oldOracle = address(priceOracle);
        priceOracle = IPriceOracle(pendingOracle);

        emit OracleChangeExecuted(oldOracle, pendingOracle);

        pendingOracle = address(0);
        oracleChangeTime = 0;
    }

    /// @notice Cancel pending oracle change
    function cancelPriceOracleChange() external onlyOwner {
        if (pendingOracle == address(0)) revert NoOracleChangePending();

        emit OracleChangeCancelled(pendingOracle);

        pendingOracle = address(0);
        oracleChangeTime = 0;
    }

    /// @notice Legacy setPriceOracle - now requires timelock
    function setPriceOracle(address _priceOracle) external onlyOwner {
        proposePriceOracle(_priceOracle);
    }

    /// @notice Emergency global pause - halts all trading
    /// @dev SECURITY: Can be used during exploits or critical bugs
    function emergencyPause() external onlyOwner {
        globalPaused = true;
        emit GlobalPaused(msg.sender);
    }

    /// @notice Unpause global trading
    function emergencyUnpause() external onlyOwner {
        globalPaused = false;
        emit GlobalUnpaused(msg.sender);
    }

    function openPosition(
        bytes32 marketId,
        address marginToken,
        uint256 marginAmount,
        uint256 size,
        PositionSide side,
        uint256 leverage
    ) external nonReentrant marketActive(marketId) returns (TradeResult memory result) {
        MarketConfig memory market = markets[marketId];

        require(leverage > 0 && leverage <= market.maxLeverage, "Invalid leverage");
        require(size > 0, "Size must be > 0");
        require(marginAmount >= MIN_MARGIN, "Margin too small");

        // Get current price
        uint256 executionPrice = priceOracle.getMarkPrice(marketId);
        require(executionPrice > 0, "Invalid price");

        // Calculate notional and validate margin
        uint256 notional = PerpMath.calculateNotional(size, executionPrice);
        uint256 requiredMargin = PerpMath.calculateRequiredMargin(notional, leverage);
        require(marginAmount >= requiredMargin, "Insufficient margin");

        // Check open interest limits
        OpenInterest storage oi = openInterest[marketId];
        if (side == PositionSide.Long) {
            require(oi.longOI + notional <= market.maxOpenInterest, "Max OI exceeded");
            oi.longOI += notional;
        } else {
            require(oi.shortOI + notional <= market.maxOpenInterest, "Max OI exceeded");
            oi.shortOI += notional;
        }
        oi.totalOI = oi.longOI + oi.shortOI;

        // Transfer margin from trader
        IERC20(marginToken).safeTransferFrom(msg.sender, address(marginManager), marginAmount);

        // Calculate and charge fee
        uint256 fee = PerpMath.calculateFee(notional, market.takerFeeBps);

        // Generate position ID
        bytes32 positionId = keccak256(abi.encodePacked(msg.sender, marketId, ++positionCounter));

        // Create position
        positions[positionId] = Position({
            positionId: positionId,
            trader: msg.sender,
            marketId: marketId,
            side: side,
            marginType: MarginType.Isolated,
            size: size,
            margin: marginAmount - fee,
            marginToken: marginToken,
            entryPrice: executionPrice,
            entryFundingIndex: fundingData[marketId].fundingIndex,
            lastUpdateTime: block.timestamp,
            isOpen: true
        });

        // Lock collateral
        marginManager.lockCollateral(msg.sender, marginToken, marginAmount, positionId);

        // Track position for trader
        traderPositions[msg.sender].push(positionId);

        result = TradeResult({
            positionId: positionId,
            executionPrice: executionPrice,
            fee: fee,
            realizedPnl: 0,
            fundingPaid: 0
        });

        emit PositionOpened(positionId, msg.sender, marketId, side, size, executionPrice);
    }

    function closePosition(bytes32 positionId)
        external
        nonReentrant
        positionExists(positionId)
        returns (TradeResult memory result)
    {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "Not position owner");

        return _closePosition(positionId, position.size);
    }

    function decreasePosition(bytes32 positionId, uint256 sizeDecrease)
        external
        nonReentrant
        positionExists(positionId)
        returns (TradeResult memory result)
    {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "Not position owner");
        require(sizeDecrease <= position.size, "Size exceeds position");

        return _closePosition(positionId, sizeDecrease);
    }

    function _closePosition(bytes32 positionId, uint256 closeSize) internal returns (TradeResult memory result) {
        Position storage position = positions[positionId];
        MarketConfig memory market = markets[position.marketId];

        require(!marketPaused[position.marketId], "Market paused");

        uint256 executionPrice = priceOracle.getMarkPrice(position.marketId);
        require(executionPrice > 0, "Invalid price");

        // Settle funding
        int256 fundingPayment = _settleFunding(positionId);

        // Calculate realized PnL
        int256 realizedPnl = PerpMath.calculateRealizedPnl(position, closeSize, executionPrice);

        // Calculate fee
        uint256 closeNotional = PerpMath.calculateNotional(closeSize, executionPrice);
        uint256 fee = PerpMath.calculateFee(closeNotional, market.takerFeeBps);

        // Update open interest
        OpenInterest storage oi = openInterest[position.marketId];
        uint256 notionalDecrease = PerpMath.calculateNotional(closeSize, position.entryPrice);
        if (position.side == PositionSide.Long) {
            oi.longOI = oi.longOI > notionalDecrease ? oi.longOI - notionalDecrease : 0;
        } else {
            oi.shortOI = oi.shortOI > notionalDecrease ? oi.shortOI - notionalDecrease : 0;
        }
        oi.totalOI = oi.longOI + oi.shortOI;

        // Calculate amount to return to trader
        uint256 marginReturn;
        if (closeSize == position.size) {
            // Full close
            int256 totalReturn = int256(position.margin) + realizedPnl + fundingPayment - int256(fee);

            if (totalReturn > 0) {
                marginReturn = uint256(totalReturn);
                marginManager.releaseCollateral(position.trader, position.marginToken, marginReturn, positionId);
                IERC20(position.marginToken).safeTransfer(position.trader, marginReturn);
            } else if (totalReturn < 0) {
                // Loss exceeds margin - covered by insurance fund
                insuranceFund.coverDeficit(position.marginToken, uint256(-totalReturn));
            }

            position.isOpen = false;
            position.size = 0;
            position.margin = 0;

            emit PositionClosed(positionId, position.trader, executionPrice, realizedPnl);
        } else {
            // Partial close
            uint256 marginReduction = (position.margin * closeSize) / position.size;
            int256 partialReturn = int256(marginReduction) + realizedPnl + fundingPayment - int256(fee);

            if (partialReturn > 0) {
                marginReturn = uint256(partialReturn);
                marginManager.releaseCollateral(position.trader, position.marginToken, marginReturn, positionId);
                IERC20(position.marginToken).safeTransfer(position.trader, marginReturn);
            }

            position.size -= closeSize;
            position.margin -= marginReduction;
            position.lastUpdateTime = block.timestamp;

            emit PositionModified(positionId, position.size, position.margin);
        }

        result = TradeResult({
            positionId: positionId,
            executionPrice: executionPrice,
            fee: fee,
            realizedPnl: realizedPnl,
            fundingPaid: fundingPayment
        });
    }

    function addMargin(bytes32 positionId, uint256 amount) external nonReentrant positionExists(positionId) {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "Not position owner");

        IERC20(position.marginToken).safeTransferFrom(msg.sender, address(marginManager), amount);
        marginManager.lockCollateral(msg.sender, position.marginToken, amount, positionId);

        position.margin += amount;
        position.lastUpdateTime = block.timestamp;

        emit PositionModified(positionId, position.size, position.margin);
    }

    function removeMargin(bytes32 positionId, uint256 amount) external nonReentrant positionExists(positionId) {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "Not position owner");

        MarketConfig memory market = markets[position.marketId];
        uint256 currentPrice = priceOracle.getMarkPrice(position.marketId);

        // Check that remaining margin is sufficient
        uint256 notional = PerpMath.calculateNotional(position.size, currentPrice);
        int256 pnl = PerpMath.calculateUnrealizedPnl(position, currentPrice);

        require(position.margin > amount, "Cannot remove all margin");
        uint256 newMargin = position.margin - amount;

        uint256 marginRatio = PerpMath.calculateMarginRatio(newMargin, pnl, notional);
        require(marginRatio >= market.initialMarginBps, "Below initial margin");

        position.margin = newMargin;
        position.lastUpdateTime = block.timestamp;

        marginManager.releaseCollateral(position.trader, position.marginToken, amount, positionId);
        IERC20(position.marginToken).safeTransfer(position.trader, amount);

        emit PositionModified(positionId, position.size, position.margin);
    }

    function placeOrder(Order calldata order)
        external
        nonReentrant
        marketActive(order.marketId)
        returns (bytes32 orderId)
    {
        require(order.size > 0, "Size must be > 0");
        require(order.margin >= MIN_MARGIN, "Margin too small");
        require(order.deadline > block.timestamp, "Order expired");

        MarketConfig memory market = markets[order.marketId];
        require(order.leverage > 0 && order.leverage <= market.maxLeverage, "Invalid leverage");

        orderId = keccak256(abi.encodePacked(msg.sender, order.marketId, ++orderCounter));

        // Transfer margin
        IERC20(order.marginToken).safeTransferFrom(msg.sender, address(this), order.margin);

        orders[orderId] = Order({
            orderId: orderId,
            trader: msg.sender,
            marketId: order.marketId,
            side: order.side,
            orderType: order.orderType,
            size: order.size,
            price: order.price,
            triggerPrice: order.triggerPrice,
            margin: order.margin,
            marginToken: order.marginToken,
            leverage: order.leverage,
            deadline: order.deadline,
            status: OrderStatus.Pending
        });

        traderOrders[msg.sender].push(orderId);

        emit OrderPlaced(orderId, msg.sender, order.marketId, order.orderType);
    }

    function cancelOrder(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.trader == msg.sender, "Not order owner");
        require(order.status == OrderStatus.Pending, "Order not pending");

        order.status = OrderStatus.Cancelled;

        // Return margin
        IERC20(order.marginToken).safeTransfer(msg.sender, order.margin);

        emit OrderCancelled(orderId);
    }

    function executeOrder(bytes32 orderId) external nonReentrant returns (TradeResult memory result) {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.Pending, "Order not pending");
        require(order.deadline >= block.timestamp, "Order expired");
        require(!marketPaused[order.marketId], "Market paused");

        uint256 currentPrice = priceOracle.getMarkPrice(order.marketId);

        bool canExecute = false;
        if (order.orderType == OrderType.Market) {
            canExecute = true;
        } else if (order.orderType == OrderType.Limit) {
            if (order.side == PositionSide.Long) {
                canExecute = currentPrice <= order.price;
            } else {
                canExecute = currentPrice >= order.price;
            }
        } else if (order.orderType == OrderType.StopLoss || order.orderType == OrderType.TakeProfit) {
            if (order.side == PositionSide.Long) {
                canExecute = currentPrice <= order.triggerPrice;
            } else {
                canExecute = currentPrice >= order.triggerPrice;
            }
        }

        require(canExecute, "Execution conditions not met");

        order.status = OrderStatus.Filled;

        // Transfer margin to margin manager
        IERC20(order.marginToken).safeTransfer(address(marginManager), order.margin);

        // Open position
        MarketConfig memory market = markets[order.marketId];
        uint256 notional = PerpMath.calculateNotional(order.size, currentPrice);
        uint256 fee = PerpMath.calculateFee(notional, market.takerFeeBps);

        bytes32 positionId = keccak256(abi.encodePacked(order.trader, order.marketId, ++positionCounter));

        // Update OI
        OpenInterest storage oi = openInterest[order.marketId];
        if (order.side == PositionSide.Long) {
            require(oi.longOI + notional <= market.maxOpenInterest, "Max OI exceeded");
            oi.longOI += notional;
        } else {
            require(oi.shortOI + notional <= market.maxOpenInterest, "Max OI exceeded");
            oi.shortOI += notional;
        }
        oi.totalOI = oi.longOI + oi.shortOI;

        positions[positionId] = Position({
            positionId: positionId,
            trader: order.trader,
            marketId: order.marketId,
            side: order.side,
            marginType: MarginType.Isolated,
            size: order.size,
            margin: order.margin - fee,
            marginToken: order.marginToken,
            entryPrice: currentPrice,
            entryFundingIndex: fundingData[order.marketId].fundingIndex,
            lastUpdateTime: block.timestamp,
            isOpen: true
        });

        marginManager.lockCollateral(order.trader, order.marginToken, order.margin, positionId);
        traderPositions[order.trader].push(positionId);

        result = TradeResult({
            positionId: positionId,
            executionPrice: currentPrice,
            fee: fee,
            realizedPnl: 0,
            fundingPaid: 0
        });

        emit OrderFilled(orderId, positionId, currentPrice);
        emit PositionOpened(positionId, order.trader, order.marketId, order.side, order.size, currentPrice);
    }

    function liquidate(bytes32 positionId)
        external
        nonReentrant
        positionExists(positionId)
        returns (uint256 liquidatorReward)
    {
        Position storage position = positions[positionId];
        MarketConfig memory market = markets[position.marketId];

        uint256 currentPrice = priceOracle.getMarkPrice(position.marketId);
        int256 pnl = PerpMath.calculateUnrealizedPnl(position, currentPrice);
        uint256 notional = PerpMath.calculateNotional(position.size, currentPrice);

        require(
            PerpMath.isLiquidatable(position.margin, pnl, notional, market.maintenanceMarginBps),
            "Position not liquidatable"
        );

        // Calculate penalty
        uint256 penalty = PerpMath.calculateLiquidationPenalty(notional, LIQUIDATION_PENALTY_BPS);
        liquidatorReward = (penalty * LIQUIDATOR_REWARD_BPS) / LIQUIDATION_PENALTY_BPS;
        uint256 insuranceFundContribution = penalty - liquidatorReward;

        // Update OI
        OpenInterest storage oi = openInterest[position.marketId];
        uint256 notionalDecrease = PerpMath.calculateNotional(position.size, position.entryPrice);
        if (position.side == PositionSide.Long) {
            oi.longOI = oi.longOI > notionalDecrease ? oi.longOI - notionalDecrease : 0;
        } else {
            oi.shortOI = oi.shortOI > notionalDecrease ? oi.shortOI - notionalDecrease : 0;
        }
        oi.totalOI = oi.longOI + oi.shortOI;

        // Calculate remaining margin after PnL
        int256 remainingMargin = int256(position.margin) + pnl;

        // Release collateral
        marginManager.releaseCollateral(position.trader, position.marginToken, position.margin, positionId);

        if (remainingMargin > int256(penalty)) {
            // Return excess to trader
            uint256 returnToTrader = uint256(remainingMargin) - penalty;
            IERC20(position.marginToken).safeTransfer(position.trader, returnToTrader);
        } else if (remainingMargin < 0) {
            // Loss exceeds margin - insurance fund covers
            insuranceFund.coverDeficit(position.marginToken, uint256(-remainingMargin));
        }

        // Pay liquidator and insurance fund
        if (liquidatorReward > 0) {
            IERC20(position.marginToken).safeTransfer(msg.sender, liquidatorReward);
        }
        if (insuranceFundContribution > 0 && remainingMargin > int256(liquidatorReward)) {
            insuranceFund.deposit(position.marginToken, insuranceFundContribution);
        }

        position.isOpen = false;
        position.size = 0;
        position.margin = 0;

        emit PositionLiquidated(positionId, msg.sender, currentPrice, liquidatorReward);
    }

    function isLiquidatable(bytes32 positionId) external view returns (bool canLiquidate, uint256 healthFactor) {
        Position memory position = positions[positionId];
        if (!position.isOpen) return (false, type(uint256).max);

        MarketConfig memory market = markets[position.marketId];
        uint256 currentPrice = priceOracle.getMarkPrice(position.marketId);

        int256 pnl = PerpMath.calculateUnrealizedPnl(position, currentPrice);
        uint256 notional = PerpMath.calculateNotional(position.size, currentPrice);

        healthFactor = PerpMath.calculateMarginRatio(position.margin, pnl, notional);
        canLiquidate = PerpMath.isLiquidatable(position.margin, pnl, notional, market.maintenanceMarginBps);
    }

    function getLiquidationPrice(bytes32 positionId) external view returns (uint256) {
        Position memory position = positions[positionId];
        if (!position.isOpen) return 0;

        MarketConfig memory market = markets[position.marketId];
        return PerpMath.calculateLiquidationPrice(position, market.maintenanceMarginBps);
    }

    function updateFunding(bytes32 marketId) external marketActive(marketId) {
        FundingData storage funding = fundingData[marketId];

        require(block.timestamp >= funding.nextFundingTime, "Too early");

        uint256 markPrice = priceOracle.getMarkPrice(marketId);
        uint256 indexPrice = priceOracle.getIndexPrice(marketId);
        OpenInterest memory oi = openInterest[marketId];

        int256 newFundingRate = PerpMath.calculateFundingRate(oi.longOI, oi.shortOI, markPrice, indexPrice);

        funding.fundingRate = newFundingRate;
        funding.fundingIndex += newFundingRate;
        funding.lastFundingTime = block.timestamp;
        funding.nextFundingTime = block.timestamp + markets[marketId].fundingInterval;

        emit FundingPaid(marketId, newFundingRate, funding.fundingIndex);
    }

    function _settleFunding(bytes32 positionId) internal returns (int256 payment) {
        Position storage position = positions[positionId];
        FundingData memory funding = fundingData[position.marketId];

        payment = PerpMath.calculateFundingPayment(position, funding.fundingIndex);
        position.entryFundingIndex = funding.fundingIndex;
    }

    function getPosition(bytes32 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    function getTraderPositions(address trader) external view returns (bytes32[] memory) {
        return traderPositions[trader];
    }

    function getMarket(bytes32 marketId) external view returns (MarketConfig memory) {
        return markets[marketId];
    }

    function getAllMarkets() external view returns (bytes32[] memory) {
        return allMarkets;
    }

    function getMarkPrice(bytes32 marketId) external view returns (uint256) {
        return priceOracle.getMarkPrice(marketId);
    }

    function getIndexPrice(bytes32 marketId) external view returns (uint256) {
        return priceOracle.getIndexPrice(marketId);
    }

    function getPositionPnl(bytes32 positionId) external view returns (int256 unrealizedPnl, int256 fundingPnl) {
        Position memory position = positions[positionId];
        if (!position.isOpen) return (0, 0);

        uint256 currentPrice = priceOracle.getMarkPrice(position.marketId);
        unrealizedPnl = PerpMath.calculateUnrealizedPnl(position, currentPrice);

        FundingData memory funding = fundingData[position.marketId];
        fundingPnl = PerpMath.calculateFundingPayment(position, funding.fundingIndex);
    }

    function getPositionLeverage(bytes32 positionId) external view returns (uint256) {
        Position memory position = positions[positionId];
        if (!position.isOpen || position.margin == 0) return 0;

        uint256 currentPrice = priceOracle.getMarkPrice(position.marketId);
        uint256 notional = PerpMath.calculateNotional(position.size, currentPrice);

        return PerpMath.calculateLeverage(notional, position.margin);
    }

    function getFundingRate(bytes32 marketId) external view returns (int256) {
        return fundingData[marketId].fundingRate;
    }

    function getFundingData(bytes32 marketId) external view returns (FundingData memory) {
        return fundingData[marketId];
    }

    function getMarketOpenInterest(bytes32 marketId) external view returns (uint256 longOI, uint256 shortOI) {
        OpenInterest memory oi = openInterest[marketId];
        return (oi.longOI, oi.shortOI);
    }
}
