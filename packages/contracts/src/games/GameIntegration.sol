// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GameIntegration
 * @author Jeju Network
 * @notice Central integration hub for games to connect with Jeju infrastructure
 * @dev Provides a single contract for games to:
 *      - Connect to BanManager for moderation (network + app-level bans)
 *      - Connect to ReportingSystem for user reports
 *      - Connect to IdentityRegistry for player identity
 *      - Connect to Items.sol for NFT minting
 *      - Connect to Gold.sol for token economy
 *      - Connect to Bazaar for marketplace
 *      - Connect to LiquidityPaymaster for gasless transactions
 *
 * Moderation Flow:
 * - Games use the standard Jeju BanManager for all bans
 * - Network bans (via BanManager.banFromNetwork) block from ALL apps
 * - App bans (via BanManager.banFromApp) block from this game only
 * - Games can check bans via isPlayerAllowed()
 * - User reports go through ReportingSystem for futarchy resolution
 *
 * Games deploy one GameIntegration contract and reference it from all game systems.
 * This avoids duplicating integration code across multiple systems.
 *
 * @custom:security-contact security@jeju.network
 */
contract GameIntegration is Ownable {
    // ============ State Variables ============

    /// @notice Game's agent ID in IdentityRegistry (ERC-8004)
    uint256 public gameAgentId;

    /// @notice App ID for this game (keccak256 of game name)
    bytes32 public immutable appId;

    /// @notice BanManager contract for moderation
    address public banManager;

    /// @notice ReportingSystem for user reports
    address public reportingSystem;

    /// @notice IdentityRegistry for player identity (ERC-8004)
    address public identityRegistry;

    /// @notice Items contract (ERC-1155)
    address public itemsContract;

    /// @notice Gold contract (ERC-20)
    address public goldContract;

    /// @notice Bazaar marketplace
    address public bazaar;

    /// @notice LiquidityPaymaster for gasless transactions
    address public paymaster;

    /// @notice Mapping from player address to their agent ID
    mapping(address => uint256) public playerAgentId;

    /// @notice Whether integration is initialized
    bool public initialized;

    // ============ Events ============

    event ContractsInitialized(
        address indexed banManager,
        address indexed identityRegistry,
        address indexed itemsContract,
        address goldContract,
        address bazaar,
        address paymaster,
        uint256 gameAgentId
    );

    event PlayerAgentLinked(address indexed player, uint256 indexed agentId);
    event PlayerAgentUnlinked(address indexed player, uint256 indexed agentId);
    event ContractUpdated(string indexed contractName, address indexed oldAddress, address indexed newAddress);

    // ============ Errors ============

    error NotInitialized();
    error AlreadyInitialized();
    error PlayerBanned(address player, uint256 agentId);
    error PlayerNotRegistered();
    error InvalidAgentId();
    error AgentNotOwned();

    // ============ Modifiers ============

    modifier onlyInitialized() {
        if (!initialized) revert NotInitialized();
        _;
    }

    // ============ Constructor ============

    /**
     * @notice Deploy GameIntegration
     * @param _appId App ID for this game (keccak256 of game name)
     * @param _owner Contract owner
     */
    constructor(bytes32 _appId, address _owner) Ownable(_owner) {
        appId = _appId;
    }

    // ============ Initialization ============

    /**
     * @notice Initialize all Jeju contract connections
     * @param _banManager BanManager address (for moderation)
     * @param _identityRegistry IdentityRegistry address
     * @param _itemsContract Items contract address
     * @param _goldContract Gold contract address
     * @param _bazaar Bazaar marketplace address
     * @param _paymaster LiquidityPaymaster address
     * @param _gameAgentId Game's agent ID in IdentityRegistry
     */
    function initialize(
        address _banManager,
        address _identityRegistry,
        address _itemsContract,
        address _goldContract,
        address _bazaar,
        address _paymaster,
        uint256 _gameAgentId
    ) external onlyOwner {
        if (initialized) revert AlreadyInitialized();

        banManager = _banManager;
        identityRegistry = _identityRegistry;
        itemsContract = _itemsContract;
        goldContract = _goldContract;
        bazaar = _bazaar;
        paymaster = _paymaster;
        gameAgentId = _gameAgentId;
        initialized = true;

        emit ContractsInitialized(
            _banManager, _identityRegistry, _itemsContract, _goldContract, _bazaar, _paymaster, _gameAgentId
        );
    }

    // ============ Contract Updates ============

    /**
     * @notice Update BanManager address
     */
    function setBanManager(address _banManager) external onlyOwner {
        address old = banManager;
        banManager = _banManager;
        emit ContractUpdated("banManager", old, _banManager);
    }

    /**
     * @notice Update ReportingSystem address
     */
    function setReportingSystem(address _reportingSystem) external onlyOwner {
        address old = reportingSystem;
        reportingSystem = _reportingSystem;
        emit ContractUpdated("reportingSystem", old, _reportingSystem);
    }

    /**
     * @notice Update IdentityRegistry address
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address old = identityRegistry;
        identityRegistry = _identityRegistry;
        emit ContractUpdated("identityRegistry", old, _identityRegistry);
    }

    /**
     * @notice Update Items contract address
     */
    function setItemsContract(address _itemsContract) external onlyOwner {
        address old = itemsContract;
        itemsContract = _itemsContract;
        emit ContractUpdated("itemsContract", old, _itemsContract);
    }

    /**
     * @notice Update Gold contract address
     */
    function setGoldContract(address _goldContract) external onlyOwner {
        address old = goldContract;
        goldContract = _goldContract;
        emit ContractUpdated("goldContract", old, _goldContract);
    }

    /**
     * @notice Update Bazaar address
     */
    function setBazaar(address _bazaar) external onlyOwner {
        address old = bazaar;
        bazaar = _bazaar;
        emit ContractUpdated("bazaar", old, _bazaar);
    }

    /**
     * @notice Update Paymaster address
     */
    function setPaymaster(address _paymaster) external onlyOwner {
        address old = paymaster;
        paymaster = _paymaster;
        emit ContractUpdated("paymaster", old, _paymaster);
    }

    // ============ Player Management ============

    /**
     * @notice Link player to their ERC-8004 agent ID
     * @param agentId Agent ID to link
     */
    function linkAgentId(uint256 agentId) external onlyInitialized {
        if (agentId == 0) revert InvalidAgentId();

        // Verify caller owns the agent (if identityRegistry is set)
        if (identityRegistry != address(0)) {
            (bool success, bytes memory result) =
                identityRegistry.staticcall(abi.encodeWithSignature("ownerOf(uint256)", agentId));
            if (!success || abi.decode(result, (address)) != msg.sender) {
                revert AgentNotOwned();
            }
        }

        playerAgentId[msg.sender] = agentId;
        emit PlayerAgentLinked(msg.sender, agentId);
    }

    /**
     * @notice Unlink player from agent ID
     */
    function unlinkAgentId() external {
        uint256 agentId = playerAgentId[msg.sender];
        if (agentId == 0) revert PlayerNotRegistered();

        delete playerAgentId[msg.sender];
        emit PlayerAgentUnlinked(msg.sender, agentId);
    }

    /**
     * @notice Get player's agent ID
     */
    function getPlayerAgentId(address player) external view returns (uint256) {
        return playerAgentId[player];
    }

    // ============ Ban Checking (uses standard Jeju BanManager) ============

    /**
     * @notice Check if player is allowed (not banned from network or this app)
     * @param player Player address
     * @return allowed True if player is allowed
     * @dev Uses the standard Jeju BanManager for all ban checks:
     *      1. Check if agent is network banned (blocked from ALL apps)
     *      2. Check if agent is app banned (blocked from this game only)
     *      3. Check if address is banned (for unregistered players)
     */
    function isPlayerAllowed(address player) public view returns (bool) {
        if (banManager == address(0)) {
            return true; // No moderation configured
        }

        uint256 agentId = playerAgentId[player];

        if (agentId > 0) {
            // Player has linked agent ID - check agent-based bans
            // isAccessAllowed returns false if network banned OR app banned
            (bool success, bytes memory result) =
                banManager.staticcall(abi.encodeWithSignature("isAccessAllowed(uint256,bytes32)", agentId, appId));
            if (success && result.length >= 32 && !abi.decode(result, (bool))) {
                return false;
            }
        }

        // Also check address-based bans (for unregistered players or additional security)
        (bool success2, bytes memory result2) =
            banManager.staticcall(abi.encodeWithSignature("isAddressAccessAllowed(address,bytes32)", player, appId));
        if (success2 && result2.length >= 32 && !abi.decode(result2, (bool))) {
            return false;
        }

        return true;
    }

    /**
     * @notice Require player is allowed (reverts if banned)
     * @param player Player address
     */
    function requirePlayerAllowed(address player) external view {
        if (!isPlayerAllowed(player)) {
            revert PlayerBanned(player, playerAgentId[player]);
        }
    }

    /**
     * @notice Get ban reason for a player (if banned)
     * @param player Player address
     * @return reason Ban reason string (empty if not banned)
     */
    function getBanReason(address player) external view returns (string memory reason) {
        if (banManager == address(0)) return "";

        uint256 agentId = playerAgentId[player];
        if (agentId > 0) {
            (bool success, bytes memory result) =
                banManager.staticcall(abi.encodeWithSignature("getBanReason(uint256,bytes32)", agentId, appId));
            if (success && result.length > 0) {
                return abi.decode(result, (string));
            }
        }

        return "";
    }

    // ============ View Functions ============

    /**
     * @notice Get all contract addresses
     */
    function getContracts()
        external
        view
        returns (
            address _banManager,
            address _identityRegistry,
            address _itemsContract,
            address _goldContract,
            address _bazaar,
            address _paymaster,
            uint256 _gameAgentId
        )
    {
        return (banManager, identityRegistry, itemsContract, goldContract, bazaar, paymaster, gameAgentId);
    }

    /**
     * @notice Get contract version
     */
    function version() external pure returns (string memory) {
        return "2.0.0"; // Updated to use standard BanManager
    }
}
