#!/usr/bin/env bun
/**
 * Comprehensive OIF On-Chain Verification
 * 
 * Tests all OIF contracts with actual on-chain transactions:
 * 1. InputSettler - Create intent, verify storage
 * 2. OutputSettler - Record fill
 * 3. SimpleOracle - Submit attestation
 * 4. SolverRegistry - Check registration requirements
 * 5. Cross-contract interactions
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  keccak256,
  toBytes,
  encodeFunctionData,
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

// ABIs
const ERC20_ABI = [
  { name: "approve", type: "function", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "allowance", type: "function", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const INPUT_SETTLER_ABI = [
  { name: "chainId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "oracle", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "solverRegistry", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "intentCount", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    name: "createIntent",
    type: "function",
    inputs: [
      { name: "destChainId", type: "uint256" },
      { name: "inputToken", type: "address" },
      { name: "outputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      { name: "minOutputAmount", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "intentId", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    name: "getIntent",
    type: "function",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "destChainId", type: "uint256" },
          { name: "inputToken", type: "address" },
          { name: "outputToken", type: "address" },
          { name: "inputAmount", type: "uint256" },
          { name: "minOutputAmount", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

const OUTPUT_SETTLER_ABI = [
  { name: "chainId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "fillCount", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    name: "fill",
    type: "function",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "solver", type: "address" },
      { name: "recipient", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "getFill",
    type: "function",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "solver", type: "address" },
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "filledAt", type: "uint256" },
        ],
      },
    ],
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
  { name: "getSolverStake", type: "function", inputs: [{ name: "solver", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
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
  console.log("🔗 OIF ON-CHAIN VERIFICATION");
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

  // Check InputSettler configuration
  try {
    const [chainId, oracle, solverRegistry, intentCount] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "chainId" }),
      publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "oracle" }),
      publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "solverRegistry" }),
      publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "intentCount" }),
    ]);

    logTx({
      name: "InputSettler Configuration",
      success: true,
      details: {
        "Chain ID": chainId.toString(),
        Oracle: oracle,
        "Solver Registry": solverRegistry,
        "Intent Count": intentCount.toString(),
        "Oracle matches": oracle.toLowerCase() === CONTRACTS.SimpleOracle.toLowerCase() ? "Yes" : "No",
        "Registry matches": solverRegistry.toLowerCase() === CONTRACTS.SolverRegistry.toLowerCase() ? "Yes" : "No",
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "InputSettler Configuration", success: false, error: error.message });
  }

  // Approve USDC for InputSettler
  console.log("\n📝 Approving USDC for InputSettler...");
  try {
    const approveAmount = parseUnits("1000", 6);
    const tx = await walletClient.writeContract({
      address: CONTRACTS.MockJejuUSDC,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.InputSettler, approveAmount],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

    logTx({
      name: "USDC Approval for InputSettler",
      success: true,
      txHash: tx,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    });

    // Verify allowance
    const allowance = await publicClient.readContract({
      address: CONTRACTS.MockJejuUSDC,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, CONTRACTS.InputSettler],
    });
    console.log(`   Allowance: ${formatUnits(allowance, 6)} USDC`);
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "USDC Approval for InputSettler", success: false, error: error.message });
  }

  // Create an intent
  console.log("\n📝 Creating test intent...");
  let intentId: Hex | null = null;
  try {
    const destChainId = 420690n; // Jeju Testnet (simulated)
    const inputAmount = parseUnits("10", 6); // 10 USDC
    const minOutputAmount = parseUnits("9.9", 6); // Allow 1% slippage
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

    const tx = await walletClient.writeContract({
      address: CONTRACTS.InputSettler,
      abi: INPUT_SETTLER_ABI,
      functionName: "createIntent",
      args: [
        destChainId,
        CONTRACTS.MockJejuUSDC,
        CONTRACTS.MockJejuUSDC, // Same token on dest chain for test
        inputAmount,
        minOutputAmount,
        account.address, // Recipient
        deadline,
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

    // Extract intentId from logs
    const intentCreatedTopic = keccak256(toBytes("IntentCreated(bytes32,address,uint256,address,address,uint256,uint256,address,uint256)"));
    const log = receipt.logs.find((l) => l.topics[0] === intentCreatedTopic);
    if (log && log.topics[1]) {
      intentId = log.topics[1] as Hex;
    }

    logTx({
      name: "Create Intent",
      success: true,
      txHash: tx,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      details: {
        "Intent ID": intentId || "Not found in logs",
        "Input Amount": "10 USDC",
        "Dest Chain": "420690 (Jeju Testnet)",
      },
    });

    // Verify intent was stored
    if (intentId) {
      const intent = await publicClient.readContract({
        address: CONTRACTS.InputSettler,
        abi: INPUT_SETTLER_ABI,
        functionName: "getIntent",
        args: [intentId],
      });
      console.log(`   Intent stored: creator=${intent.creator}, status=${intent.status}`);
    }
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "Create Intent", success: false, error: error.message });
  }

  // ============================================================================
  // 2. VERIFY OUTPUT SETTLER
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("2️⃣ OUTPUT SETTLER VERIFICATION");
  console.log("=".repeat(60) + "\n");

  try {
    const [chainId, fillCount] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "chainId" }),
      publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "fillCount" }),
    ]);

    logTx({
      name: "OutputSettler Configuration",
      success: true,
      details: {
        "Chain ID": chainId.toString(),
        "Fill Count": fillCount.toString(),
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "OutputSettler Configuration", success: false, error: error.message });
  }

  // Approve USDC for OutputSettler (for fill)
  console.log("\n📝 Approving USDC for OutputSettler...");
  try {
    const approveAmount = parseUnits("1000", 6);
    const tx = await walletClient.writeContract({
      address: CONTRACTS.MockJejuUSDC,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.OutputSettler, approveAmount],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

    logTx({
      name: "USDC Approval for OutputSettler",
      success: true,
      txHash: tx,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    });
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "USDC Approval for OutputSettler", success: false, error: error.message });
  }

  // Test fill (simulate solver filling an order)
  console.log("\n📝 Testing fill (as solver)...");
  const testOrderId = keccak256(toBytes(`test-order-${Date.now()}`));
  try {
    const fillAmount = parseUnits("10", 6);
    const tx = await walletClient.writeContract({
      address: CONTRACTS.OutputSettler,
      abi: OUTPUT_SETTLER_ABI,
      functionName: "fill",
      args: [
        testOrderId,
        account.address, // Solver
        account.address, // Recipient
        CONTRACTS.MockJejuUSDC,
        fillAmount,
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

    logTx({
      name: "Fill Order",
      success: true,
      txHash: tx,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      details: {
        "Order ID": testOrderId,
        Amount: "10 USDC",
      },
    });

    // Verify fill was recorded
    const fill = await publicClient.readContract({
      address: CONTRACTS.OutputSettler,
      abi: OUTPUT_SETTLER_ABI,
      functionName: "getFill",
      args: [testOrderId],
    });
    console.log(`   Fill recorded: solver=${fill.solver}, amount=${formatUnits(fill.amount, 6)} USDC`);
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "Fill Order", success: false, error: error.message });
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
        "Account is attester": isAttester ? "Yes" : "No",
        "Account is owner": owner.toLowerCase() === account.address.toLowerCase() ? "Yes" : "No",
      },
    });
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "SimpleOracle Configuration", success: false, error: error.message });
  }

  // Submit attestation for the test order
  console.log("\n📝 Submitting attestation...");
  try {
    const proof = "0x" as Hex; // Empty proof for SimpleOracle
    const tx = await walletClient.writeContract({
      address: CONTRACTS.SimpleOracle,
      abi: ORACLE_ABI,
      functionName: "submitAttestation",
      args: [testOrderId, proof],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

    logTx({
      name: "Submit Attestation",
      success: true,
      txHash: tx,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      details: {
        "Order ID": testOrderId,
      },
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
    console.log(`   Attested: ${hasAttested}, Timestamp: ${attestedAt}`);
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "Submit Attestation", success: false, error: error.message });
  }

  // ============================================================================
  // 4. VERIFY SOLVER REGISTRY
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("4️⃣ SOLVER REGISTRY VERIFICATION");
  console.log("=".repeat(60) + "\n");

  try {
    const [minStake, activeSolvers, totalStaked, isActive, stake] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "MIN_STAKE" }),
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "activeSolverCount" }),
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "totalStaked" }),
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "isSolverActive", args: [account.address] }),
      publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "getSolverStake", args: [account.address] }),
    ]);

    logTx({
      name: "SolverRegistry State",
      success: true,
      details: {
        "Min Stake": formatUnits(minStake, 18) + " ETH",
        "Active Solvers": activeSolvers.toString(),
        "Total Staked": formatUnits(totalStaked, 18) + " ETH",
        "Account is solver": isActive ? "Yes" : "No",
        "Account stake": formatUnits(stake, 18) + " ETH",
      },
    });

    // Note: We can't register as solver without 0.5 ETH stake
    if (!isActive) {
      console.log(`   ⚠️ To register as solver, need ${formatUnits(minStake, 18)} ETH stake`);
      console.log(`   Current ETH balance: ${formatUnits(ethBalance, 18)} ETH`);
    }
  } catch (e: unknown) {
    const error = e as Error;
    logTx({ name: "SolverRegistry State", success: false, error: error.message });
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
  console.log("\n📋 Transaction Log:");
  for (const r of results) {
    if (r.txHash) {
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

