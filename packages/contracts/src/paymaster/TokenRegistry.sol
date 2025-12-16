// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TokenRegistry
 * @notice Registry of supported tokens for paymaster operations
 */
contract TokenRegistry is Ownable {
    struct TokenInfo {
        bool supported;
        address priceFeed;
        uint256 minMargin;
        uint256 maxMargin;
        address registrant;
        uint256 registeredAt;
    }

    address public treasury;
    uint256 public registrationFee = 0.1 ether;
    
    mapping(address => TokenInfo) public tokens;
    address[] public supportedTokens;

    error TokenNotSupported();
    error TokenAlreadySupported();
    error InvalidAmount();
    error InsufficientFee();
    error InvalidMargin();

    event TokenRegistered(address indexed token, address indexed registrant, address priceFeed);
    event TokenRemoved(address indexed token);
    event TokenUpdated(address indexed token, uint256 minMargin, uint256 maxMargin);
    event RegistrationFeeUpdated(uint256 newFee);

    constructor(address _owner, address _treasury) Ownable(_owner) {
        treasury = _treasury;
    }

    function registerToken(
        address token,
        address priceFeed,
        uint256 minMargin,
        uint256 maxMargin
    ) external payable {
        if (msg.value < registrationFee) revert InsufficientFee();
        if (tokens[token].supported) revert TokenAlreadySupported();
        if (maxMargin < minMargin) revert InvalidMargin();
        
        tokens[token] = TokenInfo({
            supported: true,
            priceFeed: priceFeed,
            minMargin: minMargin,
            maxMargin: maxMargin,
            registrant: msg.sender,
            registeredAt: block.timestamp
        });
        supportedTokens.push(token);
        
        // Send fee to treasury
        payable(treasury).transfer(msg.value);
        
        emit TokenRegistered(token, msg.sender, priceFeed);
    }

    function removeToken(address token) external onlyOwner {
        if (!tokens[token].supported) revert TokenNotSupported();
        tokens[token].supported = false;
        emit TokenRemoved(token);
    }

    function deactivateToken(address token) external onlyOwner {
        if (!tokens[token].supported) revert TokenNotSupported();
        tokens[token].supported = false;
        emit TokenRemoved(token);
    }

    function updateToken(address token, uint256 minMargin, uint256 maxMargin) external onlyOwner {
        if (!tokens[token].supported) revert TokenNotSupported();
        tokens[token].minMargin = minMargin;
        tokens[token].maxMargin = maxMargin;
        emit TokenUpdated(token, minMargin, maxMargin);
    }

    function setRegistrationFee(uint256 newFee) external onlyOwner {
        registrationFee = newFee;
        emit RegistrationFeeUpdated(newFee);
    }

    function isSupported(address token) external view returns (bool) {
        return tokens[token].supported;
    }

    function getTokenInfo(address token) external view returns (TokenInfo memory) {
        return tokens[token];
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return supportedTokens;
    }

    function getSupportedTokenCount() external view returns (uint256) {
        return supportedTokens.length;
    }
}
