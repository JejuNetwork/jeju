// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {GameItems} from "../../src/nfts/GameItems.sol";
import {NFTModerationAdapter} from "../../src/nfts/NFTModerationAdapter.sol";
import {ProvenanceEntry} from "../../src/nfts/interfaces/INFT.sol";

/**
 * @title GameItemsTest
 * @notice Tests for GameItems ERC1155 with game integration
 */
contract GameItemsTest is Test {
    GameItems public items;
    NFTModerationAdapter public moderation;

    address public owner;
    address public operator;
    address public player1;
    address public player2;
    address public treasury;

    bytes32 public constant GAME_ID = keccak256("TestGame");
    uint256 public constant SWORD_ID = 1;
    uint256 public constant SHIELD_ID = 2;
    uint256 public constant POTION_ID = 3;

    function setUp() public {
        owner = address(this);
        operator = address(0x1);
        player1 = address(0x2);
        player2 = address(0x3);
        treasury = address(0x4);

        // Deploy contracts
        items = new GameItems("Game Items", "ITEM", "https://api.jeju.network/items/", owner);
        moderation = new NFTModerationAdapter(owner);

        // Configure game
        items.setGameOperator(GAME_ID, operator, true);
        items.setGameTreasury(GAME_ID, treasury);
        items.setModerationHooks(address(moderation));

        // Configure items
        GameItems.ItemConfig memory swordConfig = GameItems.ItemConfig({
            gameId: GAME_ID,
            itemName: "Iron Sword",
            rarity: 1, // uncommon
            transferable: true,
            burnable: true,
            maxSupply: 1000,
            mintPrice: 0
        });

        GameItems.ItemConfig memory shieldConfig = GameItems.ItemConfig({
            gameId: GAME_ID,
            itemName: "Wooden Shield",
            rarity: 0, // common
            transferable: true,
            burnable: true,
            maxSupply: 0, // unlimited
            mintPrice: 0
        });

        GameItems.ItemConfig memory potionConfig = GameItems.ItemConfig({
            gameId: GAME_ID,
            itemName: "Health Potion",
            rarity: 0, // common
            transferable: true,
            burnable: true,
            maxSupply: 0,
            mintPrice: 0.001 ether // Public mintable
        });

        items.configureItem(SWORD_ID, swordConfig);
        items.configureItem(SHIELD_ID, shieldConfig);
        items.configureItem(POTION_ID, potionConfig);
    }

    // =========================================================================
    // Operator Minting
    // =========================================================================

    function test_OperatorCanMint() public {
        vm.prank(operator);
        items.mintItem(player1, SWORD_ID, 1, GAME_ID);

        assertEq(items.balanceOf(player1, SWORD_ID), 1);
        assertEq(items.totalSupply(SWORD_ID), 1);
    }

    function test_OperatorCanBatchMint() public {
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = SWORD_ID;
        ids[1] = SHIELD_ID;
        amounts[0] = 5;
        amounts[1] = 10;

        vm.prank(operator);
        items.mintBatch(player1, ids, amounts, GAME_ID);

        assertEq(items.balanceOf(player1, SWORD_ID), 5);
        assertEq(items.balanceOf(player1, SHIELD_ID), 10);
    }

    function test_NonOperatorCannotMint() public {
        vm.prank(player1);
        vm.expectRevert(GameItems.NotGameOperator.selector);
        items.mintItem(player1, SWORD_ID, 1, GAME_ID);
    }

    // =========================================================================
    // Public Minting
    // =========================================================================

    function test_PublicMintWithPayment() public {
        vm.deal(player1, 1 ether);
        
        vm.prank(player1);
        items.publicMint{value: 0.001 ether}(POTION_ID, 1);

        assertEq(items.balanceOf(player1, POTION_ID), 1);
        assertEq(treasury.balance, 0.001 ether);
    }

    function test_PublicMintMultiple() public {
        vm.deal(player1, 1 ether);
        
        vm.prank(player1);
        items.publicMint{value: 0.01 ether}(POTION_ID, 10);

        assertEq(items.balanceOf(player1, POTION_ID), 10);
        assertEq(treasury.balance, 0.01 ether);
    }

    function test_PublicMintInsufficientPayment() public {
        vm.deal(player1, 1 ether);
        
        vm.prank(player1);
        vm.expectRevert(GameItems.InsufficientPayment.selector);
        items.publicMint{value: 0.0001 ether}(POTION_ID, 1);
    }

    // =========================================================================
    // Max Supply
    // =========================================================================

    function test_MaxSupplyEnforced() public {
        // Mint up to max supply
        vm.startPrank(operator);
        items.mintItem(player1, SWORD_ID, 999, GAME_ID);
        items.mintItem(player2, SWORD_ID, 1, GAME_ID);
        
        // Should fail - exceeds max supply
        vm.expectRevert(GameItems.MaxSupplyExceeded.selector);
        items.mintItem(player1, SWORD_ID, 1, GAME_ID);
        vm.stopPrank();

        assertEq(items.totalSupply(SWORD_ID), 1000);
    }

    // =========================================================================
    // Burning
    // =========================================================================

    function test_OwnerCanBurn() public {
        vm.prank(operator);
        items.mintItem(player1, SWORD_ID, 5, GAME_ID);

        vm.prank(player1);
        items.burnItem(player1, SWORD_ID, 2);

        assertEq(items.balanceOf(player1, SWORD_ID), 3);
    }

    function test_OperatorCanBurn() public {
        vm.prank(operator);
        items.mintItem(player1, SWORD_ID, 5, GAME_ID);

        vm.prank(operator);
        items.burnItem(player1, SWORD_ID, 2);

        assertEq(items.balanceOf(player1, SWORD_ID), 3);
    }

    // =========================================================================
    // Transfers
    // =========================================================================

    function test_TransferBetweenPlayers() public {
        vm.prank(operator);
        items.mintItem(player1, SWORD_ID, 3, GAME_ID);

        vm.prank(player1);
        items.safeTransferFrom(player1, player2, SWORD_ID, 2, "");

        assertEq(items.balanceOf(player1, SWORD_ID), 1);
        assertEq(items.balanceOf(player2, SWORD_ID), 2);
    }

    // =========================================================================
    // Moderation Integration
    // =========================================================================

    function test_BannedUserCannotReceive() public {
        // Ban player2
        moderation.banUser(player2, "test ban");

        vm.prank(operator);
        items.mintItem(player1, SWORD_ID, 1, GAME_ID);

        // Transfer to banned user should fail
        vm.prank(player1);
        vm.expectRevert(GameItems.UserBanned.selector);
        items.safeTransferFrom(player1, player2, SWORD_ID, 1, "");
    }

    function test_BannedUserCannotMint() public {
        moderation.banUser(player1, "test ban");

        vm.prank(operator);
        vm.expectRevert(GameItems.UserBanned.selector);
        items.mintItem(player1, SWORD_ID, 1, GAME_ID);
    }

    function test_UnbanAllowsTransfer() public {
        moderation.banUser(player2, "test ban");
        moderation.unbanUser(player2);

        vm.prank(operator);
        items.mintItem(player1, SWORD_ID, 1, GAME_ID);

        vm.prank(player1);
        items.safeTransferFrom(player1, player2, SWORD_ID, 1, "");

        assertEq(items.balanceOf(player2, SWORD_ID), 1);
    }

    // =========================================================================
    // Royalties
    // =========================================================================

    function test_DefaultRoyalty() public {
        (address receiver, uint256 amount) = items.royaltyInfo(SWORD_ID, 1 ether);
        
        assertEq(receiver, owner);
        assertEq(amount, 0.05 ether); // 5%
    }

    function test_CustomRoyalty() public {
        items.setTokenRoyalty(SWORD_ID, player1, 1000); // 10%

        (address receiver, uint256 amount) = items.royaltyInfo(SWORD_ID, 1 ether);
        
        assertEq(receiver, player1);
        assertEq(amount, 0.1 ether);
    }

    // =========================================================================
    // Provenance
    // =========================================================================

    function test_ProvenanceTracked() public {
        vm.prank(operator);
        items.mintItem(player1, SWORD_ID, 1, GAME_ID);

        vm.prank(player1);
        items.safeTransferFrom(player1, player2, SWORD_ID, 1, "");

        // Check player2's provenance
        ProvenanceEntry[] memory prov = items.getProvenance(SWORD_ID, player2);
        assertEq(prov.length, 1);
        assertEq(prov[0].from, player1);
        assertEq(prov[0].to, player2);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function test_Pause() public {
        items.pause();

        vm.prank(operator);
        vm.expectRevert();
        items.mintItem(player1, SWORD_ID, 1, GAME_ID);

        items.unpause();

        vm.prank(operator);
        items.mintItem(player1, SWORD_ID, 1, GAME_ID);
        assertEq(items.balanceOf(player1, SWORD_ID), 1);
    }

    function test_SetURI() public {
        items.setURI(SWORD_ID, "ipfs://unique-sword-metadata");
        assertEq(items.uri(SWORD_ID), "ipfs://unique-sword-metadata");
    }
}

/**
 * @title NFTModerationAdapterTest
 * @notice Tests for the moderation adapter
 */
contract NFTModerationAdapterTest is Test {
    NFTModerationAdapter public moderation;

    address public owner;
    address public moderator;
    address public user;
    address public collection;

    function setUp() public {
        owner = address(this);
        moderator = address(0x1);
        user = address(0x2);
        collection = address(0x3);

        moderation = new NFTModerationAdapter(owner);
        moderation.setModerator(moderator, true);
    }

    function test_OwnerIsModerator() public view {
        assertTrue(moderation.moderators(owner));
    }

    function test_ModeratorCanBanUser() public {
        vm.prank(moderator);
        moderation.banUser(user, "spam");

        assertTrue(moderation.isUserBanned(user));
    }

    function test_ModeratorCanBanCollection() public {
        vm.prank(moderator);
        moderation.banCollection(collection, "scam");

        assertTrue(moderation.isCollectionBanned(collection));
    }

    function test_ModeratorCanBanToken() public {
        vm.prank(moderator);
        moderation.banToken(collection, 123, "inappropriate content");

        assertTrue(moderation.isTokenBanned(collection, 123));
    }

    function test_NonModeratorCannotBan() public {
        vm.prank(user);
        vm.expectRevert(NFTModerationAdapter.NotModerator.selector);
        moderation.banUser(address(0x999), "test");
    }

    function test_BeforeTransferBlocked() public {
        moderation.banUser(user, "test");

        assertFalse(moderation.beforeTransfer(collection, user, address(0x999), 1));
    }

    function test_BeforeTransferAllowed() public view {
        assertTrue(moderation.beforeTransfer(collection, user, address(0x999), 1));
    }

    function test_WhitelistedCollectionBypassesChecks() public {
        moderation.banUser(user, "test");
        moderation.whitelistCollection(collection, true);

        // Should be allowed even though user is banned
        assertTrue(moderation.beforeTransfer(collection, user, address(0x999), 1));
    }

    function test_BlockedChainPreventsBridge() public {
        moderation.blockChain(137, true); // Block Polygon

        assertFalse(moderation.beforeBridge(collection, user, 1, 137));
    }

    function test_BatchBanUsers() public {
        address[] memory users = new address[](3);
        users[0] = address(0x10);
        users[1] = address(0x11);
        users[2] = address(0x12);

        moderation.banUsers(users, "batch ban");

        assertTrue(moderation.isUserBanned(users[0]));
        assertTrue(moderation.isUserBanned(users[1]));
        assertTrue(moderation.isUserBanned(users[2]));
    }
}
