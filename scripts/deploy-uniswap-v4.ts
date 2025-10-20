#!/usr/bin/env bun

/**
 * Deploy Uniswap V4 to Jeju
 *
 * Uniswap V4 uses a singleton architecture with one PoolManager contract
 * instead of multiple Factory/Pair/Router contracts like V2.
 *
 * Key V4 Features:
 * - Single PoolManager contract (gas efficient)
 * - Hooks system for custom logic (8 lifecycle points)
 * - Flash accounting with transient storage (EIP-1153)
 * - Native ETH support (no WETH wrapping)
 * - Custom AMM curves
 *
 * Usage:
 *   PRIVATE_KEY=0x... bun run scripts/deploy-uniswap-v4.ts
 *
 * Environment:
 *   PRIVATE_KEY - Deployer private key (defaults to Anvil account 0 for localnet only)
 *   JEJU_RPC_URL - RPC endpoint (defaults to network-specific URLs)
 *   JEJU_NETWORK - mainnet | testnet | localnet (defaults to localnet)
 *   MIN_DEPLOYER_BALANCE - Minimum ETH balance required (defaults: 0.5 for testnet, 2.0 for mainnet)
 */

import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { getLocalnetRpcUrl } from "./shared/get-localnet-rpc";

const DEFAULT_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Network configuration
type NetworkConfig = {
	chainId: number;
	rpcUrl: string;
	minBalance: string; // in ETH
	gasBuffer: number; // multiplier for gas estimates
	confirmations: number;
};

const NETWORK_CONFIGS: Record<string, NetworkConfig> = {
	localnet: {
		chainId: 1337,
		rpcUrl: getLocalnetRpcUrl(), // Dynamically get port from Kurtosis
		minBalance: "0.1",
		gasBuffer: 1.1,
		confirmations: 1,
	},
	testnet: {
		chainId: 420690,
		rpcUrl: "https://testnet-rpc.jeju.network",
		minBalance: "0.5",
		gasBuffer: 1.2,
		confirmations: 3,
	},
	mainnet: {
		chainId: 420691,
		rpcUrl: "https://rpc.jeju.network",
		minBalance: "2.0",
		gasBuffer: 1.3,
		confirmations: 5,
	},
};

const network = process.env.JEJU_NETWORK || "localnet";
const networkConfig = NETWORK_CONFIGS[network];

if (!networkConfig) {
	console.error(`❌ Invalid network: ${network}`);
	console.error(`Valid networks: localnet, testnet, mainnet`);
	process.exit(1);
}

const rpcUrl = process.env.JEJU_RPC_URL || networkConfig.rpcUrl;
const privateKey = process.env.PRIVATE_KEY || (network === "localnet" ? DEFAULT_PRIVATE_KEY : "");
const minDeployerBalance = process.env.MIN_DEPLOYER_BALANCE || networkConfig.minBalance;

// Validation functions
async function validatePrivateKey(): Promise<void> {
	if (!privateKey || privateKey === "") {
		console.error("");
		console.error("❌ Error: PRIVATE_KEY environment variable is required for testnet/mainnet");
		console.error("");
		console.error("Usage:");
		console.error(`  PRIVATE_KEY=0x... JEJU_NETWORK=${network} bun run scripts/deploy-uniswap-v4.ts`);
		console.error("");
		process.exit(1);
	}

	if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
		console.error("❌ Error: Invalid private key format");
		console.error("Expected: 0x followed by 64 hexadecimal characters");
		process.exit(1);
	}
}

async function validateRpcConnection(publicClient: any): Promise<void> {
	console.log("Validating RPC connection...");

	try {
		const chainId = await publicClient.getChainId();

		if (chainId !== networkConfig.chainId) {
			console.error(`❌ Error: Chain ID mismatch`);
			console.error(`Expected: ${networkConfig.chainId}, Got: ${chainId}`);
			console.error("Please check JEJU_RPC_URL environment variable");
			process.exit(1);
		}

		const blockNumber = await publicClient.getBlockNumber();
		console.log(`✅ Connected to ${network} (Chain ID: ${chainId}, Block: ${blockNumber})`);
	} catch (error) {
		console.error("❌ Error: Failed to connect to RPC endpoint");
		console.error(`URL: ${rpcUrl}`);
		console.error(error);
		process.exit(1);
	}
}

