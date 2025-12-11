#!/usr/bin/env bun
/**
 * Validate Already Deployed AA Infrastructure
 *
 * This script validates that the deployed contracts are working correctly.
 *
 * Usage:
 *   SPONSORED_PAYMASTER_ADDRESS=0x... bun scripts/validate-deployed-aa.ts
 */

import {
  createPublicClient,
  http,
  parseEther,
  formatEther,
  type Address,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

// ============ Configuration ============

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337");

const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;
const SPONSORED_PAYMASTER = (process.env.SPONSORED_PAYMASTER_ADDRESS || 
  "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address;

// ============ ABIs ============

const SPONSORED_PAYMASTER_ABI = [
  {
    name: "getStatus",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "deposit", type: "uint256" },
      { name: "isPaused", type: "bool" },
      { name: "totalTx", type: "uint256" },
      { name: "totalGas", type: "uint256" },
    ],
  },
  {
    name: "isWhitelisted",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "canSponsor",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "target", type: "address" },
      { name: "gasCost", type: "uint256" },
    ],
    outputs: [
      { name: "sponsored", type: "bool" },
      { name: "reason", type: "string" },
    ],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "maxGasCost",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "maxTxPerUserPerHour",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getRemainingTx",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "remaining", type: "uint256" }],
  },
  {
    name: "version",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

// ============ Setup ============

const chain = {
  id: CHAIN_ID,
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

// ============ Validation ============

interface ValidationResult {
  check: string;
  status: "✅" | "❌" | "⚠️";
  message: string;
  details?: Record<string, unknown>;
}

async function validateOnChain(): Promise<void> {
  console.log("\n🔍 On-Chain Validation\n");
  console.log("=".repeat(60));

  const results: ValidationResult[] = [];

  // 1. Check EntryPoint
  console.log("Checking EntryPoint...");
  const entryPointCode = await publicClient.getCode({ address: ENTRYPOINT_V07 });
  results.push({
    check: "EntryPoint Deployed",
    status: entryPointCode && entryPointCode !== "0x" ? "✅" : "❌",
    message: entryPointCode && entryPointCode !== "0x" 
      ? `at ${ENTRYPOINT_V07}` 
      : "NOT DEPLOYED",
  });

  // 2. Check SponsoredPaymaster
  console.log("Checking SponsoredPaymaster...");
  const paymasterCode = await publicClient.getCode({ address: SPONSORED_PAYMASTER });
  results.push({
    check: "SponsoredPaymaster Deployed",
    status: paymasterCode && paymasterCode !== "0x" ? "✅" : "❌",
    message: paymasterCode && paymasterCode !== "0x"
      ? `at ${SPONSORED_PAYMASTER}`
      : "NOT DEPLOYED",
  });

  if (!paymasterCode || paymasterCode === "0x") {
    console.log("\n❌ SponsoredPaymaster not deployed. Run deployment first.\n");
    process.exit(1);
  }

  // 3. Check owner
  console.log("Checking owner...");
  const owner = await publicClient.readContract({
    address: SPONSORED_PAYMASTER,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "owner",
  });
  results.push({
    check: "Owner Set",
    status: owner !== "0x0000000000000000000000000000000000000000" ? "✅" : "❌",
    message: owner as string,
  });

  // 4. Check deposit/status
  console.log("Checking deposit and status...");
  const [deposit, isPaused, totalTx, totalGas] = await publicClient.readContract({
    address: SPONSORED_PAYMASTER,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "getStatus",
  });
  
  results.push({
    check: "Paymaster Funded",
    status: deposit > 0n ? "✅" : "❌",
    message: `${formatEther(deposit)} ETH`,
    details: { deposit: deposit.toString() },
  });

  results.push({
    check: "Paymaster Active",
    status: !isPaused ? "✅" : "❌",
    message: isPaused ? "PAUSED" : "Active",
  });

  results.push({
    check: "Analytics",
    status: "✅",
    message: `${totalTx} tx, ${totalGas} gas used`,
  });

  // 5. Check whitelist
  console.log("Checking whitelist...");
  const allWhitelisted = await publicClient.readContract({
    address: SPONSORED_PAYMASTER,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "isWhitelisted",
    args: ["0x0000000000000000000000000000000000000000" as Address],
  });
  results.push({
    check: "All Contracts Whitelisted",
    status: allWhitelisted ? "✅" : "⚠️",
    message: allWhitelisted ? "Yes (address(0))" : "No - selective whitelist",
  });

  // 6. Check config
  console.log("Checking configuration...");
  const maxGasCost = await publicClient.readContract({
    address: SPONSORED_PAYMASTER,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "maxGasCost",
  });
  const maxTxPerHour = await publicClient.readContract({
    address: SPONSORED_PAYMASTER,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "maxTxPerUserPerHour",
  });
  results.push({
    check: "Max Gas Cost",
    status: "✅",
    message: `${formatEther(maxGasCost)} ETH/tx`,
  });
  results.push({
    check: "Rate Limit",
    status: "✅",
    message: `${maxTxPerHour} tx/user/hour`,
  });

  // 7. Check version
  const version = await publicClient.readContract({
    address: SPONSORED_PAYMASTER,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "version",
  });
  results.push({
    check: "Version",
    status: "✅",
    message: version,
  });

  // 8. Test canSponsor with random user
  console.log("Testing canSponsor...");
  const testUser = privateKeyToAccount(generatePrivateKey()).address;
  const testTarget = "0x0000000000000000000000000000000000000001" as Address;
  const testGasCost = parseEther("0.001");

  const [canSponsor, reason] = await publicClient.readContract({
    address: SPONSORED_PAYMASTER,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "canSponsor",
    args: [testUser, testTarget, testGasCost],
  });
  results.push({
    check: "canSponsor Test",
    status: canSponsor ? "✅" : "❌",
    message: canSponsor ? "Passed" : `Failed: ${reason}`,
  });

  // 9. Check remaining tx for test user
  const remaining = await publicClient.readContract({
    address: SPONSORED_PAYMASTER,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "getRemainingTx",
    args: [testUser],
  });
  results.push({
    check: "New User Rate Limit",
    status: remaining > 0n ? "✅" : "❌",
    message: `${remaining} tx remaining`,
  });

  // Print results
  console.log("\n" + "=".repeat(60));
  console.log("VALIDATION RESULTS");
  console.log("=".repeat(60) + "\n");

  let passed = 0;
  let failed = 0;
  let warnings = 0;

  for (const result of results) {
    console.log(`${result.status} ${result.check}`);
    console.log(`   ${result.message}`);
    if (result.details) {
      console.log(`   Details: ${JSON.stringify(result.details)}`);
    }
    console.log();

    if (result.status === "✅") passed++;
    else if (result.status === "❌") failed++;
    else warnings++;
  }

  console.log("=".repeat(60));
  console.log(`SUMMARY: ${passed} passed, ${failed} failed, ${warnings} warnings`);
  console.log("=".repeat(60));

  if (failed > 0) {
    console.log("\n❌ VALIDATION FAILED\n");
    process.exit(1);
  } else if (warnings > 0) {
    console.log("\n⚠️  VALIDATION PASSED WITH WARNINGS\n");
  } else {
    console.log("\n✅ ALL VALIDATIONS PASSED\n");
  }
}

// ============ Main ============

async function main() {
  console.log("🔍 Validating Deployed AA Infrastructure\n");
  console.log("Network:", chain.name);
  console.log("Chain ID:", chain.id);
  console.log("RPC URL:", RPC_URL);
  console.log("EntryPoint:", ENTRYPOINT_V07);
  console.log("SponsoredPaymaster:", SPONSORED_PAYMASTER);

  const blockNumber = await publicClient.getBlockNumber();
  console.log("Current Block:", blockNumber.toString());

  await validateOnChain();

  // Write deployment summary
  const summary = {
    timestamp: new Date().toISOString(),
    network: chain.name,
    chainId: chain.id,
    rpcUrl: RPC_URL,
    contracts: {
      entryPoint: ENTRYPOINT_V07,
      sponsoredPaymaster: SPONSORED_PAYMASTER,
    },
    status: "VALIDATED",
  };

  const outputPath = "/home/shaw/Documents/jeju/packages/contracts/deployments/aa-localnet.json";
  await Bun.write(outputPath, JSON.stringify(summary, null, 2));
  console.log(`📝 Summary written to ${outputPath}\n`);
}

main().catch((error) => {
  console.error("❌ Validation failed:", error.message);
  process.exit(1);
});
