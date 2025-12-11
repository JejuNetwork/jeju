// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Gold} from "src/games/Gold.sol";
import {Items} from "src/games/Items.sol";
import {PlayerTradeEscrow} from "src/games/PlayerTradeEscrow.sol";
import {GameIntegration} from "src/games/GameIntegration.sol";
import {IdentityRegistry} from "src/registry/IdentityRegistry.sol";

/**
 * @title DeployGameTokens
 * @notice Deploys the complete game token system including integration and moderation
 * @dev Deploys all game contracts linked to IdentityRegistry (ERC-8004)
 *
 * Usage:
 *   forge script script/DeployGameTokens.s.sol:DeployGameTokens --broadcast --rpc-url http://localhost:8545
 *
 * After deployment, update deployments/game-system-1337.json with output addresses.
 */
contract DeployGameTokens is Script {
    // App ID for Hyperscape (keccak256("hyperscape"))
    bytes32 constant APP_ID = 0x6879706572736361706500000000000000000000000000000000000000000000;

    function run() public {
        // Get deployer (default Anvil account #0)
        uint256 deployerPrivateKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));

        // Game signer (Anvil account #1 by default, or from env)
        uint256 gameSignerKey = vm.envOr(
            "GAME_SIGNER_KEY",
            uint256(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d)
        );
        address gameSigner = vm.addr(gameSignerKey);

        vm.startBroadcast(deployerPrivateKey);
        address deployer = vm.addr(deployerPrivateKey);

        console.log("========================================");
        console.log("Deploying Complete Game System");
        console.log("========================================");
        console.log("Deployer:", deployer);
        console.log("Game Signer:", gameSigner);
        console.log("App ID:", vm.toString(APP_ID));
        console.log("");

        // Step 1: Deploy IdentityRegistry (if not deployed)
        console.log("Step 1: Deploying IdentityRegistry (ERC-8004)...");
        IdentityRegistry identityRegistry = new IdentityRegistry();
        console.log("  IdentityRegistry:", address(identityRegistry));

        // Step 2: Register game as agent
        console.log("Step 2: Registering Hyperscape game...");
        uint256 gameAgentId = identityRegistry.register("ipfs://hyperscape-metadata");
        console.log("  Game Agent ID:", gameAgentId);

        identityRegistry.setMetadata(gameAgentId, "type", bytes("game"));
        identityRegistry.setMetadata(gameAgentId, "name", bytes("Hyperscape"));
        identityRegistry.setMetadata(gameAgentId, "category", bytes("mmo-rpg"));

        // Step 3: Deploy Gold
        console.log("Step 3: Deploying Gold...");
        Gold gold = new Gold("Hyperscape Gold", "HG", gameAgentId, gameSigner, deployer);
        console.log("  Gold:", address(gold));

        // Step 4: Deploy Items
        console.log("Step 4: Deploying Items...");
        Items items = new Items("https://api.hyperscape.jeju.network/items/", gameAgentId, gameSigner, deployer);
        console.log("  Items:", address(items));

        // Step 5: Deploy PlayerTradeEscrow
        console.log("Step 5: Deploying PlayerTradeEscrow...");
        PlayerTradeEscrow escrow = new PlayerTradeEscrow(deployer);
        console.log("  PlayerTradeEscrow:", address(escrow));

        // Step 6: Deploy GameIntegration
        console.log("Step 6: Deploying GameIntegration...");
        GameIntegration integration = new GameIntegration(APP_ID, deployer);
        console.log("  GameIntegration:", address(integration));

        console.log("");
        console.log("Configuring contracts...");

        // Configure escrow approvals
        escrow.setContractApproval(address(gold), PlayerTradeEscrow.TokenType.ERC20, true);
        escrow.setContractApproval(address(items), PlayerTradeEscrow.TokenType.ERC1155, true);
        console.log("  Escrow: Gold and Items approved");

        // Initialize GameIntegration
        // Note: BanManager should be deployed separately as part of Jeju core infrastructure
        // Games connect to the existing BanManager, not deploy their own
        integration.initialize(
            address(0), // banManager - connect to Jeju's BanManager when available
            address(identityRegistry),
            address(items),
            address(gold),
            address(0), // bazaar - connect when available
            address(0), // paymaster - connect when available
            gameAgentId
        );
        console.log("  GameIntegration: initialized (moderation via Jeju BanManager)");

        // Create starter item types (IDs returned but not needed)
        items.createItemType("Bronze Arrows", true, 5, 0, 0, 0);
        items.createItemType("Legendary Sword", false, 50, 0, 10, 4);
        items.createItemType("Health Potion", true, 0, 0, 0, 1);
        items.createItemType("Iron Shield", false, 0, 30, 5, 2);
        console.log("  Items: 4 item types created");

        vm.stopBroadcast();

        // Output deployment summary in JSON-friendly format for easy copy
        console.log("");
        console.log("========================================");
        console.log("DEPLOYMENT COMPLETE - Copy to game-system-1337.json");
        console.log("========================================");
        console.log("");
        console.log("goldToken:", vm.toString(address(gold)));
        console.log("itemsNFT:", vm.toString(address(items)));
        console.log("playerTradeEscrow:", vm.toString(address(escrow)));
        console.log("gameIntegration:", vm.toString(address(integration)));
        console.log("gameAgentId:", gameAgentId);
        console.log("gameSigner:", vm.toString(gameSigner));
        console.log("identityRegistry:", vm.toString(address(identityRegistry)));
        console.log("");
        console.log("Item Types Created:");
        console.log("  1 = Bronze Arrows (stackable, common)");
        console.log("  2 = Legendary Sword (unique, legendary)");
        console.log("  3 = Health Potion (stackable, uncommon)");
        console.log("  4 = Iron Shield (unique, rare)");
        console.log("");
        console.log("Moderation:");
        console.log("  Uses standard Jeju BanManager (deploy separately)");
        console.log("  Connect via: integration.setBanManager(banManagerAddress)");
        console.log("");
    }
}
