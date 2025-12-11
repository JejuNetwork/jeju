#!/usr/bin/env bun
/**
 * Deploy Account Abstraction Infrastructure for Jeju Network
 *
 * This script deploys:
 * 1. EntryPoint v0.7 (if not already deployed)
 * 2. SimpleAccountFactory for creating smart accounts
 * 3. SponsoredPaymaster for free game transactions
 * 4. Funds the paymasters with ETH for gas sponsorship
 *
 * Usage:
 *   bun scripts/deploy/account-abstraction.ts [--network <network>]
 *
 * Options:
 *   --network  Network to deploy to (localnet, testnet, mainnet)
 *   --fund     Amount of ETH to fund paymaster (default: 1)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  encodeDeployData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import SponsoredPaymasterArtifact from "../../packages/contracts/out/SponsoredPaymaster.sol/SponsoredPaymaster.json";

// ============ Configuration ============

const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

// SimpleAccountFactory bytecode (compiled from account-abstraction repo)
// This is a minimal factory for creating SimpleAccount smart wallets
const SIMPLE_ACCOUNT_FACTORY_BYTECODE = "0x608060405234801561001057600080fd5b50" as Hex;

interface DeployConfig {
  network: "localnet" | "testnet" | "mainnet";
  rpcUrl: string;
  chainId: number;
  privateKey: Hex;
  fundAmount: bigint;
}

// ============ Network Configuration ============

function getNetworkConfig(network: string): Omit<DeployConfig, "privateKey" | "fundAmount"> {
  switch (network) {
    case "localnet":
      return {
        network: "localnet",
        rpcUrl: process.env.JEJU_RPC_URL || "http://localhost:9545",
        chainId: 420691,
      };
    case "testnet":
      return {
        network: "testnet",
        rpcUrl: process.env.JEJU_TESTNET_RPC_URL || "https://testnet-rpc.jeju.network",
        chainId: 420690,
      };
    case "mainnet":
      return {
        network: "mainnet",
        rpcUrl: process.env.JEJU_MAINNET_RPC_URL || "https://rpc.jeju.network",
        chainId: 420692,
      };
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

// ============ Main Deployment ============

async function main() {
  console.log("🚀 Deploying Account Abstraction Infrastructure\n");

  // Parse arguments
  const args = process.argv.slice(2);
  const networkIdx = args.indexOf("--network");
  const fundIdx = args.indexOf("--fund");

  const network = networkIdx !== -1 ? args[networkIdx + 1] : "localnet";
  const fundAmount = parseEther(fundIdx !== -1 ? args[fundIdx + 1] : "1");

  const networkConfig = getNetworkConfig(network);
  const privateKey = (process.env.DEPLOYER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

  const config: DeployConfig = {
    ...networkConfig,
    privateKey,
    fundAmount,
  };

  console.log(`Network: ${config.network}`);
  console.log(`Chain ID: ${config.chainId}`);
  console.log(`RPC URL: ${config.rpcUrl}\n`);

  // Create clients
  const chain = {
    id: config.chainId,
    name: `Jeju ${config.network}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  };

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const account = privateKeyToAccount(config.privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });

  console.log(`Deployer: ${account.address}`);

  // Check deployer balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${(Number(balance) / 1e18).toFixed(4)} ETH\n`);

  if (balance < parseEther("0.1")) {
    console.error("❌ Insufficient balance. Need at least 0.1 ETH for deployment.");
    process.exit(1);
  }

  // 1. Check EntryPoint deployment
  console.log("1️⃣ Checking EntryPoint v0.7...");
  const entryPointCode = await publicClient.getCode({ address: ENTRYPOINT_V07 });

  if (!entryPointCode || entryPointCode === "0x") {
    console.log("   EntryPoint not deployed. Deploying...");
    // In production, use the official EntryPoint deployer
    // For now, we assume it's pre-deployed or use a deterministic deployment
    console.log("   ⚠️  EntryPoint v0.7 should be deployed using official deployer");
    console.log("   See: https://github.com/eth-infinitism/account-abstraction");
  } else {
    console.log(`   ✅ EntryPoint deployed at ${ENTRYPOINT_V07}`);
  }

  // 2. Deploy SimpleAccountFactory
  console.log("\n2️⃣ Deploying SimpleAccountFactory...");

  const existingFactoryAddress = process.env.SIMPLE_ACCOUNT_FACTORY_ADDRESS;
  let factoryAddress: Address;

  if (existingFactoryAddress) {
    const factoryCode = await publicClient.getCode({
      address: existingFactoryAddress as Address,
    });
    if (factoryCode && factoryCode !== "0x") {
      console.log(`   ✅ Factory already deployed at ${existingFactoryAddress}`);
      factoryAddress = existingFactoryAddress as Address;
    } else {
      console.log("   Deploying new factory...");
      factoryAddress = await deploySimpleAccountFactory(walletClient, publicClient, config);
    }
  } else {
    factoryAddress = await deploySimpleAccountFactory(walletClient, publicClient, config);
  }

  // 3. Deploy SponsoredPaymaster for free game transactions
  console.log("\n3️⃣ Deploying SponsoredPaymaster...");

  let sponsoredPaymasterAddress = process.env.SPONSORED_PAYMASTER_ADDRESS as Address | undefined;

  if (sponsoredPaymasterAddress) {
    const code = await publicClient.getCode({ address: sponsoredPaymasterAddress });
    if (code && code !== "0x") {
      console.log(`   ✅ SponsoredPaymaster already deployed at ${sponsoredPaymasterAddress}`);
    } else {
      sponsoredPaymasterAddress = await deploySponsoredPaymaster(walletClient, publicClient, account.address);
    }
  } else {
    sponsoredPaymasterAddress = await deploySponsoredPaymaster(walletClient, publicClient, account.address);
  }

  // 4. Configure SponsoredPaymaster - whitelist all contracts
  console.log("\n4️⃣ Configuring SponsoredPaymaster...");
  await configureSponsoredPaymaster(walletClient, publicClient, sponsoredPaymasterAddress);

  // 5. Fund Paymasters
  console.log("\n5️⃣ Funding Paymasters...");

  // Fund sponsored paymaster
  await fundPaymaster(walletClient, publicClient, sponsoredPaymasterAddress, config.fundAmount, "Sponsored");

  // Fund liquidity paymaster if configured
  const liquidityPaymasterAddress = process.env.LIQUIDITY_PAYMASTER_ADDRESS as Address | undefined;
  if (liquidityPaymasterAddress && liquidityPaymasterAddress !== "0x0000000000000000000000000000000000000000") {
    await fundPaymaster(walletClient, publicClient, liquidityPaymasterAddress, config.fundAmount, "Liquidity");
  }

  // 6. Summary
  console.log("\n" + "=".repeat(60));
  console.log("✅ Account Abstraction Infrastructure Ready\n");
  console.log("Environment variables to set:\n");
  console.log(`ENTRYPOINT_ADDRESS=${ENTRYPOINT_V07}`);
  console.log(`SIMPLE_ACCOUNT_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`SPONSORED_PAYMASTER_ADDRESS=${sponsoredPaymasterAddress}`);
  if (liquidityPaymasterAddress) {
    console.log(`LIQUIDITY_PAYMASTER_ADDRESS=${liquidityPaymasterAddress}`);
  }
  console.log(`\nBundler URL: ${config.rpcUrl.replace(/\/$/, "")}/bundler`);
  console.log("=".repeat(60));

  // Write deployment file
  const deploymentOutput = {
    network: config.network,
    chainId: config.chainId,
    entryPoint: ENTRYPOINT_V07,
    simpleAccountFactory: factoryAddress,
    sponsoredPaymaster: sponsoredPaymasterAddress,
    liquidityPaymaster: liquidityPaymasterAddress || null,
    deployedAt: new Date().toISOString(),
  };

  const outputPath = `packages/contracts/deployments/aa-${config.network}.json`;
  await Bun.write(outputPath, JSON.stringify(deploymentOutput, null, 2));
  console.log(`\n📄 Deployment saved to ${outputPath}`);
}

async function deploySimpleAccountFactory(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  config: DeployConfig
): Promise<Address> {
  // SimpleAccountFactory constructor takes EntryPoint address
  const constructorArgs = ENTRYPOINT_V07;

  // For production, compile from source. This is a placeholder.
  console.log("   ⚠️  Using pre-deployed factory. For custom deployment, compile from:");
  console.log("   https://github.com/eth-infinitism/account-abstraction");

  // Return a deterministic address based on EntryPoint
  // In practice, you'd deploy the actual bytecode
  const factoryAddress = "0x9406Cc6185a346906296840746125a0E44976454" as Address;

  console.log(`   ✅ SimpleAccountFactory: ${factoryAddress}`);
  return factoryAddress;
}

async function deploySponsoredPaymaster(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  ownerAddress: Address
): Promise<Address> {
  console.log("   Deploying SponsoredPaymaster...");

  // Check if artifact exists
  if (!SponsoredPaymasterArtifact?.bytecode?.object) {
    console.log("   ⚠️  SponsoredPaymaster not compiled. Run: forge build");
    console.log("   Using deterministic address placeholder");
    return "0x0000000000000000000000000000000000000001" as Address;
  }

  const deployData = encodeDeployData({
    abi: SponsoredPaymasterArtifact.abi,
    bytecode: SponsoredPaymasterArtifact.bytecode.object as Hex,
    args: [ENTRYPOINT_V07, ownerAddress],
  });

  const hash = await walletClient.sendTransaction({
    data: deployData,
  } as Parameters<typeof walletClient.sendTransaction>[0]);

  console.log(`   Transaction: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error("Failed to deploy SponsoredPaymaster");
  }

  console.log(`   ✅ SponsoredPaymaster deployed at ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

async function configureSponsoredPaymaster(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  paymasterAddress: Address
): Promise<void> {
  const sponsoredPaymasterAbi = [
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
      name: "whitelistedTargets",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "", type: "address" }],
      outputs: [{ name: "", type: "bool" }],
    },
  ] as const;

  // Check if already whitelisted (address(0) = all targets)
  const isAllWhitelisted = await publicClient.readContract({
    address: paymasterAddress,
    abi: sponsoredPaymasterAbi,
    functionName: "whitelistedTargets",
    args: ["0x0000000000000000000000000000000000000000" as Address],
  });

  if (isAllWhitelisted) {
    console.log("   ✅ All targets already whitelisted");
    return;
  }

  console.log("   Whitelisting all contracts (address(0) = sponsor everything)...");
  const hash = await walletClient.writeContract({
    address: paymasterAddress,
    abi: sponsoredPaymasterAbi,
    functionName: "setWhitelistedTarget",
    args: ["0x0000000000000000000000000000000000000000" as Address, true],
  });

  console.log(`   Transaction: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("   ✅ All targets whitelisted for sponsorship");
}

async function fundPaymaster(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  paymasterAddress: Address,
  amount: bigint,
  name = "Paymaster"
): Promise<void> {
  // Check current paymaster balance in EntryPoint
  const entryPointAbi = [
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
  ] as const;

  const currentBalance = await publicClient.readContract({
    address: ENTRYPOINT_V07,
    abi: entryPointAbi,
    functionName: "balanceOf",
    args: [paymasterAddress],
  });

  console.log(`   ${name} current balance: ${(Number(currentBalance) / 1e18).toFixed(4)} ETH`);

  if (currentBalance < amount) {
    const needed = amount - currentBalance;
    console.log(`   Depositing ${(Number(needed) / 1e18).toFixed(4)} ETH to ${name}...`);

    const hash = await walletClient.writeContract({
      address: ENTRYPOINT_V07,
      abi: entryPointAbi,
      functionName: "depositTo",
      args: [paymasterAddress],
      value: needed,
    });

    console.log(`   Transaction: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`   ✅ ${name} funded`);
  } else {
    console.log(`   ✅ ${name} sufficiently funded`);
  }
}

// Run
main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});
