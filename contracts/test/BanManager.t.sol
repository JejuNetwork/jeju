// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/moderation/BanManager.sol";

/**
 * @title BanManager Test Suite
 * @notice Comprehensive unit tests for BanManager contract
 * @dev Tests all ban/unban functionality, access control, and edge cases
 */
contract BanManagerTest is Test {
    BanManager public banManager;
    
    // Avoid precompile addresses (1-9), use higher addresses
    address public owner = address(0x1001);
    address public governance = address(0x1002);
    address public user1 = address(0x1003);
    address public user2 = address(0x1004);
    
    // App IDs calculated dynamically (no hardcoded knowledge)
    bytes32 public HYPERSCAPE_APP;
    bytes32 public BAZAAR_APP;
    bytes32 public GATEWAY_APP;
    
    bytes32 public constant PROPOSAL_1 = bytes32(uint256(1));
    bytes32 public constant PROPOSAL_2 = bytes32(uint256(2));
    
    event NetworkBanApplied(uint256 indexed agentId, string reason, bytes32 indexed proposalId, uint256 timestamp);
    event NetworkBanRemoved(uint256 indexed agentId, uint256 timestamp);
    event AppBanApplied(uint256 indexed agentId, bytes32 indexed appId, string reason, bytes32 indexed proposalId, uint256 timestamp);
    event AppBanRemoved(uint256 indexed agentId, bytes32 indexed appId, uint256 timestamp);
    
    function setUp() public {
        // Calculate app IDs dynamically (apps pass these at runtime)
        HYPERSCAPE_APP = keccak256("hyperscape");
        BAZAAR_APP = keccak256("bazaar");
        GATEWAY_APP = keccak256("gateway");
        
        vm.prank(owner);
        banManager = new BanManager(governance, owner);
    }
    
    // ============ Test 1: Network Ban ============
    
    function test_BanFromNetwork() public {
        vm.prank(governance);
        vm.expectEmit(true, true, true, true);
        emit NetworkBanApplied(100, "Hacking", PROPOSAL_1, block.timestamp);
        
        banManager.banFromNetwork(100, "Hacking", PROPOSAL_1);
        
        assertTrue(banManager.isNetworkBanned(100));
        assertFalse(banManager.isAccessAllowed(100, HYPERSCAPE_APP));
        assertFalse(banManager.isAccessAllowed(100, BAZAAR_APP));
    }
    
    // ============ Test 2: Network Ban - Unauthorized Access ============
    
    function test_BanFromNetwork_OnlyGovernance() public {
        vm.prank(user1);
        vm.expectRevert(BanManager.OnlyGovernance.selector);
        banManager.banFromNetwork(100, "Hacking", PROPOSAL_1);
    }
    
    // ============ Test 3: App-Specific Ban ============
    
    function test_BanFromApp() public {
        vm.prank(governance);
        vm.expectEmit(true, true, true, true);
        emit AppBanApplied(200, HYPERSCAPE_APP, "Cheating", PROPOSAL_2, block.timestamp);
        
        banManager.banFromApp(200, HYPERSCAPE_APP, "Cheating", PROPOSAL_2);
        
        assertFalse(banManager.isAccessAllowed(200, HYPERSCAPE_APP));
        assertTrue(banManager.isAccessAllowed(200, BAZAAR_APP)); // Still allowed in other apps
        assertTrue(banManager.isAppBanned(200, HYPERSCAPE_APP));
        assertFalse(banManager.isNetworkBanned(200));
    }
    
    // ============ Test 4: App Ban - Multiple Apps ============
    
    function test_BanFromMultipleApps() public {
        vm.startPrank(governance);
        
        banManager.banFromApp(300, HYPERSCAPE_APP, "Cheating", PROPOSAL_1);
        banManager.banFromApp(300, BAZAAR_APP, "Fraud", PROPOSAL_2);
        
        vm.stopPrank();
        
        assertFalse(banManager.isAccessAllowed(300, HYPERSCAPE_APP));
        assertFalse(banManager.isAccessAllowed(300, BAZAAR_APP));
        assertTrue(banManager.isAccessAllowed(300, GATEWAY_APP)); // Not banned from Gateway
        
        bytes32[] memory appBans = banManager.getAppBans(300);
        assertEq(appBans.length, 2);
    }
    
    // ============ Test 5: Unban From Network ============
    
    function test_UnbanFromNetwork() public {
        // Ban first
        vm.startPrank(governance);
        banManager.banFromNetwork(400, "Hacking", PROPOSAL_1);
        assertTrue(banManager.isNetworkBanned(400));
        
        // Unban
        vm.expectEmit(true, false, false, true);
        emit NetworkBanRemoved(400, block.timestamp);
        banManager.unbanFromNetwork(400);
        
        vm.stopPrank();
        
        assertFalse(banManager.isNetworkBanned(400));
        assertTrue(banManager.isAccessAllowed(400, HYPERSCAPE_APP));
    }
    
    // ============ Test 6: Unban From App ============
    
    function test_UnbanFromApp() public {
        // Ban first
        vm.startPrank(governance);
        banManager.banFromApp(500, HYPERSCAPE_APP, "Cheating", PROPOSAL_1);
        assertFalse(banManager.isAccessAllowed(500, HYPERSCAPE_APP));
        
        // Unban
        vm.expectEmit(true, true, false, true);
        emit AppBanRemoved(500, HYPERSCAPE_APP, block.timestamp);
        banManager.unbanFromApp(500, HYPERSCAPE_APP);
        
        vm.stopPrank();
        
        assertTrue(banManager.isAccessAllowed(500, HYPERSCAPE_APP));
        assertFalse(banManager.isAppBanned(500, HYPERSCAPE_APP));
    }
    
    // ============ Test 7: Network Ban Priority ============
    
    function test_NetworkBanOverridesAppPermissions() public {
        vm.startPrank(governance);
        
        // Agent is allowed in all apps initially
        assertTrue(banManager.isAccessAllowed(600, HYPERSCAPE_APP));
        
        // Apply network ban
        banManager.banFromNetwork(600, "Major violation", PROPOSAL_1);
        
        vm.stopPrank();
        
        // Now denied from ALL apps
        assertFalse(banManager.isAccessAllowed(600, HYPERSCAPE_APP));
        assertFalse(banManager.isAccessAllowed(600, BAZAAR_APP));
        assertFalse(banManager.isAccessAllowed(600, GATEWAY_APP));
    }
    
    // ============ Test 8: Ban Reason Storage ============
    
    function test_GetBanReason() public {
        vm.prank(governance);
        banManager.banFromNetwork(700, "Exploiting smart contracts", PROPOSAL_1);
        
        string memory reason = banManager.getBanReason(700, bytes32(0));
        assertEq(reason, "Exploiting smart contracts");
    }
    
    // ============ Test 9: App Ban Reason ============
    
    function test_GetAppBanReason() public {
        vm.prank(governance);
        banManager.banFromApp(800, HYPERSCAPE_APP, "Game cheating detected", PROPOSAL_1);
        
        string memory reason = banManager.getBanReason(800, HYPERSCAPE_APP);
        assertEq(reason, "Game cheating detected");
    }
    
    // ============ Test 10: Ban Details Query ============
    
    function test_GetNetworkBanDetails() public {
        vm.prank(governance);
        banManager.banFromNetwork(900, "Malicious behavior", PROPOSAL_1);
        
        BanManager.BanRecord memory record = banManager.getNetworkBan(900);
        assertTrue(record.isBanned);
        assertEq(record.reason, "Malicious behavior");
        assertEq(record.proposalId, PROPOSAL_1);
        assertEq(record.bannedAt, block.timestamp);
    }
    
    // ============ Test 11: Already Banned Reverts ============
    
    function test_BanFromNetwork_AlreadyBanned() public {
        vm.startPrank(governance);
        
        banManager.banFromNetwork(1000, "First ban", PROPOSAL_1);
        
        vm.expectRevert(BanManager.AlreadyBanned.selector);
        banManager.banFromNetwork(1000, "Second ban", PROPOSAL_2);
        
        vm.stopPrank();
    }
    
    // ============ Test 12: Invalid Agent ID ============
    
    function test_BanFromNetwork_InvalidAgentId() public {
        vm.prank(governance);
        vm.expectRevert(BanManager.InvalidAgentId.selector);
        banManager.banFromNetwork(0, "Invalid", PROPOSAL_1);
    }
    
    // ============ Test 13: Owner Can Ban (Emergency) ============
    
    function test_OwnerCanBan() public {
        // Owner can also ban (emergency override)
        vm.prank(owner);
        banManager.banFromNetwork(1100, "Emergency ban", PROPOSAL_1);
        
        assertTrue(banManager.isNetworkBanned(1100));
    }
    
    // ============ Test 14: Pause Functionality ============
    
    function test_PauseContract() public {
        vm.prank(owner);
        banManager.pause();
        
        vm.prank(governance);
        vm.expectRevert();
        banManager.banFromNetwork(1200, "Should fail", PROPOSAL_1);
    }
    
    // ============ Test 15: Governance Update ============
    
    function test_SetGovernance() public {
        address newGovernance = address(99);
        
        vm.prank(owner);
        banManager.setGovernance(newGovernance);
        
        assertEq(banManager.governance(), newGovernance);
        
        // New governance can ban
        vm.prank(newGovernance);
        banManager.banFromNetwork(1300, "Test", PROPOSAL_1);
        
        assertTrue(banManager.isNetworkBanned(1300));
    }
    
    // ============ Test 16: App Ban List Tracking ============
    
    function test_GetAppBansList() public {
        vm.startPrank(governance);
        
        banManager.banFromApp(1400, HYPERSCAPE_APP, "Reason 1", PROPOSAL_1);
        banManager.banFromApp(1400, BAZAAR_APP, "Reason 2", PROPOSAL_2);
        
        vm.stopPrank();
        
        bytes32[] memory bans = banManager.getAppBans(1400);
        assertEq(bans.length, 2);
        
        // Check both apps are in the list
        bool hasHyperscape = false;
        bool hasBazaar = false;
        for (uint i = 0; i < bans.length; i++) {
            if (bans[i] == HYPERSCAPE_APP) hasHyperscape = true;
            if (bans[i] == BAZAAR_APP) hasBazaar = true;
        }
        assertTrue(hasHyperscape);
        assertTrue(hasBazaar);
    }
}

