// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {LiquidityPaymaster} from "../src/paymaster/LiquidityPaymaster.sol";
import {ManualPriceOracle} from "../src/oracle/ManualPriceOracle.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/registry/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/registry/ValidationRegistry.sol";

// Mock EntryPoint for localnet
contract MockEntryPoint {
    mapping(address => uint256) public balances;

    function depositTo(address account) external payable {
        balances[account] += msg.value;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function withdrawTo(address payable dest, uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        (bool success,) = dest.call{value: amount}("");
        require(success, "Transfer failed");
    }

    function addStake(uint32) external payable {}
    function unlockStake() external {}
    function withdrawStake(address payable) external {}

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }

    receive() external payable {}
}

/**
 * @title DeployLiquiditySystem
 * @notice Deploys complete LP-powered paymaster system
 * @dev Fixed all critical bugs:
 *      - Proper reward distribution
 *      - Correct paymasterAndData parsing
 *      - Chainlink staleness checks
 *      - EntryPoint deposit management
 */
contract DeployLiquiditySystem is Script {
    // EntryPoint v0.7 address (same across all EVM chains)
    address constant ENTRYPOINT_MAINNET = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    struct DeploymentAddresses {
        address elizaOS;
        address liquidityVault;
        address feeDistributor;
        address priceOracle;
        address paymaster;
        address entryPoint;
        address identityRegistry;
        address reputationRegistry;
        address validationRegistry;
    }

    function run() external returns (DeploymentAddresses memory) {
        // Get deployment parameters
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);
        string memory network = vm.envOr("NETWORK", string("localnet"));

        console.log("==========================================");
        console.log("Deploying Liquidity Paymaster System");
        console.log("==========================================");
        console.log("Network:", network);
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        DeploymentAddresses memory addresses;

        // 0. Deploy or use existing EntryPoint
        bool isLocalnet = keccak256(bytes(network)) == keccak256(bytes("localnet"));
        if (isLocalnet) {
            console.log("\n[0/5] Deploying Mock EntryPoint for localnet...");
            MockEntryPoint mockEP = new MockEntryPoint();
            addresses.entryPoint = address(mockEP);
            console.log("   EntryPoint:", addresses.entryPoint);
        } else {
            addresses.entryPoint = ENTRYPOINT_MAINNET;
            console.log("\nUsing EntryPoint:", addresses.entryPoint);
        }

        // 1. Deploy or use existing elizaOS token
        address elizaOSAddress = address(0); // Always deploy for localnet
        if (elizaOSAddress == address(0)) {
            console.log("\n[1/5] Deploying elizaOS Token...");
            ElizaOSToken eliza = new ElizaOSToken(deployer);
            addresses.elizaOS = address(eliza);
            console.log("   Address:", addresses.elizaOS);
        } else {
            addresses.elizaOS = elizaOSAddress;
            console.log("\n[1/5] Using existing elizaOS:", addresses.elizaOS);
        }

        // 2. Deploy Price Oracle
        console.log("\n[2/5] Deploying Manual Price Oracle...");

        // Initial prices with 8 decimals (like Chainlink format)
        uint256 initialETHPrice = vm.envOr("INITIAL_ETH_PRICE", uint256(300000000000)); // $3,000
        uint256 initialElizaPrice = vm.envOr("INITIAL_ELIZA_PRICE", uint256(10000000)); // $0.10

        ManualPriceOracle oracle = new ManualPriceOracle(initialETHPrice, initialElizaPrice, deployer);
        addresses.priceOracle = address(oracle);
        console.log("   Oracle:", addresses.priceOracle);
        console.log("   ETH Price: $", initialETHPrice / 1e8);
        console.log("   elizaOS Price: $", initialElizaPrice / 1e8);

        // 3. Deploy Liquidity Vault
        console.log("\n[3/5] Deploying Liquidity Vault...");
        LiquidityVault vault = new LiquidityVault(addresses.elizaOS, deployer);
        addresses.liquidityVault = address(vault);
        console.log("   Vault:", addresses.liquidityVault);

        // 4. Deploy Fee Distributor
        console.log("\n[4/5] Deploying Fee Distributor...");
        FeeDistributor distributor = new FeeDistributor(addresses.elizaOS, addresses.liquidityVault, deployer);
        addresses.feeDistributor = address(distributor);
        console.log("   Distributor:", addresses.feeDistributor);

        // 5. Deploy Liquidity Paymaster
        console.log("\n[5/8] Deploying Liquidity Paymaster...");
        LiquidityPaymaster paymaster = new LiquidityPaymaster(
            IEntryPoint(addresses.entryPoint),
            addresses.elizaOS,
            addresses.liquidityVault,
            addresses.feeDistributor,
            addresses.priceOracle
        );
        addresses.paymaster = address(paymaster);
        console.log("   Paymaster:", addresses.paymaster);

        // 6. Deploy ERC-8004 Registry System
        console.log("\n[6/8] Deploying Identity Registry (ERC-8004)...");
        IdentityRegistry identityRegistry = new IdentityRegistry();
        addresses.identityRegistry = address(identityRegistry);
        console.log("   Identity Registry:", addresses.identityRegistry);

        console.log("\n[7/8] Deploying Reputation & Validation Registries...");
        ReputationRegistry reputationRegistry = new ReputationRegistry(payable(addresses.identityRegistry));
        addresses.reputationRegistry = address(reputationRegistry);
        console.log("   Reputation Registry:", addresses.reputationRegistry);

        ValidationRegistry validationRegistry = new ValidationRegistry(payable(addresses.identityRegistry));
        addresses.validationRegistry = address(validationRegistry);
        console.log("   Validation Registry:", addresses.validationRegistry);

        // 8. Configure contracts
        console.log("\n[8/8] Configuring contracts...");

        // Configure vault access (both paymaster and distributor need access)
        vault.setPaymaster(addresses.paymaster); // For funding
        vault.setFeeDistributor(addresses.feeDistributor); // For fee distribution
        console.log("   [OK] Vault configured");

        // Configure distributor
        distributor.setPaymaster(addresses.paymaster);
        console.log("   [OK] Distributor configured");

        // Fund paymaster EntryPoint deposit with initial capital
        uint256 initialDeposit = vm.envOr("INITIAL_PAYMASTER_DEPOSIT", uint256(0.1 ether));
        if (address(deployer).balance >= initialDeposit) {
            paymaster.deposit{value: initialDeposit}();
            console.log("   [OK] EntryPoint deposit:", initialDeposit);
        }

        vm.stopBroadcast();

        // 7. Print summary
        printSummary(addresses, network);

        // 8. Save deployment
        saveDeployment(addresses, network);

        return addresses;
    }

    function printSummary(DeploymentAddresses memory addr, string memory /*network*/ ) internal pure {
        console.log("\n==========================================");
        console.log("DEPLOYMENT COMPLETE!");
        console.log("==========================================");
        console.log("\nPaymaster System Addresses:");
        console.log("-------------------------------------------");
        console.log("Entry Point:        ", addr.entryPoint);
        console.log("elizaOS Token:      ", addr.elizaOS);
        console.log("Liquidity Vault:    ", addr.liquidityVault);
        console.log("Fee Distributor:    ", addr.feeDistributor);
        console.log("Price Oracle:       ", addr.priceOracle);
        console.log("Liquidity Paymaster:", addr.paymaster);
        console.log("\nERC-8004 Registry System:");
        console.log("-------------------------------------------");
        console.log("Identity Registry:  ", addr.identityRegistry);
        console.log("Reputation Registry:", addr.reputationRegistry);
        console.log("Validation Registry:", addr.validationRegistry);
        console.log("==========================================");

        console.log("\nNEXT STEPS:");
        console.log("-------------------------------------------");
        console.log("1. Seed initial liquidity:");
        console.log("   LiquidityVault.addETHLiquidity{value: X}()");
        console.log("   LiquidityVault.addElizaLiquidity(amount)");
        console.log("");
        console.log("2. Fund paymaster from vault:");
        console.log("   LiquidityPaymaster.fundFromVault(amount)");
        console.log("");
        console.log("3. Update elizaOS price (for non-local):");
        console.log("   ElizaOSPriceOracle.updateElizaPrice(price)");
        console.log("");
        console.log("4. Register agents (optional):");
        console.log("   IdentityRegistry.register(tokenURI)");
        console.log("");
        console.log("5. Test with example app:");
        console.log("   Deploy SimpleGame contract");
        console.log("");
        console.log("6. View registry:");
        console.log("   Open registry viewer at http://localhost:3000");
        console.log("==========================================\n");
    }

    function saveDeployment(DeploymentAddresses memory addr, string memory network) internal {
        string memory json = "deployment";
        vm.serializeAddress(json, "elizaOS", addr.elizaOS);
        vm.serializeAddress(json, "liquidityVault", addr.liquidityVault);
        vm.serializeAddress(json, "feeDistributor", addr.feeDistributor);
        vm.serializeAddress(json, "priceOracle", addr.priceOracle);
        vm.serializeAddress(json, "entryPoint", addr.entryPoint);
        vm.serializeAddress(json, "paymaster", addr.paymaster);
        vm.serializeAddress(json, "identityRegistry", addr.identityRegistry);
        vm.serializeAddress(json, "reputationRegistry", addr.reputationRegistry);
        string memory finalJson = vm.serializeAddress(json, "validationRegistry", addr.validationRegistry);

        string memory path = string.concat("deployments/", network, "/liquidity-system.json");
        vm.writeJson(finalJson, path);
        console.log("\nSaved to:", path);
    }
}
