// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {Gold} from "src/games/Gold.sol";
import {Items} from "src/games/Items.sol";

/**
 * @title HyperscapeIntegration
 * @notice Tests integration between MUD game state and permanent NFTs
 * @dev Shows how GENERIC contracts integrate with game-specific MUD logic:
 *      - Items.sol provides all needed query functions
 *      - MUD World queries Items.sol directly (no bridge needed)
 *      - Game registered in IdentityRegistry (ERC-8004)
 *      - Items/Gold link to game's agentId
 */
contract HyperscapeIntegrationTest is Test {
    Gold public gold;
    Items public items;

    address public owner = address(this);
    address public mudWorld = address(0x999); // Simulated MUD World (would query Items.sol)
    address public gameSigner;
    uint256 public gameSignerKey;
    
    uint256 public gameAgentId = 1; // Game registered in IdentityRegistry
    
    address public playerA = address(0x1);
    address public playerB = address(0x2);

    uint256 public swordId;
    uint256 public arrowsId;

    function setUp() public {
        // Generate game signer
        gameSignerKey = 0xA11CE;
        gameSigner = vm.addr(gameSignerKey);

        // Deploy GENERIC contracts (linked to IdentityRegistry agentId)
        gold = new Gold(gameAgentId, gameSigner, owner);
        items = new Items(gameAgentId, gameSigner, owner);

        // Create item types
        arrowsId = items.createItemType("Bronze Arrows", true, 5, 0, 0, 0);
        swordId = items.createItemType("Legendary Sword", false, 50, 0, 10, 4);

        vm.deal(playerA, 100 ether);
        vm.deal(playerB, 100 ether);
    }

    // ============ Two-State System Tests ============

    function test_MintedItemsAreProtectedFromDeath() public {
        // Scenario: PlayerA has a legendary sword (minted NFT)
        bytes32 mintedInstance = keccak256("sword_minted");
        _mintSwordForPlayer(playerA, mintedInstance);

        // Verify NFT was minted
        assertEq(items.balanceOf(playerA, swordId), 1);
        address minter = items.getInstanceMinter(mintedInstance);
        assertEq(minter, playerA);

        // MUD World can query Items.sol DIRECTLY (no bridge needed)
        (bool isMinted, address originalMinter) = items.checkInstance(mintedInstance);
        assertTrue(isMinted);
        assertEq(originalMinter, playerA);

        // In game death handler, query generic Items.sol:
        // (bool isMinted, ) = items.checkInstance(instanceId);
        // if (isMinted) continue; // PROTECTED - don't drop
        
        console.log("[PASS] Minted item protected (MUD queries Items.sol directly)");
    }

    function test_NonMintedItemsDropOnDeath() public {
        // Scenario: PlayerA has a bronze sword (NOT minted, in-game only)
        bytes32 inGameInstance = keccak256("sword_ingame");
        
        // Query generic Items.sol - instance not minted
        (bool isMinted, address minter) = items.checkInstance(inGameInstance);
        assertFalse(isMinted);
        assertEq(minter, address(0)); // No minter (not minted)

        // On death, MUD World checks: if (!isMinted) dropItem();
        
        console.log("[PASS] Non-minted item droppable (generic Items.sol query)");
    }

    function test_MintToNFTFlow() public {
        bytes32 instanceId = keccak256("sword_mint_flow");
        
        // Step 1: Item exists in-game (MUD state only)
        (bool initialMinted, ) = items.checkInstance(instanceId);
        assertFalse(initialMinted);

        // Step 2: Player mints to NFT (calls generic Items.sol)
        _mintSwordForPlayer(playerA, instanceId);
        assertEq(items.balanceOf(playerA, swordId), 1);

        // Step 3: MUD World listens to NFTProvenance event and updates its own table
        // ItemInstance.set(instanceId, {..., isMinted: true});

        // Step 4: Verify Items.sol knows it's minted
        (bool nowMinted, address minter) = items.checkInstance(instanceId);
        assertTrue(nowMinted);
        assertEq(minter, playerA);
        
        // Step 5: Item is now PROTECTED (MUD queries Items.sol)
        console.log("[PASS] Generic Items.sol provides all protection info");
    }

    function test_BurnFromNFTFlow() public {
        // Setup: Minted sword
        bytes32 instanceId = keccak256("sword_burn_flow");
        _mintSwordForPlayer(playerA, instanceId);

        (bool isMinted, ) = items.checkInstance(instanceId);
        assertTrue(isMinted);

        // Player burns NFT back to in-game (generic Items.sol function)
        vm.prank(playerA);
        items.burnByInstance(instanceId);

        // MUD World listens to ItemBurned event and updates:
        // ItemInstance.set(instanceId, {..., isMinted: false});

        // Verify Items.sol knows it's no longer minted
        (bool stillMinted, ) = items.checkInstance(instanceId);
        assertFalse(stillMinted); // Items.sol automatically updates on burn!

        // Item is now droppable again (MUD checks Items.sol)
        console.log("[PASS] Generic Items.sol handles burn state");
    }

    function test_ProvenanceTrackingAcrossStates() public {
        bytes32 instanceId = keccak256("provenance_flow");
        
        // Mint NFT (generic Items.sol)
        _mintSwordForPlayer(playerA, instanceId);
        
        // Record original minter (generic query)
        address originalMinter = items.getInstanceMinter(instanceId);
        assertEq(originalMinter, playerA);

        // Transfer to PlayerB
        vm.prank(playerA);
        items.safeTransferFrom(playerA, playerB, swordId, 1, "");

        // Burn from PlayerB's account
        vm.prank(playerB);
        items.burn(playerB, swordId, 1);

        // Even after burn, we know PlayerA was the original minter
        // (generic Items.sol preserves provenance)
        originalMinter = items.getInstanceMinter(instanceId);
        assertEq(originalMinter, playerA); // Still tracked!

        console.log("[PASS] Generic Items.sol preserves provenance");
    }

    function test_GenericItemsQueryFunctions() public {
        // Generic Items.sol provides all needed query functions for MUD
        bytes32 instanceId = keccak256("query_test");
        
        // Before mint - not tracked
        (bool minted, address minter) = items.checkInstance(instanceId);
        assertFalse(minted);
        assertEq(minter, address(0));

        // Mint item
        _mintSwordForPlayer(playerA, instanceId);

        // After mint - tracked in generic contract
        (minted, minter) = items.checkInstance(instanceId);
        assertTrue(minted);
        assertEq(minter, playerA);

        // MUD World can query these generic functions!
        address instanceMinter = items.getInstanceMinter(instanceId);
        assertEq(instanceMinter, playerA);

        Items.MintedItemMetadata memory metadata = items.getMintedMetadata(playerA, swordId);
        assertEq(metadata.originalMinter, playerA);
    }

    // ============ Desync Prevention Tests ============

    function test_NoDesyncBetweenMUDAndNFT() public {
        bytes32 instance1 = keccak256("sync_test_1");
        bytes32 instance2 = keccak256("sync_test_2");

        // Mint instance1
        _mintSwordForPlayer(playerA, instance1);

        // MUD World queries GENERIC Items.sol (no game-specific bridge)
        (bool isMinted1, ) = items.checkInstance(instance1);
        assertTrue(isMinted1); // Generic contract knows
        assertTrue(items.balanceOf(playerA, swordId) >= 1); // NFT exists
        
        // instance2 is NOT minted
        (bool isMinted2, ) = items.checkInstance(instance2);
        assertFalse(isMinted2); // Generic contract knows
        assertEq(items.balanceOf(playerA, arrowsId), 0); // No NFT

        // MUD World just queries generic Items.sol - no sync needed!
        console.log("[PASS] No desync - MUD queries generic contract directly");
    }

    function test_DeathSimulation() public {
        // Setup: PlayerA has multiple items
        // 1. Minted legendary sword (PROTECTED)
        // 2. Non-minted bronze sword (DROPPABLE)
        // 3. Minted arrows (PROTECTED via balanceOf check)

        bytes32 mintedSwordInstance = keccak256("minted_sword");
        bytes32 inGameSwordInstance = keccak256("ingame_sword");

        // Mint legendary sword (non-stackable, tracked by instance)
        _mintSwordForPlayer(playerA, mintedSwordInstance);

        // Mint arrows (stackable, tracked by balanceOf)
        _mintArrowsForPlayer(playerA, 100, keccak256("minted_arrows"));

        // Simulate death check for MUD World
        // For non-stackable items: use checkInstance
        (bool isMinted1, ) = items.checkInstance(mintedSwordInstance);
        (bool isMinted2, ) = items.checkInstance(inGameSwordInstance);

        // For stackable items: use balanceOf (if player has NFT, it's minted)
        bool hasArrowNFT = items.balanceOf(playerA, arrowsId) > 0;

        bool dropSword1 = !isMinted1;
        bool dropSword2 = !isMinted2;
        bool dropArrows = !hasArrowNFT; // Stackable check via balance

        assertFalse(dropSword1); // Minted sword: DON'T DROP
        assertTrue(dropSword2);  // In-game sword: DROP
        assertFalse(dropArrows); // Minted arrows: DON'T DROP

        console.log("[PASS] MUD queries generic Items.sol (checkInstance + balanceOf)");
    }

    // ============ Helper Functions ============

    function _mintSwordForPlayer(address player, bytes32 instanceId) internal {
        uint256 amount = 1;
        bytes32 messageHash = keccak256(abi.encodePacked(player, swordId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(player);
        items.mintItem(swordId, amount, instanceId, signature);
    }

    function _mintArrowsForPlayer(address player, uint256 amount, bytes32 instanceId) internal {
        bytes32 messageHash = keccak256(abi.encodePacked(player, arrowsId, amount, instanceId));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(player);
        items.mintItem(arrowsId, amount, instanceId, signature);
    }
}

