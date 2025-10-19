// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {LiquidityPaymaster} from "../src/paymaster/LiquidityPaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title DeployPerTokenPaymaster
 * @notice Deploys paymaster infrastructure for a specific token
 * @dev This is a generic deployment script that works for ANY ERC20 token:
 *      - elizaOS, CLANKER, VIRTUAL, CLANKERMON, or any future token
 * 
 * Deploys:
 * 1. LiquidityVault (ETH + token pools for LPs)
 * 2. FeeDistributor (50/50 split: apps vs LPs)
 * 3. LiquidityPaymaster (ERC-4337 gas sponsorship)
 * 
 * Usage:
 *   export TOKEN_ADDRESS=0x...
 *   export ORACLE_ADDRESS=0x...
 *   export ENTRYPOINT_ADDRESS=0x...
 *   
 *   forge script script/DeployPerTokenPaymaster.s.sol:DeployPerTokenPaymaster \
 *     --rpc-url $JEJU_RPC_URL \
 *     --broadcast
 * 
 * For elizaOS:
 *   TOKEN_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
 * 
 * For CLANKER:
 *   TOKEN_ADDRESS=<deployed-mock-clanker>
 * 
 * For VIRTUAL:
 *   TOKEN_ADDRESS=<deployed-mock-virtual>
 * 
 * For CLANKERMON:
 *   TOKEN_ADDRESS=<deployed-mock-clankermon>
 */
contract DeployPerTokenPaymaster is Script {
    struct DeploymentResult {
        address token;
        address vault;
        address distributor;
        address paymaster;
        address entryPoint;
        address priceOracle;
        string tokenSymbol;
        string tokenName;
    }

    function run() external returns (DeploymentResult memory) {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);
        
        // Load configuration from environment
        address tokenAddress = vm.envAddress("TOKEN_ADDRESS");
        address oracleAddress = vm.envAddress("ORACLE_ADDRESS");
        address entryPointAddress = vm.envOr(
            "ENTRYPOINT_ADDRESS",
            address(0x0000000071727De22E5E9d8BAf0edAc6f37da032) // EntryPoint v0.7
        );
        
        string memory network = vm.envOr("NETWORK", string("localnet"));
        
        console.log("============================================================");
        console.log("Deploying Per-Token Paymaster System");
        console.log("============================================================");
        console.log("Network:", network);
        console.log("Deployer:", deployer);
        console.log("Token:", tokenAddress);
        console.log("Oracle:", oracleAddress);
        console.log("EntryPoint:", entryPointAddress);
        console.log("");
        
        // Get token metadata for logging
        (bool success, bytes memory data) = tokenAddress.staticcall(
            abi.encodeWithSignature("symbol()")
        );
        string memory tokenSymbol = success ? abi.decode(data, (string)) : "UNKNOWN";
        
        (success, data) = tokenAddress.staticcall(
            abi.encodeWithSignature("name()")
        );
        string memory tokenName = success ? abi.decode(data, (string)) : "Unknown Token";
        
        console.log("Token Name:", tokenName);
        console.log("Token Symbol:", tokenSymbol);
        console.log("");
        
        vm.startBroadcast(deployerPrivateKey);
        
        DeploymentResult memory result;
        result.token = tokenAddress;
        result.entryPoint = entryPointAddress;
        result.priceOracle = oracleAddress;
        result.tokenSymbol = tokenSymbol;
        result.tokenName = tokenName;
        
        // 1. Deploy LiquidityVault
        console.log("[1/3] Deploying LiquidityVault...");
        LiquidityVault vault = new LiquidityVault(tokenAddress, deployer);
        result.vault = address(vault);
        console.log("   Vault:", result.vault);
        
        // 2. Deploy FeeDistributor
        console.log("\n[2/3] Deploying FeeDistributor...");
        FeeDistributor distributor = new FeeDistributor(
            tokenAddress,
            address(vault),
            deployer
        );
        result.distributor = address(distributor);
        console.log("   Distributor:", result.distributor);
        
        // 3. Deploy LiquidityPaymaster
        console.log("\n[3/3] Deploying LiquidityPaymaster...");
        LiquidityPaymaster paymaster = new LiquidityPaymaster(
            IEntryPoint(entryPointAddress),
            tokenAddress,
            address(vault),
            address(distributor),
            oracleAddress
        );
        result.paymaster = address(paymaster);
        console.log("   Paymaster:", result.paymaster);
        
        // Configure contracts
        console.log("\n[4/4] Configuring contracts...");
        vault.setPaymaster(address(paymaster));
        vault.setFeeDistributor(address(distributor));
        console.log("   [OK] Vault configured");
        
        distributor.setPaymaster(address(paymaster));
        console.log("   [OK] Distributor configured");
        
        // Fund paymaster with initial ETH
        uint256 initialDeposit = vm.envOr("INITIAL_PAYMASTER_DEPOSIT", uint256(1 ether));
        if (address(deployer).balance >= initialDeposit) {
            paymaster.deposit{value: initialDeposit}();
            console.log("   [OK] Paymaster funded with", initialDeposit / 1e18, "ETH");
        }
        
        vm.stopBroadcast();
        
        // Print summary
        printSummary(result);
        
        // Save deployment
        saveDeployment(result, network);
        
        return result;
    }
    
    function printSummary(DeploymentResult memory result) internal pure {
        console.log("\n============================================================");
        console.log("DEPLOYMENT COMPLETE!");
        console.log("============================================================");
        console.log("\n", result.tokenSymbol, "Paymaster System:");
        console.log("-----------------------------------------------------------");
        console.log("Token:         ", result.token);
        console.log("Vault:         ", result.vault);
        console.log("Distributor:   ", result.distributor);
        console.log("Paymaster:     ", result.paymaster);
        console.log("Oracle:        ", result.priceOracle);
        console.log("EntryPoint:    ", result.entryPoint);
        console.log("============================================================");
        
        console.log("\nNEXT STEPS:");
        console.log("-----------------------------------------------------------");
        console.log("1. Add ETH liquidity to vault:");
        console.log("   cast send", result.vault, '"addETHLiquidity(uint256)" 0 \\');
        console.log("     --value 10ether --rpc-url $RPC");
        console.log("");
        console.log("2. Fund paymaster from vault:");
        console.log("   cast send", result.paymaster, '"fundFromVault(uint256)" 5000000000000000000 \\');
        console.log("     --rpc-url $RPC");
        console.log("");
        console.log("3. Users can now pay gas with", result.tokenSymbol, "tokens!");
        console.log("============================================================\n");
    }
    
    function saveDeployment(DeploymentResult memory result, string memory network) internal {
        string memory json = "deployment";
        vm.serializeAddress(json, "token", result.token);
        vm.serializeAddress(json, "vault", result.vault);
        vm.serializeAddress(json, "distributor", result.distributor);
        vm.serializeAddress(json, "paymaster", result.paymaster);
        vm.serializeAddress(json, "priceOracle", result.priceOracle);
        vm.serializeAddress(json, "entryPoint", result.entryPoint);
        vm.serializeString(json, "tokenSymbol", result.tokenSymbol);
        string memory finalJson = vm.serializeString(json, "tokenName", result.tokenName);
        
        string memory filename = string.concat(
            "deployments/",
            network,
            "/paymaster-",
            result.tokenSymbol,
            ".json"
        );
        
        vm.writeJson(finalJson, filename);
        console.log("\nSaved to:", filename);
    }
}

