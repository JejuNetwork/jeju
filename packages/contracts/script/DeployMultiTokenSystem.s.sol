// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {MockCLANKER} from "../src/tokens/MockCLANKER.sol";
import {MockVIRTUAL} from "../src/tokens/MockVIRTUAL.sol";
import {MockClankermon} from "../src/tokens/MockClankermon.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {LiquidityPaymaster} from "../src/paymaster/LiquidityPaymaster.sol";
import {ManualPriceOracle} from "../src/oracle/ManualPriceOracle.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title DeployMultiTokenSystem
 * @notice Deploy complete paymaster infrastructure for ALL supported tokens in one script
 * @dev Deploys for: elizaOS, CLANKER, VIRTUAL, CLANKERMON
 *
 * For each token, deploys:
 * - LiquidityVault (ETH + token pools)
 * - FeeDistributor (45% apps, 45% LPs, 10% contributors)
 * - LiquidityPaymaster (ERC-4337 gas sponsorship)
 *
 * Also deploys:
 * - Shared PriceOracle (all tokens)
 * - Mock tokens (localnet only)
 * - EntryPoint (localnet only)
 *
 * Usage:
 *   forge script script/DeployMultiTokenSystem.s.sol:DeployMultiTokenSystem \
 *     --rpc-url http://localhost:9545 \
 *     --broadcast
 */
