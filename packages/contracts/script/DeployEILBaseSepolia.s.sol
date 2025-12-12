// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {L1StakeManager} from "../src/eil/L1StakeManager.sol";
import {CrossChainPaymaster} from "../src/eil/CrossChainPaymaster.sol";
import {CrossChainMessagingPaymaster} from "../src/eil/CrossChainMessagingPaymaster.sol";
import {L2OutputVerifier} from "../src/eil/L2OutputVerifier.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title DeployEILBaseSepolia
 * @notice Complete EIL deployment for Base Sepolia testnet
 * @dev Deploys all EIL contracts to L1 Sepolia and Base Sepolia L2
 *
 * ## Prerequisites
 *
 * 1. Set environment variables:
 *    export PRIVATE_KEY=<your-deployer-private-key>
 *    export SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
 *    export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
 *
 * ## Deployment Order
 *
 * Run these scripts in order:
 *
 * 1. Deploy L1 contracts (on Ethereum Sepolia):
 *    forge script script/DeployEILBaseSepolia.s.sol:DeployEILL1Sepolia \
 *      --rpc-url $SEPOLIA_RPC_URL --broadcast -vvvv
 *
 * 2. Deploy L2 contracts (on Base Sepolia):
 *    L1_STAKE_MANAGER=<from-step-1> L1_OUTPUT_VERIFIER=<from-step-1> \
 *    forge script script/DeployEILBaseSepolia.s.sol:DeployEILL2BaseSepolia \
 *      --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast -vvvv
 *
 * 3. Configure L1→L2 bridge (on Ethereum Sepolia):
 *    L1_STAKE_MANAGER=<from-step-1> L2_PAYMASTER=<from-step-2> \
 *    forge script script/DeployEILBaseSepolia.s.sol:ConfigureEILL1 \
 *      --rpc-url $SEPOLIA_RPC_URL --broadcast -vvvv
 */

// ============ Official Contract Addresses ============

/// @dev Base Sepolia testnet chain ID
uint256 constant BASE_SEPOLIA_CHAIN_ID = 84532;

/// @dev Ethereum Sepolia testnet chain ID
uint256 constant SEPOLIA_CHAIN_ID = 11155111;

/// @dev ERC-4337 EntryPoint v0.7 (canonical address on all chains)
address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

/// @dev L2OutputOracle for Base Sepolia (deployed on L1 Sepolia)
address constant BASE_SEPOLIA_L2_OUTPUT_ORACLE = 0x84457ca9D0163FbC4bbfe4Dfbb20ba46e48DF254;

/// @dev L1CrossDomainMessenger for Base Sepolia (deployed on L1 Sepolia)
address constant BASE_SEPOLIA_L1_MESSENGER = 0xC34855F4De64F1840e5686e64278da901e261f20;

/// @dev L2CrossDomainMessenger (predeploy on all OP Stack L2s)
address constant L2_CROSS_DOMAIN_MESSENGER = 0x4200000000000000000000000000000000000007;

// ============ Step 1: Deploy L1 Contracts ============

/**
 * @title DeployEILL1Sepolia
 * @notice Deploys L1StakeManager and L2OutputVerifier on Ethereum Sepolia
 */
contract DeployEILL1Sepolia is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== EIL L1 Deployment (Ethereum Sepolia) ===");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        require(block.chainid == SEPOLIA_CHAIN_ID, "Must be on Sepolia");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy L1StakeManager
        L1StakeManager stakeManager = new L1StakeManager();
        console.log("L1StakeManager deployed:", address(stakeManager));

        // Set L1 Messenger
        stakeManager.setMessenger(BASE_SEPOLIA_L1_MESSENGER);
        console.log("L1 Messenger set:", BASE_SEPOLIA_L1_MESSENGER);

        // Deploy L2OutputVerifier
        L2OutputVerifier verifier = new L2OutputVerifier();
        console.log("L2OutputVerifier deployed:", address(verifier));

        // Register Base Sepolia oracle (not ZK, uses 7-day finality)
        verifier.registerOracle(BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_L2_OUTPUT_ORACLE, false);
        console.log("Base Sepolia oracle registered");

        // Set verifier on stake manager
        stakeManager.setStateRootVerifier(address(verifier));
        console.log("State root verifier configured");

        // Set unbonding period for Base Sepolia (7 days for optimistic rollup)
        stakeManager.setChainUnbondingPeriod(BASE_SEPOLIA_CHAIN_ID, 7 days);
        console.log("Unbonding period set to 7 days for Base Sepolia");

        vm.stopBroadcast();

        console.log("\n========== L1 DEPLOYMENT COMPLETE ==========");
        console.log("L1_STAKE_MANAGER=%s", address(stakeManager));
        console.log("L1_OUTPUT_VERIFIER=%s", address(verifier));
        console.log("==============================================");
        console.log("\nNext: Run DeployEILL2BaseSepolia with these addresses");
    }
}

// ============ Step 2: Deploy L2 Contracts ============

/**
 * @title DeployEILL2BaseSepolia
 * @notice Deploys CrossChainPaymaster on Base Sepolia L2
 */
