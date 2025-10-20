#!/usr/bin/env bun

/**
 * Verify Uniswap V4 Deployment
 *
 * This script verifies that Uniswap V4 has been deployed correctly on Jeju.
 * It checks:
 * - PoolManager contract is deployed and has code
 * - Contract ownership is set correctly
 * - Deployment file exists and is valid
 * - Network matches expected configuration
 *
 * Usage:
 *   bun run scripts/verify-uniswap-v4-deployment.ts --network <network>
 *
 * Options:
 *   --network <network>  - Network to verify (localnet, testnet, mainnet)
 *   --verbose            - Show detailed output
 */

import { createPublicClient, http, parseAbi } from "viem";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getLocalnetRpcUrl } from "./shared/get-localnet-rpc";

// Parse command line arguments
const args = process.argv.slice(2);
const networkIndex = args.indexOf("--network");
const verbose = args.includes("--verbose");

const network = networkIndex !== -1 ? args[networkIndex + 1] : "localnet";

// Network configuration
type NetworkConfig = {
	chainId: number;
	rpcUrl: string;
	name: string;
};

const NETWORK_CONFIGS: Record<string, NetworkConfig> = {
	localnet: {
		chainId: 1337,
		rpcUrl: getLocalnetRpcUrl(), // Dynamically get port from Kurtosis
		name: "Jeju Localnet",
	},
	testnet: {
		chainId: 420690,
		rpcUrl: process.env.JEJU_TESTNET_RPC_URL || "https://testnet-rpc.jeju.network",
		name: "Jeju Testnet",
	},
	mainnet: {
		chainId: 420691,
		rpcUrl: process.env.JEJU_MAINNET_RPC_URL || "https://rpc.jeju.network",
		name: "Jeju Mainnet",
	},
};

const networkConfig = NETWORK_CONFIGS[network];

if (!networkConfig) {
	console.error(`❌ Invalid network: ${network}`);
	console.error(`Valid networks: localnet, testnet, mainnet`);
	process.exit(1);
}

console.log("======================================================================");
console.log("Verifying Uniswap V4 Deployment");
console.log("======================================================================");
console.log("");
console.log("Network:", networkConfig.name);
console.log("Chain ID:", networkConfig.chainId);
console.log("RPC URL:", networkConfig.rpcUrl);
console.log("");

// PoolManager ABI (minimal for verification)
const POOL_MANAGER_ABI = parseAbi([
	"function owner() view returns (address)",
	"function MAX_TICK_SPACING() view returns (uint24)",
	"function MIN_TICK_SPACING() view returns (uint24)",
]);

type DeploymentInfo = {
	poolManager: string;
	weth: string;
	deployer: string;
	chainId: number;
	network: string;
	timestamp: number;
	deployedAt: string;
	version: string;
	features: {
		singleton: boolean;
		hooks: boolean;
		flashAccounting: boolean;
		nativeETH: boolean;
	};
};

type VerificationResult = {
	passed: boolean;
	message: string;
	details?: string;
};

async function loadDeploymentInfo(): Promise<DeploymentInfo | null> {
	const deploymentsDir = join(__dirname, "..", "contracts", "deployments");
	const filename = `uniswap-v4-${networkConfig.chainId}.json`;
	const path = join(deploymentsDir, filename);

	if (!existsSync(path)) {
		console.error("❌ Deployment file not found");
		console.error(`Path: ${path}`);
		console.error("");
		console.error("Have you deployed Uniswap V4 to this network yet?");
		console.error(`Run: bun run scripts/deploy-uniswap-v4.ts --network ${network}`);
		return null;
	}

	try {
		const data = readFileSync(path, "utf-8");
		const deployment = JSON.parse(data) as DeploymentInfo;

		console.log("✅ Deployment file found");
		if (verbose) {
			console.log(`Path: ${path}`);
		}
		console.log("");

		return deployment;
	} catch (error) {
		console.error("❌ Failed to parse deployment file");
		console.error(error);
		return null;
	}
}

