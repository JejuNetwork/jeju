// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../../src/moderation/UserBlockRegistry.sol";
import "../../src/registry/IdentityRegistry.sol";

/**
 * @title DeployUserBlockRegistry
 * @notice Deploy the UserBlockRegistry and optionally configure integrations
 *
 * Usage:
 *   forge script script/moderation/DeployUserBlockRegistry.s.sol:DeployUserBlockRegistry \
 *     --rpc-url $RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast
 *
 * Environment:
 *   IDENTITY_REGISTRY - Address of IdentityRegistry (optional)
 *   OTC_ADDRESS - Address of OTC contract to configure (optional)
 *   TOKEN_ADDRESS - Address of Token contract to configure (optional)
 *   MESSAGING_KEY_REGISTRY - Address of MessagingKeyRegistry (optional)
 *   MARKETPLACE_ADDRESS - Address of Marketplace (optional)
 *   X402_FACILITATOR - Address of X402Facilitator (optional)
 *   PLAYER_TRADE_ESCROW - Address of PlayerTradeEscrow (optional)
 *   ROOM_REGISTRY - Address of RoomRegistry (optional)
 *   AUTH_CAPTURE_ESCROW - Address of AuthCaptureEscrow (optional)
 */
contract DeployUserBlockRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));

        vm.startBroadcast(deployerPrivateKey);

        // Deploy UserBlockRegistry
        UserBlockRegistry blockRegistry = new UserBlockRegistry(identityRegistry);
        console.log("UserBlockRegistry deployed at:", address(blockRegistry));

        // Configure integrations if addresses are provided
        _configureIntegrations(address(blockRegistry));

        vm.stopBroadcast();

        // Output deployment info
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("UserBlockRegistry:", address(blockRegistry));
        console.log("IdentityRegistry:", identityRegistry);
        console.log("Version:", blockRegistry.version());
        console.log("");
    }

    function _configureIntegrations(address blockRegistry) internal {
        // OTC
        address otc = vm.envOr("OTC_ADDRESS", address(0));
        if (otc != address(0)) {
            _safeCall(otc, abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("  OTC configured:", otc);
        }

        // Token
        address token = vm.envOr("TOKEN_ADDRESS", address(0));
        if (token != address(0)) {
            _safeCall(token, abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("  Token configured:", token);
        }

        // MessagingKeyRegistry
        address messaging = vm.envOr("MESSAGING_KEY_REGISTRY", address(0));
        if (messaging != address(0)) {
            _safeCall(messaging, abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("  MessagingKeyRegistry configured:", messaging);
        }

        // Marketplace
        address marketplace = vm.envOr("MARKETPLACE_ADDRESS", address(0));
        if (marketplace != address(0)) {
            _safeCall(marketplace, abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("  Marketplace configured:", marketplace);
        }

        // X402Facilitator
        address x402 = vm.envOr("X402_FACILITATOR", address(0));
        if (x402 != address(0)) {
            _safeCall(x402, abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("  X402Facilitator configured:", x402);
        }

        // PlayerTradeEscrow
        address escrow = vm.envOr("PLAYER_TRADE_ESCROW", address(0));
        if (escrow != address(0)) {
            _safeCall(escrow, abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("  PlayerTradeEscrow configured:", escrow);
        }

        // RoomRegistry
        address room = vm.envOr("ROOM_REGISTRY", address(0));
        if (room != address(0)) {
            _safeCall(room, abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("  RoomRegistry configured:", room);
        }

        // AuthCaptureEscrow
        address commerce = vm.envOr("AUTH_CAPTURE_ESCROW", address(0));
        if (commerce != address(0)) {
            _safeCall(commerce, abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("  AuthCaptureEscrow configured:", commerce);
        }
    }

    function _safeCall(address target, bytes memory data) internal {
        (bool success,) = target.call(data);
        if (!success) {
            console.log("  Warning: Failed to configure", target);
        }
    }
}

/**
 * @title ConfigureBlockRegistry
 * @notice Configure existing contracts to use a deployed UserBlockRegistry
 *
 * Usage:
 *   BLOCK_REGISTRY=0x... forge script script/moderation/DeployUserBlockRegistry.s.sol:ConfigureBlockRegistry \
 *     --rpc-url $RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast
 */
contract ConfigureBlockRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address blockRegistry = vm.envAddress("BLOCK_REGISTRY");

        require(blockRegistry != address(0), "BLOCK_REGISTRY required");

        vm.startBroadcast(deployerPrivateKey);

        // OTC
        address otc = vm.envOr("OTC_ADDRESS", address(0));
        if (otc != address(0)) {
            (bool success,) = otc.call(abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("OTC:", success ? "configured" : "FAILED");
        }

        // Token
        address token = vm.envOr("TOKEN_ADDRESS", address(0));
        if (token != address(0)) {
            (bool success,) = token.call(abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("Token:", success ? "configured" : "FAILED");
        }

        // MessagingKeyRegistry
        address messaging = vm.envOr("MESSAGING_KEY_REGISTRY", address(0));
        if (messaging != address(0)) {
            (bool success,) = messaging.call(abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("MessagingKeyRegistry:", success ? "configured" : "FAILED");
        }

        // Marketplace
        address marketplace = vm.envOr("MARKETPLACE_ADDRESS", address(0));
        if (marketplace != address(0)) {
            (bool success,) = marketplace.call(abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("Marketplace:", success ? "configured" : "FAILED");
        }

        // X402Facilitator
        address x402 = vm.envOr("X402_FACILITATOR", address(0));
        if (x402 != address(0)) {
            (bool success,) = x402.call(abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("X402Facilitator:", success ? "configured" : "FAILED");
        }

        // PlayerTradeEscrow
        address escrow = vm.envOr("PLAYER_TRADE_ESCROW", address(0));
        if (escrow != address(0)) {
            (bool success,) = escrow.call(abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("PlayerTradeEscrow:", success ? "configured" : "FAILED");
        }

        // RoomRegistry
        address room = vm.envOr("ROOM_REGISTRY", address(0));
        if (room != address(0)) {
            (bool success,) = room.call(abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("RoomRegistry:", success ? "configured" : "FAILED");
        }

        // AuthCaptureEscrow
        address commerce = vm.envOr("AUTH_CAPTURE_ESCROW", address(0));
        if (commerce != address(0)) {
            (bool success,) = commerce.call(abi.encodeWithSignature("setBlockRegistry(address)", blockRegistry));
            console.log("AuthCaptureEscrow:", success ? "configured" : "FAILED");
        }

        vm.stopBroadcast();
    }
}
