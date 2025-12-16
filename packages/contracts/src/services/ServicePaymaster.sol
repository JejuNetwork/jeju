// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ICloudServiceRegistry} from "../interfaces/IServices.sol";

/**
 * @title CloudPaymaster
 * @author Jeju Network
 * @notice Multi-token ERC-4337 paymaster for Cloud services with x402 integration
 * @dev Sponsors gas fees and collects service costs in elizaOS or USDC
 *
 * Features:
 * - Supports payment in elizaOS tokens or USDC
 * - Automatic token selection based on user preference
 * - Service cost calculation via CloudServiceRegistry
 * - Gas + service cost combined in single transaction
 * - x402 payment protocol compatible
 * - Oracle-based price conversion
 *
 * Payment Flow:
 * 1. User approves elizaOS or USDC spending
 * 2. User includes paymaster data: serviceName + paymentToken
 * 3. Paymaster validates: balance, allowance, service cost
 * 4. Paymaster sponsors gas from its EntryPoint deposit
 * 5. After execution, paymaster collects: gasCost + serviceCost
 * 6. Fees distributed to app revenue wallet
 *
 * @custom:security-contact security@jeju.network
 */
contract CloudPaymaster is BasePaymaster, Pausable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice elizaOS token contract
    IERC20 public immutable elizaOS;

    /// @notice USDC token contract
    IERC20 public immutable usdc;

    /// @notice Service registry for pricing and usage tracking
    ICloudServiceRegistry public serviceRegistry;

    /// @notice Price oracle for token valuations
    IPriceOracle public priceOracle;

    /// @notice App revenue wallet receiving fees
    address public revenueWallet;

    /// @notice Fee margin for price volatility protection (basis points)
    uint256 public feeMargin = 1000; // 10%

    /// @notice Basis points denominator
    uint256 public constant BASIS_POINTS = 10000;

    /// @notice Maximum gas cost limit (prevents griefing)
    uint256 public maxGasCost = 0.1 ether;

    /// @notice Minimum ETH balance to maintain in EntryPoint
    uint256 public minEntryPointBalance = 1 ether;

    /// @notice Supported payment tokens (elizaOS or USDC)
    enum PaymentToken {
        ElizaOS,
        USDC
    }

    // ============ Events ============

    event TransactionSponsored(
        address indexed user,
        string serviceName,
        PaymentToken paymentToken,
        uint256 gasCost,
        uint256 serviceCost,
        uint256 totalCharged
    );

    event ServiceRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event PriceOracleUpdated(address indexed oldOracle, address indexed newOracle);
    event RevenueWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event FeeMarginUpdated(uint256 oldMargin, uint256 newMargin);
    event EntryPointFunded(uint256 amount);

    // ============ Errors ============

    error InvalidPaymasterData();
    error InsufficientTokenBalance(address token, uint256 required, uint256 available);
    error InsufficientTokenAllowance(address token, uint256 required, uint256 available);
    error GasCostTooHigh(uint256 cost, uint256 max);
    error StaleOraclePrice();
    error ServiceNotAvailable(string serviceName);
    error InvalidRevenueWallet();

    // ============ Constructor ============

    /**
     * @notice Constructs the CloudPaymaster
     * @param _entryPoint ERC-4337 EntryPoint contract (v0.7)
     * @param _elizaOS elizaOS token address
     * @param _usdc USDC token address
     * @param _serviceRegistry CloudServiceRegistry address
     * @param _priceOracle PriceOracle address
     * @param _revenueWallet App revenue wallet address
     */
    constructor(
        IEntryPoint _entryPoint,
        address _elizaOS,
        address _usdc,
        address _serviceRegistry,
        address _priceOracle,
        address _revenueWallet,
        address _owner
    ) BasePaymaster(_entryPoint) {
        if (_owner != msg.sender) _transferOwnership(_owner);
        require(_elizaOS != address(0), "Invalid elizaOS");
        require(_usdc != address(0), "Invalid USDC");
        require(_serviceRegistry != address(0), "Invalid registry");
        require(_priceOracle != address(0), "Invalid oracle");
        require(_revenueWallet != address(0), "Invalid revenue wallet");

        elizaOS = IERC20(_elizaOS);
        usdc = IERC20(_usdc);
        serviceRegistry = ICloudServiceRegistry(_serviceRegistry);
        priceOracle = IPriceOracle(_priceOracle);
        revenueWallet = _revenueWallet;
    }

    // ============ Paymaster Core ============

    /**
     * @notice Validates paymaster willingness to sponsor a user operation
     * @param userOp The user operation to validate
     * @param maxCost Maximum gas cost in ETH
     * @return context Encoded data: (user, serviceName, paymentToken, maxTokenAmount)
     * @return validationData 0 for valid, 1 for invalid
     * @dev paymasterAndData format: [paymaster address][serviceName length][serviceName][paymentToken]
     */
    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        view
        override
        whenNotPaused
        returns (bytes memory context, uint256 validationData)
    {
        // Validate gas cost
        if (maxCost > maxGasCost) {
            revert GasCostTooHigh(maxCost, maxGasCost);
        }

        // Parse paymasterAndData: [20 bytes paymaster][variable service name][1 byte token]
        bytes calldata paymasterData = userOp.paymasterAndData[20:];
        if (paymasterData.length < 2) revert InvalidPaymasterData();

        // Extract service name length (first byte)
        uint8 serviceNameLength = uint8(paymasterData[0]);
        if (paymasterData.length < 1 + serviceNameLength + 1) revert InvalidPaymasterData();

        // Extract service name
        string memory serviceName = string(paymasterData[1:1 + serviceNameLength]);

        // Extract payment token (last byte)
        PaymentToken paymentToken = PaymentToken(uint8(paymasterData[1 + serviceNameLength]));

        // Verify service is available
        if (!serviceRegistry.isServiceAvailable(serviceName)) {
            revert ServiceNotAvailable(serviceName);
        }

        // Get user address
        address user = userOp.sender;

        // Calculate total cost
        (uint256 tokenAmount, IERC20 token) = _calculateTotalCost(user, serviceName, maxCost, paymentToken);

        // Verify user has sufficient balance
        uint256 userBalance = token.balanceOf(user);
        if (userBalance < tokenAmount) {
            revert InsufficientTokenBalance(address(token), tokenAmount, userBalance);
        }

        // Verify user has sufficient allowance
        uint256 userAllowance = token.allowance(user, address(this));
        if (userAllowance < tokenAmount) {
            revert InsufficientTokenAllowance(address(token), tokenAmount, userAllowance);
        }

        // Ensure we have enough ETH in EntryPoint to sponsor
        if (getDeposit() < maxCost) {
            revert InsufficientLiquidity();
        }

        // Encode context for _postOp
        context = abi.encode(user, serviceName, paymentToken, tokenAmount);

        return (context, 0); // 0 = valid
    }

    /**
     * @notice Post-operation handler to collect fees
     * @param context Encoded data from validation
     * @param actualGasCost Actual gas cost of the operation
     * @dev Collects tokens from user and transfers to revenue wallet
     */
    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256) internal override {
        // Decode context
        (address user, string memory serviceName, PaymentToken paymentToken, uint256 maxTokenAmount) =
            abi.decode(context, (address, string, PaymentToken, uint256));

        // Recalculate with actual gas cost (should be <= maxTokenAmount)
        (uint256 actualTokenAmount, IERC20 token) = _calculateTotalCost(user, serviceName, actualGasCost, paymentToken);

        // Use the lesser of max and actual (safety check)
        uint256 chargeAmount = actualTokenAmount > maxTokenAmount ? maxTokenAmount : actualTokenAmount;

        // Transfer tokens from user to revenue wallet (using SafeERC20)
        token.safeTransferFrom(user, revenueWallet, chargeAmount);

        // Record usage in service registry
        uint256 serviceCost = serviceRegistry.getServiceCost(serviceName, user);
        serviceRegistry.recordUsage(user, serviceName, serviceCost);

        emit TransactionSponsored(user, serviceName, paymentToken, actualGasCost, serviceCost, chargeAmount);
    }

    // ============ Internal Helpers ============

    /**
     * @notice Calculates total token amount: gas cost + service cost
     * @param user User address
     * @param serviceName Service being used
     * @param gasCostETH Gas cost in ETH (wei)
     * @param paymentToken Which token user is paying with
     * @return tokenAmount Total tokens to charge
     * @return token The ERC-20 token contract
     */
    function _calculateTotalCost(address user, string memory serviceName, uint256 gasCostETH, PaymentToken paymentToken)
        internal
        view
        returns (uint256 tokenAmount, IERC20 token)
    {
        // Get service cost in elizaOS tokens
        uint256 serviceCostElizaOS = serviceRegistry.getServiceCost(serviceName, user);

        if (paymentToken == PaymentToken.ElizaOS) {
            // Convert gas cost from ETH to elizaOS
            (uint256 ethPriceUSD,) = priceOracle.getPrice(address(0)); // ETH
            (uint256 elizaPriceUSD,) = priceOracle.getPrice(address(elizaOS));

            if (!priceOracle.isPriceFresh(address(0)) || !priceOracle.isPriceFresh(address(elizaOS))) {
                revert StaleOraclePrice();
            }

            // gasCostElizaOS = (gasCostETH * ethPriceUSD) / elizaPriceUSD
            uint256 gasCostElizaOS = (gasCostETH * ethPriceUSD) / elizaPriceUSD;

            // Add fee margin for volatility
            gasCostElizaOS = (gasCostElizaOS * (BASIS_POINTS + feeMargin)) / BASIS_POINTS;

            tokenAmount = gasCostElizaOS + serviceCostElizaOS;
            token = elizaOS;
        } else {
            // PaymentToken.USDC
            // Convert gas cost from ETH to USD (USDC)
            (uint256 ethPriceUSD,) = priceOracle.getPrice(address(0)); // ETH

            if (!priceOracle.isPriceFresh(address(0))) {
                revert StaleOraclePrice();
            }

            // gasCostUSD = (gasCostETH * ethPriceUSD) / 1e18
            uint256 gasCostUSD = (gasCostETH * ethPriceUSD) / 1e18; // USDC has 6 decimals

            // Add fee margin
            gasCostUSD = (gasCostUSD * (BASIS_POINTS + feeMargin)) / BASIS_POINTS;

            // Convert service cost from elizaOS to USDC
            (uint256 elizaPriceUSD,) = priceOracle.getPrice(address(elizaOS));
            if (!priceOracle.isPriceFresh(address(elizaOS))) {
                revert StaleOraclePrice();
            }

            // serviceCostUSD = (serviceCostElizaOS * elizaPriceUSD) / 1e18
            uint256 serviceCostUSD = (serviceCostElizaOS * elizaPriceUSD) / 1e18; // Adjust for 6 decimals

            tokenAmount = gasCostUSD + serviceCostUSD;
            token = usdc;
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Updates service registry address
     * @param newRegistry New registry address
     */
    function setServiceRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Invalid registry");
        address oldRegistry = address(serviceRegistry);
        serviceRegistry = ICloudServiceRegistry(newRegistry);
        emit ServiceRegistryUpdated(oldRegistry, newRegistry);
    }

    /**
     * @notice Updates price oracle address
     * @param newOracle New oracle address
     */
    function setPriceOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Invalid oracle");
        address oldOracle = address(priceOracle);
        priceOracle = IPriceOracle(newOracle);
        emit PriceOracleUpdated(oldOracle, newOracle);
    }

    /**
     * @notice Updates revenue wallet address
     * @param newWallet New revenue wallet address
     */
    function setRevenueWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert InvalidRevenueWallet();
        address oldWallet = revenueWallet;
        revenueWallet = newWallet;
        emit RevenueWalletUpdated(oldWallet, newWallet);
    }

    /**
     * @notice Updates fee margin for price volatility
     * @param newMargin New margin in basis points
     */
    function setFeeMargin(uint256 newMargin) external onlyOwner {
        require(newMargin <= 5000, "Margin too high"); // Max 50%
        uint256 oldMargin = feeMargin;
        feeMargin = newMargin;
        emit FeeMarginUpdated(oldMargin, newMargin);
    }

    /**
     * @notice Updates maximum gas cost limit
     * @param newMaxGasCost New max gas cost in wei
     */
    function setMaxGasCost(uint256 newMaxGasCost) external onlyOwner {
        maxGasCost = newMaxGasCost;
    }

    /**
     * @notice Deposits ETH into EntryPoint for gas sponsorship
     */
    function depositToEntryPoint() external payable onlyOwner {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit EntryPointFunded(msg.value);
    }

    /**
     * @notice Withdraws ETH from EntryPoint
     * @param to Withdrawal recipient
     * @param amount Amount to withdraw
     */
    function withdrawFromEntryPoint(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    /**
     * @notice Pauses paymaster operations
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses paymaster operations
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @notice Previews combined cost for a user operation
     * @param user User address
     * @param serviceName Service name
     * @param estimatedGas Estimated gas in wei
     * @param paymentToken Payment token selection
     * @return tokenAmount Total tokens required
     * @return token Token address
     */
    function previewCombinedCost(
        address user,
        string calldata serviceName,
        uint256 estimatedGas,
        PaymentToken paymentToken
    ) external view returns (uint256 tokenAmount, address token) {
        (uint256 amount, IERC20 tokenContract) = _calculateTotalCost(user, serviceName, estimatedGas, paymentToken);
        return (amount, address(tokenContract));
    }

    /**
     * @notice Checks if user can afford a service with specified token
     * @param user User address
     * @param serviceName Service name
     * @param estimatedGas Estimated gas
     * @param paymentToken Payment token
     * @return canAfford Whether user can afford
     * @return required Required token amount
     * @return available User's available balance
     */
    function canUserAfford(address user, string calldata serviceName, uint256 estimatedGas, PaymentToken paymentToken)
        external
        view
        returns (bool canAfford, uint256 required, uint256 available)
    {
        (uint256 tokenAmount, IERC20 token) = _calculateTotalCost(user, serviceName, estimatedGas, paymentToken);

        uint256 userBalance = token.balanceOf(user);
        uint256 userAllowance = token.allowance(user, address(this));

        required = tokenAmount;
        available = userBalance < userAllowance ? userBalance : userAllowance;
        canAfford = available >= required;
    }

    // ============ Helper ============

    error InsufficientLiquidity();
}
