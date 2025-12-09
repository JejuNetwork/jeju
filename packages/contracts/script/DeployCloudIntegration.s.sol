// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import "../src/registry/IdentityRegistry.sol";
import "../src/registry/ReputationRegistry.sol";
import "../src/registry/ValidationRegistry.sol";
import "../src/registry/RegistryGovernance.sol";
import "../src/services/ServiceRegistry.sol";
import "../src/services/CreditManager.sol";
import "../src/services/CloudReputationProvider.sol";
import "../src/tokens/MockJejuUSDC.sol";
import "../src/tokens/ElizaOSToken.sol";
// Import PredictionOracle BEFORE Predimarket to avoid interface conflict
import {PredictionOracle} from "../src/prediction-markets/PredictionOracle.sol";
import {Predimarket} from "../src/prediction-markets/Predimarket.sol";

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
    RegistryGovernance public registryGovernance;
    ServiceRegistry public serviceRegistry;
    CreditManager public creditManager;
    CloudReputationProvider public cloudReputationProvider;
    MockJejuUSDC public usdc;
    ElizaOSToken public elizaOS;
    PredictionOracle public predictionOracle;
    Predimarket public predimarket;

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

        // 3. Deploy prediction market infrastructure for futarchy governance
        console.log("\n3. Deploying prediction infrastructure...");
        predictionOracle = new PredictionOracle(deployer);
        console.log("PredictionOracle:", address(predictionOracle));

        predimarket = new Predimarket(
            address(elizaOS), // payment token
            address(predictionOracle),
            deployer, // treasury
            deployer // owner
        );
        console.log("Predimarket:", address(predimarket));

        // 4. Deploy RegistryGovernance
        console.log("\n4. Deploying RegistryGovernance...");
        registryGovernance = new RegistryGovernance(
            payable(address(identityRegistry)),
            address(predimarket),
            deployer, // treasury
            RegistryGovernance.Environment.LOCALNET,
            deployer // initial owner
        );
        console.log("RegistryGovernance:", address(registryGovernance));

        // 5. Deploy service infrastructure
        console.log("\n5. Deploying service infrastructure...");
        serviceRegistry = new ServiceRegistry(deployer);
        creditManager = new CreditManager(address(usdc), address(elizaOS));

        console.log("ServiceRegistry:", address(serviceRegistry));
        console.log("CreditManager:", address(creditManager));

        // 6. Deploy cloud reputation provider
        console.log("\n6. Deploying CloudReputationProvider...");
        cloudReputationProvider = new CloudReputationProvider(
            address(identityRegistry), address(reputationRegistry), payable(address(registryGovernance)), deployer
        );

        console.log("CloudReputationProvider:", address(cloudReputationProvider));

        // 7. Setup permissions and ERC-8004 integration
        console.log("\n7. Setting up permissions and ERC-8004 integration...");

        // Authorize CloudReputationProvider to give feedback
        cloudReputationProvider.setAuthorizedOperator(deployer, true);
        console.log("  Authorized operator:", deployer);

        // Set governance in IdentityRegistry to RegistryGovernance
        identityRegistry.setGovernance(address(registryGovernance));
        console.log("  Set governance in IdentityRegistry to RegistryGovernance");

        // Link all contracts to IdentityRegistry for ERC-8004 integration
        serviceRegistry.setIdentityRegistry(address(identityRegistry));
        console.log("  Linked ServiceRegistry to IdentityRegistry");

        creditManager.setIdentityRegistry(address(identityRegistry));
        console.log("  Linked CreditManager to IdentityRegistry");

        vm.stopBroadcast();

        // 8. Save deployment addresses
        console.log("\n8. Deployment complete!");
        console.log("\nDeployment Summary:");
        console.log("==================");
        _printDeploymentSummary();
    }

    function _printDeploymentSummary() internal view {
        console.log("IdentityRegistry:", address(identityRegistry));
        console.log("ReputationRegistry:", address(reputationRegistry));
        console.log("ValidationRegistry:", address(validationRegistry));
        console.log("RegistryGovernance:", address(registryGovernance));
        console.log("PredictionOracle:", address(predictionOracle));
        console.log("Predimarket:", address(predimarket));
        console.log("ServiceRegistry:", address(serviceRegistry));
        console.log("CreditManager:", address(creditManager));
        console.log("CloudReputationProvider:", address(cloudReputationProvider));
        console.log("USDC:", address(usdc));
        console.log("elizaOS:", address(elizaOS));

        console.log("\nCopy to .env:");
        console.log("==============");
        console.log("IDENTITY_REGISTRY=", address(identityRegistry));
        console.log("REPUTATION_REGISTRY=", address(reputationRegistry));
        console.log("VALIDATION_REGISTRY=", address(validationRegistry));
        console.log("REGISTRY_GOVERNANCE=", address(registryGovernance));
        console.log("PREDICTION_ORACLE=", address(predictionOracle));
        console.log("PREDIMARKET=", address(predimarket));
        console.log("SERVICE_REGISTRY=", address(serviceRegistry));
        console.log("CREDIT_MANAGER=", address(creditManager));
        console.log("CLOUD_REPUTATION_PROVIDER=", address(cloudReputationProvider));
        console.log("USDC_ADDRESS=", address(usdc));
        console.log("ELIZAOS_ADDRESS=", address(elizaOS));
    }
}
