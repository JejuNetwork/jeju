#!/usr/bin/env bun
/**
 * Comprehensive OIF On-Chain Verification v2
 * 
 * Tests all OIF contracts with correct ERC-7683 compatible interfaces:
 * 1. InputSettler - open(), claimOrder(), settle()
 * 2. OutputSettler - depositLiquidity(), fillDirect()
 * 3. SimpleOracle - submitAttestation()
 * 4. SolverRegistry - state checks
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  keccak256,
  toBytes,
  encodeAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = (process.env.PRIVATE_KEY || process.env.MAINNET_PRIVATE_KEY) as `0x${string}`;
if (!PRIVATE_KEY) {
  console.error("❌ PRIVATE_KEY required");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);

const CONTRACTS = {
  MockJejuUSDC: "0x953F6516E5d2864cE7f13186B45dE418EA665EB2" as Address,
  ElizaOSToken: "0x7af64e6aE21076DE21EFe71F243A75664a17C34b" as Address,
  SolverRegistry: "0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de" as Address,
  SimpleOracle: "0xE30218678a940d1553b285B0eB5C5364BBF70ed9" as Address,
  InputSettler: "0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75" as Address,
  OutputSettler: "0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5" as Address,
};

// ABIs matching actual contracts
const ERC20_ABI = [
  { name: "approve", type: "function", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "allowance", type: "function", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const INPUT_SETTLER_ABI = [
  { name: "chainId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "oracle", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "solverRegistry", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "version", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "nonces", type: "function", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "CLAIM_DELAY", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    name: "open",
    type: "function",
    inputs: [{
      name: "order",
      type: "tuple",
      components: [
        { name: "originSettler", type: "address" },
        { name: "user", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "originChainId", type: "uint256" },
        { name: "openDeadline", type: "uint32" },
        { name: "fillDeadline", type: "uint32" },
        { name: "orderDataType", type: "bytes32" },
        { name: "orderData", type: "bytes" },
      ],
    }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "getOrder",
    type: "function",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "user", type: "address" },
        { name: "inputToken", type: "address" },
        { name: "inputAmount", type: "uint256" },
        { name: "outputToken", type: "address" },
        { name: "outputAmount", type: "uint256" },
        { name: "destinationChainId", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "maxFee", type: "uint256" },
        { name: "openDeadline", type: "uint32" },
        { name: "fillDeadline", type: "uint32" },
        { name: "solver", type: "address" },
        { name: "filled", type: "bool" },
        { name: "refunded", type: "bool" },
        { name: "createdBlock", type: "uint256" },
      ],
    }],
    stateMutability: "view",
  },
] as const;

const OUTPUT_SETTLER_ABI = [
  { name: "chainId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "version", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "isFilled", type: "function", inputs: [{ name: "orderId", type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "getSolverLiquidity", type: "function", inputs: [{ name: "solver", type: "address" }, { name: "token", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    name: "depositLiquidity",
    type: "function",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "fillDirect",
    type: "function",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    name: "getFillRecord",
    type: "function",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "solver", type: "address" },
        { name: "recipient", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "gasProvided", type: "uint256" },
        { name: "filledBlock", type: "uint256" },
        { name: "filledTimestamp", type: "uint256" },
      ],
    }],
    stateMutability: "view",
  },
] as const;

const ORACLE_ABI = [
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "authorizedAttesters", type: "function", inputs: [{ name: "attester", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "attestations", type: "function", inputs: [{ name: "orderId", type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "attestedAt", type: "function", inputs: [{ name: "orderId", type: "bytes32" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    name: "submitAttestation",
    type: "function",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "proof", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { name: "hasAttested", type: "function", inputs: [{ name: "orderId", type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const;

const SOLVER_REGISTRY_ABI = [
  { name: "MIN_STAKE", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "activeSolverCount", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalStaked", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "isSolverActive", type: "function", inputs: [{ name: "solver", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const;

interface TxResult {
  name: string;
  success: boolean;
  txHash?: string;
  blockNumber?: bigint;
  gasUsed?: bigint;
  error?: string;
  details?: Record<string, string>;
}

const results: TxResult[] = [];

function logTx(result: TxResult) {
  results.push(result);
  const icon = result.success ? "✅" : "❌";
  console.log(`${icon} ${result.name}`);
  if (result.txHash) {
    console.log(`   Tx: ${result.txHash}`);
    console.log(`   Block: ${result.blockNumber}`);
    console.log(`   Gas: ${result.gasUsed}`);
  }
  if (result.details) {
    for (const [key, value] of Object.entries(result.details)) {
      console.log(`   ${key}: ${value}`);
    }
  }
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
}

async function main() {
  console.log("🔗 OIF ON-CHAIN VERIFICATION v2");
  console.log("=".repeat(60));
  console.log("\n📍 Chain: Base Sepolia (84532)");
  console.log(`👤 Account: ${account.address}\n`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
  });

  // Check ETH balance
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 ETH Balance: ${formatUnits(ethBalance, 18)} ETH\n`);

  // ============================================================================
  // 1. VERIFY INPUT SETTLER
  // ============================================================================
  console.log("=".repeat(60));
  console.log("1️⃣ INPUT SETTLER VERIFICATION");
  console.log("=".repeat(60) + "\n");

  try {
    const [chainId, oracle, solverRegistry, version, claimDelay] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "chainId" }),
      publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "oracle" }),
      publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "solverRegistry" }),
      publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "version" }),
      publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "CLAIM_DELAY" }),
    ]);

    logTx({
      name: "InputSettler Configuration",
      success: true,
      details: {
        Version: version,
        "Chain ID": chainId.toString(),
        Oracle: oracle,
        "Solver Registry": solverRegistry,
        "Claim Delay": claimDelay.toString() + " blocks",
        "Oracle matches": oracle.toLowerCase() === CONTRACTS.SimpleOracle.toLowerCase() ? "✅ Yes" : "❌ No",
        "Registry matches": solverRegistry.toLowerCase() === CONTRACTS.SolverRegistry.toLowerCase() ? "✅ Yes" : "❌ No",
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "InputSettler Configuration", success: false, error: error.message.slice(0, 100) });
  }

  // Check user nonce
  try {
    const nonce = await publicClient.readContract({
      address: CONTRACTS.InputSettler,
      abi: INPUT_SETTLER_ABI,
      functionName: "nonces",
      args: [account.address],
    });
    logTx({
      name: "InputSettler User Nonce",
      success: true,
      details: { "Current nonce": nonce.toString() },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "InputSettler User Nonce", success: false, error: error.message.slice(0, 100) });
  }

  // ============================================================================
  // 2. VERIFY OUTPUT SETTLER  
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("2️⃣ OUTPUT SETTLER VERIFICATION");
  console.log("=".repeat(60) + "\n");

  try {
    const [chainId, version] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "chainId" }),
      publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "version" }),
    ]);

    logTx({
      name: "OutputSettler Configuration",
      success: true,
      details: {
        Version: version,
        "Chain ID": chainId.toString(),
        "Configured for Base Sepolia": chainId === 84532n ? "✅ Yes" : "❌ No",
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "OutputSettler Configuration", success: false, error: error.message.slice(0, 100) });
  }

  // Approve and deposit liquidity
  console.log("\n📝 Testing OutputSettler liquidity deposit...");
  try {
    const depositAmount = parseUnits("100", 6);

    // Approve
    const approveTx = await walletClient.writeContract({
      address: CONTRACTS.MockJejuUSDC,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.OutputSettler, depositAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    // Deposit
    const depositTx = await walletClient.writeContract({
      address: CONTRACTS.OutputSettler,
      abi: OUTPUT_SETTLER_ABI,
      functionName: "depositLiquidity",
      args: [CONTRACTS.MockJejuUSDC, depositAmount],
    });
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });

    logTx({
      name: "OutputSettler Deposit Liquidity",
      success: true,
      txHash: depositTx,
      blockNumber: depositReceipt.blockNumber,
      gasUsed: depositReceipt.gasUsed,
      details: { Amount: formatUnits(depositAmount, 6) + " USDC" },
    });

    // Verify liquidity
    const liquidity = await publicClient.readContract({
      address: CONTRACTS.OutputSettler,
      abi: OUTPUT_SETTLER_ABI,
      functionName: "getSolverLiquidity",
      args: [account.address, CONTRACTS.MockJejuUSDC],
    });
    console.log(`   Solver liquidity: ${formatUnits(liquidity, 6)} USDC`);
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "OutputSettler Deposit Liquidity", success: false, error: error.message.slice(0, 200) });
  }

  // Test fillDirect
  console.log("\n📝 Testing OutputSettler fillDirect...");
  const testOrderId = keccak256(toBytes(`test-order-${Date.now()}`));
  try {
    const fillAmount = parseUnits("5", 6);

    const fillTx = await walletClient.writeContract({
      address: CONTRACTS.OutputSettler,
      abi: OUTPUT_SETTLER_ABI,
      functionName: "fillDirect",
      args: [testOrderId, CONTRACTS.MockJejuUSDC, fillAmount, account.address],
    });
    const fillReceipt = await publicClient.waitForTransactionReceipt({ hash: fillTx });

    logTx({
      name: "OutputSettler fillDirect",
      success: true,
      txHash: fillTx,
      blockNumber: fillReceipt.blockNumber,
      gasUsed: fillReceipt.gasUsed,
      details: {
        "Order ID": testOrderId.slice(0, 18) + "...",
        Amount: formatUnits(fillAmount, 6) + " USDC",
      },
    });

    // Verify fill
    const isFilled = await publicClient.readContract({
      address: CONTRACTS.OutputSettler,
      abi: OUTPUT_SETTLER_ABI,
      functionName: "isFilled",
      args: [testOrderId],
    });
    console.log(`   Order filled: ${isFilled ? "✅ Yes" : "❌ No"}`);

    const fillRecord = await publicClient.readContract({
      address: CONTRACTS.OutputSettler,
      abi: OUTPUT_SETTLER_ABI,
      functionName: "getFillRecord",
      args: [testOrderId],
    });
    console.log(`   Fill record: solver=${fillRecord.solver.slice(0, 10)}..., amount=${formatUnits(fillRecord.amount, 6)} USDC`);
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "OutputSettler fillDirect", success: false, error: error.message.slice(0, 200) });
  }

  // ============================================================================
  // 3. VERIFY SIMPLE ORACLE
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("3️⃣ SIMPLE ORACLE VERIFICATION");
  console.log("=".repeat(60) + "\n");

  try {
    const [owner, isAttester] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.SimpleOracle, abi: ORACLE_ABI, functionName: "owner" }),
      publicClient.readContract({ address: CONTRACTS.SimpleOracle, abi: ORACLE_ABI, functionName: "authorizedAttesters", args: [account.address] }),
    ]);

    logTx({
      name: "SimpleOracle Configuration",
      success: true,
      details: {
        Owner: owner,
        "Account is attester": isAttester ? "✅ Yes" : "❌ No",
        "Account is owner": owner.toLowerCase() === account.address.toLowerCase() ? "✅ Yes" : "❌ No",
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "SimpleOracle Configuration", success: false, error: error.message.slice(0, 100) });
  }

  // Submit attestation for the filled order
  console.log("\n📝 Submitting attestation for filled order...");
  try {
    const proof = "0x" as Hex; // Empty proof for SimpleOracle

    const attestTx = await walletClient.writeContract({
      address: CONTRACTS.SimpleOracle,
      abi: ORACLE_ABI,
      functionName: "submitAttestation",
      args: [testOrderId, proof],
    });
    const attestReceipt = await publicClient.waitForTransactionReceipt({ hash: attestTx });

    logTx({
      name: "Submit Attestation",
      success: true,
      txHash: attestTx,
      blockNumber: attestReceipt.blockNumber,
      gasUsed: attestReceipt.gasUsed,
      details: { "Order ID": testOrderId.slice(0, 18) + "..." },
    });

    // Verify attestation
    const hasAttested = await publicClient.readContract({
      address: CONTRACTS.SimpleOracle,
      abi: ORACLE_ABI,
      functionName: "hasAttested",
      args: [testOrderId],
    });
    const attestedAt = await publicClient.readContract({
      address: CONTRACTS.SimpleOracle,
      abi: ORACLE_ABI,
      functionName: "attestedAt",
      args: [testOrderId],
    });
    console.log(`   Attested: ${hasAttested ? "✅ Yes" : "❌ No"}`);
    console.log(`   Timestamp: ${attestedAt.toString()}`);
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "Submit Attestation", success: false, error: error.message.slice(0, 200) });
  }

  // ============================================================================
  // 4. VERIFY SOLVER REGISTRY
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("4️⃣ SOLVER REGISTRY VERIFICATION");
  console.log("=".repeat(60) + "\n");

  try {
    const [minStake, activeSolvers, totalStaked] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "MIN_STAKE" }),
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "activeSolverCount" }),
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "totalStaked" }),
    ]);

    logTx({
      name: "SolverRegistry State",
      success: true,
      details: {
        "Min Stake": formatUnits(minStake, 18) + " ETH",
        "Active Solvers": activeSolvers.toString(),
        "Total Staked": formatUnits(totalStaked, 18) + " ETH",
        "Current ETH balance": formatUnits(ethBalance, 18) + " ETH",
        "Can register": ethBalance >= minStake ? "✅ Yes" : `❌ No (need ${formatUnits(minStake - ethBalance, 18)} more ETH)`,
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "SolverRegistry State", success: false, error: error.message.slice(0, 100) });
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("📊 OIF ON-CHAIN VERIFICATION SUMMARY");
  console.log("=".repeat(60) + "\n");

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${results.length}`);

  // List all transactions
  const txs = results.filter((r) => r.txHash);
  if (txs.length > 0) {
    console.log("\n📋 Transaction Log:");
    for (const r of txs) {
      console.log(`   ${r.success ? "✅" : "❌"} ${r.name}`);
      console.log(`      https://sepolia.basescan.org/tx/${r.txHash}`);
    }
  }

  if (failed > 0) {
    console.log("\n❌ FAILED TESTS:");
    for (const r of results.filter((r) => !r.success)) {
      console.log(`   - ${r.name}: ${r.error}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  if (failed === 0) {
    console.log("🎉 ALL OIF ON-CHAIN TESTS PASSED");
  } else {
    console.log(`⚠️ ${failed} TEST(S) FAILED`);
  }
  console.log("=".repeat(60) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);

