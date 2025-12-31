// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

// Tokens
import {Token} from "../src/tokens/Token.sol";
import {NetworkUSDC} from "../src/tokens/NetworkUSDC.sol";

// Core Infrastructure
import {PriceOracle} from "../src/oracle/PriceOracle.sol";
import {ServiceRegistry} from "../src/services/ServiceRegistry.sol";
import {CreditManager} from "../src/services/CreditManager.sol";
import {MultiTokenPaymaster} from "../src/services/MultiTokenPaymaster.sol";
import {TokenRegistry} from "../src/paymaster/TokenRegistry.sol";
import {PaymasterFactory} from "../src/paymaster/PaymasterFactory.sol";

// Registry System
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/registry/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/registry/ValidationRegistry.sol";

// Moderation
import {BanManager} from "../src/moderation/BanManager.sol";
import {ReputationLabelManager} from "../src/moderation/ReputationLabelManager.sol";

// OIF (Open Intents Framework)
import {SolverRegistry} from "../src/oif/SolverRegistry.sol";
import {SimpleOracle, HyperlaneOracle} from "../src/oif/OracleAdapter.sol";
import {InputSettler} from "../src/oif/InputSettler.sol";
import {OutputSettler} from "../src/oif/OutputSettler.sol";

// EIL (Ethereum Interop Layer)
import {L1StakeManager} from "../src/bridge/eil/L1StakeManager.sol";
import {CrossChainPaymaster} from "../src/bridge/eil/CrossChainPaymaster.sol";

// X402 (Gasless Payments)
import {X402Facilitator} from "../src/x402/X402Facilitator.sol";
import {X402IntentBridge} from "../src/x402/X402IntentBridge.sol";

/**
 * @title Deploy
 * @notice Master deployment script for all Jeju Network contracts
 * @dev Deploys complete contract infrastructure for testnet and mainnet
 *
 * Usage:
 *   # Testnet
 *   forge script script/Deploy.s.sol:Deploy --rpc-url $TESTNET_RPC --broadcast --verify
 *
 *   # Mainnet
 *   forge script script/Deploy.s.sol:Deploy --rpc-url $MAINNET_RPC --broadcast --verify
 *
 * Environment variables:
 *   PRIVATE_KEY - Deployer private key (required)
 *   ENTRY_POINT - ERC-4337 EntryPoint address (uses standard if not set)
 *   HYPERLANE_MAILBOX - Hyperlane Mailbox for cross-chain (optional)
 *   DEPLOY_OIF - Deploy OIF contracts (default: true)
 *   DEPLOY_EIL - Deploy EIL contracts (default: true)
 *   DEPLOY_X402 - Deploy X402 contracts (default: true)
 */
