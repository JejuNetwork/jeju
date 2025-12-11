// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { Player } from "../codegen/index.sol";

/**
 * @title JejuIntegrationSystem
 * @notice MUD System that bridges the game world with Jeju Network infrastructure
 * @dev This system provides:
 *      - Ban checking via GameIntegration contract
 *      - Player agent ID linking via GameIntegration
 *      - Access to game token contracts (Gold, Items)
 *      - Marketplace integration via Bazaar
 * 
 * This contract is game-agnostic and works with any MUD-based game on Jeju.
 * Games set their own APP_ID via GameIntegration for network-level ban checking.
 */
contract JejuIntegrationSystem is System {
    
    // ============ State Variables ============
    
    /// @notice GameIntegration contract for Jeju infrastructure
    address public gameIntegration;
    
    /// @notice GameModeration contract for game-specific bans
    address public gameModeration;
    
    /// @notice World admin address
    address private _worldAdmin;
    
    // ============ Events ============
    
    event JejuIntegrationSet(address indexed gameIntegration);
    event GameModerationSet(address indexed gameModeration);
    event PlayerAllowedChecked(address indexed player, bool allowed);
    
    // ============ Errors ============
    
    error NotInitialized();
    error PlayerBanned(address player);
    error NotWorldAdmin();
    error InvalidAddress();
    error AlreadyInitialized();
    
    // ============ Modifiers ============
    
    modifier onlyWorldAdmin() {
        if (msg.sender != _worldAdmin) revert NotWorldAdmin();
        _;
    }
    
    modifier onlyInitialized() {
        if (gameIntegration == address(0)) revert NotInitialized();
        _;
    }
    
    // ============ Initialization ============
    
    /**
     * @notice Initialize the Jeju integration system
     * @param worldAdmin Address of the world admin
     * @param _gameIntegration Address of the GameIntegration contract
     */
    function initialize(address worldAdmin, address _gameIntegration) public {
        if (_worldAdmin != address(0)) revert AlreadyInitialized();
        if (worldAdmin == address(0)) revert InvalidAddress();
        if (_gameIntegration == address(0)) revert InvalidAddress();
        
        _worldAdmin = worldAdmin;
        gameIntegration = _gameIntegration;
        
        emit JejuIntegrationSet(_gameIntegration);
    }
    
    /**
     * @notice Update GameIntegration contract
     * @param _gameIntegration New GameIntegration address
     */
    function setGameIntegration(address _gameIntegration) public onlyWorldAdmin {
        if (_gameIntegration == address(0)) revert InvalidAddress();
        gameIntegration = _gameIntegration;
        emit JejuIntegrationSet(_gameIntegration);
    }
    
    /**
     * @notice Set GameModeration contract for game-specific bans
     * @param _gameModeration GameModeration address
     */
    function setGameModeration(address _gameModeration) public onlyWorldAdmin {
        if (_gameModeration == address(0)) revert InvalidAddress();
        gameModeration = _gameModeration;
        emit GameModerationSet(_gameModeration);
    }
    
    // ============ Ban Checking ============
    
    /**
     * @notice Check if a player is allowed to access the game
     * @param player Player address to check
     * @return allowed True if the player is not banned
     * @dev Checks both network-level bans (via GameIntegration) and game-level bans (via GameModeration)
     */
    function isPlayerAllowed(address player) public view returns (bool allowed) {
        // If not initialized, allow all (no ban checking)
        if (gameIntegration == address(0)) {
            return true;
        }
        
        // Check game-level ban first (faster check)
        if (gameModeration != address(0)) {
            (bool success, bytes memory result) = gameModeration.staticcall(
                abi.encodeWithSignature("isGameBanned(address)", player)
            );
            if (success && result.length >= 32 && abi.decode(result, (bool))) {
                return false;
            }
        }
        
        // Check network-level ban via GameIntegration
        (bool success, bytes memory result) = gameIntegration.staticcall(
            abi.encodeWithSignature("isPlayerAllowed(address)", player)
        );
        
        if (success && result.length >= 32) {
            return abi.decode(result, (bool));
        }
        
        // Default to allowed if call fails
        return true;
    }
    
    /**
     * @notice Require that a player is allowed (revert if banned)
     * @param player Player address to check
     */
    function requirePlayerAllowed(address player) public view {
        if (!isPlayerAllowed(player)) {
            revert PlayerBanned(player);
        }
    }
    
    // ============ Agent ID Management ============
    
    /**
     * @notice Get player's agent ID from GameIntegration
     * @param player Player address
     * @return agentId Player's agent ID (0 if not linked)
     */
    function getPlayerAgentId(address player) public view returns (uint256 agentId) {
        if (gameIntegration == address(0)) {
            return 0;
        }
        
        (bool success, bytes memory result) = gameIntegration.staticcall(
            abi.encodeWithSignature("getPlayerAgentId(address)", player)
        );
        
        if (success && result.length >= 32) {
            return abi.decode(result, (uint256));
        }
        
        return 0;
    }
    
    // ============ Contract Access ============
    
    /**
     * @notice Get the Items contract address from GameIntegration
     * @return Address of the Items contract
     */
    function getItemsContract() public view returns (address) {
        if (gameIntegration == address(0)) return address(0);
        
        (bool success, bytes memory result) = gameIntegration.staticcall(
            abi.encodeWithSignature("itemsContract()")
        );
        
        if (success && result.length >= 32) {
            return abi.decode(result, (address));
        }
        
        return address(0);
    }
    
    /**
     * @notice Get the Gold contract address from GameIntegration
     * @return Address of the Gold contract
     */
    function getGoldContract() public view returns (address) {
        if (gameIntegration == address(0)) return address(0);
        
        (bool success, bytes memory result) = gameIntegration.staticcall(
            abi.encodeWithSignature("goldContract()")
        );
        
        if (success && result.length >= 32) {
            return abi.decode(result, (address));
        }
        
        return address(0);
    }
    
    /**
     * @notice Get the Bazaar marketplace address from GameIntegration
     * @return Address of the Bazaar contract
     */
    function getBazaar() public view returns (address) {
        if (gameIntegration == address(0)) return address(0);
        
        (bool success, bytes memory result) = gameIntegration.staticcall(
            abi.encodeWithSignature("bazaar()")
        );
        
        if (success && result.length >= 32) {
            return abi.decode(result, (address));
        }
        
        return address(0);
    }
    
    /**
     * @notice Get the Paymaster address from GameIntegration
     * @return Address of the LiquidityPaymaster contract
     */
    function getPaymaster() public view returns (address) {
        if (gameIntegration == address(0)) return address(0);
        
        (bool success, bytes memory result) = gameIntegration.staticcall(
            abi.encodeWithSignature("paymaster()")
        );
        
        if (success && result.length >= 32) {
            return abi.decode(result, (address));
        }
        
        return address(0);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get all Jeju contract addresses
     */
    function getJejuContracts() public view returns (
        address _gameIntegration,
        address _gameModeration,
        address _items,
        address _gold,
        address _bazaar,
        address _paymaster
    ) {
        return (
            gameIntegration,
            gameModeration,
            getItemsContract(),
            getGoldContract(),
            getBazaar(),
            getPaymaster()
        );
    }
    
    /**
     * @notice Get world admin address
     */
    function getWorldAdmin() public view returns (address) {
        return _worldAdmin;
    }
}


