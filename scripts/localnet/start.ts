#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const KURTOSIS_PACKAGE = "kurtosis/main.star";  // Direct Starlark file (faster than packaging)
const ENCLAVE_NAME = "jeju-localnet";
const OUTPUT_DIR = join(process.cwd(), ".kurtosis");

async function main() {
  console.log("🚀 Starting Jeju Localnet...");
  
  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Check if Kurtosis is installed
  const kurtosisInstalled = await checkKurtosis();
  if (!kurtosisInstalled) {
    console.error("❌ Kurtosis is not installed. Please install it first:");
    console.error("   brew install kurtosis-tech/tap/kurtosis");
    process.exit(1);
  }

  // Check if Docker is installed and running
  const dockerStatus = await checkDocker();
  if (!dockerStatus.installed) {
    console.error("❌ Docker is not installed.");
    console.error("\n📥 To install Docker:");
    console.error("   • macOS: brew install --cask docker");
    console.error("   • Or download from: https://www.docker.com/products/docker-desktop");
    console.error("\n   After installing, start Docker Desktop and try again.");
    process.exit(1);
  }
  if (!dockerStatus.running) {
    console.error("❌ Docker is not running.");
    console.error("\n🚀 To start Docker:");
    console.error("   • macOS: Open Docker Desktop from Applications");
    console.error("   • Or run: open -a Docker");
    console.error("\n   Wait for Docker to start, then try again.");
    process.exit(1);
  }

  // Clean up existing enclave if it exists
  console.log("🧹 Cleaning up existing enclave...");
  await $`kurtosis enclave rm -f ${ENCLAVE_NAME}`.quiet().nothrow();

  // Start the localnet
  console.log("📦 Deploying Jeju stack with Kurtosis...");
  console.log("   This may take 5-10 minutes on first run...");
  console.log("   - Deploying L1 Ethereum (Geth dev mode)");
  console.log("   - Deploying L2 Execution Layer (op-geth dev mode)");
  console.log("");
  
  // Run kurtosis with output visible (using .quiet() hides output, we want to see it)
  const result = await $`kurtosis run ${KURTOSIS_PACKAGE} --enclave ${ENCLAVE_NAME}`.nothrow();
  
  if (result.exitCode !== 0) {
    console.error("❌ Failed to start localnet");
    console.error(result.stderr.toString());
    process.exit(1);
  }

  // Get enclave info
  console.log("\n📊 Fetching deployment info...");
  const info = await $`kurtosis enclave inspect ${ENCLAVE_NAME}`.text();
  
  // Get actual port numbers (Kurtosis uses dynamic ports)
  console.log("🔍 Querying L1 RPC port...");
  const l1RpcResult = await $`kurtosis port print ${ENCLAVE_NAME} geth-l1 rpc`.nothrow();
  if (l1RpcResult.exitCode !== 0) {
    console.error("❌ Failed to get L1 RPC port");
    console.error(l1RpcResult.stderr.toString());
    process.exit(1);
  }
  
  console.log("🔍 Querying L2 RPC port...");
  const l2RpcResult = await $`kurtosis port print ${ENCLAVE_NAME} op-geth rpc`.nothrow();
  if (l2RpcResult.exitCode !== 0) {
    console.error("❌ Failed to get L2 RPC port");
    console.error(l2RpcResult.stderr.toString());
    process.exit(1);
  }
  
  // Parse port from output (format: "http://127.0.0.1:PORT")
  const l1Output = l1RpcResult.text().trim();
  const l2Output = l2RpcResult.text().trim();
  
  console.log(`Raw L1 output: ${l1Output}`);
  console.log(`Raw L2 output: ${l2Output}`);
  
  // Kurtosis returns full URL like "http://127.0.0.1:51050"
  // Split by : gives ["http", "//127.0.0.1", "51050"]
  const l1Port = l1Output.split(":").pop() || "";
  const l2Port = l2Output.split(":").pop() || "";
  
  if (!l1Port || !l2Port || isNaN(parseInt(l1Port)) || isNaN(parseInt(l2Port))) {
    console.error("❌ Failed to parse ports from Kurtosis output");
    console.error(`L1 output: ${l1Output}`);
    console.error(`L2 output: ${l2Output}`);
    console.error(`Parsed L1 port: ${l1Port}`);
    console.error(`Parsed L2 port: ${l2Port}`);
    process.exit(1);
  }
  
  console.log(`✅ L1 Port: ${l1Port}`);
  console.log(`✅ L2 Port: ${l2Port}`);
  
  // Save ports to file for apps to read
  const portsConfig = {
    l1Rpc: `http://127.0.0.1:${l1Port}`,
    l2Rpc: `http://127.0.0.1:${l2Port}`,
    l1Port: parseInt(l1Port),
    l2Port: parseInt(l2Port),
    chainId: 1337,
    timestamp: new Date().toISOString()
  };
  
  await Bun.write(
    join(OUTPUT_DIR, "ports.json"),
    JSON.stringify(portsConfig, null, 2)
  );
  
  console.log(`💾 Port config saved to: ${join(OUTPUT_DIR, "ports.json")}`);
  
  // Extract and display key endpoints
  console.log("\n✅ Jeju Localnet is running!");
  console.log("\n📌 Key Endpoints:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`   L1 RPC: http://127.0.0.1:${l1Port}`);
  console.log(`   L2 RPC: http://127.0.0.1:${l2Port}`);
  console.log("\n🔧 Chain Info:");
  console.log("   L1 Chain ID: 1337");
  console.log("   L2 Chain ID: 1337 (dev mode)");
  console.log("   Block Time:  2 seconds");
  console.log("\n💰 Pre-funded Dev Account:");
  console.log("   Address: 0x71562b71999873DB5b286dF957af199Ec94617F7");
  console.log("   Key:     0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291");
  console.log("   Balance: 10^49 ETH (effectively unlimited)");
  console.log("\n🧪 Test it:");
  console.log(`   cast block latest --rpc-url http://127.0.0.1:${l2Port}`);
  console.log(`   cast send 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --value 0.1ether --rpc-url http://127.0.0.1:${l2Port} --private-key 0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291`);
  // Wallet setup instructions
  console.log("\n╔═══════════════════════════════════════════════════════════════════════╗");
  console.log("║                                                                       ║");
  console.log("║   🦊 WALLET SETUP - Add Jeju Localnet to MetaMask                    ║");
  console.log("║                                                                       ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════╝");
  console.log("\nOpen MetaMask → Networks → Add Network → Add Manually\n");
  console.log(`  Network Name:   Jeju Localnet`);
  console.log(`  RPC URL:        http://127.0.0.1:${l2Port}  ← COPY THIS (L2)`);
  console.log(`  Chain ID:       1337`);
  console.log(`  Currency:       ETH`);
  console.log("\n⚠️  IMPORTANT: Use the L2 RPC URL above, NOT the L1!");
  console.log("   All apps, tokens, and contracts are deployed on L2.");
  
  console.log("\n💡 Useful Commands:");
  console.log("   kurtosis enclave inspect jeju-localnet      - View all services");
  console.log("   kurtosis service logs jeju-localnet op-geth - View L2 logs");
  console.log("   bun run dev                                 - Full dev environment (manages lifecycle)");
  console.log("   kurtosis enclave rm jeju-localnet           - Reset localnet");
  console.log("\n📚 Documentation: README.md");
  
  // Save deployment info
  const deploymentInfo = {
    enclaveName: ENCLAVE_NAME,
    timestamp: new Date().toISOString(),
    endpoints: extractEndpoints(info)
  };
  
  await Bun.write(
    join(OUTPUT_DIR, "deployment.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log(`\n💾 Deployment info saved to: ${join(OUTPUT_DIR, "deployment.json")}`);
}

async function checkKurtosis(): Promise<boolean> {
  const result = await $`which kurtosis`.quiet().nothrow();
  return result.exitCode === 0;
}

async function checkDocker(): Promise<{ installed: boolean; running: boolean }> {
  // Check if Docker CLI is installed
  const whichResult = await $`which docker`.quiet().nothrow();
  if (whichResult.exitCode !== 0) {
    return { installed: false, running: false };
  }
  
  // Check if Docker daemon is running with retry (daemon can be slow to start)
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    const psResult = await $`docker ps`.quiet().nothrow();
    if (psResult.exitCode === 0) {
      // Also verify we can actually pull/inspect images (more thorough check)
      const infoResult = await $`docker info`.quiet().nothrow();
      if (infoResult.exitCode === 0) {
        return { installed: true, running: true };
      }
    }
    
    if (attempts === 0) {
      console.log("⏳ Docker daemon initializing, waiting...");
    }
    
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return { installed: true, running: false };
}

function extractEndpoints(info: string): Record<string, string> {
  const endpoints: Record<string, string> = {};
  
  const patterns = {
    l1Rpc: /l1.*rpc.*http:\/\/[^:]+:(\d+)/,
    l2Rpc: /l2.*rpc.*http:\/\/[^:]+:(\d+)/,
    l2Ws: /l2.*ws.*ws:\/\/[^:]+:(\d+)/
  };
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = info.match(pattern);
    if (match) {
      endpoints[key] = `http://127.0.0.1:${match[1]}`;
    }
  }
  
  return endpoints;
}

main();

