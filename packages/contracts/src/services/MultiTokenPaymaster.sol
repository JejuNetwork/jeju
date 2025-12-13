// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ICreditManager, IServiceRegistry} from "../interfaces/IServices.sol";

/**
 * @title MultiTokenPaymaster
 * @author Jeju Network
 * @notice ERC-4337 paymaster with credit system and multi-token support
 * @dev Optimized for zero-latency payments using prepaid balances
 *
 * Payment Flow (FAST PATH - most common):
 * 1. Check user's prepaid balance in CreditManager
 * 2. If sufficient → deduct and sponsor (no blockchain tx from user!)
 * 3. User operation executes normally
 *
 * Payment Flow (SLOW PATH - initial payment or top-up):
 * 1. User has insufficient balance
 * 2. Paymaster requires payment in UserOp
 * 3. User includes USDC/elizaOS/JEJU transfer in UserOp
 * 4. Overpayment amount credited to user's balance
 * 5. Future calls use fast path
 *
 * Supported Tokens:
 * - JEJU (18 decimals)
 * - USDC (6 decimals)
 * - elizaOS (18 decimals)
 * - ETH (18 decimals)
 *
 * @custom:security-contact security@jeju.network
 */
contract MultiTokenPaymaster is BasePaymaster, Pausable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice USDC token contract
    IERC20 public immutable usdc;

    /// @notice elizaOS token contract
    IERC20 public immutable elizaOS;

    /// @notice JEJU token contract
    IERC20 public jeju;

    /// @notice Credit manager for prepaid balances
    ICreditManager public creditManager;

    /// @notice Service registry for pricing
    IServiceRegistry public serviceRegistry;

    /// @notice Price oracle for conversions
    IPriceOracle public immutable priceOracle;

    /// @notice Revenue wallet for service fees
    address public immutable revenueWallet;

    /// @notice Maximum gas cost allowed
    uint256 public maxGasCost = 0.1 ether;

    /// @notice Payment token selector
    enum PaymentToken {
        JEJU, // 0
        USDC, // 1
        ElizaOS, // 2
        ETH // 3

    }

    /// @notice ETH address constant
    address public constant ETH_ADDRESS = address(0);

    // ============ Events ============

    event TransactionSponsoredWithCredit(address indexed user, string service, address token, uint256 amount);
    event TransactionSponsoredWithPayment(
        address indexed user, string service, address token, uint256 paid, uint256 credited
    );
    event CreditManagerUpdated(address indexed oldManager, address indexed newManager);
    event ServiceRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event JejuTokenUpdated(address indexed oldToken, address indexed newToken);

    // ============ Errors ============

    error InvalidPaymasterData();
    error GasCostTooHigh(uint256 cost, uint256 max);
    error ServiceNotAvailable(string serviceName);
    error InsufficientCreditAndNoPayment();

    // ============ Constructor ============

    constructor(
        IEntryPoint _entryPoint,
        address _usdc,
        address _elizaOS,
        address _creditManager,
        address _serviceRegistry,
        address _priceOracle,
        address _revenueWallet,
        address _owner
    ) BasePaymaster(_entryPoint) {
        if (_owner != msg.sender) _transferOwnership(_owner);
        require(_usdc != address(0), "Invalid USDC");
        require(_elizaOS != address(0), "Invalid elizaOS");
        require(_creditManager != address(0), "Invalid credit manager");
        require(_serviceRegistry != address(0), "Invalid service registry");
        require(_priceOracle != address(0), "Invalid price oracle");
        require(_revenueWallet != address(0), "Invalid revenue wallet");

        usdc = IERC20(_usdc);
        elizaOS = IERC20(_elizaOS);
        creditManager = ICreditManager(_creditManager);
        serviceRegistry = IServiceRegistry(_serviceRegistry);
        priceOracle = IPriceOracle(_priceOracle);
        revenueWallet = _revenueWallet;
    }

    // ============ Core Paymaster Logic ============

    /**
     * @notice Validates paymaster willingness to sponsor user operation
     * @param userOp User operation
     * @param maxCost Maximum gas cost in ETH
     * @return context Encoded data for _postOp
     * @return validationData 0 for valid
     *
     * paymasterAndData format:
     * - [20 bytes] paymaster address
     * - [1 byte] service name length
     * - [N bytes] service name
     * - [1 byte] payment token (0=USDC, 1=elizaOS, 2=ETH)
     * - [32 bytes] overpayment amount (optional, for crediting)
     */
    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        view
        override
        whenNotPaused
        returns (bytes memory context, uint256 validationData)
    {
        if (maxCost > maxGasCost) {
            revert GasCostTooHigh(maxCost, maxGasCost);
        }

        // Parse paymasterAndData
        bytes calldata data = userOp.paymasterAndData[20:];
        if (data.length < 2) revert InvalidPaymasterData();

        uint8 serviceNameLength = uint8(data[0]);
        if (data.length < 1 + serviceNameLength + 1) revert InvalidPaymasterData();

        string memory serviceName = string(data[1:1 + serviceNameLength]);
        PaymentToken paymentToken = PaymentToken(uint8(data[1 + serviceNameLength]));

        // Get service cost
        if (!serviceRegistry.isServiceAvailable(serviceName)) {
            revert ServiceNotAvailable(serviceName);
        }

        uint256 serviceCost = serviceRegistry.getServiceCost(serviceName, userOp.sender);
        address token = _getTokenAddress(paymentToken);

        // Calculate total cost in selected token
        uint256 totalCost = _calculateTotalCost(serviceCost, maxCost, token);

        // FAST PATH: Check if user has sufficient prepaid balance
        (bool hasSufficientCredit,) = creditManager.hasSufficientCredit(userOp.sender, token, totalCost);

        if (hasSufficientCredit) {
            // User has credit - will deduct in _postOp
            context = abi.encode(
                userOp.sender,
                serviceName,
                token,
                totalCost,
                uint256(0), // No overpayment
                true // Use credit
            );
            return (context, 0);
        }

        // SLOW PATH: User needs to pay
        // Check if they included payment in UserOp
        uint256 overpayment = 0;
        if (data.length >= 1 + serviceNameLength + 1 + 32) {
            overpayment = uint256(bytes32(data[1 + serviceNameLength + 1:1 + serviceNameLength + 1 + 32]));
        }

        if (overpayment == 0) {
            // No payment included and no credit
            revert InsufficientCreditAndNoPayment();
        }

        // Verify user has tokens to pay
        if (token == ETH_ADDRESS) {
            // ETH payment will be in UserOp itself
            require(overpayment >= totalCost, "Insufficient ETH payment");
        } else {
            uint256 userBalance = IERC20(token).balanceOf(userOp.sender);
            uint256 userAllowance = IERC20(token).allowance(userOp.sender, address(this));
            require(userBalance >= overpayment && userAllowance >= overpayment, "Insufficient token");
        }

        context = abi.encode(
            userOp.sender,
            serviceName,
            token,
            totalCost,
            overpayment,
            false // Collect payment
        );

        return (context, 0);
    }

    /**
     * @notice Post-operation handler
     * @param context Data from validation
     * @param actualGasCost Actual gas cost
     */
    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256) internal override {
        (
            address user,
            string memory serviceName,
            address token,
            , // maxCost (unused in postOp)
            uint256 overpayment,
            bool useCredit
        ) = abi.decode(context, (address, string, address, uint256, uint256, bool));

        // Recalculate with actual gas
        uint256 serviceCost = serviceRegistry.getServiceCost(serviceName, user);
        uint256 actualTotalCost = _calculateTotalCost(serviceCost, actualGasCost, token);

        if (useCredit) {
            // FAST PATH: Deduct from prepaid balance
            (bool success,) = creditManager.tryDeductCredit(user, token, actualTotalCost);
            require(success, "Credit deduction failed");

            emit TransactionSponsoredWithCredit(user, serviceName, token, actualTotalCost);
        } else {
            // SLOW PATH: Collect payment and credit overpayment
            if (token == ETH_ADDRESS) {
                // ETH was already sent in UserOp - just transfer to revenue
                (bool success,) = revenueWallet.call{value: actualTotalCost}("");
                require(success, "ETH transfer failed");

                // Note: Overpayment refunds would be handled here
                // Currently, overpayments are kept as donations to the protocol
                // Future enhancement: implement refund mechanism via CreditManager
            } else {
                // Collect tokens using SafeERC20 to handle non-standard tokens
                IERC20(token).safeTransferFrom(user, revenueWallet, actualTotalCost);

                // Credit overpayment to user's balance
                if (overpayment > actualTotalCost) {
                    uint256 creditAmount = overpayment - actualTotalCost;
                    IERC20(token).safeTransferFrom(user, address(creditManager), creditAmount);
                    // CreditManager will track this
                }
            }

            emit TransactionSponsoredWithPayment(user, serviceName, token, overpayment, overpayment - actualTotalCost);
        }
    }

    // ============ Internal Helpers ============

    /**
     * @notice Calculate total cost in target token
     * @param serviceCost Service cost (in elizaOS tokens)
     * @param gasCost Gas cost (in ETH)
     * @param paymentToken Token user is paying with
     * @return totalCost Total cost in payment token
     */
    function _calculateTotalCost(uint256 serviceCost, uint256 gasCost, address paymentToken)
        internal
        view
        returns (uint256 totalCost)
    {
        // Convert service cost (elizaOS) to payment token
        uint256 serviceCostInToken = priceOracle.convertAmount(address(elizaOS), paymentToken, serviceCost);

        // Convert gas cost (ETH) to payment token
        uint256 gasCostInToken = priceOracle.convertAmount(ETH_ADDRESS, paymentToken, gasCost);

        totalCost = serviceCostInToken + gasCostInToken;
    }

    /**
     * @notice Get token address from enum
     */
    function _getTokenAddress(PaymentToken token) internal view returns (address) {
        if (token == PaymentToken.JEJU && address(jeju) != address(0)) return address(jeju);
        if (token == PaymentToken.USDC) return address(usdc);
        if (token == PaymentToken.ElizaOS) return address(elizaOS);
        return ETH_ADDRESS;
    }

    // ============ Admin Functions ============

    function setCreditManager(address newManager) external onlyOwner {
        address oldManager = address(creditManager);
        creditManager = ICreditManager(newManager);
        emit CreditManagerUpdated(oldManager, newManager);
    }

    function setServiceRegistry(address newRegistry) external onlyOwner {
        address oldRegistry = address(serviceRegistry);
        serviceRegistry = IServiceRegistry(newRegistry);
        emit ServiceRegistryUpdated(oldRegistry, newRegistry);
    }

    function setJejuToken(address _jeju) external onlyOwner {
        address oldToken = address(jeju);
        jeju = IERC20(_jeju);
        emit JejuTokenUpdated(oldToken, _jeju);
    }

    function depositToEntryPoint() external payable onlyOwner {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
