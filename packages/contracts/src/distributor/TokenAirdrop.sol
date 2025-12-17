// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title TokenAirdrop
 * @notice Token Airdrop with daily engagement drip mechanism
 * @dev Implements a tokenomics airdrop strategy:
 *      - Points-based allocation with trading activity and ecosystem participation bonuses
 *      - 5% drip per day of user's allocation (encourages 20 days of engagement)
 *      - Users must visit, post, or trade to unlock their daily drip
 *
 * Drip Mechanism:
 * - Total airdrop split into 20 daily portions (5% each)
 * - User must perform qualifying action each day to unlock that day's portion
 * - Unclaimed drips accumulate but require the activity to unlock
 * - After 20 days, user has unlocked 100% (if active every day)
 * - Missed days are NOT lost - user can still claim all 20 drips, just takes longer
 *
 * Qualifying Actions (verified off-chain, submitted by backend):
 * - Visit the platform
 * - Create a post
 * - Make a trade
 * - Interact with agents
 */
contract TokenAirdrop is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =============================================================================
    // ERRORS
    // =============================================================================

    error ZeroAddress();
    error ZeroAmount();
    error AirdropNotStarted();
    error AirdropEnded();
    error NotEligible();
    error AlreadyRegistered();
    error NoTokensToClaim();
    error InvalidProof();
    error AlreadyClaimedToday();
    error NotAuthorizedDripper();
    error MaxDripsReached();

    // =============================================================================
    // EVENTS
    // =============================================================================

    event AirdropConfigured(bytes32 merkleRoot, uint256 startTime, uint256 totalTokens);

    event UserRegistered(address indexed user, uint256 totalAllocation, uint256 bonusMultiplier);

    event DripUnlocked(address indexed user, uint8 dripDay, uint256 amount, string action);

    event TokensClaimed(address indexed user, uint256 amount, uint256 totalClaimed);

    event AuthorizedDripperUpdated(address indexed dripper, bool authorized);

    // =============================================================================
    // CONSTANTS
    // =============================================================================

    /// @notice Total number of drip days (20 days = 5% each)
    uint8 public constant TOTAL_DRIP_DAYS = 20;

    /// @notice Drip percentage per day (5% = 500 basis points)
    uint16 public constant DRIP_PERCENT_BPS = 500;

    /// @notice Seconds per day
    uint256 public constant SECONDS_PER_DAY = 86400;

    // =============================================================================
    // TYPES
    // =============================================================================

    struct UserAllocation {
        /// @notice Total tokens allocated to user
        uint256 totalAllocation;
        /// @notice Bonus multiplier (1x = 100, 1.5x = 150, etc.)
        uint8 bonusMultiplier;
        /// @notice Number of drips unlocked (0-20)
        uint8 dripsUnlocked;
        /// @notice Total tokens claimed so far
        uint256 totalClaimed;
        /// @notice Timestamp of last drip unlock
        uint256 lastDripTime;
        /// @notice Whether user is registered
        bool registered;
    }

    // =============================================================================
    // STATE
    // =============================================================================

    /// @notice Token being airdropped
    IERC20 public immutable token;

    /// @notice Merkle root for initial eligibility verification
    bytes32 public merkleRoot;

    /// @notice Airdrop start time
    uint256 public startTime;

    /// @notice Airdrop end time (for unclaimed tokens recovery)
    uint256 public endTime;

    /// @notice Total tokens allocated for airdrop
    uint256 public totalTokens;

    /// @notice Total tokens distributed
    uint256 public totalDistributed;

    /// @notice User allocations
    mapping(address => UserAllocation) public allocations;

    /// @notice Authorized addresses that can unlock drips (backend service)
    mapping(address => bool) public authorizedDrippers;

    /// @notice Drip history per user (day => action type)
    mapping(address => mapping(uint8 => string)) public dripHistory;

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    /**
     * @param _token Token to airdrop
     * @param _owner Contract owner
     */
    constructor(IERC20 _token, address _owner) Ownable(_owner) {
        if (address(_token) == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        token = _token;
    }

    // =============================================================================
    // CONFIGURATION
    // =============================================================================

    /**
     * @notice Configure the airdrop
     * @param _merkleRoot Merkle root of eligible addresses and allocations
     * @param _startTime When airdrop starts
     * @param _endTime When unclaimed tokens can be recovered
     * @param _totalTokens Total tokens for airdrop
     */
    function configure(bytes32 _merkleRoot, uint256 _startTime, uint256 _endTime, uint256 _totalTokens)
        external
        onlyOwner
    {
        merkleRoot = _merkleRoot;
        startTime = _startTime;
        endTime = _endTime;
        totalTokens = _totalTokens;

        emit AirdropConfigured(_merkleRoot, _startTime, _totalTokens);
    }

    /**
     * @notice Set authorized dripper (backend service that verifies activity)
     */
    function setAuthorizedDripper(address dripper, bool authorized) external onlyOwner {
        if (dripper == address(0)) revert ZeroAddress();
        authorizedDrippers[dripper] = authorized;
        emit AuthorizedDripperUpdated(dripper, authorized);
    }

    // =============================================================================
    // REGISTRATION
    // =============================================================================

    /**
     * @notice Register for airdrop with Merkle proof
     * @param allocation Total token allocation
     * @param bonusMultiplier Bonus multiplier (100 = 1x, 150 = 1.5x for holders, etc.)
     * @param merkleProof Proof of eligibility
     */
    function register(uint256 allocation, uint8 bonusMultiplier, bytes32[] calldata merkleProof) external nonReentrant {
        if (block.timestamp < startTime) revert AirdropNotStarted();
        if (block.timestamp > endTime) revert AirdropEnded();
        if (allocations[msg.sender].registered) revert AlreadyRegistered();

        // Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, allocation, bonusMultiplier));
        if (!MerkleProof.verify(merkleProof, merkleRoot, leaf)) revert InvalidProof();

        // Calculate final allocation with bonus
        uint256 finalAllocation = (allocation * bonusMultiplier) / 100;

        allocations[msg.sender] = UserAllocation({
            totalAllocation: finalAllocation,
            bonusMultiplier: bonusMultiplier,
            dripsUnlocked: 0,
            totalClaimed: 0,
            lastDripTime: 0,
            registered: true
        });

        emit UserRegistered(msg.sender, finalAllocation, bonusMultiplier);
    }

    // =============================================================================
    // DRIP MECHANISM
    // =============================================================================

    /**
     * @notice Unlock daily drip for a user (called by authorized backend)
     * @param user Address to unlock drip for
     * @param action Type of action performed (visit, post, trade, etc.)
     */
    function unlockDrip(address user, string calldata action) external {
        if (!authorizedDrippers[msg.sender]) revert NotAuthorizedDripper();
        if (!allocations[user].registered) revert NotEligible();

        UserAllocation storage alloc = allocations[user];

        // Check if max drips reached
        if (alloc.dripsUnlocked >= TOTAL_DRIP_DAYS) revert MaxDripsReached();

        // Check if enough time has passed since last drip (24 hours)
        if (alloc.lastDripTime > 0 && block.timestamp < alloc.lastDripTime + SECONDS_PER_DAY) {
            revert AlreadyClaimedToday();
        }

        // Unlock the next drip
        uint8 dripDay = alloc.dripsUnlocked + 1;
        alloc.dripsUnlocked = dripDay;
        alloc.lastDripTime = block.timestamp;

        // Record the action
        dripHistory[user][dripDay] = action;

        // Calculate drip amount
        uint256 dripAmount = (alloc.totalAllocation * DRIP_PERCENT_BPS) / 10000;

        emit DripUnlocked(user, dripDay, dripAmount, action);
    }

    /**
     * @notice Batch unlock drips for multiple users
     */
    function unlockDripBatch(address[] calldata users, string[] calldata actions) external {
        if (!authorizedDrippers[msg.sender]) revert NotAuthorizedDripper();

        uint256 len = users.length;
        for (uint256 i = 0; i < len;) {
            address user = users[i];
            if (allocations[user].registered) {
                UserAllocation storage alloc = allocations[user];

                // Skip if max drips or too soon
                if (
                    alloc.dripsUnlocked < TOTAL_DRIP_DAYS
                        && (alloc.lastDripTime == 0 || block.timestamp >= alloc.lastDripTime + SECONDS_PER_DAY)
                ) {
                    uint8 dripDay = alloc.dripsUnlocked + 1;
                    alloc.dripsUnlocked = dripDay;
                    alloc.lastDripTime = block.timestamp;
                    dripHistory[user][dripDay] = actions[i];

                    uint256 dripAmount = (alloc.totalAllocation * DRIP_PERCENT_BPS) / 10000;
                    emit DripUnlocked(user, dripDay, dripAmount, actions[i]);
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    // =============================================================================
    // CLAIMING
    // =============================================================================

    /**
     * @notice Claim unlocked tokens
     */
    function claim() external nonReentrant {
        if (block.timestamp < startTime) revert AirdropNotStarted();

        UserAllocation storage alloc = allocations[msg.sender];
        if (!alloc.registered) revert NotEligible();

        uint256 claimable = _getClaimable(alloc);
        if (claimable == 0) revert NoTokensToClaim();

        alloc.totalClaimed += claimable;
        totalDistributed += claimable;

        token.safeTransfer(msg.sender, claimable);

        emit TokensClaimed(msg.sender, claimable, alloc.totalClaimed);
    }

    /**
     * @dev Calculate claimable amount based on unlocked drips
     */
    function _getClaimable(UserAllocation storage alloc) internal view returns (uint256) {
        // Calculate total unlocked based on drips
        uint256 totalUnlocked = (alloc.totalAllocation * alloc.dripsUnlocked * DRIP_PERCENT_BPS) / 10000;

        // Subtract already claimed
        if (totalUnlocked > alloc.totalClaimed) {
            return totalUnlocked - alloc.totalClaimed;
        }
        return 0;
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get user's airdrop status
     */
    function getUserStatus(address user)
        external
        view
        returns (
            bool registered,
            uint256 totalAllocation,
            uint8 bonusMultiplier,
            uint8 dripsUnlocked,
            uint256 totalClaimed,
            uint256 claimable,
            uint256 nextDripTime,
            uint256 percentUnlocked
        )
    {
        UserAllocation storage alloc = allocations[user];
        registered = alloc.registered;
        totalAllocation = alloc.totalAllocation;
        bonusMultiplier = alloc.bonusMultiplier;
        dripsUnlocked = alloc.dripsUnlocked;
        totalClaimed = alloc.totalClaimed;
        claimable = _getClaimable(alloc);

        if (alloc.dripsUnlocked < TOTAL_DRIP_DAYS) {
            if (alloc.lastDripTime == 0) {
                nextDripTime = block.timestamp; // Can drip now
            } else {
                nextDripTime = alloc.lastDripTime + SECONDS_PER_DAY;
            }
        } else {
            nextDripTime = 0; // All drips unlocked
        }

        percentUnlocked = (uint256(dripsUnlocked) * DRIP_PERCENT_BPS) / 100; // Returns as percentage (0-100)
    }

    /**
     * @notice Check if user can receive drip today
     */
    function canDripToday(address user) external view returns (bool) {
        UserAllocation storage alloc = allocations[user];
        if (!alloc.registered) return false;
        if (alloc.dripsUnlocked >= TOTAL_DRIP_DAYS) return false;
        if (alloc.lastDripTime == 0) return true;
        return block.timestamp >= alloc.lastDripTime + SECONDS_PER_DAY;
    }

    /**
     * @notice Get drip history for a user
     */
    function getDripHistory(address user) external view returns (string[] memory actions) {
        UserAllocation storage alloc = allocations[user];
        actions = new string[](alloc.dripsUnlocked);

        for (uint8 i = 1; i <= alloc.dripsUnlocked;) {
            actions[i - 1] = dripHistory[user][i];
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Get total airdrop stats
     */
    function getAirdropStats()
        external
        view
        returns (
            uint256 _totalTokens,
            uint256 _totalDistributed,
            uint256 remaining,
            bool isActive,
            uint256 timeUntilEnd
        )
    {
        _totalTokens = totalTokens;
        _totalDistributed = totalDistributed;
        remaining = totalTokens > totalDistributed ? totalTokens - totalDistributed : 0;
        isActive = block.timestamp >= startTime && block.timestamp <= endTime;
        timeUntilEnd = block.timestamp < endTime ? endTime - block.timestamp : 0;
    }

    // =============================================================================
    // ADMIN
    // =============================================================================

    /**
     * @notice Recover unclaimed tokens after airdrop ends
     */
    function recoverUnclaimed(address to) external onlyOwner {
        if (block.timestamp < endTime) revert AirdropNotStarted();
        if (to == address(0)) revert ZeroAddress();

        uint256 balance = token.balanceOf(address(this));
        if (balance > 0) {
            token.safeTransfer(to, balance);
        }
    }

    /**
     * @notice Update Merkle root (only before start)
     */
    function updateMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        if (block.timestamp >= startTime) revert AirdropNotStarted();
        merkleRoot = _merkleRoot;
    }

    /**
     * @notice Emergency pause - extend end time
     */
    function extendEndTime(uint256 newEndTime) external onlyOwner {
        require(newEndTime > endTime, "Invalid end time");
        endTime = newEndTime;
    }
}





