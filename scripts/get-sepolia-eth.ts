#!/usr/bin/env bun
/**
 * Get Sepolia ETH from faucets
 * 
 * Opens faucet URLs in browser and monitors balance until funded.
 * 
 * Usage:
 *   bun run scripts/get-sepolia-eth.ts [address]
 *   
 * If no address provided, uses DEPLOYER_ADDRESS or derives from PRIVATE_KEY
 */

import { JsonRpcProvider, formatEther, Wallet } from 'ethers';
import { spawn } from 'child_process';

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const MIN_BALANCE = 0.1; // Minimum ETH needed

const FAUCETS = [
  { name: 'Alchemy', url: 'https://sepoliafaucet.com' },
  { name: 'Google Cloud', url: 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia' },
  { name: 'Infura', url: 'https://www.infura.io/faucet/sepolia' },
  { name: 'QuickNode', url: 'https://faucet.quicknode.com/ethereum/sepolia' },
  { name: 'Chainlink', url: 'https://faucets.chain.link/sepolia' },
];

function openUrl(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
}

async function getBalance(address: string): Promise<number> {
  const provider = new JsonRpcProvider(SEPOLIA_RPC);
  const balance = await provider.getBalance(address);
  return parseFloat(formatEther(balance));
}

async function waitForFunds(address: string, targetBalance: number): Promise<void> {
  console.log(`\n⏳ Waiting for funds to arrive at ${address}...`);
  console.log(`   Target: ${targetBalance} ETH\n`);

  let lastBalance = 0;
  while (true) {
    const balance = await getBalance(address);
    if (balance !== lastBalance) {
      console.log(`💰 Balance: ${balance.toFixed(4)} ETH`);
      lastBalance = balance;
    }
    if (balance >= targetBalance) {
      console.log(`\n✅ Funded! Balance: ${balance.toFixed(4)} ETH`);
      return;
    }
    await new Promise(r => setTimeout(r, 10000)); // Check every 10s
  }
}

async function main() {
  // Get address from args, env, or derive from private key
  let address = process.argv[2];
  
  if (!address) {
    address = process.env.DEPLOYER_ADDRESS;
  }
  
  if (!address && process.env.PRIVATE_KEY) {
    const wallet = new Wallet(process.env.PRIVATE_KEY);
    address = wallet.address;
  }

  if (!address) {
    console.error('❌ No address provided. Usage:');
    console.error('   bun run scripts/get-sepolia-eth.ts <address>');
    console.error('   or set DEPLOYER_ADDRESS or PRIVATE_KEY env var');
    process.exit(1);
  }

  console.log('🚰 Sepolia ETH Faucet Helper');
  console.log('============================\n');
  console.log(`Address: ${address}`);

  const currentBalance = await getBalance(address);
  console.log(`Current Balance: ${currentBalance.toFixed(4)} ETH`);

  if (currentBalance >= MIN_BALANCE) {
    console.log(`\n✅ Already have enough ETH (${currentBalance.toFixed(4)} >= ${MIN_BALANCE})`);
    return;
  }

  console.log(`\n📋 Opening faucet pages in browser...`);
  console.log(`   Copy this address: ${address}\n`);

  for (const faucet of FAUCETS) {
    console.log(`   → ${faucet.name}: ${faucet.url}`);
    openUrl(faucet.url);
    await new Promise(r => setTimeout(r, 1000)); // Stagger browser opens
  }

  console.log('\n💡 Tips:');
  console.log('   - Alchemy faucet is usually fastest (requires login)');
  console.log('   - Google Cloud faucet gives 0.05 ETH per request');
  console.log('   - Some faucets require social verification\n');

  await waitForFunds(address, MIN_BALANCE);

  console.log('\n🎉 Ready to deploy! Run:');
  console.log(`   NETWORK=sepolia PRIVATE_KEY=0x... bun run apps/compute/src/compute/scripts/deploy-base.ts`);
}

main().catch(console.error);
