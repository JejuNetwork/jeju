// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

// OIF Components
import {SolverRegistry} from "../src/oif/SolverRegistry.sol";
import {SimpleOracle} from "../src/oif/OracleAdapter.sol";
import {InputSettler} from "../src/oif/InputSettler.sol";
import {OutputSettler} from "../src/oif/OutputSettler.sol";

// EIL Components
import {L1StakeManager} from "../src/bridge/eil/L1StakeManager.sol";
import {CrossChainPaymaster} from "../src/bridge/eil/CrossChainPaymaster.sol";

// X402 Components
import {X402Facilitator} from "../src/x402/X402Facilitator.sol";
import {X402IntentBridge} from "../src/x402/X402IntentBridge.sol";

/**
 * @title DeployCrossChainLocalnet
 * @notice Unified deployment of OIF + EIL + X402 for local cross-chain testing
 * @dev Usage:
 *   forge script script/DeployCrossChainLocalnet.s.sol \
 *     --rpc-url http://localhost:6546 \
 *     --broadcast
 *
 * This deploys the complete cross-chain infrastructure needed to test:
 * - Cross-chain purchases without bridging (via OIF intents)
 * - Gasless transactions (via X402 + EIP-3009)
 * - Multi-token gas sponsorship (via EIL + ERC-4337 paymasters)
 *
 * For a user with tokens on Base to buy on Jeju L2 without bridging:
 * 1. User signs EIP-3009 authorization for tokens on Base
 * 2. X402IntentBridge creates OIF intent
 * 3. Solver fills intent on destination (Jeju L2)
 * 4. Oracle attests fill completion
 * 5. Tokens released to solver on source chain
 *
 * Local testing simulates this with all contracts on one chain.
 */
