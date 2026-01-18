// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";
import {UnifiedAttestationVerifier} from "../src/tee/UnifiedAttestationVerifier.sol";
import {TEERegistry} from "../src/tee/TEERegistry.sol";

/**
 * @title DeployTEE
 * @notice Deploy TEE attestation verification contracts
 * @dev Run with:
 *   forge script script/DeployTEE.s.sol:DeployTEE --rpc-url $RPC_URL --broadcast
 */
contract DeployTEE is Script {
    // Configuration
    uint256 public constant MIN_ATTESTATION_STAKE = 0.1 ether;
    uint256 public constant MIN_CHALLENGE_STAKE = 0.05 ether;
    uint256 public constant CHALLENGE_PERIOD = 1 hours;
    uint256 public constant DEFAULT_VALIDITY = 24 hours;

    // Deployed contracts
    UnifiedAttestationVerifier public attestationVerifier;
    TEERegistry public teeRegistry;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        
        if (deployerPrivateKey == 0) {
            // Use default anvil key for local development
            deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
            console.log("Using default anvil deployer key");
        }

        address deployer = vm.addr(deployerPrivateKey);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        
        console.log("Deployer:", deployer);
        console.log("Treasury:", treasury);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy UnifiedAttestationVerifier
        console.log("\n=== Deploying UnifiedAttestationVerifier ===");
        attestationVerifier = new UnifiedAttestationVerifier(
            deployer,           // admin
            treasury,           // treasury
            MIN_ATTESTATION_STAKE,
            MIN_CHALLENGE_STAKE,
            CHALLENGE_PERIOD,
            DEFAULT_VALIDITY
        );
        console.log("UnifiedAttestationVerifier deployed at:", address(attestationVerifier));

        // Deploy TEERegistry if it exists
        console.log("\n=== Deploying TEERegistry ===");
        teeRegistry = new TEERegistry();
        console.log("TEERegistry deployed at:", address(teeRegistry));

        // Add default trusted measurements for known TEE platforms
        _addTrustedMeasurements();

        vm.stopBroadcast();

        // Output deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("UnifiedAttestationVerifier:", address(attestationVerifier));
        console.log("TEERegistry:", address(teeRegistry));
        console.log("\nConfiguration:");
        console.log("  Min Attestation Stake:", MIN_ATTESTATION_STAKE);
        console.log("  Min Challenge Stake:", MIN_CHALLENGE_STAKE);
        console.log("  Challenge Period:", CHALLENGE_PERIOD);
        console.log("  Default Validity:", DEFAULT_VALIDITY);
    }

    function _addTrustedMeasurements() internal {
        // These are placeholder measurements - in production, these would be
        // the actual mrEnclave/mrSigner values from verified builds

        // Intel TDX measurement placeholder
        bytes32 tdxMrEnclave = keccak256("jeju-tee-runtime-v1-tdx");
        bytes32 tdxMrSigner = keccak256("jeju-network-signer");
        
        attestationVerifier.addTrustedMeasurement(
            tdxMrEnclave,
            tdxMrSigner,
            UnifiedAttestationVerifier.TEEPlatform.INTEL_TDX,
            "Jeju TEE Runtime v1 (TDX)"
        );
        console.log("Added TDX measurement:", vm.toString(tdxMrEnclave));

        // Intel SGX measurement placeholder
        bytes32 sgxMrEnclave = keccak256("jeju-tee-runtime-v1-sgx");
        bytes32 sgxMrSigner = keccak256("jeju-network-signer");
        
        attestationVerifier.addTrustedMeasurement(
            sgxMrEnclave,
            sgxMrSigner,
            UnifiedAttestationVerifier.TEEPlatform.INTEL_SGX,
            "Jeju TEE Runtime v1 (SGX)"
        );
        console.log("Added SGX measurement:", vm.toString(sgxMrEnclave));

        // Phala measurement placeholder
        bytes32 phalaMrEnclave = keccak256("jeju-tee-runtime-v1-phala");
        bytes32 phalaMrSigner = keccak256("phala-network-signer");
        
        attestationVerifier.addTrustedMeasurement(
            phalaMrEnclave,
            phalaMrSigner,
            UnifiedAttestationVerifier.TEEPlatform.PHALA,
            "Jeju TEE Runtime v1 (Phala)"
        );
        console.log("Added Phala measurement:", vm.toString(phalaMrEnclave));
    }
}
