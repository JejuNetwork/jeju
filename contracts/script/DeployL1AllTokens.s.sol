// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {MockElizaOS} from "../src/tokens/MockElizaOS.sol";
import {MockJejuUSDC} from "../src/tokens/MockJejuUSDC.sol";
import {MockCLANKER} from "../src/tokens/MockCLANKER.sol";
import {MockVIRTUAL} from "../src/tokens/MockVIRTUAL.sol";
import {MockClankermon} from "../src/tokens/MockClankermon.sol";

/**
 * @title DeployL1AllTokens
 * @notice Deploy ALL tokens on L1 first (simulating Base/Ethereum origin)
 * @dev This creates the "source of truth" for all tokens before bridging to L2
 * 
 * Tokens deployed on L1:
 * - MockElizaOS (simulating if elizaOS originated on L1)
 * - MockJejuUSDC (simulating USDC on Base)
 * - MockCLANKER (simulating real CLANKER on Base)
 * - MockVIRTUAL (simulating real VIRTUAL on Base)
 * - MockClankermon (simulating real CLANKERMON on Base)
 * 
 * After deployment, these will be bridged to L2 via Standard Bridge.
 * This ensures ALL tokens go through the same bridge flow.
 * 
 * Usage:
 *   forge script script/DeployL1AllTokens.s.sol:DeployL1AllTokens \
 *     --rpc-url http://localhost:8545 \
 *     --broadcast
 */
contract DeployL1AllTokens is Script {
    struct L1Deployments {
        address elizaOS;
        address usdc;
        address clanker;
        address virtualToken;
        address clankermon;
        address deployer;
        uint256 chainId;
    }
    
    function run() external returns (L1Deployments memory) {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("============================================================");
        console.log("DEPLOYING ALL TOKENS ON L1");
        console.log("============================================================");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("");
        console.log("This simulates tokens originating on Base/Ethereum");
        console.log("All tokens will then be bridged to L2 (Jeju)");
        console.log("");
        
        vm.startBroadcast(deployerPrivateKey);
        
        L1Deployments memory deployments;
        deployments.deployer = deployer;
        deployments.chainId = block.chainid;
        
        // Deploy all 5 tokens
        console.log("[1/5] Deploying MockElizaOS...");
        MockElizaOS elizaOS = new MockElizaOS(deployer);
        deployments.elizaOS = address(elizaOS);
        console.log("   elizaOS:", deployments.elizaOS);
        
        console.log("\n[2/5] Deploying MockJejuUSDC...");
        MockJejuUSDC usdc = new MockJejuUSDC(deployer);
        deployments.usdc = address(usdc);
        console.log("   USDC:", deployments.usdc);
        
        console.log("\n[3/5] Deploying MockCLANKER...");
        MockCLANKER clanker = new MockCLANKER(deployer);
        deployments.clanker = address(clanker);
        console.log("   CLANKER:", deployments.clanker);
        
        console.log("\n[4/5] Deploying MockVIRTUAL...");
        MockVIRTUAL virtualToken = new MockVIRTUAL(deployer);
        deployments.virtualToken = address(virtualToken);
        console.log("   VIRTUAL:", deployments.virtualToken);
        
        console.log("\n[5/5] Deploying MockClankermon...");
        MockClankermon clankermon = new MockClankermon(deployer);
        deployments.clankermon = address(clankermon);
        console.log("   CLANKERMON:", deployments.clankermon);
        
        vm.stopBroadcast();
        
        // Print summary
        printSummary(deployments);
        
        // Save deployment
        saveDeployment(deployments);
        
        return deployments;
    }
    
    function printSummary(L1Deployments memory d) internal pure {
        console.log("\n============================================================");
        console.log("L1 TOKEN DEPLOYMENT COMPLETE");
        console.log("============================================================");
        console.log("\nAll 5 tokens deployed on L1:");
        console.log("-----------------------------------------------------------");
        console.log("elizaOS:      ", d.elizaOS);
        console.log("USDC:         ", d.usdc);
        console.log("CLANKER:      ", d.clanker);
        console.log("VIRTUAL:      ", d.virtualToken);
        console.log("CLANKERMON:   ", d.clankermon);
        console.log("============================================================");
        
        console.log("\nNEXT STEPS:");
        console.log("-----------------------------------------------------------");
        console.log("1. Bridge all tokens to L2:");
        console.log("   bun run scripts/bridge-all-l1-tokens-to-l2.ts");
        console.log("");
        console.log("2. Deploy paymasters on L2:");
        console.log("   forge script script/DeployL2Paymasters.s.sol --broadcast");
        console.log("");
        console.log("3. All tokens will have equal status on L2");
        console.log("============================================================\n");
    }
    
    function saveDeployment(L1Deployments memory d) internal {
        string memory json = "deployment";
        vm.serializeAddress(json, "elizaOS", d.elizaOS);
        vm.serializeAddress(json, "usdc", d.usdc);
        vm.serializeAddress(json, "clanker", d.clanker);
        vm.serializeAddress(json, "virtualToken", d.virtualToken);
        vm.serializeAddress(json, "clankermon", d.clankermon);
        vm.serializeAddress(json, "deployer", d.deployer);
        string memory finalJson = vm.serializeUint(json, "chainId", d.chainId);
        
        vm.writeJson(finalJson, "deployments/l1-tokens.json");
        console.log("Saved to: deployments/l1-tokens.json");
    }
}

