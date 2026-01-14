// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IStakeManager} from "account-abstraction/interfaces/IStakeManager.sol";
import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ICreditManager, IServiceRegistry, ICloudServiceRegistry} from "../interfaces/IServices.sol";

interface IFeeDistributor {
    function distributeFees(uint256 amount, address appAddress) external;
}

/**
 * @title MultiTokenPaymaster
 * @author Jeju Network
 * @notice ERC-4337 paymaster with credit system and multi-token support
 * @dev Optimized for zero-latency payments using prepaid balances.
 *
 * Payment Flow (FAST PATH - most common):
 * 1. Check user's prepaid balance in CreditManager
 * 2. If sufficient → deduct and sponsor (no blockchain tx from user!)
 * 3. User operation executes normally
 *
 * Payment Flow (SLOW PATH - initial payment or top-up):
 * 1. User has insufficient balance
 * 2. Paymaster requires payment in UserOp
 * 3. User includes USDC/JEJU transfer in UserOp
 * 4. Overpayment amount credited to user's balance
 * 5. Future calls use fast path
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract MultiTokenPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;

    // ============ Pause State ============

    bool private _paused;

    event Paused(address account);
    event Unpaused(address account);

    error EnforcedPause();
    error ExpectedPause();

    modifier whenNotPaused() {
        if (_paused) revert EnforcedPause();
        _;
    }

    modifier whenPaused() {
        if (!_paused) revert ExpectedPause();
        _;
    }

    // ============ State Variables ============

    /// @notice USDC token contract
    IERC20 public immutable usdc;

    /// @notice JEJU token contract
    IERC20 public immutable jeju;

    /// @notice Credit manager for prepaid balances
    ICreditManager public creditManager;

    /// @notice Service registry for pricing
    IServiceRegistry public serviceRegistry;

    /// @notice Price oracle for conversions
    IPriceOracle public immutable priceOracle;

    /// @notice Revenue wallet for service fees
    address public revenueWallet;

    /// @notice Fee distributor for proper fee splits (45% app, 45% LP, 10% contributors)
    IFeeDistributor public feeDistributor;

    /// @notice Maximum gas cost allowed
    uint256 public maxGasCost = 0.1 ether;

    /// @notice Fee margin for price volatility protection (basis points)
    uint256 public feeMargin = 1000; // 10%

    /// @notice Basis points denominator
    uint256 public constant BASIS_POINTS = 10000;

    /// @notice Payment token selector
    enum PaymentToken {
        JEJU, // 0
        USDC, // 1
        ETH // 2

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
    event NativeTokenUpdated(address indexed oldToken, address indexed newToken);
    event RevenueWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event FeeDistributorUpdated(address indexed oldDistributor, address indexed newDistributor);
    event FeeMarginUpdated(uint256 oldMargin, uint256 newMargin);
    event EntryPointFunded(uint256 amount);

    // ============ Errors ============

    error InvalidPaymasterData();
    error GasCostTooHigh(uint256 cost, uint256 max);
    error ServiceNotAvailable(string serviceName);
    error InsufficientCreditAndNoPayment();
    error InsufficientLiquidity();
    error StaleOraclePrice();
    error InvalidRevenueWallet();

    // ============ Constructor ============

    constructor(
        IEntryPoint _entryPoint,
        address _usdc,
        address _jeju,
        address _creditManager,
        address _serviceRegistry,
        address _priceOracle,
        address _revenueWallet,
        address _owner
    ) BasePaymaster(_entryPoint, _owner == address(0) ? msg.sender : _owner) {
        require(_usdc != address(0), "Invalid USDC");
        require(_jeju != address(0), "Invalid JEJU");
        require(_creditManager != address(0), "Invalid credit manager");
        require(_serviceRegistry != address(0), "Invalid service registry");
        require(_priceOracle != address(0), "Invalid price oracle");
        require(_revenueWallet != address(0), "Invalid revenue wallet");

        usdc = IERC20(_usdc);
        jeju = IERC20(_jeju);
        creditManager = ICreditManager(_creditManager);
        serviceRegistry = IServiceRegistry(_serviceRegistry);
        priceOracle = IPriceOracle(_priceOracle);
        revenueWallet = _revenueWallet;
    }

    // ============ Core Paymaster Logic ============

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

        if (getDeposit() < maxCost) {
            revert InsufficientLiquidity();
        }

        // v0.7 format: [paymaster(20)][verificationGas(16)][postOpGas(16)][data...]
        // Data starts at byte 52, not 20
        bytes calldata data = userOp.paymasterAndData[52:];
        if (data.length < 2) revert InvalidPaymasterData();

        uint8 serviceNameLength = uint8(data[0]);
        if (data.length < 1 + serviceNameLength + 1) revert InvalidPaymasterData();

        string memory serviceName = string(data[1:1 + serviceNameLength]);
        PaymentToken paymentToken = PaymentToken(uint8(data[1 + serviceNameLength]));

        if (!serviceRegistry.isServiceAvailable(serviceName)) {
            revert ServiceNotAvailable(serviceName);
        }

        uint256 serviceCost = serviceRegistry.getServiceCost(serviceName, userOp.sender);
        address token = _getTokenAddress(paymentToken);
        uint256 totalCost = _calculateTotalCost(serviceCost, maxCost, token);

        (bool hasSufficientCredit,) = creditManager.hasSufficientCredit(userOp.sender, token, totalCost);

        if (hasSufficientCredit) {
            context = abi.encode(userOp.sender, serviceName, token, totalCost, uint256(0), true);
            return (context, 0);
        }

        uint256 overpayment = 0;
        if (data.length >= 1 + serviceNameLength + 1 + 32) {
            overpayment = uint256(bytes32(data[1 + serviceNameLength + 1:1 + serviceNameLength + 1 + 32]));
        }

        if (overpayment == 0) {
            revert InsufficientCreditAndNoPayment();
        }

        if (token == ETH_ADDRESS) {
            require(overpayment >= totalCost, "Insufficient ETH payment");
        } else {
            uint256 userBalance = IERC20(token).balanceOf(userOp.sender);
            uint256 userAllowance = IERC20(token).allowance(userOp.sender, address(this));
            require(userBalance >= overpayment && userAllowance >= overpayment, "Insufficient token");
        }

        context = abi.encode(userOp.sender, serviceName, token, totalCost, overpayment, false);
        return (context, 0);
    }

    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256) internal override {
        (address user, string memory serviceName, address token,, uint256 overpayment, bool useCredit) =
            abi.decode(context, (address, string, address, uint256, uint256, bool));

        uint256 serviceCost = serviceRegistry.getServiceCost(serviceName, user);
        uint256 actualTotalCost = _calculateTotalCost(serviceCost, actualGasCost, token);

        // Get app address for fee attribution
        address appAddress = _getAppFromService(serviceName);

        if (useCredit) {
            (bool success,) = creditManager.tryDeductCredit(user, token, actualTotalCost);
            require(success, "Credit deduction failed");
            emit TransactionSponsoredWithCredit(user, serviceName, token, actualTotalCost);
        } else {
            if (token == ETH_ADDRESS) {
                // ETH goes to revenue wallet (feeDistributor handles tokens only)
                (bool success,) = revenueWallet.call{value: actualTotalCost}("");
                require(success, "ETH transfer failed");

                if (overpayment > actualTotalCost) {
                    uint256 creditAmount = overpayment - actualTotalCost;
                    creditManager.addCredit{value: creditAmount}(user, ETH_ADDRESS, creditAmount);
                }
            } else {
                // Route token fees through feeDistributor if available
                if (address(feeDistributor) != address(0) && appAddress != address(0)) {
                    IERC20(token).safeTransferFrom(user, address(this), actualTotalCost);
                    IERC20(token).forceApprove(address(feeDistributor), actualTotalCost);
                    feeDistributor.distributeFees(actualTotalCost, appAddress);
                } else {
                    // Fallback to revenue wallet
                    IERC20(token).safeTransferFrom(user, revenueWallet, actualTotalCost);
                }

                if (overpayment > actualTotalCost) {
                    uint256 creditAmount = overpayment - actualTotalCost;
                    IERC20(token).safeTransferFrom(user, address(creditManager), creditAmount);
                }
            }

            emit TransactionSponsoredWithPayment(user, serviceName, token, overpayment, overpayment - actualTotalCost);
        }

        try ICloudServiceRegistry(address(serviceRegistry)).recordUsage(user, serviceName, serviceCost) {} catch {}
    }

    /// @notice Get app address from service name for fee attribution
    function _getAppFromService(string memory serviceName) internal view returns (address) {
        try ICloudServiceRegistry(address(serviceRegistry)).getServiceOwner(serviceName) returns (address owner) {
            return owner;
        } catch {
            return address(0);
        }
    }

    // ============ Internal Helpers ============

    function _calculateTotalCost(uint256 serviceCost, uint256 gasCost, address tokenAddr)
        internal
        view
        returns (uint256 totalCost)
    {
        uint256 gasCostWithMargin = (gasCost * (BASIS_POINTS + feeMargin)) / BASIS_POINTS;

        if (tokenAddr == ETH_ADDRESS) {
            uint256 serviceCostInETH = priceOracle.convertAmount(address(jeju), ETH_ADDRESS, serviceCost);
            totalCost = serviceCostInETH + gasCostWithMargin;
        } else {
            uint256 gasCostInToken = priceOracle.convertAmount(ETH_ADDRESS, tokenAddr, gasCostWithMargin);
            uint256 serviceCostInToken = tokenAddr == address(jeju)
                ? serviceCost
                : priceOracle.convertAmount(address(jeju), tokenAddr, serviceCost);
            totalCost = serviceCostInToken + gasCostInToken;
        }
    }

    function _getTokenAddress(PaymentToken token) internal view returns (address) {
        if (token == PaymentToken.JEJU) return address(jeju);
        if (token == PaymentToken.USDC) return address(usdc);
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

    function setRevenueWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert InvalidRevenueWallet();
        address oldWallet = revenueWallet;
        revenueWallet = newWallet;
        emit RevenueWalletUpdated(oldWallet, newWallet);
    }

    function setFeeDistributor(address newDistributor) external onlyOwner {
        address oldDistributor = address(feeDistributor);
        feeDistributor = IFeeDistributor(newDistributor);
        emit FeeDistributorUpdated(oldDistributor, newDistributor);
    }

    function setFeeMargin(uint256 newMargin) external onlyOwner {
        require(newMargin <= 5000, "Margin too high");
        uint256 oldMargin = feeMargin;
        feeMargin = newMargin;
        emit FeeMarginUpdated(oldMargin, newMargin);
    }

    function setMaxGasCost(uint256 newMaxGasCost) external onlyOwner {
        maxGasCost = newMaxGasCost;
    }

    /**
     * @notice Override getDeposit to use IStakeManager for compatibility
     */
    function getDeposit() public view override returns (uint256) {
        return IStakeManager(address(entryPoint())).balanceOf(address(this));
    }

    function depositToEntryPoint() external payable onlyOwner {
        IStakeManager(address(entryPoint())).depositTo{value: msg.value}(address(this));
        emit EntryPointFunded(msg.value);
    }

    function withdrawFromEntryPoint(address payable to, uint256 amount) external onlyOwner {
        IStakeManager(address(entryPoint())).withdrawTo(to, amount);
    }

    function pause() external onlyOwner {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        _paused = false;
        emit Unpaused(msg.sender);
    }

    function paused() public view returns (bool) {
        return _paused;
    }
}
