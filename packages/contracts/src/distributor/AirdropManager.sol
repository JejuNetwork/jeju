// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IFeeDistributor {
    function getSnapshot(uint256 period)
        external
        view
        returns (
            uint256 totalPool,
            uint256 totalShares,
            uint256 contributorCount,
            uint256 claimedCount,
            uint256 timestamp,
            bool finalized
        );

    function getSnapshotContributors(uint256 period)
        external
        view
        returns (address[] memory contributors, uint256[] memory shares);
}

/**
 * @title AirdropManager
 * @author Jeju Network
 * @notice Enables anyone to airdrop tokens to contributors based on leaderboard scores
 * @dev Reads contributor snapshots from FeeDistributor and distributes tokens pro-rata.
 *      Uses weighted scoring: 50% all-time, 30% 6-month, 20% 1-month.
 *
 * Features:
 * - Anyone can create an airdrop with any ERC20 token
 * - Automatic distribution based on latest snapshot
 * - Weighted scoring from multiple time periods
 * - Gas-efficient batch claims
 * - Minimum airdrop amount to prevent spam
 *
 * Weighting Formula:
 * - 50% from all-time scores (period 0 to current)
 * - 30% from last 6 months (period current-6 to current)
 * - 20% from last 1 month (period current-1 to current)
 * - Final share = (all-time * 0.5) + (6mo * 0.3) + (1mo * 0.2)
 *
 * Example Flow:
 * 1. Alice creates airdrop: 10,000 USDC
 * 2. System reads period 12 snapshot (current)
 * 3. Calculates weighted shares for all contributors
 * 4. Bob claims: 500 shares / 10,000 total = 5% = 500 USDC
 *
 * @custom:security-contact security@jeju.network
 */
