#!/usr/bin/env bun
/**
 * Deploy and Validate Account Abstraction Infrastructure
 *
 * This script:
 * 1. Deploys a mock EntryPoint to the canonical address
 * 2. Deploys SponsoredPaymaster
 * 3. Configures the paymaster (fund, whitelist)
 * 4. Runs on-chain validation
 *
 * Usage:
 *   bun scripts/deploy-and-validate-aa.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  encodeDeployData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ============ Configuration ============

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337");

// Known deployment address from forge script
const SPONSORED_PAYMASTER_ADDRESS = process.env.SPONSORED_PAYMASTER_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;

// Anvil default account #0
const DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

// EntryPoint v0.7 canonical address
const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

// ============ ABIs ============

const SPONSORED_PAYMASTER_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "_entryPoint", type: "address" },
      { name: "_owner", type: "address" },
    ],
  },
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
    name: "setWhitelistedTarget",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "whitelisted", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "fund",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
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

const ENTRYPOINT_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "depositTo",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
  },
  {
    name: "supportsInterface",
    type: "function",
    stateMutability: "pure",
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ============ Mock EntryPoint Bytecode ============

// Minimal mock that supports the required interface
const MOCK_ENTRYPOINT_BYTECODE = "0x608060405234801561001057600080fd5b506103f8806100206000396000f3fe6080604052600436106100435760003560e01c806301ffc9a71461004857806370a0823114610088578063b760faf9146100b8578063c23a5cea146100ce575b600080fd5b34801561005457600080fd5b506100746100633660046102e8565b6001600160e01b0319161590565b604051901515815260200160405180910390f35b34801561009457600080fd5b506100a56100a3366004610311565b5490565b6040519081526020015b60405180910390f35b6100cc6100c6366004610311565b50565b005b3480156100da57600080fd5b506100cc6100e936600461033b565b600080546001600160a01b0319166001600160a01b0392909216919091179055565b6001600160a01b038116600090815260016020526040812080543492906101339084906103a0565b90915550506040516001600160a01b038216903480156108fc02916000818181858888f19350505050158015610170573d6000803e3d6000fd5b5050565b600060208083528351808285015260005b818110156101a157858101830151858201604001528201610185565b506000604082860101526040601f19601f8301168501019250505092915050565b634e487b7160e01b600052604160045260246000fd5b604051601f8201601f1916810167ffffffffffffffff81118282101715610201576102016101c2565b604052919050565b6001600160a01b038116811461021e57600080fd5b50565b600067ffffffffffffffff821115610243576102436101c2565b5060051b60200190565b600082601f83011261025e57600080fd5b8135602061027361026e83610221565b6101d8565b82815260059290921b8401810191818101908684111561029257600080fd5b8286015b848110156102ad5780358352918301918301610296565b509695505050505050565b60006001600160e01b0319821663283f548960e01b14806102e357506001600160e01b031982166301ffc9a760e01b145b92915050565b6000602082840312156102fa57600080fd5b81356001600160e01b03198116811461031257600080fd5b9392505050565b60006020828403121561032b57600080fd5b813561031281610209565b60006020828403121561034857600080fd5b813561031281610209565b60008060006060848603121561036857600080fd5b833561037381610209565b9250602084013561038381610209565b929592945050506040919091013590565b634e487b7160e01b600052601160045260246000fd5b808201808211156102e3576102e361039456fea264697066735822";

// ============ Setup ============

const chain = {
  id: CHAIN_ID,
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const account = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

// ============ Deployment Functions ============

async function deployMockEntryPoint(): Promise<void> {
  console.log("\n1️⃣  Deploying Mock EntryPoint...");

  // Check if already deployed
  const code = await publicClient.getCode({ address: ENTRYPOINT_V07 });
  if (code && code !== "0x") {
    console.log("   ✅ EntryPoint already deployed at", ENTRYPOINT_V07);
    return;
  }

  // Use anvil_setCode to deploy at canonical address
  await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "anvil_setCode",
      params: [ENTRYPOINT_V07, MOCK_ENTRYPOINT_BYTECODE],
      id: 1,
    }),
  });

  // Verify deployment
  const deployedCode = await publicClient.getCode({ address: ENTRYPOINT_V07 });
  if (!deployedCode || deployedCode === "0x") {
    throw new Error("Failed to deploy mock EntryPoint");
  }

  console.log("   ✅ Mock EntryPoint deployed at", ENTRYPOINT_V07);
}

async function deploySponsoredPaymaster(): Promise<Address> {
  console.log("\n2️⃣  Deploying SponsoredPaymaster...");

  // Load compiled bytecode
  const artifactPath = "/home/shaw/Documents/jeju/packages/contracts/out/SponsoredPaymaster.sol/SponsoredPaymaster.json";

  let bytecode: Hex;
  try {
    const artifact = await Bun.file(artifactPath).json();
    bytecode = artifact.bytecode.object as Hex;
    if (!bytecode || bytecode === "0x") {
      throw new Error("Empty bytecode");
    }
  } catch (e) {
    throw new Error(
      `SponsoredPaymaster artifact not found at ${artifactPath}. Run: cd packages/contracts && forge build. Error: ${e}`
    );
  }

  // Encode constructor args
  const deployData = encodeDeployData({
    abi: SPONSORED_PAYMASTER_ABI,
    bytecode,
    args: [ENTRYPOINT_V07, account.address],
  });

  // Deploy
  const hash = await walletClient.sendTransaction({
    data: deployData,
  });

  console.log("   Transaction:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error("Failed to deploy SponsoredPaymaster");
  }

  console.log("   ✅ SponsoredPaymaster deployed at", receipt.contractAddress);
  return receipt.contractAddress;
}

async function configurePaymaster(paymasterAddress: Address): Promise<void> {
  console.log("\n3️⃣  Configuring Paymaster...");

  // Fund with 10 ETH
  console.log("   Funding with 10 ETH...");
  const fundHash = await walletClient.writeContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "fund",
    value: parseEther("10"),
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
  console.log("   ✅ Funded");

  // Whitelist all contracts (address(0))
  console.log("   Whitelisting all contracts...");
  const whitelistHash = await walletClient.writeContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "setWhitelistedTarget",
    args: ["0x0000000000000000000000000000000000000000" as Address, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: whitelistHash });
  console.log("   ✅ All contracts whitelisted");
}

async function validateOnChain(paymasterAddress: Address): Promise<void> {
  console.log("\n4️⃣  On-Chain Validation...\n");

  const results: { check: string; status: "✅" | "❌"; message: string }[] = [];

  // Check EntryPoint
  const entryPointCode = await publicClient.getCode({ address: ENTRYPOINT_V07 });
  results.push({
    check: "EntryPoint Deployed",
    status: entryPointCode && entryPointCode !== "0x" ? "✅" : "❌",
    message: `at ${ENTRYPOINT_V07}`,
  });

  // Check Paymaster
  const paymasterCode = await publicClient.getCode({ address: paymasterAddress });
  results.push({
    check: "SponsoredPaymaster Deployed",
    status: paymasterCode && paymasterCode !== "0x" ? "✅" : "❌",
    message: `at ${paymasterAddress}`,
  });

  // Check owner
  const owner = await publicClient.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "owner",
  });
  results.push({
    check: "Owner Set",
    status: owner === account.address ? "✅" : "❌",
    message: owner as string,
  });

  // Check deposit
  const [deposit, isPaused] = await publicClient.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "getStatus",
  });
  results.push({
    check: "Paymaster Funded",
    status: deposit > 0n ? "✅" : "❌",
    message: `${formatEther(deposit)} ETH`,
  });
  results.push({
    check: "Paymaster Active",
    status: !isPaused ? "✅" : "❌",
    message: isPaused ? "PAUSED" : "Active",
  });

  // Check whitelist
  const allWhitelisted = await publicClient.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "isWhitelisted",
    args: ["0x0000000000000000000000000000000000000000" as Address],
  });
  results.push({
    check: "All Contracts Whitelisted",
    status: allWhitelisted ? "✅" : "❌",
    message: allWhitelisted ? "Yes (address(0))" : "No",
  });

  // Check config
  const maxGasCost = await publicClient.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "maxGasCost",
  });
  const maxTxPerHour = await publicClient.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "maxTxPerUserPerHour",
  });
  results.push({
    check: "Gas Limit Config",
    status: "✅",
    message: `Max ${formatEther(maxGasCost)} ETH/tx`,
  });
  results.push({
    check: "Rate Limit Config",
    status: "✅",
    message: `${maxTxPerHour} tx/user/hour`,
  });

  // Check version
  const version = await publicClient.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "version",
  });
  results.push({
    check: "Version",
    status: "✅",
    message: version,
  });

  // Test canSponsor
  const testUser = "0x1234567890123456789012345678901234567890" as Address;
  const testTarget = "0x0000000000000000000000000000000000000001" as Address;
  const [canSponsor, reason] = await publicClient.readContract({
    address: paymasterAddress,
    abi: SPONSORED_PAYMASTER_ABI,
    functionName: "canSponsor",
    args: [testUser, testTarget, parseEther("0.001")],
  });
  results.push({
    check: "canSponsor Test",
    status: canSponsor ? "✅" : "❌",
    message: canSponsor ? "Passed" : `Failed: ${reason}`,
  });

  // Check remaining tx for new user
  const remaining = await publicClient.readContract({
    address: paymasterAddress,
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
  console.log("   " + "=".repeat(56));
  console.log("   VALIDATION RESULTS");
  console.log("   " + "=".repeat(56));

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    console.log(`   ${result.status} ${result.check}: ${result.message}`);
    if (result.status === "✅") passed++;
    else failed++;
  }

  console.log("   " + "=".repeat(56));
  console.log(`   SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("   " + "=".repeat(56));

  if (failed > 0) {
    throw new Error(`Validation failed: ${failed} checks failed`);
  }
}

// ============ Main ============

async function main() {
  console.log("🚀 Deploying and Validating AA Infrastructure\n");
  console.log("Network:", chain.name);
  console.log("Chain ID:", chain.id);
  console.log("RPC URL:", RPC_URL);
  console.log("Deployer:", account.address);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Balance:", formatEther(balance), "ETH");

  // Deploy
  await deployMockEntryPoint();
  const paymasterAddress = await deploySponsoredPaymaster();
  await configurePaymaster(paymasterAddress);

  // Validate
  await validateOnChain(paymasterAddress);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`EntryPoint:         ${ENTRYPOINT_V07}`);
  console.log(`SponsoredPaymaster: ${paymasterAddress}`);
  console.log(`Owner:              ${account.address}`);
  console.log("=".repeat(60) + "\n");

  // Write deployment info
  const deploymentInfo = {
    network: "localnet",
    chainId: chain.id,
    timestamp: new Date().toISOString(),
    contracts: {
      entryPoint: ENTRYPOINT_V07,
      sponsoredPaymaster: paymasterAddress,
    },
    deployer: account.address,
  };

  const deploymentPath = "/home/shaw/Documents/jeju/packages/contracts/deployments/aa-localnet.json";
  await Bun.write(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`📝 Deployment info written to ${deploymentPath}\n`);
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:", error.message);
  process.exit(1);
});
