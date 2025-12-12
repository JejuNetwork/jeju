// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/GameTreasury.sol";
import "../contracts/UserRegistry.sol";
import "../contracts/RegistryFactory.sol";

/**
 * @title Deploy
 * @notice Deployment script for Jeju compute marketplace contracts
 * 
 * Usage:
 *   # Deploy to Sepolia with verification
 *   forge script script/Deploy.s.sol:Deploy --rpc-url sepolia --broadcast --verify
 *   
 *   # Deploy to local anvil
 *   forge script script/Deploy.s.sol:Deploy --rpc-url http://localhost:8545 --broadcast
 */
contract Deploy is Script {
    // Deployment configuration
    uint256 constant DAILY_WITHDRAWAL_LIMIT = 0.1 ether;
    uint256 constant MIN_REPUTATION = 50; // 0.5 ratio
    uint256 constant INITIAL_CREDIT = 1_000_000; // 1MB initial upload credit
    
    function run() external {
        // Get deployer private key from env
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // 1. Deploy GameTreasury
        GameTreasury treasury = new GameTreasury(DAILY_WITHDRAWAL_LIMIT);
        console.log("GameTreasury deployed at:", address(treasury));
        
        // 2. Deploy RegistryFactory (with no attestation verifier for testnet)
        RegistryFactory factory = new RegistryFactory(address(0));
        console.log("RegistryFactory deployed at:", address(factory));
        
        // 3. Deploy initial UserRegistry via factory
        address registry = factory.deployRegistry(
            deployer, // Initial tracker is deployer (will be TEE later)
            keccak256("initial-deployment"),
            abi.encode("initial-attestation"),
            MIN_REPUTATION,
            INITIAL_CREDIT
        );
        console.log("UserRegistry deployed at:", registry);
        
        // 4. Fund treasury with initial balance (optional)
        if (deployer.balance > 0.01 ether) {
            treasury.deposit{value: 0.001 ether}();
            console.log("Treasury funded with 0.001 ETH");
        }
        
        vm.stopBroadcast();
        
        // Output deployment summary
        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("GameTreasury:    ", address(treasury));
        console.log("RegistryFactory: ", address(factory));
        console.log("UserRegistry:    ", registry);
        console.log("\nUpdate these addresses in:");
        console.log("  - frontend/app.js CONFIG.contracts");
        console.log("  - src/autonomous/runner.ts (if needed)");
    }
}

/**
 * @title DeployGameTreasuryOnly
 * @notice Deploy only the GameTreasury contract
 */
contract DeployGameTreasuryOnly is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        GameTreasury treasury = new GameTreasury(0.1 ether);
        console.log("GameTreasury deployed at:", address(treasury));
        
        vm.stopBroadcast();
    }
}

/**
 * @title FundTreasury
 * @notice Fund an existing treasury contract
 */
contract FundTreasury is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasuryAddress = vm.envAddress("TREASURY_ADDRESS");
        uint256 amount = vm.envOr("AMOUNT", uint256(0.01 ether));
        
        vm.startBroadcast(deployerPrivateKey);
        
        GameTreasury treasury = GameTreasury(payable(treasuryAddress));
        treasury.deposit{value: amount}();
        
        console.log("Funded treasury with:", amount);
        console.log("New balance:", address(treasury).balance);
        
        vm.stopBroadcast();
    }
}

/**
 * @title RegisterOperator
 * @notice Register a TEE operator with the treasury
 */
contract RegisterOperator is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasuryAddress = vm.envAddress("TREASURY_ADDRESS");
        address operatorAddress = vm.envAddress("OPERATOR_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);
        
        GameTreasury treasury = GameTreasury(payable(treasuryAddress));
        
        // For testnet, use a placeholder attestation
        bytes memory attestation = abi.encode(
            block.timestamp,
            operatorAddress,
            keccak256("tee-attestation")
        );
        
        treasury.registerOperator(operatorAddress, attestation);
        
        console.log("Registered operator:", operatorAddress);
        
        vm.stopBroadcast();
    }
}