contract Deploy is Script {
    // Standard ERC-4337 EntryPoint v0.7
    address constant STANDARD_ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    // Deployed contracts
    address public deployer;
    uint256 public chainId;

    // Core
    address public priceOracle;
    address public serviceRegistry;
    address public identityRegistry;
    address public reputationRegistry;
    address public validationRegistry;
    address public banManager;
    address public reputationLabelManager;
    address public entryPoint;

    // Tokens
    address public usdc;
    address public jeju;

    // Payment
    address public creditManager;
    address public multiTokenPaymaster;
    address public tokenRegistry;
    address public paymasterFactory;

    // OIF
    address public solverRegistry;
    address public oifOracle;
    address public inputSettler;
    address public outputSettler;

    // EIL
    address public l1StakeManager;
    address public crossChainPaymaster;

    // X402
    address public x402Facilitator;
    address public x402IntentBridge;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerPrivateKey);
        chainId = block.chainid;

        // Use standard EntryPoint or custom if provided
        entryPoint = vm.envOr("ENTRY_POINT", STANDARD_ENTRY_POINT);

        console2.log("====================================");
        console2.log("  JEJU NETWORK CONTRACT DEPLOYMENT");
        console2.log("====================================");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", chainId);
        console2.log("EntryPoint:", entryPoint);
        console2.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ========== STEP 1: Core Infrastructure ==========
        console2.log("--- Step 1: Core Infrastructure ---");

        priceOracle = address(new PriceOracle());
        console2.log("PriceOracle:", priceOracle);

        serviceRegistry = address(new ServiceRegistry(deployer));
        console2.log("ServiceRegistry:", serviceRegistry);

        // ========== STEP 2: Registry System ==========
        console2.log("");
        console2.log("--- Step 2: Registry System ---");

        identityRegistry = address(new IdentityRegistry());
        console2.log("IdentityRegistry:", identityRegistry);

        reputationRegistry = address(new ReputationRegistry(payable(identityRegistry)));
        console2.log("ReputationRegistry:", reputationRegistry);

        validationRegistry = address(new ValidationRegistry(payable(identityRegistry)));
        console2.log("ValidationRegistry:", validationRegistry);

        // ========== STEP 3: Moderation ==========
        console2.log("");
        console2.log("--- Step 3: Moderation ---");

        banManager = address(new BanManager(deployer, identityRegistry));
        console2.log("BanManager:", banManager);

        // ReputationLabelManager(banManager, predictionMarket, governance, owner)
        // Using deployer as prediction market placeholder and governance for now
        reputationLabelManager = address(new ReputationLabelManager(banManager, deployer, deployer, deployer));
        console2.log("ReputationLabelManager:", reputationLabelManager);

        // ========== STEP 4: Tokens ==========
        console2.log("");
        console2.log("--- Step 4: Tokens ---");

        // Deploy USDC with EIP-3009 support for x402
        usdc = address(new NetworkUSDC(deployer, 1_000_000_000e6, true)); // 1B USDC
        console2.log("USDC:", usdc);

        // Deploy JEJU Token
        jeju = address(
            new Token(
                "Jeju Network",
                "JEJU",
                1_000_000_000e18, // 1B initial supply
                deployer,
                0, // no max supply
                true // is home chain
            )
        );
        console2.log("JEJU:", jeju);

        // Configure JEJU token
        Token(jeju).setBanManager(banManager);
        Token(jeju).setConfig(0, 0, true, false, true); // Enable faucet for testnet

        // ========== STEP 5: Payment System ==========
        console2.log("");
        console2.log("--- Step 5: Payment System ---");

        creditManager = address(new CreditManager(usdc, jeju));
        console2.log("CreditManager:", creditManager);

        tokenRegistry = address(new TokenRegistry(deployer, deployer));
        console2.log("TokenRegistry:", tokenRegistry);

        paymasterFactory = address(new PaymasterFactory(tokenRegistry, entryPoint, priceOracle, deployer));
        console2.log("PaymasterFactory:", paymasterFactory);

        multiTokenPaymaster = address(
            new MultiTokenPaymaster(
                IEntryPoint(entryPoint),
                usdc,
                jeju,
                creditManager,
                serviceRegistry,
                priceOracle,
                deployer,
                deployer
            )
        );
        console2.log("MultiTokenPaymaster:", multiTokenPaymaster);

        // Set oracle prices
        PriceOracle(priceOracle).setPrice(address(0), 3000e18, 18); // ETH = $3000
        PriceOracle(priceOracle).setPrice(usdc, 1e18, 18); // USDC = $1
        PriceOracle(priceOracle).setPrice(jeju, 0.1e18, 18); // JEJU = $0.10

        // ========== STEP 6: OIF (Open Intents Framework) ==========
        bool deployOif = vm.envOr("DEPLOY_OIF", true);
        if (deployOif) {
            console2.log("");
            console2.log("--- Step 6: OIF (Open Intents Framework) ---");

            solverRegistry = address(new SolverRegistry());
            console2.log("SolverRegistry:", solverRegistry);

            // Use HyperlaneOracle for production, SimpleOracle for testnet
            address hyperlaneMailbox = vm.envOr("HYPERLANE_MAILBOX", address(0));
            if (hyperlaneMailbox != address(0)) {
                HyperlaneOracle hypOracle = new HyperlaneOracle();
                hypOracle.setMailbox(hyperlaneMailbox);
                oifOracle = address(hypOracle);
                console2.log("HyperlaneOracle:", oifOracle);
            } else {
                SimpleOracle simpleOracle = new SimpleOracle();
                simpleOracle.setAttester(deployer, true);
                oifOracle = address(simpleOracle);
                console2.log("SimpleOracle:", oifOracle);
            }

            inputSettler = address(new InputSettler(chainId, oifOracle, solverRegistry));
            console2.log("InputSettler:", inputSettler);

            outputSettler = address(new OutputSettler(chainId));
            console2.log("OutputSettler:", outputSettler);
        }

        // ========== STEP 7: EIL (Ethereum Interop Layer) ==========
        bool deployEil = vm.envOr("DEPLOY_EIL", true);
        if (deployEil) {
            console2.log("");
            console2.log("--- Step 7: EIL (Ethereum Interop Layer) ---");

            L1StakeManager stakeManager = new L1StakeManager();
            l1StakeManager = address(stakeManager);
            console2.log("L1StakeManager:", l1StakeManager);

            crossChainPaymaster = address(
                new CrossChainPaymaster(IEntryPoint(entryPoint), l1StakeManager, chainId, priceOracle, deployer)
            );
            console2.log("CrossChainPaymaster:", crossChainPaymaster);

            // Register paymaster
            stakeManager.registerL2Paymaster(chainId, crossChainPaymaster);
        }

        // ========== STEP 8: X402 (Gasless Payments) ==========
        bool deployX402 = vm.envOr("DEPLOY_X402", true);
        if (deployX402) {
            console2.log("");
            console2.log("--- Step 8: X402 (Gasless Payments) ---");

            address[] memory supportedTokens = new address[](2);
            supportedTokens[0] = usdc;
            supportedTokens[1] = jeju;

            X402Facilitator facilitator = new X402Facilitator(deployer, deployer, supportedTokens);
            x402Facilitator = address(facilitator);
            facilitator.setTokenDecimals(usdc, 6);
            facilitator.setTokenDecimals(jeju, 18);
            console2.log("X402Facilitator:", x402Facilitator);

            if (oifOracle != address(0)) {
                X402IntentBridge bridge = new X402IntentBridge(x402Facilitator, oifOracle, deployer);
                x402IntentBridge = address(bridge);
                bridge.registerSolver(deployer, true);
                console2.log("X402IntentBridge:", x402IntentBridge);
            }
        }

        vm.stopBroadcast();

        // ========== Summary ==========
        console2.log("");
        console2.log("====================================");
        console2.log("       DEPLOYMENT COMPLETE");
        console2.log("====================================");
        console2.log("");
        console2.log("Core Infrastructure:");
        console2.log("  PriceOracle:", priceOracle);
        console2.log("  ServiceRegistry:", serviceRegistry);
        console2.log("  IdentityRegistry:", identityRegistry);
        console2.log("");
        console2.log("Tokens:");
        console2.log("  USDC:", usdc);
        console2.log("  JEJU:", jeju);
        console2.log("");
        console2.log("Payment System:");
        console2.log("  CreditManager:", creditManager);
        console2.log("  MultiTokenPaymaster:", multiTokenPaymaster);
        console2.log("");
        if (solverRegistry != address(0)) {
            console2.log("OIF (Cross-Chain Intents):");
            console2.log("  SolverRegistry:", solverRegistry);
            console2.log("  Oracle:", oifOracle);
            console2.log("  InputSettler:", inputSettler);
            console2.log("  OutputSettler:", outputSettler);
            console2.log("");
        }
        if (l1StakeManager != address(0)) {
            console2.log("EIL (Interop Layer):");
            console2.log("  L1StakeManager:", l1StakeManager);
            console2.log("  CrossChainPaymaster:", crossChainPaymaster);
            console2.log("");
        }
        if (x402Facilitator != address(0)) {
            console2.log("X402 (Gasless Payments):");
            console2.log("  X402Facilitator:", x402Facilitator);
            console2.log("  X402IntentBridge:", x402IntentBridge);
            console2.log("");
        }
    }
}
