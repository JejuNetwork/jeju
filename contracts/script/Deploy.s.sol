// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ELIZAOS.sol";
import "../src/ELIZAOSPaymaster.sol";

/**
 * @title Deploy
 * @notice Deployment script for ELIZAOS token and Paymaster
 * @dev Run with: forge script script/Deploy.s.sol --rpc-url $L2_RPC_URL --broadcast
 */
contract Deploy is Script {
    // EntryPoint v0.6.0 address (pre-deployed on Jeju L2)
    address constant ENTRYPOINT = 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy ELIZAOS token
        ELIZAOS elizaos = new ELIZAOS();
        console.log("ELIZAOS deployed at:", address(elizaos));

        // Deploy Paymaster
        ELIZAOSPaymaster paymaster = new ELIZAOSPaymaster(ENTRYPOINT, address(elizaos));
        console.log("ELIZAOSPaymaster deployed at:", address(paymaster));

        // Fund paymaster with ETH for gas sponsorship (1 ETH)
        paymaster.deposit{value: 1 ether}();
        console.log("Paymaster funded with 1 ETH");

        vm.stopBroadcast();

        // Log summary
        console.log("\n=== Deployment Summary ===");
        console.log("Network: Jeju L2");
        console.log("EntryPoint:", ENTRYPOINT);
        console.log("ELIZAOS:", address(elizaos));
        console.log("ELIZAOSPaymaster:", address(paymaster));
        console.log("Paymaster ETH Deposit:", paymaster.getDeposit());
    }
}