async function verifyDeploymentInfo(deployment: DeploymentInfo): Promise<VerificationResult> {
	console.log("Checking deployment information...");

	if (deployment.chainId !== networkConfig.chainId) {
		return {
			passed: false,
			message: "Chain ID mismatch",
			details: `Expected ${networkConfig.chainId}, got ${deployment.chainId}`,
		};
	}

	if (deployment.network !== network) {
		return {
			passed: false,
			message: "Network mismatch",
			details: `Expected ${network}, got ${deployment.network}`,
		};
	}

	if (!deployment.poolManager || !deployment.poolManager.startsWith("0x")) {
		return {
			passed: false,
			message: "Invalid PoolManager address",
			details: deployment.poolManager,
		};
	}

	console.log("✅ Deployment information valid");
	if (verbose) {
		console.log(`  PoolManager: ${deployment.poolManager}`);
		console.log(`  Deployer: ${deployment.deployer}`);
		console.log(`  Deployed: ${deployment.deployedAt}`);
	}
	console.log("");

	return { passed: true, message: "Deployment info valid" };
}

async function verifyRpcConnection(publicClient: any): Promise<VerificationResult> {
	console.log("Verifying RPC connection...");

	try {
		const chainId = await publicClient.getChainId();
		const blockNumber = await publicClient.getBlockNumber();

		if (chainId !== networkConfig.chainId) {
			return {
				passed: false,
				message: "Chain ID mismatch",
				details: `Expected ${networkConfig.chainId}, got ${chainId}`,
			};
		}

		console.log("✅ RPC connection verified");
		if (verbose) {
			console.log(`  Chain ID: ${chainId}`);
			console.log(`  Block Number: ${blockNumber}`);
		}
		console.log("");

		return { passed: true, message: "RPC connection valid" };
	} catch (error) {
		return {
			passed: false,
			message: "Failed to connect to RPC",
			details: String(error),
		};
	}
}

async function verifyContractDeployed(
	publicClient: any,
	address: string
): Promise<VerificationResult> {
	console.log("Verifying PoolManager contract deployment...");

	try {
		const code = await publicClient.getBytecode({ address });

		if (!code || code === "0x" || code === "0x0") {
			return {
				passed: false,
				message: "No contract code found at PoolManager address",
				details: `Address: ${address}`,
			};
		}

		console.log("✅ PoolManager contract deployed");
		if (verbose) {
			console.log(`  Address: ${address}`);
			console.log(`  Code size: ${code.length} bytes`);
		}
		console.log("");

		return { passed: true, message: "Contract deployed" };
	} catch (error) {
		return {
			passed: false,
			message: "Failed to fetch contract code",
			details: String(error),
		};
	}
}

async function verifyContractFunctions(
	publicClient: any,
	address: string
): Promise<VerificationResult> {
	console.log("Verifying PoolManager contract functions...");

	try {
		// Try to read basic functions using publicClient.readContract
		const owner = await publicClient.readContract({
			address: address as `0x${string}`,
			abi: POOL_MANAGER_ABI,
			functionName: 'owner',
		});
		const maxTickSpacing = await publicClient.readContract({
			address: address as `0x${string}`,
			abi: POOL_MANAGER_ABI,
			functionName: 'MAX_TICK_SPACING',
		});
		const minTickSpacing = await publicClient.readContract({
			address: address as `0x${string}`,
			abi: POOL_MANAGER_ABI,
			functionName: 'MIN_TICK_SPACING',
		});

		console.log("✅ PoolManager functions working");
		if (verbose) {
			console.log(`  Owner: ${owner}`);
			console.log(`  Max Tick Spacing: ${maxTickSpacing}`);
			console.log(`  Min Tick Spacing: ${minTickSpacing}`);
		}
		console.log("");

		return {
			passed: true,
			message: "Contract functions verified",
			details: `Owner: ${owner}`,
		};
	} catch (error) {
		return {
			passed: false,
			message: "Failed to call contract functions",
			details: String(error),
		};
	}
}

async function verifyWETHAddress(deployment: DeploymentInfo): Promise<VerificationResult> {
	console.log("Verifying WETH address...");

	const expectedWETH = "0x4200000000000000000000000000000000000006";

	if (deployment.weth.toLowerCase() !== expectedWETH.toLowerCase()) {
		return {
			passed: false,
			message: "WETH address mismatch",
			details: `Expected ${expectedWETH}, got ${deployment.weth}`,
		};
	}

	console.log("✅ WETH address correct");
	if (verbose) {
		console.log(`  WETH: ${deployment.weth} (L2 Standard Bridge WETH)`);
	}
	console.log("");

	return { passed: true, message: "WETH address correct" };
}

