// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

// EIL Components
import {L1StakeManager} from "../src/bridge/eil/L1StakeManager.sol";
import {CrossChainPaymasterUpgradeable} from "../src/bridge/eil/CrossChainPaymasterUpgradeable.sol";
import {ERC1967Proxy} from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";

/**
 * @title DeployTestnetCrossChain
 * @notice Deploy L1StakeManager on Sepolia and CrossChainPaymaster on OP Sepolia
 * @dev This is a MULTI-STEP deployment process:
 *
 * Step 1: Deploy L1StakeManager on Sepolia (L1)
 *   forge script script/DeployTestnetCrossChain.s.sol:DeployL1 \
 *     --rpc-url sepolia --broadcast --verify -vvvv
 *
 * Step 2: Deploy CrossChainPaymaster on OP Sepolia (L2)
 *   L1_STAKE_MANAGER=<from step 1> forge script script/DeployTestnetCrossChain.s.sol:DeployL2 \
 *     --rpc-url optimism_sepolia --broadcast --verify -vvvv
 *
 * Step 3: Configure L1StakeManager (on Sepolia)
 *   CROSS_CHAIN_PAYMASTER=<from step 2> forge script script/DeployTestnetCrossChain.s.sol:ConfigureL1 \
 *     --rpc-url sepolia --broadcast -vvvv
 *
 * Step 4: Configure CrossChainPaymaster (on OP Sepolia)
 *   forge script script/DeployTestnetCrossChain.s.sol:ConfigureL2 \
 *     --rpc-url optimism_sepolia --broadcast -vvvv
 *
 * The real OP Stack bridge addresses:
 * - Sepolia L1CrossDomainMessenger: 0x58Cc85b8D04EA49cC6DBd3CbFFd00B4B8D6cb3ef
 * - OP Sepolia L2CrossDomainMessenger: 0x4200000000000000000000000000000000000007
 */

// ============================================
// CONSTANTS
// ============================================
abstract contract TestnetConstants {
    // Sepolia (L1) - chainId: 11155111
    address constant L1_CROSS_DOMAIN_MESSENGER = 0x58Cc85b8D04EA49cC6DBd3CbFFd00B4B8D6cb3ef;
    uint256 constant SEPOLIA_CHAIN_ID = 11155111;

    // OP Sepolia (L2) - chainId: 11155420
    address constant L2_CROSS_DOMAIN_MESSENGER = 0x4200000000000000000000000000000000000007;
    uint256 constant OP_SEPOLIA_CHAIN_ID = 11155420;

    // Canonical EntryPoint v0.6 (deployed on all chains)
    address constant ENTRY_POINT_V06 = 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789;
    
    // Canonical EntryPoint v0.7 (deployed on most chains)
    address constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
}

// ============================================
// STEP 1: Deploy on Sepolia (L1)
// ============================================
contract DeployL1 is Script, TestnetConstants {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(deployerPrivateKey != 0, "PRIVATE_KEY required");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("====================================");
        console2.log("  STEP 1: L1 STAKE MANAGER");
        console2.log("  Network: Sepolia");
        console2.log("====================================");
        console2.log("Deployer:", deployer);
        console2.log("L1 Messenger:", L1_CROSS_DOMAIN_MESSENGER);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy L1StakeManager
        L1StakeManager l1StakeManager = new L1StakeManager();
        console2.log("L1StakeManager deployed:", address(l1StakeManager));

        // Set the OP Stack L1CrossDomainMessenger
        l1StakeManager.setMessenger(L1_CROSS_DOMAIN_MESSENGER);
        console2.log("Messenger configured");

        vm.stopBroadcast();

        console2.log("");
        console2.log("Next: Deploy L2 with:");
        console2.log("  L1_STAKE_MANAGER=%s", address(l1StakeManager));
    }
}

