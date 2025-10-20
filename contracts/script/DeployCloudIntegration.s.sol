// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import "../src/registry/IdentityRegistry.sol";
import "../src/registry/ReputationRegistry.sol";
import "../src/registry/ValidationRegistry.sol";
import "../src/services/ServiceRegistry.sol";
import "../src/services/CreditManager.sol";
import "../src/services/CloudReputationProvider.sol";
import "../src/tokens/MockJejuUSDC.sol";
import "../src/tokens/ElizaOSToken.sol";

/**
 * @title DeployCloudIntegration
 * @notice Deploys complete cloud integration system for E2E testing
 * @dev Deploys all required contracts in correct order
 */
contract DeployCloudIntegration is Script {
    
    // Deployment addresses
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    ValidationRegistry public validationRegistry;
    ServiceRegistry public serviceRegistry;
    CreditManager public creditManager;
    CloudReputationProvider public cloudReputationProvider;
    MockJejuUSDC public usdc;
    ElizaOSToken public elizaOS;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying from:", deployer);
        console.log("Balance:", deployer.balance);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // 1. Deploy tokens
        console.log("\n1. Deploying tokens...");
        usdc = new MockJejuUSDC(deployer);
        // Faucet is built-in and always available
        elizaOS = new ElizaOSToken(deployer);
        
        console.log("USDC:", address(usdc));
        console.log("elizaOS:", address(elizaOS));
        
        // 2. Deploy registry system
        console.log("\n2. Deploying registries...");
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));
        validationRegistry = new ValidationRegistry(payable(address(identityRegistry)));
        
        console.log("IdentityRegistry:", address(identityRegistry));
        console.log("ReputationRegistry:", address(reputationRegistry));
        console.log("ValidationRegistry:", address(validationRegistry));
        
        // 3. Deploy service infrastructure
        console.log("\n3. Deploying service infrastructure...");
        serviceRegistry = new ServiceRegistry(deployer);
        creditManager = new CreditManager(address(usdc), address(elizaOS));
        
        console.log("ServiceRegistry:", address(serviceRegistry));
        console.log("CreditManager:", address(creditManager));
        
        // 4. Deploy cloud reputation provider
        console.log("\n4. Deploying CloudReputationProvider...");
        cloudReputationProvider = new CloudReputationProvider(
            address(identityRegistry),
            address(reputationRegistry),
            deployer
        );
        
        console.log("CloudReputationProvider:", address(cloudReputationProvider));
        
        // 5. Setup permissions
        console.log("\n5. Setting up permissions...");
        
        // Authorize CloudReputationProvider to give feedback
        cloudReputationProvider.setAuthorizedOperator(deployer, true);
        console.log("  Authorized operator:", deployer);
        
        // Set governance in IdentityRegistry
        identityRegistry.setGovernance(address(cloudReputationProvider));
        console.log("  Set governance in IdentityRegistry");
        
        vm.stopBroadcast();
        
        // 6. Save deployment addresses
        console.log("\n6. Deployment complete!");
        console.log("\nDeployment Summary:");
        console.log("==================");
        _printDeploymentSummary();
    }
    
    function _printDeploymentSummary() internal view {
        console.log("IdentityRegistry:", address(identityRegistry));
        console.log("ReputationRegistry:", address(reputationRegistry));
        console.log("ValidationRegistry:", address(validationRegistry));
        console.log("ServiceRegistry:", address(serviceRegistry));
        console.log("CreditManager:", address(creditManager));
        console.log("CloudReputationProvider:", address(cloudReputationProvider));
        console.log("USDC:", address(usdc));
        console.log("elizaOS:", address(elizaOS));
        
        console.log("\nCopy to .env:");
        console.log("==============");
        console.log("IDENTITY_REGISTRY=", address(identityRegistry));
        console.log("REPUTATION_REGISTRY=", address(reputationRegistry));
        console.log("SERVICE_REGISTRY=", address(serviceRegistry));
        console.log("CREDIT_MANAGER=", address(creditManager));
        console.log("CLOUD_REPUTATION_PROVIDER=", address(cloudReputationProvider));
        console.log("USDC_ADDRESS=", address(usdc));
        console.log("ELIZAOS_ADDRESS=", address(elizaOS));
    }
}

