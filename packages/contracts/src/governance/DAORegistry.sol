// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDAORegistry} from "./interfaces/IDAORegistry.sol";

/**
 * @title DAORegistry
 * @author Jeju Network
 * @notice Multi-tenant DAO management for Jeju Network
 * @dev Manages multiple DAOs with their own governance, treasury, and Director configurations
 *
 * Terminology:
 * - Director: The AI or human executive decision maker (formerly CEO)
 * - Board: The advisory/oversight body (formerly Council)
 *
 * Key Features:
 * - Multi-tenant DAO support (Jeju DAO, Apps DAO, custom DAOs)
 * - Director persona management (name, pfp, personality, human/AI flag)
 * - Board member management with weighted voting and human/AI parity
 * - Package and repo linking for deep funding
 * - Configurable governance parameters per DAO
 *
 * Access Control:
 * - Owner: Global admin (can create DAOs, emergency functions)
 * - DAO Admin: Can manage their specific DAO (set via board contract)
 * - Board Members: Can vote on DAO proposals
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract DAORegistry is IDAORegistry, Ownable, Pausable, ReentrancyGuard {
    // ============ State Variables ============

    /// @notice All DAOs by ID
    mapping(bytes32 => DAO) private _daos;

    /// @notice DAO name to ID mapping
    mapping(bytes32 => bytes32) private _nameToDAO;

    /// @notice Director personas per DAO
    mapping(bytes32 => DirectorPersona) private _directorPersonas;

    /// @notice Governance parameters per DAO
    mapping(bytes32 => GovernanceParams) private _governanceParams;

    /// @notice Board members per DAO
    mapping(bytes32 => mapping(address => BoardMember)) private _boardMembers;

    /// @notice Board member addresses per DAO (for enumeration)
    mapping(bytes32 => address[]) private _boardMemberAddresses;

    /// @notice Linked packages per DAO
    mapping(bytes32 => bytes32[]) private _linkedPackages;

    /// @notice Package to DAO mapping (reverse lookup)
    mapping(bytes32 => bytes32) private _packageToDAO;

    /// @notice Linked repos per DAO
    mapping(bytes32 => bytes32[]) private _linkedRepos;

    /// @notice Repo to DAO mapping (reverse lookup)
    mapping(bytes32 => bytes32) private _repoToDAO;

    /// @notice All DAO IDs
    bytes32[] private _allDAOIds;

    /// @notice DAO admins (can manage specific DAOs)
    mapping(bytes32 => mapping(address => bool)) private _daoAdmins;

    /// @notice Default governance parameters
    GovernanceParams public defaultParams;

    // ============ Errors ============

    error DAOAlreadyExists();
    error DAONotFound();
    error NotAuthorized();
    error InvalidName();
    error InvalidAddress();
    error MemberAlreadyExists();
    error MemberNotFound();
    error PackageAlreadyLinked();
    error PackageNotLinked();
    error RepoAlreadyLinked();
    error RepoNotLinked();
    error InvalidWeight();
    error InvalidParams();
    error DAONotActive();
    error InvalidFallbackDays();

    // ============ Modifiers ============

    modifier onlyDAOAdmin(bytes32 daoId) {
        if (!_isDAOAdmin(daoId, msg.sender)) revert NotAuthorized();
        _;
    }

    modifier onlyExistingDAO(bytes32 daoId) {
        if (_daos[daoId].createdAt == 0) revert DAONotFound();
        _;
    }

    modifier daoActive(bytes32 daoId) {
        if (_daos[daoId].status != DAOStatus.ACTIVE) revert DAONotActive();
        _;
    }

    // ============ Constructor ============

    constructor(address initialOwner) Ownable(initialOwner) {
        defaultParams = GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000 // 50%
        });
    }

    // ============ DAO Management ============

    /**
     * @notice Create a new DAO
     * @param name Unique identifier name (lowercase, no spaces)
     * @param displayName Human-readable display name
     * @param description DAO description
     * @param treasury Treasury contract address
     * @param manifestCid IPFS CID of jeju-manifest.json
     * @param directorPersona Director persona configuration
     * @param params Governance parameters
     * @return daoId The created DAO ID
     */
    function createDAO(
        string calldata name,
        string calldata displayName,
        string calldata description,
        address treasury,
        string calldata manifestCid,
        DirectorPersona calldata directorPersona,
        GovernanceParams calldata params
    ) external whenNotPaused nonReentrant returns (bytes32 daoId) {
        if (bytes(name).length == 0 || bytes(name).length > 32) revert InvalidName();
        if (!_isValidName(name)) revert InvalidName();
        if (treasury == address(0)) revert InvalidAddress();
        if (directorPersona.decisionFallbackDays > 30) revert InvalidFallbackDays();

        bytes32 nameHash = keccak256(bytes(name));
        if (_nameToDAO[nameHash] != bytes32(0)) revert DAOAlreadyExists();

        daoId = keccak256(abi.encodePacked(name, block.timestamp, msg.sender));

        _daos[daoId] = DAO({
            daoId: daoId,
            name: name,
            displayName: displayName,
            description: description,
            treasury: treasury,
            board: address(0),
            directorAgent: address(0),
            feeConfig: address(0),
            directorModelId: bytes32(0),
            manifestCid: manifestCid,
            status: DAOStatus.ACTIVE,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            creator: msg.sender
        });

        _directorPersonas[daoId] = DirectorPersona({
            name: directorPersona.name,
            pfpCid: directorPersona.pfpCid,
            description: directorPersona.description,
            personality: directorPersona.personality,
            traits: directorPersona.traits,
            isHuman: directorPersona.isHuman,
            humanAddress: directorPersona.humanAddress,
            agentId: directorPersona.agentId,
            decisionFallbackDays: directorPersona.decisionFallbackDays
        });

        _governanceParams[daoId] = GovernanceParams({
            minQualityScore: params.minQualityScore > 0 ? params.minQualityScore : defaultParams.minQualityScore,
            boardVotingPeriod: params.boardVotingPeriod > 0 ? params.boardVotingPeriod : defaultParams.boardVotingPeriod,
            gracePeriod: params.gracePeriod > 0 ? params.gracePeriod : defaultParams.gracePeriod,
            minProposalStake: params.minProposalStake,
            quorumBps: params.quorumBps > 0 ? params.quorumBps : defaultParams.quorumBps
        });

        _nameToDAO[nameHash] = daoId;
        _allDAOIds.push(daoId);
        _daoAdmins[daoId][msg.sender] = true;

        emit DAOCreated(daoId, name, treasury, msg.sender);
        emit DirectorPersonaUpdated(daoId, directorPersona.name, directorPersona.pfpCid, directorPersona.isHuman);
        // Legacy event for backwards compatibility
        emit CEOPersonaUpdated(daoId, directorPersona.name, directorPersona.pfpCid);
    }

    /**
     * @notice Update DAO metadata
     */
    function updateDAO(
        bytes32 daoId,
        string calldata displayName,
        string calldata description,
        string calldata manifestCid
    ) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        DAO storage dao = _daos[daoId];
        dao.displayName = displayName;
        dao.description = description;
        dao.manifestCid = manifestCid;
        dao.updatedAt = block.timestamp;

        emit DAOUpdated(daoId, "metadata", abi.encode(displayName, description, manifestCid));
    }

    /**
     * @notice Set DAO status
     */
    function setDAOStatus(bytes32 daoId, DAOStatus status) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        DAO storage dao = _daos[daoId];
        DAOStatus oldStatus = dao.status;
        dao.status = status;
        dao.updatedAt = block.timestamp;

        emit DAOStatusChanged(daoId, oldStatus, status);
    }

    /**
     * @notice Set DAO treasury address
     */
    function setDAOTreasury(bytes32 daoId, address treasury) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        if (treasury == address(0)) revert InvalidAddress();
        _daos[daoId].treasury = treasury;
        _daos[daoId].updatedAt = block.timestamp;

        emit DAOUpdated(daoId, "treasury", abi.encode(treasury));
    }

    /**
     * @notice Set DAO board contract address
     */
    function setDAOBoardContract(bytes32 daoId, address board) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        _daos[daoId].board = board;
        _daos[daoId].updatedAt = block.timestamp;

        emit DAOUpdated(daoId, "board", abi.encode(board));
    }

    /**
     * @notice Set DAO board contract address (legacy alias)
     */
    function setDAOCouncilContract(bytes32 daoId, address council) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        _daos[daoId].board = council;
        _daos[daoId].updatedAt = block.timestamp;

        emit DAOUpdated(daoId, "board", abi.encode(council));
    }

    /**
     * @notice Set DAO Director agent contract address
     */
    function setDAODirectorAgent(bytes32 daoId, address directorAgent)
        external
        onlyExistingDAO(daoId)
        onlyDAOAdmin(daoId)
    {
        _daos[daoId].directorAgent = directorAgent;
        _daos[daoId].updatedAt = block.timestamp;

        emit DAOUpdated(daoId, "directorAgent", abi.encode(directorAgent));
    }

    /**
     * @notice Set DAO CEO agent contract address (legacy alias)
     */
    function setDAOCEOAgent(bytes32 daoId, address ceoAgent) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        _daos[daoId].directorAgent = ceoAgent;
        _daos[daoId].updatedAt = block.timestamp;

        emit DAOUpdated(daoId, "directorAgent", abi.encode(ceoAgent));
    }

    /**
     * @notice Set DAO fee config contract address
     */
    function setDAOFeeConfig(bytes32 daoId, address feeConfig) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        _daos[daoId].feeConfig = feeConfig;
        _daos[daoId].updatedAt = block.timestamp;

        emit DAOUpdated(daoId, "feeConfig", abi.encode(feeConfig));
    }

    // ============ Director Management ============

    /**
     * @notice Update Director persona
     */
    function setDirectorPersona(bytes32 daoId, DirectorPersona calldata persona)
        external
        onlyExistingDAO(daoId)
        onlyDAOAdmin(daoId)
    {
        if (persona.decisionFallbackDays > 30) revert InvalidFallbackDays();

        _directorPersonas[daoId] = DirectorPersona({
            name: persona.name,
            pfpCid: persona.pfpCid,
            description: persona.description,
            personality: persona.personality,
            traits: persona.traits,
            isHuman: persona.isHuman,
            humanAddress: persona.humanAddress,
            agentId: persona.agentId,
            decisionFallbackDays: persona.decisionFallbackDays
        });
        _daos[daoId].updatedAt = block.timestamp;

        emit DirectorPersonaUpdated(daoId, persona.name, persona.pfpCid, persona.isHuman);
        // Legacy event
        emit CEOPersonaUpdated(daoId, persona.name, persona.pfpCid);
    }

    /**
     * @notice Update CEO persona (legacy alias)
     */
    function setCEOPersona(bytes32 daoId, DirectorPersona calldata persona)
        external
        onlyExistingDAO(daoId)
        onlyDAOAdmin(daoId)
    {
        if (persona.decisionFallbackDays > 30) revert InvalidFallbackDays();

        _directorPersonas[daoId] = DirectorPersona({
            name: persona.name,
            pfpCid: persona.pfpCid,
            description: persona.description,
            personality: persona.personality,
            traits: persona.traits,
            isHuman: persona.isHuman,
            humanAddress: persona.humanAddress,
            agentId: persona.agentId,
            decisionFallbackDays: persona.decisionFallbackDays
        });
        _daos[daoId].updatedAt = block.timestamp;

        emit DirectorPersonaUpdated(daoId, persona.name, persona.pfpCid, persona.isHuman);
        emit CEOPersonaUpdated(daoId, persona.name, persona.pfpCid);
    }

    /**
     * @notice Set Director model (from ModelRegistry)
     */
    function setDirectorModel(bytes32 daoId, bytes32 modelId) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        bytes32 oldModel = _daos[daoId].directorModelId;
        _daos[daoId].directorModelId = modelId;
        _daos[daoId].updatedAt = block.timestamp;

        emit DirectorModelChanged(daoId, oldModel, modelId);
        // Legacy event
        emit CEOModelChanged(daoId, oldModel, modelId);
    }

    /**
     * @notice Set CEO model (legacy alias)
     */
    function setCEOModel(bytes32 daoId, bytes32 modelId) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        bytes32 oldModel = _daos[daoId].directorModelId;
        _daos[daoId].directorModelId = modelId;
        _daos[daoId].updatedAt = block.timestamp;

        emit DirectorModelChanged(daoId, oldModel, modelId);
        emit CEOModelChanged(daoId, oldModel, modelId);
    }

    // ============ Board Management ============

    /**
     * @notice Add a board member
     */
    function addBoardMember(
        bytes32 daoId,
        address member,
        uint256 agentId,
        string calldata role,
        uint256 weight,
        bool isHuman
    ) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        if (member == address(0)) revert InvalidAddress();
        if (weight == 0 || weight > 10000) revert InvalidWeight();
        if (_boardMembers[daoId][member].addedAt != 0) revert MemberAlreadyExists();

        _boardMembers[daoId][member] = BoardMember({
            member: member,
            agentId: agentId,
            role: role,
            weight: weight,
            addedAt: block.timestamp,
            isActive: true,
            isHuman: isHuman
        });

        _boardMemberAddresses[daoId].push(member);
        _daos[daoId].updatedAt = block.timestamp;

        emit BoardMemberAdded(daoId, member, role, weight, isHuman);
        // Legacy event
        emit CouncilMemberAdded(daoId, member, role, weight);
    }

    /**
     * @notice Add a council member (legacy alias)
     */
    function addCouncilMember(bytes32 daoId, address member, uint256 agentId, string calldata role, uint256 weight)
        external
        onlyExistingDAO(daoId)
        onlyDAOAdmin(daoId)
    {
        if (member == address(0)) revert InvalidAddress();
        if (weight == 0 || weight > 10000) revert InvalidWeight();
        if (_boardMembers[daoId][member].addedAt != 0) revert MemberAlreadyExists();

        // Default to AI (agentId > 0 implies AI)
        bool isHuman = agentId == 0;

        _boardMembers[daoId][member] = BoardMember({
            member: member,
            agentId: agentId,
            role: role,
            weight: weight,
            addedAt: block.timestamp,
            isActive: true,
            isHuman: isHuman
        });

        _boardMemberAddresses[daoId].push(member);
        _daos[daoId].updatedAt = block.timestamp;

        emit BoardMemberAdded(daoId, member, role, weight, isHuman);
        emit CouncilMemberAdded(daoId, member, role, weight);
    }

    /**
     * @notice Remove a board member
     */
    function removeBoardMember(bytes32 daoId, address member) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        if (_boardMembers[daoId][member].addedAt == 0) revert MemberNotFound();

        _boardMembers[daoId][member].isActive = false;
        _daos[daoId].updatedAt = block.timestamp;

        emit BoardMemberRemoved(daoId, member);
        // Legacy event
        emit CouncilMemberRemoved(daoId, member);
    }

    /**
     * @notice Remove a council member (legacy alias)
     */
    function removeCouncilMember(bytes32 daoId, address member) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        if (_boardMembers[daoId][member].addedAt == 0) revert MemberNotFound();

        _boardMembers[daoId][member].isActive = false;
        _daos[daoId].updatedAt = block.timestamp;

        emit BoardMemberRemoved(daoId, member);
        emit CouncilMemberRemoved(daoId, member);
    }

    /**
     * @notice Update board member weight
     */
    function updateBoardMemberWeight(bytes32 daoId, address member, uint256 weight)
        external
        onlyExistingDAO(daoId)
        onlyDAOAdmin(daoId)
    {
        if (_boardMembers[daoId][member].addedAt == 0) revert MemberNotFound();
        if (weight == 0 || weight > 10000) revert InvalidWeight();

        _boardMembers[daoId][member].weight = weight;
        _daos[daoId].updatedAt = block.timestamp;

        emit BoardMemberUpdated(daoId, member, weight);
        // Legacy event
        emit CouncilMemberUpdated(daoId, member, weight);
    }

    /**
     * @notice Update council member weight (legacy alias)
     */
    function updateCouncilMemberWeight(bytes32 daoId, address member, uint256 weight)
        external
        onlyExistingDAO(daoId)
        onlyDAOAdmin(daoId)
    {
        if (_boardMembers[daoId][member].addedAt == 0) revert MemberNotFound();
        if (weight == 0 || weight > 10000) revert InvalidWeight();

        _boardMembers[daoId][member].weight = weight;
        _daos[daoId].updatedAt = block.timestamp;

        emit BoardMemberUpdated(daoId, member, weight);
        emit CouncilMemberUpdated(daoId, member, weight);
    }

    // ============ Package/Repo Linking ============

    /**
     * @notice Link a package to a DAO
     */
    function linkPackage(bytes32 daoId, bytes32 packageId)
        external
        onlyExistingDAO(daoId)
        daoActive(daoId)
        onlyDAOAdmin(daoId)
    {
        if (_packageToDAO[packageId] != bytes32(0)) revert PackageAlreadyLinked();

        _linkedPackages[daoId].push(packageId);
        _packageToDAO[packageId] = daoId;
        _daos[daoId].updatedAt = block.timestamp;

        emit PackageLinked(daoId, packageId);
    }

    /**
     * @notice Unlink a package from a DAO
     */
    function unlinkPackage(bytes32 daoId, bytes32 packageId) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        if (_packageToDAO[packageId] != daoId) revert PackageNotLinked();

        bytes32[] storage packages = _linkedPackages[daoId];
        for (uint256 i = 0; i < packages.length; i++) {
            if (packages[i] == packageId) {
                packages[i] = packages[packages.length - 1];
                packages.pop();
                break;
            }
        }

        delete _packageToDAO[packageId];
        _daos[daoId].updatedAt = block.timestamp;

        emit PackageUnlinked(daoId, packageId);
    }

    /**
     * @notice Link a repo to a DAO
     */
    function linkRepo(bytes32 daoId, bytes32 repoId)
        external
        onlyExistingDAO(daoId)
        daoActive(daoId)
        onlyDAOAdmin(daoId)
    {
        if (_repoToDAO[repoId] != bytes32(0)) revert RepoAlreadyLinked();

        _linkedRepos[daoId].push(repoId);
        _repoToDAO[repoId] = daoId;
        _daos[daoId].updatedAt = block.timestamp;

        emit RepoLinked(daoId, repoId);
    }

    /**
     * @notice Unlink a repo from a DAO
     */
    function unlinkRepo(bytes32 daoId, bytes32 repoId) external onlyExistingDAO(daoId) onlyDAOAdmin(daoId) {
        if (_repoToDAO[repoId] != daoId) revert RepoNotLinked();

        bytes32[] storage repos = _linkedRepos[daoId];
        for (uint256 i = 0; i < repos.length; i++) {
            if (repos[i] == repoId) {
                repos[i] = repos[repos.length - 1];
                repos.pop();
                break;
            }
        }

        delete _repoToDAO[repoId];
        _daos[daoId].updatedAt = block.timestamp;

        emit RepoUnlinked(daoId, repoId);
    }

    // ============ Governance Parameters ============

    /**
     * @notice Set governance parameters for a DAO
     */
    function setGovernanceParams(bytes32 daoId, GovernanceParams calldata params)
        external
        onlyExistingDAO(daoId)
        onlyDAOAdmin(daoId)
    {
        if (params.quorumBps > 10000) revert InvalidParams();

        _governanceParams[daoId] = params;
        _daos[daoId].updatedAt = block.timestamp;

        emit GovernanceParamsUpdated(daoId);
    }

    // ============ View Functions ============

    /**
     * @notice Get DAO by ID
     */
    function getDAO(bytes32 daoId) external view returns (DAO memory) {
        return _daos[daoId];
    }

    /**
     * @notice Get full DAO with all related data
     */
    function getDAOFull(bytes32 daoId) external view returns (DAOFull memory) {
        DAO memory dao = _daos[daoId];
        DirectorPersona memory persona = _directorPersonas[daoId];
        GovernanceParams memory params = _governanceParams[daoId];

        address[] memory memberAddrs = _boardMemberAddresses[daoId];
        BoardMember[] memory members = new BoardMember[](memberAddrs.length);
        uint256 activeCount = 0;

        for (uint256 i = 0; i < memberAddrs.length; i++) {
            BoardMember memory m = _boardMembers[daoId][memberAddrs[i]];
            if (m.isActive) {
                members[activeCount] = m;
                activeCount++;
            }
        }

        // Resize array to active members only
        BoardMember[] memory activeMembers = new BoardMember[](activeCount);
        for (uint256 i = 0; i < activeCount; i++) {
            activeMembers[i] = members[i];
        }

        return DAOFull({
            dao: dao,
            directorPersona: persona,
            params: params,
            boardMembers: activeMembers,
            linkedPackages: _linkedPackages[daoId],
            linkedRepos: _linkedRepos[daoId]
        });
    }

    /**
     * @notice Get Director persona for a DAO
     */
    function getDirectorPersona(bytes32 daoId) external view returns (DirectorPersona memory) {
        return _directorPersonas[daoId];
    }

    /**
     * @notice Get CEO persona for a DAO (legacy alias)
     */
    function getCEOPersona(bytes32 daoId) external view returns (DirectorPersona memory) {
        return _directorPersonas[daoId];
    }

    /**
     * @notice Get governance parameters for a DAO
     */
    function getGovernanceParams(bytes32 daoId) external view returns (GovernanceParams memory) {
        return _governanceParams[daoId];
    }

    /**
     * @notice Get board members for a DAO
     */
    function getBoardMembers(bytes32 daoId) external view returns (BoardMember[] memory) {
        address[] memory addrs = _boardMemberAddresses[daoId];
        BoardMember[] memory members = new BoardMember[](addrs.length);
        uint256 activeCount = 0;

        for (uint256 i = 0; i < addrs.length; i++) {
            BoardMember memory m = _boardMembers[daoId][addrs[i]];
            if (m.isActive) {
                members[activeCount] = m;
                activeCount++;
            }
        }

        BoardMember[] memory result = new BoardMember[](activeCount);
        for (uint256 i = 0; i < activeCount; i++) {
            result[i] = members[i];
        }

        return result;
    }

    /**
     * @notice Get council members for a DAO (legacy alias)
     */
    function getCouncilMembers(bytes32 daoId) external view returns (BoardMember[] memory) {
        address[] memory addrs = _boardMemberAddresses[daoId];
        BoardMember[] memory members = new BoardMember[](addrs.length);
        uint256 activeCount = 0;

        for (uint256 i = 0; i < addrs.length; i++) {
            BoardMember memory m = _boardMembers[daoId][addrs[i]];
            if (m.isActive) {
                members[activeCount] = m;
                activeCount++;
            }
        }

        BoardMember[] memory result = new BoardMember[](activeCount);
        for (uint256 i = 0; i < activeCount; i++) {
            result[i] = members[i];
        }

        return result;
    }

    /**
     * @notice Get linked packages for a DAO
     */
    function getLinkedPackages(bytes32 daoId) external view returns (bytes32[] memory) {
        return _linkedPackages[daoId];
    }

    /**
     * @notice Get linked repos for a DAO
     */
    function getLinkedRepos(bytes32 daoId) external view returns (bytes32[] memory) {
        return _linkedRepos[daoId];
    }

    /**
     * @notice Check if address is board member
     */
    function isBoardMember(bytes32 daoId, address member) external view returns (bool) {
        return _boardMembers[daoId][member].isActive;
    }

    /**
     * @notice Check if address is council member (legacy alias)
     */
    function isCouncilMember(bytes32 daoId, address member) external view returns (bool) {
        return _boardMembers[daoId][member].isActive;
    }

    /**
     * @notice Get DAO by name
     */
    function getDAOByName(string calldata name) external view returns (DAO memory) {
        bytes32 nameHash = keccak256(bytes(name));
        bytes32 daoId = _nameToDAO[nameHash];
        return _daos[daoId];
    }

    /**
     * @notice Get all DAO IDs
     */
    function getAllDAOs() external view returns (bytes32[] memory) {
        return _allDAOIds;
    }

    /**
     * @notice Get all active DAO IDs
     */
    function getActiveDAOs() external view returns (bytes32[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _allDAOIds.length; i++) {
            if (_daos[_allDAOIds[i]].status == DAOStatus.ACTIVE) {
                activeCount++;
            }
        }

        bytes32[] memory result = new bytes32[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < _allDAOIds.length; i++) {
            if (_daos[_allDAOIds[i]].status == DAOStatus.ACTIVE) {
                result[index] = _allDAOIds[i];
                index++;
            }
        }

        return result;
    }

    /**
     * @notice Check if DAO exists
     */
    function daoExists(bytes32 daoId) external view returns (bool) {
        return _daos[daoId].createdAt != 0;
    }

    /**
     * @notice Get DAO count
     */
    function getDAOCount() external view returns (uint256) {
        return _allDAOIds.length;
    }

    /**
     * @notice Get DAO for a package
     */
    function getPackageDAO(bytes32 packageId) external view returns (bytes32) {
        return _packageToDAO[packageId];
    }

    /**
     * @notice Get DAO for a repo
     */
    function getRepoDAO(bytes32 repoId) external view returns (bytes32) {
        return _repoToDAO[repoId];
    }

    // ============ Admin Functions ============

    /**
     * @notice Add DAO admin
     */
    function addDAOAdmin(bytes32 daoId, address admin) external onlyExistingDAO(daoId) {
        if (!_isDAOAdmin(daoId, msg.sender) && msg.sender != owner()) revert NotAuthorized();
        if (admin == address(0)) revert InvalidAddress();

        _daoAdmins[daoId][admin] = true;
    }

    /**
     * @notice Remove DAO admin
     */
    function removeDAOAdmin(bytes32 daoId, address admin) external onlyExistingDAO(daoId) {
        if (!_isDAOAdmin(daoId, msg.sender) && msg.sender != owner()) revert NotAuthorized();

        _daoAdmins[daoId][admin] = false;
    }

    /**
     * @notice Check if address is DAO admin
     */
    function isDAOAdmin(bytes32 daoId, address admin) external view returns (bool) {
        return _isDAOAdmin(daoId, admin);
    }

    /**
     * @notice Set default governance parameters
     */
    function setDefaultParams(GovernanceParams calldata params) external onlyOwner {
        if (params.quorumBps > 10000) revert InvalidParams();
        defaultParams = params;
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    // ============ Internal Functions ============

    /**
     * @notice Check if address is DAO admin
     */
    function _isDAOAdmin(bytes32 daoId, address admin) internal view returns (bool) {
        if (admin == owner()) return true;
        if (_daoAdmins[daoId][admin]) return true;
        if (_daos[daoId].creator == admin) return true;

        // Board contract is also an admin
        if (_daos[daoId].board != address(0) && _daos[daoId].board == admin) return true;

        return false;
    }

    /**
     * @notice Validate DAO name (lowercase, alphanumeric, hyphens)
     */
    function _isValidName(string calldata name) internal pure returns (bool) {
        bytes memory nameBytes = bytes(name);
        if (nameBytes.length == 0) return false;

        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];
            bool isValid = (char >= 0x30 && char <= 0x39) // 0-9
                || (char >= 0x61 && char <= 0x7A) // a-z
                || char == 0x2D; // -
            if (!isValid) return false;
        }

        // Cannot start or end with hyphen
        if (nameBytes[0] == 0x2D || nameBytes[nameBytes.length - 1] == 0x2D) return false;

        return true;
    }
}
