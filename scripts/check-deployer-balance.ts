#!/usr/bin/env bun
/**
 * Check deployer balance on all target chains
 */
import { ethers } from 'ethers';

const CHAINS = [
  { id: 11155111, name: 'Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  { id: 84532, name: 'Base Sepolia', rpc: 'https://sepolia.base.org' },
  { id: 421614, name: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc' },
  { id: 11155420, name: 'Optimism Sepolia', rpc: 'https://sepolia.optimism.io' },
];

const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!pk) {
  console.log('❌ No DEPLOYER_PRIVATE_KEY set');
  process.exit(1);
}

const wallet = new ethers.Wallet(pk);
console.log('Deployer:', wallet.address);
console.log('');

let allFunded = true;

for (const chain of CHAINS) {
  const provider = new ethers.JsonRpcProvider(chain.rpc, undefined, { staticNetwork: true });
  const balance = await provider.getBalance(wallet.address);
  const eth = Number(ethers.formatEther(balance)).toFixed(4);
  const hasFunds = Number(eth) >= 0.05;
  if (!hasFunds) allFunded = false;
  const status = hasFunds ? '✅' : '⚠️';
  console.log(`${status} ${chain.name} (${chain.id}): ${eth} ETH`);
}

console.log('');
if (allFunded) {
  console.log('✅ All chains funded - ready to deploy');
} else {
  console.log('⚠️ Some chains need funding (min 0.05 ETH)');
}