// ============================================
// STEP 2: Deploy on OP Sepolia (L2)
// ============================================
contract DeployL2 is Script, TestnetConstants {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(deployerPrivateKey != 0, "PRIVATE_KEY required");
        
        address deployer = vm.addr(deployerPrivateKey);
        address l1StakeManager = vm.envAddress("L1_STAKE_MANAGER");
        require(l1StakeManager != address(0), "L1_STAKE_MANAGER required");

        console2.log("====================================");
        console2.log("  STEP 2: CROSSCHAIN PAYMASTER");
        console2.log("  Network: OP Sepolia");
        console2.log("====================================");
        console2.log("Deployer:", deployer);
        console2.log("L1StakeManager:", l1StakeManager);
        console2.log("L2 Messenger:", L2_CROSS_DOMAIN_MESSENGER);
        console2.log("EntryPoint:", ENTRY_POINT_V07);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy implementation
        CrossChainPaymasterUpgradeable impl = new CrossChainPaymasterUpgradeable();
        console2.log("Implementation:", address(impl));

        // Deploy proxy with initialization
        bytes memory initData = abi.encodeCall(
            CrossChainPaymasterUpgradeable.initialize,
            (deployer, SEPOLIA_CHAIN_ID, l1StakeManager, ENTRY_POINT_V07)
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        CrossChainPaymasterUpgradeable paymaster = CrossChainPaymasterUpgradeable(payable(address(proxy)));
        console2.log("Proxy:", address(proxy));

        // Set L2 messenger
        paymaster.setL2Messenger(L2_CROSS_DOMAIN_MESSENGER);
        console2.log("L2 Messenger configured");

        // Deploy PriceOracle
        PriceOracle oracle = new PriceOracle();
        console2.log("PriceOracle:", address(oracle));

        // Set initial prices (ETH = $3000, example)
        oracle.setPrice(address(0), 3000e8, 8); // ETH price in USD
        
        // Set oracle on paymaster
        paymaster.setPriceOracle(address(oracle));
        console2.log("Oracle configured");

        // Fund paymaster in EntryPoint
        if (deployer.balance > 0.5 ether) {
            paymaster.depositToEntryPoint{value: 0.1 ether}();
            console2.log("Funded EntryPoint with 0.1 ETH");
        }

        vm.stopBroadcast();

        console2.log("");
        console2.log("CrossChainPaymaster:", address(paymaster));
        console2.log("PriceOracle:", address(oracle));
        console2.log("");
        console2.log("Next: Configure L1 with:");
        console2.log("  CROSS_CHAIN_PAYMASTER=%s", address(paymaster));
    }
}

// ============================================
// STEP 3: Configure L1StakeManager (on Sepolia)
// ============================================
contract ConfigureL1 is Script, TestnetConstants {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(deployerPrivateKey != 0, "PRIVATE_KEY required");

        address l1StakeManager = vm.envAddress("L1_STAKE_MANAGER");
        address crossChainPaymaster = vm.envAddress("CROSS_CHAIN_PAYMASTER");
        require(l1StakeManager != address(0), "L1_STAKE_MANAGER required");
        require(crossChainPaymaster != address(0), "CROSS_CHAIN_PAYMASTER required");

        console2.log("====================================");
        console2.log("  STEP 3: CONFIGURE L1");
        console2.log("  Network: Sepolia");
        console2.log("====================================");
        console2.log("L1StakeManager:", l1StakeManager);
        console2.log("CrossChainPaymaster:", crossChainPaymaster);

        vm.startBroadcast(deployerPrivateKey);

        L1StakeManager manager = L1StakeManager(payable(l1StakeManager));

        // Register OP Sepolia chain and paymaster
        manager.registerL2Paymaster(OP_SEPOLIA_CHAIN_ID, crossChainPaymaster);
        console2.log("L2 Paymaster registered for chain:", OP_SEPOLIA_CHAIN_ID);

        vm.stopBroadcast();

        console2.log("");
        console2.log("L1 Configuration complete.");
        console2.log("Next: Register as XLP and sync stake.");
    }
}

