// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/dws/DWSProviderRegistry.sol";
import "../src/dws/DWSBilling.sol";
import "../src/dws/DWSServiceProvisioning.sol";
import "../src/dws/IDWSTypes.sol";

/**
 * @title DeployDWSInfra
 * @notice Deploys DWS Provider Infrastructure contracts
 * @dev Deploys:
 *      - DWSProviderRegistry (provider staking, assignment, slashing)
 *      - DWSBilling (unified billing for compute, storage, CDN, database)
 *      - DWSServiceProvisioning (service discovery and deployment)
 *
 * Run: forge script script/DeployDWSInfra.s.sol:DeployDWSInfra --rpc-url jeju_testnet --broadcast
 */
contract DeployDWSInfra is Script {
    function run() external {
        address deployer = msg.sender;

        // Get dependencies from env or use defaults
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY_ADDRESS", deployer);
        address banManager = vm.envOr("BAN_MANAGER_ADDRESS", address(0));
        address stakeManager = vm.envOr("STAKE_MANAGER_ADDRESS", address(0));
        address creditManager = vm.envOr("CREDIT_MANAGER_ADDRESS", address(0));
        address serviceRegistry = vm.envOr("SERVICE_REGISTRY_ADDRESS", address(0));
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);

        console.log("==================================================");
        console.log("Deploying DWS Provider Infrastructure");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Identity Registry:", identityRegistry);
        console.log("Ban Manager:", banManager);
        console.log("Stake Manager:", stakeManager);
        console.log("Credit Manager:", creditManager);
        console.log("Service Registry:", serviceRegistry);
        console.log("Treasury:", treasury);
        console.log("");

        vm.startBroadcast();

        // ============================================================
        // DWS Provider Registry
        // ============================================================
        console.log("--- DWS Provider Registry ---");

        DWSProviderRegistry providerRegistry = new DWSProviderRegistry(
            deployer,           // owner
            identityRegistry,   // identity registry for ERC-8004
            banManager,         // ban manager for moderation
            stakeManager,       // unified stake manager
            treasury           // treasury for slashed funds
        );
        console.log("DWSProviderRegistry:", address(providerRegistry));
        console.log("  Min Stake (Compute): 1000 ETH");
        console.log("  Min Stake (Storage): 1000 ETH");
        console.log("  Min Stake (CDN): 500 ETH");
        console.log("  Min Stake (Database): 5000 ETH");
        console.log("  Min Stake (Inference): 2000 ETH");
        console.log("  Heartbeat Timeout: 5 minutes");
        console.log("");

        // ============================================================
        // DWS Billing
        // ============================================================
        console.log("--- DWS Billing ---");

        DWSBilling billing = new DWSBilling(
            creditManager,           // credit manager for payments
            serviceRegistry,         // service registry for usage tracking
            address(providerRegistry), // provider registry for revenue distribution
            treasury,                // treasury for protocol fees
            deployer                 // owner
        );
        console.log("DWSBilling:", address(billing));
        console.log("  Protocol Fee: 5%");
        console.log("");

        // ============================================================
        // DWS Service Provisioning
        // ============================================================
        console.log("--- DWS Service Provisioning ---");

        DWSServiceProvisioning serviceProvisioning = new DWSServiceProvisioning(
            identityRegistry,
            serviceRegistry
        );
        console.log("DWSServiceProvisioning:", address(serviceProvisioning));
        console.log("");

        // ============================================================
        // Create Default Service Plans
        // ============================================================
        console.log("--- Creating Default Service Plans ---");

        // Compute Plans - using actual struct fields from IDWSTypes
        IDWSTypes.ComputeLimits memory computeStarter = IDWSTypes.ComputeLimits({
            memoryMb: 512,
            cpuMs: 500,
            requestsPerMonth: 100000,
            bandwidthBytes: 10 * 1024 * 1024 * 1024 // 10GB
        });
        bytes32 computeStarterPlan = billing.createComputePlan(
            "compute-starter",
            0.01 ether, // $10/month equivalent
            computeStarter
        );
        console.log("  Created compute-starter plan:", vm.toString(computeStarterPlan));

        IDWSTypes.ComputeLimits memory computePro = IDWSTypes.ComputeLimits({
            memoryMb: 4096,
            cpuMs: 4000,
            requestsPerMonth: 1000000,
            bandwidthBytes: 100 * 1024 * 1024 * 1024 // 100GB
        });
        bytes32 computeProPlan = billing.createComputePlan(
            "compute-pro",
            0.1 ether, // $100/month equivalent
            computePro
        );
        console.log("  Created compute-pro plan:", vm.toString(computeProPlan));

        // Database Plans - using actual struct fields from IDWSTypes
        IDWSTypes.DatabaseLimits memory dbStarter = IDWSTypes.DatabaseLimits({
            nodeCount: 1,
            storageBytes: 10 * 1024 * 1024 * 1024, // 10GB
            queriesPerMonth: 1000000,
            consistencyMode: 0, // Strong
            encryptionMode: 1  // AtRest
        });
        bytes32 dbStarterPlan = billing.createDatabasePlan(
            "database-starter",
            0.02 ether,
            dbStarter
        );
        console.log("  Created database-starter plan:", vm.toString(dbStarterPlan));

        IDWSTypes.DatabaseLimits memory dbPro = IDWSTypes.DatabaseLimits({
            nodeCount: 3,
            storageBytes: 100 * 1024 * 1024 * 1024, // 100GB
            queriesPerMonth: 10000000,
            consistencyMode: 0, // Strong
            encryptionMode: 3  // Full
        });
        bytes32 dbProPlan = billing.createDatabasePlan(
            "database-pro",
            0.2 ether,
            dbPro
        );
        console.log("  Created database-pro plan:", vm.toString(dbProPlan));

        console.log("");

        vm.stopBroadcast();

        // ============================================================
        // Deployment Summary
        // ============================================================
        console.log("==================================================");
        console.log("DWS Infrastructure Deployment Complete");
        console.log("==================================================");
        console.log("");
        console.log("DWS Infrastructure:");
        console.log("  DWSProviderRegistry:", address(providerRegistry));
        console.log("  DWSBilling:", address(billing));
        console.log("  DWSServiceProvisioning:", address(serviceProvisioning));
        console.log("");
        console.log("Service Plans Created:");
        console.log("  compute-starter:", vm.toString(computeStarterPlan));
        console.log("  compute-pro:", vm.toString(computeProPlan));
        console.log("  database-starter:", vm.toString(dbStarterPlan));
        console.log("  database-pro:", vm.toString(dbProPlan));
        console.log("");
        console.log("Next Steps:");
        console.log("  1. Register providers via DWSProviderRegistry.registerProvider()");
        console.log("  2. Provision services via DWSServiceProvisioning.provisionService()");
        console.log("  3. Configure billing tokens via DWSBilling.setAcceptedToken()");
        console.log("  4. Update DWS Helm chart with contract addresses");

        // Save deployment addresses
        string memory json = string.concat(
            '{\n',
            '  "network": "jeju-testnet",\n',
            '  "chainId": 420690,\n',
            '  "contracts": {\n',
            '    "dwsProviderRegistry": "', vm.toString(address(providerRegistry)), '",\n',
            '    "dwsBilling": "', vm.toString(address(billing)), '",\n',
            '    "dwsServiceProvisioning": "', vm.toString(address(serviceProvisioning)), '"\n',
            '  },\n',
            '  "plans": {\n',
            '    "computeStarter": "', vm.toString(computeStarterPlan), '",\n',
            '    "computePro": "', vm.toString(computeProPlan), '",\n',
            '    "databaseStarter": "', vm.toString(dbStarterPlan), '",\n',
            '    "databasePro": "', vm.toString(dbProPlan), '"\n',
            '  }\n',
            '}'
        );
        vm.writeFile("deployments/jeju-testnet-dws-infra.json", json);
        console.log("");
        console.log("Deployment saved to: deployments/jeju-testnet-dws-infra.json");
    }
}
