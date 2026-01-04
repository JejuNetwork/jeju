// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SQLitIdentityRegistry
 * @notice On-chain verification and registry for SQLit/CovenantSQL node identities
 * @dev Implements the CovenantSQL identity verification algorithm:
 *      NodeID = sha256(blake2b-512(PublicKey || Nonce))
 *
 * This contract serves as the SOURCE OF TRUTH for SQLit node identities on Jeju Network.
 * Nodes discover peers by querying this contract, ensuring cryptographic verification
 * is enforced on-chain with staking requirements.
 *
 * Integration with OP Stack:
 * - Deployed on Jeju L2 (OP Stack rollup)
 * - Uses EIP-152 BLAKE2b precompile (address 0x09)
 * - Node operators stake JEJU tokens
 * - Identity is linked to Ethereum address for slashing
 */
contract SQLitIdentityRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice BLAKE2b compression function precompile (EIP-152)
    address constant BLAKE2B_PRECOMPILE = address(0x09);

    /// @notice Minimum stake for block producers (100k JEJU)
    uint256 public constant MIN_BP_STAKE = 100_000 ether;

    /// @notice Minimum stake for miners (10k JEJU)
    uint256 public constant MIN_MINER_STAKE = 10_000 ether;

    /// @notice Minimum NodeID difficulty (leading zero bits)
    uint8 public constant MIN_NODE_ID_DIFFICULTY = 24; // 6 hex zeros = 24 bits

    // ============ Types ============

    /// @notice CovenantSQL Nonce structure (4 x uint64)
    struct Nonce {
        uint64 a;
        uint64 b;
        uint64 c;
        uint64 d;
    }

    /// @notice Full SQLit node identity
    struct NodeIdentity {
        bytes32 nodeId;           // 32 bytes - the computed NodeID
        bytes publicKey;          // 33 bytes - compressed secp256k1 public key
        Nonce nonce;              // 32 bytes - proof-of-work nonce
        address operator;         // Ethereum address of operator
        uint256 stakedAmount;     // Staked JEJU tokens
        uint256 registeredAt;     // Registration timestamp
        uint256 lastHeartbeat;    // Last heartbeat timestamp
        string endpoint;          // Network endpoint (host:port)
        NodeRole role;            // Block producer or miner
        NodeStatus status;        // Current status
    }

    enum NodeRole {
        BLOCK_PRODUCER,
        MINER
    }

    enum NodeStatus {
        PENDING,      // Registered, awaiting activation
        ACTIVE,       // Fully operational
        SUSPENDED,    // Temporarily offline
        SLASHED,      // Penalized
        EXITING       // Unbonding
    }

    // ============ State ============

    /// @notice Staking token (JEJU)
    IERC20 public immutable stakingToken;

    /// @notice NodeID => Identity mapping
    mapping(bytes32 => NodeIdentity) public identities;

    /// @notice Operator address => NodeIDs
    mapping(address => bytes32[]) public operatorNodes;

    /// @notice All block producer NodeIDs (for discovery)
    bytes32[] public blockProducers;

    /// @notice All miner NodeIDs (for discovery)
    bytes32[] public miners;

    /// @notice Total staked tokens
    uint256 public totalStaked;

    // ============ Events ============

    event IdentityRegistered(
        bytes32 indexed nodeId,
        address indexed operator,
        bytes publicKey,
        Nonce nonce,
        NodeRole role,
        uint256 stake
    );

    event IdentityActivated(bytes32 indexed nodeId);
    event IdentitySuspended(bytes32 indexed nodeId, string reason);
    event IdentitySlashed(bytes32 indexed nodeId, uint256 amount, string reason);
    event HeartbeatReceived(bytes32 indexed nodeId, uint256 timestamp);
    event EndpointUpdated(bytes32 indexed nodeId, string newEndpoint);

    // ============ Errors ============

    error InvalidPublicKeyLength();
    error IdentityVerificationFailed();
    error InsufficientDifficulty();
    error NodeAlreadyRegistered();
    error InsufficientStake();
    error NotNodeOperator();
    error InvalidNodeStatus();
    error Blake2bPrecompileFailed();

    // ============ Constructor ============

    constructor(address _stakingToken, address _owner) Ownable(_owner) {
        stakingToken = IERC20(_stakingToken);
    }

    // ============ Core Functions ============

    /**
     * @notice Register a new SQLit node with on-chain identity verification
     * @param publicKey Compressed secp256k1 public key (33 bytes)
     * @param nonce Proof-of-work nonce
     * @param nodeId Pre-computed NodeID (will be verified)
     * @param role Block producer or miner
     * @param endpoint Network endpoint (host:port)
     * @param stakeAmount Amount to stake
     */
    function registerIdentity(
        bytes calldata publicKey,
        Nonce calldata nonce,
        bytes32 nodeId,
        NodeRole role,
        string calldata endpoint,
        uint256 stakeAmount
    ) external nonReentrant {
        // Validate public key length (compressed secp256k1 = 33 bytes)
        if (publicKey.length != 33) revert InvalidPublicKeyLength();

        // Check not already registered
        if (identities[nodeId].registeredAt != 0) revert NodeAlreadyRegistered();

        // Verify the identity: NodeID = sha256(blake2b-512(publicKey || nonce))
        bytes32 computedNodeId = computeNodeId(publicKey, nonce);
        if (computedNodeId != nodeId) revert IdentityVerificationFailed();

        // Check proof-of-work difficulty (leading zeros)
        if (!checkDifficulty(nodeId, MIN_NODE_ID_DIFFICULTY)) revert InsufficientDifficulty();

        // Check minimum stake
        uint256 minStake = role == NodeRole.BLOCK_PRODUCER ? MIN_BP_STAKE : MIN_MINER_STAKE;
        if (stakeAmount < minStake) revert InsufficientStake();

        // Transfer stake
        stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        // Store identity
        identities[nodeId] = NodeIdentity({
            nodeId: nodeId,
            publicKey: publicKey,
            nonce: nonce,
            operator: msg.sender,
            stakedAmount: stakeAmount,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            endpoint: endpoint,
            role: role,
            status: NodeStatus.ACTIVE
        });

        operatorNodes[msg.sender].push(nodeId);

        if (role == NodeRole.BLOCK_PRODUCER) {
            blockProducers.push(nodeId);
        } else {
            miners.push(nodeId);
        }

        totalStaked += stakeAmount;

        emit IdentityRegistered(nodeId, msg.sender, publicKey, nonce, role, stakeAmount);
        emit IdentityActivated(nodeId);
    }

    /**
     * @notice Compute NodeID using CovenantSQL algorithm
     * @dev NodeID = reverse(sha256(blake2b-512(publicKey || nonce)))
     *      - Nonce is serialized as 4x uint64 big-endian (A, B, C, D sequential)
     *      - Final hash is byte-reversed (Bitcoin-style hash display)
     * @param publicKey Compressed secp256k1 public key
     * @param nonce Proof-of-work nonce
     * @return nodeId The computed 32-byte NodeID (byte-reversed for CovenantSQL compatibility)
     */
    function computeNodeId(
        bytes calldata publicKey,
        Nonce calldata nonce
    ) public view returns (bytes32) {
        // Serialize nonce as 32 bytes (4 x uint64, BIG-ENDIAN as per CovenantSQL)
        // binary.Write(&binBuf, binary.BigEndian, i) in Go
        bytes memory nonceBytes = abi.encodePacked(
            _toBigEndian64(nonce.a),
            _toBigEndian64(nonce.b),
            _toBigEndian64(nonce.c),
            _toBigEndian64(nonce.d)
        );

        // Concatenate publicKey || nonce (using abi.encode to avoid collision with dynamic args)
        bytes memory input = abi.encode(publicKey, nonceBytes);

        // Compute blake2b-512
        bytes memory blake2bHash = _blake2b512(input);

        // Compute sha256 of the blake2b result
        bytes32 rawHash = sha256(blake2bHash);

        // Reverse bytes for CovenantSQL NodeID format (Bitcoin-style)
        return _reverseBytes32(rawHash);
    }

    /**
     * @notice Verify an identity without registering
     * @param publicKey Compressed secp256k1 public key
     * @param nonce Proof-of-work nonce
     * @param nodeId NodeID to verify
     * @return valid True if identity is valid
     */
    function verifyIdentity(
        bytes calldata publicKey,
        Nonce calldata nonce,
        bytes32 nodeId
    ) external view returns (bool valid) {
        if (publicKey.length != 33) return false;
        bytes32 computed = computeNodeId(publicKey, nonce);
        return computed == nodeId && checkDifficulty(nodeId, MIN_NODE_ID_DIFFICULTY);
    }

    /**
     * @notice Check if NodeID meets minimum difficulty (leading zero bits)
     * @param nodeId The NodeID to check
     * @param requiredBits Minimum leading zero bits required
     * @return meets True if difficulty is met
     */
    function checkDifficulty(bytes32 nodeId, uint8 requiredBits) public pure returns (bool meets) {
        // Count leading zero bits
        uint256 value = uint256(nodeId);
        uint256 leadingZeros = 0;

        // Check each bit from most significant
        for (uint256 i = 0; i < 256; i++) {
            if ((value >> (255 - i)) & 1 == 0) {
                leadingZeros++;
            } else {
                break;
            }
        }

        return leadingZeros >= requiredBits;
    }

    // ============ Node Operations ============

    /**
     * @notice Send heartbeat to prove liveness
     * @param nodeId The node's identity
     */
    function heartbeat(bytes32 nodeId) external {
        NodeIdentity storage identity = identities[nodeId];
        if (identity.operator != msg.sender) revert NotNodeOperator();
        if (identity.status != NodeStatus.ACTIVE) revert InvalidNodeStatus();

        identity.lastHeartbeat = block.timestamp;
        emit HeartbeatReceived(nodeId, block.timestamp);
    }

    /**
     * @notice Update node endpoint
     * @param nodeId The node's identity
     * @param newEndpoint New network endpoint
     */
    function updateEndpoint(bytes32 nodeId, string calldata newEndpoint) external {
        NodeIdentity storage identity = identities[nodeId];
        if (identity.operator != msg.sender) revert NotNodeOperator();

        identity.endpoint = newEndpoint;
        emit EndpointUpdated(nodeId, newEndpoint);
    }

    // ============ Discovery Functions ============

    /**
     * @notice Get all active block producers for node discovery
     * @return nodeIds Array of active block producer NodeIDs
     * @return endpoints Array of corresponding endpoints
     * @return publicKeys Array of corresponding public keys
     * @return nonces Array of corresponding nonces
     */
    function getActiveBlockProducers() external view returns (
        bytes32[] memory nodeIds,
        string[] memory endpoints,
        bytes[] memory publicKeys,
        Nonce[] memory nonces
    ) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < blockProducers.length; i++) {
            if (identities[blockProducers[i]].status == NodeStatus.ACTIVE) {
                activeCount++;
            }
        }

        nodeIds = new bytes32[](activeCount);
        endpoints = new string[](activeCount);
        publicKeys = new bytes[](activeCount);
        nonces = new Nonce[](activeCount);

        uint256 j = 0;
        for (uint256 i = 0; i < blockProducers.length; i++) {
            NodeIdentity storage identity = identities[blockProducers[i]];
            if (identity.status == NodeStatus.ACTIVE) {
                nodeIds[j] = identity.nodeId;
                endpoints[j] = identity.endpoint;
                publicKeys[j] = identity.publicKey;
                nonces[j] = identity.nonce;
                j++;
            }
        }
    }

    /**
     * @notice Get full identity for a node
     * @param nodeId The NodeID to query
     * @return identity The full node identity
     */
    function getIdentity(bytes32 nodeId) external view returns (NodeIdentity memory identity) {
        return identities[nodeId];
    }

    /**
     * @notice Get block producer count
     */
    function getBlockProducerCount() external view returns (uint256) {
        return blockProducers.length;
    }

    /**
     * @notice Get miner count
     */
    function getMinerCount() external view returns (uint256) {
        return miners.length;
    }

    // ============ Internal Functions ============

    /**
     * @notice Compute BLAKE2b-512 using EIP-152 precompile
     * @dev Uses the F compression function iteratively
     * @param input Input bytes to hash
     * @return hash 64-byte BLAKE2b-512 hash
     */
    function _blake2b512(bytes memory input) internal view returns (bytes memory) {
        // BLAKE2b-512 initialization vector
        bytes8[8] memory iv = [
            bytes8(0x6a09e667f3bcc908),
            bytes8(0xbb67ae8584caa73b),
            bytes8(0x3c6ef372fe94f82b),
            bytes8(0xa54ff53a5f1d36f1),
            bytes8(0x510e527fade682d1),
            bytes8(0x9b05688c2b3e6c1f),
            bytes8(0x1f83d9abfb41bd6b),
            bytes8(0x5be0cd19137e2179)
        ];

        // Initialize state with output length XOR'd into first word
        bytes8[8] memory h;
        h[0] = bytes8(uint64(iv[0]) ^ 0x01010040); // 0x40 = 64 bytes output
        for (uint i = 1; i < 8; i++) {
            h[i] = iv[i];
        }

        uint256 inputLen = input.length;
        uint256 offset = 0;

        // Process full blocks (128 bytes each)
        while (offset + 128 <= inputLen) {
            bytes memory block_ = new bytes(128);
            for (uint i = 0; i < 128; i++) {
                block_[i] = input[offset + i];
            }

            h = _blake2bCompress(h, block_, uint64(offset + 128), false);
            offset += 128;
        }

        // Process final block with padding
        bytes memory lastBlock = new bytes(128);
        uint256 remaining = inputLen - offset;
        for (uint i = 0; i < remaining; i++) {
            lastBlock[i] = input[offset + i];
        }
        // Rest is already zero-padded

        h = _blake2bCompress(h, lastBlock, uint64(inputLen), true);

        // Convert state to bytes (little-endian)
        bytes memory result = new bytes(64);
        for (uint i = 0; i < 8; i++) {
            uint64 word = uint64(h[i]);
            for (uint j = 0; j < 8; j++) {
                result[i * 8 + j] = bytes1(uint8(word >> (j * 8)));
            }
        }

        return result;
    }

    /**
     * @notice Call BLAKE2b compression function precompile
     * @param h Current state (8 x 64-bit words)
     * @param m Message block (128 bytes)
     * @param t Byte counter
     * @param f Finalization flag
     * @return newH Updated state
     */
    function _blake2bCompress(
        bytes8[8] memory h,
        bytes memory m,
        uint64 t,
        bool f
    ) internal view returns (bytes8[8] memory newH) {
        // Encode input for precompile:
        // 4 bytes: rounds (12 for BLAKE2b)
        // 64 bytes: h (state)
        // 128 bytes: m (message)
        // 8 bytes: t[0] (counter low)
        // 8 bytes: t[1] (counter high, always 0 for our use)
        // 1 byte: f (finalization flag)

        bytes memory input = new bytes(213);

        // Rounds = 12 (big-endian)
        input[0] = 0x00;
        input[1] = 0x00;
        input[2] = 0x00;
        input[3] = 0x0c;

        // State h (little-endian words)
        for (uint i = 0; i < 8; i++) {
            uint64 word = uint64(h[i]);
            for (uint j = 0; j < 8; j++) {
                input[4 + i * 8 + j] = bytes1(uint8(word >> (j * 8)));
            }
        }

        // Message m
        for (uint i = 0; i < 128; i++) {
            input[68 + i] = m[i];
        }

        // Counter t (little-endian)
        for (uint j = 0; j < 8; j++) {
            input[196 + j] = bytes1(uint8(t >> (j * 8)));
        }

        // Counter high (0)
        // bytes 204-211 are already 0

        // Finalization flag
        input[212] = f ? bytes1(0x01) : bytes1(0x00);

        // Call precompile
        (bool success, bytes memory output) = BLAKE2B_PRECOMPILE.staticcall(input);
        if (!success || output.length != 64) revert Blake2bPrecompileFailed();

        // Parse output back to state
        for (uint i = 0; i < 8; i++) {
            uint64 word = 0;
            for (uint j = 0; j < 8; j++) {
                word |= uint64(uint8(output[i * 8 + j])) << (j * 8);
            }
            newH[i] = bytes8(word);
        }
    }

    /**
     * @notice Convert uint64 to big-endian bytes (as CovenantSQL serializes nonces)
     * @dev Solidity stores uint64 in big-endian by default in abi.encodePacked
     */
    function _toBigEndian64(uint64 value) internal pure returns (bytes8) {
        return bytes8(value);
    }

    /**
     * @notice Reverse bytes in a bytes32 (for Bitcoin-style hash display)
     * @dev CovenantSQL stores NodeIDs with reversed bytes compared to raw hash output
     */
    function _reverseBytes32(bytes32 input) internal pure returns (bytes32) {
        bytes32 result;
        assembly {
            // Reverse all 32 bytes
            for { let i := 0 } lt(i, 32) { i := add(i, 1) } {
                let b := byte(i, input)
                result := or(result, shl(mul(8, i), b))
            }
        }
        return result;
    }

    // ============ Admin Functions ============

    /**
     * @notice Slash a node for misbehavior
     * @param nodeId Node to slash
     * @param bps Slash amount in basis points
     * @param reason Reason for slashing
     */
    function slashNode(
        bytes32 nodeId,
        uint256 bps,
        string calldata reason
    ) external onlyOwner {
        NodeIdentity storage identity = identities[nodeId];
        require(identity.registeredAt != 0, "Node not found");

        uint256 slashAmount = (identity.stakedAmount * bps) / 10000;
        identity.stakedAmount -= slashAmount;
        identity.status = NodeStatus.SLASHED;
        totalStaked -= slashAmount;

        stakingToken.safeTransfer(owner(), slashAmount);

        emit IdentitySlashed(nodeId, slashAmount, reason);
    }

    /**
     * @notice Suspend a node
     * @param nodeId Node to suspend
     * @param reason Reason for suspension
     */
    function suspendNode(bytes32 nodeId, string calldata reason) external onlyOwner {
        NodeIdentity storage identity = identities[nodeId];
        require(identity.registeredAt != 0, "Node not found");

        identity.status = NodeStatus.SUSPENDED;
        emit IdentitySuspended(nodeId, reason);
    }

    /**
     * @notice Reactivate a suspended node
     * @param nodeId Node to reactivate
     */
    function reactivateNode(bytes32 nodeId) external onlyOwner {
        NodeIdentity storage identity = identities[nodeId];
        require(
            identity.status == NodeStatus.SUSPENDED ||
            identity.status == NodeStatus.SLASHED,
            "Invalid status"
        );

        identity.status = NodeStatus.ACTIVE;
        identity.lastHeartbeat = block.timestamp;
        emit IdentityActivated(nodeId);
    }
}
