// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IFeeConfig {
    function getDistributionFees() external view returns (
        uint16 appShareBps,
        uint16 lpShareBps,
        uint16 contributorShareBps,
        uint16 ethLpShareBps,
        uint16 tokenLpShareBps
    );
}

/**
 * @title FeeEnforcer
 * @notice Proxy wrapper that enforces fee collection on protocol actions
 * @dev Wraps external contract calls to ensure fees are always collected:
 *      - Compute requests
 *      - Storage uploads
 *      - Bridge transfers
 *      - Swap operations
 *
 * Flow:
 *      1. User calls FeeEnforcer.execute(target, data, feeAmount)
 *      2. FeeEnforcer collects fee
 *      3. FeeEnforcer forwards call to target
 *      4. Fee is sent to FeeDistributor
 */
contract FeeEnforcer is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IFeeConfig public feeConfig;
    address public feeDistributor;
    IERC20 public feeToken;

    // Authorized targets that can be called through this enforcer
    mapping(address => bool) public authorizedTargets;

    // Fee overrides per target (0 = use global)
    mapping(address => uint256) public targetFeeOverride;

    // Statistics
    uint256 public totalFeesCollected;
    uint256 public totalCalls;
    mapping(address => uint256) public targetCallCount;

    event FeeCollected(address indexed caller, address indexed target, uint256 feeAmount);
    event CallExecuted(address indexed caller, address indexed target, bool success);
    event TargetAuthorized(address indexed target, bool authorized);
    event FeeOverrideSet(address indexed target, uint256 feeBps);

    error UnauthorizedTarget();
    error InsufficientFee();
    error CallFailed(bytes returnData);
    error InvalidFeeConfig();

    constructor(
        address _feeConfig,
        address _feeDistributor,
        address _feeToken,
        address initialOwner
    ) Ownable(initialOwner) {
        feeConfig = IFeeConfig(_feeConfig);
        feeDistributor = _feeDistributor;
        feeToken = IERC20(_feeToken);
    }

    /**
     * @notice Execute a call through the fee enforcer
     * @param target Contract to call
     * @param data Calldata to forward
     * @return returnData Data returned from target
     */
    function execute(
        address target,
        bytes calldata data
    ) external payable nonReentrant returns (bytes memory returnData) {
        if (!authorizedTargets[target]) revert UnauthorizedTarget();

        // Calculate required fee
        uint256 feeRequired = calculateFee(target, msg.value);

        // Collect fee (in fee token or ETH)
        if (feeRequired > 0) {
            if (msg.value >= feeRequired) {
                // Fee paid in ETH
                totalFeesCollected += feeRequired;
                _forwardFee(feeRequired);
            } else {
                // Fee in token
                feeToken.safeTransferFrom(msg.sender, address(this), feeRequired);
                totalFeesCollected += feeRequired;
                feeToken.safeTransfer(feeDistributor, feeRequired);
            }
            emit FeeCollected(msg.sender, target, feeRequired);
        }

        // Forward remaining ETH and call target
        uint256 valueToForward = msg.value > feeRequired ? msg.value - feeRequired : 0;
        bool success;
        (success, returnData) = target.call{value: valueToForward}(data);

        if (!success) revert CallFailed(returnData);

        totalCalls++;
        targetCallCount[target]++;

        emit CallExecuted(msg.sender, target, success);
    }

    /**
     * @notice Execute with explicit fee payment in tokens
     * @param target Contract to call
     * @param data Calldata to forward
     * @param feeAmount Amount of fee tokens to pay
     */
    function executeWithTokenFee(
        address target,
        bytes calldata data,
        uint256 feeAmount
    ) external payable nonReentrant returns (bytes memory returnData) {
        if (!authorizedTargets[target]) revert UnauthorizedTarget();

        uint256 requiredFee = calculateFee(target, msg.value);
        if (feeAmount < requiredFee) revert InsufficientFee();

        // Collect token fee
        feeToken.safeTransferFrom(msg.sender, address(this), feeAmount);
        totalFeesCollected += feeAmount;
        feeToken.safeTransfer(feeDistributor, feeAmount);
        emit FeeCollected(msg.sender, target, feeAmount);

        // Forward call
        bool success;
        (success, returnData) = target.call{value: msg.value}(data);

        if (!success) revert CallFailed(returnData);

        totalCalls++;
        targetCallCount[target]++;

        emit CallExecuted(msg.sender, target, success);
    }

    /**
     * @notice Calculate fee for a target call
     * @param target Target contract
     * @param value ETH value being sent
     * @return Fee amount
     */
    function calculateFee(address target, uint256 value) public view returns (uint256) {
        uint256 overrideBps = targetFeeOverride[target];

        if (overrideBps > 0) {
            return (value * overrideBps) / 10000;
        }

        // Use global fee config
        (uint16 appShareBps,,,,) = feeConfig.getDistributionFees();
        return (value * appShareBps) / 10000;
    }

    /**
     * @notice Forward collected ETH fees
     */
    function _forwardFee(uint256 amount) internal {
        (bool success,) = feeDistributor.call{value: amount}("");
        if (!success) {
            // If distributor can't receive, hold in contract
        }
    }

    // ============ Batch Operations ============

    /**
     * @notice Execute multiple calls in one transaction
     * @param targets Array of target contracts
     * @param datas Array of calldata
     * @param values Array of ETH values per call
     */
    function batchExecute(
        address[] calldata targets,
        bytes[] calldata datas,
        uint256[] calldata values
    ) external payable nonReentrant returns (bytes[] memory returnDatas) {
        require(targets.length == datas.length && datas.length == values.length, "Length mismatch");

        uint256 totalValue = 0;
        uint256 totalFees = 0;

        for (uint256 i = 0; i < targets.length; i++) {
            if (!authorizedTargets[targets[i]]) revert UnauthorizedTarget();
            totalValue += values[i];
            totalFees += calculateFee(targets[i], values[i]);
        }

        require(msg.value >= totalValue + totalFees, "Insufficient ETH");

        // Collect fees upfront
        totalFeesCollected += totalFees;
        _forwardFee(totalFees);

        returnDatas = new bytes[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            bool success;
            (success, returnDatas[i]) = targets[i].call{value: values[i]}(datas[i]);
            if (!success) revert CallFailed(returnDatas[i]);

            totalCalls++;
            targetCallCount[targets[i]]++;
            emit CallExecuted(msg.sender, targets[i], success);
        }
    }

    // ============ Admin ============

    function setAuthorizedTarget(address target, bool authorized) external onlyOwner {
        authorizedTargets[target] = authorized;
        emit TargetAuthorized(target, authorized);
    }

    function setFeeOverride(address target, uint256 feeBps) external onlyOwner {
        targetFeeOverride[target] = feeBps;
        emit FeeOverrideSet(target, feeBps);
    }

    function setFeeConfig(address _feeConfig) external onlyOwner {
        feeConfig = IFeeConfig(_feeConfig);
    }

    function setFeeDistributor(address _distributor) external onlyOwner {
        feeDistributor = _distributor;
    }

    function setFeeToken(address _token) external onlyOwner {
        feeToken = IERC20(_token);
    }

    function withdrawStuckTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function withdrawStuckETH(address to) external onlyOwner {
        (bool success,) = to.call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }

    receive() external payable {}
}

