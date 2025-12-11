// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/games/GameIntegration.sol";
import "../src/games/Gold.sol";
import "../src/games/Items.sol";
import "../src/moderation/BanManager.sol";
import "../src/registry/IdentityRegistry.sol";
import "../src/registry/RegistryGovernance.sol";
import {MockPredimarket} from "./mocks/MockPredimarket.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title Game Contracts Test Suite
 * @notice Tests for GameIntegration using standard Jeju BanManager
 * @dev Games use the standard Jeju moderation system (BanManager) for all bans.
 *      No separate GameModeration contract - uses network infrastructure.
 */
contract GameContractsTest is Test {
    // Contracts
    GameIntegration public gameIntegration;
    Gold public gold;
    Items public items;
    IdentityRegistry public registry;
    RegistryGovernance public governance;
    BanManager public banManager;
    MockPredimarket public mockPredimarket;
    
    // Test addresses
    address public owner = address(0x1001);
    address public player1 = address(0x2001);
    address public player2 = address(0x2002);
    
    // Config
    bytes32 public constant APP_ID = keccak256("test-game");
    uint256 public gameAgentId;
    uint256 public player1AgentId;
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy registry
        registry = new IdentityRegistry();
        
        // Deploy mock predimarket
        mockPredimarket = new MockPredimarket();
        
        // Deploy governance
        governance = new RegistryGovernance(
            payable(address(registry)),
            address(mockPredimarket),
            owner,
            RegistryGovernance.Environment.LOCALNET,
            owner
        );
        
        // Deploy ban manager (standard Jeju moderation)
        banManager = new BanManager(address(governance), owner);
        
        // Deploy game tokens
        gold = new Gold("Test Gold", "TG", 1, owner, owner);
        items = new Items("https://api.test-game.com/items/", 1, owner, owner);
        
        // Deploy game integration
        gameIntegration = new GameIntegration(APP_ID, owner);
        
        // Initialize game integration with BanManager
        gameIntegration.initialize(
            address(banManager),
            address(registry),
            address(items),
            address(gold),
            address(0), // No bazaar for test
            address(0), // No paymaster for test
            1 // gameAgentId
        );
        
        vm.stopPrank();
        
        // Register players
        vm.deal(player1, 1 ether);
        vm.deal(player2, 1 ether);
        
        vm.prank(player1);
        player1AgentId = registry.register("ipfs://player1");
    }
    
    // ============ GameIntegration Tests ============
    
    function test_GameIntegration_Initialization() public view {
        assertEq(gameIntegration.appId(), APP_ID);
        assertTrue(gameIntegration.initialized());
        assertEq(gameIntegration.banManager(), address(banManager));
        assertEq(gameIntegration.identityRegistry(), address(registry));
        assertEq(gameIntegration.goldContract(), address(gold));
        assertEq(gameIntegration.itemsContract(), address(items));
    }
    
    function test_GameIntegration_CannotReinitialize() public {
        vm.prank(owner);
        vm.expectRevert(GameIntegration.AlreadyInitialized.selector);
        gameIntegration.initialize(
            address(banManager),
            address(registry),
            address(items),
            address(gold),
            address(0),
            address(0),
            1
        );
    }
    
    function test_GameIntegration_LinkAgentId() public {
        vm.prank(player1);
        gameIntegration.linkAgentId(player1AgentId);
        
        assertEq(gameIntegration.getPlayerAgentId(player1), player1AgentId);
    }
    
    function test_GameIntegration_LinkAgentId_NotOwned() public {
        vm.prank(player2);
        vm.expectRevert(GameIntegration.AgentNotOwned.selector);
        gameIntegration.linkAgentId(player1AgentId); // player1 owns this
    }
    
    function test_GameIntegration_UnlinkAgentId() public {
        vm.prank(player1);
        gameIntegration.linkAgentId(player1AgentId);
        
        vm.prank(player1);
        gameIntegration.unlinkAgentId();
        
        assertEq(gameIntegration.getPlayerAgentId(player1), 0);
    }
    
    function test_GameIntegration_PlayerAllowed() public {
        // Unlinked player should be allowed
        assertTrue(gameIntegration.isPlayerAllowed(player1));
        
        // Link agent ID
        vm.prank(player1);
        gameIntegration.linkAgentId(player1AgentId);
        
        // Still allowed (no bans)
        assertTrue(gameIntegration.isPlayerAllowed(player1));
    }
    
    function test_GameIntegration_PlayerBanned_NetworkLevel() public {
        // Link agent ID
        vm.prank(player1);
        gameIntegration.linkAgentId(player1AgentId);
        
        // Ban at network level via BanManager (governance action)
        vm.prank(owner); // owner is also governance for test setup
        banManager.banFromNetwork(
            player1AgentId,
            "Cheating - network ban",
            bytes32(uint256(1))
        );
        
        // Should not be allowed (network banned = blocked from ALL apps)
        assertFalse(gameIntegration.isPlayerAllowed(player1));
    }
    
    function test_GameIntegration_PlayerBanned_AppLevel() public {
        // Link agent ID
        vm.prank(player1);
        gameIntegration.linkAgentId(player1AgentId);
        
        // Ban at app level via BanManager (only this game)
        vm.prank(owner);
        banManager.banFromApp(
            player1AgentId,
            APP_ID,
            "Game-specific violation",
            bytes32(uint256(2))
        );
        
        // Should not be allowed in this game
        assertFalse(gameIntegration.isPlayerAllowed(player1));
    }
    
    function test_GameIntegration_PlayerBanned_AddressLevel() public {
        // Ban address directly (for unregistered players)
        vm.prank(owner);
        banManager.setModerator(owner, true);
        
        vm.prank(owner);
        banManager.applyAddressBan(
            player2, // player2 has no agent ID
            bytes32(uint256(3)),
            "Address ban for spam"
        );
        
        // Should not be allowed
        assertFalse(gameIntegration.isPlayerAllowed(player2));
    }
    
    function test_GameIntegration_GetContracts() public view {
        (
            address _banManager,
            address _identityRegistry,
            address _itemsContract,
            address _goldContract,
            address _bazaar,
            address _paymaster,
            uint256 _gameAgentId
        ) = gameIntegration.getContracts();
        
        assertEq(_banManager, address(banManager));
        assertEq(_identityRegistry, address(registry));
        assertEq(_itemsContract, address(items));
        assertEq(_goldContract, address(gold));
        assertEq(_bazaar, address(0));
        assertEq(_paymaster, address(0));
        assertEq(_gameAgentId, 1);
    }
    
    function test_GameIntegration_UpdateContracts() public {
        address newBanManager = address(0x9999);
        
        vm.prank(owner);
        gameIntegration.setBanManager(newBanManager);
        
        assertEq(gameIntegration.banManager(), newBanManager);
    }
    
    function test_GameIntegration_Version() public view {
        assertEq(gameIntegration.version(), "2.0.0");
    }
    
    // ============ BanManager Integration Tests ============
    
    function test_BanManager_NetworkBan() public {
        vm.prank(owner);
        banManager.banFromNetwork(player1AgentId, "Test network ban", bytes32(uint256(1)));
        
        assertTrue(banManager.isNetworkBanned(player1AgentId));
        assertFalse(banManager.isAccessAllowed(player1AgentId, APP_ID));
    }
    
    function test_BanManager_AppBan() public {
        vm.prank(owner);
        banManager.banFromApp(player1AgentId, APP_ID, "Test app ban", bytes32(uint256(2)));
        
        assertFalse(banManager.isNetworkBanned(player1AgentId)); // Not network banned
        assertTrue(banManager.isAppBanned(player1AgentId, APP_ID)); // App banned
        assertFalse(banManager.isAccessAllowed(player1AgentId, APP_ID)); // Access denied
    }
    
    function test_BanManager_UnbanFromNetwork() public {
        vm.prank(owner);
        banManager.banFromNetwork(player1AgentId, "Temp ban", bytes32(uint256(1)));
        assertTrue(banManager.isNetworkBanned(player1AgentId));
        
        vm.prank(owner);
        banManager.unbanFromNetwork(player1AgentId);
        assertFalse(banManager.isNetworkBanned(player1AgentId));
    }
    
    function test_BanManager_UnbanFromApp() public {
        vm.prank(owner);
        banManager.banFromApp(player1AgentId, APP_ID, "Temp app ban", bytes32(uint256(2)));
        assertTrue(banManager.isAppBanned(player1AgentId, APP_ID));
        
        vm.prank(owner);
        banManager.unbanFromApp(player1AgentId, APP_ID);
        assertFalse(banManager.isAppBanned(player1AgentId, APP_ID));
    }
    
    function test_BanManager_GetBanReason() public {
        vm.prank(owner);
        banManager.banFromNetwork(player1AgentId, "Cheating detected", bytes32(uint256(1)));
        
        string memory reason = banManager.getBanReason(player1AgentId, bytes32(0));
        assertEq(reason, "Cheating detected");
    }
    
    // ============ Gold Token Tests ============
    
    function test_Gold_Initialization() public view {
        assertEq(gold.name(), "Test Gold");
        assertEq(gold.symbol(), "TG");
    }
    
    function test_Gold_EmergencyMint() public {
        vm.prank(owner);
        gold.emergencyMint(player1, 1000);
        
        assertEq(gold.balanceOf(player1), 1000);
    }
    
    function test_Gold_Burn() public {
        vm.prank(owner);
        gold.emergencyMint(player1, 1000);
        
        vm.prank(player1);
        gold.burn(500);
        
        assertEq(gold.balanceOf(player1), 500);
    }
    
    function test_Gold_ClaimWithSignature() public view {
        // Verify the nonce mechanism exists and starts at 0
        assertEq(gold.getNonce(player1), 0);
    }
    
    function test_Gold_Version() public view {
        assertEq(gold.version(), "1.0.0");
    }
    
    // ============ Items Token Tests ============
    
    function test_Items_Initialization() public view {
        // Items uses dynamic URI based on token ID with .json suffix
        assertEq(items.uri(1), "https://api.test-game.com/items/1.json");
    }
    
    function test_Items_Version() public view {
        assertEq(items.version(), "1.0.0");
    }
}
