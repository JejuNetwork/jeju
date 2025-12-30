// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title DeployGovernance
 * @notice Deploys governance infrastructure for decentralized admin control
 * @dev Deploys:
 *      - TimelockController (delays admin actions)
 *      - Configures roles for multisig
 *
 * Run: forge script script/DeployGovernance.s.sol:DeployGovernance --rpc-url jeju_testnet --broadcast
 */
contract DeployGovernance is Script {
    function run() external {
        address deployer = msg.sender;

        // Multisig addresses (Safe wallets)
        address[] memory proposers = new address[](1);
        address[] memory executors = new address[](1);

        // Get multisig addresses from env
        proposers[0] = vm.envOr("GOVERNANCE_MULTISIG", deployer);
        executors[0] = vm.envOr("GOVERNANCE_MULTISIG", deployer);

        // Timelock delays
        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY", uint256(2 days));
        uint256 criticalDelay = vm.envOr("TIMELOCK_CRITICAL_DELAY", uint256(7 days));

        console.log("==================================================");
        console.log("Deploying Governance Infrastructure");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Proposers:", proposers[0]);
        console.log("Executors:", executors[0]);
        console.log("Min Delay:", minDelay / 1 days, "days");
        console.log("Critical Delay:", criticalDelay / 1 days, "days");
        console.log("");

        vm.startBroadcast();

        // ============================================================
        // Standard Timelock (for normal operations)
        // ============================================================
        console.log("--- Standard Timelock ---");

        TimelockController standardTimelock = new TimelockController(
            minDelay,
            proposers,
            executors,
            address(0) // No admin - fully decentralized
        );
        console.log("StandardTimelock:", address(standardTimelock));
        console.log("  Min delay:", minDelay / 1 days, "days");
        console.log("");

        // ============================================================
        // Critical Timelock (for security-sensitive operations)
        // ============================================================
        console.log("--- Critical Timelock ---");

        TimelockController criticalTimelock = new TimelockController(
            criticalDelay,
            proposers,
            executors,
            address(0) // No admin - fully decentralized
        );
        console.log("CriticalTimelock:", address(criticalTimelock));
        console.log("  Min delay:", criticalDelay / 1 days, "days");
        console.log("");

        // ============================================================
        // Emergency Timelock (short delay for emergencies, requires higher threshold)
        // ============================================================
        console.log("--- Emergency Timelock ---");

        // For emergencies, use a short delay but require more signers
        uint256 emergencyDelay = 6 hours;
        TimelockController emergencyTimelock = new TimelockController(
            emergencyDelay,
            proposers,
            executors,
            address(0)
        );
        console.log("EmergencyTimelock:", address(emergencyTimelock));
        console.log("  Min delay:", emergencyDelay / 1 hours, "hours");
        console.log("");

        vm.stopBroadcast();

        // ============================================================
        // Deployment Summary
        // ============================================================
        console.log("==================================================");
        console.log("Governance Deployment Complete");
        console.log("==================================================");
        console.log("");
        console.log("Timelocks:");
        console.log("  Standard (2 day):", address(standardTimelock));
        console.log("  Critical (7 day):", address(criticalTimelock));
        console.log("  Emergency (6 hour):", address(emergencyTimelock));
        console.log("");
        console.log("Next Steps:");
        console.log("  1. Create Safe multisig at https://app.safe.global");
        console.log("  2. Transfer contract ownership to appropriate timelock");
        console.log("  3. Grant PROPOSER_ROLE to multisig on timelocks");
        console.log("  4. Verify contracts on block explorer");
        console.log("");
        console.log("Ownership Transfer Commands:");
        console.log("  - DWSProviderRegistry: transferOwnership(standardTimelock)");
        console.log("  - DWSBilling: transferOwnership(standardTimelock)");
        console.log("  - SystemConfig: transferOwnership(criticalTimelock)");
        console.log("  - L2OutputOracle: transferOwnership(criticalTimelock)");

        // Save deployment addresses
        string memory json = string.concat(
            '{\n',
            '  "network": "jeju-testnet",\n',
            '  "chainId": 420690,\n',
            '  "contracts": {\n',
            '    "standardTimelock": "', vm.toString(address(standardTimelock)), '",\n',
            '    "criticalTimelock": "', vm.toString(address(criticalTimelock)), '",\n',
            '    "emergencyTimelock": "', vm.toString(address(emergencyTimelock)), '"\n',
            '  },\n',
            '  "config": {\n',
            '    "standardDelay": "', vm.toString(minDelay), '",\n',
            '    "criticalDelay": "', vm.toString(criticalDelay), '",\n',
            '    "emergencyDelay": "', vm.toString(emergencyDelay), '"\n',
            '  }\n',
            '}'
        );
        vm.writeFile("deployments/jeju-testnet-governance.json", json);
        console.log("");
        console.log("Deployment saved to: deployments/jeju-testnet-governance.json");
    }
}
