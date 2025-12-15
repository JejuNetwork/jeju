// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Presale} from "../src/tokens/Presale.sol";
import {Token} from "../src/tokens/Token.sol";

contract DeployPresale is Script {
    // Presale parameters
    uint256 constant SOFT_CAP = 100 ether;
    uint256 constant HARD_CAP = 1000 ether;
    uint256 constant MIN_CONTRIBUTION = 0.01 ether;
    uint256 constant MAX_CONTRIBUTION = 50 ether;
    uint256 constant TOKEN_PRICE = 0.00005 ether; // ~$0.15 at $3k ETH

    // Vesting: 20% TGE, no cliff, 180 days linear
    uint256 constant TGE_PERCENT = 2000; // 20%
    uint256 constant CLIFF_DURATION = 0;
    uint256 constant VESTING_DURATION = 180 days;

    // Timing offsets from deployment
    uint256 constant WHITELIST_OFFSET = 1 days;
    uint256 constant PUBLIC_OFFSET = 8 days;
    uint256 constant PRESALE_END_OFFSET = 22 days;
    uint256 constant TGE_OFFSET = 29 days;

    // Presale token allocation (1 billion)
    uint256 constant PRESALE_ALLOCATION = 1_000_000_000 ether;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        address tokenAddress = vm.envOr("TOKEN_ADDRESS", address(0));

        console2.log("Deployer:", deployer);
        console2.log("Treasury:", treasury);

        vm.startBroadcast(deployerPrivateKey);

        Token token;

        // Deploy or use existing token
        if (tokenAddress == address(0)) {
            console2.log("Deploying new Token...");
            token = new Token(
                "Jeju",
                "JEJU",
                1_000_000_000 * 10**18,
                deployer,
                10_000_000_000 * 10**18,
                true
            );
            // Enable faucet for testnet
            token.setConfig(0, 0, false, false, true);
            console2.log("Token deployed at:", address(token));
        } else {
            console2.log("Using existing Token at:", tokenAddress);
            token = Token(tokenAddress);
        }

        // Deploy presale
        console2.log("Deploying Presale...");
        Presale presale = new Presale(address(token), treasury, deployer);
        console2.log("Presale deployed at:", address(presale));

        // Configure presale timing
        uint256 whitelistStart = block.timestamp + WHITELIST_OFFSET;
        uint256 publicStart = block.timestamp + PUBLIC_OFFSET;
        uint256 presaleEnd = block.timestamp + PRESALE_END_OFFSET;
        uint256 tgeTimestamp = block.timestamp + TGE_OFFSET;

        console2.log("Configuring presale...");
        presale.configure(
            Presale.PresaleMode.FIXED_PRICE,
            PRESALE_ALLOCATION,
            SOFT_CAP,
            HARD_CAP,
            MIN_CONTRIBUTION,
            MAX_CONTRIBUTION,
            TOKEN_PRICE,
            0, 0, 0, // CCA params (unused for fixed price)
            whitelistStart,
            publicStart,
            presaleEnd,
            tgeTimestamp
        );

        // Configure vesting
        presale.setVesting(TGE_PERCENT, CLIFF_DURATION, VESTING_DURATION);

        // Transfer presale tokens to contract
        if (tokenAddress == address(0)) {
            console2.log("Transferring", PRESALE_ALLOCATION / 1e18, "tokens to presale...");
            token.transfer(address(presale), PRESALE_ALLOCATION);
        }

        vm.stopBroadcast();

        // Log deployment summary
        console2.log("\n=== Deployment Summary ===");
        console2.log("Token:", address(token));
        console2.log("Presale:", address(presale));
        console2.log("Treasury:", treasury);
        console2.log("\n=== Presale Config ===");
        console2.log("Soft Cap:", SOFT_CAP / 1e18, "ETH");
        console2.log("Hard Cap:", HARD_CAP / 1e18, "ETH");
        console2.log("Token Price:", TOKEN_PRICE, "wei");
        console2.log("Min Contribution:", MIN_CONTRIBUTION / 1e18, "ETH");
        console2.log("Max Contribution:", MAX_CONTRIBUTION / 1e18, "ETH");
        console2.log("\n=== Timeline ===");
        console2.log("Whitelist Start:", whitelistStart);
        console2.log("Public Start:", publicStart);
        console2.log("Presale End:", presaleEnd);
        console2.log("TGE:", tgeTimestamp);
        console2.log("\n=== Vesting ===");
        console2.log("TGE Unlock:", TGE_PERCENT / 100, "%");
        console2.log("Cliff:", CLIFF_DURATION / 1 days, "days");
        console2.log("Vesting:", VESTING_DURATION / 1 days, "days");
    }
}
