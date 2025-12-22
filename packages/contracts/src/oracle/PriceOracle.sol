// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/**
 * @title PriceOracle
 * @notice Simple price oracle for token valuations
 */
contract PriceOracle is IPriceOracle, Ownable {
    struct PriceData {
        uint256 price;
        uint256 decimals;
        uint256 updatedAt;
    }

    mapping(address => PriceData) public prices;
    uint256 public stalenessThreshold = 1 hours;

    error PriceNotAvailable();

    event PriceUpdated(address indexed token, uint256 price, uint256 decimals);
    event StalenessThresholdUpdated(uint256 newThreshold);

    constructor() Ownable(msg.sender) {}

    function setPrice(address token, uint256 price, uint256 decimals) external onlyOwner {
        prices[token] = PriceData({
            price: price,
            decimals: decimals,
            updatedAt: block.timestamp
        });
        emit PriceUpdated(token, price, decimals);
    }

    function setStalenessThreshold(uint256 threshold) external onlyOwner {
        stalenessThreshold = threshold;
        emit StalenessThresholdUpdated(threshold);
    }

    function getPrice(address token) external view override returns (uint256 priceUSD, uint256 decimals) {
        PriceData memory data = prices[token];
        if (data.updatedAt == 0) revert PriceNotAvailable();
        return (data.price, data.decimals);
    }

    function isPriceFresh(address token) external view override returns (bool fresh) {
        PriceData memory data = prices[token];
        if (data.updatedAt == 0) return false;
        return block.timestamp - data.updatedAt <= stalenessThreshold;
    }

    function convertAmount(address fromToken, address toToken, uint256 amount)
        external
        view
        override
        returns (uint256 convertedAmount)
    {
        PriceData memory priceFrom = prices[fromToken];
        PriceData memory priceTo = prices[toToken];
        
        if (priceFrom.updatedAt == 0 || priceTo.updatedAt == 0) revert PriceNotAvailable();
        
        // Normalize to same decimals and convert
        // amountOut = amountIn * priceIn / priceOut
        return (amount * priceFrom.price * (10 ** priceTo.decimals)) / (priceTo.price * (10 ** priceFrom.decimals));
    }

    function getPriceUSD(address token) external view returns (uint256) {
        PriceData memory data = prices[token];
        if (data.updatedAt == 0) revert PriceNotAvailable();
        return data.price;
    }
}
