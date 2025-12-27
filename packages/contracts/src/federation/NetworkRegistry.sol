// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title NetworkRegistry
 * @author Jeju Network
 * @notice Federation hub for cross-network discovery and trust
 * @dev Deployed on a canonical hub chain (Ethereum mainnet) for all Jeju networks to reference
 *
 * Key Features:
 * - Permissionless network registration with stake
 * - Cross-network trust relationships
 * - Contract address discovery
 * - Governance integration for network verification
 *
 * Integration:
 * - Works with IdentityRegistry for cross-network identity
 * - Works with SolverRegistry for federated solver discovery
 * - Works with LiquidityVault for cross-network liquidity
 */
contract NetworkRegistry is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public constant MIN_STAKE = 1 ether;
    uint256 public constant VERIFICATION_STAKE = 10 ether;

    /// @notice Trust tiers determine what a network can participate in
    enum TrustTier {
        UNSTAKED, // Auto-joined, no stake - listed only, no consensus participation
        STAKED, // 1+ ETH stake - can participate in federation consensus
        VERIFIED // 10+ ETH + governance approval - full trust, sequencer eligible

    }

    struct NetworkContracts {
        address identityRegistry;
        address solverRegistry;
        address inputSettler;
        address outputSettler;
        address liquidityVault;
        address governance;
        address oracle;
        address registryHub; // Link to RegistryHub for this network
    }

    struct NetworkInfo {
        uint256 chainId;
        string name;
        string rpcUrl;
        string explorerUrl;
        string wsUrl;
        address operator;
        NetworkContracts contracts;
        bytes32 genesisHash;
        uint256 registeredAt;
        uint256 stake;
        TrustTier trustTier;
        bool isActive;
        bool isVerified;
        bool isSuperchain; // Part of OP Superchain
    }

    struct TrustRelation {
        bool isTrusted;
        uint256 establishedAt;
        address attestedBy;
    }

    mapping(uint256 => NetworkInfo) public networks;
    uint256[] public networkIds;
    mapping(uint256 => uint256) private networkIdToIndex;

    mapping(uint256 => mapping(uint256 => TrustRelation)) public trustRelations;
    mapping(uint256 => uint256[]) public trustedPeers;

    mapping(address => uint256) public operatorToNetwork;
    mapping(uint256 => address) public networkOperators;

    address public verificationAuthority;
    address public federationGovernance; // AI DAO governance contract
    uint256 public totalNetworks;
    uint256 public activeNetworks;
    uint256 public verifiedNetworks;

    // Pending governance approval for VERIFIED status
    mapping(uint256 => bool) public pendingVerification;

    event NetworkRegistered(uint256 indexed chainId, string name, address indexed operator, uint256 stake);
    event VerificationPending(uint256 indexed chainId, address indexed operator, uint256 stake);
    event VerificationRevoked(uint256 indexed chainId, string reason);
    event NetworkUpdated(uint256 indexed chainId, string name, address indexed operator);
    event NetworkDeactivated(uint256 indexed chainId, address indexed operator);
    event NetworkVerified(uint256 indexed chainId, address indexed verifier);
    event TrustEstablished(uint256 indexed sourceChainId, uint256 indexed targetChainId, address indexed attestedBy);
    event TrustRevoked(uint256 indexed sourceChainId, uint256 indexed targetChainId);
    event ContractsUpdated(uint256 indexed chainId);
    event StakeWithdrawn(uint256 indexed chainId, address indexed operator, uint256 amount);

    error NetworkExists();
    error NetworkNotFound();
    error InsufficientStake();
    error NotOperator();
    error AlreadyTrusted();
    error NotTrusted();
    error NetworkInactive();
    error CannotTrustSelf();
    error NotVerificationAuthority();
    error StillActive();
    error InvalidChainId();
    error NotGovernance();
    error AlreadyPendingVerification();
    error NotPendingVerification();

    modifier onlyGovernance() {
        if (msg.sender != federationGovernance) revert NotGovernance();
        _;
    }

    constructor(address _verificationAuthority) Ownable(msg.sender) {
        verificationAuthority = _verificationAuthority;
    }

    /**
     * @notice Set the federation governance contract
     * @dev Only owner can set, should point to FederationGovernance
     */
    function setFederationGovernance(address _governance) external onlyOwner {
        federationGovernance = _governance;
    }

    /**
     * @notice Register a new network in the Jeju Federation
     * @dev Auto-join with 0 stake is allowed but has UNSTAKED trust tier
     *      - UNSTAKED (0 ETH): Listed only, cannot participate in consensus
     *      - STAKED (1+ ETH): Can participate in federation consensus
     *      - VERIFIED (10+ ETH + governance): Full trust, sequencer eligible
     *
     * IMPORTANT: VERIFIED status requires governance approval even with 10+ ETH stake.
     * This prevents Sybil attacks on the sequencer set.
     */
    function registerNetwork(
        uint256 chainId,
        string calldata name,
        string calldata rpcUrl,
        string calldata explorerUrl,
        string calldata wsUrl,
        NetworkContracts calldata contracts,
        bytes32 genesisHash
    ) external payable nonReentrant {
        if (chainId == 0) revert InvalidChainId();
        if (networks[chainId].registeredAt != 0) revert NetworkExists();

        // Determine trust tier based on stake
        // NOTE: Even with 10+ ETH, tier is STAKED until governance approves VERIFIED
        TrustTier tier = TrustTier.UNSTAKED;
        bool triggerGovernance = false;

        if (msg.value >= VERIFICATION_STAKE) {
            tier = TrustTier.STAKED; // Start at STAKED, VERIFIED requires governance
            triggerGovernance = true;
        } else if (msg.value >= MIN_STAKE) {
            tier = TrustTier.STAKED;
        }

        networks[chainId] = NetworkInfo({
            chainId: chainId,
            name: name,
            rpcUrl: rpcUrl,
            explorerUrl: explorerUrl,
            wsUrl: wsUrl,
            operator: msg.sender,
            contracts: contracts,
            genesisHash: genesisHash,
            registeredAt: block.timestamp,
            stake: msg.value,
            trustTier: tier,
            isActive: true,
            isVerified: false, // Never auto-verified
            isSuperchain: false
        });

        networkIds.push(chainId);
        networkIdToIndex[chainId] = networkIds.length - 1;
        operatorToNetwork[msg.sender] = chainId;
        networkOperators[chainId] = msg.sender;
        totalNetworks++;
        activeNetworks++;

        emit NetworkRegistered(chainId, name, msg.sender, msg.value);

        // If staked enough for VERIFIED, trigger governance proposal
        if (triggerGovernance) {
            pendingVerification[chainId] = true;
            emit VerificationPending(chainId, msg.sender, msg.value);

            if (federationGovernance != address(0)) {
                (bool success,) = federationGovernance.call(
                    abi.encodeWithSignature(
                        "createNetworkProposal(uint256,address,uint256)", chainId, msg.sender, msg.value
                    )
                );
                // Governance proposal creation is best-effort
                // Can be manually created if this fails
                if (success) {
                    // Proposal created successfully
                }
            }
        }
    }

    /**
     * @notice Add stake to upgrade trust tier
     * @dev When hitting VERIFICATION_STAKE, triggers governance proposal for AI DAO review
     *      VERIFIED status is NOT auto-granted - must go through FederationGovernance
     */
    function addStake(uint256 chainId) external payable nonReentrant {
        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();
        if (network.operator != msg.sender) revert NotOperator();

        uint256 previousStake = network.stake;
        network.stake += msg.value;

        // If crossing VERIFICATION_STAKE threshold, trigger governance proposal
        if (previousStake < VERIFICATION_STAKE && network.stake >= VERIFICATION_STAKE) {
            if (pendingVerification[chainId]) revert AlreadyPendingVerification();
            pendingVerification[chainId] = true;

            // Upgrade to STAKED tier (not VERIFIED yet - needs governance approval)
            if (network.trustTier == TrustTier.UNSTAKED) {
                network.trustTier = TrustTier.STAKED;
            }

            emit VerificationPending(chainId, msg.sender, network.stake);

            // Notify FederationGovernance to create proposal
            if (federationGovernance != address(0)) {
                // Interface call to create governance proposal
                (bool success,) = federationGovernance.call(
                    abi.encodeWithSignature(
                        "createNetworkProposal(uint256,address,uint256)", chainId, msg.sender, network.stake
                    )
                );
                // Don't revert if governance call fails - stake is still added
                // Governance can manually pick up pending verifications
                if (!success) {
                    // Emit event for manual handling
                    emit VerificationPending(chainId, msg.sender, network.stake);
                }
            }
        } else if (network.stake >= MIN_STAKE && network.trustTier == TrustTier.UNSTAKED) {
            // Upgrade to STAKED tier
            network.trustTier = TrustTier.STAKED;
        }

        emit NetworkUpdated(chainId, network.name, msg.sender);
    }

    /**
     * @notice Set VERIFIED status after governance approval
     * @dev Only callable by FederationGovernance after AI DAO approves
     */
    function setVerifiedByGovernance(uint256 chainId) external onlyGovernance {
        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();
        if (!pendingVerification[chainId]) revert NotPendingVerification();

        pendingVerification[chainId] = false;
        network.trustTier = TrustTier.VERIFIED;
        network.isVerified = true;
        verifiedNetworks++;

        emit NetworkVerified(chainId, msg.sender);
    }

    /**
     * @notice Revoke VERIFIED status (e.g., after successful challenge)
     * @dev Only callable by FederationGovernance
     */
    function revokeVerifiedStatus(uint256 chainId) external onlyGovernance {
        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();
        if (!network.isVerified) return; // Already not verified

        network.isVerified = false;
        network.trustTier = TrustTier.STAKED; // Downgrade to STAKED
        if (verifiedNetworks > 0) verifiedNetworks--;

        emit VerificationRevoked(chainId, "Governance revocation");
    }

    /**
     * @notice Slash network stake (e.g., after malicious behavior)
     * @dev Only callable by FederationGovernance
     * @param chainId Network to slash
     * @param percentageBps Percentage to slash in basis points (10000 = 100%)
     * @param recipient Where to send slashed funds
     */
    function slashStake(uint256 chainId, uint256 percentageBps, address recipient)
        external
        onlyGovernance
        nonReentrant
    {
        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();
        require(percentageBps <= 10000, "Invalid percentage");

        uint256 slashAmount = (network.stake * percentageBps) / 10000;
        network.stake -= slashAmount;

        // Downgrade tier if below threshold
        if (network.stake < VERIFICATION_STAKE && network.isVerified) {
            network.isVerified = false;
            network.trustTier = TrustTier.STAKED;
            if (verifiedNetworks > 0) verifiedNetworks--;
        }
        if (network.stake < MIN_STAKE) {
            network.trustTier = TrustTier.UNSTAKED;
        }

        (bool success,) = recipient.call{value: slashAmount}("");
        require(success, "Slash transfer failed");

        emit VerificationRevoked(chainId, "Stake slashed");
    }

    /**
     * @notice Mark network as Superchain member
     */
    function setSuperchainStatus(uint256 chainId, bool isSuperchain) external {
        if (msg.sender != verificationAuthority && msg.sender != owner()) {
            revert NotVerificationAuthority();
        }
        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();

        network.isSuperchain = isSuperchain;
        emit NetworkUpdated(chainId, network.name, network.operator);
    }

    /**
     * @notice Check if network can participate in federation consensus
     */
    function canParticipateInConsensus(uint256 chainId) external view returns (bool) {
        NetworkInfo storage network = networks[chainId];
        return network.isActive && network.trustTier >= TrustTier.STAKED;
    }

    /**
     * @notice Check if network is eligible for sequencer duties
     */
    function isSequencerEligible(uint256 chainId) external view returns (bool) {
        NetworkInfo storage network = networks[chainId];
        return network.isActive && network.trustTier == TrustTier.VERIFIED;
    }

    function updateNetwork(
        uint256 chainId,
        string calldata name,
        string calldata rpcUrl,
        string calldata explorerUrl,
        string calldata wsUrl
    ) external {
        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();
        if (network.operator != msg.sender) revert NotOperator();

        network.name = name;
        network.rpcUrl = rpcUrl;
        network.explorerUrl = explorerUrl;
        network.wsUrl = wsUrl;

        emit NetworkUpdated(chainId, name, msg.sender);
    }

    function updateContracts(uint256 chainId, NetworkContracts calldata contracts) external {
        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();
        if (network.operator != msg.sender) revert NotOperator();

        network.contracts = contracts;

        emit ContractsUpdated(chainId);
    }

    function deactivateNetwork(uint256 chainId) external {
        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();
        if (network.operator != msg.sender) revert NotOperator();
        if (!network.isActive) revert NetworkInactive();

        network.isActive = false;
        activeNetworks--;

        emit NetworkDeactivated(chainId, msg.sender);
    }

    function withdrawStake(uint256 chainId) external nonReentrant {
        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();
        if (network.operator != msg.sender) revert NotOperator();
        if (network.isActive) revert StillActive();

        uint256 amount = network.stake;
        network.stake = 0;

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit StakeWithdrawn(chainId, msg.sender, amount);
    }

    function verifyNetwork(uint256 chainId) external {
        if (msg.sender != verificationAuthority && msg.sender != owner()) {
            revert NotVerificationAuthority();
        }

        NetworkInfo storage network = networks[chainId];
        if (network.registeredAt == 0) revert NetworkNotFound();

        if (!network.isVerified) {
            network.isVerified = true;
            verifiedNetworks++;
        }

        emit NetworkVerified(chainId, msg.sender);
    }

    function establishTrust(uint256 sourceChainId, uint256 targetChainId) external {
        if (sourceChainId == targetChainId) revert CannotTrustSelf();

        NetworkInfo storage source = networks[sourceChainId];
        if (source.registeredAt == 0) revert NetworkNotFound();
        if (source.operator != msg.sender) revert NotOperator();
        if (!source.isActive) revert NetworkInactive();

        NetworkInfo storage target = networks[targetChainId];
        if (target.registeredAt == 0) revert NetworkNotFound();
        if (!target.isActive) revert NetworkInactive();

        TrustRelation storage relation = trustRelations[sourceChainId][targetChainId];
        if (relation.isTrusted) revert AlreadyTrusted();

        relation.isTrusted = true;
        relation.establishedAt = block.timestamp;
        relation.attestedBy = msg.sender;

        trustedPeers[sourceChainId].push(targetChainId);

        emit TrustEstablished(sourceChainId, targetChainId, msg.sender);
    }

    function revokeTrust(uint256 sourceChainId, uint256 targetChainId) external {
        NetworkInfo storage source = networks[sourceChainId];
        if (source.registeredAt == 0) revert NetworkNotFound();
        if (source.operator != msg.sender) revert NotOperator();

        TrustRelation storage relation = trustRelations[sourceChainId][targetChainId];
        if (!relation.isTrusted) revert NotTrusted();

        relation.isTrusted = false;

        uint256[] storage peers = trustedPeers[sourceChainId];
        for (uint256 i = 0; i < peers.length; i++) {
            if (peers[i] == targetChainId) {
                peers[i] = peers[peers.length - 1];
                peers.pop();
                break;
            }
        }

        emit TrustRevoked(sourceChainId, targetChainId);
    }

    function setVerificationAuthority(address authority) external onlyOwner {
        verificationAuthority = authority;
    }

    function getNetwork(uint256 chainId) external view returns (NetworkInfo memory) {
        if (networks[chainId].registeredAt == 0) revert NetworkNotFound();
        return networks[chainId];
    }

    function getNetworkContracts(uint256 chainId) external view returns (NetworkContracts memory) {
        if (networks[chainId].registeredAt == 0) revert NetworkNotFound();
        return networks[chainId].contracts;
    }

    function isTrusted(uint256 sourceChainId, uint256 targetChainId) external view returns (bool) {
        return trustRelations[sourceChainId][targetChainId].isTrusted;
    }

    function isMutuallyTrusted(uint256 chainA, uint256 chainB) external view returns (bool) {
        return trustRelations[chainA][chainB].isTrusted && trustRelations[chainB][chainA].isTrusted;
    }

    function getTrustedPeers(uint256 chainId) external view returns (uint256[] memory) {
        return trustedPeers[chainId];
    }

    function getActiveNetworks() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < networkIds.length; i++) {
            if (networks[networkIds[i]].isActive) count++;
        }

        uint256[] memory active = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < networkIds.length; i++) {
            if (networks[networkIds[i]].isActive) {
                active[idx++] = networkIds[i];
            }
        }
        return active;
    }

    function getVerifiedNetworks() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < networkIds.length; i++) {
            if (networks[networkIds[i]].isVerified && networks[networkIds[i]].isActive) count++;
        }

        uint256[] memory verified = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < networkIds.length; i++) {
            if (networks[networkIds[i]].isVerified && networks[networkIds[i]].isActive) {
                verified[idx++] = networkIds[i];
            }
        }
        return verified;
    }

    function getAllNetworkIds() external view returns (uint256[] memory) {
        return networkIds;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
