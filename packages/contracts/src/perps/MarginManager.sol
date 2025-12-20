// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IMarginManager, IPriceOracle} from "./interfaces/IPerps.sol";

/**
 * @title MarginManager
 * @notice Manages trader collateral for perpetual positions
 * @dev Supports multiple collateral tokens with cross-margin capabilities
 */
contract MarginManager is IMarginManager, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Price oracle for collateral valuation
    IPriceOracle public priceOracle;
    
    // Authorized trading contracts
    mapping(address => bool) public authorizedContracts;
    
    // Accepted collateral tokens with haircut factors (in bps, 10000 = 100%)
    mapping(address => uint256) public collateralFactors;
    address[] public acceptedTokensList;
    
    // Trader balances: trader => token => balance
    mapping(address => mapping(address => uint256)) public balances;
    
    // Locked collateral: trader => token => amount
    mapping(address => mapping(address => uint256)) public lockedCollateral;
    
    // Position-specific locks: positionId => token => amount
    mapping(bytes32 => mapping(address => uint256)) public positionLocks;
    
    constructor(address _priceOracle, address _owner) Ownable(_owner) {
        priceOracle = IPriceOracle(_priceOracle);
    }
    
    modifier onlyAuthorized() {
        require(authorizedContracts[msg.sender], "Not authorized");
        _;
    }

    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        authorizedContracts[contractAddr] = authorized;
    }
    
    function setPriceOracle(address _priceOracle) external onlyOwner {
        priceOracle = IPriceOracle(_priceOracle);
    }
    
    function addAcceptedToken(address token, uint256 collateralFactor) external onlyOwner {
        require(collateralFactor > 0 && collateralFactor <= 10000, "Invalid factor");
        
        if (collateralFactors[token] == 0) {
            acceptedTokensList.push(token);
        }
        collateralFactors[token] = collateralFactor;
    }
    
    function removeAcceptedToken(address token) external onlyOwner {
        collateralFactors[token] = 0;
        
        // Remove from list
        for (uint256 i = 0; i < acceptedTokensList.length; i++) {
            if (acceptedTokensList[i] == token) {
                acceptedTokensList[i] = acceptedTokensList[acceptedTokensList.length - 1];
                acceptedTokensList.pop();
                break;
            }
        }
    }
    
    function deposit(address token, uint256 amount) external nonReentrant {
        require(collateralFactors[token] > 0, "Token not accepted");
        require(amount > 0, "Amount must be > 0");
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender][token] += amount;
        
        emit Deposit(msg.sender, token, amount);
    }
    
    function withdraw(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        
        uint256 available = getAvailableCollateral(msg.sender, token);
        require(available >= amount, "Insufficient available collateral");
        
        balances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        
        emit Withdraw(msg.sender, token, amount);
    }
    
    function lockCollateral(
        address trader,
        address token,
        uint256 amount,
        bytes32 positionId
    ) external onlyAuthorized {
        // Ensure trader has sufficient balance or accept direct transfer
        if (balances[trader][token] >= amount) {
            balances[trader][token] -= amount;
        }
        
        lockedCollateral[trader][token] += amount;
        positionLocks[positionId][token] += amount;
        
        emit CollateralLocked(trader, positionId, amount);
    }
    
    function releaseCollateral(
        address trader,
        address token,
        uint256 amount,
        bytes32 positionId
    ) external onlyAuthorized {
        uint256 locked = positionLocks[positionId][token];
        uint256 toRelease = amount > locked ? locked : amount;
        
        positionLocks[positionId][token] -= toRelease;
        lockedCollateral[trader][token] -= toRelease;
        balances[trader][token] += toRelease;
        
        emit CollateralReleased(trader, positionId, toRelease);
    }
    
    function getCollateralBalance(address trader, address token) external view returns (uint256) {
        return balances[trader][token];
    }
    
    function getTotalCollateralValue(address trader) external view returns (uint256 totalValueUSD) {
        for (uint256 i = 0; i < acceptedTokensList.length; i++) {
            address token = acceptedTokensList[i];
            uint256 balance = balances[trader][token] + lockedCollateral[trader][token];
            
            if (balance > 0) {
                (uint256 price, ) = priceOracle.getPrice(token);
                uint256 factor = collateralFactors[token];
                
                // Value = balance * price * factor / 10000
                uint256 tokenValue = (balance * price * factor) / (1e18 * 10000);
                totalValueUSD += tokenValue;
            }
        }
    }
    
    function getAvailableCollateral(address trader, address token) public view returns (uint256) {
        uint256 total = balances[trader][token];
        uint256 locked = lockedCollateral[trader][token];
        
        return total > locked ? total - locked : 0;
    }
    
    function getAcceptedTokens() external view returns (address[] memory) {
        return acceptedTokensList;
    }
    
    function getLockedCollateral(address trader, address token) external view returns (uint256) {
        return lockedCollateral[trader][token];
    }
    
    function getPositionCollateral(bytes32 positionId, address token) external view returns (uint256) {
        return positionLocks[positionId][token];
    }
}

