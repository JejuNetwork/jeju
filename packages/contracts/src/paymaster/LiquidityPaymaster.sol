// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
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
    uint256 public constant ORACLE_CHANGE_DELAY = 24 hours; // SECURITY: Oracle timelock

    error InvalidFeeMargin();
    error InsufficientAllowance();
    error InsufficientBalance();
    error PriceNotAvailable();
    error OracleChangePending();
    error NoOracleChangePending();
    error OracleChangeNotReady();

    // SECURITY: Oracle change timelock
    address public pendingOracle;
    uint256 public oracleChangeTime;

    event OracleChangeProposed(address indexed newOracle, uint256 effectiveTime);
    event OracleChangeExecuted(address indexed oldOracle, address indexed newOracle);
    event OracleChangeCancelled();

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
    ) BasePaymaster(_entryPoint, _owner) {
        require(_token != address(0), "Invalid token");
        require(_vault != address(0), "Invalid vault");
        require(_oracle != address(0), "Invalid oracle");
        require(_feeMargin <= MAX_FEE_MARGIN, "Fee margin too high");

        token = IERC20(_token);
        vault = _vault;
        oracle = IPriceOracle(_oracle);
        feeMargin = _feeMargin;
    }

    function setFeeMargin(uint256 _feeMargin) external onlyOwner {
        if (_feeMargin > MAX_FEE_MARGIN) revert InvalidFeeMargin();
        emit FeeMarginUpdated(feeMargin, _feeMargin);
        feeMargin = _feeMargin;
    }

    /// @notice Propose a new oracle - requires 24-hour delay
    /// @dev SECURITY: Prevents instant oracle manipulation for gas sponsorship
    function proposeOracle(address _oracle) public onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        if (pendingOracle != address(0)) revert OracleChangePending();

        pendingOracle = _oracle;
        oracleChangeTime = block.timestamp + ORACLE_CHANGE_DELAY;

        emit OracleChangeProposed(_oracle, oracleChangeTime);
    }

    /// @notice Execute oracle change after timelock expires
    function executeOracleChange() external onlyOwner {
        if (pendingOracle == address(0)) revert NoOracleChangePending();
        if (block.timestamp < oracleChangeTime) revert OracleChangeNotReady();

        address oldOracle = address(oracle);
        oracle = IPriceOracle(pendingOracle);

        emit OracleUpdated(oldOracle, pendingOracle);
        emit OracleChangeExecuted(oldOracle, pendingOracle);

        pendingOracle = address(0);
        oracleChangeTime = 0;
    }

    /// @notice Cancel pending oracle change
    function cancelOracleChange() external onlyOwner {
        if (pendingOracle == address(0)) revert NoOracleChangePending();

        emit OracleChangeCancelled();

        pendingOracle = address(0);
        oracleChangeTime = 0;
    }

    /// @notice Legacy setOracle - now requires timelock
    function setOracle(address _oracle) external onlyOwner {
        proposeOracle(_oracle);
    }

    function getTokenAmountForEth(uint256 ethCost) public view returns (uint256) {
        (uint256 ethPrice, uint256 ethDecimals) = oracle.getPrice(address(0));
        (uint256 tokenPrice, uint256 tokenDecimals) = oracle.getPrice(address(token));

        if (ethPrice == 0 || tokenPrice == 0) revert PriceNotAvailable();

        uint256 tokenAmount = (ethCost * ethPrice * (10 ** tokenDecimals)) / (tokenPrice * (10 ** ethDecimals));
        tokenAmount = tokenAmount + (tokenAmount * feeMargin) / 10000;

        return tokenAmount;
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        address sender = userOp.sender;

        if (moderation.isAddressBanned(sender)) return ("", 1);

        uint256 tokenAmount = getTokenAmountForEth(maxCost);

        if (token.balanceOf(sender) < tokenAmount) return ("", 1);
        if (token.allowance(sender, address(this)) < tokenAmount) return ("", 1);

        context = abi.encode(sender, maxCost, tokenAmount);
        validationData = 0;
    }

    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256) internal override {
        (address sender,, uint256 maxTokenAmount) = abi.decode(context, (address, uint256, uint256));

        uint256 actualTokenCost = getTokenAmountForEth(actualGasCost);
        uint256 tokensToPay = actualTokenCost < maxTokenAmount ? actualTokenCost : maxTokenAmount;

        token.safeTransferFrom(sender, vault, tokensToPay);
        emit GasSponsored(sender, actualGasCost, tokensToPay);
    }

    function setBanManager(address _banManager) external onlyOwner {
        moderation.setBanManager(_banManager);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        moderation.setIdentityRegistry(_identityRegistry);
    }

    function isUserBanned(address user) external view returns (bool) {
        return moderation.isAddressBanned(user);
    }
}
