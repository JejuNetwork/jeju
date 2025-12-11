#!/usr/bin/env bun
/**
 * Validate Account Abstraction Infrastructure
 *
 * This script validates that all AA components are properly deployed and configured:
 * 1. EntryPoint v0.7 is deployed
 * 2. SponsoredPaymaster is deployed and funded
 * 3. SimpleAccountFactory is deployed
 * 4. Paymaster whitelist is configured
 * 5. All contracts can interact correctly
 *
 * Usage:
 *   bun scripts/validate-aa.ts [--network <network>]
 */

import {
  createPublicClient,
  http,
  formatEther,
  type Address,
} from "viem";

// ============ Constants ============

const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

// Minimal ABIs for validation
const _ENTRYPOINT_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

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
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "version",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const _SIMPLE_ACCOUNT_FACTORY_ABI = [
  {
    name: "getAddress",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ============ Types ============

interface NetworkConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  sponsoredPaymaster?: Address;
  simpleAccountFactory?: Address;
  goldContract?: Address;
  itemsContract?: Address;
}

interface ValidationResult {
  check: string;
  status: "pass" | "fail" | "warn";
  message: string;
  details?: Record<string, unknown>;
}

// ============ Network Configuration ============

function getNetworkConfig(network: string): NetworkConfig {
  switch (network) {
    case "localnet":
      return {
        name: "Jeju Localnet",
        rpcUrl: process.env.JEJU_RPC_URL || "http://localhost:9545",
        chainId: 420691,
        sponsoredPaymaster: process.env.SPONSORED_PAYMASTER_ADDRESS as Address,
        simpleAccountFactory: process.env.SIMPLE_ACCOUNT_FACTORY_ADDRESS as Address,
        goldContract: process.env.GOLD_CONTRACT_ADDRESS as Address,
        itemsContract: process.env.ITEMS_CONTRACT_ADDRESS as Address,
      };
    case "testnet":
      return {
        name: "Jeju Testnet",
        rpcUrl: process.env.JEJU_TESTNET_RPC_URL || "https://testnet-rpc.jeju.network",
        chainId: 420690,
        sponsoredPaymaster: process.env.TESTNET_SPONSORED_PAYMASTER_ADDRESS as Address,
        simpleAccountFactory: process.env.TESTNET_SIMPLE_ACCOUNT_FACTORY_ADDRESS as Address,
      };
    case "mainnet":
      return {
        name: "Jeju Mainnet",
        rpcUrl: process.env.JEJU_MAINNET_RPC_URL || "https://rpc.jeju.network",
        chainId: 420692,
        sponsoredPaymaster: process.env.MAINNET_SPONSORED_PAYMASTER_ADDRESS as Address,
        simpleAccountFactory: process.env.MAINNET_SIMPLE_ACCOUNT_FACTORY_ADDRESS as Address,
      };
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

// ============ Validation Functions ============

async function validateEntryPoint(
  client: ReturnType<typeof createPublicClient>
): Promise<ValidationResult> {
  const code = await client.getCode({ address: ENTRYPOINT_V07 });

  if (!code || code === "0x") {
    return {
      check: "EntryPoint v0.7",
      status: "fail",
      message: `EntryPoint not deployed at ${ENTRYPOINT_V07}`,
    };
  }

  return {
    check: "EntryPoint v0.7",
    status: "pass",
    message: `Deployed at ${ENTRYPOINT_V07}`,
    details: { codeSize: code.length },
  };
}

async function validateSponsoredPaymaster(
  client: ReturnType<typeof createPublicClient>,
  paymasterAddress: Address | undefined
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  if (!paymasterAddress) {
    results.push({
      check: "SponsoredPaymaster Deployment",
      status: "warn",
      message: "No SPONSORED_PAYMASTER_ADDRESS configured",
    });
    return results;
  }

  // Check deployment
  const code = await client.getCode({ address: paymasterAddress });
  if (!code || code === "0x") {
    results.push({
      check: "SponsoredPaymaster Deployment",
      status: "fail",
      message: `Not deployed at ${paymasterAddress}`,
    });
    return results;
  }

  results.push({
    check: "SponsoredPaymaster Deployment",
    status: "pass",
    message: `Deployed at ${paymasterAddress}`,
  });

  // Check status
  const [deposit, isPaused, _totalTx, _totalGas] = await client.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "getStatus",
  });

  results.push({
    check: "SponsoredPaymaster Deposit",
    status: deposit > 0n ? "pass" : "fail",
    message: deposit > 0n 
      ? `Funded with ${formatEther(deposit)} ETH`
      : "No funds deposited - transactions will fail",
    details: { deposit: formatEther(deposit) },
  });

  results.push({
    check: "SponsoredPaymaster Paused",
    status: isPaused ? "warn" : "pass",
    message: isPaused ? "Paymaster is PAUSED" : "Paymaster is active",
  });

  // Check whitelist configuration
  const isAllWhitelisted = await client.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "isWhitelisted",
    args: ["0x0000000000000000000000000000000000000000" as Address],
  });

  results.push({
    check: "SponsoredPaymaster Whitelist",
    status: isAllWhitelisted ? "pass" : "warn",
    message: isAllWhitelisted 
      ? "All contracts whitelisted (sponsor everything)"
      : "Selective whitelist - only specific contracts sponsored",
  });

  // Check config values
  const maxGasCost = await client.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "maxGasCost",
  });

  const maxTxPerHour = await client.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "maxTxPerUserPerHour",
  });

  results.push({
    check: "SponsoredPaymaster Config",
    status: "pass",
    message: `Max gas: ${formatEther(maxGasCost)} ETH, Rate limit: ${maxTxPerHour}/hour`,
    details: {
      maxGasCost: formatEther(maxGasCost),
      maxTxPerHour: maxTxPerHour.toString(),
    },
  });

  // Check version
  const version = await client.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "version",
  });

  results.push({
    check: "SponsoredPaymaster Version",
    status: "pass",
    message: `Version ${version}`,
  });

  // Test canSponsor
  const testUser = "0x1234567890123456789012345678901234567890" as Address;
  const testTarget = "0x0000000000000000000000000000000000000001" as Address;
  const testGas = 1000000000000000n; // 0.001 ETH

  const [canSponsor, reason] = await client.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "canSponsor",
    args: [testUser, testTarget, testGas],
  });

  results.push({
    check: "SponsoredPaymaster canSponsor Test",
    status: canSponsor ? "pass" : "warn",
    message: canSponsor 
      ? "Test sponsorship check passed"
      : `Test sponsorship failed: ${reason}`,
    details: { canSponsor, reason },
  });

  return results;
}

