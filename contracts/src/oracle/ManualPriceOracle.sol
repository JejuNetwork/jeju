// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ManualPriceOracle
 * @author Jeju Network
 * @notice Provides elizaOS/ETH exchange rates through authorized manual price updates
 * @dev Simple oracle implementation for launch phase where prices are updated by an
 *      authorized bot/keeper reading from Base DEX data (Uniswap/Aerodrome).
 *      Designed for easy migration to automated oracles (Chainlink, Pyth, etc.) later.
 * 
 * Architecture:
 * - Stores ETH/USD and elizaOS/USD prices (8 decimals, Chainlink format)
 * - Authorized updater (bot) pulls prices from Base and pushes to Jeju
 * - Calculates elizaOS per ETH on-demand for paymaster
 * - Staleness checks ensure prices are recent
 * - Safety limits prevent extreme price manipulation
 * 
 * Price Update Flow:
 * 1. Bot reads prices from Base (Uniswap TWAP, Chainlink feeds)
 * 2. Bot calls updatePrices() on Jeju with new values
 * 3. Contract validates prices are within bounds and not too different
 * 4. Updates stored prices and timestamp
 * 5. Paymaster uses fresh prices for fee calculations
 * 
 * Security Features:
 * - Only authorized updater or owner can set prices
 * - Staleness threshold (1 hour) flags outdated prices
 * - Maximum deviation check (50%) prevents sudden manipulation
 * - Price bounds prevent absurd values
 * - Emergency update function bypasses deviation checks
 * 
 * Future Enhancements:
 * - Can integrate Chainlink price feeds on Jeju
 * - Can use cross-chain messaging for trustless relay from Base
 * - Can aggregate multiple price sources (Pyth, API3, etc.)
 * 
 * @custom:security-contact security@jeju.network
 */
