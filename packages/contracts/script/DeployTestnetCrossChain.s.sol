// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

// EIL Components
import {L1StakeManager} from "../src/bridge/eil/L1StakeManager.sol";
import {CrossChainPaymasterUpgradeable} from "../src/bridge/eil/CrossChainPaymasterUpgradeable.sol";
import {ERC1967Proxy} from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployTestnetCrossChain
 * @notice Deploy L1StakeManager on Sepolia and CrossChainPaymaster on OP Sepolia
 * @dev This is a TWO-STEP deployment process:
 *
 * Step 1: Deploy L1StakeManager on Sepolia (L1)
 *   forge script script/DeployTestnetCrossChain.s.sol:DeployL1 \
 *     --rpc-url sepolia --broadcast --verify
 *
 * Step 2: Deploy CrossChainPaymaster on OP Sepolia (L2)
 *   L1_STAKE_MANAGER=<from step 1> forge script script/DeployTestnetCrossChain.s.sol:DeployL2 \
 *     --rpc-url optimism_sepolia_public --broadcast --verify
 *
 * The real OP Stack bridge addresses:
 * - Sepolia L1CrossDomainMessenger: 0x58Cc85b8D04EA49cC6DBd3CbFFd00B4B8D6cb3ef
 * - OP Sepolia L2CrossDomainMessenger: 0x4200000000000000000000000000000000000007
 */

// ============================================
// STEP 1: Deploy on Sepolia (L1)
// ============================================
contract DeployL1 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("====================================");
        console2.log("  L1 STAKE MANAGER - SEPOLIA");
        console2.log("====================================");
        console2.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        L1StakeManager l1StakeManager = new L1StakeManager();

        console2.log("");
        console2.log("L1StakeManager deployed:", address(l1StakeManager));

        vm.stopBroadcast();
    }
}

// ============================================
// STEP 2: Deploy on OP Sepolia (L2)
// ============================================
contract DeployL2 is Script {
    // OP Stack L2 addresses (standard for all OP Stack chains)
    address constant L2_CROSS_DOMAIN_MESSENGER = 0x4200000000000000000000000000000000000007;

    // v0.6 EntryPoint (canonical on all chains)
    address constant ENTRY_POINT_V06 = 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);
        address l1StakeManager = vm.envOr("L1_STAKE_MANAGER", address(0xeAd789bd8Ce8b9E94F5D0FCa99F8787c7e758817));

        console2.log("====================================");
        console2.log("  CROSSCHAIN PAYMASTER - OP SEPOLIA");
        console2.log("====================================");
        console2.log("Deployer:", deployer);
        console2.log("L1StakeManager:", l1StakeManager);
        console2.log("Messenger:", L2_CROSS_DOMAIN_MESSENGER);
        console2.log("EntryPoint:", ENTRY_POINT_V06);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy implementation
        CrossChainPaymasterUpgradeable impl = new CrossChainPaymasterUpgradeable();
        console2.log("Implementation:", address(impl));

        // Sepolia chainId = 11155111
        uint256 l1ChainId = 11155111;

        // Deploy proxy
        bytes memory initData = abi.encodeCall(
            CrossChainPaymasterUpgradeable.initialize,
            (deployer, l1ChainId, l1StakeManager, ENTRY_POINT_V06)
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        console2.log("Proxy:", address(proxy));

        // Fund the paymaster with some ETH for deposits
        CrossChainPaymasterUpgradeable paymaster = CrossChainPaymasterUpgradeable(payable(address(proxy)));

        console2.log("");
        console2.log("CrossChainPaymaster deployed:", address(paymaster));

        vm.stopBroadcast();
    }
}

// ============================================
// STEP 3: Register Chain and Sync Stake
// ============================================
contract RegisterAndSync is Script {
    function runL1(address l1StakeManager) external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));

        console2.log("Registering OP Sepolia chain on L1...");

        vm.startBroadcast(deployerPrivateKey);

        L1StakeManager manager = L1StakeManager(payable(l1StakeManager));

        // Register OP Sepolia (chainId: 11155420)
        uint256 opSepoliaChainId = 11155420;
        manager.registerChain(opSepoliaChainId);

        console2.log("Chain registered:", opSepoliaChainId);

        vm.stopBroadcast();
    }
}

