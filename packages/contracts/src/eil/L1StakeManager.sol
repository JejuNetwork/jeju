// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ICrossDomainMessenger} from "./ICrossDomainMessenger.sol";

/**
 * @title L1StakeManager
 * @author Jeju Network
 * @notice Manages XLP (Cross-chain Liquidity Provider) stakes on Ethereum L1
 * @dev Part of EIL (Ethereum Interop Layer) - provides economic security for cross-chain transfers
 *
 * ## How it works:
 *
 * 1. XLPs deposit ETH as stake (collateral)
 * 2. Stake is locked for 8 days upon unbonding request
 * 3. If XLP misbehaves (fails to fulfill voucher), stake can be slashed
 * 4. Slashed funds go to affected users as compensation
 *
 * ## Security Assumptions:
 * - Relies on L2 rollup fraud proofs for dispute resolution
 * - Slash evidence must be provable via L1 messages from L2
 * - 8-day unbonding matches rollup challenge period
 *
 * @custom:security-contact security@jeju.network
 */
contract L1StakeManager is Ownable, ReentrancyGuard, Pausable {
    // ============ Constants ============

    /// @notice Unbonding period (8 days)
    uint256 public constant UNBONDING_PERIOD = 8 days;

    /// @notice Minimum stake required to be an XLP
    uint256 public constant MIN_STAKE = 1 ether;

    /// @notice Slashing penalty percentage (50%)
    uint256 public constant SLASH_PENALTY = 50;

    /// @notice Maximum number of active chains an XLP can support
    uint256 public constant MAX_CHAINS = 20;

    /// @notice Gas limit for cross-chain messages
    uint32 public constant CROSS_CHAIN_GAS_LIMIT = 200_000;

    // ============ State Variables ============

    /// @notice Registered L2 CrossChainPaymaster contracts
    mapping(uint256 => address) public l2Paymasters; // chainId => paymaster

    /// @notice XLP stakes
    mapping(address => XLPStake) public stakes;

    /// @notice Chains an XLP is registered on
    mapping(address => uint256[]) public xlpChains;

    /// @notice Slash records for dispute
    mapping(bytes32 => SlashRecord) public slashRecords;

    /// @notice Total staked ETH
    uint256 public totalStaked;

    /// @notice Total slashed ETH
    uint256 public totalSlashed;

    /// @notice Count of active XLPs
    uint256 public activeXLPCount;

    /// @notice Authorized slashers (L2 bridge contracts)
    mapping(address => bool) public authorizedSlashers;

    /// @notice Cross-domain messenger for L1→L2 communication
    ICrossDomainMessenger public messenger;

    // ============ Structs ============

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
        uint256 chainId;
        bytes32 voucherId;
        uint256 amount;
        address victim;
        uint256 timestamp;
        bool executed;
        bool disputed;
    }

    // ============ Events ============

    event XLPRegistered(address indexed xlp, uint256 stakedAmount, uint256[] chains);
    event StakeDeposited(address indexed xlp, uint256 amount, uint256 totalStake);
    event UnbondingStarted(address indexed xlp, uint256 amount, uint256 unbondingComplete);
    event StakeWithdrawn(address indexed xlp, uint256 amount);
    event XLPSlashed(address indexed xlp, bytes32 indexed voucherId, uint256 amount, address victim);
    event SlashDisputed(bytes32 indexed slashId, address indexed xlp);
    event L2PaymasterRegistered(uint256 indexed chainId, address paymaster);
    event AuthorizedSlasherUpdated(address indexed slasher, bool authorized);
    event ChainRegistered(address indexed xlp, uint256 chainId);
    event ChainUnregistered(address indexed xlp, uint256 chainId);

    // ============ Errors ============

    error InsufficientStake();
    error AlreadyRegistered();
    error NotRegistered();
    error UnbondingInProgress();
    error UnbondingNotComplete();
    error NoUnbondingStake();
    error TooManyChains();
    error ChainNotSupported();
    error ChainAlreadyRegistered();
    error InvalidVoucher();
    error SlashAlreadyExecuted();
    error SlashDisputedError();
    error UnauthorizedSlasher();
    error InvalidAmount();
    error WithdrawalFailed();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ XLP Registration ============

    /**
     * @notice Register as an XLP with initial stake
     * @param chains Array of chain IDs to support
     */
    function register(uint256[] calldata chains) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        if (stakes[msg.sender].isActive) revert AlreadyRegistered();
        if (chains.length > MAX_CHAINS) revert TooManyChains();

        // Verify all chains have registered paymasters
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

    /**
     * @notice Add more stake
     */
    function addStake() external payable nonReentrant whenNotPaused {
        if (!stakes[msg.sender].isActive) revert NotRegistered();
        if (msg.value == 0) revert InvalidAmount();

        stakes[msg.sender].stakedAmount += msg.value;
        totalStaked += msg.value;

        emit StakeDeposited(msg.sender, msg.value, stakes[msg.sender].stakedAmount);
    }

    /**
     * @notice Start unbonding stake
     * @param amount Amount to unbond
     */
    function startUnbonding(uint256 amount) external nonReentrant whenNotPaused {
        XLPStake storage stake = stakes[msg.sender];

        if (!stake.isActive) revert NotRegistered();
        if (stake.unbondingAmount > 0) revert UnbondingInProgress();
        if (amount > stake.stakedAmount) revert InsufficientStake();

        // Must keep minimum stake if staying active
        uint256 remainingStake = stake.stakedAmount - amount;
        if (remainingStake > 0 && remainingStake < MIN_STAKE) {
            revert InsufficientStake();
        }

        stake.stakedAmount -= amount;
        stake.unbondingAmount = amount;
        stake.unbondingStartTime = block.timestamp;

        // If fully unbonding, deactivate XLP
        if (stake.stakedAmount == 0) {
            stake.isActive = false;
            activeXLPCount--;
        }

        emit UnbondingStarted(msg.sender, amount, block.timestamp + UNBONDING_PERIOD);
    }

    /**
     * @notice Complete unbonding and withdraw stake
     */
    function completeUnbonding() external nonReentrant {
        XLPStake storage stake = stakes[msg.sender];

        if (stake.unbondingAmount == 0) revert NoUnbondingStake();
        if (block.timestamp < stake.unbondingStartTime + UNBONDING_PERIOD) {
            revert UnbondingNotComplete();
        }

        uint256 amount = stake.unbondingAmount;
        stake.unbondingAmount = 0;
        stake.unbondingStartTime = 0;
        totalStaked -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert WithdrawalFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }

    /**
     * @notice Cancel unbonding and restake
     */
    function cancelUnbonding() external nonReentrant whenNotPaused {
        XLPStake storage stake = stakes[msg.sender];

        if (stake.unbondingAmount == 0) revert NoUnbondingStake();

        bool wasInactive = !stake.isActive;

        uint256 amount = stake.unbondingAmount;
        stake.stakedAmount += amount;
        stake.unbondingAmount = 0;
        stake.unbondingStartTime = 0;
        stake.isActive = true;

        // Increment count if reactivating
        if (wasInactive) {
            activeXLPCount++;
        }

        emit StakeDeposited(msg.sender, amount, stake.stakedAmount);
    }

    // ============ Chain Registration ============

    /**
     * @notice Register XLP for an additional chain
     * @param chainId Chain to register for
     */
    function registerChain(uint256 chainId) external nonReentrant whenNotPaused {
        XLPStake storage stake = stakes[msg.sender];

        if (!stake.isActive) revert NotRegistered();
        if (l2Paymasters[chainId] == address(0)) revert ChainNotSupported();

        uint256[] storage chains = xlpChains[msg.sender];
        if (chains.length >= MAX_CHAINS) revert TooManyChains();

        // Check if already registered
        for (uint256 i = 0; i < chains.length; i++) {
            if (chains[i] == chainId) revert ChainAlreadyRegistered();
        }

        chains.push(chainId);

        emit ChainRegistered(msg.sender, chainId);
    }

    /**
     * @notice Unregister XLP from a chain
     * @param chainId Chain to unregister from
     */
    function unregisterChain(uint256 chainId) external nonReentrant {
        uint256[] storage chains = xlpChains[msg.sender];

        for (uint256 i = 0; i < chains.length; i++) {
            if (chains[i] == chainId) {
                chains[i] = chains[chains.length - 1];
                chains.pop();
                emit ChainUnregistered(msg.sender, chainId);
                return;
            }
        }

        revert ChainNotSupported();
    }

    // ============ Slashing ============

    /**
     * @notice Slash an XLP for failing to fulfill a voucher
     * @param xlp XLP to slash
     * @param chainId Chain where violation occurred
     * @param voucherId Voucher that was not fulfilled
     * @param amount Amount to compensate victim
     * @param victim Address to receive compensation
     * @dev Only callable by authorized slashers (L2 bridge contracts)
     * @custom:security CEI pattern: Update all state before external calls
     */
    function slash(address xlp, uint256 chainId, bytes32 voucherId, uint256 amount, address victim)
        external
        nonReentrant
    {
        if (!authorizedSlashers[msg.sender]) revert UnauthorizedSlasher();

        XLPStake storage stake = stakes[xlp];
        if (!stake.isActive && stake.unbondingAmount == 0) revert NotRegistered();

        bytes32 slashId = keccak256(abi.encodePacked(xlp, chainId, voucherId));
        if (slashRecords[slashId].executed) revert SlashAlreadyExecuted();

        // Calculate slash amount (50% of relevant stake or victim amount, whichever is smaller)
        uint256 totalAvailable = stake.stakedAmount + stake.unbondingAmount;
        uint256 slashAmount = (totalAvailable * SLASH_PENALTY) / 100;
        if (slashAmount > amount) {
            slashAmount = amount;
        }

        // EFFECTS: Update ALL state BEFORE external calls (CEI pattern)
        // Deduct from stake (prefer active stake, then unbonding)
        if (stake.stakedAmount >= slashAmount) {
            stake.stakedAmount -= slashAmount;
        } else {
            uint256 fromUnbonding = slashAmount - stake.stakedAmount;
            stake.stakedAmount = 0;
            stake.unbondingAmount -= fromUnbonding;
        }

        stake.slashedAmount += slashAmount;
        totalSlashed += slashAmount;
        totalStaked -= slashAmount;

        // Deactivate if below minimum
        if (stake.stakedAmount < MIN_STAKE && stake.isActive) {
            stake.isActive = false;
            activeXLPCount--;
        }

        // Record slash
        slashRecords[slashId] = SlashRecord({
            xlp: xlp,
            chainId: chainId,
            voucherId: voucherId,
            amount: slashAmount,
            victim: victim,
            timestamp: block.timestamp,
            executed: true,
            disputed: false
        });

        // Emit event before external calls
        emit XLPSlashed(xlp, voucherId, slashAmount, victim);

        // INTERACTIONS: External calls last
        (bool success,) = victim.call{value: slashAmount}("");
        if (!success) revert WithdrawalFailed();
    }

    /**
     * @notice Dispute a slash (starts dispute process)
     * @param slashId Slash ID to dispute
     * @dev In production, this would initiate an L1 dispute resolution
     */
    function disputeSlash(bytes32 slashId) external {
        SlashRecord storage record = slashRecords[slashId];
        if (record.xlp != msg.sender) revert InvalidVoucher();
        if (!record.executed) revert InvalidVoucher();
        if (record.disputed) revert SlashDisputedError();

        record.disputed = true;

        emit SlashDisputed(slashId, msg.sender);
    }

    // ============ Admin Functions ============

    /**
     * @notice Register an L2 CrossChainPaymaster
     * @param chainId Chain ID
     * @param paymaster Paymaster address on that chain
     */
    function registerL2Paymaster(uint256 chainId, address paymaster) external onlyOwner {
        l2Paymasters[chainId] = paymaster;
        emit L2PaymasterRegistered(chainId, paymaster);
    }

    /**
     * @notice Set authorized slasher status
     * @param slasher Address to authorize/deauthorize
     * @param authorized Whether to authorize
     */
    function setAuthorizedSlasher(address slasher, bool authorized) external onlyOwner {
        authorizedSlashers[slasher] = authorized;
        emit AuthorizedSlasherUpdated(slasher, authorized);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Set the cross-domain messenger address
     * @param _messenger L1CrossDomainMessenger address
     */
    function setMessenger(address _messenger) external onlyOwner {
        messenger = ICrossDomainMessenger(_messenger);
    }

    /**
     * @notice Sync XLP stake to an L2 paymaster
     * @param chainId Target L2 chain ID
     * @param xlp XLP address to sync
     * @dev Sends a cross-chain message to update stake on L2
     *      Only callable by the XLP themselves or the owner
     */
    function syncStakeToL2(uint256 chainId, address xlp) external {
        require(msg.sender == xlp || msg.sender == owner(), "Unauthorized");
        require(address(messenger) != address(0), "Messenger not set");
        address paymaster = l2Paymasters[chainId];
        require(paymaster != address(0), "Paymaster not registered");

        uint256 stake = stakes[xlp].stakedAmount;

        // Encode the updateXLPStake call
        bytes memory message = abi.encodeWithSignature("updateXLPStake(address,uint256)", xlp, stake);

        // Send cross-chain message
        messenger.sendMessage(paymaster, message, CROSS_CHAIN_GAS_LIMIT);
    }

    /**
     * @notice Relay voucher fulfillment proof to source chain
     * @param chainId Target L2 chain ID (source chain)
     * @param voucherId Voucher that was fulfilled
     * @dev Called after verifying fulfillment on destination chain
     */
    function relayFulfillment(uint256 chainId, bytes32 voucherId) external onlyOwner {
        require(address(messenger) != address(0), "Messenger not set");
        address paymaster = l2Paymasters[chainId];
        require(paymaster != address(0), "Paymaster not registered");

        bytes memory message = abi.encodeWithSignature("markVoucherFulfilled(bytes32)", voucherId);

        messenger.sendMessage(paymaster, message, CROSS_CHAIN_GAS_LIMIT);
    }

    // ============ View Functions ============

    function getStake(address xlp) external view returns (XLPStake memory) {
        return stakes[xlp];
    }

    function getXLPChains(address xlp) external view returns (uint256[] memory) {
        return xlpChains[xlp];
    }

    function isXLPActive(address xlp) external view returns (bool) {
        return stakes[xlp].isActive;
    }

    function getEffectiveStake(address xlp) external view returns (uint256) {
        XLPStake storage stake = stakes[xlp];
        return stake.stakedAmount + stake.unbondingAmount;
    }

    function getUnbondingTimeRemaining(address xlp) external view returns (uint256) {
        XLPStake storage stake = stakes[xlp];
        if (stake.unbondingAmount == 0) return 0;

        uint256 completeTime = stake.unbondingStartTime + UNBONDING_PERIOD;
        if (block.timestamp >= completeTime) return 0;

        return completeTime - block.timestamp;
    }

    function supportsChain(address xlp, uint256 chainId) external view returns (bool) {
        uint256[] storage chains = xlpChains[xlp];
        for (uint256 i = 0; i < chains.length; i++) {
            if (chains[i] == chainId) return true;
        }
        return false;
    }

    function getProtocolStats()
        external
        view
        returns (uint256 _totalStaked, uint256 _totalSlashed, uint256 activeXLPs)
    {
        return (totalStaked, totalSlashed, activeXLPCount);
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