async function validateSimpleAccountFactory(
  client: ReturnType<typeof createPublicClient>,
  factoryAddress: Address | undefined
): Promise<ValidationResult> {
  if (!factoryAddress) {
    return {
      check: "SimpleAccountFactory",
      status: "warn",
      message: "No SIMPLE_ACCOUNT_FACTORY_ADDRESS configured",
    };
  }

  const code = await client.getCode({ address: factoryAddress });
  if (!code || code === "0x") {
    return {
      check: "SimpleAccountFactory",
      status: "fail",
      message: `Not deployed at ${factoryAddress}`,
    };
  }

  return {
    check: "SimpleAccountFactory",
    status: "pass",
    message: `Deployed at ${factoryAddress}`,
    details: { codeSize: code.length },
  };
}

async function validateGameContracts(
  client: ReturnType<typeof createPublicClient>,
  paymasterAddress: Address | undefined,
  goldAddress: Address | undefined,
  itemsAddress: Address | undefined
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  if (!paymasterAddress) {
    return results;
  }

  // Check Gold contract whitelist
  if (goldAddress) {
    const isWhitelisted = await client.readContract({
      address: paymasterAddress,
      abi: SPONSORED_PAYMASTER_ABI,
      functionName: "isWhitelisted",
      args: [goldAddress],
    });

    results.push({
      check: "Gold Contract Whitelist",
      status: isWhitelisted ? "pass" : "warn",
      message: isWhitelisted 
        ? `Gold (${goldAddress}) is whitelisted`
        : `Gold (${goldAddress}) is NOT whitelisted`,
    });
  }

  // Check Items contract whitelist
  if (itemsAddress) {
    const isWhitelisted = await client.readContract({
      address: paymasterAddress,
      abi: SPONSORED_PAYMASTER_ABI,
      functionName: "isWhitelisted",
      args: [itemsAddress],
    });

    results.push({
      check: "Items Contract Whitelist",
      status: isWhitelisted ? "pass" : "warn",
      message: isWhitelisted 
        ? `Items (${itemsAddress}) is whitelisted`
        : `Items (${itemsAddress}) is NOT whitelisted`,
    });
  }

  return results;
}

