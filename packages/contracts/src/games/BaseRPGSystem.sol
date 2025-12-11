// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BaseRPGSystem
 * @author Jeju Network
 * @notice Abstract base contract for RPG game systems on Jeju
 * @dev Provides common functionality for RPG game systems:
 *      - Ban/moderation integration points
 *      - Game server signature verification
 *      - Player registration hooks
 *      - Common events and errors
 * 
 * Games inherit from this to get:
 * - Standard ban checking interface
 * - Game signer management
 * - Player allowed/blocked hooks
 * - Standard events for indexing
 * 
 * @custom:security-contact security@jeju.network
 */
abstract contract BaseRPGSystem is Ownable, ReentrancyGuard {
    
    // ============ State Variables ============
    
    /// @notice Game's agent ID in IdentityRegistry (ERC-8004)
    uint256 public immutable gameAgentId;
    
    /// @notice App ID for this game (keccak256 of game name)
    bytes32 public immutable appId;
    
    /// @notice Address authorized to sign game actions
    address public gameSigner;
    
    /// @notice Ban manager contract (if integrated)
    address public banManager;
    
    /// @notice Identity registry contract (if integrated)
    address public identityRegistry;
    
    /// @notice Whether ban checking is enabled
    bool public banCheckingEnabled;
    
    // ============ Events ============
    
    event GameSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event BanManagerUpdated(address indexed oldManager, address indexed newManager);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event BanCheckingToggled(bool enabled);
    event PlayerBlocked(address indexed player, uint256 indexed agentId, string reason);
    
    // ============ Errors ============
    
    error InvalidGameSigner();
    error InvalidAddress();
    error PlayerBanned(address player, uint256 agentId);
    error NotInitialized();
    
    // ============ Constructor ============
    
    /**
     * @notice Initialize base RPG system
     * @param _gameAgentId Game's agent ID in IdentityRegistry
     * @param _appId App ID for ban checking (keccak256 of game name)
     * @param _gameSigner Address authorized to sign game actions
     * @param _owner Contract owner
     */
    constructor(
        uint256 _gameAgentId,
        bytes32 _appId,
        address _gameSigner,
        address _owner
    ) Ownable(_owner) {
        if (_gameSigner == address(0)) revert InvalidGameSigner();
        gameAgentId = _gameAgentId;
        appId = _appId;
        gameSigner = _gameSigner;
    }
    
    // ============ Moderation Integration ============
    
    /**
     * @notice Set ban manager contract
     * @param _banManager Ban manager address
     */
    function setBanManager(address _banManager) external onlyOwner {
        address oldManager = banManager;
        banManager = _banManager;
        emit BanManagerUpdated(oldManager, _banManager);
    }
    
    /**
     * @notice Set identity registry contract
     * @param _identityRegistry Identity registry address
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = identityRegistry;
        identityRegistry = _identityRegistry;
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }
    
    /**
     * @notice Toggle ban checking
     * @param enabled Whether to enable ban checking
     */
    function setBanCheckingEnabled(bool enabled) external onlyOwner {
        banCheckingEnabled = enabled;
        emit BanCheckingToggled(enabled);
    }
    
    /**
     * @notice Check if player is allowed to perform actions
     * @param player Player address
     * @return allowed True if player is allowed
     * @dev Override in derived contracts to implement custom ban logic
     */
    function isPlayerAllowed(address player) public view virtual returns (bool allowed) {
        if (!banCheckingEnabled || banManager == address(0)) {
            return true;
        }
        
        // Call ban manager to check if player is banned
        // This is a view function so safe to call
        (bool success, bytes memory result) = banManager.staticcall(
            abi.encodeWithSignature("isAddressAccessAllowed(address,bytes32)", player, appId)
        );
        
        if (success && result.length >= 32) {
            return abi.decode(result, (bool));
        }
        
        return true; // Default to allowed if call fails
    }
    
    /**
     * @notice Require player is allowed
     * @param player Player address
     * @dev Reverts if player is banned
     */
    function requirePlayerAllowed(address player) public view virtual {
        if (!isPlayerAllowed(player)) {
            revert PlayerBanned(player, 0);
        }
    }
    
    // ============ Game Signer Management ============
    
    /**
     * @notice Update game signer address
     * @param newSigner New game signer address
     */
    function setGameSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidGameSigner();
        address oldSigner = gameSigner;
        gameSigner = newSigner;
        emit GameSignerUpdated(oldSigner, newSigner);
    }
    
    /**
     * @notice Get contract version
     * @return Version string
     */
    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }
}



