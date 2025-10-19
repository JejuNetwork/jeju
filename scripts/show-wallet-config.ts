#!/usr/bin/env bun
/**
 * Show MetaMask wallet configuration for Jeju Localnet
 * 
 * Usage:
 *   bun run scripts/show-wallet-config.ts
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

const ENCLAVE_NAME = "jeju-localnet";
const PORTS_FILE = join(process.cwd(), ".kurtosis/ports.json");

async function main() {
  console.log("\n╔═══════════════════════════════════════════════════════════════════════╗");
  console.log("║                                                                       ║");
  console.log("║   🦊 Jeju Localnet - MetaMask Configuration                          ║");
  console.log("║                                                                       ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════╝\n");

  // L2 RPC is on STATIC port 9545 (forwarded from dynamic Kurtosis port)
  const l2RpcUrl = "http://127.0.0.1:9545";
  
  console.log("✅ Using static port configuration (9545)\n");

  // Display configuration
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("\n📋 MetaMask Network Configuration:\n");
  console.log(`  Network Name:   Jeju Localnet`);
  console.log(`  RPC URL:        ${l2RpcUrl}  ← COPY THIS`);
  console.log(`  Chain ID:       1337`);
  console.log(`  Currency:       ETH`);
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  
  // Step-by-step instructions
  console.log("\n📱 How to Add to MetaMask:\n");
  console.log("  1. Open MetaMask extension");
  console.log("  2. Click your current network name at the top");
  console.log("  3. Click 'Add Network' at the bottom");
  console.log("  4. Click 'Add a network manually'");
  console.log("  5. Copy the values above");
  console.log("  6. Click 'Save'\n");
  
  // Test account
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("\n💰 Pre-funded Test Account (Import to MetaMask):\n");
  console.log("  Private Key:  0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291");
  console.log("  Address:      0x71562b71999873DB5b286dF957af199Ec94617F7");
  console.log("  Balance:      Unlimited ETH\n");
  console.log("  In MetaMask: Import Account → Paste private key above\n");
  
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("\n⚠️  IMPORTANT NOTES:\n");
  console.log("  • This RPC URL points to L2 (Jeju), where all apps live");
  console.log("  • Port 9545 is STATIC and never changes (forwarded automatically)");
  console.log("  • Port forwarding is handled by 'bun run dev'");
  console.log("  • You can always use http://127.0.0.1:9545 for Jeju L2\n");
  
  console.log("✅ Ready to use Jeju apps:");
  console.log("  • Paymaster Dashboard: http://localhost:3006");
  console.log("  • Hyperscape Game:     http://localhost:3333");
  console.log("  • Cloud Platform:      http://localhost:3005");
  console.log("  • Launchpad:           http://localhost:3330\n");
}

main();