// ============================================
// STEP 4: Register as XLP (on Sepolia)
// ============================================
contract RegisterXLP is Script, TestnetConstants {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(deployerPrivateKey != 0, "PRIVATE_KEY required");

        address l1StakeManager = vm.envAddress("L1_STAKE_MANAGER");
        require(l1StakeManager != address(0), "L1_STAKE_MANAGER required");

        uint256 stakeAmount = vm.envOr("STAKE_AMOUNT", uint256(1 ether));
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("====================================");
        console2.log("  STEP 4: REGISTER AS XLP");
        console2.log("  Network: Sepolia");
        console2.log("====================================");
        console2.log("L1StakeManager:", l1StakeManager);
        console2.log("Stake Amount:", stakeAmount);
        console2.log("XLP Address:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        L1StakeManager manager = L1StakeManager(payable(l1StakeManager));

        // Register with OP Sepolia
        uint256[] memory chains = new uint256[](1);
        chains[0] = OP_SEPOLIA_CHAIN_ID;

        manager.register{value: stakeAmount}(chains);
        console2.log("Registered as XLP with", stakeAmount, "wei stake");

        // Sync stake to L2
        manager.syncStakeToL2(OP_SEPOLIA_CHAIN_ID, deployer);
        console2.log("Stake sync initiated to OP Sepolia");

        vm.stopBroadcast();

        console2.log("");
        console2.log("XLP Registration complete.");
        console2.log("Wait ~15 minutes for L1->L2 message to arrive.");
        console2.log("Then check stake on L2 with:");
        console2.log("  cast call <CROSS_CHAIN_PAYMASTER> 'xlpStakes(address)(uint256)' <YOUR_ADDRESS>");
    }
}

// ============================================
// STEP 5: Deposit Liquidity (on OP Sepolia)
// ============================================
contract DepositLiquidity is Script, TestnetConstants {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(deployerPrivateKey != 0, "PRIVATE_KEY required");

        address crossChainPaymaster = vm.envAddress("CROSS_CHAIN_PAYMASTER");
        require(crossChainPaymaster != address(0), "CROSS_CHAIN_PAYMASTER required");

        uint256 depositAmount = vm.envOr("DEPOSIT_AMOUNT", uint256(1 ether));

        console2.log("====================================");
        console2.log("  STEP 5: DEPOSIT LIQUIDITY");
        console2.log("  Network: OP Sepolia");
        console2.log("====================================");
        console2.log("CrossChainPaymaster:", crossChainPaymaster);
        console2.log("Deposit Amount:", depositAmount);

        vm.startBroadcast(deployerPrivateKey);

        CrossChainPaymasterUpgradeable paymaster = CrossChainPaymasterUpgradeable(payable(crossChainPaymaster));

        // Deposit ETH liquidity
        paymaster.depositETH{value: depositAmount}();
        console2.log("Deposited", depositAmount, "wei as ETH liquidity");

        vm.stopBroadcast();

        console2.log("");
        console2.log("Liquidity deposit complete.");
        console2.log("You can now sponsor UserOperations on OP Sepolia.");
    }
}

// ============================================
// VERIFICATION SCRIPT
// ============================================
contract VerifyDeployment is Script, TestnetConstants {
    function run() external view {
        address l1StakeManager = vm.envAddress("L1_STAKE_MANAGER");
        address crossChainPaymaster = vm.envAddress("CROSS_CHAIN_PAYMASTER");
        address xlpAddress = vm.envOr("XLP_ADDRESS", address(0));

        console2.log("====================================");
        console2.log("  DEPLOYMENT VERIFICATION");
        console2.log("====================================");

        if (l1StakeManager != address(0)) {
            console2.log("L1StakeManager:", l1StakeManager);
            // Additional verification would require RPC calls
        }

        if (crossChainPaymaster != address(0)) {
            console2.log("CrossChainPaymaster:", crossChainPaymaster);
        }

        if (xlpAddress != address(0)) {
            console2.log("XLP Address:", xlpAddress);
        }

        console2.log("");
        console2.log("Manual verification steps:");
        console2.log("1. Check L1StakeManager on Sepolia Etherscan");
        console2.log("2. Check CrossChainPaymaster on OP Sepolia Etherscan");
        console2.log("3. Verify XLP stake was synced to L2");
        console2.log("4. Test UserOp sponsorship");
    }
}
