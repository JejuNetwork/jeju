// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title AutomationRegistry
/// @notice Keeper network for automated contract execution
contract AutomationRegistry is Ownable2Step, ReentrancyGuard, Pausable {
    enum UpkeepType {
        CONDITIONAL,
        LOG_TRIGGER,
        TIME_BASED
    }

    struct Upkeep {
        address target;
        uint96 balance;
        address admin;
        uint32 executeGas;
        uint32 checkGas;
        uint32 interval;
        uint32 lastPerformed;
        uint32 performCount;
        bytes checkData;
        UpkeepType upkeepType;
        bool active;
    }

    struct KeeperInfo {
        address keeper;
        uint96 stake;
        uint32 performCount;
        uint32 successCount;
        uint32 lastActive;
        bool approved;
    }

    struct RegistryConfig {
        uint96 minUpkeepBalance;
        uint32 maxPerformGas;
        uint32 maxCheckGas;
        uint16 keeperFeeBps;
        uint16 protocolFeeBps;
        uint32 minInterval;
        uint32 maxKeepers;
        uint96 minKeeperStake;
    }

    mapping(uint256 => Upkeep) public upkeeps;
    mapping(address => uint256[]) public adminUpkeeps;
    mapping(address => KeeperInfo) public keepers;
    address[] public keeperList;

    uint256 public upkeepCount;
    uint256 public totalActiveUpkeeps;
    uint256 public totalPerforms;
    uint256 public totalFeesPaid;
    RegistryConfig public config;
    address public feeRecipient;
    address public governance;

    event UpkeepRegistered(
        uint256 indexed id,
        address indexed target,
        address admin,
        uint32 executeGas,
        uint32 interval,
        UpkeepType upkeepType
    );
    event UpkeepPerformed(uint256 indexed id, bool success, address indexed keeper, uint96 payment, uint256 gasUsed);
    event UpkeepCanceled(uint256 indexed id, uint96 remainingBalance);
    event UpkeepFunded(uint256 indexed id, uint96 amount, uint96 newBalance);
    event UpkeepPaused(uint256 indexed id);
    event UpkeepUnpaused(uint256 indexed id);
    event KeeperRegistered(address indexed keeper, uint96 stake);
    event KeeperApproved(address indexed keeper);
    event KeeperRemoved(address indexed keeper);
    event KeeperSlashed(address indexed keeper, uint96 amount, string reason);
    event ConfigUpdated(RegistryConfig config);

    error UpkeepNotFound();
    error UpkeepNotActive();
    error InsufficientBalance();
    error InvalidGasLimit();
    error InvalidInterval();
    error NotUpkeepAdmin();
    error NotKeeper();
    error KeeperNotApproved();
    error TooSoon();
    error NotGovernance();
    error InsufficientStake();
    error KeeperAlreadyRegistered();
    error TooManyKeepers();
    error ETHTransferFailed();

    modifier onlyGovernance() {
        if (msg.sender != governance && msg.sender != owner()) revert NotGovernance();
        _;
    }

    modifier onlyUpkeepAdmin(uint256 id) {
        if (upkeeps[id].admin != msg.sender) revert NotUpkeepAdmin();
        _;
    }

    modifier onlyApprovedKeeper() {
        if (!keepers[msg.sender].approved) revert KeeperNotApproved();
        _;
    }

    constructor(address _governance) Ownable(msg.sender) {
        governance = _governance;
        feeRecipient = msg.sender;
        config = RegistryConfig({
            minUpkeepBalance: 0.01 ether,
            maxPerformGas: 5_000_000,
            maxCheckGas: 500_000,
            keeperFeeBps: 1000,
            protocolFeeBps: 500,
            minInterval: 60,
            maxKeepers: 100,
            minKeeperStake: 0.1 ether
        });
    }

    function registerUpkeep(
        address target,
        uint32 executeGas,
        uint32 interval,
        bytes calldata checkData,
        UpkeepType upkeepType
    ) external payable returns (uint256 id) {
        if (executeGas > config.maxPerformGas) revert InvalidGasLimit();
        if (interval < config.minInterval) revert InvalidInterval();
        if (msg.value < config.minUpkeepBalance) revert InsufficientBalance();

        id = ++upkeepCount;
        upkeeps[id] = Upkeep({
            target: target,
            balance: uint96(msg.value),
            admin: msg.sender,
            executeGas: executeGas,
            checkGas: config.maxCheckGas,
            interval: interval,
            lastPerformed: uint32(block.timestamp),
            performCount: 0,
            checkData: checkData,
            upkeepType: upkeepType,
            active: true
        });
        adminUpkeeps[msg.sender].push(id);
        totalActiveUpkeeps++;
        emit UpkeepRegistered(id, target, msg.sender, executeGas, interval, upkeepType);
    }

    function fundUpkeep(uint256 id) external payable {
        Upkeep storage upkeep = upkeeps[id];
        if (upkeep.target == address(0)) revert UpkeepNotFound();
        upkeep.balance += uint96(msg.value);
        emit UpkeepFunded(id, uint96(msg.value), upkeep.balance);
    }

    function cancelUpkeep(uint256 id) external onlyUpkeepAdmin(id) {
        Upkeep storage upkeep = upkeeps[id];
        if (!upkeep.active) revert UpkeepNotActive();
        uint96 remainingBalance = upkeep.balance;
        upkeep.active = false;
        upkeep.balance = 0;
        totalActiveUpkeeps--;
        if (remainingBalance > 0) {
            (bool success, ) = payable(msg.sender).call{value: remainingBalance}("");
            if (!success) revert ETHTransferFailed();
        }
        emit UpkeepCanceled(id, remainingBalance);
    }

    function registerKeeper() external payable {
        if (keepers[msg.sender].keeper != address(0)) revert KeeperAlreadyRegistered();
        if (keeperList.length >= config.maxKeepers) revert TooManyKeepers();
        if (msg.value < config.minKeeperStake) revert InsufficientStake();

        keepers[msg.sender] = KeeperInfo({
            keeper: msg.sender,
            stake: uint96(msg.value),
            performCount: 0,
            successCount: 0,
            lastActive: uint32(block.timestamp),
            approved: false
        });
        keeperList.push(msg.sender);
        emit KeeperRegistered(msg.sender, uint96(msg.value));
    }

    function approveKeeper(address keeper) external onlyGovernance {
        if (keepers[keeper].keeper == address(0)) revert NotKeeper();
        keepers[keeper].approved = true;
        emit KeeperApproved(keeper);
    }

    function removeKeeper(address keeper) external onlyGovernance {
        KeeperInfo storage info = keepers[keeper];
        if (info.keeper == address(0)) revert NotKeeper();
        uint96 stake = info.stake;

        for (uint256 i = 0; i < keeperList.length; i++) {
            if (keeperList[i] == keeper) {
                keeperList[i] = keeperList[keeperList.length - 1];
                keeperList.pop();
                break;
            }
        }
        delete keepers[keeper];
        if (stake > 0) {
            (bool success, ) = payable(keeper).call{value: stake}("");
            if (!success) revert ETHTransferFailed();
        }
        emit KeeperRemoved(keeper);
    }

    function slashKeeper(address keeper, uint96 amount, string calldata reason) external onlyGovernance {
        KeeperInfo storage info = keepers[keeper];
        if (info.stake < amount) amount = info.stake;
        info.stake -= amount;
        (bool success, ) = payable(feeRecipient).call{value: amount}("");
        if (!success) revert ETHTransferFailed();
        emit KeeperSlashed(keeper, amount, reason);
    }

    function checkUpkeep(uint256 id, bytes calldata)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        Upkeep storage upkeep = upkeeps[id];
        if (!upkeep.active) return (false, "");
        if (upkeep.balance < config.minUpkeepBalance) return (false, "");
        if (block.timestamp < upkeep.lastPerformed + upkeep.interval) return (false, "");

        (bool success, bytes memory result) =
            upkeep.target.staticcall(abi.encodeWithSignature("checkUpkeep(bytes)", upkeep.checkData));
        if (!success) return (false, "");
        (upkeepNeeded, performData) = abi.decode(result, (bool, bytes));
    }

    function performUpkeep(uint256 id, bytes calldata performData)
        external
        nonReentrant
        onlyApprovedKeeper
        whenNotPaused
    {
        Upkeep storage upkeep = upkeeps[id];
        if (!upkeep.active) revert UpkeepNotActive();
        if (upkeep.balance < config.minUpkeepBalance) revert InsufficientBalance();
        if (block.timestamp < upkeep.lastPerformed + upkeep.interval) revert TooSoon();

        uint256 gasStart = gasleft();
        (bool success,) =
            upkeep.target.call{gas: upkeep.executeGas}(abi.encodeWithSignature("performUpkeep(bytes)", performData));
        uint256 gasUsed = gasStart - gasleft();
        uint96 payment = calculatePayment(gasUsed);

        if (upkeep.balance < payment) revert InsufficientBalance();
        upkeep.balance -= payment;
        upkeep.lastPerformed = uint32(block.timestamp);
        upkeep.performCount++;
        totalPerforms++;
        totalFeesPaid += payment;

        KeeperInfo storage keeperInfo = keepers[msg.sender];
        keeperInfo.performCount++;
        if (success) keeperInfo.successCount++;
        keeperInfo.lastActive = uint32(block.timestamp);

        uint96 keeperPayment = payment * config.keeperFeeBps / 10000;
        uint96 protocolPayment = payment - keeperPayment;
        
        (bool keeperSuccess, ) = payable(msg.sender).call{value: keeperPayment}("");
        if (!keeperSuccess) revert ETHTransferFailed();
        
        (bool protocolSuccess, ) = payable(feeRecipient).call{value: protocolPayment}("");
        if (!protocolSuccess) revert ETHTransferFailed();

        emit UpkeepPerformed(id, success, msg.sender, payment, gasUsed);
    }

    function setConfig(RegistryConfig calldata _config) external onlyGovernance {
        config = _config;
        emit ConfigUpdated(_config);
    }

    function setFeeRecipient(address recipient) external onlyGovernance {
        feeRecipient = recipient;
    }

    function setGovernance(address _governance) external onlyOwner {
        governance = _governance;
    }

    function pause() external onlyGovernance {
        _pause();
    }

    function unpause() external onlyGovernance {
        _unpause();
    }

    function getUpkeep(uint256 id)
        external
        view
        returns (address, uint96, address, uint32, uint32, uint32, uint32, bool)
    {
        Upkeep storage u = upkeeps[id];
        return (u.target, u.balance, u.admin, u.executeGas, u.interval, u.lastPerformed, u.performCount, u.active);
    }

    function getKeeperInfo(address keeper) external view returns (KeeperInfo memory) {
        return keepers[keeper];
    }

    function getActiveKeepers() external view returns (address[] memory) {
        uint256 count;
        for (uint256 i = 0; i < keeperList.length; i++) {
            if (keepers[keeperList[i]].approved) count++;
        }
        address[] memory active = new address[](count);
        uint256 j;
        for (uint256 i = 0; i < keeperList.length; i++) {
            if (keepers[keeperList[i]].approved) active[j++] = keeperList[i];
        }
        return active;
    }

    function calculatePayment(uint256 gasUsed) public view returns (uint96) {
        return uint96(gasUsed * tx.gasprice * (10000 + config.keeperFeeBps + config.protocolFeeBps) / 10000);
    }

    function getState() external view returns (uint256, uint256, uint256, uint256, uint256) {
        return (upkeepCount, totalActiveUpkeeps, totalPerforms, totalFeesPaid, keeperList.length);
    }
}

interface IAutomationCompatible {
    function checkUpkeep(bytes calldata checkData)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData);
    function performUpkeep(bytes calldata performData) external;
}
