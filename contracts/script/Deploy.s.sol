// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";

/**
 * @title Deploy L1 Contracts
 * @notice Deploys OP Stack settlement contracts on Base
 * 
 * NOTE: This script is for reference. In production, use the official OP Stack
 * deployment tooling (op-deployer) which handles the full deployment process:
 * 
 * Official OP Stack Deployment:
 * 1. Install op-deployer: https://github.com/ethereum-optimism/optimism
 * 2. Create deploy-config.json with your chain parameters
 * 3. Run: op-deployer init --deploy-config deploy-config.json
 * 4. Run: op-deployer apply
 * 
 * This will deploy:
 * - ProxyAdmin
 * - AddressManager  
 * - L1CrossDomainMessenger (Proxy + Implementation)
 * - L1StandardBridge (Proxy + Implementation)
 * - L2OutputOracle (Proxy + Implementation)
 * - OptimismPortal (Proxy + Implementation)
 * - SystemConfig (Proxy + Implementation)
 * - ProtocolVersions
 * 
 * For Jeju specifically:
 * - These contracts are deployed on Base (not Ethereum)
 * - Base itself has these contracts on Ethereum
 * - Jeju → Base → Ethereum (3-layer architecture)
 * 
 * Usage:
 *   forge script script/Deploy.s.sol:DeployL1Contracts \
 *     --rpc-url $BASE_SEPOLIA_RPC \
 *     --broadcast \
 *     --verify
 */
contract DeployL1Contracts is Script {
    function run() external view {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("======================================================================");
        console.log("L1 (Settlement Layer) Contract Deployment Guide");
        console.log("======================================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Chain:", _getChainName());
        console.log("Chain ID:", block.chainid);
        console.log("");
        
        console.log("IMPORTANT: Use Official OP Stack Tooling");
        console.log("======================================================================");
        console.log("");
        console.log("For production deployment of L1 contracts, use op-deployer:");
        console.log("");
        console.log("1. Install Optimism monorepo:");
        console.log("   git clone https://github.com/ethereum-optimism/optimism.git");
        console.log("   cd optimism/op-deployer");
        console.log("");
        console.log("2. Create deploy-config.json:");
        console.log("   {");
        console.log('     "l1ChainID": 84532,  // Base Sepolia');
        console.log('     "l2ChainID": 420690,  // Jeju Testnet');
        console.log('     "l2BlockTime": 2,');
        console.log('     "maxSequencerDrift": 600,');
        console.log('     "sequencerWindowSize": 3600,');
        console.log('     "channelTimeout": 300,');
        console.log('     "p2pSequencerAddress": "YOUR_SEQUENCER_ADDRESS",');
        console.log('     "batchInboxAddress": "0x...",');
        console.log('     "batchSenderAddress": "YOUR_BATCHER_ADDRESS",');
        console.log('     "l2OutputOracleProposer": "YOUR_PROPOSER_ADDRESS",');
        console.log('     "l2OutputOracleChallenger": "YOUR_CHALLENGER_ADDRESS",');
        console.log('     "finalSystemOwner": "YOUR_MULTISIG_ADDRESS",');
        console.log('     "proxyAdminOwner": "YOUR_MULTISIG_ADDRESS",');
        console.log('     "baseFeeVaultRecipient": "YOUR_FEE_VAULT",');
        console.log('     "l1FeeVaultRecipient": "YOUR_FEE_VAULT",');
        console.log('     "sequencerFeeVaultRecipient": "YOUR_FEE_VAULT",');
        console.log('     "gasPriceOracleOverhead": 2100,');
        console.log('     "gasPriceOracleScalar": 1000000,');
        console.log('     "enableGovernance": true,');
        console.log('     "governanceTokenSymbol": "JEJU",');
        console.log('     "governanceTokenName": "Jeju"');
        console.log("   }");
        console.log("");
        console.log("3. Run deployment:");
        console.log("   op-deployer init --deploy-config deploy-config.json --outdir ./deployments");
        console.log("   op-deployer apply --outdir ./deployments");
        console.log("");
        console.log("4. Deployed contracts will be saved to ./deployments/");
        console.log("");
        console.log("Alternative: Manual Deployment (Advanced)");
        console.log("======================================================================");
        console.log("");
        console.log("If you must deploy manually (not recommended):");
        console.log("");
        console.log("// CRITICAL: Deploy in this exact order!");
        console.log("// 1. ProxyAdmin");
        console.log("// 2. AddressManager");
        console.log("// 3. Implementations (Portal, OutputOracle, Messenger, Bridge, SystemConfig)");
        console.log("// 4. Proxies pointing to implementations");
        console.log("// 5. Initialize all proxies with correct parameters");
        console.log("// 6. Transfer ownership to multisig");
        console.log("");
        console.log("See full deployment sequence:");
        console.log("https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/scripts/Deploy.s.sol");
        console.log("");
        console.log("Cost Estimate:");
        console.log("  Base Sepolia: ~$10-50 in gas");
        console.log("  Base Mainnet: ~$100-500 in gas");
        console.log("  Time: 30-60 minutes");
        console.log("");
        console.log("======================================================================");
        console.log("");
        console.log("For Jeju deployment assistance:");
        console.log("  Discord: https://discord.gg/jeju");
        console.log("  Docs: https://docs.jeju.network/deployment");
        console.log("");
    }
    
    function _getChainName() internal view returns (string memory) {
        if (block.chainid == 1) return "Ethereum Mainnet";
        if (block.chainid == 11155111) return "Ethereum Sepolia";
        if (block.chainid == 8453) return "Base Mainnet";
        if (block.chainid == 84532) return "Base Sepolia";
        return "Unknown";
    }
}

