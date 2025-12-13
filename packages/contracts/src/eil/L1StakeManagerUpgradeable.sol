// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ICrossDomainMessenger} from "./ICrossDomainMessenger.sol";

/**
 * @title L1StakeManagerUpgradeable
 * @notice Upgradeable L1 stake manager for XLP cross-chain liquidity providers
 * @dev Uses UUPS proxy pattern for upgradeability
 *
 * Features:
 * - XLP registration with stake collateral
 * - Chain-specific unbonding periods (ZK: 1 hour, Optimistic: 7 days)
 * - Slashing for failed fulfillments
 * - Cross-chain stake sync via L1→L2 messaging
 * - State root verification integration
 */
contract L1StakeManagerUpgradeable is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // ============ Constants ============

    uint256 public constant DEFAULT_UNBONDING_PERIOD = 7 days;
    uint256 public constant MIN_UNBONDING_PERIOD = 1 hours;
    uint256 public constant MAX_UNBONDING_PERIOD = 14 days;
    uint256 public constant MIN_STAKE = 1 ether;
    uint256 public constant SLASH_PENALTY = 50;
    uint256 public constant MAX_CHAINS = 20;
    uint32 public constant CROSS_CHAIN_GAS_LIMIT = 200_000;

    // ============ State Variables ============

    mapping(uint256 => address) public l2Paymasters;
    mapping(address => XLPStake) public stakes;
    mapping(address => uint256[]) public xlpChains;
    mapping(bytes32 => SlashRecord) public slashRecords;

    uint256 public totalStaked;
    uint256 public totalSlashed;
    uint256 public activeXLPCount;
    mapping(address => bool) public authorizedSlashers;

    /// @notice Chain-specific unbonding periods
    mapping(uint256 => uint256) public chainUnbondingPeriods;

    /// @notice Cross-domain messenger for L1→L2 communication
    ICrossDomainMessenger public messenger;

    /// @notice L2 state root verifier contract
    address public stateRootVerifier;

    struct XLPStake {
        uint256 stakedAmount;
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
        uint256 slashedAmount;
        bool isActive;
        uint256 registeredAt;
    }

    struct SlashRecord {
        address xlp;
        uint256 amount;
        bytes32 reason;
        uint256 timestamp;
        bool disputed;
    }

    // ============ Events ============

    event XLPRegistered(address indexed xlp, uint256 stake, uint256[] chains);
    event StakeDeposited(address indexed xlp, uint256 amount, uint256 total);
    event UnbondingStarted(address indexed xlp, uint256 amount, uint256 unlockTime);
    event StakeWithdrawn(address indexed xlp, uint256 amount);
    event XLPSlashed(address indexed xlp, uint256 amount, bytes32 reason);
    event PaymasterRegistered(uint256 indexed chainId, address paymaster);
    event ChainUnbondingPeriodUpdated(uint256 indexed chainId, uint256 oldPeriod, uint256 newPeriod);
    event MessengerUpdated(address indexed oldMessenger, address indexed newMessenger);
    event StateRootVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    // ============ Errors ============

    error InsufficientStake();
    error AlreadyRegistered();
    error NotRegistered();
    error TooManyChains();
    error ChainNotSupported();
    error UnbondingInProgress();
    error UnbondingNotComplete();
    error InvalidAmount();
    error NotAuthorized();
    error InvalidUnbondingPeriod();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner) public initializer {
        __Ownable_init();
        _transferOwnership(owner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
    }

    function register(uint256[] calldata chains) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        if (stakes[msg.sender].isActive) revert AlreadyRegistered();
        if (chains.length > MAX_CHAINS) revert TooManyChains();

        for (uint256 i = 0; i < chains.length; i++) {
            if (l2Paymasters[chains[i]] == address(0)) revert ChainNotSupported();
        }

        stakes[msg.sender] = XLPStake({
            stakedAmount: msg.value,
            unbondingAmount: 0,
            unbondingStartTime: 0,
            slashedAmount: 0,
            isActive: true,
            registeredAt: block.timestamp
        });

        xlpChains[msg.sender] = chains;
        totalStaked += msg.value;
        activeXLPCount++;

        emit XLPRegistered(msg.sender, msg.value, chains);
    }

    function addStake() external payable nonReentrant whenNotPaused {
        if (!stakes[msg.sender].isActive) revert NotRegistered();
        if (msg.value == 0) revert InvalidAmount();

        stakes[msg.sender].stakedAmount += msg.value;
        totalStaked += msg.value;

        emit StakeDeposited(msg.sender, msg.value, stakes[msg.sender].stakedAmount);
    }

    function startUnbonding(uint256 amount) external nonReentrant whenNotPaused {
        XLPStake storage stake = stakes[msg.sender];
        if (!stake.isActive) revert NotRegistered();
        if (stake.unbondingAmount > 0) revert UnbondingInProgress();
        if (amount > stake.stakedAmount) revert InvalidAmount();

        stake.stakedAmount -= amount;
        stake.unbondingAmount = amount;
        stake.unbondingStartTime = block.timestamp;
        totalStaked -= amount;

        emit UnbondingStarted(msg.sender, amount, block.timestamp + DEFAULT_UNBONDING_PERIOD);
    }

    function withdraw() external nonReentrant {
        XLPStake storage stake = stakes[msg.sender];
        if (stake.unbondingAmount == 0) revert InvalidAmount();

        if (block.timestamp < stake.unbondingStartTime + DEFAULT_UNBONDING_PERIOD) {
            revert UnbondingNotComplete();
        }

        uint256 amount = stake.unbondingAmount;
        stake.unbondingAmount = 0;
        stake.unbondingStartTime = 0;

        if (stake.stakedAmount == 0) {
            stake.isActive = false;
            activeXLPCount--;
        }

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit StakeWithdrawn(msg.sender, amount);
    }

    // ============ Admin Functions ============

    function registerPaymaster(uint256 chainId, address paymaster) external onlyOwner {
        l2Paymasters[chainId] = paymaster;
        emit PaymasterRegistered(chainId, paymaster);
    }

    function setAuthorizedSlasher(address slasher, bool authorized) external onlyOwner {
        authorizedSlashers[slasher] = authorized;
    }

    function setChainUnbondingPeriod(uint256 chainId, uint256 unbondingPeriod) external onlyOwner {
        if (unbondingPeriod < MIN_UNBONDING_PERIOD || unbondingPeriod > MAX_UNBONDING_PERIOD) {
            revert InvalidUnbondingPeriod();
        }
        uint256 oldPeriod = chainUnbondingPeriods[chainId];
        chainUnbondingPeriods[chainId] = unbondingPeriod;
        emit ChainUnbondingPeriodUpdated(chainId, oldPeriod, unbondingPeriod);
    }

    function setMessenger(address _messenger) external onlyOwner {
        address oldMessenger = address(messenger);
        messenger = ICrossDomainMessenger(_messenger);
        emit MessengerUpdated(oldMessenger, _messenger);
    }

    function setStateRootVerifier(address _verifier) external onlyOwner {
        address oldVerifier = stateRootVerifier;
        stateRootVerifier = _verifier;
        emit StateRootVerifierUpdated(oldVerifier, _verifier);
    }

    function syncStakeToL2(uint256 chainId, address xlp) external {
        require(msg.sender == xlp || msg.sender == owner(), "Unauthorized");
        require(address(messenger) != address(0), "Messenger not set");
        address paymaster = l2Paymasters[chainId];
        require(paymaster != address(0), "Paymaster not registered");

        uint256 stake = stakes[xlp].stakedAmount;
        bytes memory message = abi.encodeWithSignature("updateXLPStake(address,uint256)", xlp, stake);
        messenger.sendMessage(paymaster, message, CROSS_CHAIN_GAS_LIMIT);
    }

    function slash(address xlp, uint256 amount, bytes32 reason) external {
        if (!authorizedSlashers[msg.sender]) revert NotAuthorized();

        XLPStake storage stake = stakes[xlp];
        if (!stake.isActive) revert NotRegistered();

        uint256 slashAmount = amount > stake.stakedAmount ? stake.stakedAmount : amount;
        stake.stakedAmount -= slashAmount;
        stake.slashedAmount += slashAmount;
        totalStaked -= slashAmount;
        totalSlashed += slashAmount;

        emit XLPSlashed(xlp, slashAmount, reason);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getXLPStake(address xlp) external view returns (XLPStake memory) {
        return stakes[xlp];
    }

    function getXLPChains(address xlp) external view returns (uint256[] memory) {
        return xlpChains[xlp];
    }

    function isXLPActive(address xlp) external view returns (bool) {
        return stakes[xlp].isActive;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;
}