contract DeployEILL2BaseSepolia is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address l1StakeManager = vm.envAddress("L1_STAKE_MANAGER");

        console.log("=== EIL L2 Deployment (Base Sepolia) ===");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);
        console.log("L1StakeManager:", l1StakeManager);

        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Must be on Base Sepolia");
        require(l1StakeManager != address(0), "L1_STAKE_MANAGER required");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy CrossChainPaymaster with real EntryPoint
        CrossChainPaymaster paymaster = new CrossChainPaymaster(
            IEntryPoint(ENTRYPOINT_V07),
            l1StakeManager,
            BASE_SEPOLIA_CHAIN_ID,
            address(0) // Price oracle (set later if needed)
        );
        console.log("CrossChainPaymaster deployed:", address(paymaster));

        // Set L2 messenger (predeploy)
        paymaster.setMessenger(L2_CROSS_DOMAIN_MESSENGER);
        console.log("L2 Messenger set:", L2_CROSS_DOMAIN_MESSENGER);

        // Enable ETH as supported token
        paymaster.setTokenSupport(address(0), true);
        console.log("ETH support enabled");

        // Deploy CrossChainMessagingPaymaster (passive fallback)
        CrossChainMessagingPaymaster messagingPaymaster = new CrossChainMessagingPaymaster(BASE_SEPOLIA_CHAIN_ID);
        console.log("CrossChainMessagingPaymaster deployed:", address(messagingPaymaster));

        messagingPaymaster.setMessenger(L2_CROSS_DOMAIN_MESSENGER);
        messagingPaymaster.setTokenSupport(address(0), true);
        console.log("Messaging paymaster configured");

        // Fund EntryPoint deposit for paymaster
        if (deployer.balance > 0.1 ether) {
            paymaster.fundEntryPoint{value: 0.05 ether}();
            console.log("EntryPoint funded with 0.05 ETH");
        }

        vm.stopBroadcast();

        console.log("\n========== L2 DEPLOYMENT COMPLETE ==========");
        console.log("CROSS_CHAIN_PAYMASTER=%s", address(paymaster));
        console.log("MESSAGING_PAYMASTER=%s", address(messagingPaymaster));
        console.log("ENTRYPOINT=%s", ENTRYPOINT_V07);
        console.log("=============================================");
        console.log("\nNext: Run ConfigureEILL1 on Sepolia with L2_PAYMASTER");
    }
}

// ============ Step 3: Configure L1→L2 Bridge ============

/**
 * @title ConfigureEILL1
 * @notice Configures L1StakeManager with L2 paymaster address
 */
contract ConfigureEILL1 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address l1StakeManager = vm.envAddress("L1_STAKE_MANAGER");
        address l2Paymaster = vm.envAddress("L2_PAYMASTER");

        console.log("=== EIL L1 Configuration (Ethereum Sepolia) ===");
        console.log("L1StakeManager:", l1StakeManager);
        console.log("L2Paymaster:", l2Paymaster);

        require(block.chainid == SEPOLIA_CHAIN_ID, "Must be on Sepolia");
        require(l1StakeManager != address(0), "L1_STAKE_MANAGER required");
        require(l2Paymaster != address(0), "L2_PAYMASTER required");

        vm.startBroadcast(deployerPrivateKey);

        L1StakeManager stakeManager = L1StakeManager(payable(l1StakeManager));

        // Register L2 paymaster
        stakeManager.registerL2Paymaster(BASE_SEPOLIA_CHAIN_ID, l2Paymaster);
        console.log("L2 Paymaster registered for Base Sepolia");

        vm.stopBroadcast();

        console.log("\n========== CONFIGURATION COMPLETE ==========");
        console.log("EIL is now configured for Base Sepolia!");
        console.log("");
        console.log("To use:");
        console.log("1. XLPs register on L1: stakeManager.register{value: 1 ether}([%s])", BASE_SEPOLIA_CHAIN_ID);
        console.log("2. XLPs deposit liquidity on L2: paymaster.depositETH{value: X}()");
        console.log("3. Users create voucher requests on L2");
        console.log("4. XLPs fulfill and earn fees");
        console.log("============================================");
    }
}

// ============ Helper: Verify Deployment ============

/**
 * @title VerifyEILDeployment
 * @notice Verifies all EIL contracts are properly configured
 */
contract VerifyEILDeployment is Script {
    function run() external view {
        address l1StakeManager = vm.envAddress("L1_STAKE_MANAGER");
        address l2Paymaster = vm.envAddress("L2_PAYMASTER");

        console.log("=== Verifying EIL Deployment ===");

        // On L1 Sepolia
        if (block.chainid == SEPOLIA_CHAIN_ID) {
            L1StakeManager stakeManager = L1StakeManager(payable(l1StakeManager));

            console.log("L1StakeManager:");
            console.log("  - Total Staked:", stakeManager.totalStaked());
            console.log("  - Active XLPs:", stakeManager.activeXLPCount());
            console.log("  - Base Sepolia Paymaster:", stakeManager.l2Paymasters(BASE_SEPOLIA_CHAIN_ID));
            console.log("  - Messenger:", address(stakeManager.messenger()));
            console.log("  - State Root Verifier:", stakeManager.stateRootVerifier());
        }
        // On Base Sepolia
        else if (block.chainid == BASE_SEPOLIA_CHAIN_ID) {
            CrossChainPaymaster paymaster = CrossChainPaymaster(payable(l2Paymaster));

            console.log("CrossChainPaymaster:");
            console.log("  - Chain ID:", paymaster.chainId());
            console.log("  - L1 Stake Manager:", paymaster.l1StakeManager());
            console.log("  - Total ETH Liquidity:", paymaster.totalETHLiquidity());
            console.log("  - ETH Supported:", paymaster.supportedTokens(address(0)));
        }
    }
}
