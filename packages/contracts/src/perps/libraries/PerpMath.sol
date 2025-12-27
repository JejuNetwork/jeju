// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {PositionSide, Position} from "../interfaces/IPerps.sol";

/**
 * @title PerpMath
 * @notice Math library for perpetual futures calculations
 * @dev All calculations use 18 decimals for precision (1e18 = 100%)
 */
library PerpMath {
    uint256 constant PRECISION = 1e18;
    uint256 constant BPS_PRECISION = 10000;
    int256 constant SIGNED_PRECISION = 1e18;

    // Funding rate constants
    int256 constant MAX_FUNDING_RATE = 1e16; // 1% per interval
    int256 constant MIN_FUNDING_RATE = -1e16;
    uint256 constant FUNDING_RATE_PRECISION = 1e18;

    /**
     * @notice Calculate the notional value of a position
     * @param size Position size in base asset units
     * @param price Current price (18 decimals)
     * @return Notional value in quote asset units
     */
    function calculateNotional(uint256 size, uint256 price) internal pure returns (uint256) {
        return (size * price) / PRECISION;
    }

    /**
     * @notice Calculate required margin for a position
     * @param notional Position notional value
     * @param leverage Leverage multiplier (e.g., 10 = 10x)
     * @return Required margin
     */
    function calculateRequiredMargin(uint256 notional, uint256 leverage) internal pure returns (uint256) {
        return notional / leverage;
    }

    /**
     * @notice Calculate position leverage
     * @param notional Position notional value
     * @param margin Current margin
     * @return Current leverage (scaled by PRECISION)
     */
    function calculateLeverage(uint256 notional, uint256 margin) internal pure returns (uint256) {
        if (margin == 0) return type(uint256).max;
        return (notional * PRECISION) / margin;
    }

    /**
     * @notice Calculate unrealized PnL for a position
     * @param position The position data
     * @param currentPrice Current mark price
     * @return pnl Unrealized PnL (can be negative)
     */
    function calculateUnrealizedPnl(Position memory position, uint256 currentPrice)
        internal
        pure
        returns (int256 pnl)
    {
        if (!position.isOpen || position.size == 0) return 0;

        int256 priceDelta = int256(currentPrice) - int256(position.entryPrice);
        int256 sizeInt = int256(position.size);

        if (position.side == PositionSide.Long) {
            pnl = (sizeInt * priceDelta) / SIGNED_PRECISION;
        } else {
            pnl = -(sizeInt * priceDelta) / SIGNED_PRECISION;
        }
    }

    /**
     * @notice Calculate margin ratio (health factor)
     * @param margin Current margin
     * @param unrealizedPnl Unrealized PnL
     * @param notional Position notional
     * @return ratio Margin ratio (scaled by BPS_PRECISION, 10000 = 100%)
     */
    function calculateMarginRatio(uint256 margin, int256 unrealizedPnl, uint256 notional)
        internal
        pure
        returns (uint256 ratio)
    {
        if (notional == 0) return type(uint256).max;

        int256 equity = int256(margin) + unrealizedPnl;
        if (equity <= 0) return 0;

        ratio = (uint256(equity) * BPS_PRECISION) / notional;
    }

    /**
     * @notice Calculate liquidation price
     * @param position The position data
     * @param maintenanceMarginBps Maintenance margin in basis points
     * @return Liquidation price
     */
    function calculateLiquidationPrice(Position memory position, uint256 maintenanceMarginBps)
        internal
        pure
        returns (uint256)
    {
        if (!position.isOpen || position.size == 0) return 0;

        // Liquidation occurs when: margin + pnl = maintenanceMargin
        // For long: margin + size * (liqPrice - entryPrice) / PRECISION = size * liqPrice * mmBps / BPS_PRECISION / PRECISION
        // For short: margin - size * (liqPrice - entryPrice) / PRECISION = size * liqPrice * mmBps / BPS_PRECISION / PRECISION

        uint256 size = position.size;
        uint256 margin = position.margin;
        uint256 entryPrice = position.entryPrice;

        if (position.side == PositionSide.Long) {
            // liqPrice = (margin * PRECISION + size * entryPrice - margin * PRECISION * mmBps / BPS_PRECISION) / (size - size * mmBps / BPS_PRECISION)
            uint256 numerator = margin * PRECISION + size * entryPrice;
            uint256 sizeAdjusted = size - (size * maintenanceMarginBps) / BPS_PRECISION;

            if (sizeAdjusted == 0) return 0;

            // Calculate maintenance margin portion
            uint256 mmPortion = (margin * maintenanceMarginBps) / BPS_PRECISION;
            if (numerator <= mmPortion * PRECISION) return 0;

            return (numerator - mmPortion * PRECISION) / sizeAdjusted;
        } else {
            // For short positions
            uint256 sizeAdjusted = size + (size * maintenanceMarginBps) / BPS_PRECISION;
            uint256 mmPortion = (margin * maintenanceMarginBps) / BPS_PRECISION;
            uint256 numerator = size * entryPrice + margin * PRECISION + mmPortion * PRECISION;

            return numerator / sizeAdjusted;
        }
    }

    /**
     * @notice Calculate trading fee
     * @param notional Trade notional value
     * @param feeBps Fee in basis points
     * @return fee Amount of fee
     */
    function calculateFee(uint256 notional, uint256 feeBps) internal pure returns (uint256) {
        return (notional * feeBps) / BPS_PRECISION;
    }

    /**
     * @notice Calculate funding payment for a position
     * @param position The position data
     * @param currentFundingIndex Current cumulative funding index
     * @return payment Funding payment (positive = receive, negative = pay)
     */
    function calculateFundingPayment(Position memory position, int256 currentFundingIndex)
        internal
        pure
        returns (int256 payment)
    {
        if (!position.isOpen || position.size == 0) return 0;

        int256 fundingDelta = currentFundingIndex - position.entryFundingIndex;
        int256 sizeInt = int256(position.size);

        // Longs pay when funding is positive, shorts receive
        if (position.side == PositionSide.Long) {
            payment = -(sizeInt * fundingDelta) / SIGNED_PRECISION;
        } else {
            payment = (sizeInt * fundingDelta) / SIGNED_PRECISION;
        }
    }

    /**
     * @notice Calculate funding rate based on open interest imbalance
     * @param longOI Long open interest
     * @param shortOI Short open interest
     * @param markPrice Current mark price
     * @param indexPrice Index/oracle price
     * @return rate Funding rate (positive = longs pay shorts)
     */
    function calculateFundingRate(uint256 longOI, uint256 shortOI, uint256 markPrice, uint256 indexPrice)
        internal
        pure
        returns (int256 rate)
    {
        // Base rate from price deviation
        int256 priceDeviation = 0;
        if (indexPrice > 0) {
            priceDeviation = (int256(markPrice) - int256(indexPrice)) * SIGNED_PRECISION / int256(indexPrice);
        }

        // OI imbalance component
        int256 oiImbalance = 0;
        uint256 totalOI = longOI + shortOI;
        if (totalOI > 0) {
            oiImbalance = (int256(longOI) - int256(shortOI)) * SIGNED_PRECISION / int256(totalOI);
        }

        // Combine: 50% price deviation + 50% OI imbalance
        rate = (priceDeviation + oiImbalance) / 2;

        // Clamp to max/min
        if (rate > MAX_FUNDING_RATE) rate = MAX_FUNDING_RATE;
        if (rate < MIN_FUNDING_RATE) rate = MIN_FUNDING_RATE;
    }

    /**
     * @notice Calculate average entry price for position increase
     * @param existingSize Existing position size
     * @param existingEntryPrice Existing entry price
     * @param addedSize Size being added
     * @param addedPrice Price at which size is being added
     * @return New average entry price
     */
    function calculateAverageEntryPrice(
        uint256 existingSize,
        uint256 existingEntryPrice,
        uint256 addedSize,
        uint256 addedPrice
    ) internal pure returns (uint256) {
        if (existingSize == 0) return addedPrice;
        if (addedSize == 0) return existingEntryPrice;

        uint256 totalNotional = (existingSize * existingEntryPrice + addedSize * addedPrice) / PRECISION;
        uint256 totalSize = existingSize + addedSize;

        return (totalNotional * PRECISION) / totalSize;
    }

    /**
     * @notice Calculate realized PnL for partial close
     * @param position The position data
     * @param closeSize Size being closed
     * @param closePrice Price at which position is being closed
     * @return Realized PnL
     */
    function calculateRealizedPnl(Position memory position, uint256 closeSize, uint256 closePrice)
        internal
        pure
        returns (int256)
    {
        if (closeSize == 0) return 0;

        int256 priceDelta = int256(closePrice) - int256(position.entryPrice);
        int256 closeSizeInt = int256(closeSize);

        if (position.side == PositionSide.Long) {
            return (closeSizeInt * priceDelta) / SIGNED_PRECISION;
        } else {
            return -(closeSizeInt * priceDelta) / SIGNED_PRECISION;
        }
    }

    /**
     * @notice Calculate the maximum position size given margin and leverage
     * @param margin Available margin
     * @param leverage Maximum leverage
     * @param price Current price
     * @return Maximum position size
     */
    function calculateMaxPositionSize(uint256 margin, uint256 leverage, uint256 price)
        internal
        pure
        returns (uint256)
    {
        if (price == 0) return 0;
        uint256 maxNotional = margin * leverage;
        return (maxNotional * PRECISION) / price;
    }

    /**
     * @notice Check if a position is liquidatable
     * @param margin Current margin
     * @param unrealizedPnl Unrealized PnL
     * @param notional Position notional
     * @param maintenanceMarginBps Maintenance margin in bps
     * @return True if position should be liquidated
     */
    function isLiquidatable(uint256 margin, int256 unrealizedPnl, uint256 notional, uint256 maintenanceMarginBps)
        internal
        pure
        returns (bool)
    {
        if (notional == 0) return false;

        int256 equity = int256(margin) + unrealizedPnl;
        if (equity <= 0) return true;

        uint256 maintenanceMargin = (notional * maintenanceMarginBps) / BPS_PRECISION;
        return uint256(equity) < maintenanceMargin;
    }

    /**
     * @notice Calculate liquidation penalty
     * @param notional Position notional
     * @param penaltyBps Penalty in basis points
     * @return penalty Total penalty amount
     */
    function calculateLiquidationPenalty(uint256 notional, uint256 penaltyBps) internal pure returns (uint256) {
        return (notional * penaltyBps) / BPS_PRECISION;
    }
}
