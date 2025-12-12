#!/usr/bin/env bun
/**
 * @fileoverview OIF/EIL Deployment Readiness Check
 * 
 * Comprehensive check for cross-chain integration readiness:
 * - Infrastructure status
 * - Contract deployments
 * - Solver/XLP registration
 * - Route connectivity
 * 
 * Usage:
 *   bun run scripts/check-oif-eil-readiness.ts [--network testnet|mainnet]
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ANSI colors
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// Public RPC URLs
const PUBLIC_RPCS: Record<number, string> = {
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  84532: 'https://sepolia.base.org',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
  11155420: 'https://sepolia.optimism.io',
  420690: 'https://testnet-rpc.jeju.network',
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  420691: 'https://rpc.jeju.network',
};

const CHAIN_NAMES: Record<number, string> = {
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  421614: 'Arbitrum Sepolia',
  11155420: 'Optimism Sepolia',
  420690: 'Jeju Testnet',
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum One',
  10: 'OP Mainnet',
  420691: 'Jeju Mainnet',
};

const SOLVER_REGISTRY_ABI = [
  'function getStats() view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeSolvers)',
];

const L1_STAKE_MANAGER_ABI = [
  'function getProtocolStats() view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeXLPs)',
];

interface CheckResult {
  category: string;
  item: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  action?: string;
}

const results: CheckResult[] = [];

function addResult(category: string, item: string, status: 'pass' | 'warn' | 'fail', message: string, action?: string) {
  results.push({ category, item, status, message, action });
}

async function checkRPCConnectivity(chainId: number): Promise<boolean> {
  const rpcUrl = PUBLIC_RPCS[chainId];
  if (!rpcUrl) return false;
  
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const network = await provider.getNetwork();
  return Number(network.chainId) === chainId;
}

async function checkContractDeployed(rpcUrl: string, address: string): Promise<boolean> {
  if (!address || address === '') return false;
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const code = await provider.getCode(address);
  return code !== '0x' && code.length > 2;
}

async function main() {
  const args = process.argv.slice(2);
  const networkArg = args.indexOf('--network');
  const network = networkArg !== -1 ? (args[networkArg + 1] as 'testnet' | 'mainnet') : 'testnet';

  console.log('');
  console.log(bold('╔════════════════════════════════════════════════════════════════╗'));
  console.log(bold('║         OIF/EIL Integration Readiness Check                    ║'));
  console.log(bold('╚════════════════════════════════════════════════════════════════╝'));
  console.log('');
  console.log(`Network: ${bold(network.toUpperCase())}`);
  console.log('');

  // ========== ENVIRONMENT CHECKS ==========
  console.log(cyan('━━━ Environment ━━━'));
  
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (privateKey) {
    const wallet = new ethers.Wallet(privateKey);
    addResult('Environment', 'Deployer Key', 'pass', `Configured: ${wallet.address.slice(0, 10)}...`);
    console.log(`  ${green('✓')} Deployer: ${wallet.address}`);
  } else {
    addResult('Environment', 'Deployer Key', 'fail', 'Not configured', 'Set DEPLOYER_PRIVATE_KEY or PRIVATE_KEY');
    console.log(`  ${red('✗')} Deployer key not set`);
  }
  console.log('');

  // ========== LOAD CONFIGS ==========
  const oifPath = resolve(process.cwd(), `packages/contracts/deployments/oif-${network}.json`);
  const eilPath = resolve(process.cwd(), 'packages/config/eil.json');
  
  let oifDeployments: Record<string, { status: string; contracts?: Record<string, string> }> = {};
  let eilConfig: { hub?: { chainId: number; l1StakeManager: string }; chains?: Record<string, { chainId: number; crossChainPaymaster: string }> } | null = null;
  
  if (existsSync(oifPath)) {
    const oif = JSON.parse(readFileSync(oifPath, 'utf-8'));
    oifDeployments = oif.chains || {};
  }
  
  if (existsSync(eilPath)) {
    const eil = JSON.parse(readFileSync(eilPath, 'utf-8'));
    eilConfig = eil[network] || null;
  }

  // ========== RPC CONNECTIVITY ==========
  console.log(cyan('━━━ RPC Connectivity ━━━'));
  
  const targetChains = network === 'testnet' 
    ? [11155111, 84532, 421614, 11155420, 420690]
    : [1, 8453, 42161, 10, 420691];

  for (const chainId of targetChains) {
    let connected = false;
    try {
      connected = await checkRPCConnectivity(chainId);
    } catch {
      connected = false;
    }
    
    const name = CHAIN_NAMES[chainId] || `Chain ${chainId}`;
    if (connected) {
      addResult('RPC', name, 'pass', 'Connected');
      console.log(`  ${green('✓')} ${name}`);
    } else {
      addResult('RPC', name, 'fail', 'Not reachable', `Check RPC URL for chain ${chainId}`);
      console.log(`  ${red('✗')} ${name} - not reachable`);
    }
  }
  console.log('');

  // ========== OIF CONTRACTS ==========
  console.log(cyan('━━━ OIF Contracts ━━━'));
  
  let oifDeployed = 0;
  let oifPending = 0;
  
  for (const chainId of targetChains) {
    const chainData = oifDeployments[chainId.toString()];
    const name = CHAIN_NAMES[chainId] || `Chain ${chainId}`;
    
    if (chainData?.status === 'deployed' && chainData.contracts?.solverRegistry) {
      // Verify contract actually exists
      const rpcUrl = PUBLIC_RPCS[chainId];
      let exists = false;
      if (rpcUrl) {
        try {
          exists = await checkContractDeployed(rpcUrl, chainData.contracts.solverRegistry);
        } catch {
          exists = false;
        }
      }
      
      if (exists) {
        oifDeployed++;
        addResult('OIF', name, 'pass', `Deployed: ${chainData.contracts.solverRegistry.slice(0, 10)}...`);
        console.log(`  ${green('✓')} ${name}: ${chainData.contracts.solverRegistry.slice(0, 18)}...`);
      } else {
        oifPending++;
        addResult('OIF', name, 'warn', 'Marked deployed but contract not found', 'Re-deploy OIF contracts');
        console.log(`  ${yellow('⚠')} ${name}: contract not found on-chain`);
      }
    } else {
      oifPending++;
      addResult('OIF', name, 'fail', 'Not deployed', `Deploy with: bun scripts/deploy/oif-multichain.ts --chain ${chainId}`);
      console.log(`  ${red('✗')} ${name}: not deployed`);
    }
  }
  console.log('');

  // ========== EIL CONTRACTS ==========
  console.log(cyan('━━━ EIL Contracts ━━━'));
  
  // L1 StakeManager
  if (eilConfig?.hub?.l1StakeManager) {
    const hubChainId = eilConfig.hub.chainId;
    const rpcUrl = PUBLIC_RPCS[hubChainId];
    let exists = false;
    
    if (rpcUrl) {
      try {
        exists = await checkContractDeployed(rpcUrl, eilConfig.hub.l1StakeManager);
      } catch {
        exists = false;
      }
    }
    
    if (exists) {
      addResult('EIL', 'L1StakeManager', 'pass', `Deployed: ${eilConfig.hub.l1StakeManager.slice(0, 18)}...`);
      console.log(`  ${green('✓')} L1StakeManager: ${eilConfig.hub.l1StakeManager.slice(0, 18)}...`);
    } else {
      addResult('EIL', 'L1StakeManager', 'warn', 'Configured but not deployed', 'Deploy with: bun scripts/deploy/eil.ts testnet');
      console.log(`  ${yellow('⚠')} L1StakeManager: not found on-chain`);
    }
  } else {
    addResult('EIL', 'L1StakeManager', 'fail', 'Not configured', 'Deploy with: bun scripts/deploy/eil.ts testnet');
    console.log(`  ${red('✗')} L1StakeManager: not configured`);
  }
  
  // CrossChainPaymaster on L2s
  if (eilConfig?.chains) {
    for (const [, chain] of Object.entries(eilConfig.chains)) {
      const name = CHAIN_NAMES[chain.chainId] || `Chain ${chain.chainId}`;
      
      if (chain.crossChainPaymaster) {
        const rpcUrl = PUBLIC_RPCS[chain.chainId];
        let exists = false;
        
        if (rpcUrl) {
          try {
            exists = await checkContractDeployed(rpcUrl, chain.crossChainPaymaster);
          } catch {
            exists = false;
          }
        }
        
        if (exists) {
          addResult('EIL', `Paymaster (${name})`, 'pass', `Deployed: ${chain.crossChainPaymaster.slice(0, 18)}...`);
          console.log(`  ${green('✓')} Paymaster (${name}): ${chain.crossChainPaymaster.slice(0, 18)}...`);
        } else {
          addResult('EIL', `Paymaster (${name})`, 'warn', 'Configured but not deployed');
          console.log(`  ${yellow('⚠')} Paymaster (${name}): not found on-chain`);
        }
      } else {
        addResult('EIL', `Paymaster (${name})`, 'fail', 'Not configured');
        console.log(`  ${red('✗')} Paymaster (${name}): not configured`);
      }
    }
  }
  console.log('');

  // ========== SOLVER STATUS ==========
  console.log(cyan('━━━ Solver Status ━━━'));
  
  let totalSolvers = 0;
  let totalStaked = 0n;
  
  for (const chainId of targetChains) {
    const chainData = oifDeployments[chainId.toString()];
    if (!chainData?.contracts?.solverRegistry) continue;
    
    const rpcUrl = PUBLIC_RPCS[chainId];
    if (!rpcUrl) continue;
    
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
      const registry = new ethers.Contract(chainData.contracts.solverRegistry, SOLVER_REGISTRY_ABI, provider);
      const [staked, , solvers] = await registry.getStats();
      
      totalSolvers += Number(solvers);
      totalStaked += staked;
      
      const name = CHAIN_NAMES[chainId] || `Chain ${chainId}`;
      if (Number(solvers) > 0) {
        console.log(`  ${green('✓')} ${name}: ${solvers} solvers, ${ethers.formatEther(staked)} ETH staked`);
      } else {
        console.log(`  ${yellow('⚠')} ${name}: no solvers registered`);
      }
    } catch {
      // Skip
    }
  }
  
  if (totalSolvers === 0) {
    addResult('Solvers', 'Registration', 'fail', 'No solvers registered', 'Run: bun scripts/register-solver.ts --all --stake 0.5');
  } else {
    addResult('Solvers', 'Registration', 'pass', `${totalSolvers} solvers, ${ethers.formatEther(totalStaked)} ETH staked`);
  }
  console.log('');

  // ========== SUMMARY ==========
  console.log(cyan('━━━ Summary ━━━'));
  
  const passCount = results.filter(r => r.status === 'pass').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  
  console.log(`  ${green('✓')} Passed: ${passCount}`);
  console.log(`  ${yellow('⚠')} Warnings: ${warnCount}`);
  console.log(`  ${red('✗')} Failed: ${failCount}`);
  console.log('');

  // ========== REQUIRED ACTIONS ==========
  const actions = results.filter(r => r.status === 'fail' && r.action);
  
  if (actions.length > 0) {
    console.log(cyan('━━━ Required Actions ━━━'));
    actions.forEach((a, i) => {
      console.log(`  ${i + 1}. ${bold(a.item)}: ${a.action}`);
    });
    console.log('');
  }

  // ========== NEXT STEPS ==========
  console.log(cyan('━━━ Deployment Commands ━━━'));
  console.log('');
  console.log('  # 1. Set deployer key (if not set)');
  console.log('  export DEPLOYER_PRIVATE_KEY=your_private_key_here');
  console.log('');
  console.log('  # 2. Deploy OIF to all chains');
  console.log('  bun run scripts/deploy/oif-multichain.ts --all');
  console.log('');
  console.log('  # 3. Deploy EIL');
  console.log('  bun run scripts/deploy/eil.ts testnet');
  console.log('');
  console.log('  # 4. Register as solver');
  console.log('  bun run scripts/register-solver.ts --all --stake 0.5');
  console.log('');
  console.log('  # 5. Register as XLP (optional)');
  console.log('  bun run scripts/register-xlp.ts --network testnet --stake 1.0');
  console.log('');
  console.log('  # 6. Verify deployment');
  console.log('  bun run scripts/verify-crosschain-liquidity.ts --network testnet');
  console.log('');

  // Overall status
  const overallStatus = failCount === 0 ? (warnCount === 0 ? 'READY' : 'PARTIAL') : 'NOT READY';
  const statusColor = failCount === 0 ? (warnCount === 0 ? green : yellow) : red;
  
  console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(bold(`Status: ${statusColor(overallStatus)}`));
  console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(`Check failed: ${err.message}`);
  process.exit(1);
});
