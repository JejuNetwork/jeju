// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IWormhole} from "./interfaces/IWormhole.sol";

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
contract RegistryHub is Ownable, ReentrancyGuard, Pausable {
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

    // Wormhole for Solana verification
    IWormhole public wormhole;
    mapping(bytes32 => bool) public verifiedSolanaRegistries;
    
    /// @notice Trusted Solana emitter for registry messages
    bytes32 public trustedSolanaEmitter;
    
    /// @notice Processed VAA sequences for replay protection
    mapping(uint64 => bool) public processedVAASequences;

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
    error VerificationFailed(string reason);
    error InvalidChainId();
    error InvalidEmitter();
    error InvalidPayload();
    error InvalidPayloadType();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(address _wormhole) Ownable(msg.sender) {
        wormhole = IWormhole(_wormhole);
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
    ) external payable nonReentrant whenNotPaused {
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
    ) external whenNotPaused {
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

    /// @notice Payload type identifiers for Solana registry messages
    uint8 public constant PAYLOAD_REGISTRY_REGISTER = 1;
    uint8 public constant PAYLOAD_REGISTRY_UPDATE = 2;
    uint8 public constant PAYLOAD_ENTRY_FEDERATE = 3;

    /**
     * @notice Verify a Solana registry via Wormhole VAA
     * @param vaa Wormhole Verified Action Approval containing registry data
     * @dev Parses and verifies the VAA using the Wormhole core bridge
     *
     * ## VAA Payload Format
     * - payloadType: uint8 (1 = register, 2 = update, 3 = federate)
     * - programId: bytes32 (Solana program address)
     * - registryType: uint8 (maps to RegistryType enum)
     * - name: string (variable length)
     * - metadataUri: string (variable length)
     */
    function verifySolanaRegistry(bytes calldata vaa) external whenNotPaused {
        // Parse and verify VAA through Wormhole core bridge
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole.parseAndVerifyVM(vaa);
        
        if (!valid) {
            revert VerificationFailed(reason);
        }

        // Verify chain ID is Solana
        if (vm.emitterChainId != WORMHOLE_SOLANA) {
            revert InvalidChainId();
        }

        // Verify emitter is trusted (if set)
        if (trustedSolanaEmitter != bytes32(0) && vm.emitterAddress != trustedSolanaEmitter) {
            revert InvalidEmitter();
        }

        // Check replay protection
        if (processedVAASequences[vm.sequence]) {
            revert AlreadyVerified();
        }
        processedVAASequences[vm.sequence] = true;

        // Decode payload
        bytes memory payload = vm.payload;
        if (payload.length < 34) {
            revert InvalidPayload();
        }

        uint8 payloadType = uint8(payload[0]);
        bytes32 programId;
        assembly {
            programId := mload(add(payload, 33))
        }

        // Process based on payload type
        if (payloadType == PAYLOAD_REGISTRY_REGISTER) {
            _processRegistryRegistration(payload, programId);
        } else if (payloadType == PAYLOAD_REGISTRY_UPDATE) {
            _processRegistryUpdate(payload, programId);
        } else if (payloadType == PAYLOAD_ENTRY_FEDERATE) {
            _processFederatedEntry(payload, programId);
        } else {
            revert InvalidPayloadType();
        }
    }

    /**
     * @notice Process a registry registration from Solana
     */
    function _processRegistryRegistration(bytes memory payload, bytes32 programId) internal {
        // Payload layout after type and programId:
        // [33] registryType: uint8
        // [34-35] nameLen: uint16
        // [36..] name: bytes
        // [...] metadataUriLen: uint16
        // [...] metadataUri: bytes
        
        if (payload.length < 36) revert InvalidPayload();
        
        uint8 registryTypeRaw = uint8(payload[33]);
        RegistryType registryType = RegistryType(registryTypeRaw);
        
        uint16 nameLen = uint16(uint8(payload[34])) << 8 | uint16(uint8(payload[35]));
        
        bytes32 registryId = computeRegistryId(WORMHOLE_SOLANA, registryType, programId);
        
        if (registries[registryId].registeredAt != 0) {
            revert RegistryExists();
        }

        // Extract name
        string memory name;
        if (nameLen > 0 && payload.length >= 36 + nameLen) {
            bytes memory nameBytes = new bytes(nameLen);
            for (uint256 i = 0; i < nameLen; i++) {
                nameBytes[i] = payload[36 + i];
            }
            name = string(nameBytes);
        } else {
            name = "Solana Registry";
        }

        // Extract metadataUri
        uint256 metadataStart = 36 + nameLen;
        string memory metadataUri = "";
        if (payload.length >= metadataStart + 2) {
            uint16 uriLen = uint16(uint8(payload[metadataStart])) << 8 | uint16(uint8(payload[metadataStart + 1]));
            if (uriLen > 0 && payload.length >= metadataStart + 2 + uriLen) {
                bytes memory uriBytes = new bytes(uriLen);
                for (uint256 i = 0; i < uriLen; i++) {
                    uriBytes[i] = payload[metadataStart + 2 + i];
                }
                metadataUri = string(uriBytes);
            }
        }

        // Register Solana as a chain if not exists
        if (chains[WORMHOLE_SOLANA].registeredAt == 0) {
            chains[WORMHOLE_SOLANA] = ChainInfo({
                chainId: WORMHOLE_SOLANA,
                chainType: ChainType.SOLANA,
                name: "Solana",
                rpcUrl: "https://api.mainnet-beta.solana.com",
                networkOperator: msg.sender,
                stake: 0,
                trustTier: TrustTier.UNSTAKED,
                isActive: true,
                registeredAt: block.timestamp
            });
            chainIds.push(WORMHOLE_SOLANA);
            totalChains++;
        }

        // Create registry entry
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
        verifiedSolanaRegistries[registryId] = true;

        emit RegistryRegistered(registryId, WORMHOLE_SOLANA, registryType, programId, name);
        emit SolanaRegistryVerified(registryId, programId);
    }

    /**
     * @notice Process a registry update from Solana
     */
    function _processRegistryUpdate(bytes memory payload, bytes32 programId) internal {
        // Payload layout:
        // [33] registryType: uint8
        // [34-41] entryCount: uint64
        // [42-49] lastSyncSlot: uint64
        
        if (payload.length < 50) revert InvalidPayload();
        
        uint8 registryTypeRaw = uint8(payload[33]);
        RegistryType registryType = RegistryType(registryTypeRaw);
        
        bytes32 registryId = computeRegistryId(WORMHOLE_SOLANA, registryType, programId);
        RegistryInfo storage registry = registries[registryId];
        
        if (registry.registeredAt == 0) revert RegistryNotFound();

        // Extract entry count and sync slot
        uint64 entryCount;
        uint64 lastSyncSlot;
        assembly {
            entryCount := mload(add(payload, 42))
            lastSyncSlot := mload(add(payload, 50))
        }
        
        // Update BigEndian to LittleEndian for Solana compatibility
        entryCount = _swapEndian64(entryCount);
        lastSyncSlot = _swapEndian64(lastSyncSlot);

        registry.entryCount = uint256(entryCount);
        registry.lastSyncBlock = uint256(lastSyncSlot);

        emit RegistryUpdated(registryId, registry.entryCount, registry.lastSyncBlock);
    }

    /**
     * @notice Process a federated entry from Solana
     */
    function _processFederatedEntry(bytes memory payload, bytes32 programId) internal {
        // Payload layout:
        // [33] registryType: uint8
        // [34-65] originId: bytes32
        // [66-67] nameLen: uint16
        // [68..] name: bytes
        // [...] metadataUriLen: uint16
        // [...] metadataUri: bytes
        
        if (payload.length < 68) revert InvalidPayload();
        
        uint8 registryTypeRaw = uint8(payload[33]);
        RegistryType registryType = RegistryType(registryTypeRaw);
        
        bytes32 originId;
        assembly {
            originId := mload(add(payload, 66))
        }
        
        bytes32 registryId = computeRegistryId(WORMHOLE_SOLANA, registryType, programId);
        
        if (registries[registryId].registeredAt == 0) revert RegistryNotFound();

        // Extract name
        uint16 nameLen = uint16(uint8(payload[66])) << 8 | uint16(uint8(payload[67]));
        string memory name = "";
        if (nameLen > 0 && payload.length >= 68 + nameLen) {
            bytes memory nameBytes = new bytes(nameLen);
            for (uint256 i = 0; i < nameLen; i++) {
                nameBytes[i] = payload[68 + i];
            }
            name = string(nameBytes);
        }

        // Extract metadataUri
        uint256 metadataStart = 68 + nameLen;
        string memory metadataUri = "";
        if (payload.length >= metadataStart + 2) {
            uint16 uriLen = uint16(uint8(payload[metadataStart])) << 8 | uint16(uint8(payload[metadataStart + 1]));
            if (uriLen > 0 && payload.length >= metadataStart + 2 + uriLen) {
                bytes memory uriBytes = new bytes(uriLen);
                for (uint256 i = 0; i < uriLen; i++) {
                    uriBytes[i] = payload[metadataStart + 2 + i];
                }
                metadataUri = string(uriBytes);
            }
        }

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

    /**
     * @notice Swap endianness of uint64 (Solana uses little-endian)
     */
    function _swapEndian64(uint64 val) internal pure returns (uint64) {
        return ((val & 0xFF00000000000000) >> 56) |
               ((val & 0x00FF000000000000) >> 40) |
               ((val & 0x0000FF0000000000) >> 24) |
               ((val & 0x000000FF00000000) >> 8) |
               ((val & 0x00000000FF000000) << 8) |
               ((val & 0x0000000000FF0000) << 24) |
               ((val & 0x000000000000FF00) << 40) |
               ((val & 0x00000000000000FF) << 56);
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

    function setWormhole(address _wormhole) external onlyOwner {
        wormhole = IWormhole(_wormhole);
    }

    function setTrustedSolanaEmitter(bytes32 _emitter) external onlyOwner {
        trustedSolanaEmitter = _emitter;
    }

    /// @notice Pause all registry operations
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause registry operations
    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}