contract DeployMultiTokenSystem is Script {
    struct TokenDeployment {
        address token;
        address vault;
        address distributor;
        address paymaster;
        string symbol;
    }

    struct AllDeployments {
        address oracle;
        address entryPoint;
        TokenDeployment elizaOS;
        TokenDeployment clanker;
        TokenDeployment virtualProtocol;
        TokenDeployment clankermon;
    }

    function run() external returns (AllDeployments memory) {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);
        string memory network = vm.envOr("NETWORK", string("localnet"));
        bool isLocalnet = keccak256(bytes(network)) == keccak256(bytes("localnet"));

        console.log("============================================================");
        console.log("MULTI-TOKEN PAYMASTER SYSTEM DEPLOYMENT");
        console.log("============================================================");
        console.log("Network:", network);
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        AllDeployments memory deployments;

        // 1. Deploy EntryPoint (localnet only)
        console.log("[1/13] Deploying EntryPoint...");
        if (isLocalnet) {
            MockEntryPoint ep = new MockEntryPoint();
            deployments.entryPoint = address(ep);
        } else {
            deployments.entryPoint = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
        }
        console.log("   EntryPoint:", deployments.entryPoint);
        console.log("");

        // 2. Deploy Tokens (localnet only)
        address elizaAddress;
        address clankerAddress;
        address virtualAddress;
        address clankermonAddress;

        if (isLocalnet) {
            console.log("[2/13] Deploying Mock Tokens...");

            ElizaOSToken eliza = new ElizaOSToken(deployer);
            elizaAddress = address(eliza);
            console.log("   elizaOS:", elizaAddress);

            MockCLANKER clanker = new MockCLANKER(deployer);
            clankerAddress = address(clanker);
            console.log("   CLANKER:", clankerAddress);

            MockVIRTUAL virtualToken = new MockVIRTUAL(deployer);
            virtualAddress = address(virtualToken);
            console.log("   VIRTUAL:", virtualAddress);

            MockClankermon clankermon = new MockClankermon(deployer);
            clankermonAddress = address(clankermon);
            console.log("   CLANKERMON:", clankermonAddress);
        } else {
            // Use existing tokens on testnet/mainnet
            elizaAddress = vm.envAddress("ELIZAOS_TOKEN_ADDRESS");
            clankerAddress = vm.envAddress("CLANKER_TOKEN_ADDRESS");
            virtualAddress = vm.envAddress("VIRTUAL_TOKEN_ADDRESS");
            clankermonAddress = vm.envAddress("CLANKERMON_TOKEN_ADDRESS");
        }
        console.log("");

        // 3. Deploy Oracle
        console.log("[3/13] Deploying PriceOracle...");
        ManualPriceOracle oracle = new ManualPriceOracle(
            300000000000, // ETH = $3000
            10000000, // elizaOS = $0.10
            deployer
        );
        deployments.oracle = address(oracle);
        console.log("   Oracle:", deployments.oracle);
        console.log("");

        // 4-7. Deploy elizaOS system
        console.log("[4/13] Deploying elizaOS Paymaster System...");
        deployments.elizaOS =
            deployForToken(elizaAddress, deployments.oracle, deployments.entryPoint, deployer, "elizaOS");

        // 8-10. Deploy CLANKER system
        console.log("[5/13] Deploying CLANKER Paymaster System...");
        deployments.clanker =
            deployForToken(clankerAddress, deployments.oracle, deployments.entryPoint, deployer, "CLANKER");

        // 11-13. Deploy VIRTUAL system
        console.log("[6/13] Deploying VIRTUAL Paymaster System...");
        deployments.virtualProtocol =
            deployForToken(virtualAddress, deployments.oracle, deployments.entryPoint, deployer, "VIRTUAL");

        // 14-16. Deploy CLANKERMON system
        console.log("[7/13] Deploying CLANKERMON Paymaster System...");
        deployments.clankermon =
            deployForToken(clankermonAddress, deployments.oracle, deployments.entryPoint, deployer, "CLANKERMON");

        vm.stopBroadcast();

        // Print summary
        printFullSummary(deployments);

        // Save deployments
        saveAllDeployments(deployments, network);

        return deployments;
    }

    function deployForToken(
        address tokenAddress,
        address oracleAddress,
        address entryPoint,
        address deployer,
        string memory symbol
    ) internal returns (TokenDeployment memory) {
        TokenDeployment memory deployment;
        deployment.token = tokenAddress;
        deployment.symbol = symbol;

        // Deploy vault
        LiquidityVault vault = new LiquidityVault(tokenAddress, deployer);
        deployment.vault = address(vault);

        // Deploy distributor
        FeeDistributor distributor = new FeeDistributor(tokenAddress, address(vault), deployer);
        deployment.distributor = address(distributor);

        // Deploy paymaster
        LiquidityPaymaster paymaster = new LiquidityPaymaster(
            IEntryPoint(entryPoint), tokenAddress, address(vault), address(distributor), oracleAddress
        );
        deployment.paymaster = address(paymaster);

        // Configure
        vault.setPaymaster(address(paymaster));
        vault.setFeeDistributor(address(distributor));
        distributor.setPaymaster(address(paymaster));

        // Fund with 1 ETH
        if (address(this).balance >= 1 ether) {
            paymaster.deposit{value: 1 ether}();
        }

        console.log("   ", symbol, "Paymaster:", deployment.paymaster);
        console.log("");

        return deployment;
    }

    function printFullSummary(AllDeployments memory d) internal pure {
        console.log("\n============================================================");
        console.log("ALL TOKENS DEPLOYED!");
        console.log("============================================================");
        console.log("\nShared Infrastructure:");
        console.log("-----------------------------------------------------------");
        console.log("Oracle:        ", d.oracle);
        console.log("EntryPoint:    ", d.entryPoint);

        console.log("\nelizaOS System:");
        console.log("-----------------------------------------------------------");
        console.log("Token:         ", d.elizaOS.token);
        console.log("Vault:         ", d.elizaOS.vault);
        console.log("Distributor:   ", d.elizaOS.distributor);
        console.log("Paymaster:     ", d.elizaOS.paymaster);

        console.log("\nCLANKER System:");
        console.log("-----------------------------------------------------------");
        console.log("Token:         ", d.clanker.token);
        console.log("Vault:         ", d.clanker.vault);
        console.log("Distributor:   ", d.clanker.distributor);
        console.log("Paymaster:     ", d.clanker.paymaster);

        console.log("\nVIRTUAL System:");
        console.log("-----------------------------------------------------------");
        console.log("Token:         ", d.virtualProtocol.token);
        console.log("Vault:         ", d.virtualProtocol.vault);
        console.log("Distributor:   ", d.virtualProtocol.distributor);
        console.log("Paymaster:     ", d.virtualProtocol.paymaster);

        console.log("\nCLANKERMON System:");
        console.log("-----------------------------------------------------------");
        console.log("Token:         ", d.clankermon.token);
        console.log("Vault:         ", d.clankermon.vault);
        console.log("Distributor:   ", d.clankermon.distributor);
        console.log("Paymaster:     ", d.clankermon.paymaster);
        console.log("============================================================\n");
    }

    function saveAllDeployments(AllDeployments memory d, string memory network) internal {
        string memory json = "deployments";

        // Shared
        vm.serializeAddress(json, "oracle", d.oracle);
        vm.serializeAddress(json, "entryPoint", d.entryPoint);

        // elizaOS
        vm.serializeAddress(json, "elizaOS_token", d.elizaOS.token);
        vm.serializeAddress(json, "elizaOS_vault", d.elizaOS.vault);
        vm.serializeAddress(json, "elizaOS_distributor", d.elizaOS.distributor);
        vm.serializeAddress(json, "elizaOS_paymaster", d.elizaOS.paymaster);

        // CLANKER
        vm.serializeAddress(json, "clanker_token", d.clanker.token);
        vm.serializeAddress(json, "clanker_vault", d.clanker.vault);
        vm.serializeAddress(json, "clanker_distributor", d.clanker.distributor);
        vm.serializeAddress(json, "clanker_paymaster", d.clanker.paymaster);

        // VIRTUAL
        vm.serializeAddress(json, "virtual_token", d.virtualProtocol.token);
        vm.serializeAddress(json, "virtual_vault", d.virtualProtocol.vault);
        vm.serializeAddress(json, "virtual_distributor", d.virtualProtocol.distributor);
        vm.serializeAddress(json, "virtual_paymaster", d.virtualProtocol.paymaster);

        // CLANKERMON
        vm.serializeAddress(json, "clankermon_token", d.clankermon.token);
        vm.serializeAddress(json, "clankermon_vault", d.clankermon.vault);
        vm.serializeAddress(json, "clankermon_distributor", d.clankermon.distributor);
        string memory finalJson = vm.serializeAddress(json, "clankermon_paymaster", d.clankermon.paymaster);

        string memory path = string.concat("deployments/", network, "/multi-token-system.json");
        vm.writeJson(finalJson, path);
        console.log("Saved to:", path);
    }
}

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
