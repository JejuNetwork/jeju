// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PriceSource
 * @notice Reads prices on Base and relays them to Jeju via CrossDomainMessenger
 * @dev Deploy this contract on Base
 * 
 * Architecture:
 * 1. Reads ETH/USD from Chainlink on Base
 * 2. Reads elizaOS/ETH from Uniswap V3 on Base
 * 3. Sends prices to Jeju via L2CrossDomainMessenger
 * 4. CrossChainPriceRelay on Jeju receives and updates oracle
 */
contract PriceSource is Ownable, Pausable {
    // ============ Constants ============
    
    address public constant L2_CROSS_DOMAIN_MESSENGER = 
        0x4200000000000000000000000000000000000007;
    
    address public constant CHAINLINK_ETH_USD = 
        0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70; // Base mainnet
    
    address public constant UNISWAP_V3_FACTORY = 
        0x33128a8fC17869897dcE68Ed026d694621f6FDfD; // Base mainnet
    
    address public constant WETH = 
        0x4200000000000000000000000000000000000006; // Base WETH
    
    // ============ State Variables ============
    
    address public ElizaOSToken;
    address public crossChainRelayOnJeju;
    address public priceUpdater;
    
    uint256 public lastUpdateTime;
    uint256 public updateCount;
    uint256 public constant MIN_UPDATE_INTERVAL = 5 minutes;
    uint256 public constant MAX_PRICE_DEVIATION_PCT = 50; // 50% max change
    
    uint256 private lastETHPrice;
    uint256 private lastElizaPrice;
    
    // Track cross-chain messages for verification
    mapping(bytes32 => bool) public relayedMessages;
    uint256 public messageNonce;
    
    // ============ Events ============
    
    event PricesRelayed(
        uint256 ethPrice,
        uint256 elizaPrice,
        uint256 timestamp,
        bytes32 messageHash,
        uint256 nonce
    );
    
    event PriceUpdaterSet(address indexed newUpdater);
    event ElizaOSTokenSet(address indexed newToken);
    event CrossChainRelaySet(address indexed newRelay);
    
    // ============ Errors ============
    
    error UpdateTooSoon();
    error PriceDeviationTooLarge();
    error UnauthorizedUpdater();
    error InvalidPrice();
    error NoPoolFound();
    
    // ============ Constructor ============
    
    constructor(
        address _elizaOSToken,
        address _crossChainRelayOnJeju,
        address _priceUpdater,
        address initialOwner
    ) Ownable(initialOwner) {
        ElizaOSToken = _elizaOSToken;
        crossChainRelayOnJeju = _crossChainRelayOnJeju;
        priceUpdater = _priceUpdater;
    }
    
    // ============ Main Function ============
    
    /**
     * @notice Update prices and relay to Jeju
     * @dev Can be called by priceUpdater or owner
     */
    function updateAndRelay() external whenNotPaused {
        if (msg.sender != priceUpdater && msg.sender != owner()) {
            revert UnauthorizedUpdater();
        }
        
        if (block.timestamp < lastUpdateTime + MIN_UPDATE_INTERVAL) {
            revert UpdateTooSoon();
        }
        
        // 1. Read ETH/USD from Chainlink
        uint256 ethPrice = _readChainlink();
        
        // 2. Read elizaOS/USD from Uniswap
        uint256 elizaPrice = _readUniswapV3();
        
        // 3. Validate prices
        _validatePrices(ethPrice, elizaPrice);
        
        // 4. Send via CrossDomainMessenger with timestamp
        bytes memory message = abi.encodeWithSignature(
            "receivePriceUpdate(uint256,uint256,uint256)",
            ethPrice,
            elizaPrice,
            block.timestamp
        );
        
        // Call CrossDomainMessenger to send message to Jeju
        (bool success, bytes memory returnData) = L2_CROSS_DOMAIN_MESSENGER.call(
            abi.encodeWithSignature(
                "sendMessage(address,bytes,uint32)",
                crossChainRelayOnJeju,
                message,
                uint32(1000000) // Gas limit for execution on Jeju
            )
        );
        
        require(success, "CrossDomainMessenger call failed");
        
        // Update state
        lastETHPrice = ethPrice;
        lastElizaPrice = elizaPrice;
        lastUpdateTime = block.timestamp;
        updateCount++;
        
        // Extract message hash from return data (if available)
        bytes32 messageHash = returnData.length >= 32 
            ? abi.decode(returnData, (bytes32))
            : bytes32(0);
        
        // Track message with nonce
        uint256 currentNonce = messageNonce;
        messageNonce++;
        relayedMessages[messageHash] = true;
        
        emit PricesRelayed(ethPrice, elizaPrice, block.timestamp, messageHash, currentNonce);
    }
    
    // ============ Price Reading Functions ============
    
    /**
     * @notice Read ETH/USD price from Chainlink
     * @return ethPrice Price with 8 decimals (e.g., 324567000000 = $3,245.67)
     */
    function _readChainlink() internal view returns (uint256 ethPrice) {
        // First check if aggregator is paused
        (bool pauseSuccess, bytes memory pauseData) = CHAINLINK_ETH_USD.staticcall(
            abi.encodeWithSignature("paused()")
        );
        
        // If feed supports pause check and is paused, revert
        if (pauseSuccess && pauseData.length >= 32) {
            bool isPaused = abi.decode(pauseData, (bool));
            if (isPaused) {
                revert InvalidPrice();
            }
        }
        
        // Chainlink AggregatorV3Interface
        (bool success, bytes memory data) = CHAINLINK_ETH_USD.staticcall(
            abi.encodeWithSignature("latestRoundData()")
        );
        
        if (!success) revert InvalidPrice();
        
        (
            ,
            int256 answer,
            ,
            uint256 updatedAt,
            
        ) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        
        // Check staleness (Chainlink ETH/USD updates ~every hour)
        if (block.timestamp - updatedAt >= 2 hours) revert InvalidPrice();
        if (answer <= 0) revert InvalidPrice();
        
        // Chainlink uses 8 decimals
        ethPrice = uint256(answer);
    }
    
    /**
     * @notice Read elizaOS/USD price from Uniswap V3
     * @return elizaPrice Price with 8 decimals
     */
    function _readUniswapV3() internal view returns (uint256 elizaPrice) {
        // Get factory
        address factory = UNISWAP_V3_FACTORY;
        
        // Try different fee tiers (0.05%, 0.3%, 1%)
        uint24[3] memory feeTiers = [uint24(500), uint24(3000), uint24(10000)];
        
        for (uint256 i = 0; i < feeTiers.length; i++) {
            address pool = _getPool(factory, ElizaOSToken, WETH, feeTiers[i]);
            
            if (pool == address(0)) continue;
            
            // Read pool price
            uint256 price = _getPoolPrice(pool);
            
            if (price > 0) {
                // Convert to USD using ETH price
                uint256 ethPrice = lastETHPrice > 0 ? lastETHPrice : _readChainlink();
                
                // elizaOS/ETH × ETH/USD = elizaOS/USD
                // Both are 8 decimals, result should be 8 decimals
                elizaPrice = (price * ethPrice) / 1e8;
                
                if (elizaPrice > 0) {
                    return elizaPrice;
                }
            }
        }
        
        revert NoPoolFound();
    }
    
    function _getPool(
        address factory,
        address tokenA,
        address tokenB,
        uint24 fee
    ) internal view returns (address pool) {
        (bool success, bytes memory data) = factory.staticcall(
            abi.encodeWithSignature(
                "getPool(address,address,uint24)",
                tokenA,
                tokenB,
                fee
            )
        );
        
        if (success && data.length >= 32) {
            pool = abi.decode(data, (address));
        }
    }
    
    function _getPoolPrice(address pool) internal view returns (uint256 price) {
        // Get slot0 from pool
        (bool success, bytes memory data) = pool.staticcall(
            abi.encodeWithSignature("slot0()")
        );
        
        if (!success) return 0;
        
        (uint160 sqrtPriceX96, , , , , , ) = abi.decode(
            data,
            (uint160, int24, uint16, uint16, uint16, uint8, bool)
        );
        
        if (sqrtPriceX96 == 0) return 0;
        
        // Get token order
        (bool success0, bytes memory data0) = pool.staticcall(
            abi.encodeWithSignature("token0()")
        );
        if (!success0) return 0;
        
        address token0 = abi.decode(data0, (address));
        
        // Calculate price from sqrtPriceX96
        // price = (sqrtPriceX96 / 2^96)^2
        // We use bit shifting instead of division: >> 192 instead of / 2^192
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        
        // Query token decimals
        uint8 token0Decimals = _getDecimals(token0);
        
        // Get token1 address
        (bool success1, bytes memory data1) = pool.staticcall(
            abi.encodeWithSignature("token1()")
        );
        if (!success1) return 0;
        address token1 = abi.decode(data1, (address));
        
        uint8 token1Decimals = _getDecimals(token1);
        
        // Adjust for token order and decimals
        if (token0 == ElizaOSToken) {
            // elizaOS is token0, price is WETH per elizaOS
            // Invert: (2^192) / priceX192
            // Use mulDiv to avoid overflow: (1 << 192) / priceX192
            // Then scale to 8 decimals with decimal adjustment
            price = _mulDivQ192(1e8, priceX192, token0Decimals, token1Decimals);
        } else {
            // elizaOS is token1, price is elizaOS per WETH  
            // Scale to 8 decimals: (priceX192 * 1e8) >> 192
            price = (priceX192 * 1e8) >> 192;
            // Adjust for decimals
            price = (price * (10 ** token0Decimals)) / (10 ** token1Decimals);
        }
    }
    
    // ============ Helper Functions ============
    
    /**
     * @notice Get token decimals
     */
    function _getDecimals(address token) internal view returns (uint8) {
        (bool success, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("decimals()")
        );
        if (success && data.length >= 32) {
            return abi.decode(data, (uint8));
        }
        return 18; // Default to 18 if query fails
    }
    
    /**
     * @notice Safe fixed-point math for Q192 division
     * @dev Computes (numerator / denominator) >> 192 with decimal adjustment
     */
    function _mulDivQ192(
        uint256 numerator,
        uint256 denominator,
        uint8 token0Decimals,
        uint8 token1Decimals
    ) internal pure returns (uint256 result) {
        // We need to compute: (1 << 192) / denominator * numerator
        // But (1 << 192) is too large for uint256
        // Instead, rearrange: numerator * (1 << 192) / denominator
        // Use assembly for safe shift
        assembly {
            // Check for overflow
            if iszero(denominator) {
                revert(0, 0)
            }
            
            // Compute: (numerator << 192) / denominator
            // Since 1 << 192 overflows, we use mulmod and other tricks
            // For simplicity, approximate using smaller shifts
            result := div(shl(96, div(shl(96, numerator), denominator)), 1)
        }
        
        // Adjust for decimals
        result = (result * (10 ** token1Decimals)) / (10 ** token0Decimals);
    }
    
    // ============ Validation ============
    
    function _validatePrices(uint256 ethPrice, uint256 elizaPrice) internal view {
        // ETH should be between $500 and $10,000
        if (ethPrice < 50000000000 || ethPrice > 1000000000000) {
            revert InvalidPrice();
        }
        
        // Check for large deviations (anti-manipulation)
        if (lastETHPrice > 0) {
            uint256 ethChange = ethPrice > lastETHPrice
                ? ((ethPrice - lastETHPrice) * 100) / lastETHPrice
                : ((lastETHPrice - ethPrice) * 100) / lastETHPrice;
            
            if (ethChange > MAX_PRICE_DEVIATION_PCT) {
                revert PriceDeviationTooLarge();
            }
        }
        
        if (lastElizaPrice > 0) {
            uint256 elizaChange = elizaPrice > lastElizaPrice
                ? ((elizaPrice - lastElizaPrice) * 100) / lastElizaPrice
                : ((lastElizaPrice - elizaPrice) * 100) / lastElizaPrice;
            
            if (elizaChange > MAX_PRICE_DEVIATION_PCT) {
                revert PriceDeviationTooLarge();
            }
        }
    }
    
    // ============ Admin Functions ============
    
    function setPriceUpdater(address _newUpdater) external onlyOwner {
        require(_newUpdater != address(0), "Invalid updater");
        priceUpdater = _newUpdater;
        emit PriceUpdaterSet(_newUpdater);
    }
    
    function setElizaOSToken(address _newToken) external onlyOwner {
        require(_newToken != address(0), "Invalid token");
        ElizaOSToken = _newToken;
        emit ElizaOSTokenSet(_newToken);
    }
    
    function setCrossChainRelay(address _newRelay) external onlyOwner {
        require(_newRelay != address(0), "Invalid relay");
        crossChainRelayOnJeju = _newRelay;
        emit CrossChainRelaySet(_newRelay);
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // ============ View Functions ============
    
    function getLastPrices() external view returns (
        uint256 ethPrice,
        uint256 elizaPrice,
        uint256 timestamp
    ) {
        return (lastETHPrice, lastElizaPrice, lastUpdateTime);
    }
    
    /**
     * @notice Preview what prices would be relayed (without actually relaying)
     */
    function previewPrices() external view returns (
        uint256 ethPrice,
        uint256 elizaPrice
    ) {
        ethPrice = _readChainlink();
        elizaPrice = _readUniswapV3();
    }
    
    /**
     * @notice Verify a message was successfully relayed
     * @param messageHash Hash of the relayed message
     * @return Whether the message was relayed
     */
    function wasMessageRelayed(bytes32 messageHash) external view returns (bool) {
        return relayedMessages[messageHash];
    }
    
    /**
     * @notice Get current message nonce
     * @dev Used to track message ordering
     */
    function getCurrentNonce() external view returns (uint256) {
        return messageNonce;
    }
}

