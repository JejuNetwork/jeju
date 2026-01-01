/**
 * E2E UserOp Test with Packed Format - Submits a real UserOperation through bundler
 *
 * Uses ERC-4337 v0.7 packed format for EntryPoint v0.9
 * Converts to bundler format (which may vary by bundler implementation)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseEther,
  keccak256,
  encodeAbiParameters,
  toHex,
  concat,
  pad,
  type Hex,
  hexToBigInt,
  encodePacked,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Contract addresses from deployment
const ENTRY_POINT = "0x547382C0D1b23f707918D3c83A77317B71Aa8470";
const SIMPLE_PAYMASTER = "0xb932C8342106776E73E39D695F3FFC3A9624eCE0";
const SIMPLE_ACCOUNT_FACTORY = "0x0Dd99d9f56A14E9D53b2DdC62D9f0bAbe806647A";

// URLs
const RPC_URL = "http://127.0.0.1:6546";
const BUNDLER_URL = "http://127.0.0.1:4337";

// Test accounts
const OWNER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const USER_PRIVATE_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // Account 2

// ABIs
const simpleAccountFactoryAbi = [
  {
    name: "createAccount",
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "ret", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    name: "getAddress",
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

const entryPointAbi = [
  {
    name: "getNonce",
    type: "function",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "depositTo",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    name: "handleOps",
    type: "function",
    inputs: [
      {
        name: "ops",
        type: "tuple[]",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const simpleAccountAbi = [
  {
    name: "execute",
    type: "function",
    inputs: [
      { name: "dest", type: "address" },
      { name: "value", type: "uint256" },
      { name: "func", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// Pack two uint128s into bytes32
function packUints(high: bigint, low: bigint): Hex {
  return concat([
    pad(toHex(high), { size: 16 }),
    pad(toHex(low), { size: 16 }),
  ]) as Hex;
}

// EIP-712 domain separator for EntryPoint
function getDomainSeparator(entryPoint: Hex, chainId: bigint): Hex {
  const domainTypeHash = keccak256(
    toHex(new TextEncoder().encode(
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    ))
  );
  const nameHash = keccak256(toHex(new TextEncoder().encode("ERC4337")));
  const versionHash = keccak256(toHex(new TextEncoder().encode("1")));

  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [domainTypeHash, nameHash, versionHash, chainId, entryPoint]
    )
  );
}

// Compute UserOp hash for v0.7 packed format using EIP-712
function computeUserOpHash(
  userOp: {
    sender: Hex;
    nonce: bigint;
    initCode: Hex;
    callData: Hex;
    accountGasLimits: Hex;
    preVerificationGas: bigint;
    gasFees: Hex;
    paymasterAndData: Hex;
  },
  entryPoint: Hex,
  chainId: bigint
): Hex {
  // PackedUserOperation type hash
  const typeHash = keccak256(
    toHex(new TextEncoder().encode(
      "PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)"
    ))
  );

  // Hash initCode and callData
  const hashInitCode = keccak256(userOp.initCode);
  const hashCallData = keccak256(userOp.callData);
  const hashPaymasterAndData = keccak256(userOp.paymasterAndData);

  // Struct hash
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        typeHash,
        userOp.sender,
        userOp.nonce,
        hashInitCode,
        hashCallData,
        userOp.accountGasLimits,
        userOp.preVerificationGas,
        userOp.gasFees,
        hashPaymasterAndData,
      ]
    )
  );

  // EIP-712 hash
  const domainSeparator = getDomainSeparator(entryPoint, chainId);
  return keccak256(
    concat(["0x1901" as Hex, domainSeparator, structHash])
  );
}

async function main() {
  console.log("====================================================");
  console.log("   E2E UserOperation Test - Direct handleOps");
  console.log("====================================================\n");

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  });

  const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY);
  const userAccount = privateKeyToAccount(USER_PRIVATE_KEY);

  const walletClient = createWalletClient({
    chain: foundry,
    transport: http(RPC_URL),
    account: ownerAccount,
  });

  // Step 1: Get or create smart account address
  console.log("1. Computing smart account address...");
  const salt = 0n;

  const accountAddress = await publicClient.readContract({
    address: SIMPLE_ACCOUNT_FACTORY,
    abi: simpleAccountFactoryAbi,
    functionName: "getAddress",
    args: [userAccount.address, salt],
  });

  console.log(`   User EOA: ${userAccount.address}`);
  console.log(`   Smart Account (counterfactual): ${accountAddress}`);

  // Check if account exists
  const code = await publicClient.getCode({ address: accountAddress });
  const accountExists = code !== undefined && code !== "0x";
  console.log(`   Account deployed: ${accountExists}`);

  // Step 2: Ensure paymaster has deposit at EntryPoint
  console.log("\n2. Checking paymaster deposit...");
  const paymasterDeposit = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: "balanceOf",
    args: [SIMPLE_PAYMASTER],
  });
  console.log(
    `   Paymaster deposit: ${paymasterDeposit} wei (${Number(paymasterDeposit) / 1e18} ETH)`
  );

  if (paymasterDeposit < parseEther("1")) {
    console.log("   Topping up paymaster deposit...");
    const hash = await walletClient.writeContract({
      address: ENTRY_POINT,
      abi: entryPointAbi,
      functionName: "depositTo",
      args: [SIMPLE_PAYMASTER],
      value: parseEther("5"),
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("   Deposited 5 ETH");
  }

  // Step 3: Get nonce
  console.log("\n3. Getting nonce...");
  const nonce = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: "getNonce",
    args: [accountAddress, 0n],
  });
  console.log(`   Nonce: ${nonce}`);

  // Step 4: Build UserOperation
  console.log("\n4. Building UserOperation (v0.7 packed format)...");

  // Create initCode if account doesn't exist
  let initCode: Hex = "0x";
  if (!accountExists) {
    const initCallData = encodeFunctionData({
      abi: simpleAccountFactoryAbi,
      functionName: "createAccount",
      args: [userAccount.address, salt],
    });
    initCode = concat([SIMPLE_ACCOUNT_FACTORY as Hex, initCallData]);
    console.log(`   InitCode length: ${initCode.length} bytes`);
  }

  // Simple execute call - just send 0 ETH to self (no-op)
  const executeCallData = encodeFunctionData({
    abi: simpleAccountAbi,
    functionName: "execute",
    args: [userAccount.address, 0n, "0x"],
  });
  console.log(`   CallData: ${executeCallData.slice(0, 20)}...`);

  // Gas parameters
  const verificationGasLimit = 500000n;
  const callGasLimit = 100000n;
  const maxPriorityFeePerGas = 1000000000n; // 1 gwei
  const maxFeePerGas = 2000000000n; // 2 gwei
  const preVerificationGas = 100000n;

  // Pack gas limits and fees for v0.7
  const accountGasLimits = packUints(verificationGasLimit, callGasLimit);
  const gasFees = packUints(maxPriorityFeePerGas, maxFeePerGas);

  // Paymaster data for v0.7: paymaster (20) | paymasterVerificationGasLimit (16) | paymasterPostOpGasLimit (16) | paymasterData
  // SimplePaymaster doesn't need any extra data
  const paymasterVerificationGasLimit = 100000n;
  const paymasterPostOpGasLimit = 50000n;
  
  const paymasterAndData = concat([
    SIMPLE_PAYMASTER as Hex,
    pad(toHex(paymasterVerificationGasLimit), { size: 16 }),
    pad(toHex(paymasterPostOpGasLimit), { size: 16 }),
  ]);
  
  console.log(`   PaymasterAndData: ${paymasterAndData}`);

  // Build the packed UserOperation
  const userOp = {
    sender: accountAddress,
    nonce,
    initCode,
    callData: executeCallData,
    accountGasLimits,
    preVerificationGas,
    gasFees,
    paymasterAndData,
  };

  // Step 5: Compute hash and sign
  console.log("\n5. Computing hash and signing...");

  const chainId = BigInt(await publicClient.getChainId());
  const userOpHash = computeUserOpHash(
    userOp,
    ENTRY_POINT as Hex,
    chainId
  );
  console.log(`   UserOp hash: ${userOpHash}`);

  // Sign with user's key (the account owner)
  // Note: SimpleAccount uses ECDSA.recover directly without EIP-191 prefix,
  // so we need to use a raw signature without the "\x19Ethereum Signed Message:\n32" prefix
  const signature = await userAccount.sign({
    hash: userOpHash,
  });
  console.log(`   Signature: ${signature.slice(0, 20)}...`);

  // Step 6: Submit directly to EntryPoint via handleOps
  console.log("\n6. Submitting directly to EntryPoint...");

  const fullUserOp = {
    ...userOp,
    signature,
  };

  try {
    const hash = await walletClient.writeContract({
      address: ENTRY_POINT,
      abi: entryPointAbi,
      functionName: "handleOps",
      args: [[fullUserOp], ownerAccount.address],
    });

    console.log(`   Transaction hash: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`   Status: ${receipt.status}`);
    console.log(`   Gas used: ${receipt.gasUsed}`);

    // Step 7: Verify account is now deployed
    console.log("\n7. Verifying final state...");
    const finalCode = await publicClient.getCode({ address: accountAddress });
    const finalDeployed = finalCode !== undefined && finalCode !== "0x";
    console.log(`   Smart account deployed: ${finalDeployed}`);

    if (finalDeployed) {
      console.log("\n====================================================");
      console.log("   SUCCESS - E2E Test Complete");
      console.log("====================================================");
      console.log("\nSummary:");
      console.log(`  - Smart Account: ${accountAddress}`);
      console.log(`  - Paymaster: ${SIMPLE_PAYMASTER}`);
      console.log(`  - EntryPoint: ${ENTRY_POINT}`);
      console.log(`  - Gas sponsored by paymaster`);
    }
  } catch (error) {
    console.log(`   Error: ${error}`);

    // Try to decode the error
    if (error instanceof Error && error.message.includes("revert")) {
      console.log("\n   Attempting to debug...");

      // Check if it's a validation failure
      console.log("   Common causes:");
      console.log("   - Signature validation failed");
      console.log("   - Paymaster validation failed");
      console.log("   - Factory deployment failed");
    }
    throw error;
  }
}

main().catch(console.error);

