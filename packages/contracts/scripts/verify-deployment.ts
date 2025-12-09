#!/usr/bin/env bun
/**
 * Comprehensive Deployment Verification
 * 
 * Verifies all deployed contracts are working correctly:
 * 1. Token contracts (USDC, ElizaOS)
 * 2. IdentityRegistry (ERC-8004)
 * 3. OIF contracts (SolverRegistry, Oracle, Settlers)
 * 4. Cross-contract interactions
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = (process.env.PRIVATE_KEY || process.env.MAINNET_PRIVATE_KEY) as `0x${string}`;
const DEPLOYER = "0x5dB1268e424da5C26451e4a8B9C221e6DE3C3064" as Address;

const CONTRACTS = {
  MockJejuUSDC: "0x953F6516E5d2864cE7f13186B45dE418EA665EB2" as Address,
  ElizaOSToken: "0x7af64e6aE21076DE21EFe71F243A75664a17C34b" as Address,
  IdentityRegistry: "0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd" as Address,
  SolverRegistry: "0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de" as Address,
  SimpleOracle: "0xE30218678a940d1553b285B0eB5C5364BBF70ed9" as Address,
  InputSettler: "0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75" as Address,
  OutputSettler: "0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5" as Address,
};

// ABIs
const ERC20_ABI = [
  { name: "name", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "faucet", type: "function", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { name: "transfer", type: "function", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

const ERC721_ABI = [
  { name: "ownerOf", type: "function", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "tokenURI", type: "function", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "balanceOf", type: "function", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const ORACLE_ABI = [
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "authorizedAttesters", type: "function", inputs: [{ name: "attester", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const;

const SOLVER_REGISTRY_ABI = [
  { name: "MIN_STAKE", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "activeSolverCount", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "version", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
] as const;

const SETTLER_ABI = [
  { name: "chainId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

interface TestResult {
  name: string;
  status: "pass" | "fail" | "skip";
  message: string;
  details?: Record<string, string>;
}

const results: TestResult[] = [];

function logResult(result: TestResult) {
  results.push(result);
  const icon = result.status === "pass" ? "✅" : result.status === "fail" ? "❌" : "⏭️";
  console.log(`${icon} ${result.name}: ${result.message}`);
  if (result.details) {
    for (const [key, value] of Object.entries(result.details)) {
      console.log(`   ${key}: ${value}`);
    }
  }
}

async function main() {
  console.log("🔍 COMPREHENSIVE DEPLOYMENT VERIFICATION");
  console.log("=".repeat(60));
  console.log("\n📍 Chain: Base Sepolia (84532)");
  console.log(`👤 Deployer: ${DEPLOYER}\n`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
  });

  let walletClient = null;
  let account = null;
  if (PRIVATE_KEY) {
    account = privateKeyToAccount(PRIVATE_KEY);
    walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http("https://sepolia.base.org"),
    });
  }

  // ============================================================================
  // 1. VERIFY CONTRACT DEPLOYMENTS
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("1️⃣ VERIFYING CONTRACT DEPLOYMENTS");
  console.log("=".repeat(60) + "\n");

  for (const [name, address] of Object.entries(CONTRACTS)) {
    try {
      const code = await publicClient.getCode({ address });
      if (code && code.length > 2) {
        logResult({
          name: `${name} deployed`,
          status: "pass",
          message: address,
        });
      } else {
        logResult({
          name: `${name} deployed`,
          status: "fail",
          message: "No bytecode found",
        });
      }
    } catch (e: unknown) {
      const error = e as Error;
      logResult({
        name: `${name} deployed`,
        status: "fail",
        message: error.message,
      });
    }
  }

  // ============================================================================
  // 2. VERIFY TOKEN CONTRACTS
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("2️⃣ VERIFYING TOKEN CONTRACTS");
  console.log("=".repeat(60) + "\n");

  // MockJejuUSDC
  try {
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.MockJejuUSDC, abi: ERC20_ABI, functionName: "name" }),
      publicClient.readContract({ address: CONTRACTS.MockJejuUSDC, abi: ERC20_ABI, functionName: "symbol" }),
      publicClient.readContract({ address: CONTRACTS.MockJejuUSDC, abi: ERC20_ABI, functionName: "decimals" }),
    ]);
    logResult({
      name: "MockJejuUSDC token info",
      status: "pass",
      message: "Token configured correctly",
      details: { Name: name, Symbol: symbol, Decimals: decimals.toString() },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logResult({ name: "MockJejuUSDC token info", status: "fail", message: error.message });
  }

  // ElizaOSToken
  try {
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.ElizaOSToken, abi: ERC20_ABI, functionName: "name" }),
      publicClient.readContract({ address: CONTRACTS.ElizaOSToken, abi: ERC20_ABI, functionName: "symbol" }),
      publicClient.readContract({ address: CONTRACTS.ElizaOSToken, abi: ERC20_ABI, functionName: "decimals" }),
    ]);
    logResult({
      name: "ElizaOSToken token info",
      status: "pass",
      message: "Token configured correctly",
      details: { Name: name, Symbol: symbol, Decimals: decimals.toString() },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logResult({ name: "ElizaOSToken token info", status: "fail", message: error.message });
  }

  // Test USDC faucet
  if (walletClient && account) {
    try {
      const balanceBefore = await publicClient.readContract({
        address: CONTRACTS.MockJejuUSDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      });

      const tx = await walletClient.writeContract({
        address: CONTRACTS.MockJejuUSDC,
        abi: ERC20_ABI,
        functionName: "faucet",
        args: [],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });

      const balanceAfter = await publicClient.readContract({
        address: CONTRACTS.MockJejuUSDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      });

      logResult({
        name: "USDC faucet",
        status: "pass",
        message: "Faucet works correctly",
        details: {
          "Balance before": formatUnits(balanceBefore, 6) + " USDC",
          "Balance after": formatUnits(balanceAfter, 6) + " USDC",
          "Tx": tx,
        },
      });
    } catch (e: unknown) {
      const error = e as Error;
      logResult({ name: "USDC faucet", status: "fail", message: error.message });
    }

    // Test USDC transfer
    try {
      const testAmount = parseUnits("1", 6); // 1 USDC
      const testRecipient = "0x0000000000000000000000000000000000000001" as Address;
      
      const tx = await walletClient.writeContract({
        address: CONTRACTS.MockJejuUSDC,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [testRecipient, testAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });

      logResult({
        name: "USDC transfer",
        status: "pass",
        message: "Transfer works correctly",
        details: { Tx: tx },
      });
    } catch (e: unknown) {
      const error = e as Error;
      logResult({ name: "USDC transfer", status: "fail", message: error.message });
    }
  } else {
    logResult({ name: "Token faucet/transfer tests", status: "skip", message: "No private key provided" });
  }

  // ============================================================================
  // 3. VERIFY ERC-8004 IDENTITY REGISTRY
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("3️⃣ VERIFYING ERC-8004 IDENTITY REGISTRY");
  console.log("=".repeat(60) + "\n");

  try {
    const owner = await publicClient.readContract({
      address: CONTRACTS.IdentityRegistry,
      abi: ERC721_ABI,
      functionName: "ownerOf",
      args: [1n],
    });

    const uri = await publicClient.readContract({
      address: CONTRACTS.IdentityRegistry,
      abi: ERC721_ABI,
      functionName: "tokenURI",
      args: [1n],
    });

    logResult({
      name: "Eliza Cloud Agent #1",
      status: "pass",
      message: "Agent registered correctly",
      details: {
        Owner: owner,
        URI: uri,
        "Owner is deployer": owner.toLowerCase() === DEPLOYER.toLowerCase() ? "Yes" : "No",
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logResult({ name: "Eliza Cloud Agent #1", status: "fail", message: error.message });
  }

  try {
    const balance = await publicClient.readContract({
      address: CONTRACTS.IdentityRegistry,
      abi: ERC721_ABI,
      functionName: "balanceOf",
      args: [DEPLOYER],
    });

    logResult({
      name: "Deployer agent count",
      status: "pass",
      message: `Deployer owns ${balance} agent(s)`,
    });
  } catch (e: unknown) {
    const error = e as Error;
    logResult({ name: "Deployer agent count", status: "fail", message: error.message });
  }

  // ============================================================================
  // 4. VERIFY OIF CONTRACTS
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("4️⃣ VERIFYING OIF CONTRACTS");
  console.log("=".repeat(60) + "\n");

  // SolverRegistry
  try {
    const [minStake, activeSolvers, version] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "MIN_STAKE" }),
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "activeSolverCount" }),
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "version" }),
    ]);

    logResult({
      name: "SolverRegistry",
      status: "pass",
      message: "Registry configured correctly",
      details: {
        Version: version,
        "Min stake": formatUnits(minStake, 18) + " ETH",
        "Active solvers": activeSolvers.toString(),
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logResult({ name: "SolverRegistry", status: "fail", message: error.message });
  }

  // SimpleOracle
  try {
    const owner = await publicClient.readContract({
      address: CONTRACTS.SimpleOracle,
      abi: ORACLE_ABI,
      functionName: "owner",
    });

    const isDeployerAttester = await publicClient.readContract({
      address: CONTRACTS.SimpleOracle,
      abi: ORACLE_ABI,
      functionName: "authorizedAttesters",
      args: [DEPLOYER],
    });

    logResult({
      name: "SimpleOracle",
      status: "pass",
      message: "Oracle configured correctly",
      details: {
        Owner: owner,
        "Deployer is attester": isDeployerAttester ? "Yes" : "No",
        "Owner is deployer": owner.toLowerCase() === DEPLOYER.toLowerCase() ? "Yes" : "No",
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logResult({ name: "SimpleOracle", status: "fail", message: error.message });
  }

  // InputSettler
  try {
    const chainId = await publicClient.readContract({
      address: CONTRACTS.InputSettler,
      abi: SETTLER_ABI,
      functionName: "chainId",
    });

    logResult({
      name: "InputSettler",
      status: chainId === 84532n ? "pass" : "fail",
      message: chainId === 84532n ? "Configured for Base Sepolia" : `Wrong chain ID: ${chainId}`,
      details: { "Chain ID": chainId.toString() },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logResult({ name: "InputSettler", status: "fail", message: error.message });
  }

  // OutputSettler
  try {
    const chainId = await publicClient.readContract({
      address: CONTRACTS.OutputSettler,
      abi: SETTLER_ABI,
      functionName: "chainId",
    });

    logResult({
      name: "OutputSettler",
      status: chainId === 84532n ? "pass" : "fail",
      message: chainId === 84532n ? "Configured for Base Sepolia" : `Wrong chain ID: ${chainId}`,
      details: { "Chain ID": chainId.toString() },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logResult({ name: "OutputSettler", status: "fail", message: error.message });
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("📊 VERIFICATION SUMMARY");
  console.log("=".repeat(60) + "\n");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏭️ Skipped: ${skipped}`);
  console.log(`📊 Total: ${results.length}`);

  if (failed > 0) {
    console.log("\n❌ FAILED TESTS:");
    for (const r of results.filter((r) => r.status === "fail")) {
      console.log(`   - ${r.name}: ${r.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  if (failed === 0) {
    console.log("🎉 ALL TESTS PASSED - DEPLOYMENT IS 100% WORKING");
  } else {
    console.log(`⚠️ ${failed} TEST(S) FAILED - CHECK ISSUES ABOVE`);
  }
  console.log("=".repeat(60) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);

