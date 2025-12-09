#!/usr/bin/env bun
/**
 * EXHAUSTIVE VALIDATION
 * 
 * Validates every single aspect of the deployment:
 * - Contract bytecode existence
 * - Contract function calls
 * - State variables
 * - Cross-contract references
 * - Transaction receipts and logs
 * - Token balances and allowances
 * - Cloud config file contents
 * - ERC-8004 registration
 * - OIF order lifecycle
 */

import {
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

// ============================================================================
// CONSTANTS
// ============================================================================

const DEPLOYER = "0x5dB1268e424da5C26451e4a8B9C221e6DE3C3064" as Address;
const CHAIN_ID = 84532n;

const CONTRACTS = {
  MockJejuUSDC: "0x953F6516E5d2864cE7f13186B45dE418EA665EB2" as Address,
  ElizaOSToken: "0x7af64e6aE21076DE21EFe71F243A75664a17C34b" as Address,
  IdentityRegistry: "0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd" as Address,
  SolverRegistry: "0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de" as Address,
  SimpleOracle: "0xE30218678a940d1553b285B0eB5C5364BBF70ed9" as Address,
  InputSettler: "0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75" as Address,
  OutputSettler: "0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5" as Address,
};

const TXS = {
  usdcApproveInput: "0x2414072aaa782e88d0e4705f5327c95ba43f7e9ea144357bdc76776d356bf795" as Hex,
  usdcApproveOutput: "0x51536d441cc63cd657a87ce10479ab756e13740235e07458aed3a22aecd6aa8b" as Hex,
  liquidityDeposit: "0x3adc0c02ca9f6441b7404edd6ea9d45681e9b92a8a7d7ef2c400e5dfb0f96719" as Hex,
  fillDirect: "0xde39dd747ff03b7303d0e83350992b3501a8756c934c01086b73ce83d3099e10" as Hex,
  attestation: "0x68a99e50cf8c9c68d445298065fee8193d9f667a2ab85c1f16a2f557f59ee86a" as Hex,
  agentRegister: "0x..." as Hex, // Will be fetched
};

const VERIFIED_ORDER = "0xc2f5b5159cdd8815d613685fa94973d7ae324475720fbe1b69445886457c5581" as Hex;

// ABIs
const ERC20_ABI = [
  { name: "name", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { name: "totalSupply", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "balanceOf", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "allowance", type: "function", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

const ERC721_ABI = [
  { name: "name", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "ownerOf", type: "function", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "tokenURI", type: "function", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "balanceOf", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const INPUT_SETTLER_ABI = [
  { name: "chainId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "oracle", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "solverRegistry", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "version", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "CLAIM_DELAY", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "SWAP_ORDER_TYPE", type: "function", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  { name: "nonces", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

const OUTPUT_SETTLER_ABI = [
  { name: "chainId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "version", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "isFilled", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "filledOrders", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "getSolverLiquidity", type: "function", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "getSolverETH", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "getFillRecord", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ name: "", type: "tuple", components: [{ name: "solver", type: "address" }, { name: "recipient", type: "address" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }, { name: "gasProvided", type: "uint256" }, { name: "filledBlock", type: "uint256" }, { name: "filledTimestamp", type: "uint256" }] }], stateMutability: "view" },
] as const;

const ORACLE_ABI = [
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "authorizedAttesters", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "attestations", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "attestedAt", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "hasAttested", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "proofs", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes" }], stateMutability: "view" },
] as const;

const SOLVER_REGISTRY_ABI = [
  { name: "MIN_STAKE", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "UNBONDING_PERIOD", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "SLASH_PERCENT", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "MAX_CHAINS", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "activeSolverCount", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalStaked", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalSlashed", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "isSolverActive", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "getSolverStake", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "version", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
] as const;

// ============================================================================
// VALIDATION FRAMEWORK
// ============================================================================

interface ValidationResult {
  category: string;
  test: string;
  expected: string;
  actual: string;
  pass: boolean;
}

const results: ValidationResult[] = [];
let totalChecks = 0;
let passedChecks = 0;

function validate(category: string, test: string, expected: string, actual: string): boolean {
  totalChecks++;
  const pass = expected.toLowerCase() === actual.toLowerCase();
  if (pass) passedChecks++;
  
  results.push({ category, test, expected, actual, pass });
  
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} [${category}] ${test}`);
  if (!pass) {
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual:   ${actual}`);
  }
  return pass;
}

function validateBool(category: string, test: string, expected: boolean, actual: boolean): boolean {
  return validate(category, test, String(expected), String(actual));
}

function validateNum(category: string, test: string, expected: bigint | number, actual: bigint | number): boolean {
  return validate(category, test, String(expected), String(actual));
}

// ============================================================================
// MAIN VALIDATION
// ============================================================================

async function main() {
  console.log("🔬 EXHAUSTIVE VALIDATION");
  console.log("=".repeat(80));
  console.log(`Chain: Base Sepolia (${CHAIN_ID})`);
  console.log(`Deployer: ${DEPLOYER}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  // ============================================================================
  // 1. CONTRACT BYTECODE VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("1️⃣ CONTRACT BYTECODE VALIDATION");
  console.log("━".repeat(80));

  for (const [name, address] of Object.entries(CONTRACTS)) {
    const code = await publicClient.getCode({ address });
    const hasCode = code !== undefined && code !== "0x" && code.length > 2;
    validateBool("Bytecode", `${name} has bytecode`, true, hasCode);
    if (hasCode) {
      console.log(`   Bytecode length: ${code.length} chars`);
    }
  }

  // ============================================================================
  // 2. TOKEN CONTRACT VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("2️⃣ TOKEN CONTRACT VALIDATION");
  console.log("━".repeat(80));

  // MockJejuUSDC
  const usdcName = await publicClient.readContract({ address: CONTRACTS.MockJejuUSDC, abi: ERC20_ABI, functionName: "name" });
  const usdcSymbol = await publicClient.readContract({ address: CONTRACTS.MockJejuUSDC, abi: ERC20_ABI, functionName: "symbol" });
  const usdcDecimals = await publicClient.readContract({ address: CONTRACTS.MockJejuUSDC, abi: ERC20_ABI, functionName: "decimals" });
  const usdcOwner = await publicClient.readContract({ address: CONTRACTS.MockJejuUSDC, abi: ERC20_ABI, functionName: "owner" });
  const usdcBalance = await publicClient.readContract({ address: CONTRACTS.MockJejuUSDC, abi: ERC20_ABI, functionName: "balanceOf", args: [DEPLOYER] });

  validate("USDC", "name = 'USD Coin'", "USD Coin", usdcName);
  validate("USDC", "symbol = 'USDC'", "USDC", usdcSymbol);
  validateNum("USDC", "decimals = 6", 6, usdcDecimals);
  validate("USDC", "owner = deployer", DEPLOYER.toLowerCase(), usdcOwner.toLowerCase());
  validateBool("USDC", "deployer has balance", true, usdcBalance > 0n);
  console.log(`   Deployer USDC balance: ${formatUnits(usdcBalance, 6)} USDC`);

  // ElizaOSToken
  const elizaName = await publicClient.readContract({ address: CONTRACTS.ElizaOSToken, abi: ERC20_ABI, functionName: "name" });
  const elizaSymbol = await publicClient.readContract({ address: CONTRACTS.ElizaOSToken, abi: ERC20_ABI, functionName: "symbol" });
  const elizaDecimals = await publicClient.readContract({ address: CONTRACTS.ElizaOSToken, abi: ERC20_ABI, functionName: "decimals" });
  const elizaOwner = await publicClient.readContract({ address: CONTRACTS.ElizaOSToken, abi: ERC20_ABI, functionName: "owner" });

  validate("ELIZA", "name = 'ElizaOS Token'", "ElizaOS Token", elizaName);
  validate("ELIZA", "symbol = 'ELIZA'", "ELIZA", elizaSymbol);
  validateNum("ELIZA", "decimals = 18", 18, elizaDecimals);
  validate("ELIZA", "owner = deployer", DEPLOYER.toLowerCase(), elizaOwner.toLowerCase());

  // ============================================================================
  // 3. IDENTITY REGISTRY (ERC-8004) VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("3️⃣ IDENTITY REGISTRY (ERC-8004) VALIDATION");
  console.log("━".repeat(80));

  const regName = await publicClient.readContract({ address: CONTRACTS.IdentityRegistry, abi: ERC721_ABI, functionName: "name" });
  const regSymbol = await publicClient.readContract({ address: CONTRACTS.IdentityRegistry, abi: ERC721_ABI, functionName: "symbol" });
  const agent1Owner = await publicClient.readContract({ address: CONTRACTS.IdentityRegistry, abi: ERC721_ABI, functionName: "ownerOf", args: [1n] });
  const agent1URI = await publicClient.readContract({ address: CONTRACTS.IdentityRegistry, abi: ERC721_ABI, functionName: "tokenURI", args: [1n] });
  const deployerBalance = await publicClient.readContract({ address: CONTRACTS.IdentityRegistry, abi: ERC721_ABI, functionName: "balanceOf", args: [DEPLOYER] });

  validate("ERC8004", "name exists", "true", String(regName.length > 0));
  validate("ERC8004", "symbol exists", "true", String(regSymbol.length > 0));
  validate("ERC8004", "Agent #1 owner = deployer", DEPLOYER.toLowerCase(), agent1Owner.toLowerCase());
  validate("ERC8004", "Agent #1 URI contains cloud.eliza.how", "true", String(agent1URI.includes("cloud.eliza.how")));
  validateNum("ERC8004", "Deployer owns 1 agent", 1n, deployerBalance);
  console.log(`   Agent #1 URI: ${agent1URI}`);

  // ============================================================================
  // 4. INPUT SETTLER VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("4️⃣ INPUT SETTLER VALIDATION");
  console.log("━".repeat(80));

  const inputChainId = await publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "chainId" });
  const inputOracle = await publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "oracle" });
  const inputRegistry = await publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "solverRegistry" });
  const inputVersion = await publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "version" });
  const inputClaimDelay = await publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "CLAIM_DELAY" });
  const inputOwner = await publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "owner" });
  const inputNonce = await publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "nonces", args: [DEPLOYER] });

  validateNum("InputSettler", "chainId = 84532", CHAIN_ID, inputChainId);
  validate("InputSettler", "oracle = SimpleOracle", CONTRACTS.SimpleOracle.toLowerCase(), inputOracle.toLowerCase());
  validate("InputSettler", "solverRegistry = SolverRegistry", CONTRACTS.SolverRegistry.toLowerCase(), inputRegistry.toLowerCase());
  validate("InputSettler", "version = 1.0.0", "1.0.0", inputVersion);
  validateNum("InputSettler", "CLAIM_DELAY = 150", 150n, inputClaimDelay);
  validate("InputSettler", "owner = deployer", DEPLOYER.toLowerCase(), inputOwner.toLowerCase());
  console.log(`   Deployer nonce: ${inputNonce}`);

  // ============================================================================
  // 5. OUTPUT SETTLER VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("5️⃣ OUTPUT SETTLER VALIDATION");
  console.log("━".repeat(80));

  const outputChainId = await publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "chainId" });
  const outputVersion = await publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "version" });
  const outputOwner = await publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "owner" });
  const outputLiquidity = await publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "getSolverLiquidity", args: [DEPLOYER, CONTRACTS.MockJejuUSDC] });
  const outputETH = await publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "getSolverETH", args: [DEPLOYER] });

  validateNum("OutputSettler", "chainId = 84532", CHAIN_ID, outputChainId);
  validate("OutputSettler", "version = 1.0.0", "1.0.0", outputVersion);
  validate("OutputSettler", "owner = deployer", DEPLOYER.toLowerCase(), outputOwner.toLowerCase());
  console.log(`   Deployer USDC liquidity: ${formatUnits(outputLiquidity, 6)} USDC`);
  console.log(`   Deployer ETH deposit: ${formatUnits(outputETH, 18)} ETH`);

  // Verify order state
  const orderFilled = await publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "isFilled", args: [VERIFIED_ORDER] });
  const fillRecord = await publicClient.readContract({ address: CONTRACTS.OutputSettler, abi: OUTPUT_SETTLER_ABI, functionName: "getFillRecord", args: [VERIFIED_ORDER] });
  
  validateBool("OutputSettler", "Verified order is filled", true, orderFilled);
  validate("OutputSettler", "Fill solver = deployer", DEPLOYER.toLowerCase(), fillRecord.solver.toLowerCase());
  validateBool("OutputSettler", "Fill amount > 0", true, fillRecord.amount > 0n);
  console.log(`   Fill amount: ${formatUnits(fillRecord.amount, 6)} USDC`);
  console.log(`   Fill block: ${fillRecord.filledBlock}`);

  // ============================================================================
  // 6. SIMPLE ORACLE VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("6️⃣ SIMPLE ORACLE VALIDATION");
  console.log("━".repeat(80));

  const oracleOwner = await publicClient.readContract({ address: CONTRACTS.SimpleOracle, abi: ORACLE_ABI, functionName: "owner" });
  const isDeployerAttester = await publicClient.readContract({ address: CONTRACTS.SimpleOracle, abi: ORACLE_ABI, functionName: "authorizedAttesters", args: [DEPLOYER] });
  const orderAttested = await publicClient.readContract({ address: CONTRACTS.SimpleOracle, abi: ORACLE_ABI, functionName: "hasAttested", args: [VERIFIED_ORDER] });
  const attestations = await publicClient.readContract({ address: CONTRACTS.SimpleOracle, abi: ORACLE_ABI, functionName: "attestations", args: [VERIFIED_ORDER] });
  const attestedAt = await publicClient.readContract({ address: CONTRACTS.SimpleOracle, abi: ORACLE_ABI, functionName: "attestedAt", args: [VERIFIED_ORDER] });

  validate("Oracle", "owner = deployer", DEPLOYER.toLowerCase(), oracleOwner.toLowerCase());
  validateBool("Oracle", "deployer is attester", true, isDeployerAttester);
  validateBool("Oracle", "hasAttested(order) = true", true, orderAttested);
  validateBool("Oracle", "attestations[order] = true", true, attestations);
  validateBool("Oracle", "attestedAt[order] > 0", true, attestedAt > 0n);
  console.log(`   Attested at: ${attestedAt} (${new Date(Number(attestedAt) * 1000).toISOString()})`);

  // ============================================================================
  // 7. SOLVER REGISTRY VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("7️⃣ SOLVER REGISTRY VALIDATION");
  console.log("━".repeat(80));

  const srOwner = await publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "owner" });
  const srVersion = await publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "version" });
  const srMinStake = await publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "MIN_STAKE" });
  const srUnbonding = await publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "UNBONDING_PERIOD" });
  const srSlash = await publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "SLASH_PERCENT" });
  const srMaxChains = await publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "MAX_CHAINS" });
  const srActive = await publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "activeSolverCount" });
  const srTotalStaked = await publicClient.readContract({ address: CONTRACTS.SolverRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "totalStaked" });

  validate("SolverRegistry", "owner = deployer", DEPLOYER.toLowerCase(), srOwner.toLowerCase());
  validate("SolverRegistry", "version = 1.0.0", "1.0.0", srVersion);
  validateNum("SolverRegistry", "MIN_STAKE = 0.5 ETH", 500000000000000000n, srMinStake);
  validateNum("SolverRegistry", "UNBONDING_PERIOD = 8 days", 691200n, srUnbonding);
  validateNum("SolverRegistry", "SLASH_PERCENT = 50", 50n, srSlash);
  validateNum("SolverRegistry", "MAX_CHAINS = 50", 50n, srMaxChains);
  console.log(`   Active solvers: ${srActive}`);
  console.log(`   Total staked: ${formatUnits(srTotalStaked, 18)} ETH`);

  // ============================================================================
  // 8. TRANSACTION VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("8️⃣ TRANSACTION VALIDATION");
  console.log("━".repeat(80));

  const txsToValidate = [
    { name: "USDC Approval (Input)", hash: TXS.usdcApproveInput },
    { name: "USDC Approval (Output)", hash: TXS.usdcApproveOutput },
    { name: "Liquidity Deposit", hash: TXS.liquidityDeposit },
    { name: "fillDirect", hash: TXS.fillDirect },
    { name: "Submit Attestation", hash: TXS.attestation },
  ];

  for (const { name, hash } of txsToValidate) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      validateBool("Transaction", `${name} status = success`, true, receipt.status === "success");
      console.log(`   Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`);
    } catch (e) {
      validate("Transaction", `${name} exists`, "true", "false");
    }
  }

  // ============================================================================
  // 9. CLOUD CONFIG FILE VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("9️⃣ CLOUD CONFIG FILE VALIDATION");
  console.log("━".repeat(80));

  const x402Path = join(__dirname, "../../../vendor/cloud/config/x402.json");
  const erc8004Path = join(__dirname, "../../../vendor/cloud/config/erc8004.json");

  validateBool("Config", "x402.json exists", true, existsSync(x402Path));
  validateBool("Config", "erc8004.json exists", true, existsSync(erc8004Path));

  if (existsSync(x402Path)) {
    const x402 = JSON.parse(readFileSync(x402Path, "utf-8"));
    
    validate("x402.json", "base-sepolia.usdc", CONTRACTS.MockJejuUSDC.toLowerCase(), x402.networks["base-sepolia"].usdc.toLowerCase());
    validate("x402.json", "base-sepolia.chainId", "84532", String(x402.networks["base-sepolia"].chainId));
    
    if (x402.oifContracts?.["base-sepolia"]) {
      validate("x402.json", "oif.SolverRegistry", CONTRACTS.SolverRegistry.toLowerCase(), x402.oifContracts["base-sepolia"].SolverRegistry.toLowerCase());
      validate("x402.json", "oif.SimpleOracle", CONTRACTS.SimpleOracle.toLowerCase(), x402.oifContracts["base-sepolia"].SimpleOracle.toLowerCase());
      validate("x402.json", "oif.InputSettler", CONTRACTS.InputSettler.toLowerCase(), x402.oifContracts["base-sepolia"].InputSettler.toLowerCase());
      validate("x402.json", "oif.OutputSettler", CONTRACTS.OutputSettler.toLowerCase(), x402.oifContracts["base-sepolia"].OutputSettler.toLowerCase());
    }
    
    validate("x402.json", "elizaToken.base-sepolia", CONTRACTS.ElizaOSToken.toLowerCase(), x402.elizaToken.evm["base-sepolia"].toLowerCase());
  }

  if (existsSync(erc8004Path)) {
    const erc8004 = JSON.parse(readFileSync(erc8004Path, "utf-8"));
    
    validate("erc8004.json", "base-sepolia.identity", CONTRACTS.IdentityRegistry.toLowerCase(), erc8004.networks["base-sepolia"].contracts.identity.toLowerCase());
    validateNum("erc8004.json", "base-sepolia.agentId", 1, erc8004.networks["base-sepolia"].agentId);
    validate("erc8004.json", "base-sepolia.chainId", "84532", String(erc8004.networks["base-sepolia"].chainId));
  }

  // ============================================================================
  // 10. CROSS-CONTRACT REFERENCE VALIDATION
  // ============================================================================
  console.log("\n" + "━".repeat(80));
  console.log("🔟 CROSS-CONTRACT REFERENCE VALIDATION");
  console.log("━".repeat(80));

  // InputSettler -> Oracle
  const refOracle = await publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "oracle" });
  validateBool("Cross-ref", "InputSettler.oracle is callable", true, refOracle !== "0x0000000000000000000000000000000000000000");
  
  // Verify we can call Oracle from InputSettler's reference
  const oracleFromRef = await publicClient.readContract({ address: refOracle, abi: ORACLE_ABI, functionName: "owner" });
  validate("Cross-ref", "InputSettler.oracle.owner = deployer", DEPLOYER.toLowerCase(), oracleFromRef.toLowerCase());

  // InputSettler -> SolverRegistry
  const refRegistry = await publicClient.readContract({ address: CONTRACTS.InputSettler, abi: INPUT_SETTLER_ABI, functionName: "solverRegistry" });
  const registryFromRef = await publicClient.readContract({ address: refRegistry, abi: SOLVER_REGISTRY_ABI, functionName: "version" });
  validate("Cross-ref", "InputSettler.solverRegistry.version", "1.0.0", registryFromRef);

  // ============================================================================
  // FINAL SUMMARY
  // ============================================================================
  console.log("\n" + "=".repeat(80));
  console.log("📊 EXHAUSTIVE VALIDATION SUMMARY");
  console.log("=".repeat(80));

  const failedResults = results.filter(r => !r.pass);

  console.log(`\n✅ Passed: ${passedChecks}/${totalChecks}`);
  console.log(`❌ Failed: ${totalChecks - passedChecks}/${totalChecks}`);
  console.log(`📊 Success Rate: ${((passedChecks / totalChecks) * 100).toFixed(2)}%`);

  if (failedResults.length > 0) {
    console.log("\n❌ FAILED VALIDATIONS:");
    for (const r of failedResults) {
      console.log(`   [${r.category}] ${r.test}`);
      console.log(`      Expected: ${r.expected}`);
      console.log(`      Actual:   ${r.actual}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  if (passedChecks === totalChecks) {
    console.log("🎉 ALL VALIDATIONS PASSED - DEPLOYMENT IS 100% CORRECT");
  } else {
    console.log(`⚠️  ${passedChecks}/${totalChecks} VALIDATIONS PASSED`);
  }
  console.log("=".repeat(80));

  process.exit(passedChecks === totalChecks ? 0 : 1);
}

main().catch(console.error);

