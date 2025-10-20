// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {Gold} from "src/games/Gold.sol";
import {Items} from "src/games/Items.sol";
import {PlayerTradeEscrow} from "src/games/PlayerTradeEscrow.sol";

contract GameTokensTest is Test {
    Gold public gold;
    Items public items;
    PlayerTradeEscrow public escrow;

    address public owner = address(this);
    address public gameSigner;
    uint256 public gameSignerKey;
    
    uint256 public gameAgentId = 1; // Simulated IdentityRegistry agent ID
    
    address public playerA = address(0x1);
    address public playerB = address(0x2);

    // Item IDs
    uint256 public arrowsId; // Stackable
    uint256 public swordId;  // Non-stackable

    function setUp() public {
        // Generate game signer
        gameSignerKey = 0xA11CE;
        gameSigner = vm.addr(gameSignerKey);

        // Deploy contracts (linked to game's IdentityRegistry agent ID)
        gold = new Gold(gameAgentId, gameSigner, owner);
        items = new Items(gameAgentId, gameSigner, owner);
        escrow = new PlayerTradeEscrow(owner);

        // Approve contracts in escrow
        escrow.setContractApproval(address(gold), PlayerTradeEscrow.TokenType.ERC20, true);
        escrow.setContractApproval(address(items), PlayerTradeEscrow.TokenType.ERC1155, true);

        // Create item types
        arrowsId = items.createItemType(
            "Bronze Arrows",
            true,  // stackable
            5,     // attack
            0,     // defense
            0,     // strength
            0      // rarity: Common
        );

        swordId = items.createItemType(
            "Legendary Sword",
            false, // non-stackable
            50,    // attack
            0,     // defense
            10,    // strength
            4      // rarity: Legendary
        );

        // Fund players with ETH
        vm.deal(playerA, 100 ether);
        vm.deal(playerB, 100 ether);
    }

    // ============ Gold Tests ============

    function test_ClaimGold() public {
        uint256 amount = 1000 * 10**18;
        uint256 nonce = 0;

        // Generate signature
        bytes32 messageHash = keccak256(abi.encodePacked(playerA, amount, nonce));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Claim gold
        vm.prank(playerA);
        gold.claimGold(amount, nonce, signature);

        assertEq(gold.balanceOf(playerA), amount);
        assertEq(gold.getNonce(playerA), 1);
    }

    function test_BurnGold() public {
        // First claim some gold
        test_ClaimGold();
        
        uint256 burnAmount = 500 * 10**18;
        uint256 initialBalance = gold.balanceOf(playerA);

        vm.prank(playerA);
        gold.burn(burnAmount);

        assertEq(gold.balanceOf(playerA), initialBalance - burnAmount);
    }

    // ============ Stackable Items Tests ============

    function test_MintStackableItems() public {
        uint256 amount = 100; // 100 arrows
        bytes32 instanceId = keccak256("arrows_batch_1");

        // Generate signature
        bytes32 messageHash = keccak256(abi.encodePacked(playerA, arrowsId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Mint stackable items
        vm.prank(playerA);
        items.mintItem(arrowsId, amount, instanceId, signature);

        assertEq(items.balanceOf(playerA, arrowsId), amount);
    }

    function test_MintMultipleStackableBatches() public {
        // Mint first batch
        test_MintStackableItems(); // 100 arrows

        // Mint second batch (same item type, different instance)
        uint256 amount = 50;
        bytes32 instanceId = keccak256("arrows_batch_2");

        bytes32 messageHash = keccak256(abi.encodePacked(playerA, arrowsId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        items.mintItem(arrowsId, amount, instanceId, signature);

        // Should stack (100 + 50 = 150)
        assertEq(items.balanceOf(playerA, arrowsId), 150);
    }

    function test_BurnStackableItems() public {
        test_MintStackableItems();

        uint256 burnAmount = 30;
        uint256 initialBalance = items.balanceOf(playerA, arrowsId);

        vm.prank(playerA);
        items.burn(playerA, arrowsId, burnAmount);

        assertEq(items.balanceOf(playerA, arrowsId), initialBalance - burnAmount);
    }

    // ============ Non-Stackable Items Tests ============

    function test_MintNonStackableItem() public {
        uint256 amount = 1; // Must be 1 for non-stackable
        bytes32 instanceId = keccak256("legendary_sword_001");

        // Generate signature
        bytes32 messageHash = keccak256(abi.encodePacked(playerA, swordId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Mint non-stackable item
        vm.prank(playerA);
        items.mintItem(swordId, amount, instanceId, signature);

        assertEq(items.balanceOf(playerA, swordId), 1);
        
        // Check instance is marked as minted and WHO minted it
        (bool minted, address minter) = items.checkInstance(instanceId);
        assertTrue(minted);
        assertEq(minter, playerA); // Verify original minter is tracked
    }

    function test_CannotMintSameInstanceTwice() public {
        test_MintNonStackableItem();

        // Try to mint same instance again with different player
        uint256 amount = 1;
        bytes32 instanceId = keccak256("legendary_sword_001");

        bytes32 messageHash = keccak256(abi.encodePacked(playerB, swordId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerB);
        // Should revert with original minter (playerA) in the error
        vm.expectRevert(abi.encodeWithSelector(Items.InstanceAlreadyMinted.selector, instanceId, playerA));
        items.mintItem(swordId, amount, instanceId, signature);
    }

    function test_CanRemintInstanceAfterBurn() public {
        uint256 amount = 1;
        bytes32 instanceId = keccak256("legendary_sword_002");

        // Mint item
        bytes32 messageHash = keccak256(abi.encodePacked(playerA, swordId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        items.mintItem(swordId, amount, instanceId, signature);

        // Burn by instance
        vm.prank(playerA);
        items.burnByInstance(instanceId);

        assertEq(items.balanceOf(playerA, swordId), 0);

        // Should be able to mint again
        messageHash = keccak256(abi.encodePacked(playerB, swordId, amount, instanceId));
        ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (v, r, s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        signature = abi.encodePacked(r, s, v);

        vm.prank(playerB);
        items.mintItem(swordId, amount, instanceId, signature);

        assertEq(items.balanceOf(playerB, swordId), 1);
    }

    // ============ Trade Escrow Tests ============

    function test_TradeGoldForStackableItems() public {
        // Setup: playerA has gold, playerB has arrows
        _setupPlayerAWithGold(1000 * 10**18);
        _setupPlayerBWithArrows(100);

        // PlayerA creates trade
        vm.prank(playerA);
        uint256 tradeId = escrow.createTrade(playerB);

        // PlayerA deposits 500 gold
        PlayerTradeEscrow.TradeItem[] memory itemsA = new PlayerTradeEscrow.TradeItem[](1);
        itemsA[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(gold),
            tokenId: 0,
            amount: 500 * 10**18,
            tokenType: PlayerTradeEscrow.TokenType.ERC20
        });

        vm.prank(playerA);
        gold.approve(address(escrow), 500 * 10**18);
        vm.prank(playerA);
        escrow.depositItems(tradeId, itemsA);

        // PlayerB deposits 50 arrows
        PlayerTradeEscrow.TradeItem[] memory itemsB = new PlayerTradeEscrow.TradeItem[](1);
        itemsB[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(items),
            tokenId: arrowsId,
            amount: 50,
            tokenType: PlayerTradeEscrow.TokenType.ERC1155
        });

        vm.prank(playerB);
        items.setApprovalForAll(address(escrow), true);
        vm.prank(playerB);
        escrow.depositItems(tradeId, itemsB);

        // Both players confirm (wait for review period)
        vm.warp(block.timestamp + 2 minutes);
        
        vm.prank(playerA);
        escrow.confirmTrade(tradeId);

        vm.prank(playerB);
        escrow.confirmTrade(tradeId);

        // Verify trade executed
        assertEq(gold.balanceOf(playerA), 500 * 10**18); // Kept 500
        assertEq(gold.balanceOf(playerB), 500 * 10**18); // Got 500
        assertEq(items.balanceOf(playerA, arrowsId), 50); // Got 50 arrows
        assertEq(items.balanceOf(playerB, arrowsId), 50); // Kept 50 arrows
    }

    function test_TradeNonStackableItems() public {
        // Setup: both players have legendary swords
        _setupPlayerAWithSword(keccak256("sword_001"));
        _setupPlayerBWithSword(keccak256("sword_002"));

        // PlayerA creates trade
        vm.prank(playerA);
        uint256 tradeId = escrow.createTrade(playerB);

        // PlayerA deposits sword
        PlayerTradeEscrow.TradeItem[] memory itemsA = new PlayerTradeEscrow.TradeItem[](1);
        itemsA[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(items),
            tokenId: swordId,
            amount: 1,
            tokenType: PlayerTradeEscrow.TokenType.ERC1155
        });

        vm.prank(playerA);
        items.setApprovalForAll(address(escrow), true);
        vm.prank(playerA);
        escrow.depositItems(tradeId, itemsA);

        // PlayerB deposits sword
        PlayerTradeEscrow.TradeItem[] memory itemsB = new PlayerTradeEscrow.TradeItem[](1);
        itemsB[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(items),
            tokenId: swordId,
            amount: 1,
            tokenType: PlayerTradeEscrow.TokenType.ERC1155
        });

        vm.prank(playerB);
        items.setApprovalForAll(address(escrow), true);
        vm.prank(playerB);
        escrow.depositItems(tradeId, itemsB);

        // Both players confirm
        vm.warp(block.timestamp + 2 minutes);
        
        vm.prank(playerA);
        escrow.confirmTrade(tradeId);

        vm.prank(playerB);
        escrow.confirmTrade(tradeId);

        // Both players still have 1 sword (swapped)
        assertEq(items.balanceOf(playerA, swordId), 1);
        assertEq(items.balanceOf(playerB, swordId), 1);
    }

    function test_CancelTradeReturnsItems() public {
        // Setup
        _setupPlayerAWithGold(1000 * 10**18);
        _setupPlayerBWithArrows(100);

        // Create and deposit
        vm.prank(playerA);
        uint256 tradeId = escrow.createTrade(playerB);

        PlayerTradeEscrow.TradeItem[] memory itemsA = new PlayerTradeEscrow.TradeItem[](1);
        itemsA[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(gold),
            tokenId: 0,
            amount: 500 * 10**18,
            tokenType: PlayerTradeEscrow.TokenType.ERC20
        });

        vm.prank(playerA);
        gold.approve(address(escrow), 500 * 10**18);
        vm.prank(playerA);
        escrow.depositItems(tradeId, itemsA);

        uint256 balanceBefore = gold.balanceOf(playerA);

        // Cancel trade
        vm.prank(playerA);
        escrow.cancelTrade(tradeId);

        // Items should be returned
        assertEq(gold.balanceOf(playerA), balanceBefore + 500 * 10**18);
    }

    // ============ Edge Case Tests ============

    function test_CannotClaimGoldWithInvalidSignature() public {
        uint256 amount = 1000 * 10**18;
        uint256 nonce = 0;

        // Generate signature with WRONG key
        uint256 wrongKey = 0xBAD;
        bytes32 messageHash = keccak256(abi.encodePacked(playerA, amount, nonce));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        vm.expectRevert(Gold.InvalidSignature.selector);
        gold.claimGold(amount, nonce, signature);
    }

    function test_CannotClaimGoldWithWrongNonce() public {
        uint256 amount = 1000 * 10**18;
        uint256 wrongNonce = 5; // Should be 0

        bytes32 messageHash = keccak256(abi.encodePacked(playerA, amount, wrongNonce));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        vm.expectRevert(Gold.InvalidNonce.selector);
        gold.claimGold(amount, wrongNonce, signature);
    }

    function test_CannotClaimZeroGold() public {
        uint256 amount = 0;
        uint256 nonce = 0;

        bytes32 messageHash = keccak256(abi.encodePacked(playerA, amount, nonce));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        vm.expectRevert(Gold.InvalidAmount.selector);
        gold.claimGold(amount, nonce, signature);
    }

    function test_CannotMintNonStackableWithAmountGreaterThanOne() public {
        uint256 amount = 5; // Invalid for non-stackable
        bytes32 instanceId = keccak256("sword_invalid");

        bytes32 messageHash = keccak256(abi.encodePacked(playerA, swordId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        vm.expectRevert(Items.InvalidAmount.selector);
        items.mintItem(swordId, amount, instanceId, signature);
    }

    function test_CannotMintZeroItems() public {
        uint256 amount = 0;
        bytes32 instanceId = keccak256("zero_items");

        bytes32 messageHash = keccak256(abi.encodePacked(playerA, arrowsId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        vm.expectRevert(Items.InvalidAmount.selector);
        items.mintItem(arrowsId, amount, instanceId, signature);
    }

    function test_CannotMintItemWithInvalidSignature() public {
        uint256 amount = 100;
        bytes32 instanceId = keccak256("invalid_sig");

        // Wrong signer
        uint256 wrongKey = 0xBAD;
        bytes32 messageHash = keccak256(abi.encodePacked(playerA, arrowsId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        vm.expectRevert(Items.InvalidSignature.selector);
        items.mintItem(arrowsId, amount, instanceId, signature);
    }

    function test_TradeExpiration() public {
        _setupPlayerAWithGold(1000 * 10**18);

        vm.prank(playerA);
        uint256 tradeId = escrow.createTrade(playerB);

        // Fast forward past expiration (7 days)
        vm.warp(block.timestamp + 8 days);

        PlayerTradeEscrow.TradeItem[] memory itemsA = new PlayerTradeEscrow.TradeItem[](1);
        itemsA[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(gold),
            tokenId: 0,
            amount: 500 * 10**18,
            tokenType: PlayerTradeEscrow.TokenType.ERC20
        });

        vm.prank(playerA);
        gold.approve(address(escrow), 500 * 10**18);
        
        vm.prank(playerA);
        vm.expectRevert(PlayerTradeEscrow.TradeExpired.selector);
        escrow.depositItems(tradeId, itemsA);
    }

    function test_CannotConfirmBeforeReviewPeriod() public {
        _setupPlayerAWithGold(1000 * 10**18);
        _setupPlayerBWithArrows(100);

        vm.prank(playerA);
        uint256 tradeId = escrow.createTrade(playerB);

        // Deposit items
        PlayerTradeEscrow.TradeItem[] memory itemsA = new PlayerTradeEscrow.TradeItem[](1);
        itemsA[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(gold),
            tokenId: 0,
            amount: 500 * 10**18,
            tokenType: PlayerTradeEscrow.TokenType.ERC20
        });

        vm.prank(playerA);
        gold.approve(address(escrow), 500 * 10**18);
        vm.prank(playerA);
        escrow.depositItems(tradeId, itemsA);

        PlayerTradeEscrow.TradeItem[] memory itemsB = new PlayerTradeEscrow.TradeItem[](1);
        itemsB[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(items),
            tokenId: arrowsId,
            amount: 50,
            tokenType: PlayerTradeEscrow.TokenType.ERC1155
        });

        vm.prank(playerB);
        items.setApprovalForAll(address(escrow), true);
        vm.prank(playerB);
        escrow.depositItems(tradeId, itemsB);

        // Try to confirm immediately (within 1 minute review period)
        vm.prank(playerA);
        vm.expectRevert(PlayerTradeEscrow.ReviewTimeNotMet.selector);
        escrow.confirmTrade(tradeId);
    }

    function test_CannotDepositWithoutApproval() public {
        _setupPlayerAWithGold(1000 * 10**18);

        vm.prank(playerA);
        uint256 tradeId = escrow.createTrade(playerB);

        PlayerTradeEscrow.TradeItem[] memory itemsA = new PlayerTradeEscrow.TradeItem[](1);
        itemsA[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(gold),
            tokenId: 0,
            amount: 500 * 10**18,
            tokenType: PlayerTradeEscrow.TokenType.ERC20
        });

        // Don't approve - should fail
        vm.prank(playerA);
        vm.expectRevert();
        escrow.depositItems(tradeId, itemsA);
    }

    function test_CannotDepositTwice() public {
        _setupPlayerAWithGold(1000 * 10**18);

        vm.prank(playerA);
        uint256 tradeId = escrow.createTrade(playerB);

        PlayerTradeEscrow.TradeItem[] memory itemsA = new PlayerTradeEscrow.TradeItem[](1);
        itemsA[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(gold),
            tokenId: 0,
            amount: 500 * 10**18,
            tokenType: PlayerTradeEscrow.TokenType.ERC20
        });

        vm.prank(playerA);
        gold.approve(address(escrow), 1000 * 10**18);
        vm.prank(playerA);
        escrow.depositItems(tradeId, itemsA);

        // Try to deposit again
        vm.prank(playerA);
        vm.expectRevert(PlayerTradeEscrow.AlreadyDeposited.selector);
        escrow.depositItems(tradeId, itemsA);
    }

    function test_UnauthorizedCannotDeposit() public {
        _setupPlayerAWithGold(1000 * 10**18);

        vm.prank(playerA);
        uint256 tradeId = escrow.createTrade(playerB);

        PlayerTradeEscrow.TradeItem[] memory itemsA = new PlayerTradeEscrow.TradeItem[](1);
        itemsA[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(gold),
            tokenId: 0,
            amount: 500 * 10**18,
            tokenType: PlayerTradeEscrow.TokenType.ERC20
        });

        // Random address tries to deposit
        address randomUser = address(0x999);
        vm.prank(randomUser);
        vm.expectRevert(PlayerTradeEscrow.Unauthorized.selector);
        escrow.depositItems(tradeId, itemsA);
    }

    function test_CannotCancelAfterBothConfirm() public {
        _setupPlayerAWithGold(1000 * 10**18);
        _setupPlayerBWithArrows(100);

        vm.prank(playerA);
        uint256 tradeId = escrow.createTrade(playerB);

        // Deposit items
        PlayerTradeEscrow.TradeItem[] memory itemsA = new PlayerTradeEscrow.TradeItem[](1);
        itemsA[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(gold),
            tokenId: 0,
            amount: 500 * 10**18,
            tokenType: PlayerTradeEscrow.TokenType.ERC20
        });

        vm.prank(playerA);
        gold.approve(address(escrow), 500 * 10**18);
        vm.prank(playerA);
        escrow.depositItems(tradeId, itemsA);

        PlayerTradeEscrow.TradeItem[] memory itemsB = new PlayerTradeEscrow.TradeItem[](1);
        itemsB[0] = PlayerTradeEscrow.TradeItem({
            tokenContract: address(items),
            tokenId: arrowsId,
            amount: 50,
            tokenType: PlayerTradeEscrow.TokenType.ERC1155
        });

        vm.prank(playerB);
        items.setApprovalForAll(address(escrow), true);
        vm.prank(playerB);
        escrow.depositItems(tradeId, itemsB);

        // Wait and confirm both
        vm.warp(block.timestamp + 2 minutes);
        
        vm.prank(playerA);
        escrow.confirmTrade(tradeId);

        // Second confirmation auto-executes the trade
        vm.prank(playerB);
        escrow.confirmTrade(tradeId);

        // Trade is now executed, try to cancel
        vm.prank(playerA);
        vm.expectRevert(PlayerTradeEscrow.TradeAlreadyExecuted.selector);
        escrow.cancelTrade(tradeId);
    }

    function test_MinterProvenanceTracking() public {
        // Mint a legendary sword
        uint256 amount = 1;
        bytes32 instanceId = keccak256("provenance_sword");

        bytes32 messageHash = keccak256(abi.encodePacked(playerA, swordId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        items.mintItem(swordId, amount, instanceId, signature);

        // Check WHO minted it
        (bool minted, address originalMinter) = items.checkInstance(instanceId);
        assertTrue(minted);
        assertEq(originalMinter, playerA); // PlayerA is the original minter

        // Get minted metadata
        Items.MintedItemMetadata memory mintData = items.getMintedMetadata(playerA, swordId);
        assertEq(mintData.originalMinter, playerA);
        assertEq(mintData.instanceId, instanceId);
        assertGt(mintData.mintedAt, 0);

        // Get instance minter directly
        address instanceMinter = items.getInstanceMinter(instanceId);
        assertEq(instanceMinter, playerA);
    }

    function test_MinterProvenancePersiststhroughTransfer() public {
        // Player A mints a sword
        test_MintNonStackableItem(); // PlayerA mints sword

        bytes32 instanceId = keccak256("legendary_sword_001");
        
        // Transfer to PlayerB
        vm.prank(playerA);
        items.safeTransferFrom(playerA, playerB, swordId, 1, "");

        // PlayerB now owns it
        assertEq(items.balanceOf(playerB, swordId), 1);
        assertEq(items.balanceOf(playerA, swordId), 0);

        // But playerA is STILL the original minter
        address originalMinter = items.getInstanceMinter(instanceId);
        assertEq(originalMinter, playerA); // Provenance preserved!
        
        // Transfer to PlayerC (3rd party)
        address playerC = address(0x3);
        vm.prank(playerB);
        items.safeTransferFrom(playerB, playerC, swordId, 1, "");
        
        // PlayerC owns it now
        assertEq(items.balanceOf(playerC, swordId), 1);
        
        // But playerA is STILL the original minter (immutable)
        originalMinter = items.getInstanceMinter(instanceId);
        assertEq(originalMinter, playerA); // Forever tracked!
    }

    function test_OnlyOriginalMinterCanBurnByInstance() public {
        // PlayerA mints sword
        test_MintNonStackableItem();
        bytes32 instanceId = keccak256("legendary_sword_001");
        
        // Transfer to PlayerB
        vm.prank(playerA);
        items.safeTransferFrom(playerA, playerB, swordId, 1, "");
        
        // PlayerB tries to burn by instance (should fail - not original minter)
        vm.prank(playerB);
        vm.expectRevert(Items.NotOriginalMinter.selector);
        items.burnByInstance(instanceId);
        
        // PlayerA (original minter) can still burn it even though PlayerB owns it
        // This is intentional - minter controls instance lifecycle
        vm.prank(playerA);
        vm.expectRevert(Items.InvalidAmount.selector); // PlayerA doesn't own it anymore
        items.burnByInstance(instanceId);
    }

    function test_MintedItemProvenanceQuery() public {
        // Mint stackable arrows
        _setupPlayerBWithArrows(100);
        
        // Query minted metadata for PlayerB
        Items.MintedItemMetadata memory metadata = items.getMintedMetadata(playerB, arrowsId);
        assertEq(metadata.originalMinter, playerB);
        assertGt(metadata.mintedAt, 0);
        assertEq(metadata.instanceId, keccak256("playerB_arrows"));
    }

    // ============ Helper Functions ============

    function _setupPlayerAWithGold(uint256 amount) internal {
        uint256 nonce = gold.getNonce(playerA);
        bytes32 messageHash = keccak256(abi.encodePacked(playerA, amount, nonce));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        gold.claimGold(amount, nonce, signature);
    }

    function _setupPlayerBWithArrows(uint256 amount) internal {
        bytes32 instanceId = keccak256("playerB_arrows");
        bytes32 messageHash = keccak256(abi.encodePacked(playerB, arrowsId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerB);
        items.mintItem(arrowsId, amount, instanceId, signature);
    }

    function _setupPlayerAWithSword(bytes32 instanceId) internal {
        uint256 amount = 1;
        bytes32 messageHash = keccak256(abi.encodePacked(playerA, swordId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerA);
        items.mintItem(swordId, amount, instanceId, signature);
    }

    function _setupPlayerBWithSword(bytes32 instanceId) internal {
        uint256 amount = 1;
        bytes32 messageHash = keccak256(abi.encodePacked(playerB, swordId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(playerB);
        items.mintItem(swordId, amount, instanceId, signature);
    }
}