async function generateDeploymentReport(
	deployment: DeploymentInfo,
	publicClient: any
): Promise<void> {
	console.log("======================================================================");
	console.log("Deployment Report");
	console.log("======================================================================");
	console.log("");
	console.log("Network Information:");
	console.log(`  Network: ${networkConfig.name}`);
	console.log(`  Chain ID: ${networkConfig.chainId}`);
	console.log(`  RPC URL: ${networkConfig.rpcUrl}`);
	console.log("");
	console.log("Deployment Details:");
	console.log(`  PoolManager: ${deployment.poolManager}`);
	console.log(`  WETH: ${deployment.weth}`);
	console.log(`  Deployer: ${deployment.deployer}`);
	console.log(`  Deployed: ${deployment.deployedAt}`);
	console.log(`  Version: ${deployment.version}`);
	console.log("");
	console.log("Features:");
	console.log(`  Singleton Architecture: ${deployment.features.singleton ? "✅" : "❌"}`);
	console.log(`  Hooks Support: ${deployment.features.hooks ? "✅" : "❌"}`);
	console.log(`  Flash Accounting: ${deployment.features.flashAccounting ? "✅" : "❌"}`);
	console.log(`  Native ETH: ${deployment.features.nativeETH ? "✅" : "❌"}`);
	console.log("");

	// Get current block info
	try {
		const blockNumber = await publicClient.getBlockNumber();
		console.log("Current State:");
		console.log(`  Latest Block: ${blockNumber}`);
		console.log("");
	} catch (e) {
		// Ignore
	}
}

async function main() {
	const results: VerificationResult[] = [];
	let allPassed = true;

	try {
		// Step 1: Load deployment info
		const deployment = await loadDeploymentInfo();
		if (!deployment) {
			process.exit(1);
		}

		// Step 2: Verify deployment info
		const infoResult = await verifyDeploymentInfo(deployment);
		results.push(infoResult);
		if (!infoResult.passed) allPassed = false;

		// Step 3: Create public client
		const publicClient = createPublicClient({
			transport: http(networkConfig.rpcUrl),
		});

		// Step 4: Verify RPC connection
		const rpcResult = await verifyRpcConnection(publicClient);
		results.push(rpcResult);
		if (!rpcResult.passed) allPassed = false;

		// Step 5: Verify contract deployed
		const deployResult = await verifyContractDeployed(publicClient, deployment.poolManager);
		results.push(deployResult);
		if (!deployResult.passed) allPassed = false;

		// Step 6: Verify contract functions
		if (deployResult.passed) {
			const functionsResult = await verifyContractFunctions(
				publicClient,
				deployment.poolManager
			);
			results.push(functionsResult);
			if (!functionsResult.passed) allPassed = false;
		}

		// Step 7: Verify WETH address
		const wethResult = await verifyWETHAddress(deployment);
		results.push(wethResult);
		if (!wethResult.passed) allPassed = false;

		// Step 8: Generate report
		await generateDeploymentReport(deployment, publicClient);

		// Summary
		console.log("======================================================================");
		console.log("Verification Summary");
		console.log("======================================================================");
		console.log("");

		const passedCount = results.filter((r) => r.passed).length;
		const totalCount = results.length;

		console.log(`Tests Passed: ${passedCount}/${totalCount}`);
		console.log("");

		if (!allPassed) {
			console.log("Failed Checks:");
			results
				.filter((r) => !r.passed)
				.forEach((r) => {
					console.log(`  ❌ ${r.message}`);
					if (r.details) {
						console.log(`     ${r.details}`);
					}
				});
			console.log("");
		}

		if (allPassed) {
			console.log("✅ All verification checks passed!");
			console.log("");
			console.log("Your Uniswap V4 deployment is ready to use.");
			console.log("");
			console.log("Next Steps:");
			console.log("  1. Deploy hooks (if needed)");
			console.log("  2. Initialize pools");
			console.log("  3. Add liquidity");
			console.log("  4. Integrate with your application");
			console.log("");
			process.exit(0);
		} else {
			console.log("❌ Some verification checks failed.");
			console.log("");
			console.log("Please review the errors above and:");
			console.log("  1. Check your deployment was successful");
			console.log("  2. Verify network configuration is correct");
			console.log("  3. Ensure RPC endpoint is accessible");
			console.log("  4. Re-run deployment if necessary");
			console.log("");
			process.exit(1);
		}
	} catch (error) {
		console.error("");
		console.error("======================================================================");
		console.error("❌ Verification Error");
		console.error("======================================================================");
		console.error("");
		console.error(error);
		console.error("");
		process.exit(1);
	}
}

main();
