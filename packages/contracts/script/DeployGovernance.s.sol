// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title DeployGovernance
 * @notice Deploys governance infrastructure
 *
 * Deploys:
 * - Timelock Controller (48-hour delay)
 * - Governance Token (ERC-20 votes)
 * - Governor Contract (DAO)
 * - Initial Safe multisig
 *
 * Usage:
 *   forge script script/DeployGovernance.s.sol:DeployGovernance \
 *     --rpc-url https://testnet-rpc.jeju.network \
 *     --broadcast
 */
contract DeployGovernance is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==================================================");
        console.log("Deploying Governance Infrastructure");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy Timelock (48-hour delay for security)
        address[] memory proposers = new address[](1);
        address[] memory executors = new address[](1);
        proposers[0] = deployer; // Replace with multisig
        executors[0] = address(0); // Anyone can execute after delay

        uint256 minDelay = 48 hours;

        TimelockController timelock = new TimelockController(
            minDelay,
            proposers,
            executors,
            deployer // Admin
        );

        console.log("Timelock deployed:", address(timelock));
        console.log("Min delay:", minDelay / 3600, "hours");
        console.log("");

        console.log("Next steps:");
        console.log("1. Deploy Governance Token (ERC20Votes)");
        console.log("2. Deploy Governor contract");
        console.log("3. Deploy Safe multisig");
        console.log("4. Configure roles and permissions");
        console.log("");
        console.log("Recommended:");
        console.log("  - Use Safe for initial governance");
        console.log("  - 3-of-5 for operations");
        console.log("  - 5-of-9 for upgrades");
        console.log("  - All with hardware wallets");

        vm.stopBroadcast();

        // Save deployment info
        string memory deploymentJson = string.concat(
            "{\n",
            '  "timelock": "',
            vm.toString(address(timelock)),
            '",\n',
            '  "minDelay": ',
            vm.toString(minDelay),
            ",\n",
            '  "deployer": "',
            vm.toString(deployer),
            '"\n',
            "}"
        );

        vm.writeFile("deployments/governance.json", deploymentJson);
        console.log("Saved to: deployments/governance.json");
    }
}
