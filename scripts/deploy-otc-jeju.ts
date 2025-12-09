#!/usr/bin/env bun
/**
 * Deploy OTC contracts to Jeju network
 *
 * Usage:
 *   bun scripts/deploy-otc-jeju.ts --network testnet
 *   bun scripts/deploy-otc-jeju.ts --network mainnet
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const JEJU_NETWORKS = {
  devnet: {
    rpc: "https://devnet-rpc.jeju.network",
    chainId: 420689,
    explorer: "https://devnet-explorer.jeju.network",
  },
  testnet: {
    rpc: "https://testnet-rpc.jeju.network",
    chainId: 420690,
    explorer: "https://testnet-explorer.jeju.network",
  },
  mainnet: {
    rpc: "https://rpc.jeju.network",
    chainId: 420691,
    explorer: "https://explorer.jeju.network",
  },
};

function main() {
  const args = process.argv.slice(2);
  const networkIdx = args.indexOf("--network");
  const network = networkIdx >= 0 ? args[networkIdx + 1] : "testnet";

  if (!["devnet", "testnet", "mainnet"].includes(network)) {
    console.error("Invalid network. Use: devnet, testnet, or mainnet");
    process.exit(1);
  }

  const config = JEJU_NETWORKS[network as keyof typeof JEJU_NETWORKS];
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!privateKey) {
    console.error("DEPLOYER_PRIVATE_KEY environment variable is required");
    process.exit(1);
  }

  console.log(`\nDeploying OTC contracts to Jeju ${network}...`);
  console.log(`RPC: ${config.rpc}`);
  console.log(`Chain ID: ${config.chainId}`);

  const contractsDir = join(process.cwd(), "packages/contracts");
  const deploymentsDir = join(contractsDir, "deployments");

  if (!existsSync(deploymentsDir)) {
    mkdirSync(deploymentsDir, { recursive: true });
  }

  try {
    const output = execSync(
      `cd ${contractsDir} && forge script script/otc/DeployOTC.s.sol:DeployOTC \
        --rpc-url ${config.rpc} \
        --private-key ${privateKey} \
        --broadcast \
        --verify \
        -vvv`,
      { encoding: "utf-8", stdio: "pipe" },
    );

    console.log(output);

    const deploymentFile = join(deploymentsDir, `otc-jeju-${network}.json`);
    const deploymentData = {
      network: `jeju-${network}`,
      chainId: config.chainId,
      rpc: config.rpc,
      explorer: config.explorer,
      deployedAt: new Date().toISOString(),
      contracts: {
        // These will be populated by the forge script output
        otc: "",
        token: "",
        usdc: "",
        tokenUsdFeed: "",
        ethUsdFeed: "",
      },
    };

    writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
    console.log(`\nDeployment info written to: ${deploymentFile}`);

    // Update OTC agent config
    const otcAgentDeploymentFile = join(
      process.cwd(),
      `vendor/otc-agent/src/config/deployments/jeju-${network}.json`,
    );

    if (!existsSync(join(process.cwd(), "vendor/otc-agent/src/config/deployments"))) {
      mkdirSync(join(process.cwd(), "vendor/otc-agent/src/config/deployments"), { recursive: true });
    }

    writeFileSync(
      otcAgentDeploymentFile,
      JSON.stringify(
        {
          network: `jeju-${network}`,
          chainId: config.chainId,
          rpc: config.rpc,
          contracts: deploymentData.contracts,
        },
        null,
        2,
      ),
    );

    console.log(`OTC Agent config written to: ${otcAgentDeploymentFile}`);
    console.log("\nDeployment successful.");
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

main();


