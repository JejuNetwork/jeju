// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ReferralRegistry
 * @notice Tracks and rewards user referrals for protocol growth
 * @dev Rewards both referrer and referee on qualifying actions:
 *      - First stake
 *      - First swap
 *      - First bridge
 *      - Agent registration
 *
 * Reward structure:
 *      - Referrer: 5% of first action volume (capped)
 *      - Referee: 10% bonus on first action
 *      - Tier bonuses for prolific referrers
 */
contract ReferralRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public rewardToken;

    // Referral tracking
    struct ReferralInfo {
        address referrer;
        uint256 referredAt;
        bool hasStaked;
        bool hasSwapped;
        bool hasBridged;
        bool hasRegisteredAgent;
    }

    struct ReferrerStats {
        uint256 totalReferred;
        uint256 activeReferred;     // Completed qualifying action
        uint256 totalEarnings;
        uint256 tier;               // 0-3 based on performance
    }

    mapping(address => ReferralInfo) public referrals;
    mapping(address => ReferrerStats) public referrerStats;
    mapping(address => address[]) public referrerList; // All users referred by address
    mapping(bytes32 => bool) public usedCodes;
    mapping(address => bytes32) public referralCodes;

    // Reward configuration (bps)
    uint256 public referrerRewardBps = 500;      // 5% to referrer
    uint256 public refereeRewardBps = 1000;      // 10% bonus to referee
    uint256 public constant BPS = 10000;

    // Tier thresholds
    uint256[4] public tierThresholds = [0, 10, 50, 100];
    uint256[4] public tierBonusBps = [0, 100, 250, 500]; // Tier bonuses

    // Max rewards per action
    uint256 public maxReferrerReward = 1000 * 1e18;
    uint256 public maxRefereeReward = 500 * 1e18;

    // Authorized callers that can report actions
    mapping(address => bool) public authorizedCallers;

    // Referral code to referrer lookup
    mapping(bytes32 => address) public codeToReferrer;

    // Total stats
    uint256 public totalReferrals;
    uint256 public totalRewardsDistributed;

    event ReferralRegistered(address indexed referee, address indexed referrer, bytes32 code);
    event ReferralCodeCreated(address indexed referrer, bytes32 code);
    event ActionCompleted(address indexed user, string actionType, uint256 referrerReward, uint256 refereeReward);
    event TierUpgrade(address indexed referrer, uint256 oldTier, uint256 newTier);
    event RewardsClaimed(address indexed user, uint256 amount);

    error AlreadyReferred();
    error InvalidReferrer();
    error SelfReferral();
    error UnauthorizedCaller();
    error InvalidCode();
    error CodeAlreadyUsed();

    constructor(address _rewardToken, address initialOwner) Ownable(initialOwner) {
        rewardToken = IERC20(_rewardToken);
    }

    /**
     * @notice Generate a referral code for an address
     * @param referrer Address to generate code for
     */
    function createReferralCode(address referrer) external returns (bytes32 code) {
        code = keccak256(abi.encodePacked(referrer, block.timestamp, block.prevrandao));
        referralCodes[referrer] = code;
        codeToReferrer[code] = referrer;
        emit ReferralCodeCreated(referrer, code);
    }

    /**
     * @notice Register as referred using a referral code
     * @param code Referral code to use
     */
    function registerWithCode(bytes32 code) external {
        if (referrals[msg.sender].referrer != address(0)) revert AlreadyReferred();
        if (code == bytes32(0)) revert InvalidCode();

        address referrer = codeToReferrer[code];
        if (referrer == address(0)) revert InvalidCode();
        if (referrer == msg.sender) revert SelfReferral();

        _registerReferral(msg.sender, referrer);
    }

    /**
     * @notice Register as referred by a specific address
     * @param referrer Address that referred you
     */
    function registerReferral(address referrer) external {
        if (referrals[msg.sender].referrer != address(0)) revert AlreadyReferred();
        if (referrer == address(0)) revert InvalidReferrer();
        if (referrer == msg.sender) revert SelfReferral();

        _registerReferral(msg.sender, referrer);
    }

    function _registerReferral(address referee, address referrer) internal {
        referrals[referee] = ReferralInfo({
            referrer: referrer,
            referredAt: block.timestamp,
            hasStaked: false,
            hasSwapped: false,
            hasBridged: false,
            hasRegisteredAgent: false
        });

        referrerStats[referrer].totalReferred++;
        referrerList[referrer].push(referee);
        totalReferrals++;

        emit ReferralRegistered(referee, referrer, referralCodes[referrer]);
    }

    /**
     * @notice Report a qualifying action (called by authorized contracts)
     * @param user User who performed action
     * @param actionType Type of action
     * @param volume Volume of the action in reward token terms
     */
    function reportAction(
        address user,
        string calldata actionType,
        uint256 volume
    ) external nonReentrant {
        if (!authorizedCallers[msg.sender]) revert UnauthorizedCaller();

        ReferralInfo storage info = referrals[user];
        if (info.referrer == address(0)) return; // Not referred

        bool isFirstAction = false;
        bytes32 actionHash = keccak256(bytes(actionType));

        if (actionHash == keccak256("stake") && !info.hasStaked) {
            info.hasStaked = true;
            isFirstAction = true;
        } else if (actionHash == keccak256("swap") && !info.hasSwapped) {
            info.hasSwapped = true;
            isFirstAction = true;
        } else if (actionHash == keccak256("bridge") && !info.hasBridged) {
            info.hasBridged = true;
            isFirstAction = true;
        } else if (actionHash == keccak256("agent") && !info.hasRegisteredAgent) {
            info.hasRegisteredAgent = true;
            isFirstAction = true;
        }

        if (!isFirstAction) return;

        // Calculate rewards
        ReferrerStats storage stats = referrerStats[info.referrer];
        if (stats.activeReferred == 0) {
            stats.activeReferred = 1;
        } else {
            stats.activeReferred++;
        }

        // Update tier
        uint256 oldTier = stats.tier;
        for (uint256 i = 3; i > 0; i--) {
            if (stats.activeReferred >= tierThresholds[i]) {
                stats.tier = i;
                break;
            }
        }
        if (stats.tier != oldTier) {
            emit TierUpgrade(info.referrer, oldTier, stats.tier);
        }

        // Calculate referrer reward with tier bonus
        uint256 referrerReward = (volume * referrerRewardBps) / BPS;
        uint256 tierBonus = (referrerReward * tierBonusBps[stats.tier]) / BPS;
        referrerReward += tierBonus;
        if (referrerReward > maxReferrerReward) referrerReward = maxReferrerReward;

        // Calculate referee reward
        uint256 refereeReward = (volume * refereeRewardBps) / BPS;
        if (refereeReward > maxRefereeReward) refereeReward = maxRefereeReward;

        // Distribute rewards if we have balance
        uint256 balance = rewardToken.balanceOf(address(this));
        uint256 totalReward = referrerReward + refereeReward;

        if (balance >= totalReward) {
            if (referrerReward > 0) {
                rewardToken.safeTransfer(info.referrer, referrerReward);
                stats.totalEarnings += referrerReward;
            }
            if (refereeReward > 0) {
                rewardToken.safeTransfer(user, refereeReward);
            }
            totalRewardsDistributed += totalReward;

            emit ActionCompleted(user, actionType, referrerReward, refereeReward);
        }
    }

    // ============ View Functions ============

    function getReferralInfo(address user) external view returns (ReferralInfo memory) {
        return referrals[user];
    }

    function getReferrerStats(address referrer) external view returns (ReferrerStats memory) {
        return referrerStats[referrer];
    }

    function getReferredUsers(address referrer) external view returns (address[] memory) {
        return referrerList[referrer];
    }

    function getReferredCount(address referrer) external view returns (uint256) {
        return referrerList[referrer].length;
    }

    // ============ Admin ============

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setRewardToken(address _token) external onlyOwner {
        rewardToken = IERC20(_token);
    }

    function setRewardRates(uint256 _referrerBps, uint256 _refereeBps) external onlyOwner {
        referrerRewardBps = _referrerBps;
        refereeRewardBps = _refereeBps;
    }

    function setMaxRewards(uint256 _maxReferrer, uint256 _maxReferee) external onlyOwner {
        maxReferrerReward = _maxReferrer;
        maxRefereeReward = _maxReferee;
    }

    function setTierThresholds(uint256[4] calldata thresholds, uint256[4] calldata bonuses) external onlyOwner {
        tierThresholds = thresholds;
        tierBonusBps = bonuses;
    }

    function withdrawTokens(address to, uint256 amount) external onlyOwner {
        rewardToken.safeTransfer(to, amount);
    }
}

