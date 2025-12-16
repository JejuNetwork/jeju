// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";

/**
 * @title LiquidityPaymaster
 * @notice ERC-4337 paymaster accepting ERC20 tokens for gas sponsorship
 */
contract LiquidityPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;
    using ModerationMixin for ModerationMixin.Data;

    /// @notice Moderation integration for ban enforcement
    ModerationMixin.Data public moderation;

    IERC20 public immutable token;
    address public immutable vault;
    IPriceOracle public oracle;
    uint256 public feeMargin; // In basis points (100 = 1%)
    
    uint256 public constant MAX_FEE_MARGIN = 1000; // 10% max

    error InvalidFeeMargin();
    error InsufficientAllowance();
    error InsufficientBalance();
    error PriceNotAvailable();

    event FeeMarginUpdated(uint256 oldMargin, uint256 newMargin);
    event OracleUpdated(address oldOracle, address newOracle);
    event GasSponsored(address indexed user, uint256 ethCost, uint256 tokenAmount);

    constructor(
        IEntryPoint _entryPoint,
        address _token,
        address _vault,
        address _oracle,
        uint256 _feeMargin,
        address _owner
    ) BasePaymaster(_entryPoint) {
        require(_token != address(0), "Invalid token");
        require(_vault != address(0), "Invalid vault");
        require(_oracle != address(0), "Invalid oracle");
        require(_feeMargin <= MAX_FEE_MARGIN, "Fee margin too high");
        
        token = IERC20(_token);
        vault = _vault;
        oracle = IPriceOracle(_oracle);
        feeMargin = _feeMargin;
        
        _transferOwnership(_owner);
    }

    function setFeeMargin(uint256 _feeMargin) external onlyOwner {
        if (_feeMargin > MAX_FEE_MARGIN) revert InvalidFeeMargin();
        emit FeeMarginUpdated(feeMargin, _feeMargin);
        feeMargin = _feeMargin;
    }

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        emit OracleUpdated(address(oracle), _oracle);
        oracle = IPriceOracle(_oracle);
    }

    function getTokenAmountForEth(uint256 ethCost) public view returns (uint256) {
        (uint256 ethPrice, uint256 ethDecimals) = oracle.getPrice(address(0));
        (uint256 tokenPrice, uint256 tokenDecimals) = oracle.getPrice(address(token));
        
        if (ethPrice == 0 || tokenPrice == 0) revert PriceNotAvailable();
        
        uint256 tokenAmount = (ethCost * ethPrice * (10 ** tokenDecimals)) / (tokenPrice * (10 ** ethDecimals));
        tokenAmount = tokenAmount + (tokenAmount * feeMargin) / 10000;
        
        return tokenAmount;
    }

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256 maxCost
    ) internal view override returns (bytes memory context, uint256 validationData) {
        address sender = userOp.sender;
        
        // Check if user is banned - banned users cannot use gas sponsorship
        if (moderation.isAddressBanned(sender)) {
            return ("", 1); // Invalid - user is banned
        }
        
        // Calculate required token amount
        uint256 tokenAmount = getTokenAmountForEth(maxCost);
        
        // Check user has sufficient balance and allowance
        if (token.balanceOf(sender) < tokenAmount) {
            return ("", 1); // Invalid - insufficient balance
        }
        if (token.allowance(sender, address(this)) < tokenAmount) {
            return ("", 1); // Invalid - insufficient allowance
        }
        
        // Context: sender, maxCost, tokenAmount
        context = abi.encode(sender, maxCost, tokenAmount);
        validationData = 0; // Valid
    }

    /**
     * @dev Called after user operation execution
     */
    function _postOp(
        PostOpMode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256
    ) internal override {
        (address sender,, uint256 maxTokenAmount) = abi.decode(context, (address, uint256, uint256));
        
        uint256 actualTokenCost = getTokenAmountForEth(actualGasCost);
        uint256 tokensToPay = actualTokenCost < maxTokenAmount ? actualTokenCost : maxTokenAmount;
        
        token.safeTransferFrom(sender, vault, tokensToPay);
        
        emit GasSponsored(sender, actualGasCost, tokensToPay);
    }

    /**
     * @notice Set ban manager for moderation
     * @param _banManager BanManager contract address
     */
    function setBanManager(address _banManager) external onlyOwner {
        moderation.setBanManager(_banManager);
    }

    /**
     * @notice Set identity registry for agent ban checking
     * @param _identityRegistry IdentityRegistry contract address
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        moderation.setIdentityRegistry(_identityRegistry);
    }

    /**
     * @notice Check if a user is banned from using this paymaster
     * @param user Address to check
     */
    function isUserBanned(address user) external view returns (bool) {
        return moderation.isAddressBanned(user);
    }
}

