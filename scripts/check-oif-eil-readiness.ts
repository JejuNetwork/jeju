#!/usr/bin/env bun
/**
 * OIF/EIL Deployment Readiness Check
 * Usage: bun scripts/check-oif-eil-readiness.ts [--network testnet|mainnet]
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PUBLIC_RPCS, chainName, getChainIds } from './shared/chains';

// ANSI helpers
const fmt = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const icon = { pass: fmt.green('✓'), fail: fmt.red('✗'), warn: fmt.yellow('⚠') };

const SOLVER_REGISTRY_ABI = ['function getStats() view returns (uint256,uint256,uint256)'];
const _L1_STAKE_MANAGER_ABI = ['function getProtocolStats() view returns (uint256,uint256,uint256)'];

interface CheckResult { item: string; status: 'pass' | 'warn' | 'fail'; action?: string }
const results: CheckResult[] = [];

function add(item: string, status: 'pass' | 'warn' | 'fail', action?: string) {
  results.push({ item, status, action });
}

async function checkContract(chainId: number, address: string): Promise<boolean> {
  if (!address) return false;
  const rpc = PUBLIC_RPCS[chainId];
  if (!rpc) return false;
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const code = await provider.getCode(address);
  return code.length > 2;
}

async function checkRPC(chainId: number): Promise<boolean> {
  const rpc = PUBLIC_RPCS[chainId];
  if (!rpc) return false;
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const network = await provider.getNetwork();
  return Number(network.chainId) === chainId;
}

async function main() {
  const args = process.argv.slice(2);
  const network = (args[args.indexOf('--network') + 1] as 'testnet' | 'mainnet') || 'testnet';

  console.log(fmt.bold('\n╔════════════════════════════════════════════════════════════════╗'));
  console.log(fmt.bold('║         OIF/EIL Integration Readiness Check                    ║'));
  console.log(fmt.bold('╚════════════════════════════════════════════════════════════════╝\n'));
  console.log(`Network: ${fmt.bold(network.toUpperCase())}\n`);

  // Load configs
  const oifPath = resolve(process.cwd(), `packages/contracts/deployments/oif-${network}.json`);
  const eilPath = resolve(process.cwd(), 'packages/config/eil.json');
  
  const oifDeployments = existsSync(oifPath) ? JSON.parse(readFileSync(oifPath, 'utf-8')).chains || {} : {};
  const eilConfig = existsSync(eilPath) ? JSON.parse(readFileSync(eilPath, 'utf-8'))[network] : null;

  // Environment
  console.log(fmt.cyan('━━━ Environment ━━━'));
  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (pk) {
    const addr = new ethers.Wallet(pk).address;
    add('Deployer', 'pass');
    console.log(`  ${icon.pass} Deployer: ${addr}`);
  } else {
    add('Deployer', 'fail', 'Set DEPLOYER_PRIVATE_KEY');
    console.log(`  ${icon.fail} Deployer key not set`);
  }
  console.log('');

  // RPC connectivity
  console.log(fmt.cyan('━━━ RPC Connectivity ━━━'));
  const chainIds = getChainIds(network);
  for (const id of chainIds) {
    const name = chainName(id);
    let ok = false;
    try { ok = await checkRPC(id); } catch { ok = false; }
    if (ok) {
      add(name, 'pass');
      console.log(`  ${icon.pass} ${name}`);
    } else {
      add(name, 'fail', `Check RPC for chain ${id}`);
      console.log(`  ${icon.fail} ${name} - not reachable`);
    }
  }
  console.log('');

  // OIF contracts
  console.log(fmt.cyan('━━━ OIF Contracts ━━━'));
  for (const id of chainIds) {
    const name = chainName(id);
    const data = oifDeployments[id.toString()];
    const registry = data?.contracts?.solverRegistry;
    
    if (data?.status === 'deployed' && registry) {
      let exists = false;
      try { exists = await checkContract(id, registry); } catch { exists = false; }
      if (exists) {
        add(`OIF ${name}`, 'pass');
        console.log(`  ${icon.pass} ${name}: ${registry.slice(0, 18)}...`);
      } else {
        add(`OIF ${name}`, 'warn');
        console.log(`  ${icon.warn} ${name}: not found on-chain`);
      }
    } else {
      add(`OIF ${name}`, 'fail', `bun scripts/deploy/oif-multichain.ts --chain ${id}`);
      console.log(`  ${icon.fail} ${name}: not deployed`);
    }
  }
  console.log('');

  // EIL contracts
  console.log(fmt.cyan('━━━ EIL Contracts ━━━'));
  if (eilConfig?.hub?.l1StakeManager) {
    let exists = false;
    try { exists = await checkContract(eilConfig.hub.chainId, eilConfig.hub.l1StakeManager); } catch { exists = false; }
    if (exists) {
      add('L1StakeManager', 'pass');
      console.log(`  ${icon.pass} L1StakeManager: ${eilConfig.hub.l1StakeManager.slice(0, 18)}...`);
    } else {
      add('L1StakeManager', 'warn');
      console.log(`  ${icon.warn} L1StakeManager: not found on-chain`);
    }
  } else {
    add('L1StakeManager', 'fail', 'bun scripts/deploy/eil.ts testnet');
    console.log(`  ${icon.fail} L1StakeManager: not configured`);
  }

  if (eilConfig?.chains) {
    for (const chain of Object.values(eilConfig.chains) as Array<{ chainId: number; crossChainPaymaster: string }>) {
      const name = chainName(chain.chainId);
      if (chain.crossChainPaymaster) {
        let exists = false;
        try { exists = await checkContract(chain.chainId, chain.crossChainPaymaster); } catch { exists = false; }
        console.log(`  ${exists ? icon.pass : icon.warn} Paymaster (${name}): ${exists ? chain.crossChainPaymaster.slice(0, 18) + '...' : 'not on-chain'}`);
      } else {
        add(`Paymaster ${name}`, 'fail');
        console.log(`  ${icon.fail} Paymaster (${name}): not configured`);
      }
    }
  }
  console.log('');

  // Solver status
  console.log(fmt.cyan('━━━ Solver Status ━━━'));
  let totalSolvers = 0;
  for (const id of chainIds) {
    const registry = oifDeployments[id.toString()]?.contracts?.solverRegistry;
    if (!registry) continue;
    const rpc = PUBLIC_RPCS[id];
    if (!rpc) continue;
    
    try {
      const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
      const contract = new ethers.Contract(registry, SOLVER_REGISTRY_ABI, provider);
      const [staked, , solvers] = await contract.getStats();
      totalSolvers += Number(solvers);
      const name = chainName(id);
      if (Number(solvers) > 0) {
        console.log(`  ${icon.pass} ${name}: ${solvers} solvers, ${ethers.formatEther(staked)} ETH`);
      } else {
        console.log(`  ${icon.warn} ${name}: no solvers registered`);
      }
    } catch { /* skip */ }
  }
  
  if (totalSolvers === 0) add('Solvers', 'fail', 'bun scripts/register-solver.ts --all --stake 0.5');
  console.log('');

  // Summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;

  console.log(fmt.cyan('━━━ Summary ━━━'));
  console.log(`  ${icon.pass} Passed: ${passed}`);
  console.log(`  ${icon.warn} Warnings: ${warned}`);
  console.log(`  ${icon.fail} Failed: ${failed}\n`);

  const actions = results.filter(r => r.status === 'fail' && r.action);
  if (actions.length > 0) {
    console.log(fmt.cyan('━━━ Required Actions ━━━'));
    actions.forEach((a, i) => console.log(`  ${i + 1}. ${fmt.bold(a.item)}: ${a.action}`));
    console.log('');
  }

  console.log(fmt.cyan('━━━ Quick Commands ━━━'));
  console.log('  bun scripts/deploy/oif-multichain.ts --all');
  console.log('  bun scripts/deploy/eil-paymaster.ts --all');
  console.log('  bun scripts/register-solver.ts --all --stake 0.5');
  console.log('  bun scripts/verify-crosschain-liquidity.ts\n');

  const status = failed === 0 ? (warned === 0 ? 'READY' : 'PARTIAL') : 'NOT READY';
  const color = failed === 0 ? (warned === 0 ? fmt.green : fmt.yellow) : fmt.red;
  console.log(fmt.bold(`━━━ Status: ${color(status)} ━━━\n`));

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(`Check failed: ${err.message}`);
  process.exit(1);
});
