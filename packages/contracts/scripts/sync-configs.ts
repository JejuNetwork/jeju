#!/usr/bin/env bun
/**
 * Sync Contract Addresses Across Configs
 * 
 * After deploying new contracts, run this to update all config files:
 *   bun run scripts/sync-configs.ts --network base-sepolia
 * 
 * This reads from deployments/addresses.json and updates:
 *   - vendor/cloud/config/x402.json
 *   - vendor/cloud/config/erc8004.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ADDRESSES_PATH = join(__dirname, "../deployments/addresses.json");
const X402_PATH = join(__dirname, "../../../vendor/cloud/config/x402.json");
const ERC8004_PATH = join(__dirname, "../../../vendor/cloud/config/erc8004.json");

interface NetworkAddresses {
  chainId: number;
  deployer: string | null;
  tokens: {
    USDC: string;
    ElizaOSToken: string;
  };
  erc8004: {
    IdentityRegistry: string;
    ReputationRegistry: string;
    ValidationRegistry: string;
    agentId: number | null;
  };
  oif: {
    SolverRegistry: string;
    SimpleOracle?: string;
    SuperchainOracle?: string;
    InputSettler: string;
    OutputSettler: string;
  };
  accountAbstraction: {
    EntryPoint: string;
    Paymaster: string;
  };
}

function loadJson<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function saveJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`✅ Updated: ${path}`);
}

function syncNetwork(network: string, addresses: NetworkAddresses): void {
  console.log(`\n📦 Syncing ${network}...`);
  
  // Update x402.json
  const x402 = loadJson<Record<string, unknown>>(X402_PATH);
  
  // Update network USDC
  if ((x402.networks as Record<string, unknown>)[network]) {
    (x402.networks as Record<string, Record<string, unknown>>)[network].usdc = addresses.tokens.USDC;
    console.log(`   x402.networks.${network}.usdc = ${addresses.tokens.USDC}`);
  }
  
  // Update elizaToken
  if ((x402.elizaToken as Record<string, Record<string, string>>).evm[network] !== undefined) {
    (x402.elizaToken as Record<string, Record<string, string>>).evm[network] = addresses.tokens.ElizaOSToken;
    console.log(`   x402.elizaToken.evm.${network} = ${addresses.tokens.ElizaOSToken}`);
  }
  
  // Update OIF contracts
  if (!x402.oifContracts) {
    x402.oifContracts = {};
  }
  (x402.oifContracts as Record<string, unknown>)[network] = {
    SolverRegistry: addresses.oif.SolverRegistry,
    SimpleOracle: addresses.oif.SimpleOracle || addresses.oif.SuperchainOracle,
    InputSettler: addresses.oif.InputSettler,
    OutputSettler: addresses.oif.OutputSettler,
  };
  console.log(`   x402.oifContracts.${network} = [SolverRegistry, Oracle, InputSettler, OutputSettler]`);
  
  // Update timestamp
  x402._lastUpdated = new Date().toISOString().split("T")[0];
  
  saveJson(X402_PATH, x402);
  
  // Update erc8004.json
  const erc8004 = loadJson<Record<string, unknown>>(ERC8004_PATH);
  
  if ((erc8004.networks as Record<string, unknown>)[network]) {
    const netConfig = (erc8004.networks as Record<string, Record<string, unknown>>)[network];
    netConfig.contracts = {
      identity: addresses.erc8004.IdentityRegistry,
      reputation: addresses.erc8004.ReputationRegistry,
      validation: addresses.erc8004.ValidationRegistry,
    };
    netConfig.agentId = addresses.erc8004.agentId;
    console.log(`   erc8004.networks.${network}.contracts.identity = ${addresses.erc8004.IdentityRegistry}`);
    console.log(`   erc8004.networks.${network}.agentId = ${addresses.erc8004.agentId}`);
  }
  
  // Update timestamp
  erc8004._lastUpdated = new Date().toISOString().split("T")[0];
  
  saveJson(ERC8004_PATH, erc8004);
}

function verifySync(network: string, addresses: NetworkAddresses): boolean {
  console.log(`\n🔍 Verifying ${network}...`);
  
  const x402 = loadJson<Record<string, unknown>>(X402_PATH);
  const erc8004 = loadJson<Record<string, unknown>>(ERC8004_PATH);
  
  let allMatch = true;
  
  // Check USDC
  const x402Usdc = (x402.networks as Record<string, Record<string, string>>)[network]?.usdc;
  if (x402Usdc?.toLowerCase() !== addresses.tokens.USDC.toLowerCase()) {
    console.log(`   ❌ USDC mismatch: ${x402Usdc} vs ${addresses.tokens.USDC}`);
    allMatch = false;
  } else {
    console.log(`   ✅ USDC matches`);
  }
  
  // Check Identity
  const erc8004Identity = (erc8004.networks as Record<string, Record<string, Record<string, string>>>)[network]?.contracts?.identity;
  if (erc8004Identity?.toLowerCase() !== addresses.erc8004.IdentityRegistry.toLowerCase()) {
    console.log(`   ❌ IdentityRegistry mismatch`);
    allMatch = false;
  } else {
    console.log(`   ✅ IdentityRegistry matches`);
  }
  
  // Check OIF
  const oif = (x402.oifContracts as Record<string, Record<string, string>>)?.[network];
  if (oif?.SolverRegistry?.toLowerCase() !== addresses.oif.SolverRegistry.toLowerCase()) {
    console.log(`   ❌ OIF SolverRegistry mismatch`);
    allMatch = false;
  } else {
    console.log(`   ✅ OIF contracts match`);
  }
  
  return allMatch;
}

async function main() {
  const args = process.argv.slice(2);
  const networkArg = args.find(a => a.startsWith("--network="))?.split("=")[1];
  const verifyOnly = args.includes("--verify");
  
  console.log("🔄 Config Sync Tool");
  console.log("=".repeat(60));
  
  const allAddresses = loadJson<Record<string, NetworkAddresses>>(ADDRESSES_PATH);
  
  if (networkArg) {
    // Sync specific network
    if (!allAddresses[networkArg]) {
      console.error(`❌ Network "${networkArg}" not found in addresses.json`);
      process.exit(1);
    }
    
    if (verifyOnly) {
      const ok = verifySync(networkArg, allAddresses[networkArg]);
      process.exit(ok ? 0 : 1);
    } else {
      syncNetwork(networkArg, allAddresses[networkArg]);
      verifySync(networkArg, allAddresses[networkArg]);
    }
  } else {
    // Sync all networks
    console.log("Syncing all networks...");
    
    for (const [network, addresses] of Object.entries(allAddresses)) {
      if (network.startsWith("_")) continue; // Skip metadata fields
      
      if (verifyOnly) {
        verifySync(network, addresses);
      } else {
        syncNetwork(network, addresses);
      }
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("✅ Sync complete!");
}

main().catch(console.error);


