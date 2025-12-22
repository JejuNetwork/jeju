// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IUserBlockRegistry {
    function blockCount(address user) external view returns (uint256);
    function agentBlockCount(uint256 agentId) external view returns (uint256);
}

interface IModerationMarketplace {
    function openCase(address target, string calldata reason, bytes32 evidenceHash) external returns (bytes32);
}

/**
 * @title BlockingModerationBridge
 * @notice Monitors blocking patterns and auto-flags suspicious behavior
 * @dev When users exhibit excessive blocking patterns that may indicate:
 *      - Sybil attacks (many blocks in short time)
 *      - Harassment campaigns (coordinated blocking)
 *      - Abuse of the blocking system
 *
 * This contract can automatically open moderation cases for review.
 */
contract BlockingModerationBridge is Ownable {
    IUserBlockRegistry public blockRegistry;
    IModerationMarketplace public moderationMarketplace;

    // Thresholds for auto-flagging
    uint256 public excessiveBlockThreshold = 50;     // 50+ blocks triggers review
    uint256 public rapidBlockTimeWindow = 1 hours;   // Blocks within this window
    uint256 public rapidBlockThreshold = 10;         // 10+ blocks in window = suspicious

    // Tracking rapid blocking
    struct BlockingActivity {
        uint256 count;
        uint256 windowStart;
        bool flagged;
    }

    mapping(address => BlockingActivity) public addressActivity;
    mapping(uint256 => BlockingActivity) public agentActivity;

    // Flagged users pending review
    mapping(address => bool) public flaggedAddresses;
    mapping(uint256 => bool) public flaggedAgents;

    event ExcessiveBlockingDetected(address indexed user, uint256 blockCount);
    event RapidBlockingDetected(address indexed user, uint256 blockCount, uint256 timeWindow);
    event AgentExcessiveBlockingDetected(uint256 indexed agentId, uint256 blockCount);
    event ModerationCaseOpened(address indexed target, bytes32 indexed caseId);
    event ThresholdsUpdated(uint256 excessiveThreshold, uint256 rapidWindow, uint256 rapidThreshold);

    error AlreadyFlagged();
    error NotFlagged();
    error ModerationNotConfigured();

    constructor(
        address _blockRegistry,
        address _moderationMarketplace,
        address initialOwner
    ) Ownable(initialOwner) {
        blockRegistry = IUserBlockRegistry(_blockRegistry);
        moderationMarketplace = IModerationMarketplace(_moderationMarketplace);
    }

    /**
     * @notice Check and flag excessive blocking behavior
     * @param user Address to check
     */
    function checkAndFlag(address user) external {
        uint256 count = blockRegistry.blockCount(user);

        if (count >= excessiveBlockThreshold && !flaggedAddresses[user]) {
            flaggedAddresses[user] = true;
            emit ExcessiveBlockingDetected(user, count);

            // Auto-open moderation case if configured
            if (address(moderationMarketplace) != address(0)) {
                bytes32 caseId = moderationMarketplace.openCase(
                    user,
                    "Excessive blocking behavior detected",
                    keccak256(abi.encodePacked("blocks:", count))
                );
                emit ModerationCaseOpened(user, caseId);
            }
        }
    }

    /**
     * @notice Report a new block and track rapid blocking
     * @dev Called by UserBlockRegistry on each block action
     * @param blocker Address performing the block
     */
    function onBlock(address blocker) external {
        BlockingActivity storage activity = addressActivity[blocker];

        // Reset window if expired
        if (block.timestamp > activity.windowStart + rapidBlockTimeWindow) {
            activity.count = 0;
            activity.windowStart = block.timestamp;
        }

        activity.count++;

        // Check for rapid blocking pattern
        if (activity.count >= rapidBlockThreshold && !activity.flagged) {
            activity.flagged = true;
            flaggedAddresses[blocker] = true;

            emit RapidBlockingDetected(blocker, activity.count, rapidBlockTimeWindow);

            if (address(moderationMarketplace) != address(0)) {
                bytes32 caseId = moderationMarketplace.openCase(
                    blocker,
                    "Rapid blocking pattern - possible abuse",
                    keccak256(abi.encodePacked("rapid_blocks:", activity.count))
                );
                emit ModerationCaseOpened(blocker, caseId);
            }
        }
    }

    /**
     * @notice Check agent blocking behavior
     * @param agentId Agent ID to check
     */
    function checkAndFlagAgent(uint256 agentId) external {
        uint256 count = blockRegistry.agentBlockCount(agentId);

        if (count >= excessiveBlockThreshold && !flaggedAgents[agentId]) {
            flaggedAgents[agentId] = true;
            emit AgentExcessiveBlockingDetected(agentId, count);
        }
    }

    /**
     * @notice Clear flag after moderation review
     * @param user Address to clear
     */
    function clearFlag(address user) external onlyOwner {
        if (!flaggedAddresses[user]) revert NotFlagged();
        flaggedAddresses[user] = false;
        addressActivity[user].flagged = false;
    }

    /**
     * @notice Update thresholds
     */
    function setThresholds(
        uint256 _excessiveThreshold,
        uint256 _rapidWindow,
        uint256 _rapidThreshold
    ) external onlyOwner {
        excessiveBlockThreshold = _excessiveThreshold;
        rapidBlockTimeWindow = _rapidWindow;
        rapidBlockThreshold = _rapidThreshold;
        emit ThresholdsUpdated(_excessiveThreshold, _rapidWindow, _rapidThreshold);
    }

    function setBlockRegistry(address _registry) external onlyOwner {
        blockRegistry = IUserBlockRegistry(_registry);
    }

    function setModerationMarketplace(address _marketplace) external onlyOwner {
        moderationMarketplace = IModerationMarketplace(_marketplace);
    }
}

