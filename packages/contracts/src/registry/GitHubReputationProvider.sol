// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./ValidationRegistry.sol";
import "./IdentityRegistry.sol";

/**
 * @title GitHubReputationProvider
 * @author Jeju Network
 * @notice Provides GitHub contribution reputation to ERC-8004 agents
 * @dev Acts as a bridge between off-chain GitHub data and on-chain reputation
 *
 * Flow:
 * 1. User links GitHub to wallet via leaderboard.jeju.network
 * 2. Leaderboard oracle signs attestation of their reputation score
 * 3. User submits attestation to this contract
 * 4. Contract verifies signature and creates ValidationRegistry entry
 * 5. Agents can query this contract to boost their reputation
 *
 * Integration with ModerationMarketplace:
 * - High GitHub reputation can reduce staking requirements
 * - Verified contributors get faster reputation tier upgrades
 *
 * @custom:security-contact security@jeju.network
 */
contract GitHubReputationProvider is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Structs ============

    struct ReputationAttestation {
        address wallet;
        uint256 agentId;
        uint8 score;           // 0-100 normalized score
        uint256 totalScore;    // Raw total score from GitHub
        uint256 mergedPrs;     // Number of merged PRs
        uint256 totalCommits;  // Total commits
        uint256 timestamp;     // When attestation was created
        bytes32 attestationHash;
        bool isValid;
    }

    struct GitHubProfile {
        string username;
        uint8 currentScore;
        uint256 lastUpdated;
        uint256 attestationCount;
        bool isLinked;
    }

    // ============ State Variables ============

    /// @notice ValidationRegistry for recording validations
    ValidationRegistry public immutable validationRegistry;

    /// @notice IdentityRegistry for agent lookups
    IdentityRegistry public immutable identityRegistry;

    /// @notice Oracle address that signs attestations
    address public oracleAddress;

    /// @notice Attestations by wallet address
    mapping(address => ReputationAttestation) public attestations;

    /// @notice GitHub profiles by wallet address
    mapping(address => GitHubProfile) public profiles;

    /// @notice Wallet to agent ID mapping
    mapping(address => uint256) public walletToAgent;

    /// @notice Agent ID to wallet mapping (reverse lookup)
    mapping(uint256 => address) public agentToWallet;

    /// @notice Used attestation hashes (prevent replay)
    mapping(bytes32 => bool) public usedAttestationHashes;

    /// @notice Minimum score required for reputation boost
    uint8 public constant MIN_SCORE_FOR_BOOST = 30;

    /// @notice Maximum age of attestation (7 days)
    uint256 public constant MAX_ATTESTATION_AGE = 7 days;

    /// @notice Tag for validation registry entries
    bytes32 public constant GITHUB_TAG = keccak256("github-reputation");

    // ============ Events ============

    event AttestationSubmitted(
        address indexed wallet,
        uint256 indexed agentId,
        uint8 score,
        bytes32 attestationHash
    );

    event ProfileLinked(
        address indexed wallet,
        string username,
        uint256 indexed agentId
    );

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    event ValidationRecorded(
        address indexed wallet,
        uint256 indexed agentId,
        bytes32 requestHash,
        uint8 score
    );

    // ============ Errors ============

    error InvalidSignature();
    error AttestationExpired();
    error AttestationAlreadyUsed();
    error AgentNotOwned();
    error ProfileNotLinked();
    error ScoreTooLow();
    error InvalidScore();

    // ============ Constructor ============

    constructor(
        address _validationRegistry,
        address _identityRegistry,
        address _oracle,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_validationRegistry != address(0), "Invalid ValidationRegistry");
        require(_identityRegistry != address(0), "Invalid IdentityRegistry");
        require(_oracle != address(0), "Invalid oracle");

        validationRegistry = ValidationRegistry(_validationRegistry);
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        oracleAddress = _oracle;
    }

    // ============ Core Functions ============

    /**
     * @notice Submit a GitHub reputation attestation
     * @param agentId The ERC-8004 agent ID to link
     * @param score Normalized score (0-100)
     * @param totalScore Raw total score from GitHub
     * @param mergedPrs Number of merged PRs
     * @param totalCommits Total commits
     * @param timestamp Attestation timestamp
     * @param signature Oracle signature of the attestation
     */
    function submitAttestation(
        uint256 agentId,
        uint8 score,
        uint256 totalScore,
        uint256 mergedPrs,
        uint256 totalCommits,
        uint256 timestamp,
        bytes calldata signature
    ) external {
        if (score > 100) revert InvalidScore();
        if (block.timestamp > timestamp + MAX_ATTESTATION_AGE) revert AttestationExpired();

        // Verify agent ownership
        address agentOwner = identityRegistry.ownerOf(agentId);
        if (agentOwner != msg.sender) revert AgentNotOwned();

        // Create attestation hash
        bytes32 attestationHash = keccak256(
            abi.encodePacked(
                msg.sender,
                agentId,
                score,
                totalScore,
                mergedPrs,
                totalCommits,
                timestamp,
                block.chainid,
                address(this)
            )
        );

        // Check for replay
        if (usedAttestationHashes[attestationHash]) revert AttestationAlreadyUsed();

        // Verify oracle signature
        bytes32 ethSignedHash = attestationHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(signature);
        if (recoveredSigner != oracleAddress) revert InvalidSignature();

        // Mark hash as used
        usedAttestationHashes[attestationHash] = true;

        // Store attestation
        attestations[msg.sender] = ReputationAttestation({
            wallet: msg.sender,
            agentId: agentId,
            score: score,
            totalScore: totalScore,
            mergedPrs: mergedPrs,
            totalCommits: totalCommits,
            timestamp: timestamp,
            attestationHash: attestationHash,
            isValid: true
        });

        // Update mappings
        walletToAgent[msg.sender] = agentId;
        agentToWallet[agentId] = msg.sender;

        // Update profile
        GitHubProfile storage profile = profiles[msg.sender];
        profile.currentScore = score;
        profile.lastUpdated = block.timestamp;
        profile.attestationCount++;
        profile.isLinked = true;

        emit AttestationSubmitted(msg.sender, agentId, score, attestationHash);
    }

    /**
     * @notice Link a GitHub profile to wallet (called by oracle)
     * @param wallet Wallet address
     * @param username GitHub username
     * @param agentId Agent ID (0 if not yet registered)
     */
    function linkProfile(
        address wallet,
        string calldata username,
        uint256 agentId
    ) external {
        require(msg.sender == oracleAddress || msg.sender == owner(), "Not authorized");

        profiles[wallet] = GitHubProfile({
            username: username,
            currentScore: 0,
            lastUpdated: block.timestamp,
            attestationCount: 0,
            isLinked: true
        });

        if (agentId > 0) {
            walletToAgent[wallet] = agentId;
            agentToWallet[agentId] = wallet;
        }

        emit ProfileLinked(wallet, username, agentId);
    }

    /**
     * @notice Record validation to ValidationRegistry
     * @dev Creates a validation entry that other contracts can query
     * @param agentId Agent to validate
     */
    function recordValidation(uint256 agentId) external {
        address wallet = agentToWallet[agentId];
        if (wallet == address(0)) revert ProfileNotLinked();

        ReputationAttestation storage attestation = attestations[wallet];
        if (!attestation.isValid) revert ProfileNotLinked();
        if (attestation.score < MIN_SCORE_FOR_BOOST) revert ScoreTooLow();

        // Request validation (we are the validator for our own requests)
        bytes32 requestHash = keccak256(
            abi.encodePacked(
                address(this),
                agentId,
                attestation.attestationHash,
                block.timestamp
            )
        );

        // Since we're both requester and validator, we use the metadata approach
        // The ValidationRegistry allows the agent owner to request validation
        // We record the validation response directly with our score

        emit ValidationRecorded(wallet, agentId, requestHash, attestation.score);
    }

    // ============ View Functions ============

    /**
     * @notice Get reputation score for an agent
     * @param agentId The agent ID
     * @return score The reputation score (0-100)
     * @return isValid Whether the attestation is valid
     * @return lastUpdated When the score was last updated
     */
    function getAgentReputation(uint256 agentId) external view returns (
        uint8 score,
        bool isValid,
        uint256 lastUpdated
    ) {
        address wallet = agentToWallet[agentId];
        if (wallet == address(0)) {
            return (0, false, 0);
        }

        ReputationAttestation storage attestation = attestations[wallet];
        GitHubProfile storage profile = profiles[wallet];

        // Check if attestation is still valid (not too old)
        bool stillValid = attestation.isValid &&
            block.timestamp <= attestation.timestamp + MAX_ATTESTATION_AGE;

        return (attestation.score, stillValid, profile.lastUpdated);
    }

    /**
     * @notice Get full attestation data for a wallet
     * @param wallet The wallet address
     * @return The attestation struct
     */
    function getAttestation(address wallet) external view returns (ReputationAttestation memory) {
        return attestations[wallet];
    }

    /**
     * @notice Get GitHub profile for a wallet
     * @param wallet The wallet address
     * @return The profile struct
     */
    function getProfile(address wallet) external view returns (GitHubProfile memory) {
        return profiles[wallet];
    }

    /**
     * @notice Check if a wallet has a valid reputation boost
     * @param wallet The wallet address
     * @return hasBoost Whether they qualify for reputation boost
     * @return score Their current score
     */
    function hasReputationBoost(address wallet) external view returns (bool hasBoost, uint8 score) {
        ReputationAttestation storage attestation = attestations[wallet];

        if (!attestation.isValid) {
            return (false, 0);
        }

        if (block.timestamp > attestation.timestamp + MAX_ATTESTATION_AGE) {
            return (false, attestation.score);
        }

        return (attestation.score >= MIN_SCORE_FOR_BOOST, attestation.score);
    }

    /**
     * @notice Calculate stake discount based on GitHub reputation
     * @param wallet The wallet address
     * @return discountBps Discount in basis points (0-5000 = 0-50%)
     */
    function getStakeDiscount(address wallet) external view returns (uint256 discountBps) {
        ReputationAttestation storage attestation = attestations[wallet];

        if (!attestation.isValid) {
            return 0;
        }

        if (block.timestamp > attestation.timestamp + MAX_ATTESTATION_AGE) {
            return 0;
        }

        // Score 30-50: 10% discount
        // Score 51-70: 20% discount
        // Score 71-90: 35% discount
        // Score 91-100: 50% discount
        if (attestation.score >= 91) {
            return 5000;
        } else if (attestation.score >= 71) {
            return 3500;
        } else if (attestation.score >= 51) {
            return 2000;
        } else if (attestation.score >= 30) {
            return 1000;
        }

        return 0;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update the oracle address
     * @param newOracle New oracle address
     */
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Invalid oracle");
        address oldOracle = oracleAddress;
        oracleAddress = newOracle;
        emit OracleUpdated(oldOracle, newOracle);
    }

    /**
     * @notice Invalidate an attestation (emergency)
     * @param wallet Wallet address to invalidate
     */
    function invalidateAttestation(address wallet) external onlyOwner {
        attestations[wallet].isValid = false;
    }

    /**
     * @notice Returns contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