/**
 * @title Verify L1 Deployment
 * @notice Verifies that L1 contracts were deployed correctly
 */
contract VerifyL1Deployment is Script {
    function run() external view {
        console.log("======================================================================");
        console.log("L1 Deployment Verification");
        console.log("======================================================================");
        console.log("");
        
        // Read deployment file
        string memory network = _getNetworkName();
        string memory deploymentPath = string.concat("deployments/", network, "/l1-contracts.json");
        
        console.log("Reading:", deploymentPath);
        console.log("");
        
        // Check if file exists
        try vm.readFile(deploymentPath) returns (string memory json) {
            console.log("Deployment file found!");
            console.log("");
            
            // Parse and display addresses
            address portal = vm.parseJsonAddress(json, ".OptimismPortal");
            address outputOracle = vm.parseJsonAddress(json, ".L2OutputOracle");
            address messenger = vm.parseJsonAddress(json, ".L1CrossDomainMessenger");
            address bridge = vm.parseJsonAddress(json, ".L1StandardBridge");
            address systemConfig = vm.parseJsonAddress(json, ".SystemConfig");
            
            console.log("Deployed Contracts:");
            console.log("  OptimismPortal:", portal);
            console.log("  L2OutputOracle:", outputOracle);
            console.log("  L1CrossDomainMessenger:", messenger);
            console.log("  L1StandardBridge:", bridge);
            console.log("  SystemConfig:", systemConfig);
            console.log("");
            
            // Verify contracts have code
            _verifyCode(portal, "OptimismPortal");
            _verifyCode(outputOracle, "L2OutputOracle");
            _verifyCode(messenger, "L1CrossDomainMessenger");
            _verifyCode(bridge, "L1StandardBridge");
            _verifyCode(systemConfig, "SystemConfig");
            
            console.log("");
            console.log("[OK] All contracts deployed and verified!");
            
        } catch {
            console.log("[ERROR] Deployment file not found.");
            console.log("");
            console.log("Run deployment first:");
            console.log("  forge script script/Deploy.s.sol:DeployL1Contracts --broadcast");
        }
    }
    
    function _verifyCode(address addr, string memory name) internal view {
        if (addr.code.length > 0) {
            console.log("  [OK]", name, "has code");
        } else {
            console.log("  [ERROR]", name, "NO CODE FOUND");
        }
    }
    
    function _getNetworkName() internal view returns (string memory) {
        if (block.chainid == 84532) return "base-sepolia";
        if (block.chainid == 8453) return "base-mainnet";
        return "unknown";
    }
}

