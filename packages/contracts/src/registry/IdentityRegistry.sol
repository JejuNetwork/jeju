// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IIdentityRegistry.sol";

/**
 * @title IdentityRegistry
 * @author Jeju Network (adapted from ChaosChain Labs)
 * @notice ERC-8004 v2.0 compliant agent identity registry with optional staking and futarchy governance
 * @dev Each agent is represented as an ERC-721 NFT with optional stake tiers and on-chain metadata
 *
 * Key Features:
 * - Permissionless registration (anyone can register for free)
 * - Optional stake tiers: None, Small (.001 ETH), Medium (.01 ETH), High (.1 ETH)
 * - Futarchy-based governance for slashing and banning via predimarket
 * - Higher stakes act as reputation signal and spam deterrent
 * - Refundable deposits on voluntary de-registration
 * - Tag-based discovery for filtering agents
 * - A2A endpoint storage for agent communication
 * - Appeals mechanism for unfair bans
 *
 * Architecture:
 * - ERC-721 compliance makes agents browsable and transferable
 * - Multi-token staking support (ETH, elizaOS, CLANKER, VIRTUAL, etc.)
 * - Governance contract controls bans and slashing
 * - Predimarket integration for decentralized decision-making
 * - Reputation oracle aggregates multiple signals
 *
 * Integration with Jeju:
 * - Agents can earn fees through paymaster system
 * - Agent NFTs gate access to premium features
 * - Stake tiers influence trustworthiness scores
 * - Gateway UI provides full CRUD interface
 *
 * @custom:security-contact security@jeju.network
 */
