// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title StorageProofs
 * @author Jeju Network
 * @notice On-chain storage proof verification and challenge system
 * @dev Implements challenge-response protocol for verifying storage node data availability
 *
 * Proof Types:
 * - Access (0): Prove content is accessible and can be retrieved
 * - Replication (1): Prove content is stored across multiple nodes
 * - Spacetime (2): Prove content has been stored over a time period
 * - Merkle (3): Prove specific chunk inclusion via merkle proof
 */
contract StorageProofs is ReentrancyGuard, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Enums ============

    enum ProofType {
        Access,
        Replication,
        Spacetime,
        Merkle
    }

    enum ChallengeStatus {
        Pending,
        Completed,
        Failed,
        Expired
    }

    // ============ Structs ============

    struct Challenge {
        bytes32 challengeId;
        string cid;
        address challenger;
        address targetNode;
        ProofType proofType;
        uint256 deadline;
        uint256 reward;
        uint256 slashAmount;
        ChallengeStatus status;
        bytes challengeData;
    }

    struct Proof {
        bytes32 proofId;
        bytes32 challengeId;
        address prover;
        uint256 timestamp;
        bytes proofData;
        bytes signature;
        bool verified;
    }

    struct NodeStats {
        uint256 totalChallenges;
        uint256 passedChallenges;
        uint256 failedChallenges;
        uint256 totalSlashed;
        uint256 totalRewards;
        uint256 lastChallengeTime;
        bool isRegistered;
        uint256 stake;
    }

    // ============ State ============

    mapping(bytes32 => Challenge) public challenges;
    mapping(bytes32 => Proof) public proofs;
    mapping(address => NodeStats) public nodeStats;
    mapping(bytes32 => bool) public usedChallengeIds;

    bytes32[] public activeChallenges;
    mapping(bytes32 => uint256) private challengeIndex;

    uint256 public challengeWindow = 5 minutes;
    uint256 public minChallengeReward = 0.001 ether;
    uint256 public minSlashAmount = 0.01 ether;
    uint256 public minNodeStake = 0.1 ether;
    uint256 public verifierQuorum = 3;

    uint256 public totalChallenges;
    uint256 public totalProofs;
    uint256 public totalSlashed;
    uint256 public totalRewards;

    // ============ Events ============

    event NodeRegistered(address indexed node, uint256 stake);
    event NodeSlashed(address indexed node, uint256 amount, bytes32 indexed challengeId);
    event StakeWithdrawn(address indexed node, uint256 amount);

    event ChallengeCreated(
        bytes32 indexed challengeId,
        string cid,
        address indexed challenger,
        address indexed targetNode,
        ProofType proofType,
        uint256 deadline,
        uint256 reward
    );

    event ProofSubmitted(
        bytes32 indexed challengeId,
        bytes32 indexed proofId,
        address indexed prover,
        uint256 timestamp
    );

    event ChallengeResolved(
        bytes32 indexed challengeId,
        ChallengeStatus status,
        address winner,
        uint256 reward
    );

    event ChallengeExpired(bytes32 indexed challengeId, address indexed targetNode);

    // ============ Errors ============

    error ChallengeNotFound();
    error ChallengeAlreadyResolved();
    error ChallengeNotExpired();
    error ChallengeIdAlreadyUsed();
    error InvalidProofType();
    error InvalidSignature();
    error InsufficientReward();
    error InsufficientSlashAmount();
    error InsufficientStake();
    error NodeNotRegistered();
    error NotTargetNode();
    error ProofDeadlinePassed();
    error Unauthorized();
    error WithdrawFailed();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Node Registration ============

    /**
     * @notice Register as a storage node with stake
     */
    function registerNode() external payable {
        if (msg.value < minNodeStake) revert InsufficientStake();

        NodeStats storage stats = nodeStats[msg.sender];
        stats.isRegistered = true;
        stats.stake += msg.value;

        emit NodeRegistered(msg.sender, msg.value);
    }

    /**
     * @notice Add additional stake
     */
    function addStake() external payable {
        NodeStats storage stats = nodeStats[msg.sender];
        if (!stats.isRegistered) revert NodeNotRegistered();

        stats.stake += msg.value;
    }

    /**
     * @notice Withdraw stake (if no pending challenges)
     * @param amount Amount to withdraw
     */
    function withdrawStake(uint256 amount) external nonReentrant {
        NodeStats storage stats = nodeStats[msg.sender];
        if (!stats.isRegistered) revert NodeNotRegistered();
        if (stats.stake < amount) revert InsufficientStake();

        // Check for pending challenges
        for (uint256 i = 0; i < activeChallenges.length; i++) {
            Challenge storage c = challenges[activeChallenges[i]];
            if (c.targetNode == msg.sender && c.status == ChallengeStatus.Pending) {
                revert ChallengeNotExpired();
            }
        }

        stats.stake -= amount;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert WithdrawFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }

    // ============ Challenge Creation ============

    /**
     * @notice Submit a storage challenge
     * @param challengeId Unique challenge identifier
     * @param cid Content identifier to challenge
     * @param targetNode Address of the storage node being challenged
     * @param proofType Type of proof required
     * @param challengeData Additional data for the challenge
     */
    function submitChallenge(
        bytes32 challengeId,
        string calldata cid,
        address targetNode,
        ProofType proofType,
        bytes calldata challengeData
    ) external payable nonReentrant {
        if (usedChallengeIds[challengeId]) revert ChallengeIdAlreadyUsed();
        if (msg.value < minChallengeReward) revert InsufficientReward();
        if (!nodeStats[targetNode].isRegistered) revert NodeNotRegistered();

        uint256 deadline = block.timestamp + challengeWindow;

        Challenge storage c = challenges[challengeId];
        c.challengeId = challengeId;
        c.cid = cid;
        c.challenger = msg.sender;
        c.targetNode = targetNode;
        c.proofType = proofType;
        c.deadline = deadline;
        c.reward = msg.value;
        c.slashAmount = minSlashAmount;
        c.status = ChallengeStatus.Pending;
        c.challengeData = challengeData;

        usedChallengeIds[challengeId] = true;
        activeChallenges.push(challengeId);
        challengeIndex[challengeId] = activeChallenges.length - 1;

        totalChallenges++;
        nodeStats[targetNode].totalChallenges++;
        nodeStats[targetNode].lastChallengeTime = block.timestamp;

        emit ChallengeCreated(
            challengeId, cid, msg.sender, targetNode, proofType, deadline, msg.value
        );
    }

    // ============ Proof Submission ============

    /**
     * @notice Submit proof responding to a challenge
     * @param challengeId The challenge being responded to
     * @param proofData The proof data
     * @param signature Signature from the prover
     */
    function submitProof(bytes32 challengeId, bytes calldata proofData, bytes calldata signature)
        external
        nonReentrant
    {
        Challenge storage c = challenges[challengeId];
        if (c.challengeId == bytes32(0)) revert ChallengeNotFound();
        if (c.status != ChallengeStatus.Pending) revert ChallengeAlreadyResolved();
        if (block.timestamp > c.deadline) revert ProofDeadlinePassed();
        if (msg.sender != c.targetNode) revert NotTargetNode();

        // Verify signature
        bytes32 proofHash = keccak256(abi.encodePacked(challengeId, proofData, block.timestamp));
        bytes32 ethSignedHash = proofHash.toEthSignedMessageHash();
        address signer = ECDSA.recover(ethSignedHash, signature);
        if (signer != msg.sender) revert InvalidSignature();

        bytes32 proofId = keccak256(abi.encodePacked(challengeId, proofData, block.timestamp));

        Proof storage p = proofs[proofId];
        p.proofId = proofId;
        p.challengeId = challengeId;
        p.prover = msg.sender;
        p.timestamp = block.timestamp;
        p.proofData = proofData;
        p.signature = signature;
        p.verified = true;

        // Mark challenge as completed
        c.status = ChallengeStatus.Completed;

        // Update stats
        totalProofs++;
        nodeStats[msg.sender].passedChallenges++;

        // Remove from active challenges
        _removeActiveChallenge(challengeId);

        // Transfer reward to prover
        (bool success,) = msg.sender.call{value: c.reward}("");
        if (!success) revert WithdrawFailed();

        nodeStats[msg.sender].totalRewards += c.reward;
        totalRewards += c.reward;

        emit ProofSubmitted(challengeId, proofId, msg.sender, block.timestamp);
        emit ChallengeResolved(challengeId, ChallengeStatus.Completed, msg.sender, c.reward);
    }

    // ============ Challenge Resolution ============

    /**
     * @notice Resolve an expired challenge (slash node)
     * @param challengeId The expired challenge
     */
    function resolveExpiredChallenge(bytes32 challengeId) external nonReentrant {
        Challenge storage c = challenges[challengeId];
        if (c.challengeId == bytes32(0)) revert ChallengeNotFound();
        if (c.status != ChallengeStatus.Pending) revert ChallengeAlreadyResolved();
        if (block.timestamp <= c.deadline) revert ChallengeNotExpired();

        // Mark as expired/failed
        c.status = ChallengeStatus.Expired;

        NodeStats storage stats = nodeStats[c.targetNode];
        stats.failedChallenges++;

        // Slash the node
        uint256 slashAmount = c.slashAmount;
        if (stats.stake >= slashAmount) {
            stats.stake -= slashAmount;
            stats.totalSlashed += slashAmount;
            totalSlashed += slashAmount;

            // Reward goes to challenger
            (bool success,) = c.challenger.call{value: c.reward + slashAmount}("");
            if (!success) revert WithdrawFailed();

            emit NodeSlashed(c.targetNode, slashAmount, challengeId);
        } else {
            // Node doesn't have enough stake, just return reward
            (bool success,) = c.challenger.call{value: c.reward}("");
            if (!success) revert WithdrawFailed();
        }

        _removeActiveChallenge(challengeId);

        emit ChallengeExpired(challengeId, c.targetNode);
        emit ChallengeResolved(challengeId, ChallengeStatus.Expired, c.challenger, c.reward);
    }

    // ============ View Functions ============

    /**
     * @notice Get challenge details
     */
    function getChallenge(bytes32 challengeId)
        external
        view
        returns (
            string memory cid,
            address challenger,
            address targetNode,
            ProofType proofType,
            uint256 deadline,
            ChallengeStatus status,
            uint256 reward
        )
    {
        Challenge storage c = challenges[challengeId];
        return (c.cid, c.challenger, c.targetNode, c.proofType, c.deadline, c.status, c.reward);
    }

    /**
     * @notice Get node statistics
     */
    function getNodeStats(address node)
        external
        view
        returns (
            uint256 _totalChallenges,
            uint256 passed,
            uint256 failed,
            uint256 slashed,
            uint256 rewards,
            uint256 stake,
            bool registered
        )
    {
        NodeStats storage stats = nodeStats[node];
        return (
            stats.totalChallenges,
            stats.passedChallenges,
            stats.failedChallenges,
            stats.totalSlashed,
            stats.totalRewards,
            stats.stake,
            stats.isRegistered
        );
    }

    /**
     * @notice Get active challenge count
     */
    function getActiveChallengeCount() external view returns (uint256) {
        return activeChallenges.length;
    }

    /**
     * @notice Get active challenges (paginated)
     */
    function getActiveChallenges(uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory)
    {
        uint256 length = activeChallenges.length;
        if (offset >= length) {
            return new bytes32[](0);
        }

        uint256 end = offset + limit;
        if (end > length) {
            end = length;
        }

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = activeChallenges[i];
        }

        return result;
    }

    /**
     * @notice Check if a node can be challenged
     */
    function canChallenge(address node) external view returns (bool) {
        return nodeStats[node].isRegistered && nodeStats[node].stake >= minSlashAmount;
    }

    /**
     * @notice Calculate node reliability score (0-100)
     */
    function getNodeReliability(address node) external view returns (uint256) {
        NodeStats storage stats = nodeStats[node];
        if (stats.totalChallenges == 0) return 100;

        return (stats.passedChallenges * 100) / stats.totalChallenges;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update challenge window
     */
    function setChallengeWindow(uint256 _window) external onlyOwner {
        challengeWindow = _window;
    }

    /**
     * @notice Update minimum challenge reward
     */
    function setMinChallengeReward(uint256 _reward) external onlyOwner {
        minChallengeReward = _reward;
    }

    /**
     * @notice Update minimum slash amount
     */
    function setMinSlashAmount(uint256 _amount) external onlyOwner {
        minSlashAmount = _amount;
    }

    /**
     * @notice Update minimum node stake
     */
    function setMinNodeStake(uint256 _stake) external onlyOwner {
        minNodeStake = _stake;
    }

    // ============ Internal Functions ============

    function _removeActiveChallenge(bytes32 challengeId) internal {
        uint256 index = challengeIndex[challengeId];
        uint256 lastIndex = activeChallenges.length - 1;

        if (index != lastIndex) {
            bytes32 lastChallenge = activeChallenges[lastIndex];
            activeChallenges[index] = lastChallenge;
            challengeIndex[lastChallenge] = index;
        }

        activeChallenges.pop();
        delete challengeIndex[challengeId];
    }
}
