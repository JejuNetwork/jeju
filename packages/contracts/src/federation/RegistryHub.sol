// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title RegistryHub
 * @author Jeju Network
 * @notice Meta-registry tracking all registries across the Jeju Federation
 * @dev Deployed on Ethereum L1 as canonical source of truth for all networks
 *
 * ## Architecture
 * - Tracks registries across EVM chains and Solana
 * - Event-driven: emits events for indexer to aggregate
 * - Lightweight: stores pointers, not data
 * - Wormhole integration for Solana verification
 *
 * ## Registry Types
 * - Identity (ERC-8004)
 * - Compute (providers, models, jobs)
 * - Storage (IPFS providers)
 * - Solver (OIF solvers)
 * - Package (npm-like registry)
 * - Container (Docker registry)
 *
 * ## Trust Tiers
 * - UNSTAKED: Listed but not trusted for consensus
 * - STAKED: 1+ ETH stake, trusted for federation
 * - VERIFIED: Governance-approved, full trust
 */
contract RegistryHub is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============================================================================
    // Types
    // ============================================================================

    enum ChainType {
        EVM,
        SOLANA,
        COSMOS,
        OTHER
    }

    enum RegistryType {
        IDENTITY,
        COMPUTE,
        STORAGE,
        SOLVER,
        PACKAGE,
        CONTAINER,
        MODEL,
        NAME_SERVICE,
        REPUTATION,
        OTHER
    }

    enum TrustTier {
        UNSTAKED,   // Listed but not trusted
        STAKED,     // 1+ ETH stake
        VERIFIED    // Governance approved
    }

    struct ChainInfo {
        uint256 chainId;        // EVM chain ID or Wormhole chain ID for non-EVM
        ChainType chainType;
        string name;
        string rpcUrl;
        address networkOperator;
        uint256 stake;
        TrustTier trustTier;
        bool isActive;
        uint256 registeredAt;
    }

    struct RegistryInfo {
        bytes32 registryId;     // Unique ID: keccak256(chainId, registryType, address)
        uint256 chainId;
        ChainType chainType;
        RegistryType registryType;
        bytes32 contractAddress; // bytes32 to support both EVM and Solana addresses
        string name;
        string version;
        string metadataUri;     // IPFS URI for extended metadata
        uint256 entryCount;     // Approximate entries in registry
        uint256 lastSyncBlock;
        bool isActive;
        uint256 registeredAt;
    }

    struct RegistryEntry {
        bytes32 entryId;        // Unique ID across all registries
        bytes32 registryId;
        bytes32 originId;       // ID in the origin registry
        string name;
        string metadataUri;
        uint256 syncedAt;
    }

    // ============================================================================
    // Constants
    // ============================================================================

    uint256 public constant MIN_STAKE = 1 ether;
    uint256 public constant VERIFIED_STAKE = 10 ether;

    // Wormhole chain IDs
    uint16 public constant WORMHOLE_SOLANA = 1;
    uint16 public constant WORMHOLE_ETHEREUM = 2;
    uint16 public constant WORMHOLE_BASE = 30;

    // ============================================================================
    // State
    // ============================================================================

    // Chain registry
    mapping(uint256 => ChainInfo) public chains;
    uint256[] public chainIds;

    // Registry registry (meta!)
    mapping(bytes32 => RegistryInfo) public registries;
    bytes32[] public registryIds;

    // Registry entries (for critical entries only - most stay off-chain)
    mapping(bytes32 => RegistryEntry) public federatedEntries;
    bytes32[] public federatedEntryIds;

    // Indexes
    mapping(uint256 => bytes32[]) public registriesByChain;
    mapping(RegistryType => bytes32[]) public registriesByType;

    // Oracle for Solana verification
    address public wormholeRelayer;
    mapping(bytes32 => bool) public verifiedSolanaRegistries;

    // Stats
    uint256 public totalChains;
    uint256 public totalRegistries;
    uint256 public totalFederatedEntries;
    uint256 public totalStaked;

    // ============================================================================
    // Events
    // ============================================================================

    event ChainRegistered(
        uint256 indexed chainId,
        ChainType chainType,
        string name,
        address indexed operator,
        uint256 stake,
        TrustTier trustTier
    );

    event ChainUpdated(uint256 indexed chainId, string name, TrustTier trustTier);
    event ChainDeactivated(uint256 indexed chainId);

    event RegistryRegistered(
        bytes32 indexed registryId,
        uint256 indexed chainId,
        RegistryType registryType,
        bytes32 contractAddress,
        string name
    );

    event RegistryUpdated(bytes32 indexed registryId, uint256 entryCount, uint256 lastSyncBlock);
    event RegistryDeactivated(bytes32 indexed registryId);

    event EntryFederated(
        bytes32 indexed entryId,
        bytes32 indexed registryId,
        bytes32 originId,
        string name
    );

    event SolanaRegistryVerified(bytes32 indexed registryId, bytes32 programId);

    event StakeDeposited(uint256 indexed chainId, uint256 amount);
    event StakeWithdrawn(uint256 indexed chainId, uint256 amount);

    // ============================================================================
    // Errors
    // ============================================================================

    error ChainExists();
    error ChainNotFound();
    error RegistryExists();
    error RegistryNotFound();
    error InsufficientStake();
    error NotOperator();
    error ChainInactive();
    error InvalidChainType();
    error NotWormholeRelayer();
    error AlreadyVerified();
    error StillActive();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(address _wormholeRelayer) Ownable(msg.sender) {
        wormholeRelayer = _wormholeRelayer;
    }

    // ============================================================================
    // Chain Management
    // ============================================================================

    /**
     * @notice Register a new chain in the federation
     * @dev Anyone can register, but unstaked chains have limited trust
     */
    function registerChain(
        uint256 chainId,
        ChainType chainType,
        string calldata name,
        string calldata rpcUrl
    ) external payable nonReentrant {
        if (chains[chainId].registeredAt != 0) revert ChainExists();

        TrustTier tier = TrustTier.UNSTAKED;
        if (msg.value >= VERIFIED_STAKE) {
            tier = TrustTier.VERIFIED;
        } else if (msg.value >= MIN_STAKE) {
            tier = TrustTier.STAKED;
        }

        chains[chainId] = ChainInfo({
            chainId: chainId,
            chainType: chainType,
            name: name,
            rpcUrl: rpcUrl,
            networkOperator: msg.sender,
            stake: msg.value,
            trustTier: tier,
            isActive: true,
            registeredAt: block.timestamp
        });

        chainIds.push(chainId);
        totalChains++;
        totalStaked += msg.value;

        emit ChainRegistered(chainId, chainType, name, msg.sender, msg.value, tier);
    }

    /**
     * @notice Add stake to upgrade trust tier
     */
    function addStake(uint256 chainId) external payable nonReentrant {
        ChainInfo storage chain = chains[chainId];
        if (chain.registeredAt == 0) revert ChainNotFound();
        if (chain.networkOperator != msg.sender) revert NotOperator();

        chain.stake += msg.value;
        totalStaked += msg.value;

        // Upgrade tier if threshold met
        if (chain.stake >= VERIFIED_STAKE && chain.trustTier != TrustTier.VERIFIED) {
            chain.trustTier = TrustTier.VERIFIED;
        } else if (chain.stake >= MIN_STAKE && chain.trustTier == TrustTier.UNSTAKED) {
            chain.trustTier = TrustTier.STAKED;
        }

        emit StakeDeposited(chainId, msg.value);
        emit ChainUpdated(chainId, chain.name, chain.trustTier);
    }

    /**
     * @notice Withdraw stake (only if deactivated)
     */
    function withdrawStake(uint256 chainId) external nonReentrant {
        ChainInfo storage chain = chains[chainId];
        if (chain.registeredAt == 0) revert ChainNotFound();
        if (chain.networkOperator != msg.sender) revert NotOperator();
        if (chain.isActive) revert StillActive();

        uint256 amount = chain.stake;
        chain.stake = 0;
        chain.trustTier = TrustTier.UNSTAKED;
        totalStaked -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit StakeWithdrawn(chainId, amount);
    }

    /**
     * @notice Deactivate a chain
     */
    function deactivateChain(uint256 chainId) external {
        ChainInfo storage chain = chains[chainId];
        if (chain.registeredAt == 0) revert ChainNotFound();
        if (chain.networkOperator != msg.sender && msg.sender != owner()) revert NotOperator();

        chain.isActive = false;
        emit ChainDeactivated(chainId);
    }

    // ============================================================================
    // Registry Management
    // ============================================================================

    /**
     * @notice Register a registry contract
     */
    function registerRegistry(
        uint256 chainId,
        RegistryType registryType,
        bytes32 contractAddress,
        string calldata name,
        string calldata registryVersion,
        string calldata metadataUri
    ) external {
        ChainInfo storage chain = chains[chainId];
        if (chain.registeredAt == 0) revert ChainNotFound();
        if (chain.networkOperator != msg.sender && msg.sender != owner()) revert NotOperator();

        bytes32 registryId = computeRegistryId(chainId, registryType, contractAddress);
        if (registries[registryId].registeredAt != 0) revert RegistryExists();

        registries[registryId] = RegistryInfo({
            registryId: registryId,
            chainId: chainId,
            chainType: chain.chainType,
            registryType: registryType,
            contractAddress: contractAddress,
            name: name,
            version: registryVersion,
            metadataUri: metadataUri,
            entryCount: 0,
            lastSyncBlock: 0,
            isActive: true,
            registeredAt: block.timestamp
        });

        registryIds.push(registryId);
        registriesByChain[chainId].push(registryId);
        registriesByType[registryType].push(registryId);
        totalRegistries++;

        emit RegistryRegistered(registryId, chainId, registryType, contractAddress, name);
    }

    /**
     * @notice Update registry stats (called by indexer/oracle)
     */
    function updateRegistryStats(
        bytes32 registryId,
        uint256 entryCount,
        uint256 lastSyncBlock
    ) external {
        RegistryInfo storage registry = registries[registryId];
        if (registry.registeredAt == 0) revert RegistryNotFound();
        
        ChainInfo storage chain = chains[registry.chainId];
        if (chain.networkOperator != msg.sender && msg.sender != owner()) revert NotOperator();

        registry.entryCount = entryCount;
        registry.lastSyncBlock = lastSyncBlock;

        emit RegistryUpdated(registryId, entryCount, lastSyncBlock);
    }

    /**
     * @notice Federate a critical entry (identities, high-value items)
     */
    function federateEntry(
        bytes32 registryId,
        bytes32 originId,
        string calldata name,
        string calldata metadataUri
    ) external {
        RegistryInfo storage registry = registries[registryId];
        if (registry.registeredAt == 0) revert RegistryNotFound();

        ChainInfo storage chain = chains[registry.chainId];
        if (chain.networkOperator != msg.sender && msg.sender != owner()) revert NotOperator();

        bytes32 entryId = computeEntryId(registryId, originId);

        federatedEntries[entryId] = RegistryEntry({
            entryId: entryId,
            registryId: registryId,
            originId: originId,
            name: name,
            metadataUri: metadataUri,
            syncedAt: block.timestamp
        });

        federatedEntryIds.push(entryId);
        totalFederatedEntries++;

        emit EntryFederated(entryId, registryId, originId, name);
    }

    // ============================================================================
    // Solana Verification (via Wormhole)
    // ============================================================================

    /**
     * @notice Verify a Solana registry via Wormhole VAA
     * @param vaa Wormhole Verified Action Approval
     */
    function verifySolanaRegistry(bytes calldata vaa) external {
        // In production, parse and verify the VAA
        // For now, only wormhole relayer can call
        if (msg.sender != wormholeRelayer && msg.sender != owner()) {
            revert NotWormholeRelayer();
        }

        // Decode VAA payload (simplified)
        // Real implementation would use Wormhole SDK
        (bytes32 programId, ) = abi.decode(vaa, (bytes32, string));

        bytes32 registryId = computeRegistryId(
            WORMHOLE_SOLANA,
            RegistryType.IDENTITY, // Assuming identity registry
            programId
        );

        if (verifiedSolanaRegistries[registryId]) revert AlreadyVerified();

        verifiedSolanaRegistries[registryId] = true;

        emit SolanaRegistryVerified(registryId, programId);
    }

    /**
     * @notice Register a Solana SPL registry (ai16z, daos.fun style)
     */
    function registerSolanaRegistry(
        bytes32 programId,
        RegistryType registryType,
        string calldata name,
        string calldata metadataUri
    ) external payable nonReentrant {
        // Register Solana as a chain if not exists
        if (chains[WORMHOLE_SOLANA].registeredAt == 0) {
            chains[WORMHOLE_SOLANA] = ChainInfo({
                chainId: WORMHOLE_SOLANA,
                chainType: ChainType.SOLANA,
                name: "Solana",
                rpcUrl: "https://api.mainnet-beta.solana.com",
                networkOperator: msg.sender,
                stake: msg.value,
                trustTier: msg.value >= MIN_STAKE ? TrustTier.STAKED : TrustTier.UNSTAKED,
                isActive: true,
                registeredAt: block.timestamp
            });
            chainIds.push(WORMHOLE_SOLANA);
            totalChains++;
        }

        bytes32 registryId = computeRegistryId(WORMHOLE_SOLANA, registryType, programId);
        if (registries[registryId].registeredAt != 0) revert RegistryExists();

        registries[registryId] = RegistryInfo({
            registryId: registryId,
            chainId: WORMHOLE_SOLANA,
            chainType: ChainType.SOLANA,
            registryType: registryType,
            contractAddress: programId,
            name: name,
            version: "1.0.0",
            metadataUri: metadataUri,
            entryCount: 0,
            lastSyncBlock: 0,
            isActive: true,
            registeredAt: block.timestamp
        });

        registryIds.push(registryId);
        registriesByChain[WORMHOLE_SOLANA].push(registryId);
        registriesByType[registryType].push(registryId);
        totalRegistries++;
        totalStaked += msg.value;

        emit RegistryRegistered(registryId, WORMHOLE_SOLANA, registryType, programId, name);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function computeRegistryId(
        uint256 chainId,
        RegistryType registryType,
        bytes32 contractAddress
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("jeju:registry:", chainId, ":", uint8(registryType), ":", contractAddress));
    }

    function computeEntryId(bytes32 registryId, bytes32 originId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("jeju:entry:", registryId, ":", originId));
    }

    function getChain(uint256 chainId) external view returns (ChainInfo memory) {
        return chains[chainId];
    }

    function getRegistry(bytes32 registryId) external view returns (RegistryInfo memory) {
        return registries[registryId];
    }

    function getEntry(bytes32 entryId) external view returns (RegistryEntry memory) {
        return federatedEntries[entryId];
    }

    function getAllChainIds() external view returns (uint256[] memory) {
        return chainIds;
    }

    function getAllRegistryIds() external view returns (bytes32[] memory) {
        return registryIds;
    }

    function getRegistriesByChain(uint256 chainId) external view returns (bytes32[] memory) {
        return registriesByChain[chainId];
    }

    function getRegistriesByType(RegistryType registryType) external view returns (bytes32[] memory) {
        return registriesByType[registryType];
    }

    function getStakedChains() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < chainIds.length; i++) {
            if (chains[chainIds[i]].trustTier >= TrustTier.STAKED) count++;
        }

        uint256[] memory staked = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < chainIds.length; i++) {
            if (chains[chainIds[i]].trustTier >= TrustTier.STAKED) {
                staked[idx++] = chainIds[i];
            }
        }
        return staked;
    }

    function isTrustedForConsensus(uint256 chainId) external view returns (bool) {
        return chains[chainId].trustTier >= TrustTier.STAKED && chains[chainId].isActive;
    }

    function setWormholeRelayer(address _relayer) external onlyOwner {
        wormholeRelayer = _relayer;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}

