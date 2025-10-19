// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ICrossDomainMessenger
 * @notice Interface for OP Stack CrossDomainMessenger
 */
interface ICrossDomainMessenger {
    function xDomainMessageSender() external view returns (address);
    
    function sendMessage(
        address _target,
        bytes calldata _message,
        uint32 _minGasLimit
    ) external payable;
}

/**
 * @title CrossChainPriceRelay
 * @notice Receives price updates from Base via CrossDomainMessenger
 * @dev Deploy on Jeju. Works with PriceSource.sol deployed on Base.
 * 
 * Architecture:
 * 1. PriceSource on Base reads Chainlink + DEX prices
 * 2. PriceSource calls L2CrossDomainMessenger.sendMessage()
 * 3. Message relayed to Jeju (1-2 minute latency)
 * 4. This contract receives and validates
 * 5. Updates ManualPriceOracle with new prices
 * 
 * Security:
 * - Only accepts messages from L2CrossDomainMessenger
 * - Verifies xDomainMessageSender is authorized PriceSource
 * - Owner can pause/update parameters
 * 
 * Cost: ~$0.03 per update (~$260/month for 5-min updates)
 * vs Bot: ~$5/month
 * 
 * Trade-off: More decentralized but more expensive
 */
contract CrossChainPriceRelay is Ownable, ReentrancyGuard {
    // ============ State Variables ============
    
    /// @notice Address of CrossDomainMessenger (OP Stack predeploy)
    address public constant L2_CROSS_DOMAIN_MESSENGER = 
        0x4200000000000000000000000000000000000007;
    
    /// @notice Address of PriceSource contract on Base
    address public priceSourceOnBase;
    
    /// @notice Address of ManualPriceOracle to update
    address public targetOracle;
    
    /// @notice Timestamp of last successful price update
    uint256 public lastUpdateTime;
    
    /// @notice Total number of price updates received
    uint256 public updateCount;
    
    // ============ Events ============
    
    event PriceReceived(
        uint256 ethPrice,
        uint256 elizaPrice,
        uint256 timestamp
    );
    event PriceSourceUpdated(address indexed newSource);
    event TargetOracleUpdated(address indexed newOracle);
    
    // ============ Errors ============
    
    error OnlyCrossChainMessenger();
    error InvalidCaller();
    error OracleUpdateFailed();
    
    // ============ Constructor ============
    
    constructor(
        address _priceSourceOnBase,
        address _targetOracle,
        address initialOwner
    ) Ownable(initialOwner) {
        priceSourceOnBase = _priceSourceOnBase;
        targetOracle = _targetOracle;
    }
    
    // ============ Core Functions ============
    
    /**
     * @notice Receive price update from Base via CrossDomainMessenger
     * @param ethPrice ETH/USD price (8 decimals)
     * @param elizaPrice elizaOS/USD price (8 decimals)
     * @dev Only callable by CrossDomainMessenger with authorized sender
     * @dev Protected against reentrancy attacks
     */
    function receivePriceUpdate(
        uint256 ethPrice,
        uint256 elizaPrice
    ) external nonReentrant {
        // Verify caller is CrossDomainMessenger
        if (msg.sender != L2_CROSS_DOMAIN_MESSENGER) {
            revert OnlyCrossChainMessenger();
        }
        
        // Verify original sender is our authorized PriceSource on Base
        address xDomainSender = ICrossDomainMessenger(msg.sender).xDomainMessageSender();
        
        if (xDomainSender != priceSourceOnBase) {
            revert InvalidCaller();
        }
        
        // Store last update timestamp before external call
        uint256 timestamp = block.timestamp;
        
        // Update oracle with proper interface call
        (bool success, bytes memory returnData) = targetOracle.call(
            abi.encodeWithSignature(
                "updatePrices(uint256,uint256)",
                ethPrice,
                elizaPrice
            )
        );
        
        if (!success) {
            // Extract revert reason if available
            if (returnData.length > 0) {
                assembly {
                    let returnDataSize := mload(returnData)
                    revert(add(32, returnData), returnDataSize)
                }
            }
            revert OracleUpdateFailed();
        }
        
        // Verify oracle was actually updated by checking its timestamp
        (bool checkSuccess, bytes memory checkData) = targetOracle.staticcall(
            abi.encodeWithSignature("lastUpdateTime()")
        );
        if (checkSuccess && checkData.length >= 32) {
            uint256 oracleTimestamp = abi.decode(checkData, (uint256));
            if (oracleTimestamp < timestamp) {
                revert OracleUpdateFailed();
            }
        }
        
        lastUpdateTime = block.timestamp;
        updateCount++;
        
        emit PriceReceived(ethPrice, elizaPrice, block.timestamp);
    }
    
    // ============ Admin Functions ============
    
    error InvalidAddress();
    
    /**
     * @notice Update authorized PriceSource on Base
     */
    function setPriceSource(address _newSource) external onlyOwner {
        if (_newSource == address(0)) revert InvalidAddress();
        priceSourceOnBase = _newSource;
        emit PriceSourceUpdated(_newSource);
    }
    
    /**
     * @notice Update target oracle address
     */
    function setTargetOracle(address _newOracle) external onlyOwner {
        if (_newOracle == address(0)) revert InvalidAddress();
        targetOracle = _newOracle;
        emit TargetOracleUpdated(_newOracle);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get relay status and statistics
     */
    function getRelayInfo() external view returns (
        address _priceSourceOnBase,
        address _targetOracle,
        uint256 _lastUpdateTime,
        uint256 _updateCount
    ) {
        return (
            priceSourceOnBase,
            targetOracle,
            lastUpdateTime,
            updateCount
        );
    }
}
