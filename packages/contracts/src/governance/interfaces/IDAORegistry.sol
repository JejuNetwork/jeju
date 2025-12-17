// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IDAORegistry
 * @author Jeju Network
 * @notice Interface for multi-tenant DAO management
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
        CEO_MODEL_CHANGE
    }

    // ============ Structs ============

    struct CEOPersona {
        string name;
        string pfpCid;
        string description;
        string personality;
        string[] traits;
    }

    struct CouncilMember {
        address member;
        uint256 agentId;
        string role;
        uint256 weight;
        uint256 addedAt;
        bool isActive;
    }

    struct GovernanceParams {
        uint256 minQualityScore;
        uint256 councilVotingPeriod;
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
        address council;
        address ceoAgent;
        address feeConfig;
        bytes32 ceoModelId;
        string manifestCid;
        DAOStatus status;
        uint256 createdAt;
        uint256 updatedAt;
        address creator;
    }

    struct DAOFull {
        DAO dao;
        CEOPersona ceoPersona;
        GovernanceParams params;
        CouncilMember[] councilMembers;
        bytes32[] linkedPackages;
        bytes32[] linkedRepos;
    }

    // ============ Events ============

    event DAOCreated(
        bytes32 indexed daoId,
        string name,
        address indexed treasury,
        address indexed creator
    );
    event DAOUpdated(bytes32 indexed daoId, string field, bytes newValue);
    event DAOStatusChanged(bytes32 indexed daoId, DAOStatus oldStatus, DAOStatus newStatus);
    event CEOPersonaUpdated(bytes32 indexed daoId, string name, string pfpCid);
    event CEOModelChanged(bytes32 indexed daoId, bytes32 oldModel, bytes32 newModel);
    event CouncilMemberAdded(bytes32 indexed daoId, address indexed member, string role, uint256 weight);
    event CouncilMemberRemoved(bytes32 indexed daoId, address indexed member);
    event CouncilMemberUpdated(bytes32 indexed daoId, address indexed member, uint256 newWeight);
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
        CEOPersona calldata ceoPersona,
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

    function setDAOCouncilContract(bytes32 daoId, address council) external;

    function setDAOCEOAgent(bytes32 daoId, address ceoAgent) external;

    function setDAOFeeConfig(bytes32 daoId, address feeConfig) external;

    // ============ CEO Management ============

    function setCEOPersona(bytes32 daoId, CEOPersona calldata persona) external;

    function setCEOModel(bytes32 daoId, bytes32 modelId) external;

    // ============ Council Management ============

    function addCouncilMember(
        bytes32 daoId,
        address member,
        uint256 agentId,
        string calldata role,
        uint256 weight
    ) external;

    function removeCouncilMember(bytes32 daoId, address member) external;

    function updateCouncilMemberWeight(bytes32 daoId, address member, uint256 weight) external;

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

    function getCEOPersona(bytes32 daoId) external view returns (CEOPersona memory);

    function getGovernanceParams(bytes32 daoId) external view returns (GovernanceParams memory);

    function getCouncilMembers(bytes32 daoId) external view returns (CouncilMember[] memory);

    function getLinkedPackages(bytes32 daoId) external view returns (bytes32[] memory);

    function getLinkedRepos(bytes32 daoId) external view returns (bytes32[] memory);

    function isCouncilMember(bytes32 daoId, address member) external view returns (bool);

    function getDAOByName(string calldata name) external view returns (DAO memory);

    function getAllDAOs() external view returns (bytes32[] memory);

    function getActiveDAOs() external view returns (bytes32[] memory);

    function daoExists(bytes32 daoId) external view returns (bool);

    function isDAOAdmin(bytes32 daoId, address admin) external view returns (bool);

    function getDAOCount() external view returns (uint256);

    function getPackageDAO(bytes32 packageId) external view returns (bytes32 daoId);

    function getRepoDAO(bytes32 repoId) external view returns (bytes32 daoId);
}

