#!/usr/bin/env bun
/**
 * @fileoverview Register governance in ERC-8004 registry
 * @module scripts/register-governance-in-erc8004
 */

import { ethers } from 'ethers';

const RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

console.log('Registering governance contracts in ERC-8004 registry...\n');

const IDENTITY_REGISTRY_ABI = [
  'function register(string uri) external returns (uint256)',
  'function setMetadata(uint256 agentId, string key, bytes value) external'
];

async function main() {
  const registryAddress = process.env.IDENTITY_REGISTRY_ADDRESS;
  if (!registryAddress) {
    console.log('IDENTITY_REGISTRY_ADDRESS not set');
    console.log('Set it and re-run to register governance as agent\n');
    return;
  }
  
  const registry = new ethers.Contract(registryAddress, IDENTITY_REGISTRY_ABI, wallet);
  
  // Register FutarchyGovernor
  const uri = 'ipfs://QmGovernanceMetadata'; // Replace with actual IPFS
  const tx = await registry.register(uri);
  const receipt = await tx.wait();
  
  console.log('✅ Governance registered as ERC-8004 agent');
  console.log('   Agent ID:', receipt.logs[0].topics[1]);
  console.log('   Can now be discovered by other agents via registry\n');
}

main().catch(console.error);

