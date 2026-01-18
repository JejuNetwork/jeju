// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDAORegistry} from "../governance/interfaces/IDAORegistry.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title AppFeeRegistry
 * @author Jeju Network
 * @notice Central registry linking apps to DAOs for fee attribution
 * @dev Apps that transact on Jeju receive a share of transaction fees.
 *
 * Core Principle: Fees go to apps and community, NOT the L2 network itself.
 *
 * Flow:
 * 1. App registers with a DAO (or standalone)
 * 2. App contract addresses are whitelisted
 * 3. When transactions occur, paymaster extracts app address
 * 4. FeeDistributor attributes fees to the registered app
 * 5. App can claim accumulated fees
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract AppFeeRegistry is Ownable, ReentrancyGuard {
    // ============ Structs ============

    struct RegisteredApp {
        bytes32 appId;
        bytes32 daoId; // Associated DAO (bytes32(0) for standalone apps)
        string name;
        string description;
        address primaryContract; // Main app contract
        address[] additionalContracts; // Other contracts that count as this app
        address feeRecipient; // Where fees should be sent (can be treasury, multisig, etc)
        uint256 agentId; // ERC-8004 agent ID (0 if not linked)
        uint256 createdAt;
        uint256 lastActivityAt;
        bool isActive;
        bool isVerified; // Verified by DAO admin or governance
    }

    struct AppStats {
        uint256 totalTransactions;
        uint256 totalFeesEarned;
        uint256 totalFeesClaimed;
        uint256 lastClaimAt;
    }

    // ============ Constants ============

    uint256 public constant MAX_CONTRACTS_PER_APP = 20;

    // ============ State ============

    IDAORegistry public daoRegistry;
    IIdentityRegistry public identityRegistry;
    address public feeDistributor;

    // App ID => App details
    mapping(bytes32 => RegisteredApp) private _apps;

    // App ID => Stats
    mapping(bytes32 => AppStats) private _appStats;

    // Contract address => App ID (for reverse lookup)
    mapping(address => bytes32) public contractToApp;

    // DAO ID => list of app IDs
    mapping(bytes32 => bytes32[]) private _daoApps;

    // Owner address => list of app IDs they own
    mapping(address => bytes32[]) private _ownerApps;

    // All app IDs
    bytes32[] private _allApps;

    // App ID => owner address
    mapping(bytes32 => address) public appOwner;

    // Authorized fee distributors that can update stats
    mapping(address => bool) public authorizedDistributors;

    // ============ Events ============

    event AppRegistered(
        bytes32 indexed appId,
        bytes32 indexed daoId,
        address indexed owner,
        string name,
        address primaryContract
    );

    event AppContractAdded(bytes32 indexed appId, address indexed contractAddr);
    event AppContractRemoved(bytes32 indexed appId, address indexed contractAddr);
    event AppVerified(bytes32 indexed appId, address verifiedBy);
    event AppDeactivated(bytes32 indexed appId, address deactivatedBy);
    event AppReactivated(bytes32 indexed appId, address reactivatedBy);
    event FeeRecipientUpdated(bytes32 indexed appId, address oldRecipient, address newRecipient);
    event AppAgentLinked(bytes32 indexed appId, uint256 agentId);
    event AppStatsUpdated(bytes32 indexed appId, uint256 transactions, uint256 feesEarned);
    event DistributorAuthorized(address indexed distributor, bool authorized);

    // ============ Errors ============

    error AppNotFound();
    error AppAlreadyExists();
    error NotAppOwner();
    error NotDAOAdmin();
    error NotAuthorized();
    error AppNotActive();
    error ContractAlreadyRegistered();
    error TooManyContracts();
    error InvalidAddress();
    error InvalidAgentId();
    error NotAgentOwner();

    // ============ Modifiers ============

    modifier onlyAppOwner(bytes32 appId) {
        if (appOwner[appId] != msg.sender && msg.sender != owner()) {
            revert NotAppOwner();
        }
        _;
    }

    modifier onlyDAOAdmin(bytes32 daoId) {
        if (daoId != bytes32(0) && !daoRegistry.isDAOAdmin(daoId, msg.sender)) {
            if (msg.sender != owner()) revert NotDAOAdmin();
        }
        _;
    }

    modifier appExists(bytes32 appId) {
        if (_apps[appId].createdAt == 0) revert AppNotFound();
        _;
    }

    modifier onlyAuthorizedDistributor() {
        if (!authorizedDistributors[msg.sender] && msg.sender != owner()) {
            revert NotAuthorized();
        }
        _;
    }

    // ============ Constructor ============

    constructor(address _daoRegistry, address _identityRegistry, address _owner) Ownable(_owner) {
        daoRegistry = IDAORegistry(_daoRegistry);
        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistry(_identityRegistry);
        }
    }

    // ============ App Registration ============

    /**
     * @notice Register a new app for fee eligibility
     * @param name App name
     * @param description App description
     * @param primaryContract Main contract address for the app
     * @param feeRecipient Address to receive fees
     * @param daoId Associated DAO (bytes32(0) for standalone)
     * @return appId Generated app ID
     */
    function registerApp(
        string calldata name,
        string calldata description,
        address primaryContract,
        address feeRecipient,
        bytes32 daoId
    ) external returns (bytes32 appId) {
        if (primaryContract == address(0)) revert InvalidAddress();
        if (feeRecipient == address(0)) revert InvalidAddress();
        if (contractToApp[primaryContract] != bytes32(0)) revert ContractAlreadyRegistered();

        // If DAO specified, verify caller is DAO admin
        if (daoId != bytes32(0)) {
            if (!daoRegistry.isDAOAdmin(daoId, msg.sender)) revert NotDAOAdmin();
        }

        appId = keccak256(abi.encodePacked(msg.sender, name, primaryContract, block.timestamp, block.chainid));

        if (_apps[appId].createdAt != 0) revert AppAlreadyExists();

        address[] memory emptyContracts;
        _apps[appId] = RegisteredApp({
            appId: appId,
            daoId: daoId,
            name: name,
            description: description,
            primaryContract: primaryContract,
            additionalContracts: emptyContracts,
            feeRecipient: feeRecipient,
            agentId: 0,
            createdAt: block.timestamp,
            lastActivityAt: block.timestamp,
            isActive: true,
            isVerified: daoId != bytes32(0) // Auto-verify if DAO app
        });

        contractToApp[primaryContract] = appId;
        appOwner[appId] = msg.sender;
        _allApps.push(appId);
        _ownerApps[msg.sender].push(appId);

        if (daoId != bytes32(0)) {
            _daoApps[daoId].push(appId);
        }

        emit AppRegistered(appId, daoId, msg.sender, name, primaryContract);
    }

    /**
     * @notice Add additional contract address to an app
     * @param appId App to add contract to
     * @param contractAddr Contract address to add
     */
    function addAppContract(bytes32 appId, address contractAddr)
        external
        appExists(appId)
        onlyAppOwner(appId)
    {
        if (contractAddr == address(0)) revert InvalidAddress();
        if (contractToApp[contractAddr] != bytes32(0)) revert ContractAlreadyRegistered();

        RegisteredApp storage app = _apps[appId];
        if (app.additionalContracts.length >= MAX_CONTRACTS_PER_APP) revert TooManyContracts();

        app.additionalContracts.push(contractAddr);
        contractToApp[contractAddr] = appId;

        emit AppContractAdded(appId, contractAddr);
    }

    /**
     * @notice Remove a contract from an app
     * @param appId App to remove contract from
     * @param contractAddr Contract address to remove
     */
    function removeAppContract(bytes32 appId, address contractAddr)
        external
        appExists(appId)
        onlyAppOwner(appId)
    {
        RegisteredApp storage app = _apps[appId];

        // Cannot remove primary contract
        if (app.primaryContract == contractAddr) revert NotAuthorized();

        // Find and remove from array
        uint256 len = app.additionalContracts.length;
        for (uint256 i = 0; i < len; i++) {
            if (app.additionalContracts[i] == contractAddr) {
                app.additionalContracts[i] = app.additionalContracts[len - 1];
                app.additionalContracts.pop();
                delete contractToApp[contractAddr];
                emit AppContractRemoved(appId, contractAddr);
                return;
            }
        }
    }

    /**
     * @notice Update fee recipient for an app
     * @param appId App to update
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(bytes32 appId, address newRecipient)
        external
        appExists(appId)
        onlyAppOwner(appId)
    {
        if (newRecipient == address(0)) revert InvalidAddress();

        address oldRecipient = _apps[appId].feeRecipient;
        _apps[appId].feeRecipient = newRecipient;

        emit FeeRecipientUpdated(appId, oldRecipient, newRecipient);
    }

    /**
     * @notice Link an ERC-8004 agent to the app
     * @param appId App to link
     * @param agentId Agent ID to link
     */
    function linkAgent(bytes32 appId, uint256 agentId)
        external
        appExists(appId)
        onlyAppOwner(appId)
    {
        if (address(identityRegistry) != address(0)) {
            if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
            if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        }

        _apps[appId].agentId = agentId;
        emit AppAgentLinked(appId, agentId);
    }

    /**
     * @notice Verify an app (only by DAO admin or governance)
     * @param appId App to verify
     */
    function verifyApp(bytes32 appId) external appExists(appId) {
        RegisteredApp storage app = _apps[appId];

        // Must be DAO admin (if DAO app) or contract owner
        if (app.daoId != bytes32(0)) {
            if (!daoRegistry.isDAOAdmin(app.daoId, msg.sender) && msg.sender != owner()) {
                revert NotDAOAdmin();
            }
        } else {
            if (msg.sender != owner()) revert NotAuthorized();
        }

        app.isVerified = true;
        emit AppVerified(appId, msg.sender);
    }

    /**
     * @notice Deactivate an app
     * @param appId App to deactivate
     */
    function deactivateApp(bytes32 appId) external appExists(appId) onlyAppOwner(appId) {
        _apps[appId].isActive = false;
        emit AppDeactivated(appId, msg.sender);
    }

    /**
     * @notice Reactivate an app
     * @param appId App to reactivate
     */
    function reactivateApp(bytes32 appId) external appExists(appId) onlyAppOwner(appId) {
        _apps[appId].isActive = true;
        emit AppReactivated(appId, msg.sender);
    }

    // ============ Fee Tracking (Called by FeeDistributor) ============

    /**
     * @notice Record fee distribution to an app
     * @param contractAddr Contract that generated the fee
     * @param amount Fee amount
     */
    function recordFeeDistribution(address contractAddr, uint256 amount)
        external
        onlyAuthorizedDistributor
    {
        bytes32 appId = contractToApp[contractAddr];
        if (appId == bytes32(0)) return; // Not a registered app contract

        RegisteredApp storage app = _apps[appId];
        if (!app.isActive) return;

        AppStats storage stats = _appStats[appId];
        stats.totalTransactions++;
        stats.totalFeesEarned += amount;
        app.lastActivityAt = block.timestamp;

        emit AppStatsUpdated(appId, stats.totalTransactions, stats.totalFeesEarned);
    }

    /**
     * @notice Record that fees were claimed
     * @param appId App that claimed fees
     * @param amount Amount claimed
     */
    function recordFeeClaim(bytes32 appId, uint256 amount)
        external
        onlyAuthorizedDistributor
    {
        AppStats storage stats = _appStats[appId];
        stats.totalFeesClaimed += amount;
        stats.lastClaimAt = block.timestamp;
    }

    // ============ View Functions ============

    /**
     * @notice Get app details by ID
     * @param appId App ID
     * @return App details
     */
    function getApp(bytes32 appId) external view returns (RegisteredApp memory) {
        return _apps[appId];
    }

    /**
     * @notice Get app stats by ID
     * @param appId App ID
     * @return Stats
     */
    function getAppStats(bytes32 appId) external view returns (AppStats memory) {
        return _appStats[appId];
    }

    /**
     * @notice Get app ID for a contract address
     * @param contractAddr Contract address
     * @return appId App ID (bytes32(0) if not registered)
     */
    function getAppForContract(address contractAddr) external view returns (bytes32) {
        return contractToApp[contractAddr];
    }

    /**
     * @notice Get fee recipient for a contract address
     * @param contractAddr Contract address
     * @return recipient Fee recipient address (address(0) if not registered)
     */
    function getFeeRecipient(address contractAddr) external view returns (address recipient) {
        bytes32 appId = contractToApp[contractAddr];
        if (appId == bytes32(0)) return address(0);

        RegisteredApp storage app = _apps[appId];
        if (!app.isActive) return address(0);

        return app.feeRecipient;
    }

    /**
     * @notice Check if a contract is registered and eligible for fees
     * @param contractAddr Contract to check
     * @return eligible True if contract can receive fees
     */
    function isEligibleForFees(address contractAddr) external view returns (bool eligible) {
        bytes32 appId = contractToApp[contractAddr];
        if (appId == bytes32(0)) return false;

        RegisteredApp storage app = _apps[appId];
        return app.isActive;
    }

    /**
     * @notice Get all apps for a DAO
     * @param daoId DAO ID
     * @return appIds Array of app IDs
     */
    function getDAOApps(bytes32 daoId) external view returns (bytes32[] memory) {
        return _daoApps[daoId];
    }

    /**
     * @notice Get all apps owned by an address
     * @param ownerAddr Owner address
     * @return appIds Array of app IDs
     */
    function getOwnerApps(address ownerAddr) external view returns (bytes32[] memory) {
        return _ownerApps[ownerAddr];
    }

    /**
     * @notice Get total number of registered apps
     * @return count Number of apps
     */
    function getAppCount() external view returns (uint256) {
        return _allApps.length;
    }

    /**
     * @notice Get all contracts for an app
     * @param appId App ID
     * @return primaryContract Primary contract
     * @return additionalContracts Additional contracts
     */
    function getAppContracts(bytes32 appId)
        external
        view
        returns (address primaryContract, address[] memory additionalContracts)
    {
        RegisteredApp storage app = _apps[appId];
        return (app.primaryContract, app.additionalContracts);
    }

    // ============ Admin Functions ============

    /**
     * @notice Authorize a fee distributor to update stats
     * @param distributor Distributor address
     * @param authorized Authorization status
     */
    function setDistributorAuthorized(address distributor, bool authorized) external onlyOwner {
        authorizedDistributors[distributor] = authorized;
        emit DistributorAuthorized(distributor, authorized);
    }

    /**
     * @notice Set fee distributor address
     * @param _feeDistributor New fee distributor
     */
    function setFeeDistributor(address _feeDistributor) external onlyOwner {
        feeDistributor = _feeDistributor;
        authorizedDistributors[_feeDistributor] = true;
    }

    /**
     * @notice Update DAO registry
     * @param _daoRegistry New DAO registry
     */
    function setDAORegistry(address _daoRegistry) external onlyOwner {
        daoRegistry = IDAORegistry(_daoRegistry);
    }

    /**
     * @notice Update identity registry
     * @param _identityRegistry New identity registry
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    /**
     * @notice Get contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}


