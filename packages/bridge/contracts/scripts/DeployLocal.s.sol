// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../verifiers/Groth16Verifier.sol";
import "../bridges/SolanaLightClient.sol";
import "../bridges/CrossChainBridge.sol";
import "../tokens/CrossChainToken.sol";

/**
 * @title DeployLocal
 * @notice Deploys all contracts to local development environment
 */
contract DeployLocal is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );

        vm.startBroadcast(deployerPrivateKey);

        // Deploy Groth16 Verifier with mock verification key
        uint256[2] memory alpha = [uint256(1), uint256(2)];
        uint256[4] memory beta = [uint256(3), uint256(4), uint256(5), uint256(6)];
        uint256[4] memory gamma = [uint256(7), uint256(8), uint256(9), uint256(10)];
        uint256[4] memory delta = [uint256(11), uint256(12), uint256(13), uint256(14)];
        uint256[] memory ic = new uint256[](4);
        ic[0] = 15;
        ic[1] = 16;
        ic[2] = 17;
        ic[3] = 18;

        Groth16Verifier verifier = new Groth16Verifier(alpha, beta, gamma, delta, ic);
        console.log("Groth16Verifier deployed at:", address(verifier));

        // Deploy Solana Light Client
        SolanaLightClient lightClient = new SolanaLightClient(address(verifier));
        console.log("SolanaLightClient deployed at:", address(lightClient));

        // Initialize light client with genesis state
        lightClient.initialize(
            0,                                  // slot
            bytes32(uint256(1)),                // bank hash
            0,                                  // epoch
            bytes32(uint256(2)),                // epoch stakes root
            1000000000000000                    // total stake (1M SOL)
        );
        console.log("SolanaLightClient initialized");

        // Deploy Cross-Chain Bridge
        CrossChainBridge bridge = new CrossChainBridge(
            address(lightClient),
            address(verifier),
            0.001 ether,    // base fee
            100 wei         // fee per byte
        );
        console.log("CrossChainBridge deployed at:", address(bridge));

        // Deploy test tokens
        address deployer = vm.addr(deployerPrivateKey);

        CrossChainToken usdc = new CrossChainToken(
            "Test USD Coin",
            "USDC",
            6,
            block.chainid,
            1000000 * 10**6,
            deployer
        );
        console.log("USDC token deployed at:", address(usdc));

        CrossChainToken weth = new CrossChainToken(
            "Test Wrapped Ether",
            "WETH",
            18,
            block.chainid,
            10000 * 10**18,
            deployer
        );
        console.log("WETH token deployed at:", address(weth));

        CrossChainToken xct = new CrossChainToken(
            "Test Cross Chain Token",
            "XCT",
            18,
            block.chainid,
            100000000 * 10**18,
            deployer
        );
        console.log("XCT token deployed at:", address(xct));

        // Authorize bridge for tokens
        usdc.setBridgeAuthorization(address(bridge), true);
        weth.setBridgeAuthorization(address(bridge), true);
        xct.setBridgeAuthorization(address(bridge), true);

        // Register tokens in bridge (mock Solana addresses)
        bridge.registerToken(
            address(usdc),
            bytes32(keccak256("USDC_MINT")),
            true
        );
        bridge.registerToken(
            address(weth),
            bytes32(keccak256("WETH_MINT")),
            true
        );
        bridge.registerToken(
            address(xct),
            bytes32(keccak256("XCT_MINT")),
            true
        );

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===\n");
    }
}
