// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Gold} from "src/games/Gold.sol";
import {Items} from "src/games/Items.sol";
import {PlayerTradeEscrow} from "src/games/PlayerTradeEscrow.sol";
import {IdentityRegistry} from "src/registry/IdentityRegistry.sol";

/**
 * @title DeployGameTokens
 * @notice Deploys the complete game token system
 * @dev Deploys generic contracts linked to IdentityRegistry (ERC-8004)
 * 
 * Usage:
 *   forge script script/DeployGameTokens.s.sol:DeployGameTokens --broadcast --rpc-url http://localhost:8545
 */
contract DeployGameTokens is Script {
    function run() public {
        // Get deployer (default Anvil account #0)
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        
        // Game signer (Anvil account #1)
        address gameSigner = vm.addr(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d);
        
        vm.startBroadcast(deployerPrivateKey);
        address deployer = vm.addr(deployerPrivateKey);

        console.log("========================================");
        console.log("Deploying Game Token System");
        console.log("========================================");
        console.log("Deployer:", deployer);
        console.log("Game Signer:", gameSigner);
        console.log("");

        // Step 1: Deploy IdentityRegistry (if not deployed)
        console.log("Step 1: Deploying IdentityRegistry (ERC-8004)...");
        IdentityRegistry identityRegistry = new IdentityRegistry();
        console.log("  IdentityRegistry deployed at:", address(identityRegistry));

        // Step 2: Register game as agent
        console.log("Step 2: Registering Hyperscape game...");
        uint256 gameAgentId = identityRegistry.register("ipfs://hyperscape-metadata");
        console.log("  Hyperscape registered with Agent ID:", gameAgentId);

        // Set game metadata
        identityRegistry.setMetadata(gameAgentId, "type", bytes("game"));
        identityRegistry.setMetadata(gameAgentId, "name", bytes("Hyperscape"));
        identityRegistry.setMetadata(gameAgentId, "category", bytes("mmo-rpg"));
        console.log("  Game metadata set");

        // Step 3: Deploy Gold (linked to game agent ID)
        console.log("Step 3: Deploying Gold...");
        Gold gold = new Gold(gameAgentId, gameSigner, deployer);
        console.log("  Gold deployed at:", address(gold));

        // Step 4: Deploy Items (linked to game agent ID)
        console.log("Step 4: Deploying Items...");
        Items items = new Items(gameAgentId, gameSigner, deployer);
        console.log("  Items deployed at:", address(items));

        // Step 5: Deploy PlayerTradeEscrow
        console.log("Step 5: Deploying PlayerTradeEscrow...");
        PlayerTradeEscrow escrow = new PlayerTradeEscrow(deployer);
        console.log("  PlayerTradeEscrow deployed at:", address(escrow));

        console.log("");
        console.log("Configuring contracts...");

        // Approve in escrow
        escrow.setContractApproval(address(gold), PlayerTradeEscrow.TokenType.ERC20, true);
        escrow.setContractApproval(address(items), PlayerTradeEscrow.TokenType.ERC1155, true);
        console.log("  Escrow configured");

        // Create item types
        uint256 arrowsId = items.createItemType(
            "Bronze Arrows",
            true,  // stackable
            5,     // attack
            0,     // defense
            0,     // strength
            0      // rarity: Common
        );
        console.log("  Created item type: Bronze Arrows (ID:", arrowsId, ")");

        uint256 swordId = items.createItemType(
            "Legendary Sword",
            false, // non-stackable
            50,    // attack
            0,     // defense
            10,    // strength
            4      // rarity: Legendary
        );
        console.log("  Created item type: Legendary Sword (ID:", swordId, ")");

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("Deployment Complete!");
        console.log("========================================");
        console.log("");
        console.log("IdentityRegistry (ERC-8004):");
        console.log("  Address:", address(identityRegistry));
        console.log("  Hyperscape Game Agent ID:", gameAgentId);
        console.log("");
        console.log("Game Contracts:");
        console.log("  Gold:", address(gold));
        console.log("  Items:", address(items));
        console.log("  PlayerTradeEscrow:", address(escrow));
        console.log("");
        console.log("Item Types:");
        console.log("  Bronze Arrows (stackable):", arrowsId);
        console.log("  Legendary Sword (unique):", swordId);
        console.log("");
        console.log("Integration:");
        console.log("  All contracts linked to Agent ID:", gameAgentId);
        console.log("  Game discoverable via IdentityRegistry");
        console.log("");
    }
}