contract DeployCrossChainLocalnet is Script {
    // Deployed addresses
    SolverRegistry public solverRegistry;
    SimpleOracle public oifOracle;
    InputSettler public inputSettler;
    OutputSettler public outputSettler;
    L1StakeManager public l1StakeManager;
    MockL1L2Messenger public messenger;
    CrossChainPaymaster public crossChainPaymaster;
    X402Facilitator public x402Facilitator;
    X402IntentBridge public x402IntentBridge;

    function run() external {
        // Default to Anvil's first test account if no key provided
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        // Get existing contract addresses from localnet deployment
        address entryPoint = vm.envOr("ENTRY_POINT", address(0xF6733AB90988c457a5Ac360D7f8dfB9E24aA108F));
        address usdc = vm.envOr("USDC", address(0x407DD50f9c614f773E62f6c4041418186ad4b2a9));
        address jeju = vm.envOr("JEJU", address(0x9Be48cB9Eb443E850316DD09cdF1c2E150b09245));

        uint256 localChainId = block.chainid;

        console2.log("====================================");
        console2.log("  CROSS-CHAIN LOCALNET DEPLOYMENT");
        console2.log("====================================");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", localChainId);
        console2.log("EntryPoint:", entryPoint);
        console2.log("USDC:", usdc);
        console2.log("JEJU:", jeju);
        console2.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ========== OIF DEPLOYMENT ==========
        console2.log("--- OIF Stack ---");

        solverRegistry = new SolverRegistry();
        console2.log("SolverRegistry:", address(solverRegistry));

        oifOracle = new SimpleOracle();
        console2.log("SimpleOracle:", address(oifOracle));

        // Authorize deployer as attester
        oifOracle.setAttester(deployer, true);

        inputSettler = new InputSettler(localChainId, address(oifOracle), address(solverRegistry));
        console2.log("InputSettler:", address(inputSettler));

        outputSettler = new OutputSettler(localChainId);
        console2.log("OutputSettler:", address(outputSettler));

        // Register deployer as solver (MIN_STAKE is 0.5 ETH)
        solverRegistry.register{value: 0.5 ether}(new uint256[](0));
        console2.log("Registered deployer as solver with 0.5 ETH stake");

        // ========== EIL DEPLOYMENT ==========
        console2.log("");
        console2.log("--- EIL Stack ---");

        l1StakeManager = new L1StakeManager();
        console2.log("L1StakeManager:", address(l1StakeManager));

        messenger = new MockL1L2Messenger();
        console2.log("MockL1L2Messenger:", address(messenger));

        l1StakeManager.setMessenger(address(messenger));

        // Get price oracle from localnet deployment (or use zero for testing)
        address priceOracle = vm.envOr("PRICE_ORACLE", address(0x5d67Aa374909D7Fadf88389ba4f635469f1c12BF));

        // Deploy CrossChainPaymaster with full constructor args
        crossChainPaymaster = new CrossChainPaymaster(
            IEntryPoint(entryPoint),
            address(l1StakeManager),
            localChainId,
            priceOracle,
            deployer
        );
        console2.log("CrossChainPaymaster:", address(crossChainPaymaster));

        // Configure messenger for local testing
        crossChainPaymaster.setMessenger(address(messenger));

        // Register L2 paymaster on L1StakeManager
        l1StakeManager.registerL2Paymaster(localChainId, address(crossChainPaymaster));
        messenger.setTargets(address(l1StakeManager), address(crossChainPaymaster));

        // Create chain array for XLP registration
        uint256[] memory supportedChains = new uint256[](1);
        supportedChains[0] = localChainId;

        // Register deployer as XLP with 1 ETH stake (MIN_STAKE)
        l1StakeManager.register{value: 1 ether}(supportedChains);
        console2.log("Registered deployer as XLP with 1 ETH stake");

        // ========== X402 DEPLOYMENT ==========
        console2.log("");
        console2.log("--- X402 Stack ---");

        address[] memory supportedTokens = new address[](2);
        supportedTokens[0] = usdc;
        supportedTokens[1] = jeju;

        x402Facilitator = new X402Facilitator(deployer, deployer, supportedTokens);
        x402Facilitator.setTokenDecimals(usdc, 6);
        x402Facilitator.setTokenDecimals(jeju, 18);
        console2.log("X402Facilitator:", address(x402Facilitator));

        x402IntentBridge = new X402IntentBridge(address(x402Facilitator), address(oifOracle), deployer);
        x402IntentBridge.registerSolver(deployer, true);
        console2.log("X402IntentBridge:", address(x402IntentBridge));

        vm.stopBroadcast();

        // ========== OUTPUT ==========
        console2.log("");
        console2.log("====================================");
        console2.log("        DEPLOYMENT COMPLETE");
        console2.log("====================================");
        console2.log("");
        console2.log("=== OIF ===");
        console2.log("solverRegistry:", address(solverRegistry));
        console2.log("oracle:", address(oifOracle));
        console2.log("inputSettler:", address(inputSettler));
        console2.log("outputSettler:", address(outputSettler));
        console2.log("");
        console2.log("=== EIL ===");
        console2.log("l1StakeManager:", address(l1StakeManager));
        console2.log("messenger:", address(messenger));
        console2.log("crossChainPaymaster:", address(crossChainPaymaster));
        console2.log("");
        console2.log("=== X402 ===");
        console2.log("facilitator:", address(x402Facilitator));
        console2.log("intentBridge:", address(x402IntentBridge));
    }
}

/**
 * @title MockL1L2Messenger
 * @notice Mock cross-domain messenger for local testing
 * @dev Simulates OP Stack's CrossDomainMessenger for local development
 */
contract MockL1L2Messenger {
    address public l1Target;
    address public l2Target;
    address public xDomainMessageSender;

    event MessageRelayed(address indexed target, bytes data);

    function setTargets(address _l1Target, address _l2Target) external {
        l1Target = _l1Target;
        l2Target = _l2Target;
    }

    function sendMessage(address target, bytes calldata message, uint32 /* gasLimit */ ) external {
        xDomainMessageSender = msg.sender;
        (bool success,) = target.call(message);
        require(success, "Message relay failed");
        emit MessageRelayed(target, message);
        xDomainMessageSender = address(0);
    }

    function getCrossDomainMessageSender() external view returns (address) {
        return xDomainMessageSender;
    }
}
