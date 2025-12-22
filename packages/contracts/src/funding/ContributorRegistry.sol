// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title ContributorRegistry
 * @author Jeju Network
 * @notice Registry for contributors to register wallets and verified identities for deep funding
 * @dev Integrates with OAuth3 for GitHub/social verification and ERC-8004 for agent identity
 *
 * Key Features:
 * - Individual, organization, and project contributor types
 * - OAuth3-verified social links (GitHub, Discord, Twitter)
 * - Repository ownership claims for dependency funding
 * - Multi-DAO support with per-DAO contribution tracking
 * - Integration with ERC-8004 agent identity
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract ContributorRegistry is Ownable, Pausable, ReentrancyGuard {
    // ============ Enums ============

    enum ContributorType {
        INDIVIDUAL,
        ORGANIZATION,
        PROJECT
    }

    enum VerificationStatus {
        UNVERIFIED,
        PENDING,
        VERIFIED,
        REVOKED
    }

    // ============ Structs ============

    struct Contributor {
        bytes32 contributorId;
        address wallet;
        uint256 agentId; // ERC-8004 agent ID (0 if no agent)
        ContributorType contributorType;
        string profileUri; // IPFS URI with extended profile
        uint256 totalEarned;
        uint256 registeredAt;
        uint256 lastActiveAt;
        bool active;
    }

    struct SocialLink {
        bytes32 platform; // keccak256("github"), keccak256("discord"), etc.
        string handle; // Username/handle on platform
        bytes32 proofHash; // Hash of OAuth3 verification proof
        VerificationStatus status;
        uint256 verifiedAt;
        uint256 expiresAt; // 0 = never expires
    }

    struct RepositoryClaim {
        bytes32 claimId;
        bytes32 contributorId;
        string owner; // GitHub owner (user or org)
        string repo; // Repository name
        bytes32 proofHash; // OAuth3 verification proof
        VerificationStatus status;
        uint256 claimedAt;
        uint256 verifiedAt;
    }

    struct DependencyClaim {
        bytes32 claimId;
        bytes32 contributorId;
        string packageName; // e.g., "viem", "wagmi"
        string registryType; // "npm", "pypi", "cargo", "go"
        bytes32 proofHash; // Proof of maintainership
        VerificationStatus status;
        uint256 claimedAt;
        uint256 verifiedAt;
    }

    struct DAOContribution {
        bytes32 daoId;
        uint256 totalEarned;
        uint256 bountyCount;
        uint256 paymentRequestCount;
        uint256 lastContributionAt;
    }

    // ============ Constants ============

    bytes32 public constant PLATFORM_GITHUB = keccak256("github");
    bytes32 public constant PLATFORM_DISCORD = keccak256("discord");
    bytes32 public constant PLATFORM_TWITTER = keccak256("twitter");
    bytes32 public constant PLATFORM_FARCASTER = keccak256("farcaster");

    uint256 public constant VERIFICATION_EXPIRY = 365 days;

    // ============ State ============

    IIdentityRegistry public identityRegistry;
    address public verifier; // OAuth3 verifier address
    mapping(address => bool) public authorizedRecorders; // Funding contracts that can record earnings

    mapping(bytes32 => Contributor) private _contributors;
    mapping(address => bytes32) private _walletToContributor;
    mapping(uint256 => bytes32) private _agentToContributor;

    mapping(bytes32 => SocialLink[]) private _socialLinks;
    mapping(bytes32 => mapping(bytes32 => uint256)) private _socialLinkIndex; // contributorId => platform => index

    mapping(bytes32 => RepositoryClaim) private _repoClaims;
    mapping(bytes32 => bytes32[]) private _contributorRepoClaims;
    mapping(bytes32 => bytes32) private _repoToContributor; // repoHash => contributorId

    mapping(bytes32 => DependencyClaim) private _depClaims;
    mapping(bytes32 => bytes32[]) private _contributorDepClaims;
    mapping(bytes32 => bytes32) private _depToContributor; // depHash => contributorId

    mapping(bytes32 => mapping(bytes32 => DAOContribution)) private _daoContributions;

    bytes32[] private _allContributorIds;
    uint256 private _nextContributorNonce = 1;

    // ============ Events ============

    event ContributorRegistered(
        bytes32 indexed contributorId,
        address indexed wallet,
        ContributorType contributorType
    );

    event ContributorUpdated(bytes32 indexed contributorId, string profileUri);
    event ContributorDeactivated(bytes32 indexed contributorId);
    event ContributorReactivated(bytes32 indexed contributorId);

    event SocialLinkAdded(
        bytes32 indexed contributorId,
        bytes32 indexed platform,
        string handle
    );

    event SocialLinkVerified(
        bytes32 indexed contributorId,
        bytes32 indexed platform
    );

    event SocialLinkRevoked(
        bytes32 indexed contributorId,
        bytes32 indexed platform
    );

    event RepositoryClaimed(
        bytes32 indexed claimId,
        bytes32 indexed contributorId,
        string owner,
        string repo
    );

    event RepositoryVerified(bytes32 indexed claimId);
    event RepositoryClaimRevoked(bytes32 indexed claimId);

    event DependencyClaimed(
        bytes32 indexed claimId,
        bytes32 indexed contributorId,
        string packageName,
        string registryType
    );

    event DependencyVerified(bytes32 indexed claimId);
    event DependencyClaimRevoked(bytes32 indexed claimId);

    event EarningsRecorded(
        bytes32 indexed contributorId,
        bytes32 indexed daoId,
        uint256 amount
    );

    event AgentLinked(bytes32 indexed contributorId, uint256 indexed agentId);

    // ============ Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error NotContributorOwner();
    error InvalidWallet();
    error InvalidProfile();
    error ContributorInactive();
    error SocialLinkExists();
    error SocialLinkNotFound();
    error ClaimAlreadyExists();
    error ClaimNotFound();
    error NotVerifier();
    error AlreadyVerified();
    error InvalidProof();
    error VerificationExpired();
    error AgentAlreadyLinked();
    error NotAuthorizedRecorder();

    // ============ Modifiers ============

    modifier onlyContributorOwner(bytes32 contributorId) {
        if (_contributors[contributorId].wallet != msg.sender) {
            revert NotContributorOwner();
        }
        _;
    }

    modifier onlyVerifier() {
        if (msg.sender != verifier && msg.sender != owner()) {
            revert NotVerifier();
        }
        _;
    }

    modifier onlyAuthorizedRecorder() {
        if (!authorizedRecorders[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedRecorder();
        }
        _;
    }

    modifier contributorExists(bytes32 contributorId) {
        if (_contributors[contributorId].registeredAt == 0) {
            revert NotRegistered();
        }
        _;
    }

    modifier contributorActive(bytes32 contributorId) {
        if (!_contributors[contributorId].active) {
            revert ContributorInactive();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _identityRegistry,
        address _verifier,
        address _owner
    ) Ownable(_owner) {
        identityRegistry = IIdentityRegistry(_identityRegistry);
        verifier = _verifier;
    }

    // ============ Registration ============

    /**
     * @notice Register as a contributor
     * @param contributorType Type of contributor
     * @param profileUri IPFS URI with profile metadata
     * @return contributorId The new contributor ID
     */
    function register(
        ContributorType contributorType,
        string calldata profileUri
    ) external whenNotPaused nonReentrant returns (bytes32 contributorId) {
        if (msg.sender == address(0)) revert InvalidWallet();
        if (_walletToContributor[msg.sender] != bytes32(0)) revert AlreadyRegistered();
        if (bytes(profileUri).length == 0) revert InvalidProfile();

        contributorId = keccak256(
            abi.encodePacked(msg.sender, block.timestamp, _nextContributorNonce++)
        );

        _contributors[contributorId] = Contributor({
            contributorId: contributorId,
            wallet: msg.sender,
            agentId: 0,
            contributorType: contributorType,
            profileUri: profileUri,
            totalEarned: 0,
            registeredAt: block.timestamp,
            lastActiveAt: block.timestamp,
            active: true
        });

        _walletToContributor[msg.sender] = contributorId;
        _allContributorIds.push(contributorId);

        emit ContributorRegistered(contributorId, msg.sender, contributorType);
    }

    /**
     * @notice Link an ERC-8004 agent to contributor
     * @param contributorId Contributor to link
     * @param agentId ERC-8004 agent ID
     */
    function linkAgent(
        bytes32 contributorId,
        uint256 agentId
    ) external onlyContributorOwner(contributorId) contributorActive(contributorId) {
        if (_agentToContributor[agentId] != bytes32(0)) revert AgentAlreadyLinked();

        // Verify caller owns the agent
        address agentOwner = identityRegistry.ownerOf(agentId);
        if (agentOwner != msg.sender) revert NotContributorOwner();

        _contributors[contributorId].agentId = agentId;
        _agentToContributor[agentId] = contributorId;

        emit AgentLinked(contributorId, agentId);
    }

    /**
     * @notice Update contributor profile
     */
    function updateProfile(
        bytes32 contributorId,
        string calldata profileUri
    ) external onlyContributorOwner(contributorId) {
        if (bytes(profileUri).length == 0) revert InvalidProfile();

        _contributors[contributorId].profileUri = profileUri;
        _contributors[contributorId].lastActiveAt = block.timestamp;

        emit ContributorUpdated(contributorId, profileUri);
    }

    /**
     * @notice Deactivate contributor
     */
    function deactivate(
        bytes32 contributorId
    ) external onlyContributorOwner(contributorId) {
        _contributors[contributorId].active = false;
        emit ContributorDeactivated(contributorId);
    }

    /**
     * @notice Reactivate contributor
     */
    function reactivate(
        bytes32 contributorId
    ) external onlyContributorOwner(contributorId) {
        _contributors[contributorId].active = true;
        _contributors[contributorId].lastActiveAt = block.timestamp;
        emit ContributorReactivated(contributorId);
    }

    // ============ Social Links ============

    /**
     * @notice Add a social link (pending verification)
     */
    function addSocialLink(
        bytes32 contributorId,
        bytes32 platform,
        string calldata handle
    ) external onlyContributorOwner(contributorId) contributorActive(contributorId) {
        SocialLink[] storage links = _socialLinks[contributorId];
        uint256 existingIndex = _socialLinkIndex[contributorId][platform];

        if (existingIndex > 0 && links[existingIndex - 1].status != VerificationStatus.REVOKED) {
            revert SocialLinkExists();
        }

        links.push(SocialLink({
            platform: platform,
            handle: handle,
            proofHash: bytes32(0),
            status: VerificationStatus.PENDING,
            verifiedAt: 0,
            expiresAt: 0
        }));

        _socialLinkIndex[contributorId][platform] = links.length;

        emit SocialLinkAdded(contributorId, platform, handle);
    }

    /**
     * @notice Verify a social link (called by OAuth3 verifier)
     */
    function verifySocialLink(
        bytes32 contributorId,
        bytes32 platform,
        bytes32 proofHash
    ) external onlyVerifier contributorExists(contributorId) {
        uint256 index = _socialLinkIndex[contributorId][platform];
        if (index == 0) revert SocialLinkNotFound();

        SocialLink storage link = _socialLinks[contributorId][index - 1];
        if (link.status == VerificationStatus.VERIFIED) revert AlreadyVerified();

        link.proofHash = proofHash;
        link.status = VerificationStatus.VERIFIED;
        link.verifiedAt = block.timestamp;
        link.expiresAt = block.timestamp + VERIFICATION_EXPIRY;

        emit SocialLinkVerified(contributorId, platform);
    }

    /**
     * @notice Revoke a social link
     */
    function revokeSocialLink(
        bytes32 contributorId,
        bytes32 platform
    ) external onlyVerifier contributorExists(contributorId) {
        uint256 index = _socialLinkIndex[contributorId][platform];
        if (index == 0) revert SocialLinkNotFound();

        _socialLinks[contributorId][index - 1].status = VerificationStatus.REVOKED;

        emit SocialLinkRevoked(contributorId, platform);
    }

    // ============ Repository Claims ============

    /**
     * @notice Claim ownership of a repository
     */
    function claimRepository(
        bytes32 contributorId,
        string calldata repoOwner,
        string calldata repo
    ) external onlyContributorOwner(contributorId) contributorActive(contributorId) returns (bytes32 claimId) {
        bytes32 repoHash = keccak256(abi.encodePacked(repoOwner, "/", repo));
        if (_repoToContributor[repoHash] != bytes32(0)) revert ClaimAlreadyExists();

        claimId = keccak256(abi.encodePacked(contributorId, repoHash, block.timestamp));

        _repoClaims[claimId] = RepositoryClaim({
            claimId: claimId,
            contributorId: contributorId,
            owner: repoOwner,
            repo: repo,
            proofHash: bytes32(0),
            status: VerificationStatus.PENDING,
            claimedAt: block.timestamp,
            verifiedAt: 0
        });

        _contributorRepoClaims[contributorId].push(claimId);

        emit RepositoryClaimed(claimId, contributorId, repoOwner, repo);
    }

    /**
     * @notice Verify a repository claim (called by OAuth3 verifier)
     */
    function verifyRepository(
        bytes32 claimId,
        bytes32 proofHash
    ) external onlyVerifier {
        RepositoryClaim storage claim = _repoClaims[claimId];
        if (claim.claimedAt == 0) revert ClaimNotFound();
        if (claim.status == VerificationStatus.VERIFIED) revert AlreadyVerified();

        bytes32 repoHash = keccak256(abi.encodePacked(claim.owner, "/", claim.repo));

        claim.proofHash = proofHash;
        claim.status = VerificationStatus.VERIFIED;
        claim.verifiedAt = block.timestamp;

        _repoToContributor[repoHash] = claim.contributorId;

        emit RepositoryVerified(claimId);
    }

    /**
     * @notice Revoke a repository claim
     */
    function revokeRepositoryClaim(bytes32 claimId) external onlyVerifier {
        RepositoryClaim storage claim = _repoClaims[claimId];
        if (claim.claimedAt == 0) revert ClaimNotFound();

        bytes32 repoHash = keccak256(abi.encodePacked(claim.owner, "/", claim.repo));
        delete _repoToContributor[repoHash];

        claim.status = VerificationStatus.REVOKED;

        emit RepositoryClaimRevoked(claimId);
    }

    // ============ Dependency Claims ============

    /**
     * @notice Claim maintainership of a package dependency
     */
    function claimDependency(
        bytes32 contributorId,
        string calldata packageName,
        string calldata registryType
    ) external onlyContributorOwner(contributorId) contributorActive(contributorId) returns (bytes32 claimId) {
        bytes32 depHash = keccak256(abi.encodePacked(registryType, ":", packageName));
        if (_depToContributor[depHash] != bytes32(0)) revert ClaimAlreadyExists();

        claimId = keccak256(abi.encodePacked(contributorId, depHash, block.timestamp));

        _depClaims[claimId] = DependencyClaim({
            claimId: claimId,
            contributorId: contributorId,
            packageName: packageName,
            registryType: registryType,
            proofHash: bytes32(0),
            status: VerificationStatus.PENDING,
            claimedAt: block.timestamp,
            verifiedAt: 0
        });

        _contributorDepClaims[contributorId].push(claimId);

        emit DependencyClaimed(claimId, contributorId, packageName, registryType);
    }

    /**
     * @notice Verify a dependency claim
     */
    function verifyDependency(
        bytes32 claimId,
        bytes32 proofHash
    ) external onlyVerifier {
        DependencyClaim storage claim = _depClaims[claimId];
        if (claim.claimedAt == 0) revert ClaimNotFound();
        if (claim.status == VerificationStatus.VERIFIED) revert AlreadyVerified();

        bytes32 depHash = keccak256(abi.encodePacked(claim.registryType, ":", claim.packageName));

        claim.proofHash = proofHash;
        claim.status = VerificationStatus.VERIFIED;
        claim.verifiedAt = block.timestamp;

        _depToContributor[depHash] = claim.contributorId;

        emit DependencyVerified(claimId);
    }

    /**
     * @notice Revoke a dependency claim
     */
    function revokeDependencyClaim(bytes32 claimId) external onlyVerifier {
        DependencyClaim storage claim = _depClaims[claimId];
        if (claim.claimedAt == 0) revert ClaimNotFound();

        bytes32 depHash = keccak256(abi.encodePacked(claim.registryType, ":", claim.packageName));
        delete _depToContributor[depHash];

        claim.status = VerificationStatus.REVOKED;

        emit DependencyClaimRevoked(claimId);
    }

    // ============ Earnings Recording ============

    /**
     * @notice Record earnings for a contributor (called by funding contracts)
     * @param contributorId Contributor who earned
     * @param daoId DAO the earnings came from
     * @param amount Amount earned
     * @param isBounty Whether this is from a bounty (vs payment request)
     */
    function recordEarnings(
        bytes32 contributorId,
        bytes32 daoId,
        uint256 amount,
        bool isBounty
    ) external onlyAuthorizedRecorder {
        Contributor storage contributor = _contributors[contributorId];
        if (contributor.registeredAt == 0) revert NotRegistered();

        contributor.totalEarned += amount;
        contributor.lastActiveAt = block.timestamp;

        DAOContribution storage daoContrib = _daoContributions[contributorId][daoId];
        daoContrib.daoId = daoId;
        daoContrib.totalEarned += amount;
        daoContrib.lastContributionAt = block.timestamp;

        if (isBounty) {
            daoContrib.bountyCount++;
        } else {
            daoContrib.paymentRequestCount++;
        }

        emit EarningsRecorded(contributorId, daoId, amount);
    }

    // ============ View Functions ============

    function getContributor(bytes32 contributorId) external view returns (Contributor memory) {
        return _contributors[contributorId];
    }

    function getContributorByWallet(address wallet) external view returns (Contributor memory) {
        bytes32 contributorId = _walletToContributor[wallet];
        return _contributors[contributorId];
    }

    function getContributorByAgent(uint256 agentId) external view returns (Contributor memory) {
        bytes32 contributorId = _agentToContributor[agentId];
        return _contributors[contributorId];
    }

    function getSocialLinks(bytes32 contributorId) external view returns (SocialLink[] memory) {
        return _socialLinks[contributorId];
    }

    function getRepositoryClaims(bytes32 contributorId) external view returns (RepositoryClaim[] memory) {
        bytes32[] memory claimIds = _contributorRepoClaims[contributorId];
        RepositoryClaim[] memory claims = new RepositoryClaim[](claimIds.length);
        for (uint256 i = 0; i < claimIds.length; i++) {
            claims[i] = _repoClaims[claimIds[i]];
        }
        return claims;
    }

    function getDependencyClaims(bytes32 contributorId) external view returns (DependencyClaim[] memory) {
        bytes32[] memory claimIds = _contributorDepClaims[contributorId];
        DependencyClaim[] memory claims = new DependencyClaim[](claimIds.length);
        for (uint256 i = 0; i < claimIds.length; i++) {
            claims[i] = _depClaims[claimIds[i]];
        }
        return claims;
    }

    function getDAOContribution(
        bytes32 contributorId,
        bytes32 daoId
    ) external view returns (DAOContribution memory) {
        return _daoContributions[contributorId][daoId];
    }

    function getContributorForRepo(
        string calldata repoOwner,
        string calldata repo
    ) external view returns (bytes32) {
        bytes32 repoHash = keccak256(abi.encodePacked(repoOwner, "/", repo));
        return _repoToContributor[repoHash];
    }

    function getContributorForDependency(
        string calldata packageName,
        string calldata registryType
    ) external view returns (bytes32) {
        bytes32 depHash = keccak256(abi.encodePacked(registryType, ":", packageName));
        return _depToContributor[depHash];
    }

    function getAllContributors() external view returns (bytes32[] memory) {
        return _allContributorIds;
    }

    function getContributorCount() external view returns (uint256) {
        return _allContributorIds.length;
    }

    function isVerifiedGitHub(bytes32 contributorId) external view returns (bool) {
        uint256 index = _socialLinkIndex[contributorId][PLATFORM_GITHUB];
        if (index == 0) return false;
        SocialLink memory link = _socialLinks[contributorId][index - 1];
        return link.status == VerificationStatus.VERIFIED &&
               (link.expiresAt == 0 || link.expiresAt > block.timestamp);
    }

    // ============ Admin Functions ============

    function setVerifier(address _verifier) external onlyOwner {
        verifier = _verifier;
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    function setAuthorizedRecorder(address recorder, bool authorized) external onlyOwner {
        authorizedRecorders[recorder] = authorized;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

