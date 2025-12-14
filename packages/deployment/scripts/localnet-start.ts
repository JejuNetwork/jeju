#!/usr/bin/env bun
/**
 * Start network localnet using Kurtosis
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { platform } from "os";

const ROOT = join(import.meta.dir, "..");
const KURTOSIS_PACKAGE = join(ROOT, "kurtosis/main.star");
const ENCLAVE_NAME = "jeju-localnet";
const OUTPUT_DIR = join(process.cwd(), ".kurtosis");

async function checkDocker(): Promise<boolean> {
  const result = await $`docker info`.quiet().nothrow();
  return result.exitCode === 0;
}

async function checkKurtosis(): Promise<boolean> {
  const result = await $`which kurtosis`.quiet().nothrow();
  return result.exitCode === 0;
}

async function installKurtosisFromGitHub(): Promise<boolean> {
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : null;
  if (!arch) {
    console.error(`❌ Unsupported architecture: ${process.arch}`);
    return false;
  }

  // Get latest version
  const versionResult = await $`curl -fsSL https://api.github.com/repos/kurtosis-tech/kurtosis-cli-release-artifacts/releases/latest`.quiet().nothrow();
  if (versionResult.exitCode !== 0) {
    return false;
  }
  
  const release = JSON.parse(versionResult.text()) as { tag_name: string };
  const version = release.tag_name;
  const tarball = `kurtosis-cli_${version}_linux_${arch}.tar.gz`;
  const url = `https://github.com/kurtosis-tech/kurtosis-cli-release-artifacts/releases/download/${version}/${tarball}`;

  console.log(`   Downloading ${tarball}...`);
  
  const downloadResult = await $`curl -fsSL ${url} -o /tmp/${tarball}`.nothrow();
  if (downloadResult.exitCode !== 0) {
    return false;
  }

  // Extract to /usr/local/bin
  const extractResult = await $`sudo tar -xzf /tmp/${tarball} -C /usr/local/bin kurtosis`.nothrow();
  if (extractResult.exitCode !== 0) {
    // Try without sudo to ~/.local/bin
    await $`mkdir -p ~/.local/bin`.nothrow();
    const localResult = await $`tar -xzf /tmp/${tarball} -C ~/.local/bin kurtosis`.nothrow();
    if (localResult.exitCode !== 0) {
      return false;
    }
    console.log("   Installed to ~/.local/bin (add to PATH if needed)");
  }

  return true;
}

async function checkBrew(): Promise<boolean> {
  const result = await $`which brew`.quiet().nothrow();
  return result.exitCode === 0;
}

async function installBrew(): Promise<boolean> {
  console.log("🍺 Installing Homebrew...");
  const result = await $`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`.nothrow();
  if (result.exitCode !== 0) {
    return false;
  }
  
  // Add brew to PATH for Apple Silicon Macs
  if (process.arch === "arm64") {
    process.env.PATH = `/opt/homebrew/bin:${process.env.PATH}`;
  }
  
  return await checkBrew();
}

async function installKurtosis(): Promise<void> {
  const os = platform();
  console.log(`📦 Installing Kurtosis for ${os}...`);

  if (os === "linux") {
    // Try official install script first
    const curlResult = await $`curl -fsSL https://get.kurtosis.com -o /tmp/kurtosis-install.sh`.quiet().nothrow();
    if (curlResult.exitCode === 0) {
      const installResult = await $`bash /tmp/kurtosis-install.sh`.nothrow();
      if (installResult.exitCode === 0 && await checkKurtosis()) {
        console.log("✅ Kurtosis installed successfully\n");
        return;
      }
    }

    // Fallback to GitHub releases
    console.log("   Trying GitHub releases fallback...");
    if (await installKurtosisFromGitHub() && await checkKurtosis()) {
      console.log("✅ Kurtosis installed successfully\n");
      return;
    }

    console.error("❌ Failed to install Kurtosis");
    console.log("   Try manually: curl -fsSL https://get.kurtosis.com | bash");
    process.exit(1);
  } else if (os === "darwin") {
    // Install Homebrew if needed
    if (!await checkBrew()) {
      console.log("⚠️  Homebrew not found, installing first...\n");
      if (!await installBrew()) {
        console.error("❌ Failed to install Homebrew");
        console.log("   Install manually: https://brew.sh");
        process.exit(1);
      }
      console.log("✅ Homebrew installed\n");
    }

    const result = await $`brew install kurtosis-tech/tap/kurtosis`.nothrow();
    if (result.exitCode !== 0) {
      console.error("❌ Failed to install Kurtosis via Homebrew");
      console.log("   Try manually: brew install kurtosis-tech/tap/kurtosis");
      process.exit(1);
    }
    console.log("✅ Kurtosis installed successfully\n");
  } else {
    console.error(`❌ Unsupported OS: ${os}`);
    console.log("   Install Kurtosis manually: https://docs.kurtosis.com/install/");
    process.exit(1);
  }
}

async function main() {
  console.log("🚀 Starting Network Localnet...\n");

  if (!await checkDocker()) {
    console.error("❌ Docker is not running. Start Docker and try again.");
    process.exit(1);
  }

  if (!await checkKurtosis()) {
    console.log("⚠️  Kurtosis not found, installing...\n");
    await installKurtosis();
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Clean up existing enclave
  console.log("🧹 Cleaning up existing enclave...");
  await $`kurtosis enclave rm -f ${ENCLAVE_NAME}`.quiet().nothrow();

  // Start localnet
  console.log("📦 Deploying network stack...\n");
  const result = await $`kurtosis run ${KURTOSIS_PACKAGE} --enclave ${ENCLAVE_NAME}`.nothrow();

  if (result.exitCode !== 0) {
    console.error("❌ Failed to start localnet");
    process.exit(1);
  }

  // Get ports
  const l1Port = await $`kurtosis port print ${ENCLAVE_NAME} geth-l1 rpc`.text().then(s => s.trim().split(":").pop());
  const l2Port = await $`kurtosis port print ${ENCLAVE_NAME} op-geth rpc`.text().then(s => s.trim().split(":").pop());

  const portsConfig = {
    l1Rpc: `http://127.0.0.1:${l1Port}`,
    l2Rpc: `http://127.0.0.1:${l2Port}`,
    chainId: 1337,
    timestamp: new Date().toISOString()
  };

  await Bun.write(join(OUTPUT_DIR, "ports.json"), JSON.stringify(portsConfig, null, 2));

  console.log("\n✅ Network Localnet running");
  console.log(`   L1 RPC: http://127.0.0.1:${l1Port}`);
  console.log(`   L2 RPC: http://127.0.0.1:${l2Port}`);
  console.log(`\n💾 Config: ${join(OUTPUT_DIR, "ports.json")}\n`);
}

main();

