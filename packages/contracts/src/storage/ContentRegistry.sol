// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IContentRegistry} from "./IContentRegistry.sol";

/**
 * @title ContentRegistry
 * @author Jeju Network
 * @notice Unified content registry with moderation, seeding rewards, and blocklist
 * @dev Combines content tracking, moderation, and incentives in one gas-efficient contract
 *
 * Key features:
 * - Content registration with automatic infohash mapping
 * - Tiered storage with different reward rates
 * - Seeding rewards for P2P distribution
 * - Integration with ModerationMarketplace for disputes
 * - Global blocklist for banned content
 */
contract ContentRegistry is IContentRegistry, ReentrancyGuard, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    uint256 private constant BPS = 10000;
    uint128 private constant MIN_REWARD_POOL = 0.001 ether;

    // ============ State ============

    /// @notice Moderation marketplace for dispute resolution
    address public moderationMarketplace;

    /// @notice Oracle/coordinator that signs seeding reports
    address public seedingOracle;

    /// @notice Treasury for platform fees
    address public treasury;

    /// @notice Content records by content hash
    mapping(bytes32 => ContentRecord) private _content;

    /// @notice Infohash to content hash mapping
    mapping(bytes32 => bytes32) public infohashToContent;

    /// @notice Seeder statistics
    mapping(address => SeederStats) private _seeders;

    /// @notice Active seeders per infohash
    mapping(bytes32 => mapping(address => bool)) public isSeeding;

    /// @notice Blocklist array for sync
    bytes32[] private _blocklist;

    /// @notice Blocklist lookup
    mapping(bytes32 => bool) public blocked;

    /// @notice Reward rates per tier (wei per GB)
    mapping(ContentTier => uint128) public rewardRates;

    /// @notice User violation counts
    mapping(address => uint32) public violationCount;

    // ============ Constructor ============

    constructor(address initialOwner) Ownable(initialOwner) {
        // Default reward rates (wei per GB served)
        rewardRates[ContentTier.NETWORK_FREE] = 0;
        rewardRates[ContentTier.COMMUNITY] = 0.0001 ether;
        rewardRates[ContentTier.STANDARD] = 0.0005 ether;
        rewardRates[ContentTier.PRIVATE_ENCRYPTED] = 0.001 ether;
        rewardRates[ContentTier.PREMIUM_HOT] = 0.002 ether;
    }

    // ============ Content Registration ============

    /**
     * @notice Register new content for distribution
     * @param contentHash SHA256 hash of the content
     * @param infohash BitTorrent infohash for P2P distribution
     * @param size Content size in bytes
     * @param tier Storage tier determining reward rate
     * @return status The content status after registration
     */
    function registerContent(bytes32 contentHash, bytes32 infohash, uint64 size, ContentTier tier)
        external
        payable
        returns (ContentStatus)
    {
        require(_content[contentHash].uploadedAt == 0, "Already registered");
        require(size > 0, "Invalid size");
        require(!blocked[contentHash], "Content banned");

        // Calculate minimum reward pool based on tier
        uint128 minPool = _calculateMinPool(size, tier);
        require(msg.value >= minPool || tier == ContentTier.NETWORK_FREE, "Insufficient reward pool");

        _content[contentHash] = ContentRecord({
            contentHash: contentHash,
            status: ContentStatus.APPROVED,
            violationType: ViolationType.NONE,
            tier: tier,
            uploader: msg.sender,
            uploadedAt: uint64(block.timestamp),
            size: size,
            seedCount: 0,
            rewardPool: uint128(msg.value)
        });

        infohashToContent[infohash] = contentHash;

        emit ContentRegistered(contentHash, infohash, msg.sender, tier, size);

        return ContentStatus.APPROVED;
    }

    /**
     * @notice Flag content for moderation review
     * @param contentHash Content to flag
     * @param violationType Type of violation
     * @param evidenceHash Hash of evidence (stored off-chain)
     * @return caseId Moderation case ID
     */
    function flagContent(bytes32 contentHash, ViolationType violationType, bytes32 evidenceHash)
        external
        returns (bytes32 caseId)
    {
        ContentRecord storage record = _content[contentHash];
        require(record.uploadedAt > 0, "Content not found");
        require(record.status != ContentStatus.BANNED, "Already banned");

        record.status = ContentStatus.FLAGGED;
        record.violationType = violationType;

        // CSAM is auto-banned, no appeals
        if (violationType == ViolationType.CSAM) {
            _banContentInternal(contentHash);
            violationCount[record.uploader]++;
            return bytes32(0);
        }

        // Open case in moderation marketplace if configured
        if (moderationMarketplace != address(0)) {
            // Call moderation marketplace to open case
            (bool success, bytes memory data) = moderationMarketplace.call(
                abi.encodeWithSignature(
                    "openCase(address,string,bytes32)", record.uploader, "Content violation", evidenceHash
                )
            );
            require(success, "Failed to open case");
            caseId = abi.decode(data, (bytes32));
        }

        emit ContentFlagged(contentHash, violationType, msg.sender);
        return caseId;
    }

    /**
     * @notice Ban content (only owner or moderation marketplace)
     */
    function banContent(bytes32 contentHash) external {
        require(msg.sender == owner() || msg.sender == moderationMarketplace, "Unauthorized");
        _banContentInternal(contentHash);
    }

    /**
     * @notice Clear flagged content (only owner or moderation marketplace)
     */
    function clearContent(bytes32 contentHash) external {
        require(msg.sender == owner() || msg.sender == moderationMarketplace, "Unauthorized");
        ContentRecord storage record = _content[contentHash];
        require(record.status == ContentStatus.FLAGGED, "Not flagged");

        record.status = ContentStatus.APPROVED;
        record.violationType = ViolationType.NONE;

        emit ContentCleared(contentHash);
    }

    // ============ Seeding Functions ============

    /**
     * @notice Start seeding content
     * @param infohash BitTorrent infohash
     */
    function startSeeding(bytes32 infohash) external {
        bytes32 contentHash = infohashToContent[infohash];
        require(contentHash != bytes32(0), "Content not registered");
        require(!blocked[contentHash], "Content banned");
        require(!isSeeding[infohash][msg.sender], "Already seeding");

        isSeeding[infohash][msg.sender] = true;
        _content[contentHash].seedCount++;
        _seeders[msg.sender].activeTorrents++;

        emit SeedingStarted(infohash, msg.sender);
    }

    /**
     * @notice Stop seeding content
     * @param infohash BitTorrent infohash
     */
    function stopSeeding(bytes32 infohash) external {
        require(isSeeding[infohash][msg.sender], "Not seeding");

        bytes32 contentHash = infohashToContent[infohash];
        isSeeding[infohash][msg.sender] = false;

        if (_content[contentHash].seedCount > 0) {
            _content[contentHash].seedCount--;
        }
        if (_seeders[msg.sender].activeTorrents > 0) {
            _seeders[msg.sender].activeTorrents--;
        }

        emit SeedingStopped(infohash, msg.sender);
    }

    /**
     * @notice Report seeding activity and earn rewards
     * @param infohash BitTorrent infohash
     * @param bytesServed Bytes served to peers
     * @param signature Oracle signature validating the report
     */
    function reportSeeding(bytes32 infohash, uint128 bytesServed, bytes calldata signature) external nonReentrant {
        require(isSeeding[infohash][msg.sender], "Not seeding this content");

        bytes32 contentHash = infohashToContent[infohash];
        ContentRecord storage record = _content[contentHash];
        require(record.status == ContentStatus.APPROVED, "Content not approved");

        // Verify oracle signature
        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, infohash, bytesServed, block.timestamp / 3600));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);
        require(signer == seedingOracle, "Invalid signature");

        // Calculate reward
        uint128 reward = _calculateReward(bytesServed, record.tier);

        // Cap at available pool
        if (reward > record.rewardPool) {
            reward = record.rewardPool;
        }

        if (reward > 0) {
            record.rewardPool -= reward;
            _seeders[msg.sender].pendingRewards += reward;
            _seeders[msg.sender].totalBytesServed += bytesServed;
        }

        _seeders[msg.sender].lastReportTime = uint64(block.timestamp);

        emit SeedingReported(infohash, msg.sender, bytesServed);
    }

    /**
     * @notice Claim accumulated seeding rewards
     */
    function claimRewards() external nonReentrant {
        uint128 amount = _seeders[msg.sender].pendingRewards;
        require(amount > 0, "No rewards");

        _seeders[msg.sender].pendingRewards = 0;

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit RewardsClaimed(msg.sender, amount);
    }

    // ============ View Functions ============

    function canServe(bytes32 contentHash) external view returns (bool) {
        if (blocked[contentHash]) return false;
        ContentRecord storage record = _content[contentHash];
        return record.status == ContentStatus.APPROVED || record.uploadedAt == 0;
    }

    function getContent(bytes32 contentHash) external view returns (ContentRecord memory) {
        return _content[contentHash];
    }

    function isBlocked(bytes32 contentHash) external view returns (bool) {
        return blocked[contentHash];
    }

    function getSeederStats(address seeder) external view returns (SeederStats memory) {
        return _seeders[seeder];
    }

    function getRewardRate(ContentTier tier) external view returns (uint128) {
        return rewardRates[tier];
    }

    function getBlocklistLength() external view returns (uint256) {
        return _blocklist.length;
    }

    function getBlocklistBatch(uint256 offset, uint256 limit) external view returns (bytes32[] memory) {
        uint256 len = _blocklist.length;
        if (offset >= len) return new bytes32[](0);

        uint256 end = offset + limit;
        if (end > len) end = len;

        bytes32[] memory batch = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            batch[i - offset] = _blocklist[i];
        }
        return batch;
    }

    // ============ Admin Functions ============

    function setModerationMarketplace(address _marketplace) external onlyOwner {
        moderationMarketplace = _marketplace;
    }

    function setSeedingOracle(address _oracle) external onlyOwner {
        seedingOracle = _oracle;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setRewardRate(ContentTier tier, uint128 rate) external onlyOwner {
        rewardRates[tier] = rate;
    }

    /**
     * @notice Add content to blocklist directly (emergency)
     */
    function addToBlocklist(bytes32 contentHash) external onlyOwner {
        _banContentInternal(contentHash);
    }

    /**
     * @notice Top up reward pool for content
     */
    function topUpRewardPool(bytes32 contentHash) external payable {
        require(_content[contentHash].uploadedAt > 0, "Content not found");
        _content[contentHash].rewardPool += uint128(msg.value);
    }

    // ============ Internal Functions ============

    function _banContentInternal(bytes32 contentHash) internal {
        ContentRecord storage record = _content[contentHash];

        if (!blocked[contentHash]) {
            blocked[contentHash] = true;
            _blocklist.push(contentHash);
        }

        if (record.uploadedAt > 0) {
            record.status = ContentStatus.BANNED;

            // Refund remaining reward pool to treasury
            if (record.rewardPool > 0 && treasury != address(0)) {
                uint128 refund = record.rewardPool;
                record.rewardPool = 0;
                (bool success,) = treasury.call{value: refund}("");
                require(success, "Treasury refund failed");
            }
        }

        emit ContentBanned(contentHash, record.violationType);
    }

    function _calculateMinPool(uint64 size, ContentTier tier) internal view returns (uint128) {
        if (tier == ContentTier.NETWORK_FREE) return 0;

        // Require enough for ~50 full downloads
        uint128 gbSize = uint128(size) / (1024 * 1024 * 1024);
        if (gbSize == 0) gbSize = 1;

        return gbSize * rewardRates[tier] * 50;
    }

    function _calculateReward(uint128 bytesServed, ContentTier tier) internal view returns (uint128) {
        uint128 gbServed = bytesServed / (1024 * 1024 * 1024);
        if (gbServed == 0 && bytesServed > 0) {
            // Pro-rate for sub-GB transfers
            return (bytesServed * rewardRates[tier]) / (1024 * 1024 * 1024);
        }
        return gbServed * rewardRates[tier];
    }

    // ============ Receive ============

    receive() external payable {}
}
