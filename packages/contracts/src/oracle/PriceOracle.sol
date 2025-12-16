// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PriceOracle
 * @notice Simple price oracle for token valuations
 */
contract PriceOracle is Ownable {
    struct PriceData {
        uint256 price;
        uint8 decimals;
        uint256 updatedAt;
    }

    mapping(address => PriceData) public prices;

    error PriceNotAvailable();
    error StalePrice();

    event PriceUpdated(address indexed token, uint256 price, uint8 decimals);

    constructor() Ownable(msg.sender) {}

    function setPrice(address token, uint256 price, uint8 decimals) external onlyOwner {
        prices[token] = PriceData({
            price: price,
            decimals: decimals,
            updatedAt: block.timestamp
        });
        emit PriceUpdated(token, price, decimals);
    }

    function getPrice(address token) external view returns (uint256 price, uint8 decimals) {
        PriceData memory data = prices[token];
        if (data.updatedAt == 0) revert PriceNotAvailable();
        return (data.price, data.decimals);
    }

    function getPriceUSD(address token) external view returns (uint256) {
        PriceData memory data = prices[token];
        if (data.updatedAt == 0) revert PriceNotAvailable();
        return data.price;
    }

    function getQuote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        PriceData memory priceIn = prices[tokenIn];
        PriceData memory priceOut = prices[tokenOut];
        
        if (priceIn.updatedAt == 0 || priceOut.updatedAt == 0) revert PriceNotAvailable();
        
        // amountOut = amountIn * priceIn / priceOut
        return (amountIn * priceIn.price) / priceOut.price;
    }

    function isPriceValid(address token, uint256 maxAge) external view returns (bool) {
        PriceData memory data = prices[token];
        if (data.updatedAt == 0) return false;
        return block.timestamp - data.updatedAt <= maxAge;
    }
}

