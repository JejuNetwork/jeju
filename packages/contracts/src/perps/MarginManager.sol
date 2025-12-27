// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IMarginManager, IPriceOracle} from "./interfaces/IPerps.sol";

/**
 * @title MarginManager
 * @notice Manages trader collateral for perpetual positions
 * @dev Supports multiple collateral tokens with cross-margin capabilities
 */
contract MarginManager is IMarginManager, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Price oracle for collateral valuation
    IPriceOracle public priceOracle;

    // Authorized trading contracts
    mapping(address => bool) public authorizedContracts;

    // Accepted collateral tokens with haircut factors (in bps, 10000 = 100%)
    mapping(address => uint256) public collateralFactors;

    // SECURITY: Timelocks for critical changes
    uint256 public constant ORACLE_CHANGE_DELAY = 24 hours;
    uint256 public constant AUTH_CHANGE_DELAY = 12 hours;

    address public pendingOracle;
    uint256 public oracleChangeTime;

    struct PendingAuthChange {
        address contractAddr;
        bool authorized;
        uint256 executeAfter;
    }

    mapping(bytes32 => PendingAuthChange) public pendingAuthChanges;

    event OracleChangeProposed(address indexed newOracle, uint256 executeAfter);
    event OracleChangeExecuted(address indexed oldOracle, address indexed newOracle);
    event AuthChangeProposed(bytes32 indexed changeId, address contractAddr, bool authorized, uint256 executeAfter);
    event AuthChangeExecuted(bytes32 indexed changeId, address contractAddr, bool authorized);

    error OracleChangePending();
    error NoOracleChangePending();
    error OracleChangeNotReady();
    error AuthChangeNotFound();
    error AuthChangeNotReady();

    address[] public acceptedTokensList;

    // Trader balances: trader => token => balance
    mapping(address => mapping(address => uint256)) public balances;

    // Locked collateral: trader => token => amount
    mapping(address => mapping(address => uint256)) public lockedCollateral;

    // Position-specific locks: positionId => token => amount
    mapping(bytes32 => mapping(address => uint256)) public positionLocks;

    constructor(address _priceOracle, address _owner) Ownable(_owner) {
        priceOracle = IPriceOracle(_priceOracle);
    }

    modifier onlyAuthorized() {
        require(authorizedContracts[msg.sender], "Not authorized");
        _;
    }

    /// @notice Propose authorizing a contract - requires 12-hour delay
    /// @dev SECURITY: Prevents instant access to all trader funds
    function proposeAuthorizedContract(address contractAddr, bool authorized)
        public
        onlyOwner
        returns (bytes32 changeId)
    {
        changeId = keccak256(abi.encodePacked(contractAddr, authorized, block.timestamp));
        pendingAuthChanges[changeId] = PendingAuthChange({
            contractAddr: contractAddr,
            authorized: authorized,
            executeAfter: block.timestamp + AUTH_CHANGE_DELAY
        });
        emit AuthChangeProposed(changeId, contractAddr, authorized, block.timestamp + AUTH_CHANGE_DELAY);
    }

    /// @notice Execute pending authorization change
    function executeAuthorizedContract(bytes32 changeId) external {
        PendingAuthChange storage change = pendingAuthChanges[changeId];
        if (change.executeAfter == 0) revert AuthChangeNotFound();
        if (block.timestamp < change.executeAfter) revert AuthChangeNotReady();

        authorizedContracts[change.contractAddr] = change.authorized;
        emit AuthChangeExecuted(changeId, change.contractAddr, change.authorized);

        delete pendingAuthChanges[changeId];
    }

    /// @notice Legacy setAuthorizedContract - now requires timelock
    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        proposeAuthorizedContract(contractAddr, authorized);
    }

    /// @notice Propose a new oracle - requires 24-hour delay
    /// @dev SECURITY: Prevents instant oracle manipulation for collateral valuation
    function proposePriceOracle(address _priceOracle) public onlyOwner {
        require(_priceOracle != address(0), "Invalid oracle");
        if (pendingOracle != address(0)) revert OracleChangePending();

        pendingOracle = _priceOracle;
        oracleChangeTime = block.timestamp + ORACLE_CHANGE_DELAY;
        emit OracleChangeProposed(_priceOracle, oracleChangeTime);
    }

    /// @notice Execute oracle change after timelock
    function executePriceOracleChange() external onlyOwner {
        if (pendingOracle == address(0)) revert NoOracleChangePending();
        if (block.timestamp < oracleChangeTime) revert OracleChangeNotReady();

        address oldOracle = address(priceOracle);
        priceOracle = IPriceOracle(pendingOracle);
        emit OracleChangeExecuted(oldOracle, pendingOracle);

        pendingOracle = address(0);
        oracleChangeTime = 0;
    }

    /// @notice Legacy setPriceOracle - now requires timelock
    function setPriceOracle(address _priceOracle) external onlyOwner {
        proposePriceOracle(_priceOracle);
    }

    function addAcceptedToken(address token, uint256 collateralFactor) external onlyOwner {
        require(collateralFactor > 0 && collateralFactor <= 10000, "Invalid factor");

        if (collateralFactors[token] == 0) {
            acceptedTokensList.push(token);
        }
        collateralFactors[token] = collateralFactor;
    }

    function removeAcceptedToken(address token) external onlyOwner {
        collateralFactors[token] = 0;

        // Remove from list
        for (uint256 i = 0; i < acceptedTokensList.length; i++) {
            if (acceptedTokensList[i] == token) {
                acceptedTokensList[i] = acceptedTokensList[acceptedTokensList.length - 1];
                acceptedTokensList.pop();
                break;
            }
        }
    }

    function deposit(address token, uint256 amount) external nonReentrant {
        require(collateralFactors[token] > 0, "Token not accepted");
        require(amount > 0, "Amount must be > 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender][token] += amount;

        emit Deposit(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        uint256 available = getAvailableCollateral(msg.sender, token);
        require(available >= amount, "Insufficient available collateral");

        balances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, token, amount);
    }

    function lockCollateral(address trader, address token, uint256 amount, bytes32 positionId)
        external
        onlyAuthorized
    {
        // Ensure trader has sufficient balance or accept direct transfer
        if (balances[trader][token] >= amount) {
            balances[trader][token] -= amount;
        }

        lockedCollateral[trader][token] += amount;
        positionLocks[positionId][token] += amount;

        emit CollateralLocked(trader, positionId, amount);
    }

    function releaseCollateral(address trader, address token, uint256 amount, bytes32 positionId)
        external
        onlyAuthorized
    {
        uint256 locked = positionLocks[positionId][token];
        uint256 toRelease = amount > locked ? locked : amount;

        positionLocks[positionId][token] -= toRelease;
        lockedCollateral[trader][token] -= toRelease;
        balances[trader][token] += toRelease;

        emit CollateralReleased(trader, positionId, toRelease);
    }

    function getCollateralBalance(address trader, address token) external view returns (uint256) {
        return balances[trader][token];
    }

    function getTotalCollateralValue(address trader) external view returns (uint256 totalValueUSD) {
        for (uint256 i = 0; i < acceptedTokensList.length; i++) {
            address token = acceptedTokensList[i];
            uint256 balance = balances[trader][token] + lockedCollateral[trader][token];

            if (balance > 0) {
                (uint256 price,) = priceOracle.getPrice(token);
                uint256 factor = collateralFactors[token];

                // Value = balance * price * factor / 10000
                uint256 tokenValue = (balance * price * factor) / (1e18 * 10000);
                totalValueUSD += tokenValue;
            }
        }
    }

    function getAvailableCollateral(address trader, address token) public view returns (uint256) {
        uint256 total = balances[trader][token];
        uint256 locked = lockedCollateral[trader][token];

        return total > locked ? total - locked : 0;
    }

    function getAcceptedTokens() external view returns (address[] memory) {
        return acceptedTokensList;
    }

    function getLockedCollateral(address trader, address token) external view returns (uint256) {
        return lockedCollateral[trader][token];
    }

    function getPositionCollateral(bytes32 positionId, address token) external view returns (uint256) {
        return positionLocks[positionId][token];
    }
}