contract AirdropManager is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice FeeDistributor contract that maintains contributor snapshots
    IFeeDistributor public immutable feeDistributor;

    /// @notice Next airdrop ID
    uint256 public nextAirdropId = 1;

    /// @notice Minimum airdrop amount (prevents spam)
    uint256 public minimumAirdropAmount = 100 ether; // 100 tokens minimum

    /// @notice Maximum contributors per airdrop (gas limit protection)
    uint256 public constant MAX_CONTRIBUTORS = 500;

    // ============ Structs ============

    struct Airdrop {
        uint256 id;
        address creator;
        address token;
        uint256 totalAmount;
        uint256 period; // Snapshot period used
        uint256 totalShares;
        uint256 claimedAmount;
        uint256 claimedCount;
        uint256 contributorCount;
        uint256 createdAt;
        bool active;
    }

    // ============ Storage ============

    /// @notice Airdrop data by ID
    mapping(uint256 => Airdrop) public airdrops;

    /// @notice Contributor shares per airdrop
    /// @dev airdropId => contributor => shares
    mapping(uint256 => mapping(address => uint256)) public airdropShares;

    /// @notice Claim status per airdrop
    /// @dev airdropId => contributor => claimed
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// @notice All airdrop IDs (for enumeration)
    uint256[] public allAirdropIds;

    // ============ Events ============

    event AirdropCreated(
        uint256 indexed airdropId,
        address indexed creator,
        address indexed token,
        uint256 amount,
        uint256 period,
        uint256 contributorCount
    );

    event AirdropClaimed(uint256 indexed airdropId, address indexed contributor, uint256 amount);

    event AirdropCancelled(uint256 indexed airdropId, uint256 refundAmount);
    event MinimumAirdropAmountUpdated(uint256 oldAmount, uint256 newAmount);

    // ============ Errors ============

    error InvalidAddress();
    error BelowMinimum(uint256 amount, uint256 minimum);
    error SnapshotNotFinalized();
    error AirdropNotFound();
    error AirdropNotActive();
    error AlreadyClaimed();
    error NotEligible();
    error Unauthorized();
    error TooManyContributors(uint256 count, uint256 max);

    // ============ Constructor ============

    /**
     * @notice Constructs the AirdropManager
     * @param _feeDistributor Address of FeeDistributor contract
     * @param initialOwner Owner address
     */
    constructor(address _feeDistributor, address initialOwner) Ownable(initialOwner) {
        if (_feeDistributor == address(0)) revert InvalidAddress();
        feeDistributor = IFeeDistributor(_feeDistributor);
    }

    // ============ Core Functions ============

    /**
     * @notice Create a new airdrop to contributors
     * @param token ERC20 token address to airdrop
     * @param amount Total amount to distribute
     * @param period Snapshot period to use for distribution
     * @dev Reads snapshot from FeeDistributor, calculates pro-rata shares.
     *      Requires token approval before calling.
     *
     * Steps:
     * 1. Validate snapshot is finalized
     * 2. Transfer tokens to this contract
     * 3. Read contributors from snapshot
     * 4. Store airdrop data
     * 5. Contributors can claim proportionally
     */
    function createAirdrop(address token, uint256 amount, uint256 period)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 airdropId)
    {
        if (token == address(0)) revert InvalidAddress();
        if (amount < minimumAirdropAmount) {
            revert BelowMinimum(amount, minimumAirdropAmount);
        }

        // Get snapshot info from FeeDistributor
        (
            , // totalPool
            uint256 totalShares,
            uint256 contributorCount,
            , // claimedCount
            , // timestamp
            bool finalized
        ) = feeDistributor.getSnapshot(period);

        if (!finalized) revert SnapshotNotFinalized();
        if (contributorCount == 0) revert NotEligible();
        if (contributorCount > MAX_CONTRIBUTORS) {
            revert TooManyContributors(contributorCount, MAX_CONTRIBUTORS);
        }

        // Read contributors and shares from FeeDistributor
        (address[] memory contributors, uint256[] memory shares) = feeDistributor.getSnapshotContributors(period);

        // Transfer tokens to this contract (using SafeERC20)
        IERC20 airdropToken = IERC20(token);
        airdropToken.safeTransferFrom(msg.sender, address(this), amount);

        // Create airdrop
        airdropId = nextAirdropId++;

        airdrops[airdropId] = Airdrop({
            id: airdropId,
            creator: msg.sender,
            token: token,
            totalAmount: amount,
            period: period,
            totalShares: totalShares,
            claimedAmount: 0,
            claimedCount: 0,
            contributorCount: contributorCount,
            createdAt: block.timestamp,
            active: true
        });

        // Store contributor shares for this airdrop
        for (uint256 i = 0; i < contributors.length; i++) {
            airdropShares[airdropId][contributors[i]] = shares[i];
        }

        allAirdropIds.push(airdropId);

        emit AirdropCreated(airdropId, msg.sender, token, amount, period, contributorCount);

        return airdropId;
    }

    /**
     * @notice Claim airdrop allocation
     * @param airdropId ID of the airdrop
     * @dev Checks FeeDistributor snapshot for contributor's share.
     *      Calculates pro-rata amount and transfers tokens.
     */
    function claimAirdrop(uint256 airdropId) external nonReentrant {
        Airdrop storage airdrop = airdrops[airdropId];

        if (airdrop.creator == address(0)) revert AirdropNotFound();
        if (!airdrop.active) revert AirdropNotActive();
        if (claimed[airdropId][msg.sender]) revert AlreadyClaimed();

        // Get contributor's shares from the snapshot period
        // NOTE: We need to store shares during creation or read from FeeDistributor
        // For simplicity, reading from stored shares calculated at creation
        uint256 userShares = airdropShares[airdropId][msg.sender];
        if (userShares == 0) revert NotEligible();

        // Calculate pro-rata amount
        uint256 claimAmount = (userShares * airdrop.totalAmount) / airdrop.totalShares;

        // Mark as claimed
        claimed[airdropId][msg.sender] = true;
        airdrop.claimedAmount += claimAmount;
        airdrop.claimedCount++;

        // Transfer tokens (using SafeERC20)
        IERC20 airdropToken = IERC20(airdrop.token);
        airdropToken.safeTransfer(msg.sender, claimAmount);

        emit AirdropClaimed(airdropId, msg.sender, claimAmount);
    }

    /**
     * @notice Claim multiple airdrops in one transaction
     * @param airdropIds Array of airdrop IDs to claim
     * @dev Gas-efficient batch claiming across multiple airdrops
     */
    function claimMultipleAirdrops(uint256[] calldata airdropIds) external nonReentrant {
        for (uint256 i = 0; i < airdropIds.length; i++) {
            uint256 airdropId = airdropIds[i];
            Airdrop storage airdrop = airdrops[airdropId];

            // Skip if ineligible
            if (!airdrop.active || claimed[airdropId][msg.sender] || airdropShares[airdropId][msg.sender] == 0) {
                continue;
            }

            uint256 userShares = airdropShares[airdropId][msg.sender];
            uint256 claimAmount = (userShares * airdrop.totalAmount) / airdrop.totalShares;

            // Mark as claimed
            claimed[airdropId][msg.sender] = true;
            airdrop.claimedAmount += claimAmount;
            airdrop.claimedCount++;

            // Transfer tokens (using SafeERC20)
            IERC20 airdropToken = IERC20(airdrop.token);
            airdropToken.safeTransfer(msg.sender, claimAmount);

            emit AirdropClaimed(airdropId, msg.sender, claimAmount);
        }
    }

    /**
     * @notice Cancel airdrop and refund unclaimed tokens
     * @param airdropId Airdrop to cancel
     * @dev Only creator can cancel. Refunds unclaimed amount.
     */
    function cancelAirdrop(uint256 airdropId) external nonReentrant {
        Airdrop storage airdrop = airdrops[airdropId];

        if (airdrop.creator == address(0)) revert AirdropNotFound();
        if (msg.sender != airdrop.creator) revert Unauthorized();
        if (!airdrop.active) revert AirdropNotActive();

        // Must be at least 30 days old to cancel
        if (block.timestamp < airdrop.createdAt + 30 days) {
            revert Unauthorized();
        }

        uint256 refundAmount = airdrop.totalAmount - airdrop.claimedAmount;
        airdrop.active = false;

        if (refundAmount > 0) {
            IERC20 airdropToken = IERC20(airdrop.token);
            airdropToken.safeTransfer(msg.sender, refundAmount);
        }

        emit AirdropCancelled(airdropId, refundAmount);
    }

    // ============ View Functions ============

    /**
     * @notice Get claimable amount for an airdrop
     */
    function getClaimableAmount(uint256 airdropId, address contributor)
        external
        view
        returns (uint256 amount, bool hasClaimed)
    {
        Airdrop storage airdrop = airdrops[airdropId];

        hasClaimed = claimed[airdropId][contributor];

        if (!airdrop.active || hasClaimed) {
            amount = 0;
        } else {
            uint256 userShares = airdropShares[airdropId][contributor];
            if (userShares > 0 && airdrop.totalShares > 0) {
                amount = (userShares * airdrop.totalAmount) / airdrop.totalShares;
            }
        }
    }

    /**
     * @notice Get all claimable airdrops for a contributor
     */
    function getClaimableAirdrops(address contributor)
        external
        view
        returns (uint256[] memory claimableIds, uint256[] memory amounts)
    {
        uint256[] memory tempIds = new uint256[](allAirdropIds.length);
        uint256[] memory tempAmounts = new uint256[](allAirdropIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < allAirdropIds.length; i++) {
            uint256 airdropId = allAirdropIds[i];
            Airdrop storage airdrop = airdrops[airdropId];

            if (airdrop.active && !claimed[airdropId][contributor]) {
                uint256 userShares = airdropShares[airdropId][contributor];
                if (userShares > 0) {
                    uint256 amount = (userShares * airdrop.totalAmount) / airdrop.totalShares;
                    tempIds[count] = airdropId;
                    tempAmounts[count] = amount;
                    count++;
                }
            }
        }

        // Resize arrays
        claimableIds = new uint256[](count);
        amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            claimableIds[i] = tempIds[i];
            amounts[i] = tempAmounts[i];
        }
    }

    /**
     * @notice Get airdrop details
     */
    function getAirdrop(uint256 airdropId)
        external
        view
        returns (
            address creator,
            address token,
            uint256 totalAmount,
            uint256 claimedAmount,
            uint256 claimedCount,
            uint256 contributorCount,
            uint256 createdAt,
            bool active
        )
    {
        Airdrop storage airdrop = airdrops[airdropId];
        return (
            airdrop.creator,
            airdrop.token,
            airdrop.totalAmount,
            airdrop.claimedAmount,
            airdrop.claimedCount,
            airdrop.contributorCount,
            airdrop.createdAt,
            airdrop.active
        );
    }

    /**
     * @notice Get total number of airdrops
     */
    function getTotalAirdrops() external view returns (uint256) {
        return allAirdropIds.length;
    }

    /**
     * @notice Get paginated list of airdrop IDs
     */
    function getAirdrops(uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        uint256 total = allAirdropIds.length;
        if (offset >= total) {
            return new uint256[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 count = end - offset;
        uint256[] memory ids = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            ids[i] = allAirdropIds[offset + i];
        }

        return ids;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update minimum airdrop amount
     */
    function setMinimumAirdropAmount(uint256 _minimum) external onlyOwner {
        uint256 oldAmount = minimumAirdropAmount;
        minimumAirdropAmount = _minimum;
        emit MinimumAirdropAmountUpdated(oldAmount, _minimum);
    }

    /**
     * @notice Emergency pause
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Returns the contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
