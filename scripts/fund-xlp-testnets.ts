#!/usr/bin/env bun
/**
 * Fund XLP on All Testnet Chains
 * 
 * Sends ETH to XLP account on each testnet for:
 * - XLP registration stake on L1
 * - Liquidity deposits on L2s
 * - Gas for transactions
 * 
 * Usage:
 *   DEPLOYER_KEY=... XLP_ADDRESS=... bun scripts/fund-xlp-testnets.ts
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, getBalance, sendTransaction, waitForTransactionReceipt, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { inferChainFromRpcUrl } from './shared/chain-utils';

interface Chain {
  name: string;
  chainId: number;
  rpc: string;
  fundAmount: string; // ETH
}

const TESTNETS: Chain[] = [
  {
    name: 'Sepolia',
    chainId: 11155111,
    rpc: process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    fundAmount: '2.0' // Need 1 ETH for stake + gas
  },
  {
    name: 'Testnet',
    chainId: 420690,
    rpc: process.env.JEJU_RPC || 'https://testnet-rpc.jejunetwork.org',
    fundAmount: '0.5'
  },
  {
    name: 'Base Sepolia',
    chainId: 84532,
    rpc: process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
    fundAmount: '0.5'
  },
  {
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    rpc: process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc',
    fundAmount: '0.5'
  },
  {
    name: 'Optimism Sepolia',
    chainId: 11155420,
    rpc: process.env.OP_SEPOLIA_RPC || 'https://sepolia.optimism.io',
    fundAmount: '0.5'
  }
];

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    FUND XLP ON ALL TESTNETS              ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const deployerKey = process.env.DEPLOYER_KEY;
  const xlpAddress = process.env.XLP_ADDRESS;

  if (!deployerKey) {
    console.error('❌ DEPLOYER_KEY not set');
    process.exit(1);
  }

  if (!xlpAddress) {
    console.error('❌ XLP_ADDRESS not set');
    process.exit(1);
  }

  const deployerAccount = privateKeyToAccount(deployerKey as `0x${string}`);
  console.log(`Deployer: ${deployerAccount.address}`);
  console.log(`XLP:      ${xlpAddress}\n`);

  for (const chain of TESTNETS) {
    console.log(`\n=== ${chain.name} (${chain.chainId}) ===`);
    
    try {
      const chainObj = inferChainFromRpcUrl(chain.rpc);
      const publicClient = createPublicClient({ chain: chainObj, transport: http(chain.rpc) });
      const walletClient = createWalletClient({ account: deployerAccount, chain: chainObj, transport: http(chain.rpc) });
      
      // Check balances
      const deployerBalance = await getBalance(publicClient, { address: deployerAccount.address });
      const xlpBalance = await getBalance(publicClient, { address: xlpAddress as Address });
      
      console.log(`Deployer: ${formatEther(deployerBalance)} ETH`);
      console.log(`XLP:      ${formatEther(xlpBalance)} ETH`);
      
      const requiredAmount = parseEther(chain.fundAmount);
      
      if (xlpBalance >= requiredAmount) {
        console.log(`✓ XLP already funded`);
        continue;
      }
      
      const needed = requiredAmount - xlpBalance;
      
      if (deployerBalance < needed + parseEther('0.01')) {
        console.log(`⚠ Deployer has insufficient balance`);
        continue;
      }
      
      console.log(`Sending ${formatEther(needed)} ETH to XLP...`);
      
      const hash = await sendTransaction(walletClient, {
        to: xlpAddress as Address,
        value: needed,
        account: deployerAccount,
      });
      
      await waitForTransactionReceipt(publicClient, { hash });
      console.log(`✓ Funded: ${hash}`);
      
    } catch (error) {
      console.error(`❌ Error: ${(error as Error).message}`);
    }
  }

  console.log('\n\n=== Summary ===\n');
  
  for (const chain of TESTNETS) {
    try {
      const chainObj = inferChainFromRpcUrl(chain.rpc);
      const publicClient = createPublicClient({ chain: chainObj, transport: http(chain.rpc) });
      const balance = await getBalance(publicClient, { address: xlpAddress as Address });
      console.log(`${chain.name}: ${formatEther(balance)} ETH`);
    } catch {
      console.log(`${chain.name}: Unable to check`);
    }
  }
}

main().catch(console.error);