async function validateDeployerBalance(publicClient: any, deployerAddress: string): Promise<void> {
	console.log("Checking deployer balance...");

	const balance = await publicClient.getBalance({ address: deployerAddress });
	const balanceInEth = formatEther(balance);
	const minBalance = parseFloat(minDeployerBalance);

	console.log(`Deployer: ${deployerAddress}`);
	console.log(`Balance: ${balanceInEth} ETH`);

	if (parseFloat(balanceInEth) < minBalance) {
		console.error(`❌ Error: Insufficient balance`);
		console.error(`Required: ${minBalance} ETH, Current: ${balanceInEth} ETH`);
		console.error("Please fund the deployer account before proceeding");
		process.exit(1);
	}

	console.log(`✅ Balance sufficient for deployment`);
}

async function checkExistingDeployment(): Promise<boolean> {
	const deploymentsDir = join(__dirname, "..", "contracts", "deployments");
	const filename = `uniswap-v4-${networkConfig.chainId}.json`;
	const path = join(deploymentsDir, filename);

	if (existsSync(path)) {
		console.log("");
		console.log("⚠️  Warning: Existing deployment found");
		console.log(`Path: ${path}`);

		try {
			const existing = JSON.parse(readFileSync(path, "utf-8"));
			console.log(`Previous deployment:`);
			console.log(`  PoolManager: ${existing.poolManager}`);
			console.log(`  Timestamp: ${new Date(existing.timestamp).toISOString()}`);
		} catch (e) {
			// Ignore parse errors
		}

		console.log("");
		console.log("This script will deploy a NEW PoolManager contract.");

		if (network !== "localnet") {
			console.log("⚠️  Proceeding will overwrite the deployment file.");
			console.log("Press Ctrl+C within 10 seconds to cancel...");
			await new Promise(resolve => setTimeout(resolve, 10000));
		}

		return true;
	}

	return false;
}

console.log("======================================================================");
console.log("Deploying Uniswap V4 to Jeju");
console.log("======================================================================");
console.log("");
console.log("Network:", network);
console.log("RPC URL:", rpcUrl);
console.log("Chain ID:", networkConfig.chainId);
console.log("Min Balance:", minDeployerBalance, "ETH");
console.log("");
console.log("🔥 Uniswap V4 Features:");
console.log("  ✅ Singleton PoolManager (gas efficient)");
console.log("  ✅ Hooks system (8 lifecycle points)");
console.log("  ✅ Flash accounting (EIP-1153)");
console.log("  ✅ Native ETH support");
console.log("  ✅ Custom AMM curves");
console.log("");

async function runForge(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn("forge", args, {
			cwd: join(__dirname, "..", "contracts"),
			stdio: ["inherit", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
			process.stdout.write(data);
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
			process.stderr.write(data);
		});

		proc.on("close", (code) => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new Error(`forge exited with code ${code}\n${stderr}`));
			}
		});
	});
}

async function deployPoolManager(deployerAddress: string): Promise<string> {
	console.log("======================================================================");
	console.log("Step 1: Deploying PoolManager Contract");
	console.log("======================================================================");
	console.log("");
	console.log("This is the core Uniswap V4 contract - a singleton that manages all pools.");
	console.log(`Initial owner: ${deployerAddress}`);
	console.log("");

	try {
		// Deploy PoolManager - the core V4 contract
		// Constructor takes initialOwner address
		const output = await runForge([
			"create",
			"--rpc-url",
			rpcUrl,
			"--private-key",
			privateKey,
			"--use",
			"0.8.26",
			"--broadcast",
			"lib/v4-core/src/PoolManager.sol:PoolManager",
			"--constructor-args",
			deployerAddress, // initial owner
		]);

		const match = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
		if (!match) {
			throw new Error("Failed to parse PoolManager address from forge output");
		}

		const poolManager = match[1];
		console.log("");
		console.log("✅ PoolManager deployed successfully!");
		console.log(`Address: ${poolManager}`);
		console.log("");

		return poolManager;
	} catch (error) {
		console.error("");
		console.error("❌ PoolManager deployment failed!");
		console.error("");
		console.error("Common causes:");
		console.error("  - Insufficient gas");
		console.error("  - Network connectivity issues");
		console.error("  - Contract compilation errors");
		console.error("");
		throw error;
	}
}

