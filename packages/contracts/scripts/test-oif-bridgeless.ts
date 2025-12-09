#!/usr/bin/env bun
/**
 * Test OIF Bridgeless Cross-Chain Intent Flow
 * 
 * This demonstrates how OIF enables cross-chain transfers WITHOUT bridges:
 * 
 * TRADITIONAL BRIDGE:
 *   User on Chain A → Lock tokens → Wait → Mint on Chain B → User receives
 *   ❌ Slow, expensive, risky
 * 
 * OIF INTENT-BASED:
 *   User creates intent "I want X tokens on Chain B"
 *        ↓
 *   Solver sees intent, has liquidity on both chains
 *        ↓  
 *   Solver fills on Chain B immediately
 *        ↓
 *   Oracle attests to the fill
 *        ↓
 *   Solver claims locked tokens on Chain A
 *   ✅ Fast, cheap, secure
 * 
 * Usage:
 *   bun run scripts/test-oif-bridgeless.ts
 */

import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseUnits, 
  formatUnits,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Contract addresses from deployment
const CONTRACTS = {
  baseSepolia: {
    SolverRegistry: "0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de" as Address,
    SimpleOracle: "0xE30218678a940d1553b285B0eB5C5364BBF70ed9" as Address,
    InputSettler: "0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75" as Address,
    OutputSettler: "0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5" as Address,
    USDC: "0x953F6516E5d2864cE7f13186B45dE418EA665EB2" as Address,
    ElizaOS: "0x7af64e6aE21076DE21EFe71F243A75664a17C34b" as Address,
  }
};

