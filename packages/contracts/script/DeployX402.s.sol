// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {X402Facilitator} from "../src/x402/X402Facilitator.sol";
import {X402IntentBridge} from "../src/x402/X402IntentBridge.sol";

/**
 * @title DeployX402
 * @notice Deploys x402 Payment Protocol contracts
 * @dev Usage: forge script deploy/DeployX402.s.sol --broadcast --rpc-url $RPC_URL
 * 
 * Environment variables:
 *   PRIVATE_KEY - Deployer private key
 *   FEE_RECIPIENT - Address to receive protocol fees
 *   PROTOCOL_FEE_BPS - Protocol fee in basis points (default: 50 = 0.5%)
 *   SUPPORTED_TOKENS - Comma-separated list of token addresses
 *   ORACLE_ADDRESS - OIF Oracle address (optional, for intent bridge)
 */
contract DeployX402 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        
        // Parse supported tokens
        string memory tokensEnv = vm.envOr("SUPPORTED_TOKENS", string(""));
        address[] memory tokens = parseTokens(tokensEnv);
        
        console2.log("Deployer:", deployer);
        console2.log("Fee Recipient:", feeRecipient);
        console2.log("Supported Tokens:", tokens.length);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy X402Facilitator
        X402Facilitator facilitator = new X402Facilitator(
            deployer,
            feeRecipient,
            tokens
        );
        
        console2.log("X402Facilitator deployed to:", address(facilitator));
        
        // Set token decimals for common stablecoins
        for (uint256 i = 0; i < tokens.length; i++) {
            // USDC, USDT, EURC are 6 decimals
            facilitator.setTokenDecimals(tokens[i], 6);
        }
        
        // Deploy X402IntentBridge if oracle is configured
        address oracleAddress = vm.envOr("ORACLE_ADDRESS", address(0));
        if (oracleAddress != address(0)) {
            X402IntentBridge bridge = new X402IntentBridge(
                address(facilitator),
                oracleAddress,
                deployer
            );
            console2.log("X402IntentBridge deployed to:", address(bridge));
        }
        
        vm.stopBroadcast();
        
        // Output deployment info
        console2.log("");
        console2.log("=== DEPLOYMENT COMPLETE ===");
        console2.log("Chain ID:", block.chainid);
        console2.log("X402Facilitator:", address(facilitator));
        console2.log("Protocol Fee:", facilitator.protocolFeeBps(), "bps");
    }
    
    function parseTokens(string memory tokensStr) internal pure returns (address[] memory) {
        if (bytes(tokensStr).length == 0) {
            return new address[](0);
        }
        
        // Count commas to determine array size
        uint256 count = 1;
        bytes memory strBytes = bytes(tokensStr);
        for (uint256 i = 0; i < strBytes.length; i++) {
            if (strBytes[i] == ",") {
                count++;
            }
        }
        
        address[] memory tokens = new address[](count);
        uint256 tokenIndex = 0;
        uint256 start = 0;
        
        for (uint256 i = 0; i <= strBytes.length; i++) {
            if (i == strBytes.length || strBytes[i] == ",") {
                bytes memory tokenBytes = new bytes(i - start);
                for (uint256 j = start; j < i; j++) {
                    tokenBytes[j - start] = strBytes[j];
                }
                tokens[tokenIndex] = parseAddress(string(tokenBytes));
                tokenIndex++;
                start = i + 1;
            }
        }
        
        return tokens;
    }
    
    function parseAddress(string memory addrStr) internal pure returns (address) {
        bytes memory addrBytes = bytes(addrStr);
        uint160 addr = 0;
        
        // Skip "0x" prefix
        uint256 start = 0;
        if (addrBytes.length >= 2 && addrBytes[0] == "0" && (addrBytes[1] == "x" || addrBytes[1] == "X")) {
            start = 2;
        }
        
        for (uint256 i = start; i < addrBytes.length; i++) {
            uint8 b = uint8(addrBytes[i]);
            uint8 digit;
            
            if (b >= 48 && b <= 57) {
                digit = b - 48;
            } else if (b >= 65 && b <= 70) {
                digit = b - 55;
            } else if (b >= 97 && b <= 102) {
                digit = b - 87;
            } else {
                continue;
            }
            
            addr = addr * 16 + digit;
        }
        
        return address(addr);
    }
}