async function verifyDeployment(publicClient: any, poolManager: string): Promise<void> {
	console.log("======================================================================");
	console.log("Step 2: Verifying Deployment");
	console.log("======================================================================");
	console.log("");

	try {
		// Verify contract exists
		console.log("Checking contract code...");
		const code = await publicClient.getBytecode({ address: poolManager });

		if (!code || code === "0x") {
			throw new Error("No contract code found at PoolManager address");
		}

		console.log(`✅ Contract code verified (${code.length} bytes)`);

		// Wait for confirmations
		console.log(`Waiting for ${networkConfig.confirmations} confirmations...`);
		await new Promise(resolve => setTimeout(resolve, 2000 * networkConfig.confirmations));
		console.log("✅ Confirmations received");

	} catch (error) {
		console.error("");
		console.error("❌ Deployment verification failed!");
		console.error(error);
		throw error;
	}

	console.log("");
	console.log("✅ Deployment verified successfully!");
	console.log("");
}

function saveDeployment(poolManager: string, chainId: number, deployerAddress: string) {
	console.log("======================================================================");
	console.log("Step 3: Saving Deployment Information");
	console.log("======================================================================");
	console.log("");

	// L2 Standard WETH address (same across OP Stack chains)
	const weth = "0x4200000000000000000000000000000000000006";

	const deployment = {
		poolManager,
		weth,
		deployer: deployerAddress,
		chainId,
		network,
		timestamp: Date.now(),
		deployedAt: new Date().toISOString(),
		version: "v4",
		features: {
			singleton: true,
			hooks: true,
			flashAccounting: true,
			nativeETH: true,
		},
		notes: "Uniswap V4 PoolManager - Singleton architecture for all liquidity pools",
	};

	const deploymentsDir = join(__dirname, "..", "contracts", "deployments");
	if (!existsSync(deploymentsDir)) {
		mkdirSync(deploymentsDir, { recursive: true  });
	}

	const filename = `uniswap-v4-${chainId}.json`;
	const path = join(deploymentsDir, filename);

	writeFileSync(path, JSON.stringify(deployment, null, 2));
	console.log("✅ Deployment information saved");
	console.log(`Path: ${path}`);
	console.log("");
}

