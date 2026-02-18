// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";
import {ELIZAOS} from "../src/tokens/ELIZAOS.sol";

/**
 * @title DeployELIZAOS
 * @notice Deploy ELIZAOS token on L1 for use as Custom Gas Token on L2
 *
 * Usage:
 *   forge script script/DeployELIZAOS.s.sol:DeployELIZAOS \
 *     --rpc-url $L1_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast
 *
 * After deployment:
 * 1. Note the deployed address
 * 2. Configure Kurtosis with this address as custom_gas_token
 * 3. Redeploy L2 with custom gas token enabled
 */
contract DeployELIZAOS is Script {
    function run() external returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying ELIZAOS...");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy with deployer as initial token holder
        ELIZAOS token = new ELIZAOS(deployer);

        console.log("");
        console.log("=== ELIZAOS Deployed ===");
        console.log("Address:", address(token));
        console.log("Name:", token.name());
        console.log("Symbol:", token.symbol());
        console.log("Decimals:", token.decimals());
        console.log("Initial Supply:", token.totalSupply() / 1e18, "ELIZAOS");
        console.log("Max Supply:", token.MAX_SUPPLY() / 1e18, "ELIZAOS");
        console.log("Deployer Balance:", token.balanceOf(deployer) / 1e18, "ELIZAOS");
        console.log("");
        console.log("Next steps:");
        console.log("1. Fund test accounts with ELIZAOS tokens");
        console.log("2. Configure Kurtosis with custom_gas_token:", address(token));
        console.log("3. Redeploy L2 with: kurtosis run ...");

        vm.stopBroadcast();

        return address(token);
    }
}

/**
 * @title FundAccountsWithELIZAOS
 * @notice Fund test accounts with ELIZAOS tokens for L2 gas
 */
contract FundAccountsWithELIZAOS is Script {
    // Standard Anvil/Foundry test accounts
    address constant ACCOUNT_0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant ACCOUNT_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant ACCOUNT_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant ACCOUNT_3 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address constant ACCOUNT_4 = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address tokenAddress = vm.envAddress("ELIZAOS_TOKEN");
        uint256 amountPerAccount = 100_000 * 1e18; // 100k ELIZAOS each

        ELIZAOS token = ELIZAOS(tokenAddress);

        console.log("Funding accounts with ELIZAOS...");
        console.log("Token:", tokenAddress);
        console.log("Amount per account:", amountPerAccount / 1e18, "ELIZAOS");

        vm.startBroadcast(deployerPrivateKey);

        address[5] memory accounts = [ACCOUNT_0, ACCOUNT_1, ACCOUNT_2, ACCOUNT_3, ACCOUNT_4];

        for (uint256 i = 0; i < accounts.length; i++) {
            if (token.balanceOf(accounts[i]) < amountPerAccount) {
                token.transfer(accounts[i], amountPerAccount);
                console.log("Funded account:");
                console.log(accounts[i]);
            } else {
                console.log("Already funded:");
                console.log(accounts[i]);
            }
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Account Balances ===");
        for (uint256 i = 0; i < accounts.length; i++) {
            console.log(accounts[i], ":", token.balanceOf(accounts[i]) / 1e18, "ELIZAOS");
        }
    }
}