// ============ Main ============

async function checkNodeAvailable(rpcUrl: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log("🔍 Validating Account Abstraction Infrastructure\n");

  // Parse arguments
  const args = process.argv.slice(2);
  const networkIdx = args.indexOf("--network");
  const network = networkIdx !== -1 ? args[networkIdx + 1] : "localnet";

  const config = getNetworkConfig(network);

  console.log(`Network: ${config.name}`);
  console.log(`Chain ID: ${config.chainId}`);
  console.log(`RPC URL: ${config.rpcUrl}\n`);

  // Check if node is available
  const nodeAvailable = await checkNodeAvailable(config.rpcUrl);
  if (!nodeAvailable) {
    console.log("❌ Cannot connect to RPC endpoint:", config.rpcUrl);
    console.log("\nTo run this validation:");
    console.log("  1. Start localnet: bun run localnet:start");
    console.log("  2. Or specify a different network: bun scripts/validate-aa.ts --network testnet");
    console.log("\nAlternatively, run the integration tests which start their own anvil instance:");
    console.log("  cd packages/deployment && bun test");
    process.exit(1);
  }

  // Create client
  const chain = {
    id: config.chainId,
    name: config.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  };

  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  // Run validations
  const results: ValidationResult[] = [];

  // 1. EntryPoint
  console.log("Checking EntryPoint v0.7...");
  results.push(await validateEntryPoint(client));

  // 2. SponsoredPaymaster
  console.log("Checking SponsoredPaymaster...");
  results.push(...await validateSponsoredPaymaster(client, config.sponsoredPaymaster));

  // 3. SimpleAccountFactory
  console.log("Checking SimpleAccountFactory...");
  results.push(await validateSimpleAccountFactory(client, config.simpleAccountFactory));

  // 4. Game Contract Whitelist
  console.log("Checking Game Contract Whitelist...");
  results.push(...await validateGameContracts(
    client,
    config.sponsoredPaymaster,
    config.goldContract,
    config.itemsContract
  ));

  // Print results
  console.log("\n" + "=".repeat(60));
  console.log("VALIDATION RESULTS");
  console.log("=".repeat(60) + "\n");

  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;

  for (const result of results) {
    const icon = result.status === "pass" ? "✅" : result.status === "fail" ? "❌" : "⚠️";
    console.log(`${icon} ${result.check}`);
    console.log(`   ${result.message}`);
    if (result.details) {
      console.log(`   Details: ${JSON.stringify(result.details)}`);
    }
    console.log();

    if (result.status === "pass") passCount++;
    else if (result.status === "fail") failCount++;
    else warnCount++;
  }

  // Summary
  console.log("=".repeat(60));
  console.log(`SUMMARY: ${passCount} passed, ${failCount} failed, ${warnCount} warnings`);
  console.log("=".repeat(60));

  if (failCount > 0) {
    console.log("\n❌ Validation FAILED - fix issues before proceeding");
    process.exit(1);
  } else if (warnCount > 0) {
    console.log("\n⚠️  Validation PASSED with warnings");
    process.exit(0);
  } else {
    console.log("\n✅ All validations PASSED");
    process.exit(0);
  }
}

// Run
main().catch((error) => {
  console.error("❌ Validation script failed:", error);
  process.exit(1);
});
