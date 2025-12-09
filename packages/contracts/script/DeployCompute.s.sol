// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/compute/ComputeRegistry.sol";
import "../src/compute/ComputeRental.sol";
import "../src/compute/LedgerManager.sol";
import "../src/compute/InferenceServing.sol";
import "../src/compute/ComputeStaking.sol";
import "../src/moderation/BanManager.sol";

/**
 * @title DeployCompute
 * @notice Deploys the Jeju Compute Marketplace contracts
 * @dev Usage: forge script script/DeployCompute.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployCompute is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying Jeju Compute Marketplace");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy BanManager
        BanManager banManager = new BanManager(deployer, deployer);
        console.log("BanManager deployed at:", address(banManager));

        // Deploy ComputeRegistry
        ComputeRegistry registry = new ComputeRegistry(deployer);
        console.log("ComputeRegistry deployed at:", address(registry));

        // Deploy LedgerManager
        LedgerManager ledger = new LedgerManager(address(registry), deployer);
        console.log("LedgerManager deployed at:", address(ledger));

        // Deploy InferenceServing
        InferenceServing inference = new InferenceServing(address(registry), address(ledger), deployer);
        console.log("InferenceServing deployed at:", address(inference));

        // Authorize InferenceServing on LedgerManager
        ledger.setInferenceContract(address(inference));
        console.log("InferenceServing authorized on LedgerManager");

        // Deploy ComputeStaking
        ComputeStaking staking = new ComputeStaking(address(banManager), deployer);
        console.log("ComputeStaking deployed at:", address(staking));

        // Deploy ComputeRental
        ComputeRental rental = new ComputeRental(deployer, deployer);
        console.log("ComputeRental deployed at:", address(rental));

        vm.stopBroadcast();

        // Write deployment info
        string memory json = string.concat(
            '{"network":"',
            vm.toString(block.chainid),
            '",',
            '"deployer":"',
            vm.toString(deployer),
            '",',
            '"contracts":{',
            '"registry":"',
            vm.toString(address(registry)),
            '",',
            '"ledger":"',
            vm.toString(address(ledger)),
            '",',
            '"inference":"',
            vm.toString(address(inference)),
            '",',
            '"staking":"',
            vm.toString(address(staking)),
            '",',
            '"banManager":"',
            vm.toString(address(banManager)),
            '",',
            '"rental":"',
            vm.toString(address(rental)),
            '"',
            "}}"
        );

        console.log("\nDeployment JSON:");
        console.log(json);
    }
}
