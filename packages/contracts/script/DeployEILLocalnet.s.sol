// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {L1StakeManager} from "../src/bridge/eil/L1StakeManager.sol";
import {CrossChainPaymaster} from "../src/bridge/eil/CrossChainPaymaster.sol";
import {X402Facilitator} from "../src/x402/X402Facilitator.sol";
import {X402IntentBridge} from "../src/x402/X402IntentBridge.sol";

/**
 * @title DeployEILLocalnet
 * @notice Deploys Ethereum Interop Layer (EIL) contracts for local development
 * @dev Usage: forge script script/DeployEILLocalnet.s.sol --rpc-url http://localhost:6546 --broadcast
 *
 * This deploys the complete EIL + X402 stack for testing cross-chain gas sponsorship locally.
 * In production, L1StakeManager lives on L1 (Ethereum) and CrossChainPaymaster on L2s.
 * For local testing, we deploy both on the same chain with a mock messenger.
 *
 * Components:
 * - L1StakeManager: XLP staking and voucher management (simulates L1)
 * - CrossChainPaymaster: ERC-4337 paymaster with cross-chain gas sponsorship
 * - X402Facilitator: Gasless payment settlement via EIP-3009
 * - X402IntentBridge: Bridges X402 payments to OIF intents
 */
contract DeployEILLocalnet is Script {
    function run() external {
        // Default to Anvil's first test account if no key provided
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);

        // Get contract addresses from environment or use zeros for fresh deployment
        address entryPoint = vm.envOr("ENTRY_POINT", address(0xF6733AB90988c457a5Ac360D7f8dfB9E24aA108F));
        address usdc = vm.envOr("USDC", address(0x407DD50f9c614f773E62f6c4041418186ad4b2a9));
        address oifOracle = vm.envOr("OIF_ORACLE", address(0));

        console2.log("=== EIL LOCALNET DEPLOYMENT ===");
        console2.log("Deployer:", deployer);
        console2.log("EntryPoint:", entryPoint);
        console2.log("USDC:", usdc);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy L1StakeManager (simulating L1 contract locally)
        L1StakeManager l1StakeManager = new L1StakeManager();
        console2.log("L1StakeManager:", address(l1StakeManager));

        // 2. Deploy MockMessenger for local L1<>L2 communication
        MockL1L2Messenger messenger = new MockL1L2Messenger();
        console2.log("MockL1L2Messenger:", address(messenger));

        // 3. Configure L1StakeManager with messenger
        l1StakeManager.setMessenger(address(messenger));

        // 4. Deploy CrossChainPaymaster with full constructor args
        address priceOracle = vm.envOr("PRICE_ORACLE", address(0x5d67Aa374909D7Fadf88389ba4f635469f1c12BF));
        CrossChainPaymaster paymaster = new CrossChainPaymaster(
            IEntryPoint(entryPoint),
            address(l1StakeManager),
            block.chainid,
            priceOracle,
            deployer
        );
        console2.log("CrossChainPaymaster:", address(paymaster));

        // 5. Configure paymaster messenger for local testing
        paymaster.setMessenger(address(messenger));

        // 6. Register the paymaster with L1StakeManager
        l1StakeManager.registerL2Paymaster(block.chainid, address(paymaster));
        console2.log("Registered paymaster for chain", block.chainid);

        // 7. Configure mock messenger targets
        messenger.setTargets(address(l1StakeManager), address(paymaster));

        // 8. Create chain array for XLP registration
        uint256[] memory supportedChains = new uint256[](1);
        supportedChains[0] = block.chainid;

        // 9. Register deployer as XLP with 1 ETH stake (MIN_STAKE requirement)
        l1StakeManager.register{value: 1 ether}(supportedChains);
        console2.log("Registered deployer as XLP with 1 ETH stake");

        // 8. Deploy X402 Facilitator for gasless payments
        address[] memory supportedTokens = new address[](1);
        supportedTokens[0] = usdc;
        X402Facilitator x402Facilitator = new X402Facilitator(deployer, deployer, supportedTokens);
        x402Facilitator.setTokenDecimals(usdc, 6);
        console2.log("X402Facilitator:", address(x402Facilitator));

        // 9. Deploy X402IntentBridge if OIF oracle is configured
        address x402IntentBridge = address(0);
        if (oifOracle != address(0)) {
            X402IntentBridge bridge = new X402IntentBridge(address(x402Facilitator), oifOracle, deployer);
            bridge.registerSolver(deployer, true);
            x402IntentBridge = address(bridge);
            console2.log("X402IntentBridge:", x402IntentBridge);
        }

        vm.stopBroadcast();

        // Output JSON for deployment tracking
        console2.log("");
        console2.log("=== DEPLOYMENT OUTPUT ===");
        console2.log("{");
        console2.log('  "l1StakeManager": "%s",', address(l1StakeManager));
        console2.log('  "mockMessenger": "%s",', address(messenger));
        console2.log('  "crossChainPaymaster": "%s",', address(paymaster));
        console2.log('  "x402Facilitator": "%s",', address(x402Facilitator));
        console2.log('  "x402IntentBridge": "%s"', x402IntentBridge);
        console2.log("}");
    }
}

/**
 * @title MockL1L2Messenger
 * @notice Mock cross-domain messenger for local testing
 * @dev Simulates OP Stack's L1CrossDomainMessenger for local development
 *
 * In production:
 * - L1 messages go through OptimismPortal -> L2CrossDomainMessenger
 * - L2 messages go through L2ToL1MessagePasser -> OptimismPortal
 *
 * For local testing, this contract directly relays messages between
 * L1StakeManager and CrossChainPaymaster on the same chain.
 */
contract MockL1L2Messenger {
    address public l1Target; // L1StakeManager
    address public l2Target; // CrossChainPaymaster
    address public xDomainMessageSender;

    event MessageRelayed(address indexed target, bytes data);

    function setTargets(address _l1Target, address _l2Target) external {
        l1Target = _l1Target;
        l2Target = _l2Target;
    }

    /**
     * @notice Simulate L1 -> L2 message (from L1StakeManager to CrossChainPaymaster)
     */
    function sendMessage(address target, bytes calldata message, uint32 /* gasLimit */ ) external {
        xDomainMessageSender = msg.sender;

        // Direct call for local testing
        (bool success,) = target.call(message);
        require(success, "Message relay failed");

        emit MessageRelayed(target, message);

        xDomainMessageSender = address(0);
    }

    /**
     * @notice Returns the sender of the current cross-domain message
     */
    function getCrossDomainMessageSender() external view returns (address) {
        return xDomainMessageSender;
    }
}
