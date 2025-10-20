#!/usr/bin/env bun

/**
 * Deploy ElizaOS Token to Jeju
 *
 * This script deploys the ElizaOS Token (ERC20) to the Jeju network.
 * This token will be used as the base trading pair with Uniswap V2.
 *
 * Usage:
 *   PRIVATE_KEY=0x... bun run scripts/deploy-eliza-token.ts
 *
 * Environment:
 *   PRIVATE_KEY - Deployer private key (defaults to Anvil account 0 for localnet)
 *   JEJU_RPC_URL - RPC endpoint (defaults to localnet)
 *   JEJU_NETWORK - mainnet | testnet | localnet (defaults to localnet)
 */

import { spawn } from "child_process";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getLocalnetRpcUrl } from "./shared/get-localnet-rpc";

const DEFAULT_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const network = process.env.JEJU_NETWORK || "localnet";
const rpcUrl = process.env.JEJU_RPC_URL || (network === "localnet" ? getLocalnetRpcUrl() : "http://127.0.0.1:9545");
const privateKey = process.env.PRIVATE_KEY || DEFAULT_PRIVATE_KEY;

// Token parameters
const TOKEN_NAME = "ElizaOS Token";
const TOKEN_SYMBOL = "elizaOS";
const INITIAL_SUPPLY = "1000000000"; // 1 billion tokens (will be multiplied by 10^18)

console.log("======================================================================");
console.log("Deploying ElizaOS Token to Jeju");
console.log("======================================================================");
console.log("");
console.log("Network:", network);
console.log("RPC URL:", rpcUrl);
console.log("Token Name:", TOKEN_NAME);
console.log("Token Symbol:", TOKEN_SYMBOL);
console.log("Initial Supply:", INITIAL_SUPPLY, "tokens");
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

async function deployToken(deployerAddress: string): Promise<string> {
	console.log("1. Deploying ElizaOS Token...");
	console.log("");

	// Deploy the existing ElizaOSToken contract
	// Constructor: (address initialOwner)
	const output = await runForge([
		"create",
		"--rpc-url",
		rpcUrl,
		"--private-key",
		privateKey,
		"--broadcast",
		"src/token/ElizaOSToken.sol:ElizaOSToken",
		"--constructor-args",
		deployerAddress, // initial owner
	]);

	// Parse deployed address from output
	const match = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
	if (!match) {
		throw new Error("Failed to parse token address from forge output");
	}

	const token = match[1];
	console.log("");
	console.log("✅ Token deployed:", token);
	console.log("");

	return token;
}

function saveDeployment(token: string, chainId: number) {
	const deployment = {
		token,
		name: TOKEN_NAME,
		symbol: TOKEN_SYMBOL,
		initialSupply: INITIAL_SUPPLY,
		chainId,
		network,
		timestamp: Date.now(),
	};

	const deploymentsDir = join(__dirname, "..", "contracts", "deployments");
	if (!existsSync(deploymentsDir)) {
		mkdirSync(deploymentsDir, { recursive: true });
	}

	const filename = `eliza-token-${chainId}.json`;
	const path = join(deploymentsDir, filename);

	writeFileSync(path, JSON.stringify(deployment, null, 2));
	console.log("📝 Deployment saved:", path);
	console.log("");
}

function updateConstants(token: string, network: string) {
	console.log("2. Update Constants");
	console.log("");
	console.log("Add these to apps/launchpad/packages/constants/src/index.ts:");
	console.log("");

	const chainIdMap: Record<string, string> = {
		localnet: "JejuLocalnet",
		testnet: "JejuTestnet",
		mainnet: "JejuMainnet",
	};

	const chainKey = chainIdMap[network] || "JejuLocalnet";

	console.log(`  ELIZA_TOKEN_ADDRESSES: {`);
	console.log(`    [EvmChainIds.${chainKey}]: getAddress("${token}"),`);
	console.log(`  }`);
	console.log("");
}

function printNextSteps(token: string) {
	console.log("======================================================================");
	console.log("Deployment Complete!");
	console.log("======================================================================");
	console.log("");
	console.log("Token Address:", token);
	console.log("");
	console.log("Next Steps:");
	console.log("");
	console.log("1. Update constants file with token address (shown above)");
	console.log("");
	console.log("2. Create initial liquidity pair with Uniswap:");
	console.log("   - Open Uniswap Interface");
	console.log("   - Create elizaOS/ETH pair");
	console.log("   - Add initial liquidity");
	console.log("");
	console.log("3. Verify the token contract:");
	console.log("   - On block explorer");
	console.log("   - Check total supply and balances");
	console.log("");
}

// Main execution
async function main() {
	try {
		// Get deployer address from private key (using the same as V4)
		const deployerAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

		const token = await deployToken(deployerAddress);

		// Get chain ID (1337 for localnet, 420690 for testnet, 420691 for mainnet)
		const chainIdMap: Record<string, number> = {
			localnet: 1337,
			testnet: 420690,
			mainnet: 420691,
		};
		const chainId = chainIdMap[network] || 1337;

		saveDeployment(token, chainId);
		updateConstants(token, network);
		printNextSteps(token);

		process.exit(0);
	} catch (error) {
		console.error("");
		console.error("❌ Deployment failed:");
		console.error(error);
		process.exit(1);
	}
}

main();