contract ManualPriceOracle is Ownable {
    // ============ State Variables ============
    
    /// @notice Current ETH price in USD with 8 decimals (e.g., 300000000000 = $3000)
    uint256 public ethUsdPrice;
    
    /// @notice Current elizaOS price in USD with 8 decimals (e.g., 10000000 = $0.10)
    uint256 public elizaUsdPrice;
    
    /// @notice Timestamp of the last price update
    uint256 public lastUpdateTime;
    
    /// @notice Authorized address that can update prices (bot/keeper)
    address public priceUpdater;
    
    // ============ Safety Parameters ============
    
    /// @notice Time threshold after which price is considered stale (1 hour)
    uint256 public constant PRICE_STALE_THRESHOLD = 1 hours;
    
    /// @notice Maximum allowed price change percentage per update (50%)
    /// @dev Prevents manipulation, bypassed if price is >24h old
    uint256 public constant MAX_DEVIATION_PCT = 50;
    
    /// @notice Minimum allowed elizaOS price: $0.000001 (8 decimals)
    uint256 public constant MIN_ELIZA_PRICE = 100;
    
    /// @notice Maximum allowed elizaOS price: $10,000 (8 decimals)
    uint256 public constant MAX_ELIZA_PRICE = 1000000000000;
    
    /// @notice Minimum allowed ETH price: $500 (8 decimals)
    uint256 public constant MIN_ETH_PRICE = 50000000000;
    
    /// @notice Maximum allowed ETH price: $10,000 (8 decimals)
    uint256 public constant MAX_ETH_PRICE = 1000000000000;
    
    // ============ Events ============
    
    event PricesUpdated(
        uint256 ethPrice,
        uint256 elizaPrice,
        uint256 timestamp
    );
    event PriceUpdaterSet(address indexed updater);
    
    // ============ Errors ============
    
    error PriceOutOfBounds();
    error PriceDeviationTooLarge();
    error NotAuthorized();
    error StalePriceData();
    error InvalidAddress();
    error InvalidPrice();
    
    // ============ Constructor ============
    
    /**
     * @notice Constructs the ManualPriceOracle with initial prices
     * @param _initialETHPrice Initial ETH/USD price (8 decimals)
     * @param _initialElizaPrice Initial elizaOS/USD price (8 decimals)
     * @param initialOwner Address that will own the contract
     * @dev Validates initial prices are within bounds before setting
     * 
     * Example: To set ETH at $3000 and elizaOS at $0.10:
     * - _initialETHPrice = 300000000000 (3000 * 1e8)
     * - _initialElizaPrice = 10000000 (0.10 * 1e8)
     */
    constructor(
        uint256 _initialETHPrice,
        uint256 _initialElizaPrice,
        address initialOwner
    ) Ownable(initialOwner) {
        _validatePrices(_initialETHPrice, _initialElizaPrice);
        
        ethUsdPrice = _initialETHPrice;
        elizaUsdPrice = _initialElizaPrice;
        lastUpdateTime = block.timestamp;
    }
    
    // ============ Core Functions ============
    
    /**
     * @notice Calculate how many elizaOS tokens equal 1 ETH
     * @return Amount of elizaOS tokens (18 decimals) per 1 ETH
     * @dev Used by paymaster to determine how many elizaOS to charge for gas.
     * 
     * Calculation:
     * - ETH/USD ÷ elizaOS/USD = elizaOS per ETH
     * - Scale from 8 decimals to 18 decimals for token math
     * 
     * Example: ETH = $3000, elizaOS = $0.10:
     * - Exchange rate = 3000 / 0.10 = 30,000 elizaOS per ETH
     * - Returned value = 30000e18
     */
    function getElizaOSPerETH() external view returns (uint256) {
        // Calculate: (ETH/USD) / (elizaOS/USD) = elizaOS per ETH
        // Both prices have 8 decimals. To get the result in 18 decimals (for ERC20):
        // (ethPrice_8decimals / elizaPrice_8decimals) * 1e18
        // = (ethPrice * 1e18) / elizaPrice
        uint256 elizaPerEth = (ethUsdPrice * 1e18) / elizaUsdPrice;
        return elizaPerEth;
    }
    
    /**
     * @notice Update both ETH and elizaOS prices
     * @param newETHPrice New ETH/USD price with 8 decimals
     * @param newElizaPrice New elizaOS/USD price with 8 decimals
     * @dev Only callable by authorized price updater or owner.
     *      Validates prices are within bounds and deviation limits.
     * 
     * Called by bot that:
     * 1. Reads prices from Base (Uniswap TWAP, Chainlink feeds)
     * 2. Pushes updates to Jeju every few minutes
     * 3. Ensures paymaster always has fresh prices
     * 
     * @custom:security Deviation checks prevent >50% price moves (unless stale >24h)
     * @custom:security Bounds checks prevent absurd values
     */
    function updatePrices(
        uint256 newETHPrice,
        uint256 newElizaPrice
    ) external {
        if (msg.sender != priceUpdater && msg.sender != owner()) {
            revert NotAuthorized();
        }
        
        _validatePrices(newETHPrice, newElizaPrice);
        _checkDeviationLimits(newETHPrice, newElizaPrice);
        
        ethUsdPrice = newETHPrice;
        elizaUsdPrice = newElizaPrice;
        lastUpdateTime = block.timestamp;
        
        emit PricesUpdated(newETHPrice, newElizaPrice, block.timestamp);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Check if current price data is fresh (not stale)
     * @return True if last update was within PRICE_STALE_THRESHOLD (1 hour)
     * @dev Called by paymaster before sponsoring transactions to ensure safe pricing
     */
    function isPriceFresh() external view returns (bool) {
        return block.timestamp - lastUpdateTime <= PRICE_STALE_THRESHOLD;
    }
    
    /**
     * @notice Get all current price data and freshness status
     * @return _ethUsdPrice Current ETH/USD price (8 decimals)
     * @return _elizaUsdPrice Current elizaOS/USD price (8 decimals)
     * @return _lastUpdate Timestamp of last price update
     * @return fresh Whether price is within staleness threshold
     * @dev Useful for monitoring dashboards and frontend displays
     */
    function getPrices() external view returns (
        uint256 _ethUsdPrice,
        uint256 _elizaUsdPrice,
        uint256 _lastUpdate,
        bool fresh
    ) {
        _ethUsdPrice = ethUsdPrice;
        _elizaUsdPrice = elizaUsdPrice;
        _lastUpdate = lastUpdateTime;
        fresh = block.timestamp - lastUpdateTime <= PRICE_STALE_THRESHOLD;
    }
    
    /**
     * @notice Preview how much elizaOS is needed for a given ETH amount
     * @param ethAmount Amount of ETH in wei (18 decimals)
     * @return Amount of elizaOS tokens needed (18 decimals)
     * @dev Helper function for frontends to show users expected costs
     * 
     * Example: How much elizaOS for 0.001 ETH gas?
     * - If 1 ETH = 30,000 elizaOS
     * - 0.001 ETH = 30 elizaOS
     */
    function previewConversion(uint256 ethAmount) external view returns (uint256) {
        uint256 elizaPerEth = this.getElizaOSPerETH();
        return (ethAmount * elizaPerEth) / 1 ether;
    }
    
    // ============ Internal Functions ============
    
    function _validatePrices(uint256 ethPrice, uint256 elizaPrice) internal pure {
        if (ethPrice < MIN_ETH_PRICE || ethPrice > MAX_ETH_PRICE) {
            revert PriceOutOfBounds();
        }
        if (elizaPrice < MIN_ELIZA_PRICE || elizaPrice > MAX_ELIZA_PRICE) {
            revert PriceOutOfBounds();
        }
    }
    
    function _checkDeviationLimits(uint256 newETHPrice, uint256 newElizaPrice) internal view {
        // Allow larger moves if data is stale (>24h)
        if (block.timestamp - lastUpdateTime > 1 days) return;
        
        // Check ETH price deviation
        uint256 ethDeviation;
        if (newETHPrice > ethUsdPrice) {
            ethDeviation = ((newETHPrice - ethUsdPrice) * 100) / ethUsdPrice;
        } else {
            ethDeviation = ((ethUsdPrice - newETHPrice) * 100) / ethUsdPrice;
        }
        if (ethDeviation > MAX_DEVIATION_PCT) revert PriceDeviationTooLarge();
        
        // Check elizaOS price deviation
        uint256 elizaDeviation;
        if (newElizaPrice > elizaUsdPrice) {
            elizaDeviation = ((newElizaPrice - elizaUsdPrice) * 100) / elizaUsdPrice;
        } else {
            elizaDeviation = ((elizaUsdPrice - newElizaPrice) * 100) / elizaUsdPrice;
        }
        if (elizaDeviation > MAX_DEVIATION_PCT) revert PriceDeviationTooLarge();
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Set the authorized price updater address
     * @param _updater Address of the bot/keeper that will update prices
     * @dev Only callable by owner. This address can call updatePrices().
     * @custom:security Ensure updater has secure key management
     */
    function setPriceUpdater(address _updater) external onlyOwner {
        if (_updater == address(0)) revert InvalidAddress();
        priceUpdater = _updater;
        emit PriceUpdaterSet(_updater);
    }
    
    /**
     * @notice Emergency price update that bypasses deviation limits
     * @param newETHPrice New ETH/USD price (8 decimals)
     * @param newElizaPrice New elizaOS/USD price (8 decimals)
     * @dev Only callable by owner. Use when:
     *      - Market experiences extreme volatility (>50% move)
     *      - Price feed was incorrect and needs immediate correction
     *      - Migrating to new price source with different values
     * 
     * @custom:security Still enforces bounds checks to prevent absurd values
     * @custom:security Only owner can call - use multisig for production
     */
    function emergencyPriceUpdate(
        uint256 newETHPrice,
        uint256 newElizaPrice
    ) external onlyOwner {
        _validatePrices(newETHPrice, newElizaPrice);
        
        ethUsdPrice = newETHPrice;
        elizaUsdPrice = newElizaPrice;
        lastUpdateTime = block.timestamp;
        
        emit PricesUpdated(newETHPrice, newElizaPrice, block.timestamp);
    }
    
    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

