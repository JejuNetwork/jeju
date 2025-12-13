// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IJNS} from "./IJNS.sol";

/**
 * @title ENSMirror
 * @author Jeju Network
 * @notice Mirrors ENS names to JNS using the Jeju Oracle Network
 * @dev Uses oracle reports to sync ENS contenthash and address records to JNS.
 *      Relies on the Ethereum fullnode infrastructure and oracle marketplace
 *      for decentralized ENS resolution.
 *
 * Flow:
 * 1. User registers ENS→JNS mirror via registerMirror()
 * 2. Oracle network watches ENS for changes (via fullnode)
 * 3. Oracles submit signed reports with ENS state
 * 4. Contract verifies quorum and updates JNS resolver
 *
 * Supports:
 * - Contenthash mirroring (IPFS/Swarm content)
 * - Address mirroring (ETH address)
 * - Text record mirroring (key-value pairs)
 */
contract ENSMirror is Ownable, ReentrancyGuard {
    // ============ Structs ============

    struct MirrorConfig {
        bytes32 ensNode;           // ENS namehash
        bytes32 jnsNode;           // JNS namehash
        address owner;             // Mirror owner (pays for sync)
        uint256 syncInterval;      // Min seconds between syncs
        uint256 lastSyncAt;        // Last successful sync
        bool mirrorContenthash;    // Sync contenthash
        bool mirrorAddress;        // Sync ETH address
        string[] textKeys;         // Text records to sync
        bool active;
        uint256 createdAt;
    }

    struct SyncReport {
        bytes32 ensNode;
        bytes contenthash;
        address ethAddress;
        string[] textKeys;
        string[] textValues;
        uint256 blockNumber;       // ENS state at this block
        uint256 timestamp;
    }

    struct OracleSignature {
        address oracle;
        bytes signature;
    }

    // ============ State Variables ============

    IJNS public jnsRegistry;
    address public jnsResolver;

    mapping(bytes32 => MirrorConfig) public mirrors;          // ensNode => config
    mapping(bytes32 => bytes32) public ensMirrorIds;          // ensNode => mirrorId
    mapping(bytes32 => bytes32) public jnsToEns;              // jnsNode => ensNode

    bytes32[] public allMirrorIds;
    mapping(address => bytes32[]) public ownerMirrors;

    mapping(address => bool) public authorizedOracles;
    uint8 public oracleQuorum = 2;
    uint256 public minSyncInterval = 300;                     // 5 minutes

    // ENS chain config (Ethereum mainnet by default)
    uint256 public ensChainId = 1;
    address public ensRegistry = 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e;

    // ============ Events ============

    event MirrorRegistered(bytes32 indexed mirrorId, bytes32 indexed ensNode, bytes32 indexed jnsNode, address owner);
    event MirrorUpdated(bytes32 indexed mirrorId);
    event MirrorSynced(bytes32 indexed mirrorId, bytes32 indexed ensNode, uint256 blockNumber);
    event SyncFailed(bytes32 indexed mirrorId, string reason);
    event OracleAuthorized(address indexed oracle, bool authorized);

    // ============ Errors ============

    error MirrorNotFound(bytes32 mirrorId);
    error MirrorAlreadyExists(bytes32 ensNode);
    error NotMirrorOwner(bytes32 mirrorId, address caller);
    error SyncTooSoon(bytes32 mirrorId, uint256 nextSyncAt);
    error InsufficientQuorum(uint8 provided, uint8 required);
    error InvalidSignature(address oracle);
    error OracleNotAuthorized(address oracle);

    // ============ Modifiers ============

    modifier mirrorExists(bytes32 mirrorId) {
        if (mirrors[mirrorId].createdAt == 0) {
            revert MirrorNotFound(mirrorId);
        }
        _;
    }

    modifier onlyMirrorOwner(bytes32 mirrorId) {
        if (mirrors[mirrorId].owner != msg.sender) {
            revert NotMirrorOwner(mirrorId, msg.sender);
        }
        _;
    }

    // ============ Constructor ============

    constructor(address _jnsRegistry, address _jnsResolver) Ownable(msg.sender) {
        jnsRegistry = IJNS(_jnsRegistry);
        jnsResolver = _jnsResolver;
    }

    // ============ Mirror Registration ============

    /**
     * @notice Register a new ENS→JNS mirror
     * @param ensNode The ENS namehash (keccak256 of normalized ENS name)
     * @param jnsNode The JNS namehash (must be owned by caller)
     * @param syncInterval Minimum seconds between syncs
     * @param mirrorContenthash Whether to mirror contenthash
     * @param mirrorAddress Whether to mirror ETH address
     * @param textKeys Text record keys to mirror
     */
    function registerMirror(
        bytes32 ensNode,
        bytes32 jnsNode,
        uint256 syncInterval,
        bool mirrorContenthash,
        bool mirrorAddress,
        string[] calldata textKeys
    ) external returns (bytes32 mirrorId) {
        if (mirrors[ensMirrorIds[ensNode]].createdAt != 0) {
            revert MirrorAlreadyExists(ensNode);
        }

        mirrorId = keccak256(abi.encodePacked(ensNode, jnsNode, msg.sender, block.timestamp));

        MirrorConfig storage config = mirrors[mirrorId];
        config.ensNode = ensNode;
        config.jnsNode = jnsNode;
        config.owner = msg.sender;
        config.syncInterval = syncInterval > minSyncInterval ? syncInterval : minSyncInterval;
        config.mirrorContenthash = mirrorContenthash;
        config.mirrorAddress = mirrorAddress;
        config.textKeys = textKeys;
        config.active = true;
        config.createdAt = block.timestamp;

        ensMirrorIds[ensNode] = mirrorId;
        jnsToEns[jnsNode] = ensNode;
        allMirrorIds.push(mirrorId);
        ownerMirrors[msg.sender].push(mirrorId);

        emit MirrorRegistered(mirrorId, ensNode, jnsNode, msg.sender);
    }

    // ============ Sync Functions ============

    /**
     * @notice Submit a sync report from oracles
     * @dev Requires quorum of oracle signatures
     * @param report The ENS state report
     * @param signatures Oracle signatures on the report hash
     */
    function submitSyncReport(
        SyncReport calldata report,
        OracleSignature[] calldata signatures
    ) external nonReentrant {
        bytes32 mirrorId = ensMirrorIds[report.ensNode];
        MirrorConfig storage config = mirrors[mirrorId];

        if (config.createdAt == 0) {
            revert MirrorNotFound(mirrorId);
        }

        if (!config.active) {
            emit SyncFailed(mirrorId, "Mirror not active");
            return;
        }

        uint256 nextSyncAt = config.lastSyncAt + config.syncInterval;
        if (block.timestamp < nextSyncAt) {
            revert SyncTooSoon(mirrorId, nextSyncAt);
        }

        // Verify oracle signatures
        if (signatures.length < oracleQuorum) {
            revert InsufficientQuorum(uint8(signatures.length), oracleQuorum);
        }

        bytes32 reportHash = keccak256(abi.encode(
            report.ensNode,
            report.contenthash,
            report.ethAddress,
            report.textKeys,
            report.textValues,
            report.blockNumber
        ));

        uint8 validSignatures = 0;
        for (uint256 i = 0; i < signatures.length; i++) {
            if (!authorizedOracles[signatures[i].oracle]) {
                continue;
            }

            bytes32 ethSignedHash = keccak256(abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                reportHash
            ));

            address signer = _recoverSigner(ethSignedHash, signatures[i].signature);
            if (signer == signatures[i].oracle) {
                validSignatures++;
            }
        }

        if (validSignatures < oracleQuorum) {
            revert InsufficientQuorum(validSignatures, oracleQuorum);
        }

        // Apply sync to JNS resolver
        _applySync(config, report);

        config.lastSyncAt = block.timestamp;

        emit MirrorSynced(mirrorId, report.ensNode, report.blockNumber);
    }

    /**
     * @notice Apply sync report to JNS resolver
     */
    function _applySync(MirrorConfig storage config, SyncReport calldata report) internal {
        // Update contenthash
        if (config.mirrorContenthash && report.contenthash.length > 0) {
            IENSMirrorResolver(jnsResolver).setContenthash(config.jnsNode, report.contenthash);
        }

        // Update address
        if (config.mirrorAddress && report.ethAddress != address(0)) {
            IENSMirrorResolver(jnsResolver).setAddr(config.jnsNode, report.ethAddress);
        }

        // Update text records
        for (uint256 i = 0; i < report.textKeys.length && i < report.textValues.length; i++) {
            IENSMirrorResolver(jnsResolver).setText(config.jnsNode, report.textKeys[i], report.textValues[i]);
        }
    }

    function _recoverSigner(bytes32 hash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) v += 27;

        return ecrecover(hash, v, r, s);
    }

    // ============ View Functions ============

    function getMirror(bytes32 mirrorId) external view returns (MirrorConfig memory) {
        return mirrors[mirrorId];
    }

    function getMirrorByENS(bytes32 ensNode) external view returns (MirrorConfig memory) {
        return mirrors[ensMirrorIds[ensNode]];
    }

    function getMirrorsNeedingSync(uint256 maxResults) external view returns (bytes32[] memory) {
        bytes32[] memory result = new bytes32[](maxResults);
        uint256 count = 0;

        for (uint256 i = 0; i < allMirrorIds.length && count < maxResults; i++) {
            MirrorConfig storage config = mirrors[allMirrorIds[i]];
            // Never synced (lastSyncAt == 0) or past sync interval
            bool needsSync = config.lastSyncAt == 0 ||
                             block.timestamp >= config.lastSyncAt + config.syncInterval;
            if (config.active && needsSync) {
                result[count++] = allMirrorIds[i];
            }
        }

        assembly {
            mstore(result, count)
        }

        return result;
    }

    function getAllMirrors() external view returns (bytes32[] memory) {
        return allMirrorIds;
    }

    function getOwnerMirrors(address owner) external view returns (bytes32[] memory) {
        return ownerMirrors[owner];
    }

    // ============ Admin ============

    function setActive(bytes32 mirrorId, bool active)
        external
        mirrorExists(mirrorId)
        onlyMirrorOwner(mirrorId)
    {
        mirrors[mirrorId].active = active;
        emit MirrorUpdated(mirrorId);
    }

    function updateSyncInterval(bytes32 mirrorId, uint256 interval)
        external
        mirrorExists(mirrorId)
        onlyMirrorOwner(mirrorId)
    {
        mirrors[mirrorId].syncInterval = interval > minSyncInterval ? interval : minSyncInterval;
        emit MirrorUpdated(mirrorId);
    }

    function setOracleAuthorized(address oracle, bool authorized) external onlyOwner {
        authorizedOracles[oracle] = authorized;
        emit OracleAuthorized(oracle, authorized);
    }

    function setOracleQuorum(uint8 quorum) external onlyOwner {
        require(quorum > 0, "Quorum must be > 0");
        oracleQuorum = quorum;
    }

    function setMinSyncInterval(uint256 interval) external onlyOwner {
        minSyncInterval = interval;
    }

    function setJNSResolver(address resolver) external onlyOwner {
        jnsResolver = resolver;
    }
}

// Minimal JNS Resolver interface for sync operations
interface IENSMirrorResolver {
    function setContenthash(bytes32 node, bytes calldata hash) external;
    function setAddr(bytes32 node, address addr) external;
    function setText(bytes32 node, string calldata key, string calldata value) external;
}
