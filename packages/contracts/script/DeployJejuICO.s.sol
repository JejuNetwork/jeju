// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Token} from "../src/tokens/Token.sol";
import {Presale} from "../src/tokens/Presale.sol";
import {BanManager} from "../src/moderation/BanManager.sol";

/**
 * @title DeployJejuICO
 * @notice Deploy JEJU token and presale contracts for the ICO
 *
 * Usage:
 *   # Localnet
 *   forge script script/DeployJejuICO.s.sol --rpc-url http://localhost:8545 --broadcast
 *
 *   # Testnet (Jeju testnet or Base Sepolia)
 *   forge script script/DeployJejuICO.s.sol --rpc-url $TESTNET_RPC --broadcast --verify
 *
 *   # Mainnet
 *   forge script script/DeployJejuICO.s.sol --rpc-url $MAINNET_RPC --broadcast --verify
 */
contract DeployJejuICO is Script {
    // Token configuration
    uint256 constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18; // 1B
    uint256 constant MAX_SUPPLY = 10_000_000_000 * 10 ** 18; // 10B

    // Presale configuration
    uint256 constant PRESALE_ALLOCATION = 100_000_000 * 10 ** 18; // 100M (10% of initial)
    uint256 constant SOFT_CAP = 1000 ether;
    uint256 constant HARD_CAP = 3000 ether;
    uint256 constant MIN_CONTRIBUTION = 0.01 ether;
    uint256 constant MAX_CONTRIBUTION = 50 ether;
    uint256 constant TOKEN_PRICE = 3 * 10 ** 12; // 0.000003 ETH per JEJU

    // Vesting: 20% at TGE, 180 days linear
    uint256 constant TGE_UNLOCK = 2000; // 20%
    uint256 constant VESTING_DURATION = 180 days;

    // Timeline
    uint256 constant WHITELIST_DURATION = 7 days;
    uint256 constant PUBLIC_DURATION = 7 days;

    function run() external {
        uint256 deployerKey = vm.envOr("DEPLOYER_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerKey);
        address treasury = vm.envOr("TREASURY", deployer);
        address governance = vm.envOr("GOVERNANCE", deployer);

        bool isLocalnet = block.chainid == 31337 || block.chainid == 1337;
        bool isTestnet = block.chainid == 84532 || block.chainid == 11155111;

        console2.log("=== JEJU Token ICO Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Treasury:", treasury);
        console2.log("Chain ID:", block.chainid);
        console2.log("Environment:", isLocalnet ? "Localnet" : isTestnet ? "Testnet" : "Mainnet");

        vm.startBroadcast(deployerKey);

        // 1. Deploy BanManager
        BanManager banManager = new BanManager(governance, deployer);
        console2.log("\nBanManager deployed:", address(banManager));

        // 2. Deploy JEJU Token
        Token jeju = new Token("Jeju", "JEJU", INITIAL_SUPPLY, deployer, MAX_SUPPLY, true);

        // Configure token
        jeju.setBanManager(address(banManager));
        jeju.setConfig(
            0, // no max wallet
            0, // no max tx
            true, // ban enforcement
            false, // not paused
            isLocalnet || isTestnet // faucet only on test networks
        );

        // Configure fees: 0.5% creator, 1% holders, 0.5% treasury, 0% burn
        jeju.setFees(
            50, // 0.5% creator
            100, // 1% holders
            50, // 0.5% treasury
            0, // no burn
            25, // 0.25% LP
            treasury,
            treasury, // holder rewards go to treasury for now
            treasury
        );

        console2.log("JEJU Token deployed:", address(jeju));

        // 3. Deploy Presale
        Presale presale = new Presale(address(jeju), treasury, deployer);
        console2.log("Presale deployed:", address(presale));

        // 4. Configure Presale
        uint256 whitelistStart = block.timestamp + (isLocalnet ? 1 minutes : 1 days);
        uint256 publicStart = whitelistStart + WHITELIST_DURATION;
        uint256 presaleEnd = publicStart + PUBLIC_DURATION;
        uint256 tgeTimestamp = presaleEnd + (isLocalnet ? 1 minutes : 1 hours);

        presale.configure(
            Presale.PresaleMode.FIXED_PRICE,
            PRESALE_ALLOCATION,
            SOFT_CAP,
            HARD_CAP,
            MIN_CONTRIBUTION,
            MAX_CONTRIBUTION,
            TOKEN_PRICE,
            0, 0, 0, // CCA params (unused)
            whitelistStart,
            publicStart,
            presaleEnd,
            tgeTimestamp
        );

        // 5. Configure vesting
        presale.setVesting(TGE_UNLOCK, 0, VESTING_DURATION);

        // 6. Configure bonuses
        presale.setBonuses(
            1000, // 10% whitelist bonus
            0, // no holder bonus for JEJU presale
            100, // 1% for 1 ETH
            300, // 3% for 5 ETH
            500, // 5% for 10 ETH
            address(0),
            0
        );

        // 7. Transfer presale allocation
        jeju.transfer(address(presale), PRESALE_ALLOCATION);
        console2.log("Transferred", PRESALE_ALLOCATION / 1e18, "JEJU to presale");

        // 8. For localnet/testnet, fund test accounts
        if (isLocalnet) {
            address[] memory testAccounts = new address[](3);
            testAccounts[0] = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
            testAccounts[1] = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
            testAccounts[2] = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

            for (uint256 i = 0; i < testAccounts.length; i++) {
                jeju.transfer(testAccounts[i], 100_000 * 1e18);
            }
            console2.log("Funded test accounts");
        }

        vm.stopBroadcast();

        // Summary
        console2.log("\n=== Deployment Summary ===");
        console2.log("BanManager:", address(banManager));
        console2.log("JEJU Token:", address(jeju));
        console2.log("Presale:", address(presale));
        console2.log("");
        console2.log("Timeline:");
        console2.log("  Whitelist Start:", whitelistStart);
        console2.log("  Public Start:", publicStart);
        console2.log("  Presale End:", presaleEnd);
        console2.log("  TGE:", tgeTimestamp);
        console2.log("");
        console2.log("Update addresses in:");
        console2.log("  - apps/bazaar/config/jeju-tokenomics.ts");

        // Output JSON for automation
        console2.log("\n--- JSON OUTPUT ---");
        console2.log("{");
        console2.log('  "banManager": "', address(banManager), '",');
        console2.log('  "token": "', address(jeju), '",');
        console2.log('  "presale": "', address(presale), '"');
        console2.log("}");
    }
}
