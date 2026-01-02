// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/names/JNSRegistry.sol";
import "../src/names/JNSRegistrar.sol";

/**
 * @title TransferJNSToGovernance
 * @notice Transfer JNS root node ownership to governance timelock
 *
 * This is a critical decentralization step:
 * - Root node (bytes32(0)) controls all of .jeju
 * - Currently owned by deployer
 * - Should be owned by governance timelock for decentralization
 *
 * Run: forge script script/TransferJNSToGovernance.s.sol:TransferJNSToGovernance \
 *        --rpc-url jeju_testnet --broadcast
 */
contract TransferJNSToGovernance is Script {
    // The root node hash
    bytes32 constant ROOT_NODE = bytes32(0);

    function run() external {
        // Load addresses from environment
        address jnsRegistry = vm.envAddress("JNS_REGISTRY");
        address jnsRegistrar = vm.envAddress("JNS_REGISTRAR");
        address governance = vm.envAddress("GOVERNANCE_TIMELOCK");

        console.log("==================================================");
        console.log("Transferring JNS to Governance");
        console.log("==================================================");
        console.log("JNS Registry:", jnsRegistry);
        console.log("JNS Registrar:", jnsRegistrar);
        console.log("Governance Timelock:", governance);
        console.log("");

        JNSRegistry registry = JNSRegistry(jnsRegistry);
        JNSRegistrar registrar = JNSRegistrar(payable(jnsRegistrar));

        // Check current ownership
        address currentRootOwner = registry.owner(ROOT_NODE);
        console.log("Current root owner:", currentRootOwner);

        address jejuTldOwner = registry.owner(
            keccak256(abi.encodePacked(ROOT_NODE, keccak256("jeju")))
        );
        console.log("Current .jeju TLD owner:", jejuTldOwner);

        address registrarOwner = registrar.owner();
        console.log("Current registrar owner:", registrarOwner);

        vm.startBroadcast();

        // Step 1: Transfer registrar ownership to governance
        // This controls:
        // - Reserved names
        // - Default resolver
        // - Treasury address
        // - Agent discounts
        console.log("");
        console.log("Step 1: Transferring JNSRegistrar ownership...");
        registrar.transferOwnership(governance);
        console.log("  Registrar ownership transferred to governance");

        // Step 2: Add governance as operator for root node
        // This allows governance to manage subnode creation
        console.log("");
        console.log("Step 2: Adding governance as operator...");
        registry.setApprovalForAll(governance, true);
        console.log("  Governance approved as operator");

        // Step 3: Transfer root node ownership to governance
        // This is the most critical step - controls entire .jeju namespace
        console.log("");
        console.log("Step 3: Transferring root node ownership...");
        registry.setOwner(ROOT_NODE, governance);
        console.log("  Root node ownership transferred to governance");

        vm.stopBroadcast();

        // Verify transfers
        console.log("");
        console.log("==================================================");
        console.log("Verification");
        console.log("==================================================");
        
        address newRootOwner = registry.owner(ROOT_NODE);
        console.log("New root owner:", newRootOwner);
        require(newRootOwner == governance, "Root transfer failed");

        address newRegistrarOwner = registrar.owner();
        console.log("New registrar owner:", newRegistrarOwner);
        require(newRegistrarOwner == governance, "Registrar transfer failed");

        console.log("");
        console.log("SUCCESS: JNS transferred to governance");
        console.log("");
        console.log("Governance now controls:");
        console.log("  - Root node (all of .jeju namespace)");
        console.log("  - JNSRegistrar (name pricing, treasury)");
        console.log("");
        console.log("Future changes require governance proposals:");
        console.log("  - Adding new TLDs");
        console.log("  - Modifying reserved names");
        console.log("  - Changing resolver defaults");
        console.log("  - Updating treasury address");
    }
}

/**
 * @title SetupJNSGovernance
 * @notice Additional script to set up governance controls for JNS
 */
contract SetupJNSGovernance is Script {
    function run() external {
        address jnsRegistrar = vm.envAddress("JNS_REGISTRAR");
        address governance = vm.envAddress("GOVERNANCE_TIMELOCK");

        JNSRegistrar registrar = JNSRegistrar(payable(jnsRegistrar));

        vm.startBroadcast();

        // Register platform-owned names to governance
        // These are critical infrastructure names
        string[10] memory platformNames = [
            "gateway",
            "storage", 
            "compute",
            "indexer",
            "monitoring",
            "rpc",
            "bridge",
            "registry",
            "dns",
            "api"
        ];

        console.log("Registering platform names to governance...");
        
        for (uint i = 0; i < platformNames.length; i++) {
            string memory name = platformNames[i];
            bytes32 labelhash = keccak256(bytes(name));
            
            // Check if available (not expired and not taken)
            if (registrar.available(name)) {
                // Calculate price for 10 years
                uint256 duration = 10 * 365 days;
                uint256 price = registrar.rentPrice(name, duration);
                
                console.log("  Registering:", name);
                console.log("    Price:", price);
                
                // Register to governance (uses default resolver)
                registrar.register{value: price}(
                    name,
                    governance,
                    duration
                );
            } else {
                console.log("  Skipping:", name, "(already registered)");
            }
        }

        vm.stopBroadcast();

        console.log("");
        console.log("Platform names registered to governance");
    }
}

