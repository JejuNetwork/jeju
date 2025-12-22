// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title BaseStaking
 * @author Jeju Network
 * @notice Abstract base contract for staking implementations
 * @dev Provides common staking functionality:
 *      - Stake/unstake with unbonding periods
 *      - Slashing mechanism
 *      - ERC-8004 IdentityRegistry integration
 *      - BanManager integration
 *      - Pausable/ownable admin controls
 *
 * Implementations can extend this for:
 *      - NodeStakingManager: Multi-token node operator staking
 *      - RPCStakingManager: RPC access tier-based staking
 *      - ComputeStaking: Compute marketplace staking
 *
 * @custom:security-contact security@jejunetwork.org
 */
abstract contract BaseStaking is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Types ============

    struct BaseStakePosition {
        uint256 amount;
        uint256 stakedAt;
        uint256 unbondingStartTime;
        uint256 unbondingAmount;
        uint256 agentId; // ERC-8004 agent ID (0 if not linked)
        bool isActive;
        bool isFrozen;
        bool isSlashed;
    }

    // ============ Constants ============

    uint256 public constant BPS_DENOMINATOR = 10000;

    // ============ Immutable State ============

    /// @notice Unbonding period before withdrawal allowed
    uint256 public immutable unbondingPeriod;

    // ============ Mutable State ============

    /// @notice ERC-8004 Identity Registry
    IIdentityRegistry public identityRegistry;

    /// @notice Ban manager for checking banned addresses
    address public banManager;

    /// @notice Treasury for slashed funds
    address public treasury;

    /// @notice Moderators who can freeze/slash
    mapping(address => bool) public moderators;

    /// @notice Total staked amount
    uint256 public totalStaked;

    /// @notice Total stakers count
    uint256 public totalStakers;

    // ============ Events ============

    event Staked(address indexed user, uint256 amount, uint256 agentId);
    event UnbondingStarted(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event StakeFrozen(address indexed user, string reason, address indexed moderator);
    event StakeUnfrozen(address indexed user, address indexed moderator);
    event StakeSlashed(address indexed user, uint256 amount, string reason, address indexed moderator);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event BanManagerUpdated(address indexed oldManager, address indexed newManager);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ModeratorUpdated(address indexed account, bool status);
    event AgentLinked(address indexed user, uint256 agentId);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();
    error StakeNotActive();
    error StakeFrozenError();
    error StakeNotFrozen();
    error StakeSlashedError();
    error UnbondingInProgress();
    error NotUnbonding();
    error UnbondingNotComplete();
    error UserIsBanned();
    error NotModerator();
    error AgentNotOwned();
    error AgentAlreadyLinked();
    error TransferFailed();

    // ============ Constructor ============

    constructor(uint256 _unbondingPeriod, address initialOwner) Ownable(initialOwner) {
        unbondingPeriod = _unbondingPeriod;
    }

    // ============ Modifiers ============

    modifier onlyModerator() {
        if (!moderators[msg.sender] && msg.sender != owner()) revert NotModerator();
        _;
    }

    modifier notBanned(address user) {
        if (banManager != address(0)) {
            (bool success, bytes memory data) =
                banManager.staticcall(abi.encodeWithSignature("isAddressBanned(address)", user));
            if (success && data.length >= 32) {
                bool banned = abi.decode(data, (bool));
                if (banned) revert UserIsBanned();
            }
        }
        _;
    }

    // ============ Internal Staking Logic ============

    /**
     * @notice Internal stake function for ETH
     * @param position Storage pointer to user's position
     * @param user User address
     * @param amount Amount to stake
     * @param agentId Optional ERC-8004 agent ID (0 to skip)
     */
    function _stakeETH(
        BaseStakePosition storage position,
        address user,
        uint256 amount,
        uint256 agentId
    ) internal notBanned(user) {
        if (amount == 0) revert ZeroAmount();

        bool wasActive = position.isActive;

        if (!position.isActive) {
            position.isActive = true;
            position.stakedAt = block.timestamp;
            totalStakers++;
        }

        position.amount += amount;
        totalStaked += amount;

        if (agentId > 0 && position.agentId == 0) {
            _linkAgentInternal(position, user, agentId);
        }

        emit Staked(user, amount, agentId);
    }

    /**
     * @notice Internal stake function for ERC20
     * @param position Storage pointer to user's position
     * @param user User address
     * @param token Token to stake
     * @param amount Amount to stake
     * @param agentId Optional ERC-8004 agent ID (0 to skip)
     */
    function _stakeToken(
        BaseStakePosition storage position,
        address user,
        IERC20 token,
        uint256 amount,
        uint256 agentId
    ) internal notBanned(user) {
        if (amount == 0) revert ZeroAmount();

        token.safeTransferFrom(user, address(this), amount);

        bool wasActive = position.isActive;

        if (!position.isActive) {
            position.isActive = true;
            position.stakedAt = block.timestamp;
            totalStakers++;
        }

        position.amount += amount;
        totalStaked += amount;

        if (agentId > 0 && position.agentId == 0) {
            _linkAgentInternal(position, user, agentId);
        }

        emit Staked(user, amount, agentId);
    }

    /**
     * @notice Start unbonding process
     * @param position Storage pointer to user's position
     * @param user User address
     * @param amount Amount to unbond
     */
    function _startUnbonding(
        BaseStakePosition storage position,
        address user,
        uint256 amount
    ) internal {
        if (position.isFrozen) revert StakeFrozenError();
        if (position.isSlashed) revert StakeSlashedError();
        if (amount == 0) revert ZeroAmount();
        if (amount > position.amount) revert InsufficientBalance();
        if (position.unbondingStartTime > 0) revert UnbondingInProgress();

        position.unbondingAmount = amount;
        position.unbondingStartTime = block.timestamp;
        position.amount -= amount;
        totalStaked -= amount;

        emit UnbondingStarted(user, amount);
    }

    /**
     * @notice Complete unstaking and return ETH
     * @param position Storage pointer to user's position
     * @param user User address
     */
    function _completeUnstakingETH(
        BaseStakePosition storage position,
        address user
    ) internal {
        if (position.isFrozen) revert StakeFrozenError();
        if (position.unbondingStartTime == 0) revert NotUnbonding();
        if (block.timestamp < position.unbondingStartTime + unbondingPeriod) revert UnbondingNotComplete();

        uint256 amount = position.unbondingAmount;
        position.unbondingAmount = 0;
        position.unbondingStartTime = 0;

        if (position.amount == 0) {
            position.isActive = false;
            totalStakers--;
        }

        (bool success,) = user.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Unstaked(user, amount);
    }

    /**
     * @notice Complete unstaking and return tokens
     * @param position Storage pointer to user's position
     * @param user User address
     * @param token Token to return
     */
    function _completeUnstakingToken(
        BaseStakePosition storage position,
        address user,
        IERC20 token
    ) internal {
        if (position.isFrozen) revert StakeFrozenError();
        if (position.unbondingStartTime == 0) revert NotUnbonding();
        if (block.timestamp < position.unbondingStartTime + unbondingPeriod) revert UnbondingNotComplete();

        uint256 amount = position.unbondingAmount;
        position.unbondingAmount = 0;
        position.unbondingStartTime = 0;

        if (position.amount == 0) {
            position.isActive = false;
            totalStakers--;
        }

        token.safeTransfer(user, amount);

        emit Unstaked(user, amount);
    }

    /**
     * @notice Link an ERC-8004 agent to position
     */
    function _linkAgentInternal(
        BaseStakePosition storage position,
        address user,
        uint256 agentId
    ) internal {
        if (position.agentId != 0) revert AgentAlreadyLinked();

        // Verify ownership if registry is set
        if (address(identityRegistry) != address(0)) {
            if (identityRegistry.ownerOf(agentId) != user) revert AgentNotOwned();
        }

        position.agentId = agentId;
        emit AgentLinked(user, agentId);
    }

    // ============ Moderation Functions ============

    /**
     * @notice Freeze a user's stake (prevents withdrawal and may block access)
     * @param position Storage pointer to user's position
     * @param user User address
     * @param reason Reason for freezing
     */
    function _freezeStake(
        BaseStakePosition storage position,
        address user,
        string calldata reason
    ) internal onlyModerator {
        if (position.isFrozen) revert StakeFrozenError();
        position.isFrozen = true;
        emit StakeFrozen(user, reason, msg.sender);
    }

    /**
     * @notice Unfreeze a user's stake
     * @param position Storage pointer to user's position
     * @param user User address
     */
    function _unfreezeStake(
        BaseStakePosition storage position,
        address user
    ) internal onlyModerator {
        if (!position.isFrozen) revert StakeNotFrozen();
        position.isFrozen = false;
        emit StakeUnfrozen(user, msg.sender);
    }

    /**
     * @notice Slash a portion of user's ETH stake
     * @param position Storage pointer to user's position
     * @param user User address
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function _slashETH(
        BaseStakePosition storage position,
        address user,
        uint256 amount,
        string calldata reason
    ) internal onlyModerator {
        uint256 slashable = position.amount;
        uint256 toSlash = amount > slashable ? slashable : amount;
        if (toSlash == 0) revert ZeroAmount();

        position.amount -= toSlash;
        totalStaked -= toSlash;
        position.isSlashed = true;

        if (treasury != address(0)) {
            (bool success,) = treasury.call{value: toSlash}("");
            if (!success) revert TransferFailed();
        }

        emit StakeSlashed(user, toSlash, reason, msg.sender);
    }

    /**
     * @notice Slash a portion of user's token stake
     * @param position Storage pointer to user's position
     * @param user User address
     * @param token Token to slash
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function _slashToken(
        BaseStakePosition storage position,
        address user,
        IERC20 token,
        uint256 amount,
        string calldata reason
    ) internal onlyModerator {
        uint256 slashable = position.amount;
        uint256 toSlash = amount > slashable ? slashable : amount;
        if (toSlash == 0) revert ZeroAmount();

        position.amount -= toSlash;
        totalStaked -= toSlash;
        position.isSlashed = true;

        if (treasury != address(0)) {
            token.safeTransfer(treasury, toSlash);
        }

        emit StakeSlashed(user, toSlash, reason, msg.sender);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set identity registry
     * @param registry New identity registry address
     */
    function setIdentityRegistry(address registry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(registry);
        emit IdentityRegistryUpdated(oldRegistry, registry);
    }

    /**
     * @notice Set ban manager
     * @param _banManager New ban manager address
     */
    function setBanManager(address _banManager) external onlyOwner {
        address oldManager = banManager;
        banManager = _banManager;
        emit BanManagerUpdated(oldManager, _banManager);
    }

    /**
     * @notice Set treasury for slashed funds
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /**
     * @notice Add/remove moderator
     * @param account Moderator address
     * @param status True to add, false to remove
     */
    function setModerator(address account, bool status) external onlyOwner {
        moderators[account] = status;
        emit ModeratorUpdated(account, status);
    }

    /**
     * @notice Pause the contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @notice Check if a position's linked agent is banned
     * @param position Position to check
     * @return True if banned
     */
    function _isAgentBanned(BaseStakePosition storage position) internal view returns (bool) {
        if (position.agentId == 0) return false;
        if (address(identityRegistry) == address(0)) return false;

        (bool success, bytes memory data) = address(identityRegistry).staticcall(
            abi.encodeWithSignature("getMarketplaceInfo(uint256)", position.agentId)
        );

        if (success && data.length >= 224) {
            (,,,,,, bool banned) = abi.decode(data, (string, string, string, string, bool, uint8, bool));
            return banned;
        }

        return false;
    }

    /**
     * @notice Contract version - override in implementations
     */
    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }

    // Allow receiving ETH
    receive() external payable virtual {}
}
