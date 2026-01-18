// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IDAORegistry
 * @author Jeju Network
 * @notice Interface for multi-tenant DAO management
 *
 * Terminology:
 * - Director: The AI or human executive decision maker (formerly Director)
 * - Board: The advisory/oversight body (formerly Board)
 */
interface IDAORegistry {
    // ============ Enums ============

    enum DAOStatus {
        PENDING,
        ACTIVE,
        PAUSED,
        ARCHIVED
    }

    enum ProposalCategory {
        OPINION,
        SUGGESTION,
        PROPOSAL,
        MEMBER_APPLICATION,
        PACKAGE_FUNDING,
        REPO_FUNDING,
        PARAMETER_CHANGE,
        TREASURY_ACTION,
        DIRECTOR_MODEL_CHANGE
    }

    // ============ Structs ============

    struct DirectorPersona {
        string name;
        string pfpCid;
        string description;
        string personality;
        string[] traits;
        bool isHuman;
        address humanAddress; // Set if isHuman=true, otherwise 0x0
        uint256 agentId; // EIP-8004 ID if AI director, 0 if human
        uint256 decisionFallbackDays; // 1-30 days before fallback (0 = no fallback)
    }

    struct BoardMember {
        address member;
        uint256 agentId; // EIP-8004 ID for AI, 0 for human
        string role;
        uint256 weight;
        uint256 addedAt;
        bool isActive;
        bool isHuman;
    }

    struct GovernanceParams {
        uint256 minQualityScore;
        uint256 boardVotingPeriod;
        uint256 gracePeriod;
        uint256 minProposalStake;
        uint256 quorumBps;
    }

    struct DAO {
        bytes32 daoId;
        string name;
        string displayName;
        string description;
        address treasury;
        address board; // Board governance contract (formerly board)
        address directorAgent; // Director agent contract (formerly directorAgent)
        address feeConfig;
        bytes32 directorModelId; // AI model ID (formerly directorModelId)
        string manifestCid;
        DAOStatus status;
        uint256 createdAt;
        uint256 updatedAt;
        address creator;
    }

    struct DAOFull {
        DAO dao;
        DirectorPersona directorPersona;
        GovernanceParams params;
        BoardMember[] boardMembers;
        bytes32[] linkedPackages;
        bytes32[] linkedRepos;
    }

    // ============ Events ============

    event DAOCreated(bytes32 indexed daoId, string name, address indexed treasury, address indexed creator);
    event DAOUpdated(bytes32 indexed daoId, string field, bytes newValue);
    event DAOStatusChanged(bytes32 indexed daoId, DAOStatus oldStatus, DAOStatus newStatus);
    event DirectorPersonaUpdated(bytes32 indexed daoId, string name, string pfpCid, bool isHuman);
    event DirectorModelChanged(bytes32 indexed daoId, bytes32 oldModel, bytes32 newModel);
    event BoardMemberAdded(bytes32 indexed daoId, address indexed member, string role, uint256 weight, bool isHuman);
    event BoardMemberRemoved(bytes32 indexed daoId, address indexed member);
    event BoardMemberUpdated(bytes32 indexed daoId, address indexed member, uint256 newWeight);
    event PackageLinked(bytes32 indexed daoId, bytes32 indexed packageId);
    event PackageUnlinked(bytes32 indexed daoId, bytes32 indexed packageId);
    event RepoLinked(bytes32 indexed daoId, bytes32 indexed repoId);
    event RepoUnlinked(bytes32 indexed daoId, bytes32 indexed repoId);
    event GovernanceParamsUpdated(bytes32 indexed daoId);

    // ============ DAO Management ============

    function createDAO(
        string calldata name,
        string calldata displayName,
        string calldata description,
        address treasury,
        string calldata manifestCid,
        DirectorPersona calldata directorPersona,
        GovernanceParams calldata params
    ) external returns (bytes32 daoId);

    function updateDAO(
        bytes32 daoId,
        string calldata displayName,
        string calldata description,
        string calldata manifestCid
    ) external;

    function setDAOStatus(bytes32 daoId, DAOStatus status) external;

    function setDAOTreasury(bytes32 daoId, address treasury) external;

    function setDAOBoardContract(bytes32 daoId, address board) external;

    function setDAODirectorAgent(bytes32 daoId, address directorAgent) external;

    function setDAOFeeConfig(bytes32 daoId, address feeConfig) external;

    // ============ Director Management ============

    function setDirectorPersona(bytes32 daoId, DirectorPersona calldata persona) external;

    function setDirectorModel(bytes32 daoId, bytes32 modelId) external;

    // ============ Board Management ============

    function addBoardMember(
        bytes32 daoId,
        address member,
        uint256 agentId,
        string calldata role,
        uint256 weight,
        bool isHuman
    ) external;

    function removeBoardMember(bytes32 daoId, address member) external;

    function updateBoardMemberWeight(bytes32 daoId, address member, uint256 weight) external;

    // ============ Package/Repo Linking ============

    function linkPackage(bytes32 daoId, bytes32 packageId) external;

    function unlinkPackage(bytes32 daoId, bytes32 packageId) external;

    function linkRepo(bytes32 daoId, bytes32 repoId) external;

    function unlinkRepo(bytes32 daoId, bytes32 repoId) external;

    // ============ Governance Parameters ============

    function setGovernanceParams(bytes32 daoId, GovernanceParams calldata params) external;

    // ============ View Functions ============

    function getDAO(bytes32 daoId) external view returns (DAO memory);

    function getDAOFull(bytes32 daoId) external view returns (DAOFull memory);

    function getDirectorPersona(bytes32 daoId) external view returns (DirectorPersona memory);

    function getGovernanceParams(bytes32 daoId) external view returns (GovernanceParams memory);

    function getBoardMembers(bytes32 daoId) external view returns (BoardMember[] memory);

    function getLinkedPackages(bytes32 daoId) external view returns (bytes32[] memory);

    function getLinkedRepos(bytes32 daoId) external view returns (bytes32[] memory);

    function isBoardMember(bytes32 daoId, address member) external view returns (bool);

    function getDAOByName(string calldata name) external view returns (DAO memory);

    function getAllDAOs() external view returns (bytes32[] memory);

    function getActiveDAOs() external view returns (bytes32[] memory);

    function daoExists(bytes32 daoId) external view returns (bool);

    function isDAOAdmin(bytes32 daoId, address admin) external view returns (bool);

    function getDAOCount() external view returns (uint256);

    function getPackageDAO(bytes32 packageId) external view returns (bytes32 daoId);

    function getRepoDAO(bytes32 repoId) external view returns (bytes32 daoId);
}
