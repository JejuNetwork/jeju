#!/usr/bin/env bun
/**
 * Final Comprehensive Verification
 * 
 * Verifies the complete deployment and integration:
 * 1. All contracts deployed and configured
 * 2. All transactions verified on-chain
 * 3. Cross-contract interactions working
 * 4. Cloud config matches deployed addresses
 */

import {
  createPublicClient,
  http,
  formatUnits,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { join } from "path";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

const DEPLOYED_CONTRACTS = {
  MockJejuUSDC: "0x953F6516E5d2864cE7f13186B45dE418EA665EB2" as Address,
  ElizaOSToken: "0x7af64e6aE21076DE21EFe71F243A75664a17C34b" as Address,
  IdentityRegistry: "0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd" as Address,
  SolverRegistry: "0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de" as Address,
  SimpleOracle: "0xE30218678a940d1553b285B0eB5C5364BBF70ed9" as Address,
  InputSettler: "0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75" as Address,
  OutputSettler: "0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5" as Address,
};

const VERIFIED_TXS = [
  { name: "USDC Approval for InputSettler", tx: "0x2414072aaa782e88d0e4705f5327c95ba43f7e9ea144357bdc76776d356bf795" },
  { name: "USDC Approval for OutputSettler", tx: "0x51536d441cc63cd657a87ce10479ab756e13740235e07458aed3a22aecd6aa8b" },
  { name: "Liquidity Deposit", tx: "0x3adc0c02ca9f6441b7404edd6ea9d45681e9b92a8a7d7ef2c400e5dfb0f96719" },
  { name: "fillDirect", tx: "0xde39dd747ff03b7303d0e83350992b3501a8756c934c01086b73ce83d3099e10" },
  { name: "Submit Attestation", tx: "0x68a99e50cf8c9c68d445298065fee8193d9f667a2ab85c1f16a2f557f59ee86a" },
];

const VERIFIED_ORDER_ID = "0xc2f5b5159cdd8815d613685fa94973d7ae324475720fbe1b69445886457c5581";

interface CheckResult {
  category: string;
  check: string;
  status: "pass" | "fail";
  details?: string;
}

const results: CheckResult[] = [];

function log(result: CheckResult) {
  results.push(result);
  const icon = result.status === "pass" ? "✅" : "❌";
  console.log(`${icon} [${result.category}] ${result.check}`);
  if (result.details) {
    console.log(`   ${result.details}`);
  }
}

async function main() {
  console.log("🔍 FINAL COMPREHENSIVE VERIFICATION");
  console.log("=".repeat(70));
  console.log("\n📍 Chain: Base Sepolia (84532)\n");

  // ============================================================================
  // 1. VERIFY ALL CONTRACTS DEPLOYED
  // ============================================================================
  console.log("━".repeat(70));
  console.log("1️⃣ CONTRACT DEPLOYMENT VERIFICATION");
  console.log("━".repeat(70));

  for (const [name, address] of Object.entries(DEPLOYED_CONTRACTS)) {
    const code = await publicClient.getCode({ address });
    const deployed = code && code.length > 2;
    log({
      category: "Deployment",
      check: `${name} deployed at ${address.slice(0, 10)}...`,
      status: deployed ? "pass" : "fail",
    });
  }

  // ============================================================================
  // 2. VERIFY CONTRACT CONFIGURATION
  // ============================================================================
  console.log("\n" + "━".repeat(70));
  console.log("2️⃣ CONTRACT CONFIGURATION VERIFICATION");
  console.log("━".repeat(70));

  // InputSettler config
  const inputSettlerABI = [
    { name: "oracle", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
    { name: "solverRegistry", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
    { name: "chainId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  ] as const;

  const inputOracle = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.InputSettler,
    abi: inputSettlerABI,
    functionName: "oracle",
  });
  log({
    category: "Config",
    check: "InputSettler → Oracle",
    status: inputOracle.toLowerCase() === DEPLOYED_CONTRACTS.SimpleOracle.toLowerCase() ? "pass" : "fail",
    details: inputOracle,
  });

  const inputRegistry = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.InputSettler,
    abi: inputSettlerABI,
    functionName: "solverRegistry",
  });
  log({
    category: "Config",
    check: "InputSettler → SolverRegistry",
    status: inputRegistry.toLowerCase() === DEPLOYED_CONTRACTS.SolverRegistry.toLowerCase() ? "pass" : "fail",
    details: inputRegistry,
  });

  // OutputSettler config
  const outputSettlerABI = [
    { name: "chainId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  ] as const;

  const outputChainId = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.OutputSettler,
    abi: outputSettlerABI,
    functionName: "chainId",
  });
  log({
    category: "Config",
    check: "OutputSettler chainId = 84532",
    status: outputChainId === 84532n ? "pass" : "fail",
    details: `chainId = ${outputChainId}`,
  });

  // Oracle config
  const oracleABI = [
    { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
    { name: "authorizedAttesters", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  ] as const;

  const oracleOwner = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.SimpleOracle,
    abi: oracleABI,
    functionName: "owner",
  });
  const deployer = "0x5dB1268e424da5C26451e4a8B9C221e6DE3C3064";
  const isDeployerAttester = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.SimpleOracle,
    abi: oracleABI,
    functionName: "authorizedAttesters",
    args: [deployer as Address],
  });
  log({
    category: "Config",
    check: "Oracle owner is deployer",
    status: oracleOwner.toLowerCase() === deployer.toLowerCase() ? "pass" : "fail",
    details: oracleOwner,
  });
  log({
    category: "Config",
    check: "Deployer is authorized attester",
    status: isDeployerAttester ? "pass" : "fail",
  });

  // ============================================================================
  // 3. VERIFY ON-CHAIN TRANSACTIONS
  // ============================================================================
  console.log("\n" + "━".repeat(70));
  console.log("3️⃣ TRANSACTION VERIFICATION");
  console.log("━".repeat(70));

  for (const { name, tx } of VERIFIED_TXS) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: tx as `0x${string}` });
      log({
        category: "Transaction",
        check: name,
        status: receipt.status === "success" ? "pass" : "fail",
        details: `Block ${receipt.blockNumber}, Gas ${receipt.gasUsed}`,
      });
    } catch (e) {
      log({
        category: "Transaction",
        check: name,
        status: "fail",
        details: "Could not fetch receipt",
      });
    }
  }

  // ============================================================================
  // 4. VERIFY ORDER STATE
  // ============================================================================
  console.log("\n" + "━".repeat(70));
  console.log("4️⃣ ORDER STATE VERIFICATION");
  console.log("━".repeat(70));

  const orderStateABI = [
    { name: "isFilled", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  ] as const;

  const oracleStateABI = [
    { name: "hasAttested", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
    { name: "attestedAt", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  ] as const;

  const isFilled = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.OutputSettler,
    abi: orderStateABI,
    functionName: "isFilled",
    args: [VERIFIED_ORDER_ID as `0x${string}`],
  });
  log({
    category: "State",
    check: `Order ${VERIFIED_ORDER_ID.slice(0, 18)}... is filled`,
    status: isFilled ? "pass" : "fail",
  });

  const hasAttested = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.SimpleOracle,
    abi: oracleStateABI,
    functionName: "hasAttested",
    args: [VERIFIED_ORDER_ID as `0x${string}`],
  });
  const attestedAt = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.SimpleOracle,
    abi: oracleStateABI,
    functionName: "attestedAt",
    args: [VERIFIED_ORDER_ID as `0x${string}`],
  });
  log({
    category: "State",
    check: "Order has attestation",
    status: hasAttested ? "pass" : "fail",
    details: `attestedAt = ${attestedAt} (${new Date(Number(attestedAt) * 1000).toISOString()})`,
  });

  // ============================================================================
  // 5. VERIFY CLOUD CONFIG
  // ============================================================================
  console.log("\n" + "━".repeat(70));
  console.log("5️⃣ CLOUD CONFIG VERIFICATION");
  console.log("━".repeat(70));

  try {
    const x402ConfigPath = join(__dirname, "../../../vendor/cloud/config/x402.json");
    const x402Config = JSON.parse(readFileSync(x402ConfigPath, "utf-8"));
    
    const configUsdc = x402Config.networks["base-sepolia"].usdc;
    log({
      category: "CloudConfig",
      check: "x402.json USDC matches deployment",
      status: configUsdc.toLowerCase() === DEPLOYED_CONTRACTS.MockJejuUSDC.toLowerCase() ? "pass" : "fail",
      details: configUsdc,
    });

    const oifContracts = x402Config.oifContracts?.["base-sepolia"];
    if (oifContracts) {
      log({
        category: "CloudConfig",
        check: "x402.json OIF SolverRegistry matches",
        status: oifContracts.SolverRegistry?.toLowerCase() === DEPLOYED_CONTRACTS.SolverRegistry.toLowerCase() ? "pass" : "fail",
      });
      log({
        category: "CloudConfig",
        check: "x402.json OIF Oracle matches",
        status: oifContracts.SimpleOracle?.toLowerCase() === DEPLOYED_CONTRACTS.SimpleOracle.toLowerCase() ? "pass" : "fail",
      });
    }

    const erc8004ConfigPath = join(__dirname, "../../../vendor/cloud/config/erc8004.json");
    const erc8004Config = JSON.parse(readFileSync(erc8004ConfigPath, "utf-8"));
    
    const configIdentity = erc8004Config.networks["base-sepolia"].contracts.identity;
    log({
      category: "CloudConfig",
      check: "erc8004.json IdentityRegistry matches",
      status: configIdentity.toLowerCase() === DEPLOYED_CONTRACTS.IdentityRegistry.toLowerCase() ? "pass" : "fail",
      details: configIdentity,
    });

    const agentId = erc8004Config.networks["base-sepolia"].agentId;
    log({
      category: "CloudConfig",
      check: "Eliza Cloud Agent ID = 1",
      status: agentId === 1 ? "pass" : "fail",
      details: `agentId = ${agentId}`,
    });
  } catch (e) {
    log({
      category: "CloudConfig",
      check: "Read cloud config files",
      status: "fail",
      details: String(e),
    });
  }

  // ============================================================================
  // 6. VERIFY ERC-8004 AGENT REGISTRATION
  // ============================================================================
  console.log("\n" + "━".repeat(70));
  console.log("6️⃣ ERC-8004 AGENT REGISTRATION VERIFICATION");
  console.log("━".repeat(70));

  const erc721ABI = [
    { name: "ownerOf", type: "function", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }], stateMutability: "view" },
    { name: "tokenURI", type: "function", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }], stateMutability: "view" },
  ] as const;

  const agentOwner = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.IdentityRegistry,
    abi: erc721ABI,
    functionName: "ownerOf",
    args: [1n],
  });
  log({
    category: "ERC8004",
    check: "Agent #1 exists and owned by deployer",
    status: agentOwner.toLowerCase() === deployer.toLowerCase() ? "pass" : "fail",
    details: agentOwner,
  });

  const tokenURI = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.IdentityRegistry,
    abi: erc721ABI,
    functionName: "tokenURI",
    args: [1n],
  });
  log({
    category: "ERC8004",
    check: "Agent #1 has correct URI",
    status: tokenURI.includes("cloud.eliza.how") ? "pass" : "fail",
    details: tokenURI,
  });

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n" + "=".repeat(70));
  console.log("📊 FINAL VERIFICATION SUMMARY");
  console.log("=".repeat(70));

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const total = results.length;

  console.log(`\n✅ Passed: ${passed}/${total}`);
  console.log(`❌ Failed: ${failed}/${total}`);
  console.log(`📊 Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log("\n❌ FAILED CHECKS:");
    for (const r of results.filter(r => r.status === "fail")) {
      console.log(`   [${r.category}] ${r.check}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  if (failed === 0) {
    console.log("🎉 100% VERIFICATION PASSED - ALL SYSTEMS OPERATIONAL");
  } else {
    console.log(`⚠️  ${passed}/${total} CHECKS PASSED - REVIEW FAILURES ABOVE`);
  }
  console.log("=".repeat(70));

  // Print deployment summary
  console.log("\n📋 DEPLOYED CONTRACTS:");
  for (const [name, address] of Object.entries(DEPLOYED_CONTRACTS)) {
    console.log(`   ${name.padEnd(20)} ${address}`);
  }

  console.log("\n📋 VERIFIED TRANSACTIONS:");
  for (const { name, tx } of VERIFIED_TXS) {
    console.log(`   ${name.padEnd(30)} https://sepolia.basescan.org/tx/${tx}`);
  }

  console.log("\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);

