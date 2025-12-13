// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPerpetualMarket, IMarginManager, IInsuranceFund} from "./interfaces/IPerpetualMarket.sol";

/**
 * @title IPriceFeedAggregator
 * @notice Interface for price feed aggregator
 */
interface IPriceFeedAggregator {
    function getPrice(string calldata asset) external view returns (uint256 price, uint256 timestamp, bool isValid);
}

/**
 * @title PerpetualMarket
 * @notice Core perpetual futures trading engine with funding rates
 */
contract PerpetualMarket is IPerpetualMarket, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant PRICE_PRECISION = 1e8; // 8 decimal prices
    uint256 public constant FUNDING_PRECISION = 1e18;
    uint256 public constant FUNDING_INTERVAL = 8 hours;
    uint256 public constant MAX_FUNDING_RATE = 1e16; // 1% per 8 hours max
    uint256 public constant LIQUIDATION_FEE_BPS = 500; // 5% to liquidators
    uint256 public constant INSURANCE_FEE_BPS = 200; // 2% to insurance fund

    IMarginManager public marginManager;
    IPriceFeedAggregator public priceFeed;
    IInsuranceFund public insuranceFund;
    address public feeReceiver;

    // Markets
    mapping(bytes32 => Market) public markets;
    mapping(bytes32 => FundingState) public fundingStates;
    bytes32[] public allMarketIds;

    // Positions
    mapping(bytes32 => Position) public positions;
    mapping(address => bytes32[]) public traderPositions;
    uint256 public positionCounter;

    // Open interest tracking
    mapping(bytes32 => uint256) public longOpenInterest;
    mapping(bytes32 => uint256) public shortOpenInterest;

    // Mark price TWAP tracking
    mapping(bytes32 => uint256) public lastTradePrice;
    mapping(bytes32 => uint256) public markPriceTWAP;
    mapping(bytes32 => uint256) public lastMarkUpdate;

    error MarketNotFound();
    error MarketNotActive();
    error MarketAlreadyExists();
    error PositionNotFound();
    error NotPositionOwner();
    error PositionAlreadyClosed();
    error InvalidLeverage();
    error ExceedsMaxOpenInterest();
    error InsufficientMargin();
    error OraclePriceInvalid();
    error PositionTooSmall();
    error CannotLiquidate();
    error InvalidAmount();
    error FundingNotDue();

    constructor(
        address _marginManager,
        address _priceFeed,
        address _insuranceFund,
        address _feeReceiver,
        address initialOwner
    ) Ownable(initialOwner) {
        marginManager = IMarginManager(_marginManager);
        priceFeed = IPriceFeedAggregator(_priceFeed);
        insuranceFund = IInsuranceFund(_insuranceFund);
        feeReceiver = _feeReceiver;
    }

    function openPosition(
        bytes32 marketId,
        address marginToken,
        uint256 marginAmount,
        uint256 size,
        PositionSide side,
        uint256 leverage
    ) external nonReentrant whenNotPaused returns (TradeResult memory result) {
        Market storage market = markets[marketId];
        if (!market.isActive) revert MarketNotActive();
        if (leverage == 0 || leverage > market.maxLeverage) revert InvalidLeverage();
        if (size == 0) revert InvalidAmount();

        // Get price and validate
        uint256 indexPrice = _getValidPrice(marketId);
        uint256 notionalValue = (size * indexPrice) / PRICE_PRECISION;

        // Calculate required margin based on leverage
        uint256 requiredMargin = notionalValue / leverage;
        if (marginAmount < requiredMargin) revert InsufficientMargin();

        // Check open interest limits
        uint256 newOI =
            side == PositionSide.Long ? longOpenInterest[marketId] + size : shortOpenInterest[marketId] + size;
        if (newOI > market.maxOpenInterest) revert ExceedsMaxOpenInterest();

        // Generate position ID
        bytes32 positionId = _generatePositionId(msg.sender, marketId);

        // Calculate and collect fee
        uint256 fee = (notionalValue * market.takerFeeBps) / BPS_DENOMINATOR;

        // Reserve margin
        marginManager.reserveMargin(msg.sender, marginToken, marginAmount);

        // Deduct fee
        if (fee > 0) {
            marginManager.deductMargin(msg.sender, marginToken, fee, feeReceiver);
        }

        // Get current funding index
        FundingState storage funding = fundingStates[marketId];

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
            entryPrice: indexPrice,
            entryFundingIndex: funding.cumulativeFundingIndex,
            lastUpdateTime: block.timestamp,
            isOpen: true
        });

        // Update tracking
        traderPositions[msg.sender].push(positionId);

        if (side == PositionSide.Long) {
            longOpenInterest[marketId] += size;
        } else {
            shortOpenInterest[marketId] += size;
        }

        market.currentOpenInterest += size;

        // Update mark price
        _updateMarkPrice(marketId, indexPrice);

        result =
            TradeResult({positionId: positionId, executionPrice: indexPrice, fee: fee, realizedPnl: 0, fundingPaid: 0});

        emit PositionOpened(positionId, msg.sender, marketId, side, size, marginAmount - fee, indexPrice, leverage);

        emit TradeFeeCollected(positionId, msg.sender, fee, marginToken);
    }

    function increasePosition(bytes32 positionId, uint256 additionalMargin, uint256 sizeIncrease)
        external
        nonReentrant
        whenNotPaused
        returns (TradeResult memory result)
    {
        Position storage position = positions[positionId];
        if (!position.isOpen) revert PositionNotFound();
        if (position.trader != msg.sender) revert NotPositionOwner();

        Market storage market = markets[position.marketId];
        if (!market.isActive) revert MarketNotActive();

        uint256 indexPrice = _getValidPrice(position.marketId);

        // Settle funding first
        int256 fundingPaid = _settleFunding(positionId);

        // Calculate new average entry price
        uint256 oldNotional = (position.size * position.entryPrice) / PRICE_PRECISION;
        uint256 newNotional = (sizeIncrease * indexPrice) / PRICE_PRECISION;
        uint256 totalSize = position.size + sizeIncrease;
        uint256 newEntryPrice = ((oldNotional + newNotional) * PRICE_PRECISION) / totalSize;

        // Calculate fee
        uint256 fee = (newNotional * market.takerFeeBps) / BPS_DENOMINATOR;

        // Reserve additional margin
        if (additionalMargin > 0) {
            marginManager.reserveMargin(msg.sender, position.marginToken, additionalMargin);
        }

        // Deduct fee
        if (fee > 0) {
            marginManager.deductMargin(msg.sender, position.marginToken, fee, feeReceiver);
        }

        // Update position
        position.size = totalSize;
        position.margin += additionalMargin - fee;
        position.entryPrice = newEntryPrice;
        position.lastUpdateTime = block.timestamp;

        // Update open interest
        if (position.side == PositionSide.Long) {
            longOpenInterest[position.marketId] += sizeIncrease;
        } else {
            shortOpenInterest[position.marketId] += sizeIncrease;
        }

        market.currentOpenInterest += sizeIncrease;

        _updateMarkPrice(position.marketId, indexPrice);

        result = TradeResult({
            positionId: positionId,
            executionPrice: indexPrice,
            fee: fee,
            realizedPnl: 0,
            fundingPaid: fundingPaid
        });

        emit PositionIncreased(positionId, sizeIncrease, additionalMargin, newEntryPrice);
    }

    function decreasePosition(bytes32 positionId, uint256 sizeDecrease)
        external
        nonReentrant
        whenNotPaused
        returns (TradeResult memory result)
    {
        Position storage position = positions[positionId];
        if (!position.isOpen) revert PositionNotFound();
        if (position.trader != msg.sender) revert NotPositionOwner();

        Market storage market = markets[position.marketId];

        uint256 indexPrice = _getValidPrice(position.marketId);

        // Handle full close
        bool isFullClose = sizeDecrease >= position.size;
        uint256 actualDecrease = isFullClose ? position.size : sizeDecrease;

        // Settle funding first
        int256 fundingPaid = _settleFunding(positionId);

        // Calculate PnL for the portion being closed
        int256 pnl = _calculatePnL(position, indexPrice, actualDecrease);

        // Calculate fee
        uint256 notionalDecrease = (actualDecrease * indexPrice) / PRICE_PRECISION;
        uint256 fee = (notionalDecrease * market.takerFeeBps) / BPS_DENOMINATOR;

        // Calculate margin to return
        uint256 marginPortion = (position.margin * actualDecrease) / position.size;

        // Calculate final amount to return
        int256 marginReturn = int256(marginPortion) + pnl - int256(fee);

        // Update position or close
        if (isFullClose) {
            position.isOpen = false;
            position.size = 0;

            // Release all margin
            marginManager.releaseMargin(position.trader, position.marginToken, position.margin);

            // Handle PnL
            if (marginReturn > 0) {
                marginManager.creditMargin(position.trader, position.marginToken, uint256(marginReturn));
            } else if (marginReturn < 0) {
                // Loss exceeds margin - bad debt
                uint256 badDebt = uint256(-marginReturn);
                insuranceFund.coverBadDebt(position.marginToken, badDebt);
            }

            emit PositionClosed(positionId, msg.sender, pnl, fundingPaid, marginReturn > 0 ? uint256(marginReturn) : 0);
        } else {
            position.size -= actualDecrease;
            position.margin -= marginPortion;
            position.lastUpdateTime = block.timestamp;

            // Release proportional margin
            marginManager.releaseMargin(position.trader, position.marginToken, marginPortion);

            // Handle PnL
            if (marginReturn > 0) {
                marginManager.creditMargin(position.trader, position.marginToken, uint256(marginReturn));
            }

            emit PositionDecreased(positionId, actualDecrease, pnl, marginReturn > 0 ? uint256(marginReturn) : 0);
        }

        // Deduct fee
        if (fee > 0) {
            marginManager.deductMargin(msg.sender, position.marginToken, fee, feeReceiver);
        }

        // Update open interest
        if (position.side == PositionSide.Long) {
            longOpenInterest[position.marketId] -= actualDecrease;
        } else {
            shortOpenInterest[position.marketId] -= actualDecrease;
        }

        market.currentOpenInterest -= actualDecrease;

        _updateMarkPrice(position.marketId, indexPrice);

        result = TradeResult({
            positionId: positionId,
            executionPrice: indexPrice,
            fee: fee,
            realizedPnl: pnl,
            fundingPaid: fundingPaid
        });
    }

    function addMargin(bytes32 positionId, uint256 amount) external nonReentrant whenNotPaused {
        Position storage position = positions[positionId];
        if (!position.isOpen) revert PositionNotFound();
        if (position.trader != msg.sender) revert NotPositionOwner();
        if (amount == 0) revert InvalidAmount();

        marginManager.reserveMargin(msg.sender, position.marginToken, amount);
        position.margin += amount;
        position.lastUpdateTime = block.timestamp;

        emit MarginAdded(positionId, amount, position.margin);
    }

    function removeMargin(bytes32 positionId, uint256 amount) external nonReentrant whenNotPaused {
        Position storage position = positions[positionId];
        if (!position.isOpen) revert PositionNotFound();
        if (position.trader != msg.sender) revert NotPositionOwner();
        if (amount == 0) revert InvalidAmount();

        // Check that removal doesn't breach maintenance margin
        uint256 indexPrice = _getValidPrice(position.marketId);
        Market storage market = markets[position.marketId];

        uint256 notionalValue = (position.size * indexPrice) / PRICE_PRECISION;
        uint256 minMargin = (notionalValue * market.maintenanceMarginBps) / BPS_DENOMINATOR;

        // Account for unrealized PnL
        int256 pnl = _calculatePnL(position, indexPrice, position.size);
        int256 effectiveMargin = int256(position.margin) + pnl;

        if (effectiveMargin - int256(amount) < int256(minMargin * 2)) {
            // Require 2x maintenance margin after withdrawal
            revert InsufficientMargin();
        }

        position.margin -= amount;
        position.lastUpdateTime = block.timestamp;

        marginManager.releaseMargin(msg.sender, position.marginToken, amount);

        emit MarginRemoved(positionId, amount, position.margin);
    }

    function liquidate(bytes32 positionId) external nonReentrant returns (uint256 liquidatorReward) {
        Position storage position = positions[positionId];
        if (!position.isOpen) revert PositionNotFound();

        (bool canLiq,) = _isLiquidatable(positionId);
        if (!canLiq) revert CannotLiquidate();

        Market storage market = markets[position.marketId];
        uint256 indexPrice = _getValidPrice(position.marketId);

        // Settle funding
        _settleFunding(positionId);

        // Calculate liquidation amounts
        liquidatorReward = (position.margin * LIQUIDATION_FEE_BPS) / BPS_DENOMINATOR;
        uint256 insuranceFee = (position.margin * INSURANCE_FEE_BPS) / BPS_DENOMINATOR;

        // Close position
        position.isOpen = false;

        // Release and distribute margin
        marginManager.releaseMargin(position.trader, position.marginToken, position.margin);

        // Pay liquidator
        marginManager.transferMargin(position.trader, msg.sender, position.marginToken, liquidatorReward);

        // Pay insurance fund
        marginManager.transferMargin(position.trader, address(insuranceFund), position.marginToken, insuranceFee);

        // Update open interest
        if (position.side == PositionSide.Long) {
            longOpenInterest[position.marketId] -= position.size;
        } else {
            shortOpenInterest[position.marketId] -= position.size;
        }

        market.currentOpenInterest -= position.size;

        emit PositionLiquidated(positionId, position.trader, msg.sender, position.size, indexPrice, liquidatorReward);
    }

    function isLiquidatable(bytes32 positionId) external view returns (bool canLiquidate, uint256 healthFactor) {
        return _isLiquidatable(positionId);
    }

    function _isLiquidatable(bytes32 positionId) internal view returns (bool canLiq, uint256 healthFactor) {
        Position storage position = positions[positionId];
        if (!position.isOpen) return (false, 0);

        Market storage market = markets[position.marketId];

        (uint256 price,, bool isValid) = priceFeed.getPrice(market.symbol);
        if (!isValid) return (false, 0);

        // Calculate notional and maintenance margin in margin token decimals (18)
        // notionalValue = size * price, where size is in 8 decimals, price is in 8 decimals
        // Result needs to be in 18 decimals to match margin
        uint256 notionalValue18 = (position.size * price * 1e2); // 8+8+2 = 18 decimals
        uint256 maintenanceMargin = (notionalValue18 * market.maintenanceMarginBps) / BPS_DENOMINATOR;

        // Calculate PnL in margin token decimals
        int256 pnl = _calculatePnLScaled(position, price, position.size);
        int256 effectiveMargin = int256(position.margin) + pnl;

        if (effectiveMargin <= 0) {
            return (true, 0);
        }

        healthFactor = (uint256(effectiveMargin) * FUNDING_PRECISION) / maintenanceMargin;
        canLiq = healthFactor < FUNDING_PRECISION; // < 1.0
    }

    function updateFunding(bytes32 marketId) external {
        FundingState storage funding = fundingStates[marketId];

        if (block.timestamp < funding.lastFundingTime + FUNDING_INTERVAL) {
            revert FundingNotDue();
        }

        Market storage market = markets[marketId];
        if (!market.isActive) revert MarketNotActive();

        // Get prices
        (uint256 indexPrice,, bool isValid) = priceFeed.getPrice(market.symbol);
        if (!isValid) revert OraclePriceInvalid();

        uint256 markPrice = markPriceTWAP[marketId];
        if (markPrice == 0) markPrice = indexPrice;

        // Calculate funding rate: (mark - index) / index
        int256 priceDiff = int256(markPrice) - int256(indexPrice);
        int256 fundingRate = (priceDiff * int256(FUNDING_PRECISION)) / int256(indexPrice);

        // Clamp to max funding rate
        if (fundingRate > int256(MAX_FUNDING_RATE)) {
            fundingRate = int256(MAX_FUNDING_RATE);
        } else if (fundingRate < -int256(MAX_FUNDING_RATE)) {
            fundingRate = -int256(MAX_FUNDING_RATE);
        }

        // Update cumulative funding index
        funding.fundingRate = fundingRate;
        funding.cumulativeFundingIndex += fundingRate;
        funding.lastFundingTime = block.timestamp;

        emit FundingUpdated(marketId, fundingRate, funding.cumulativeFundingIndex);
    }

    function getFundingRate(bytes32 marketId) external view returns (int256 rate) {
        return fundingStates[marketId].fundingRate;
    }

    function getPendingFunding(bytes32 positionId) external view returns (int256 pendingFunding) {
        Position storage position = positions[positionId];
        if (!position.isOpen) return 0;

        FundingState storage funding = fundingStates[position.marketId];
        int256 fundingDelta = funding.cumulativeFundingIndex - position.entryFundingIndex;

        // Longs pay positive funding, shorts receive
        // Shorts pay negative funding, longs receive
        int256 fundingPayment = (int256(position.size) * fundingDelta) / int256(FUNDING_PRECISION);

        if (position.side == PositionSide.Long) {
            return fundingPayment; // Longs pay when positive
        } else {
            return -fundingPayment; // Shorts receive when positive
        }
    }

    function _settleFunding(bytes32 positionId) internal returns (int256 fundingPaid) {
        Position storage position = positions[positionId];
        FundingState storage funding = fundingStates[position.marketId];

        int256 fundingDelta = funding.cumulativeFundingIndex - position.entryFundingIndex;

        int256 fundingPayment = (int256(position.size) * fundingDelta) / int256(FUNDING_PRECISION);

        if (position.side == PositionSide.Long) {
            fundingPaid = fundingPayment;
        } else {
            fundingPaid = -fundingPayment;
        }

        // Apply funding to margin
        if (fundingPaid > 0) {
            // Position owes funding
            if (uint256(fundingPaid) > position.margin) {
                position.margin = 0;
            } else {
                position.margin -= uint256(fundingPaid);
            }
        } else if (fundingPaid < 0) {
            // Position receives funding
            position.margin += uint256(-fundingPaid);
        }

        // Update entry funding index
        position.entryFundingIndex = funding.cumulativeFundingIndex;

        return fundingPaid;
    }

    function getPosition(bytes32 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    function getTraderPositions(address trader) external view returns (bytes32[] memory) {
        return traderPositions[trader];
    }

    function getMarket(bytes32 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getMarkPrice(bytes32 marketId) external view returns (uint256) {
        uint256 markPrice = markPriceTWAP[marketId];
        if (markPrice == 0) {
            Market storage market = markets[marketId];
            (uint256 price,,) = priceFeed.getPrice(market.symbol);
            return price;
        }
        return markPrice;
    }

    function getIndexPrice(bytes32 marketId) external view returns (uint256) {
        return _getValidPrice(marketId);
    }

    function getPositionPnl(bytes32 positionId) external view returns (int256 unrealizedPnl, int256 fundingPnl) {
        Position storage position = positions[positionId];
        if (!position.isOpen) return (0, 0);

        (uint256 price,, bool isValid) = priceFeed.getPrice(markets[position.marketId].symbol);
        if (!isValid) return (0, 0);

        // Return PnL scaled to 18 decimals (margin token units)
        unrealizedPnl = _calculatePnLScaled(position, price, position.size);

        // Calculate pending funding
        FundingState storage funding = fundingStates[position.marketId];
        int256 fundingDelta = funding.cumulativeFundingIndex - position.entryFundingIndex;
        int256 fundingPayment = (int256(position.size) * fundingDelta) / int256(FUNDING_PRECISION);

        if (position.side == PositionSide.Long) {
            fundingPnl = -fundingPayment; // Longs pay, so negative when positive funding
        } else {
            fundingPnl = fundingPayment; // Shorts receive
        }
    }

    function getPositionLeverage(bytes32 positionId) external view returns (uint256 leverage) {
        Position storage position = positions[positionId];
        if (!position.isOpen || position.margin == 0) return 0;

        (uint256 price,,) = priceFeed.getPrice(markets[position.marketId].symbol);
        uint256 notionalValue = (position.size * price) / PRICE_PRECISION;

        return (notionalValue * PRICE_PRECISION) / position.margin;
    }

    function getLiquidationPrice(bytes32 positionId) external view returns (uint256) {
        Position storage position = positions[positionId];
        if (!position.isOpen) return 0;

        Market storage market = markets[position.marketId];

        // Liquidation price where margin = maintenance margin
        // For longs: liqPrice = entryPrice - (margin - maintMargin) / size
        // For shorts: liqPrice = entryPrice + (margin - maintMargin) / size

        uint256 notionalAtEntry = (position.size * position.entryPrice) / PRICE_PRECISION;
        uint256 maintenanceMargin = (notionalAtEntry * market.maintenanceMarginBps) / BPS_DENOMINATOR;

        if (position.margin <= maintenanceMargin) {
            // Already liquidatable
            return position.side == PositionSide.Long ? position.entryPrice : position.entryPrice;
        }

        uint256 marginBuffer = position.margin - maintenanceMargin;
        uint256 priceMove = (marginBuffer * PRICE_PRECISION) / position.size;

        if (position.side == PositionSide.Long) {
            return position.entryPrice > priceMove ? position.entryPrice - priceMove : 0;
        } else {
            return position.entryPrice + priceMove;
        }
    }

    function _getValidPrice(bytes32 marketId) internal view returns (uint256) {
        Market storage market = markets[marketId];
        (uint256 price,, bool isValid) = priceFeed.getPrice(market.symbol);
        if (!isValid || price == 0) revert OraclePriceInvalid();
        return price;
    }

    function _calculatePnL(Position storage position, uint256 currentPrice, uint256 size)
        internal
        view
        returns (int256)
    {
        int256 priceDiff = int256(currentPrice) - int256(position.entryPrice);

        if (position.side == PositionSide.Short) {
            priceDiff = -priceDiff; // Shorts profit when price goes down
        }

        return (int256(size) * priceDiff) / int256(PRICE_PRECISION);
    }

    /**
     * @notice Calculate PnL scaled to 18 decimals (margin token decimals)
     * @dev size is 8 decimals, price is 8 decimals
     *      PnL = size * priceDiff / 1e8 gives result in 8 decimals
     *      We scale by 1e10 to get 18 decimals
     */
    function _calculatePnLScaled(Position storage position, uint256 currentPrice, uint256 size)
        internal
        view
        returns (int256)
    {
        int256 priceDiff = int256(currentPrice) - int256(position.entryPrice);

        if (position.side == PositionSide.Short) {
            priceDiff = -priceDiff;
        }

        // size (8 dec) * priceDiff (8 dec) / 1e8 = 8 decimals
        // Multiply by 1e10 to get 18 decimals
        return (int256(size) * priceDiff * 1e10) / int256(PRICE_PRECISION);
    }

    function _updateMarkPrice(bytes32 marketId, uint256 tradePrice) internal {
        uint256 lastMark = markPriceTWAP[marketId];
        uint256 lastUpdate = lastMarkUpdate[marketId];

        if (lastMark == 0 || lastUpdate == 0) {
            markPriceTWAP[marketId] = tradePrice;
        } else {
            // EWMA: 90% old, 10% new
            markPriceTWAP[marketId] = (lastMark * 9 + tradePrice) / 10;
        }

        lastTradePrice[marketId] = tradePrice;
        lastMarkUpdate[marketId] = block.timestamp;
    }

    function _generatePositionId(address trader, bytes32 marketId) internal returns (bytes32) {
        positionCounter++;
        return keccak256(abi.encodePacked(trader, marketId, positionCounter, block.timestamp));
    }

    function addMarket(
        bytes32 marketId,
        string calldata symbol,
        address baseAsset,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 takerFeeBps,
        uint256 makerFeeBps,
        uint256 maxOpenInterest
    ) external onlyOwner {
        if (markets[marketId].isActive) revert MarketAlreadyExists();

        markets[marketId] = Market({
            marketId: marketId,
            symbol: symbol,
            baseAsset: baseAsset,
            maxLeverage: maxLeverage,
            maintenanceMarginBps: maintenanceMarginBps,
            takerFeeBps: takerFeeBps,
            makerFeeBps: makerFeeBps,
            maxOpenInterest: maxOpenInterest,
            currentOpenInterest: 0,
            isActive: true
        });

        fundingStates[marketId] =
            FundingState({fundingRate: 0, cumulativeFundingIndex: 0, lastFundingTime: block.timestamp});

        allMarketIds.push(marketId);

        emit MarketAdded(marketId, symbol, maxLeverage);
    }

    function updateMarket(bytes32 marketId, bool isActive) external onlyOwner {
        if (markets[marketId].maxLeverage == 0) revert MarketNotFound();
        markets[marketId].isActive = isActive;
    }

    function setMaxLeverage(bytes32 marketId, uint256 maxLeverage) external onlyOwner {
        if (markets[marketId].maxLeverage == 0) revert MarketNotFound();
        markets[marketId].maxLeverage = maxLeverage;
    }

    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        feeReceiver = _feeReceiver;
    }

    function setMarginManager(address _marginManager) external onlyOwner {
        marginManager = IMarginManager(_marginManager);
    }

    function setPriceFeed(address _priceFeed) external onlyOwner {
        priceFeed = IPriceFeedAggregator(_priceFeed);
    }

    function setInsuranceFund(address _insuranceFund) external onlyOwner {
        insuranceFund = IInsuranceFund(_insuranceFund);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getAllMarkets() external view returns (bytes32[] memory) {
        return allMarketIds;
    }

    function getMarketOpenInterest(bytes32 marketId) external view returns (uint256 longOI, uint256 shortOI) {
        return (longOpenInterest[marketId], shortOpenInterest[marketId]);
    }
}
