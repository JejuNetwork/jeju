// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/services/ProofOfCloudValidator.sol";
import "../src/registry/IdentityRegistry.sol";

/**
 * @title DeployProofOfCloud
 * @notice Deployment script for Proof-of-Cloud infrastructure
 * @dev Deploys the ProofOfCloudValidator contract for TEE attestation verification
 */
contract DeployProofOfCloud is Script {
    // Default configuration
    uint256 constant DEFAULT_THRESHOLD = 2;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Required addresses
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        
        // Oracle signers (comma-separated list in env)
        address[] memory signers = _getSignersFromEnv(deployer);
        uint256 threshold = vm.envOr("POC_THRESHOLD", DEFAULT_THRESHOLD);
        address owner = vm.envOr("POC_OWNER", deployer);

        console.log("==================================================");
        console.log("Deploying Proof-of-Cloud Infrastructure");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Owner:", owner);
        console.log("Threshold:", threshold);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock dependencies for localnet if not provided
        if (identityRegistry == address(0)) {
            console.log("Deploying IdentityRegistry for local testing...");
            IdentityRegistry idRegistry = new IdentityRegistry();
            identityRegistry = address(idRegistry);
            console.log("IdentityRegistry deployed:", identityRegistry);
        }

        console.log("");
        console.log("--- Oracle Signers ---");
        for (uint256 i = 0; i < signers.length; i++) {
            console.log("  Signer", i + 1, ":", signers[i]);
        }
        console.log("");

        // Deploy ProofOfCloudValidator
        ProofOfCloudValidator validator = new ProofOfCloudValidator(
            payable(identityRegistry),
            signers,
            threshold,
            owner
        );
        
        console.log("ProofOfCloudValidator deployed:", address(validator));
        console.log("");

        vm.stopBroadcast();

        // Summary
        console.log("==================================================");
        console.log("Deployment Complete");
        console.log("==================================================");
        console.log("");
        console.log("Contract Addresses:");
        console.log("  IdentityRegistry:", identityRegistry);
        console.log("  ProofOfCloudValidator:", address(validator));
        console.log("");
        console.log("Configuration:");
        console.log("  Oracle Signers:", signers.length);
        console.log("  Threshold:", threshold);
        console.log("  Owner:", owner);
        console.log("");
        console.log("Environment Variables to Set:");
        console.log("  POC_VALIDATOR_ADDRESS=", address(validator));
        console.log("  IDENTITY_REGISTRY_ADDRESS=", identityRegistry);
    }

    function _getSignersFromEnv(address defaultSigner) internal view returns (address[] memory) {
        // Try to get signers from environment
        string memory signersEnv = vm.envOr("POC_SIGNERS", string(""));
        
        if (bytes(signersEnv).length == 0) {
            // Use deployer as default signer for testing
            address[] memory signers = new address[](2);
            signers[0] = defaultSigner;
            // Create a second signer for threshold
            signers[1] = address(uint160(uint256(keccak256(abi.encodePacked(defaultSigner, "signer2")))));
            console.log("Using default signers for testing");
            return signers;
        }

        // Parse comma-separated addresses
        // Note: This is a simplified parser - in production use a proper parser
        return _parseAddresses(signersEnv);
    }

    function _parseAddresses(string memory csv) internal pure returns (address[] memory) {
        // Count addresses by counting commas + 1
        uint256 count = 1;
        bytes memory csvBytes = bytes(csv);
        for (uint256 i = 0; i < csvBytes.length; i++) {
            if (csvBytes[i] == ",") count++;
        }

        address[] memory addresses = new address[](count);
        uint256 index = 0;
        uint256 start = 0;

        for (uint256 i = 0; i <= csvBytes.length; i++) {
            if (i == csvBytes.length || csvBytes[i] == ",") {
                // Extract substring and convert to address
                bytes memory addrBytes = new bytes(i - start);
                for (uint256 j = start; j < i; j++) {
                    addrBytes[j - start] = csvBytes[j];
                }
                addresses[index] = _parseAddress(string(addrBytes));
                index++;
                start = i + 1;
            }
        }

        return addresses;
    }

    function _parseAddress(string memory addrStr) internal pure returns (address) {
        bytes memory addrBytes = bytes(addrStr);
        // Skip "0x" prefix if present
        uint256 start = 0;
        if (addrBytes.length >= 2 && addrBytes[0] == "0" && (addrBytes[1] == "x" || addrBytes[1] == "X")) {
            start = 2;
        }

        uint256 result = 0;
        for (uint256 i = start; i < addrBytes.length; i++) {
            uint8 c = uint8(addrBytes[i]);
            uint8 digit;
            if (c >= 48 && c <= 57) { // 0-9
                digit = c - 48;
            } else if (c >= 65 && c <= 70) { // A-F
                digit = c - 55;
            } else if (c >= 97 && c <= 102) { // a-f
                digit = c - 87;
            } else {
                continue; // Skip whitespace
            }
            result = result * 16 + digit;
        }
        return address(uint160(result));
    }
}

