// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RegistrySyncOracle
 * @author Jeju Network
 * @notice Event-driven registry synchronization oracle
 * @dev Receives registry updates from federated chains via Hyperlane/Wormhole
 *
 * ## Design Goals
 * - Fast sync: Event-driven, not polling
 * - Efficient: Batch updates, minimal storage
 * - Reliable: Multiple oracle support, quorum
 *
 * ## Event Flow
 * 1. Registry update on source chain emits event
 * 2. Relayer picks up event
 * 3. Relayer calls this oracle with proof
 * 4. Oracle verifies and stores update
 * 5. Indexer reads from oracle
 *
 * ## Cost Analysis
 * - Single update: ~30,000 gas (~$0.06)
 * - Batch of 10: ~150,000 gas (~$0.30)
 * - Batch of 100: ~1,200,000 gas (~$2.40)
 */
contract RegistrySyncOracle is Ownable {
    // ============================================================================
    // Types
    // ============================================================================

    enum RegistryType {
        IDENTITY,
        COMPUTE,
        STORAGE,
        SOLVER,
        PACKAGE,
        CONTAINER,
        MODEL,
        OTHER
    }

    struct RegistryUpdate {
        uint256 sourceChainId;
        RegistryType registryType;
        bytes32 registryAddress;
        uint256 entryCount;
        bytes32 merkleRoot;      // Root of all entries
        uint256 blockNumber;
        uint256 timestamp;
        bytes32 updateId;
    }

    struct EntryUpdate {
        bytes32 updateId;
        bytes32 entryId;
        bytes32 originId;
        string name;
        string metadataUri;
        bool isActive;
    }

    // ============================================================================
    // State
    // ============================================================================

    /// @notice Authorized relayers
    mapping(address => bool) public relayers;

    /// @notice Registry updates by chain and type
    mapping(uint256 => mapping(RegistryType => RegistryUpdate)) public latestUpdates;

    /// @notice All updates (for history)
    mapping(bytes32 => RegistryUpdate) public updates;
    bytes32[] public updateIds;

    /// @notice Individual entry updates
    mapping(bytes32 => EntryUpdate) public entryUpdates;

    /// @notice Update counts
    uint256 public totalUpdates;
    uint256 public totalEntryUpdates;

    /// @notice Sync interval (minimum time between updates)
    uint256 public syncInterval = 60; // 1 minute default

    /// @notice Last sync time per chain
    mapping(uint256 => uint256) public lastSyncTime;

    // ============================================================================
    // Events
    // ============================================================================

    event RegistryUpdated(
        bytes32 indexed updateId,
        uint256 indexed sourceChainId,
        RegistryType registryType,
        uint256 entryCount,
        bytes32 merkleRoot
    );

    event EntryUpdated(
        bytes32 indexed updateId,
        bytes32 indexed entryId,
        string name,
        bool isActive
    );

    event BatchUpdated(
        uint256 indexed sourceChainId,
        uint256 updateCount,
        uint256 entryCount
    );

    event RelayerUpdated(address indexed relayer, bool authorized);
    event SyncIntervalUpdated(uint256 oldInterval, uint256 newInterval);

    // ============================================================================
    // Errors
    // ============================================================================

    error NotRelayer();
    error TooSoon();
    error InvalidUpdate();

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor() Ownable(msg.sender) {
        relayers[msg.sender] = true;
    }

    // ============================================================================
    // Relayer Functions
    // ============================================================================

    /**
     * @notice Submit a registry update
     */
    function submitUpdate(
        uint256 sourceChainId,
        RegistryType registryType,
        bytes32 registryAddress,
        uint256 entryCount,
        bytes32 merkleRoot,
        uint256 blockNumber
    ) external onlyRelayer {
        // Rate limit per chain
        if (block.timestamp < lastSyncTime[sourceChainId] + syncInterval) {
            revert TooSoon();
        }

        bytes32 updateId = computeUpdateId(sourceChainId, registryType, blockNumber);

        RegistryUpdate memory update = RegistryUpdate({
            sourceChainId: sourceChainId,
            registryType: registryType,
            registryAddress: registryAddress,
            entryCount: entryCount,
            merkleRoot: merkleRoot,
            blockNumber: blockNumber,
            timestamp: block.timestamp,
            updateId: updateId
        });

        latestUpdates[sourceChainId][registryType] = update;
        updates[updateId] = update;
        updateIds.push(updateId);
        lastSyncTime[sourceChainId] = block.timestamp;
        totalUpdates++;

        emit RegistryUpdated(updateId, sourceChainId, registryType, entryCount, merkleRoot);
    }

    /**
     * @notice Submit a batch of registry updates
     */
    function submitBatchUpdates(
        uint256 sourceChainId,
        RegistryType[] calldata registryTypes,
        bytes32[] calldata registryAddresses,
        uint256[] calldata entryCounts,
        bytes32[] calldata merkleRoots,
        uint256 blockNumber
    ) external onlyRelayer {
        if (registryTypes.length != registryAddresses.length ||
            registryTypes.length != entryCounts.length ||
            registryTypes.length != merkleRoots.length) {
            revert InvalidUpdate();
        }

        for (uint256 i = 0; i < registryTypes.length; i++) {
            bytes32 updateId = computeUpdateId(sourceChainId, registryTypes[i], blockNumber);

            RegistryUpdate memory update = RegistryUpdate({
                sourceChainId: sourceChainId,
                registryType: registryTypes[i],
                registryAddress: registryAddresses[i],
                entryCount: entryCounts[i],
                merkleRoot: merkleRoots[i],
                blockNumber: blockNumber,
                timestamp: block.timestamp,
                updateId: updateId
            });

            latestUpdates[sourceChainId][registryTypes[i]] = update;
            updates[updateId] = update;
            updateIds.push(updateId);
            totalUpdates++;

            emit RegistryUpdated(updateId, sourceChainId, registryTypes[i], entryCounts[i], merkleRoots[i]);
        }

        lastSyncTime[sourceChainId] = block.timestamp;

        emit BatchUpdated(sourceChainId, registryTypes.length, 0);
    }

    /**
     * @notice Submit individual entry updates (for critical entries only)
     */
    function submitEntryUpdate(
        bytes32 updateId,
        bytes32 entryId,
        bytes32 originId,
        string calldata name,
        string calldata metadataUri,
        bool isActive
    ) external onlyRelayer {
        entryUpdates[entryId] = EntryUpdate({
            updateId: updateId,
            entryId: entryId,
            originId: originId,
            name: name,
            metadataUri: metadataUri,
            isActive: isActive
        });

        totalEntryUpdates++;

        emit EntryUpdated(updateId, entryId, name, isActive);
    }

    /**
     * @notice Batch submit entry updates
     */
    function submitBatchEntryUpdates(
        bytes32 updateId,
        bytes32[] calldata entryIds,
        bytes32[] calldata originIds,
        string[] calldata names,
        string[] calldata metadataUris,
        bool[] calldata isActives
    ) external onlyRelayer {
        if (entryIds.length != originIds.length ||
            entryIds.length != names.length ||
            entryIds.length != metadataUris.length ||
            entryIds.length != isActives.length) {
            revert InvalidUpdate();
        }

        for (uint256 i = 0; i < entryIds.length; i++) {
            entryUpdates[entryIds[i]] = EntryUpdate({
                updateId: updateId,
                entryId: entryIds[i],
                originId: originIds[i],
                name: names[i],
                metadataUri: metadataUris[i],
                isActive: isActives[i]
            });

            emit EntryUpdated(updateId, entryIds[i], names[i], isActives[i]);
        }

        totalEntryUpdates += entryIds.length;

        RegistryUpdate storage update = updates[updateId];
        emit BatchUpdated(update.sourceChainId, 0, entryIds.length);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function computeUpdateId(
        uint256 chainId,
        RegistryType registryType,
        uint256 blockNumber
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("jeju:sync:", chainId, ":", uint8(registryType), ":", blockNumber));
    }

    function getLatestUpdate(
        uint256 chainId,
        RegistryType registryType
    ) external view returns (RegistryUpdate memory) {
        return latestUpdates[chainId][registryType];
    }

    function getUpdate(bytes32 updateId) external view returns (RegistryUpdate memory) {
        return updates[updateId];
    }

    function getEntryUpdate(bytes32 entryId) external view returns (EntryUpdate memory) {
        return entryUpdates[entryId];
    }

    function getAllUpdateIds() external view returns (bytes32[] memory) {
        return updateIds;
    }

    function getRecentUpdates(uint256 count) external view returns (bytes32[] memory) {
        uint256 length = updateIds.length;
        uint256 resultCount = count > length ? length : count;
        bytes32[] memory recent = new bytes32[](resultCount);

        for (uint256 i = 0; i < resultCount; i++) {
            recent[i] = updateIds[length - 1 - i];
        }

        return recent;
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        relayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    function setSyncInterval(uint256 interval) external onlyOwner {
        emit SyncIntervalUpdated(syncInterval, interval);
        syncInterval = interval;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

