// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";
import {BoardGovernance} from "../src/governance/BoardGovernance.sol";

/**
 * @title DeployBoardGovernance
 * @notice Deploys the singleton BoardGovernance contract
 *
 * Usage:
 *   PRIVATE_KEY=0x... forge script script/DeployBoardGovernance.s.sol:DeployBoardGovernance --rpc-url http://127.0.0.1:6546 --broadcast
 */
contract DeployBoardGovernance is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy BoardGovernance
        // Owner = deployer, Autocrat operator = deployer (can be changed later)
        BoardGovernance boardGovernance = new BoardGovernance(deployer, deployer);

        console.log("BoardGovernance deployed at:", address(boardGovernance));
        console.log("Owner:", boardGovernance.owner());
        console.log("Autocrat Operator:", boardGovernance.autocratOperator());
        console.log("Voting Period:", boardGovernance.votingPeriod());
        console.log("Grace Period:", boardGovernance.gracePeriod());

        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYMENT INFO ===");
        console.log("Add to .env or contracts.json:");
        console.log("BOARD_GOVERNANCE_ADDRESS=", address(boardGovernance));
    }
}
