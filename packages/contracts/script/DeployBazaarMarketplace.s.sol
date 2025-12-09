// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Bazaar} from "../src/marketplace/Bazaar.sol";
import {MockJejuUSDC} from "../src/tokens/MockJejuUSDC.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockGold is ERC20 {
    constructor() ERC20("Hyperscape Gold", "HG") {
        _mint(msg.sender, 1000000 * 1e18);
    }
}

contract DeployBazaarMarketplace is Script {
    function run() external returns (address marketplaceAddr, address goldAddr, address usdcAddr) {
        address deployer = vm.envOr("DEPLOYER", address(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266));
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY_ADDRESS", address(0));

        vm.startBroadcast();

        // Deploy mock tokens for testing
        MockGold gold = new MockGold();
        MockJejuUSDC usdc = new MockJejuUSDC(deployer);

        goldAddr = address(gold);
        usdcAddr = address(usdc);

        // Deploy marketplace
        Bazaar marketplace = new Bazaar(deployer, goldAddr, usdcAddr, feeRecipient);
        marketplaceAddr = address(marketplace);

        // Configure ERC-8004 integration if IdentityRegistry is provided
        if (identityRegistry != address(0)) {
            marketplace.setIdentityRegistry(identityRegistry);
            console.log("[ERC-8004] Linked to IdentityRegistry:", identityRegistry);
        }

        console.log("========================================");
        console.log("Bazaar Marketplace deployed at:", marketplaceAddr);
        console.log("Gold Token:", goldAddr);
        console.log("USDC Token:", usdcAddr);
        console.log("Owner:", deployer);
        console.log("Fee Recipient:", feeRecipient);
        console.log("========================================");

        vm.stopBroadcast();
    }
}
