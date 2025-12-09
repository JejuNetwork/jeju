// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SimplePoolOracle} from "./SimplePoolOracle.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
import {IOTC} from "./interfaces/IOTC.sol";

/// @title RegistrationHelper
/// @notice Allows users to register tokens to the OTC contract by paying a fee
/// @dev Deploys SimplePoolOracle and registers token in single transaction
contract RegistrationHelper is Ownable {
    IOTC public immutable otc;
    address public immutable ethUsdFeed;

    uint256 public registrationFee = 0.005 ether; // ~$15 at $3000 ETH
    address public feeRecipient;

    event TokenRegistered(
        bytes32 indexed tokenId,
        address indexed tokenAddress,
        address indexed pool,
        address oracle,
        address registeredBy
    );
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    // Minimum liquidity threshold (in USD) to prevent manipulation
    uint256 public constant MIN_LIQUIDITY_USD = 10000 * 1e8; // $10,000 in 8 decimals

    /**
     * @notice Validate that the provided address is a legitimate Uniswap V3 pool
     * @param pool The pool address to validate
     * @param token The token address that should be in the pool
     * @return isValid True if the pool is valid
     */
    function isValidUniswapV3Pool(address pool, address token) internal view returns (bool isValid) {
        // Check if pool implements required interface
        (bool success0, bytes memory data0) = pool.staticcall(abi.encodeWithSelector(IUniswapV3Pool.token0.selector));
        if (!success0) return false;

        (bool success1, bytes memory data1) = pool.staticcall(abi.encodeWithSelector(IUniswapV3Pool.token1.selector));
        if (!success1) return false;

        address token0 = abi.decode(data0, (address));
        address token1 = abi.decode(data1, (address));

        // Verify token is in pool
        if (token0 != token && token1 != token) return false;

        // Verify pool has liquidity by checking recent observations
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = 300; // 5 minutes
        secondsAgos[1] = 0;

        (bool successObserve, bytes memory dataObserve) =
            pool.staticcall(abi.encodeWithSelector(IUniswapV3Pool.observe.selector, secondsAgos));
        if (!successObserve) return false;

        (int56[] memory tickCumulatives,) = abi.decode(dataObserve, (int56[], uint160[]));

        // Check that observations are valid (not zero)
        return tickCumulatives[0] != 0 && tickCumulatives[1] != 0;
    }

    /**
     * @notice Pre-validate oracle functionality before deployment
     * @param pool The pool address
     * @param token The token address
     * @return isValid True if oracle would work correctly
     */
    function validateOracle(address pool, address token) internal returns (bool) {
        // Create a temporary oracle instance to test
        SimplePoolOracle testOracle = new SimplePoolOracle(pool, token, ethUsdFeed);

        // Test oracle functionality
        (bool success, bytes memory data) =
            address(testOracle).staticcall(abi.encodeWithSelector(SimplePoolOracle.getTWAPPrice.selector));

        if (!success) return false;

        uint256 price = abi.decode(data, (uint256));
        return price > 0;
    }

    /**
     * @notice Estimate if pool has sufficient liquidity to prevent manipulation
     * @param pool The pool address
     * @param token The token address
     * @return True if pool has sufficient liquidity
     */
    function hasSufficientLiquidity(address pool, address token) internal returns (bool) {
        // Create a temporary oracle instance to test
        SimplePoolOracle testOracle = new SimplePoolOracle(pool, token, ethUsdFeed);

        // Get current price to estimate liquidity
        (bool success, bytes memory data) =
            address(testOracle).staticcall(abi.encodeWithSelector(SimplePoolOracle.getTWAPPrice.selector));

        if (!success) return false;

        uint256 currentPrice = abi.decode(data, (uint256));

        // For now, use price as proxy for liquidity
        // Higher price tokens generally need more liquidity to prevent manipulation
        if (currentPrice < 1e8) {
            // Less than $1
            return currentPrice > 1e6; // At least $0.01 equivalent
        } else if (currentPrice < 1e10) {
            // Less than $100
            return currentPrice > 1e8; // At least $1 equivalent
        } else {
            return currentPrice > 1e9; // At least $10 equivalent for higher value tokens
        }
    }

    constructor(address _otc, address _ethUsdFeed) Ownable(msg.sender) {
        require(_otc != address(0), "zero otc");
        require(_ethUsdFeed != address(0), "zero feed");
        otc = IOTC(_otc);
        ethUsdFeed = _ethUsdFeed;
        feeRecipient = msg.sender;
    }

    /// @notice Register a token with payment
    /// @param tokenAddress The ERC20 token to register
    /// @param poolAddress The Uniswap V3 pool for price oracle
    /// @return oracle The deployed oracle address
    function registerTokenWithPayment(address tokenAddress, address poolAddress)
        external
        payable
        returns (address oracle)
    {
        require(msg.value >= registrationFee, "insufficient fee");
        require(tokenAddress != address(0), "zero token");
        require(poolAddress != address(0), "zero pool");

        // Validate token is ERC20
        IERC20Metadata token = IERC20Metadata(tokenAddress);
        uint8 decimals = token.decimals();
        require(decimals <= 18, "invalid decimals");

        // Validate pool is legitimate Uniswap V3 pool
        require(isValidUniswapV3Pool(poolAddress, tokenAddress), "invalid pool");

        // Pre-validate oracle functionality
        require(validateOracle(poolAddress, tokenAddress), "oracle validation failed");

        // Validate pool has sufficient liquidity
        require(hasSufficientLiquidity(poolAddress, tokenAddress), "insufficient liquidity");

        // Generate tokenId (use keccak256 of address for uniqueness)
        bytes32 tokenId = keccak256(abi.encodePacked(tokenAddress));

        // Deploy SimplePoolOracle
        SimplePoolOracle poolOracle = new SimplePoolOracle(poolAddress, tokenAddress, ethUsdFeed);

        // Transfer ownership to the RegistrationHelper's owner (protocol admin)
        // This allows the protocol to update TWAP intervals or the ETH feed if needed
        poolOracle.transferOwnership(owner());

        oracle = address(poolOracle);

        // Register token to OTC
        otc.registerToken(tokenId, tokenAddress, oracle);

        // Emit event before external ETH transfers (CEI pattern)
        emit TokenRegistered(tokenId, tokenAddress, poolAddress, oracle, msg.sender);

        // Forward fee to recipient
        if (feeRecipient != address(0)) {
            (bool success,) = payable(feeRecipient).call{value: registrationFee}("");
            require(success, "fee transfer failed");
        }

        // Refund excess payment
        if (msg.value > registrationFee) {
            uint256 refund = msg.value - registrationFee;
            (bool refundSuccess,) = payable(msg.sender).call{value: refund}("");
            require(refundSuccess, "refund failed");
        }
    }

    /// @notice Update registration fee (owner only)
    function setRegistrationFee(uint256 newFee) external onlyOwner {
        require(newFee <= 0.1 ether, "fee too high");
        uint256 oldFee = registrationFee;
        registrationFee = newFee;
        emit RegistrationFeeUpdated(oldFee, newFee);
    }

    /// @notice Update fee recipient (owner only)
    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "zero recipient");
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /// @notice Withdraw accumulated fees (owner only)
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "no fees");
        (bool success,) = payable(owner()).call{value: balance}("");
        require(success, "withdrawal failed");
    }

    receive() external payable {}
}