function printNextSteps(poolManager: string) {
	console.log("======================================================================");
	console.log("🎉 Deployment Complete!");
	console.log("======================================================================");
	console.log("");
	console.log("PoolManager Address:", poolManager);
	console.log("Network:", network);
	console.log("Chain ID:", networkConfig.chainId);
	console.log("");
	console.log("======================================================================");
	console.log("Next Steps");
	console.log("======================================================================");
	console.log("");
	console.log("1. Verify Deployment:");
	console.log(`   bun run scripts/verify-uniswap-v4-deployment.ts --network ${network}`);
	console.log("");
	console.log("2. Deploy Hooks (Optional):");
	console.log("   Hooks enable custom pool logic at 8 different lifecycle points:");
	console.log("   - beforeInitialize / afterInitialize");
	console.log("   - beforeModifyPosition / afterModifyPosition");
	console.log("   - beforeSwap / afterSwap");
	console.log("   - beforeDonate / afterDonate");
	console.log("");
	console.log("   Example hooks to consider:");
	console.log("   - Dynamic fee hooks (adjust fees based on volatility)");
	console.log("   - TWAMM hooks (time-weighted average market maker)");
	console.log("   - Limit order hooks");
	console.log("   - Volatility oracle hooks");
	console.log("   - Geomean oracle hooks");
	console.log("");
	console.log("3. Initialize Pools:");
	console.log("   Use PoolManager.initialize() to create new pools:");
	console.log("   - Specify token pair (currency0, currency1)");
	console.log("   - Set fee tier (e.g., 3000 = 0.3%)");
	console.log("   - Set tick spacing (e.g., 60)");
	console.log("   - Attach hooks contract (or address(0) for no hooks)");
	console.log("   - Set initial sqrt price");
	console.log("");
	console.log("4. Add Liquidity:");
	console.log("   Use PoolManager.modifyLiquidity() to provide liquidity");
	console.log("");
	console.log("5. Integration:");
	console.log("   Update your application constants:");
	console.log(`   UNISWAP_V4_POOL_MANAGER="${poolManager}"`);
	console.log(`   UNISWAP_V4_NETWORK="${network}"`);
	console.log("");
	console.log("======================================================================");
	console.log("Important Notes");
	console.log("======================================================================");
	console.log("");
	console.log("✅ No separate Router contract needed!");
	console.log("   V4 uses direct PoolManager interaction for all operations");
	console.log("");
	console.log("✅ Native ETH support!");
	console.log("   No WETH wrapping required for ETH trades");
	console.log("");
	console.log("✅ Flash accounting!");
	console.log("   Significantly lower gas costs vs V3");
	console.log("");
	console.log("📚 Documentation:");
	console.log("   - Uniswap V4 Docs: https://docs.uniswap.org/contracts/v4/overview");
	console.log("   - Hooks Guide: https://docs.uniswap.org/contracts/v4/guides/hooks/");
	console.log("   - Example Hooks: https://github.com/Uniswap/v4-periphery");
	console.log("");

	if (network === "mainnet") {
		console.log("⚠️  MAINNET DEPLOYMENT - Security Reminders:");
		console.log("   - Verify contract on block explorer");
		console.log("   - Transfer ownership to multisig if needed");
		console.log("   - Set up monitoring and alerts");
		console.log("   - Test with small amounts first");
		console.log("   - Have incident response plan ready");
		console.log("");
	}
}

// Main execution
async function main() {
	const startTime = Date.now();

	try {
		// Pre-deployment validations
		await validatePrivateKey();

		const account = privateKeyToAccount(privateKey as `0x${string}`);
		const deployerAddress = account.address;

		// Create public client for validations
		const publicClient = createPublicClient({
			transport: http(rpcUrl),
		});

		// Run all pre-deployment checks
		await validateRpcConnection(publicClient);
		await validateDeployerBalance(publicClient, deployerAddress);
		await checkExistingDeployment();

		console.log("======================================================================");
		console.log("Pre-deployment Validation Complete");
		console.log("======================================================================");
		console.log("");
		console.log("All checks passed! Starting deployment...");
		console.log("");

		// Deploy PoolManager
		const poolManager = await deployPoolManager(deployerAddress);

		// Verify deployment
		await verifyDeployment(publicClient, poolManager);

		// Save deployment info
		saveDeployment(poolManager, networkConfig.chainId, deployerAddress);

		// Print next steps
		printNextSteps(poolManager);

		const endTime = Date.now();
		const duration = ((endTime - startTime) / 1000).toFixed(2);

		console.log("======================================================================");
		console.log("Deployment Summary");
		console.log("======================================================================");
		console.log("");
		console.log(`✅ Deployment completed successfully in ${duration}s`);
		console.log(`Network: ${network}`);
		console.log(`Chain ID: ${networkConfig.chainId}`);
		console.log(`PoolManager: ${poolManager}`);
		console.log(`Deployer: ${deployerAddress}`);
		console.log("");

		process.exit(0);
	} catch (error) {
		console.error("");
		console.error("======================================================================");
		console.error("❌ Deployment Failed");
		console.error("======================================================================");
		console.error("");
		console.error(error);
		console.error("");
		console.error("Troubleshooting:");
		console.error("  1. Check your private key is correct");
		console.error("  2. Verify RPC endpoint is accessible");
		console.error("  3. Ensure deployer has sufficient ETH balance");
		console.error("  4. Check network connectivity");
		console.error("  5. Review error message above for specific details");
		console.error("");
		console.error("For more help, see:");
		console.error(`  documentation/deployment/uniswap-v4-${network}-checklist.md`);
		console.error("");
		process.exit(1);
	}
}

main();
