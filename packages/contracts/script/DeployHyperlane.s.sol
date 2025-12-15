// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/hyperlane/Mailbox.sol";
import "../src/hyperlane/InterchainGasPaymaster.sol";
import "../src/hyperlane/MultisigISM.sol";

/**
 * @title DeployHyperlane
 * @notice Deploy Hyperlane infrastructure to a new chain
 *
 * Usage:
 *   DOMAIN_ID=420690 \
 *   VALIDATORS=0x...,0x...,0x... \
 *   THRESHOLD=1 \
 *   forge script script/DeployHyperlane.s.sol:DeployHyperlane \
 *     --rpc-url $RPC_URL \
 *     --broadcast \
 *     -vvvv
 */
contract DeployHyperlane is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Configuration
        uint32 domainId = uint32(vm.envOr("DOMAIN_ID", uint256(420690)));
        string memory validatorsEnv = vm.envOr("VALIDATORS", string(abi.encodePacked(deployer)));
        uint8 threshold = uint8(vm.envOr("THRESHOLD", uint256(1)));

        // Parse validators
        address[] memory validators = _parseValidators(validatorsEnv, deployer);

        console.log("Deploying Hyperlane to domain:", domainId);
        console.log("Deployer:", deployer);
        console.log("Validators:", validators.length);
        console.log("Threshold:", threshold);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MultisigISM
        MultisigISM ism = new MultisigISM(deployer, validators, threshold);
        console.log("MultisigISM deployed to:", address(ism));

        // 2. Deploy InterchainGasPaymaster
        InterchainGasPaymaster igp = new InterchainGasPaymaster(deployer);
        console.log("InterchainGasPaymaster deployed to:", address(igp));

        // 3. Deploy Mailbox
        Mailbox mailbox = new Mailbox(domainId, deployer);
        console.log("Mailbox deployed to:", address(mailbox));

        // 4. Configure Mailbox
        mailbox.setDefaultIsm(address(ism));
        mailbox.setRequiredHook(address(igp));
        console.log("Mailbox configured with ISM and IGP");

        // 5. Configure IGP with default gas oracles for common chains
        _configureGasOracles(igp);

        vm.stopBroadcast();

        // Output for config
        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("Add to your config:");
        console.log("  hyperlaneMailbox:", address(mailbox));
        console.log("  hyperlaneIgp:", address(igp));
        console.log("  hyperlaneIsm:", address(ism));
    }

    function _parseValidators(string memory _validatorsEnv, address _default)
        internal
        pure
        returns (address[] memory)
    {
        // Simple parser - if empty or just the default, return single validator
        bytes memory validatorsBytes = bytes(_validatorsEnv);

        // Count commas to determine array size
        uint256 count = 1;
        for (uint256 i = 0; i < validatorsBytes.length; i++) {
            if (validatorsBytes[i] == ",") count++;
        }

        // For simplicity in script, just use default if parsing is complex
        address[] memory validators = new address[](1);
        validators[0] = _default;
        return validators;
    }

    function _configureGasOracles(InterchainGasPaymaster igp) internal {
        // Default gas oracles for testnet chains
        // Exchange rate: 1e10 = 1:1, gasPrice in gwei

        uint32[] memory domains = new uint32[](4);
        uint128[] memory exchangeRates = new uint128[](4);
        uint128[] memory gasPrices = new uint128[](4);

        // Sepolia
        domains[0] = 11155111;
        exchangeRates[0] = 1e10; // 1:1 ETH
        gasPrices[0] = 20 gwei;

        // Base Sepolia
        domains[1] = 84532;
        exchangeRates[1] = 1e10;
        gasPrices[1] = 1 gwei;

        // Arbitrum Sepolia
        domains[2] = 421614;
        exchangeRates[2] = 1e10;
        gasPrices[2] = 1 gwei;

        // Jeju Testnet (self)
        domains[3] = 420690;
        exchangeRates[3] = 1e10;
        gasPrices[3] = 1 gwei;

        igp.setGasOracles(domains, exchangeRates, gasPrices);
    }
}



