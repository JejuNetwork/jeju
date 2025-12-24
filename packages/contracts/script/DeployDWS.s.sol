// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/names/JNSRegistry.sol";
import "../src/names/JNSResolver.sol";
import "../src/names/JNSRegistrar.sol";
import "../src/names/JNSReverseRegistrar.sol";
import "../src/storage/StorageManager.sol";
import "../src/compute/WorkerRegistry.sol";
import "../src/cdn/CDNRegistry.sol";

/**
 * @title DeployDWS
 * @notice Deploys all DWS (Decentralized Web Services) contracts
 * @dev Deploys:
 *      - JNSRegistry (name service for routing)
 *      - JNSResolver (resolves names to content hashes)
 *      - StorageManager (IPFS/Arweave storage tracking)
 *      - WorkerRegistry (serverless worker deployments)
 *      - CDNRegistry (edge node and site management)
 */
contract DeployDWS is Script {
    function run() external {
        // Get deployer from msg.sender (set by --private-key flag)
        address deployer = msg.sender;

        // Get dependencies from env or use defaults for local dev
        // Use address(0) for banManager to skip ban checks on localnet
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY_ADDRESS", deployer);
        address banManager = vm.envOr("BAN_MANAGER_ADDRESS", address(0));
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);

        console.log("==================================================");
        console.log("Deploying DWS (Decentralized Web Services)");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Identity Registry:", identityRegistry);
        console.log("Ban Manager:", banManager);
        console.log("Treasury:", treasury);
        console.log("");

        vm.startBroadcast();

        // ============================================================
        // JNS (Jeju Name Service)
        // ============================================================
        console.log("--- JNS (Name Service) ---");

        JNSRegistry jnsRegistry = new JNSRegistry();
        console.log("JNSRegistry:", address(jnsRegistry));

        JNSResolver jnsResolver = new JNSResolver(address(jnsRegistry));
        console.log("JNSResolver:", address(jnsResolver));

        JNSRegistrar jnsRegistrar = new JNSRegistrar(
            address(jnsRegistry),
            address(jnsResolver),
            treasury
        );
        console.log("JNSRegistrar:", address(jnsRegistrar));

        JNSReverseRegistrar jnsReverseRegistrar = new JNSReverseRegistrar(
            address(jnsRegistry),
            address(jnsResolver)
        );
        console.log("JNSReverseRegistrar:", address(jnsReverseRegistrar));

        // Set resolver for root node
        jnsRegistry.setResolver(bytes32(0), address(jnsResolver));
        console.log("  Root resolver set");

        // Set identity registry if available
        if (identityRegistry != deployer) {
            jnsResolver.setIdentityRegistry(identityRegistry);
            jnsRegistrar.setIdentityRegistry(identityRegistry);
            console.log("  Identity registry linked");
        }

        // Create .jeju TLD - first with deployer as owner so we can configure it
        bytes32 jejuLabel = keccak256(bytes("jeju"));
        bytes32 jejuNode = jnsRegistry.setSubnodeOwner(bytes32(0), jejuLabel, deployer);
        // Set resolver while we still own the node
        jnsRegistry.setResolver(jejuNode, address(jnsResolver));
        // Now transfer ownership to the registrar
        jnsRegistry.setOwner(jejuNode, address(jnsRegistrar));
        console.log("  .jeju TLD created and assigned to registrar");

        // Create reverse namespace
        bytes32 reverseLabel = keccak256(bytes("reverse"));
        bytes32 reverseNode = jnsRegistry.setSubnodeOwner(bytes32(0), reverseLabel, deployer);
        bytes32 addrLabel = keccak256(bytes("addr"));
        jnsRegistry.setSubnodeOwner(reverseNode, addrLabel, address(jnsReverseRegistrar));
        console.log("  addr.reverse namespace created");
        console.log("");

        // ============================================================
        // Storage Manager
        // ============================================================
        console.log("--- Storage Manager ---");

        StorageManager storageManager = new StorageManager(
            identityRegistry,
            treasury,
            deployer
        );
        console.log("StorageManager:", address(storageManager));
        console.log("  Default quota: 10 GB");
        console.log("  Permanent storage fee: 0.001 ETH/MB");
        console.log("");

        // ============================================================
        // Worker Registry
        // ============================================================
        console.log("--- Worker Registry ---");

        WorkerRegistry workerRegistry = new WorkerRegistry();
        console.log("WorkerRegistry:", address(workerRegistry));
        console.log("  Supports: FREE, X402, PREPAID payment modes");
        console.log("");

        // ============================================================
        // CDN Registry
        // ============================================================
        console.log("--- CDN Registry ---");

        uint256 minProviderStake = 0.01 ether;
        CDNRegistry cdnRegistry = new CDNRegistry(
            deployer,
            identityRegistry,
            banManager,
            minProviderStake
        );
        console.log("CDNRegistry:", address(cdnRegistry));
        console.log("  Min provider stake:", minProviderStake / 1 ether, "ETH");
        console.log("  Min node stake: 0.001 ETH");
        console.log("");

        // ============================================================
        // Register Canonical App Names
        // ============================================================
        console.log("--- Registering Canonical Names ---");
        
        // Register core app names (1 year duration)
        // Pricing: 3-char=0.1 ETH, 4-char=0.01 ETH, 5+ char=0.001 ETH per year
        uint256 oneYear = 365 days;
        string[10] memory appNames = ["gateway", "bazaar", "compute", "storage", "indexer", "cloud", "docs", "monitoring", "crucible", "factory"];
        
        for (uint256 i = 0; i < appNames.length; i++) {
            uint256 nameLen = bytes(appNames[i]).length;
            uint256 registrationPrice = nameLen == 3 ? 0.1 ether : (nameLen == 4 ? 0.01 ether : 0.001 ether);
            jnsRegistrar.claimReserved{value: registrationPrice}(appNames[i], deployer, oneYear);
            console.log("  Registered:", appNames[i], ".jeju");
        }
        console.log("");

        vm.stopBroadcast();

        // ============================================================
        // Deployment Summary
        // ============================================================
        console.log("==================================================");
        console.log("DWS Deployment Complete");
        console.log("==================================================");
        console.log("");
        console.log("JNS (Name Service):");
        console.log("  JNSRegistry:", address(jnsRegistry));
        console.log("  JNSResolver:", address(jnsResolver));
        console.log("  JNSRegistrar:", address(jnsRegistrar));
        console.log("  JNSReverseRegistrar:", address(jnsReverseRegistrar));
        console.log("");
        console.log("DWS Core:");
        console.log("  StorageManager:", address(storageManager));
        console.log("  WorkerRegistry:", address(workerRegistry));
        console.log("  CDNRegistry:", address(cdnRegistry));
        console.log("");
        console.log("Canonical Names Registered:");
        console.log("  gateway.jeju, bazaar.jeju, compute.jeju, storage.jeju");
        console.log("  indexer.jeju, cloud.jeju, docs.jeju, monitoring.jeju");
        console.log("");
        console.log("Next Steps:");
        console.log("  1. Register local DWS node as storage/CDN provider");
        console.log("  2. Deploy app frontends to IPFS and record in StorageManager");
        console.log("  3. Register app backends in WorkerRegistry");
        console.log("  4. Configure JNS names to point to app content");
    }
}
