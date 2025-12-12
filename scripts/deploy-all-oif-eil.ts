#!/usr/bin/env bun
/**
 * One-Command Full OIF/EIL Deployment
 * 
 * Usage:
 *   bun scripts/deploy-all-oif-eil.ts --network testnet
 *   bun scripts/deploy-all-oif-eil.ts --network testnet --dry-run
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const fmt = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const TESTNET_CHAINS = [
  { chainId: 11155111, name: 'Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  { chainId: 84532, name: 'Base Sepolia', rpc: 'https://sepolia.base.org' },
  { chainId: 421614, name: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc' },
  { chainId: 11155420, name: 'Optimism Sepolia', rpc: 'https://sepolia.optimism.io' },
];

async function checkBalance(pk: string, rpc: string): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const wallet = new ethers.Wallet(pk);
  const balance = await provider.getBalance(wallet.address);
  return Number(ethers.formatEther(balance)).toFixed(4);
}

async function run(cmd: string): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(['sh', '-c', cmd], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, output: stdout + stderr };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  console.log(fmt.bold('\n═══ Full OIF/EIL Deployment ═══\n'));
  
  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) {
    console.log(fmt.red('ERROR: Set DEPLOYER_PRIVATE_KEY first'));
    process.exit(1);
  }
  
  const wallet = new ethers.Wallet(pk);
  console.log('Deployer:', fmt.cyan(wallet.address), '\n');
  
  // Check balances
  console.log(fmt.cyan('Chain Balances:'));
  let needsFunding = false;
  for (const chain of TESTNET_CHAINS) {
    const bal = await checkBalance(pk, chain.rpc);
    const ok = Number(bal) >= 0.05;
    if (!ok) needsFunding = true;
    console.log(`  ${ok ? fmt.green('✓') : fmt.red('✗')} ${chain.name}: ${bal} ETH`);
  }
  
  if (needsFunding) {
    console.log(fmt.red('\nBLOCKED: Need 0.05+ ETH on each chain'));
    console.log('\nFaucets:');
    console.log('  Sepolia: https://sepoliafaucet.com');
    console.log('  Base: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet');
    process.exit(1);
  }
  
  if (dryRun) {
    console.log(fmt.yellow('\nDry run - would deploy OIF + Paymaster + Solver'));
    process.exit(0);
  }
  
  // Deploy OIF
  console.log(fmt.cyan('\n━━━ Deploying OIF ━━━'));
  for (const chain of [421614, 11155420]) {
    console.log(`Deploying to ${chain}...`);
    const { ok, output } = await run(`bun scripts/deploy/oif-multichain.ts --chain ${chain}`);
    console.log(ok ? fmt.green('  Done') : fmt.red('  Failed: ' + output.slice(0, 100)));
  }
  
  // Deploy Paymasters
  console.log(fmt.cyan('\n━━━ Deploying Paymasters ━━━'));
  for (const chain of [84532, 421614, 11155420]) {
    console.log(`Deploying to ${chain}...`);
    const { ok, output } = await run(`bun scripts/deploy/eil-paymaster.ts --chain ${chain}`);
    console.log(ok ? fmt.green('  Done') : fmt.red('  Failed: ' + output.slice(0, 100)));
  }
  
  // Register Solver
  console.log(fmt.cyan('\n━━━ Registering Solver ━━━'));
  const { ok, output } = await run('bun scripts/register-solver.ts --all --stake 0.1');
  console.log(ok ? fmt.green('Done') : fmt.yellow('Partial: ' + output.slice(0, 100)));
  
  // Verify
  console.log(fmt.cyan('\n━━━ Verification ━━━'));
  await run('bun scripts/check-oif-eil-readiness.ts --network testnet');
  
  console.log(fmt.bold('\n═══ Complete ═══\n'));
}

main().catch(err => {
  console.error(fmt.red('Failed: ' + err.message));
  process.exit(1);
});
