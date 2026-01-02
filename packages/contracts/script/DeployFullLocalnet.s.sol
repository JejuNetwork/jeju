// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {L1StakeManager} from "../src/bridge/eil/L1StakeManager.sol";
import {CrossChainPaymasterUpgradeable} from "../src/bridge/eil/CrossChainPaymasterUpgradeable.sol";
import {ERC1967Proxy} from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployFullLocalnet
 * @notice Deploys complete ERC-4337 + EIL stack for local testing
 */
contract DeployFullLocalnet is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("=== FULL LOCALNET DEPLOYMENT ===");
        console2.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy EntryPoint
        EntryPoint entryPoint = new EntryPoint();
        console2.log("EntryPoint:", address(entryPoint));

        // 2. Deploy L1StakeManager
        L1StakeManager l1StakeManager = new L1StakeManager();
        console2.log("L1StakeManager:", address(l1StakeManager));

        // 3. Deploy MockMessenger
        MockMessenger messenger = new MockMessenger();
        console2.log("MockMessenger:", address(messenger));

        // 4. Configure L1StakeManager
        l1StakeManager.setMessenger(address(messenger));

        // 5. Deploy CrossChainPaymasterUpgradeable (implementation)
        CrossChainPaymasterUpgradeable paymasterImpl = new CrossChainPaymasterUpgradeable();
        console2.log("PaymasterImpl:", address(paymasterImpl));

        // 6. Deploy proxy and initialize
        bytes memory initData = abi.encodeCall(
            CrossChainPaymasterUpgradeable.initialize,
            (deployer, block.chainid, address(l1StakeManager), address(entryPoint))
        );
        ERC1967Proxy paymasterProxy = new ERC1967Proxy(address(paymasterImpl), initData);
        CrossChainPaymasterUpgradeable paymaster = CrossChainPaymasterUpgradeable(payable(address(paymasterProxy)));
        console2.log("CrossChainPaymaster:", address(paymaster));

        // 7. Configure paymaster messenger
        paymaster.setL2Messenger(address(messenger));

        // 8. Register paymaster with L1StakeManager
        l1StakeManager.registerL2Paymaster(block.chainid, address(paymaster));
        console2.log("Registered paymaster for chain", block.chainid);

        // 9. Configure messenger targets
        messenger.setTargets(address(l1StakeManager), address(paymaster));

        vm.stopBroadcast();

        // Output JSON
        console2.log("");
        console2.log("=== DEPLOYMENT OUTPUT ===");
        console2.log("{");
        console2.log('  "entryPoint": "%s",', address(entryPoint));
        console2.log('  "l1StakeManager": "%s",', address(l1StakeManager));
        console2.log('  "mockMessenger": "%s",', address(messenger));
        console2.log('  "crossChainPaymaster": "%s"', address(paymaster));
        console2.log("}");
    }
}

/**
 * @title MockMessenger
 * @notice Simulates L1<>L2 cross-domain messaging for local testing
 */
contract MockMessenger {
    address public l1Target;
    address public l2Target;
    address public xDomainMessageSender;

    function setTargets(address _l1Target, address _l2Target) external {
        l1Target = _l1Target;
        l2Target = _l2Target;
    }

    function sendMessage(address target, bytes calldata message, uint32) external {
        xDomainMessageSender = msg.sender;
        (bool success,) = target.call(message);
        require(success, "Message relay failed");
        xDomainMessageSender = address(0);
    }
}