contract IdentityRegistry is ERC721URIStorage, ReentrancyGuard, Pausable, IIdentityRegistry {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    /// @notice Stake tier levels
    enum StakeTier {
        NONE, // Free registration, no stake
        SMALL, // .001 ETH (~$3.50)
        MEDIUM, // .01 ETH (~$35)
        HIGH // .1 ETH (~$350)

    }

    // ============ Structs ============

    /// @notice Agent registration data
    struct AgentRegistration {
        uint256 agentId;
        address owner;
        StakeTier tier;
        address stakedToken;
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastActivityAt;
        bool isBanned;
        bool isSlashed;
    }

    // ============ Constants ============

    /// @notice Stake amounts for each tier (in wei)
    uint256 public constant STAKE_SMALL = 0.001 ether;
    uint256 public constant STAKE_MEDIUM = 0.01 ether;
    uint256 public constant STAKE_HIGH = 0.1 ether;

    /// @notice Maximum metadata value size to prevent gas griefing
    uint256 public constant MAX_METADATA_SIZE = 8192;

    /// @notice Maximum metadata key length
    uint256 public constant MAX_KEY_LENGTH = 256;

    /// @notice Maximum tags per agent
    uint256 public constant MAX_TAGS = 10;

    // ============ State Variables ============

    /// @notice Counter for agent IDs (tokenIds)
    uint256 private _nextAgentId;

    /// @notice Agent registration data
    mapping(uint256 => AgentRegistration) public agents;

    /// @notice Mapping from agentId to metadata key to metadata value
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    /// @notice Tags per agent (for discovery)
    mapping(uint256 => string[]) private _agentTags;

    /// @notice Reverse mapping: tag => agentIds
    mapping(string => uint256[]) private _tagToAgents;

    /// @notice Supported stake tokens (ETH = address(0))
    address[] public supportedStakeTokens;
    mapping(address => bool) public isSupportedStakeToken;

    /// @notice Total staked per token
    mapping(address => uint256) public totalStakedByToken;

    /// @notice Governance contract (can slash/ban)
    address public governance;

    /// @notice Reputation oracle contract
    address public reputationOracle;

    // ============ Events ============

    event Registered(
        uint256 indexed agentId, address indexed owner, StakeTier tier, uint256 stakedAmount, string tokenURI
    );
    event StakeIncreased(uint256 indexed agentId, StakeTier oldTier, StakeTier newTier, uint256 addedAmount);
    event StakeWithdrawn(uint256 indexed agentId, address indexed owner, uint256 amount);
    event AgentBanned(uint256 indexed agentId, string reason);
    event AgentUnbanned(uint256 indexed agentId);
    event AgentSlashed(uint256 indexed agentId, uint256 slashAmount, string reason);
    event TagsUpdated(uint256 indexed agentId, string[] tags);
    event AgentUriUpdated(uint256 indexed agentId, string newTokenURI);
    event GovernanceUpdated(address oldGovernance, address newGovernance);
    event ReputationOracleUpdated(address oldOracle, address newOracle);
    event StakeTokenAdded(address indexed token);
    event StakeTokenRemoved(address indexed token);

    // ============ Errors ============

    error MetadataTooLarge();
    error KeyTooLong();
    error InvalidStakeAmount();
    error TokenNotSupported();
    error StakeAlreadyWithdrawn();
    error NotAgentOwner();
    error TooManyTags();
    error InvalidTag();
    error AgentIsBanned();
    error AgentIsNotBanned();
    error OnlyGovernance();
    error CannotDowngradeTier();
    error InvalidStakeTier();
    error AgentNotFound();

    // ============ Modifiers ============

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    modifier notBanned(uint256 agentId) {
        if (agents[agentId].isBanned) revert AgentIsBanned();
        _;
    }

    // ============ Constructor ============

    constructor() ERC721("ERC-8004 Trustless Agent", "AGENT") {
        _nextAgentId = 1; // Start from 1, 0 is invalid
        governance = msg.sender; // Initially sender, should be set to governance contract

        // Initialize supported tokens (ETH is address(0))
        _addSupportedToken(address(0)); // ETH
    }

    // ============ Admin Functions ============

    /**
     * @notice Add a supported stake token
     * @param token Token address (address(0) for ETH)
     */
    function addSupportedToken(address token) external onlyGovernance {
        require(!isSupportedStakeToken[token], "Already supported");
        _addSupportedToken(token);
    }

    /**
     * @notice Remove a supported stake token
     * @param token Token address to remove
     */
    function removeSupportedToken(address token) external onlyGovernance {
        require(isSupportedStakeToken[token], "Token not supported");
        require(totalStakedByToken[token] == 0, "Token has active stakes");

        isSupportedStakeToken[token] = false;

        // Remove from array
        for (uint256 i = 0; i < supportedStakeTokens.length; i++) {
            if (supportedStakeTokens[i] == token) {
                supportedStakeTokens[i] = supportedStakeTokens[supportedStakeTokens.length - 1];
                supportedStakeTokens.pop();
                break;
            }
        }

        emit StakeTokenRemoved(token);
    }

    /**
     * @notice Update governance contract
     */
    function setGovernance(address newGovernance) external onlyGovernance {
        require(newGovernance != address(0), "Invalid governance");
        address oldGovernance = governance;
        governance = newGovernance;
        emit GovernanceUpdated(oldGovernance, newGovernance);
    }

    /**
     * @notice Update reputation oracle
     */
    function setReputationOracle(address newOracle) external onlyGovernance {
        address oldOracle = reputationOracle;
        reputationOracle = newOracle;
        emit ReputationOracleUpdated(oldOracle, newOracle);
    }

    /**
     * @notice Pause registrations (emergency)
     */
    function pause() external onlyGovernance {
        _pause();
    }

    /**
     * @notice Unpause registrations
     */
    function unpause() external onlyGovernance {
        _unpause();
    }

    // ============ Registration Functions ============

    /**
     * @notice Register a new agent with tokenURI and metadata (free, no stake)
     * @param tokenURI_ The URI pointing to the agent's registration JSON file
     * @param metadata Array of metadata entries to set for the agent
     * @return agentId The newly assigned agent ID
     */
    function register(string calldata tokenURI_, MetadataEntry[] calldata metadata)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 agentId)
    {
        agentId = _mintAgent(msg.sender, tokenURI_);

        // Set metadata if provided
        if (metadata.length > 0) {
            _setMetadataBatch(agentId, metadata);
        }
    }

    /**
     * @notice Register a new agent with tokenURI only (free, no stake)
     * @param tokenURI_ The URI pointing to the agent's registration JSON file
     * @return agentId The newly assigned agent ID
     */
    function register(string calldata tokenURI_) external nonReentrant whenNotPaused returns (uint256 agentId) {
        agentId = _mintAgent(msg.sender, tokenURI_);
    }

    /**
     * @notice Register a new agent without tokenURI (free, no stake)
     * @dev The tokenURI can be set later using _setTokenURI() by the owner
     * @return agentId The newly assigned agent ID
     */
    function register() external nonReentrant whenNotPaused returns (uint256 agentId) {
        agentId = _mintAgent(msg.sender, "");
    }

    /**
     * @notice Register with optional stake for reputation boost
     * @param tokenURI_ The URI pointing to the agent's registration JSON file
     * @param metadata Array of metadata entries
     * @param tier_ Stake tier (SMALL, MEDIUM, or HIGH)
     * @param stakeToken_ Token to stake (address(0) for ETH)
     * @return agentId The newly assigned agent ID
     */
    function registerWithStake(
        string calldata tokenURI_,
        MetadataEntry[] calldata metadata,
        StakeTier tier_,
        address stakeToken_
    ) external payable nonReentrant whenNotPaused returns (uint256 agentId) {
        if (tier_ == StakeTier.NONE) revert InvalidStakeTier();
        if (!isSupportedStakeToken[stakeToken_]) revert TokenNotSupported();

        uint256 requiredStake = getStakeAmount(tier_);

        // Validate and collect stake
        if (stakeToken_ == address(0)) {
            // ETH staking
            if (msg.value != requiredStake) revert InvalidStakeAmount();
        } else {
            // ERC20 staking
            if (msg.value != 0) revert InvalidStakeAmount();
            IERC20(stakeToken_).safeTransferFrom(msg.sender, address(this), requiredStake);
        }

        // Mint agent NFT
        agentId = _mintAgent(msg.sender, tokenURI_);

        // Update stake info
        AgentRegistration storage agent = agents[agentId];
        agent.tier = tier_;
        agent.stakedToken = stakeToken_;
        agent.stakedAmount = requiredStake;
        totalStakedByToken[stakeToken_] += requiredStake;

        // Set metadata if provided
        if (metadata.length > 0) {
            _setMetadataBatch(agentId, metadata);
        }
    }

    /**
     * @notice Increase stake tier (upgrade only)
     * @param agentId Agent ID to upgrade
     * @param newTier New stake tier (must be higher)
     */
    function increaseStake(uint256 agentId, StakeTier newTier) external payable nonReentrant notBanned(agentId) {
        AgentRegistration storage agent = agents[agentId];
        if (msg.sender != agent.owner) revert NotAgentOwner();
        if (newTier <= agent.tier) revert CannotDowngradeTier();

        uint256 currentStake = agent.stakedAmount;
        uint256 requiredStake = getStakeAmount(newTier);
        uint256 additionalStake = requiredStake - currentStake;

        // Collect additional stake
        if (agent.stakedToken == address(0)) {
            if (msg.value != additionalStake) revert InvalidStakeAmount();
        } else {
            if (msg.value != 0) revert InvalidStakeAmount();
            IERC20(agent.stakedToken).safeTransferFrom(msg.sender, address(this), additionalStake);
        }

        StakeTier oldTier = agent.tier;
        agent.tier = newTier;
        agent.stakedAmount = requiredStake;
        totalStakedByToken[agent.stakedToken] += additionalStake;

        emit StakeIncreased(agentId, oldTier, newTier, additionalStake);
    }

    /**
     * @notice Withdraw stake and de-register agent (voluntary)
     * @param agentId Agent ID to de-register
     */
    function withdrawStake(uint256 agentId) external nonReentrant notBanned(agentId) {
        AgentRegistration storage agent = agents[agentId];
        if (msg.sender != agent.owner) revert NotAgentOwner();
        if (agent.isSlashed) revert StakeAlreadyWithdrawn();

        uint256 stakeAmount = agent.stakedAmount;
        address stakeToken = agent.stakedToken;

        // Mark as withdrawn
        agent.stakedAmount = 0;
        agent.tier = StakeTier.NONE;
        if (stakeAmount > 0) {
            totalStakedByToken[stakeToken] -= stakeAmount;
        }

        // Remove from tag mappings
        string[] memory agentTags = _agentTags[agentId];
        for (uint256 i = 0; i < agentTags.length; i++) {
            _removeAgentFromTag(agentId, agentTags[i]);
        }
        delete _agentTags[agentId];

        // Burn the NFT
        _burn(agentId);

        // Refund stake
        if (stakeAmount > 0) {
            if (stakeToken == address(0)) {
                (bool success,) = msg.sender.call{value: stakeAmount}("");
                require(success, "ETH refund failed");
            } else {
                IERC20(stakeToken).safeTransfer(msg.sender, stakeAmount);
            }
        }

        emit StakeWithdrawn(agentId, msg.sender, stakeAmount);
    }

    // ============ Governance Functions ============

    /**
     * @notice Ban an agent (governance only)
     * @param agentId Agent ID to ban
     * @param reason Ban reason
     */
    function banAgent(uint256 agentId, string calldata reason) external onlyGovernance {
        AgentRegistration storage agent = agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        if (agent.isBanned) revert AgentIsBanned();

        agent.isBanned = true;

        emit AgentBanned(agentId, reason);
    }

    /**
     * @notice Unban an agent (governance only, after appeal)
     * @param agentId Agent ID to unban
     */
    function unbanAgent(uint256 agentId) external onlyGovernance {
        AgentRegistration storage agent = agents[agentId];
        if (!agent.isBanned) revert AgentIsNotBanned();

        agent.isBanned = false;

        emit AgentUnbanned(agentId);
    }

    /**
     * @notice Slash an agent's stake (governance only)
     * @param agentId Agent ID to slash
     * @param slashPercentageBPS Slash percentage in basis points (10000 = 100%)
     * @param reason Slash reason
     * @param redistributionAddresses Addresses to redistribute slashed amount
     * @param redistributionPercentages Percentages for each address (must sum to 10000)
     * @return slashAmount Amount slashed
     */
    function slashAgent(
        uint256 agentId,
        uint256 slashPercentageBPS,
        string calldata reason,
        address[] calldata redistributionAddresses,
        uint256[] calldata redistributionPercentages
    ) external onlyGovernance returns (uint256 slashAmount) {
        AgentRegistration storage agent = agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();

        require(slashPercentageBPS <= 10000, "Invalid slash percentage");
        require(redistributionAddresses.length == redistributionPercentages.length, "Length mismatch");

        // Calculate slash amount
        slashAmount = (agent.stakedAmount * slashPercentageBPS) / 10000;
        if (slashAmount == 0) return 0;

        agent.stakedAmount -= slashAmount;
        agent.isSlashed = true;
        totalStakedByToken[agent.stakedToken] -= slashAmount;

        // Redistribute slashed amount
        uint256 totalPercentage = 0;
        for (uint256 i = 0; i < redistributionAddresses.length; i++) {
            totalPercentage += redistributionPercentages[i];
            uint256 redistributeAmount = (slashAmount * redistributionPercentages[i]) / 10000;

            if (agent.stakedToken == address(0)) {
                (bool success,) = redistributionAddresses[i].call{value: redistributeAmount}("");
                require(success, "ETH transfer failed");
            } else {
                IERC20(agent.stakedToken).safeTransfer(redistributionAddresses[i], redistributeAmount);
            }
        }

        require(totalPercentage == 10000, "Percentages must sum to 10000");

        emit AgentSlashed(agentId, slashAmount, reason);
    }

    // ============ Tag Management ============

    /**
     * @notice Update tags for an agent
     * @param agentId Agent ID
     * @param tags_ New tags array
     */
    function updateTags(uint256 agentId, string[] calldata tags_) external notBanned(agentId) {
        address owner = ownerOf(agentId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender) || getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        // Remove old tags
        string[] memory oldTags = _agentTags[agentId];
        for (uint256 i = 0; i < oldTags.length; i++) {
            _removeAgentFromTag(agentId, oldTags[i]);
        }

        // Set new tags
        _setTags(agentId, tags_);

        emit TagsUpdated(agentId, tags_);
    }

    /**
     * @notice Get agents by tag
     * @param tag Tag to query
     * @return agentIds Array of agent IDs with this tag
     */
    function getAgentsByTag(string calldata tag) external view returns (uint256[] memory agentIds) {
        return _tagToAgents[tag];
    }

    /**
     * @notice Get tags for an agent
     * @param agentId Agent ID
     * @return tags Array of tags
     */
    function getAgentTags(uint256 agentId) external view returns (string[] memory tags) {
        return _agentTags[agentId];
    }

    // ============ Metadata Functions ============

    /**
     * @notice Set metadata for an agent
     * @dev Only the owner or approved operator can set metadata
     * @param agentId The agent ID
     * @param key The metadata key
     * @param value The metadata value as bytes
     */
    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external notBanned(agentId) {
        address owner = ownerOf(agentId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender) || getApproved(agentId) == msg.sender,
            "Not authorized"
        );
        require(bytes(key).length > 0, "Empty key");
        if (bytes(key).length > MAX_KEY_LENGTH) revert KeyTooLong();
        if (value.length > MAX_METADATA_SIZE) revert MetadataTooLarge();

        _metadata[agentId][key] = value;

        agents[agentId].lastActivityAt = block.timestamp;

        emit MetadataSet(agentId, key, key, value);
    }

    /**
     * @notice Get metadata for an agent
     * @param agentId The agent ID
     * @param key The metadata key
     * @return value The metadata value as bytes
     */
    function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory value) {
        require(_ownerOf(agentId) != address(0), "Agent does not exist");
        return _metadata[agentId][key];
    }

    /**
     * @notice Set the token URI for an agent (ERC-8004 required function)
     * @dev Only the owner or approved operator can set the URI
     * @param agentId The agent ID
     * @param newTokenURI The new token URI pointing to registration file
     */
    function setAgentUri(uint256 agentId, string calldata newTokenURI) external notBanned(agentId) {
        address owner = ownerOf(agentId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender) || getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        _setTokenURI(agentId, newTokenURI);
        agents[agentId].lastActivityAt = block.timestamp;

        emit AgentUriUpdated(agentId, newTokenURI);
    }

    // ============ View Functions ============

    /**
     * @notice Get stake amount for a tier
     * @param tier Stake tier
     * @return amount Stake amount in wei
     */
    function getStakeAmount(StakeTier tier) public pure returns (uint256 amount) {
        if (tier == StakeTier.NONE) return 0;
        if (tier == StakeTier.SMALL) return STAKE_SMALL;
        if (tier == StakeTier.MEDIUM) return STAKE_MEDIUM;
        if (tier == StakeTier.HIGH) return STAKE_HIGH;
        return 0;
    }

    /**
     * @notice Get agent registration details
     * @param agentId Agent ID
     * @return Agent registration struct
     */
    function getAgent(uint256 agentId) external view returns (AgentRegistration memory) {
        return agents[agentId];
    }

    /**
     * @notice Get the total number of registered agents
     * @return count The total number of agents
     */
    function totalAgents() external view returns (uint256 count) {
        return _nextAgentId - 1;
    }

    /**
     * @notice Check if an agent exists
     * @param agentId The agent ID to check
     * @return exists True if the agent exists
     */
    function agentExists(uint256 agentId) external view returns (bool exists) {
        return _ownerOf(agentId) != address(0);
    }

    /**
     * @notice Get all supported stake tokens
     * @return tokens Array of token addresses
     */
    function getSupportedStakeTokens() external view returns (address[] memory tokens) {
        return supportedStakeTokens;
    }

    /**
     * @notice Get agents by stake tier (filtered, paginated)
     * @param tier Stake tier to filter by
     * @param offset Start index
     * @param limit Max results
     * @return agentIds Array of agent IDs
     */
    function getAgentsByTier(StakeTier tier, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory agentIds)
    {
        // Count matching agents
        uint256 matchCount = 0;
        uint256 total = _nextAgentId - 1;

        for (uint256 i = 1; i <= total; i++) {
            if (agents[i].tier == tier && !agents[i].isBanned) {
                matchCount++;
            }
        }

        if (offset >= matchCount) {
            return new uint256[](0);
        }

        uint256 end = offset + limit;
        if (end > matchCount) {
            end = matchCount;
        }

        uint256 count = end - offset;
        agentIds = new uint256[](count);

        uint256 currentIdx = 0;
        uint256 arrayIdx = 0;

        for (uint256 i = 1; i <= total && arrayIdx < count; i++) {
            if (agents[i].tier == tier && !agents[i].isBanned) {
                if (currentIdx >= offset) {
                    agentIds[arrayIdx] = i;
                    arrayIdx++;
                }
                currentIdx++;
            }
        }
    }

    // ============ Internal Functions ============

    /**
     * @dev Mints a new agent NFT
     * @param to The address to mint the agent to
     * @param tokenURI_ The token URI
     * @return agentId The newly minted agent ID
     */
    /**
     * @custom:security CEI pattern: Initialize all state before _safeMint callback
     */
    function _mintAgent(address to, string memory tokenURI_) internal returns (uint256 agentId) {
        agentId = _nextAgentId;
        unchecked {
            _nextAgentId++;
        }

        // EFFECTS: Initialize all state BEFORE _safeMint (CEI pattern)
        // This prevents reentrancy issues from onERC721Received callback
        agents[agentId] = AgentRegistration({
            agentId: agentId,
            owner: to,
            tier: StakeTier.NONE,
            stakedToken: address(0),
            stakedAmount: 0,
            registeredAt: block.timestamp,
            lastActivityAt: block.timestamp,
            isBanned: false,
            isSlashed: false
        });

        // Emit event before external call
        emit Registered(agentId, to, StakeTier.NONE, 0, tokenURI_);

        // INTERACTIONS: External calls last
        _safeMint(to, agentId);

        if (bytes(tokenURI_).length > 0) {
            _setTokenURI(agentId, tokenURI_);
        }
    }

    /**
     * @dev Sets multiple metadata entries in batch
     * @param agentId The agent ID
     * @param metadata Array of metadata entries
     */
    function _setMetadataBatch(uint256 agentId, MetadataEntry[] calldata metadata) internal {
        for (uint256 i = 0; i < metadata.length; i++) {
            require(bytes(metadata[i].key).length > 0, "Empty key");
            if (bytes(metadata[i].key).length > MAX_KEY_LENGTH) revert KeyTooLong();
            if (metadata[i].value.length > MAX_METADATA_SIZE) revert MetadataTooLarge();
            _metadata[agentId][metadata[i].key] = metadata[i].value;
            emit MetadataSet(agentId, metadata[i].key, metadata[i].key, metadata[i].value);
        }
    }

    /**
     * @dev Set tags for an agent
     */
    function _setTags(uint256 agentId, string[] memory tags_) internal {
        if (tags_.length > MAX_TAGS) revert TooManyTags();

        // Validate tags
        for (uint256 i = 0; i < tags_.length; i++) {
            if (bytes(tags_[i]).length == 0) revert InvalidTag();
            if (bytes(tags_[i]).length > 32) revert InvalidTag();
        }

        _agentTags[agentId] = tags_;

        // Add to reverse mapping
        for (uint256 i = 0; i < tags_.length; i++) {
            _tagToAgents[tags_[i]].push(agentId);
        }
    }

    /**
     * @dev Remove agent from tag mapping
     */
    function _removeAgentFromTag(uint256 agentId, string memory tag) internal {
        uint256[] storage agentIds = _tagToAgents[tag];
        for (uint256 i = 0; i < agentIds.length; i++) {
            if (agentIds[i] == agentId) {
                agentIds[i] = agentIds[agentIds.length - 1];
                agentIds.pop();
                break;
            }
        }
    }

    /**
     * @dev Add supported token
     */
    function _addSupportedToken(address token) internal {
        isSupportedStakeToken[token] = true;
        supportedStakeTokens.push(token);

        emit StakeTokenAdded(token);
    }

    /**
     * @notice Override transfer to prevent banned agents from transferring
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (agents[tokenId].isBanned && to != address(0)) {
            revert AgentIsBanned();
        }
        return super._update(to, tokenId, auth);
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "2.1.0-marketplace";
    }

    /**
     * @notice Allow contract to receive ETH for stake deposits
     */
    receive() external payable {}

    // ============ Marketplace Discovery Functions ============

    /// @notice Standardized metadata keys for marketplace discovery
    string public constant KEY_A2A_ENDPOINT = "a2aEndpoint";
    string public constant KEY_MCP_ENDPOINT = "mcpEndpoint";
    string public constant KEY_SERVICE_TYPE = "serviceType";
    string public constant KEY_CATEGORY = "category";
    string public constant KEY_ACTIVE = "active";
    string public constant KEY_X402_SUPPORT = "x402Support";

    /**
     * @notice Set the A2A endpoint for an agent
     * @param agentId The agent ID
     * @param endpoint The A2A endpoint URL
     */
    function setA2AEndpoint(uint256 agentId, string calldata endpoint) external notBanned(agentId) {
        address owner = ownerOf(agentId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender) || getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        _metadata[agentId][KEY_A2A_ENDPOINT] = bytes(endpoint);
        agents[agentId].lastActivityAt = block.timestamp;

        emit MetadataSet(agentId, KEY_A2A_ENDPOINT, KEY_A2A_ENDPOINT, bytes(endpoint));
    }

    /**
     * @notice Get the A2A endpoint for an agent
     * @param agentId The agent ID
     * @return endpoint The A2A endpoint URL
     */
    function getA2AEndpoint(uint256 agentId) external view returns (string memory endpoint) {
        return string(_metadata[agentId][KEY_A2A_ENDPOINT]);
    }

    /**
     * @notice Set the MCP endpoint for an agent
     * @param agentId The agent ID
     * @param endpoint The MCP endpoint URL
     */
    function setMCPEndpoint(uint256 agentId, string calldata endpoint) external notBanned(agentId) {
        address owner = ownerOf(agentId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender) || getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        _metadata[agentId][KEY_MCP_ENDPOINT] = bytes(endpoint);
        agents[agentId].lastActivityAt = block.timestamp;

        emit MetadataSet(agentId, KEY_MCP_ENDPOINT, KEY_MCP_ENDPOINT, bytes(endpoint));
    }

    /**
     * @notice Get the MCP endpoint for an agent
     * @param agentId The agent ID
     * @return endpoint The MCP endpoint URL
     */
    function getMCPEndpoint(uint256 agentId) external view returns (string memory endpoint) {
        return string(_metadata[agentId][KEY_MCP_ENDPOINT]);
    }

    /**
     * @notice Set both endpoints at once
     * @param agentId The agent ID
     * @param a2aEndpoint The A2A endpoint URL
     * @param mcpEndpoint The MCP endpoint URL
     */
    function setEndpoints(uint256 agentId, string calldata a2aEndpoint, string calldata mcpEndpoint)
        external
        notBanned(agentId)
    {
        address owner = ownerOf(agentId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender) || getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        if (bytes(a2aEndpoint).length > 0) {
            _metadata[agentId][KEY_A2A_ENDPOINT] = bytes(a2aEndpoint);
            emit MetadataSet(agentId, KEY_A2A_ENDPOINT, KEY_A2A_ENDPOINT, bytes(a2aEndpoint));
        }

        if (bytes(mcpEndpoint).length > 0) {
            _metadata[agentId][KEY_MCP_ENDPOINT] = bytes(mcpEndpoint);
            emit MetadataSet(agentId, KEY_MCP_ENDPOINT, KEY_MCP_ENDPOINT, bytes(mcpEndpoint));
        }

        agents[agentId].lastActivityAt = block.timestamp;
    }

    /**
     * @notice Set the service type (agent, mcp, app)
     * @param agentId The agent ID
     * @param serviceType The service type string
     */
    function setServiceType(uint256 agentId, string calldata serviceType) external notBanned(agentId) {
        address owner = ownerOf(agentId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender) || getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        _metadata[agentId][KEY_SERVICE_TYPE] = bytes(serviceType);
        agents[agentId].lastActivityAt = block.timestamp;

        emit MetadataSet(agentId, KEY_SERVICE_TYPE, KEY_SERVICE_TYPE, bytes(serviceType));
    }

    /**
     * @notice Get the service type for an agent
     * @param agentId The agent ID
     * @return serviceType The service type (agent, mcp, app)
     */
    function getServiceType(uint256 agentId) external view returns (string memory serviceType) {
        bytes memory data = _metadata[agentId][KEY_SERVICE_TYPE];
        if (data.length == 0) return "agent"; // Default
        return string(data);
    }

    /**
     * @notice Set the category for an agent
     * @param agentId The agent ID
     * @param category The category string
     */
    function setCategory(uint256 agentId, string calldata category) external notBanned(agentId) {
        address owner = ownerOf(agentId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender) || getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        _metadata[agentId][KEY_CATEGORY] = bytes(category);
        agents[agentId].lastActivityAt = block.timestamp;

        emit MetadataSet(agentId, KEY_CATEGORY, KEY_CATEGORY, bytes(category));
    }

    /**
     * @notice Get the category for an agent
     * @param agentId The agent ID
     * @return category The category string
     */
    function getCategory(uint256 agentId) external view returns (string memory category) {
        return string(_metadata[agentId][KEY_CATEGORY]);
    }

    /**
     * @notice Set x402 support status
     * @param agentId The agent ID
     * @param supported Whether x402 is supported
     */
    function setX402Support(uint256 agentId, bool supported) external notBanned(agentId) {
        address owner = ownerOf(agentId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender) || getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        _metadata[agentId][KEY_X402_SUPPORT] = abi.encode(supported);
        agents[agentId].lastActivityAt = block.timestamp;

        emit MetadataSet(agentId, KEY_X402_SUPPORT, KEY_X402_SUPPORT, abi.encode(supported));
    }

    /**
     * @notice Get x402 support status
     * @param agentId The agent ID
     * @return supported Whether x402 is supported
     */
    function getX402Support(uint256 agentId) external view returns (bool supported) {
        bytes memory data = _metadata[agentId][KEY_X402_SUPPORT];
        if (data.length == 0) return false;
        return abi.decode(data, (bool));
    }

    /**
     * @notice Get all active agents (not banned, with endpoints)
     * @param offset Start index
     * @param limit Max results
     * @return agentIds Array of active agent IDs
     */
    function getActiveAgents(uint256 offset, uint256 limit) external view returns (uint256[] memory agentIds) {
        // Count active agents
        uint256 activeCount = 0;
        uint256 total = _nextAgentId - 1;

        for (uint256 i = 1; i <= total; i++) {
            if (!agents[i].isBanned && _ownerOf(i) != address(0)) {
                activeCount++;
            }
        }

        if (offset >= activeCount) {
            return new uint256[](0);
        }

        uint256 end = offset + limit;
        if (end > activeCount) {
            end = activeCount;
        }

        uint256 count = end - offset;
        agentIds = new uint256[](count);

        uint256 currentIdx = 0;
        uint256 arrayIdx = 0;

        for (uint256 i = 1; i <= total && arrayIdx < count; i++) {
            if (!agents[i].isBanned && _ownerOf(i) != address(0)) {
                if (currentIdx >= offset) {
                    agentIds[arrayIdx] = i;
                    arrayIdx++;
                }
                currentIdx++;
            }
        }
    }

    /**
     * @notice Get marketplace info for an agent
     * @param agentId The agent ID
     * @return a2aEndpoint The A2A endpoint
     * @return mcpEndpoint The MCP endpoint
     * @return serviceType The service type
     * @return category The category
     * @return x402Supported Whether x402 is supported
     * @return tier The stake tier
     * @return banned Whether the agent is banned
     */
    function getMarketplaceInfo(uint256 agentId)
        external
        view
        returns (
            string memory a2aEndpoint,
            string memory mcpEndpoint,
            string memory serviceType,
            string memory category,
            bool x402Supported,
            StakeTier tier,
            bool banned
        )
    {
        require(_ownerOf(agentId) != address(0), "Agent does not exist");

        a2aEndpoint = string(_metadata[agentId][KEY_A2A_ENDPOINT]);
        mcpEndpoint = string(_metadata[agentId][KEY_MCP_ENDPOINT]);

        bytes memory typeData = _metadata[agentId][KEY_SERVICE_TYPE];
        serviceType = typeData.length > 0 ? string(typeData) : "agent";

        category = string(_metadata[agentId][KEY_CATEGORY]);

        bytes memory x402Data = _metadata[agentId][KEY_X402_SUPPORT];
        x402Supported = x402Data.length > 0 && abi.decode(x402Data, (bool));

        tier = agents[agentId].tier;
        banned = agents[agentId].isBanned;
    }
}