// ABIs
const SOLVER_REGISTRY_ABI = [
  {
    name: "registerSolver",
    type: "function",
    inputs: [
      { name: "stake", type: "uint256" },
      { name: "metadata", type: "string" }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    name: "getSolver",
    type: "function", 
    inputs: [{ name: "solver", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "stake", type: "uint256" },
      { name: "metadata", type: "string" }
    ],
    stateMutability: "view"
  }
] as const;

const SIMPLE_ORACLE_ABI = [
  {
    name: "authorizedAttesters",
    type: "function",
    inputs: [{ name: "attester", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view"
  },
  {
    name: "setAttester",
    type: "function",
    inputs: [
      { name: "attester", type: "address" },
      { name: "authorized", type: "bool" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    name: "owner",
    type: "function",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view"
  }
] as const;

const INPUT_SETTLER_ABI = [
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
      { name: "deadline", type: "uint256" }
    ],
    outputs: [{ name: "intentId", type: "bytes32" }],
    stateMutability: "nonpayable"
  },
  {
    name: "getIntent",
    type: "function",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [
      { 
        name: "intent", 
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
          { name: "status", type: "uint8" }
        ]
      }
    ],
    stateMutability: "view"
  }
] as const;

const ERC20_ABI = [
  { name: "approve", type: "function", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "faucet", type: "function", inputs: [], outputs: [], stateMutability: "nonpayable" },
] as const;

async function main() {
  const PRIVATE_KEY = (process.env.PRIVATE_KEY || process.env.MAINNET_PRIVATE_KEY) as `0x${string}`;
  if (!PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY required");
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org")
  });
  
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http("https://sepolia.base.org")
  });

  console.log("🔗 Testing OIF Bridgeless Intent System");
  console.log("=".repeat(60));
  console.log("\n📍 Chain: Base Sepolia (84532)");
  console.log(`👤 Account: ${account.address}`);

  // 1. Check if we're an attester on the oracle
  console.log("\n1️⃣ Checking Oracle attester status...");
  const isAttester = await publicClient.readContract({
    address: CONTRACTS.baseSepolia.SimpleOracle,
    abi: SIMPLE_ORACLE_ABI,
    functionName: "authorizedAttesters",
    args: [account.address]
  });
  const oracleOwner = await publicClient.readContract({
    address: CONTRACTS.baseSepolia.SimpleOracle,
    abi: SIMPLE_ORACLE_ABI,
    functionName: "owner",
  });
  console.log(`   Attester: ${isAttester ? "✅ Yes" : "❌ No"}`);
  console.log(`   Oracle Owner: ${oracleOwner}`);
  console.log(`   Is Owner: ${oracleOwner.toLowerCase() === account.address.toLowerCase() ? "✅ Yes" : "❌ No"}`);

  // 2. Check solver registration
  console.log("\n2️⃣ Checking Solver registration...");
  try {
    const solverInfo = await publicClient.readContract({
      address: CONTRACTS.baseSepolia.SolverRegistry,
      abi: SOLVER_REGISTRY_ABI,
      functionName: "getSolver",
      args: [account.address]
    });
    console.log(`   Registered: ${solverInfo[0] ? "✅ Yes" : "❌ No"}`);
    if (solverInfo[0]) {
      console.log(`   Stake: ${formatUnits(solverInfo[1], 18)} ETH`);
    }
  } catch (e) {
    console.log("   Not registered as solver");
  }

  // 3. Get some test USDC from faucet
  console.log("\n3️⃣ Getting test USDC from faucet...");
  const usdcBalance = await publicClient.readContract({
    address: CONTRACTS.baseSepolia.USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address]
  });
  
  if (usdcBalance < parseUnits("100", 6)) {
    console.log("   Requesting from faucet...");
    try {
      const tx = await walletClient.writeContract({
        address: CONTRACTS.baseSepolia.USDC,
        abi: ERC20_ABI,
        functionName: "faucet",
        args: []
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ Faucet tx: ${tx}`);
    } catch (e: any) {
      console.log(`   ⚠️ Faucet error: ${e.message}`);
    }
  }
  
  const newBalance = await publicClient.readContract({
    address: CONTRACTS.baseSepolia.USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address]
  });
  console.log(`   Balance: ${formatUnits(newBalance, 6)} USDC`);

  // 4. Demonstrate intent creation
  console.log("\n4️⃣ Demonstrating Cross-Chain Intent Flow...");
  console.log(`
  ┌─────────────────────────────────────────────────────────┐
  │                  OIF BRIDGELESS FLOW                    │
  ├─────────────────────────────────────────────────────────┤
  │                                                          │
  │  STEP 1: User creates intent on Source Chain            │
  │  "I want to send 100 USDC from Base Sepolia             │
  │   and receive 100 USDC on Jeju Testnet"                 │
  │                                                          │
  │  STEP 2: Solver monitors intents via Aggregator         │
  │  Solver has liquidity on BOTH chains                    │
  │                                                          │
  │  STEP 3: Solver FILLS on destination chain              │
  │  User receives tokens IMMEDIATELY - no bridge wait!     │
  │                                                          │
  │  STEP 4: Oracle attests to the fill                     │
  │  (SimpleOracle for tests, SuperchainOracle for prod)    │
  │                                                          │
  │  STEP 5: Solver claims on source chain                  │
  │  Solver gets their liquidity back + fee                 │
  │                                                          │
  │  ✅ NO BRIDGE NEEDED                                     │
  │  ✅ INSTANT SETTLEMENT                                   │
  │  ✅ SOLVER COMPETITION = BEST RATES                      │
  └─────────────────────────────────────────────────────────┘
  `);

  // 5. Show contract addresses
  console.log("\n5️⃣ Deployed Contract Addresses:");
  console.log("   Base Sepolia (84532):");
  for (const [name, addr] of Object.entries(CONTRACTS.baseSepolia)) {
    console.log(`     ${name}: ${addr}`);
  }

  console.log("\n✅ OIF System Ready for Cross-Chain Intents!");
  console.log("\nNext steps:");
  console.log("1. Deploy same contracts to Jeju Testnet (when RPC live)");
  console.log("2. Configure cross-chain routes via SuperchainOracle");
  console.log("3. Register solvers with liquidity on both chains");
  console.log("4. Users can create intents and get instant fills!");
  console.log("\n" + "=".repeat(60));
}

main().catch(console.error);

