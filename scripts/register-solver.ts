#!/usr/bin/env bun
/**
 * Solver Registration Script - Registers solvers on OIF SolverRegistry contracts
 * 
 * Usage:
 *   bun scripts/register-solver.ts --chain <chainId> [--stake <amount>]
 *   bun scripts/register-solver.ts --all --stake 0.5
 */

import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PUBLIC_RPCS, chainName } from './shared/chains';

const logger = new Logger('register-solver');

const SOLVER_REGISTRY_ABI = [
  'function register(uint256[] calldata chains) external payable',
  'function addChain(uint256 chainId) external',
  'function isSolverActive(address solver) external view returns (bool)',
  'function getSolverStake(address solver) external view returns (uint256)',
  'function getSolverChains(address solver) external view returns (uint256[])',
  'function MIN_STAKE() external view returns (uint256)',
];

interface OIFDeployment {
  status: string;
  contracts?: { solverRegistry: string };
}

function loadDeployments(network: 'testnet' | 'mainnet'): Record<string, OIFDeployment> {
  const path = resolve(process.cwd(), `packages/contracts/deployments/oif-${network}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8')).chains || {};
}

function getDeployedChains(): number[] {
  const all = { ...loadDeployments('testnet'), ...loadDeployments('mainnet') };
  return Object.entries(all)
    .filter(([, d]) => d.status === 'deployed' && d.contracts?.solverRegistry)
    .map(([id]) => parseInt(id));
}

async function registerSolver(
  chainId: number,
  supportedChains: number[],
  stakeAmount: string,
  privateKey: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const rpc = PUBLIC_RPCS[chainId];
  if (!rpc) return { success: false, error: `No RPC for chain ${chainId}` };

  const deployments = loadDeployments(chainId >= 1000000 ? 'mainnet' : 'testnet');
  const registry = deployments[chainId.toString()]?.contracts?.solverRegistry;
  if (!registry) return { success: false, error: `SolverRegistry not deployed on ${chainName(chainId)}` };

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(registry, SOLVER_REGISTRY_ABI, wallet);

  // Check if already registered
  const isActive = await contract.isSolverActive(wallet.address);
  if (isActive) {
    const stake = await contract.getSolverStake(wallet.address);
    const chains = (await contract.getSolverChains(wallet.address)).map((c: bigint) => Number(c));
    logger.info(`Already registered on ${chainName(chainId)}: ${ethers.formatEther(stake)} ETH`);
    
    // Add new chains if needed
    const newChains = supportedChains.filter(c => !chains.includes(c));
    for (const c of newChains) {
      const tx = await contract.addChain(c);
      await tx.wait();
      logger.info(`  Added chain ${chainName(c)}`);
    }
    return { success: true };
  }

  // Validate stake
  const minStake = await contract.MIN_STAKE();
  const stake = ethers.parseEther(stakeAmount);
  if (stake < minStake) {
    return { success: false, error: `Stake ${stakeAmount} ETH below min ${ethers.formatEther(minStake)} ETH` };
  }

  const balance = await provider.getBalance(wallet.address);
  if (balance < stake) {
    return { success: false, error: `Insufficient balance: ${ethers.formatEther(balance)} ETH` };
  }

  logger.info(`Registering on ${chainName(chainId)} with ${stakeAmount} ETH...`);
  const tx = await contract.register(supportedChains, { value: stake });
  logger.info(`  TX: ${tx.hash}`);
  
  const receipt = await tx.wait();
  if (receipt.status === 0) return { success: false, error: 'Transaction reverted' };

  return { success: true, txHash: tx.hash };
}

async function main() {
  const args = process.argv.slice(2);
  const allChains = args.includes('--all');
  const chainIdx = args.indexOf('--chain');
  const stakeIdx = args.indexOf('--stake');
  
  const specificChainId = chainIdx !== -1 ? parseInt(args[chainIdx + 1]) : null;
  const stakeAmount = stakeIdx !== -1 ? args[stakeIdx + 1] : '0.5';

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              OIF Solver Registration                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const privateKey = process.env.SOLVER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    logger.error('Set SOLVER_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, or PRIVATE_KEY');
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey);
  logger.info(`Solver: ${wallet.address}\n`);

  const deployedChains = getDeployedChains();
  if (deployedChains.length === 0) {
    logger.error('No OIF contracts deployed. Run: bun scripts/deploy/oif-multichain.ts --all');
    process.exit(1);
  }

  // Determine targets
  let targetChains: number[];
  if (specificChainId) {
    if (!deployedChains.includes(specificChainId)) {
      logger.error(`Chain ${specificChainId} not deployed. Available: ${deployedChains.map(chainName).join(', ')}`);
      process.exit(1);
    }
    targetChains = [specificChainId];
  } else if (allChains) {
    targetChains = deployedChains;
  } else {
    console.log('Deployed chains:', deployedChains.map(c => `${chainName(c)} (${c})`).join(', '));
    console.log('\nUsage: bun scripts/register-solver.ts --chain 84532 or --all --stake 0.5');
    process.exit(0);
  }

  console.log(`Stake: ${stakeAmount} ETH | Targets: ${targetChains.map(chainName).join(', ')}\n`);

  // Register
  let successCount = 0;
  for (const chainId of targetChains) {
    const result = await registerSolver(chainId, deployedChains, stakeAmount, privateKey);
    if (result.success) {
      logger.success(`${chainName(chainId)}: OK${result.txHash ? ` (${result.txHash})` : ''}`);
      successCount++;
    } else {
      logger.error(`${chainName(chainId)}: ${result.error}`);
    }
  }

  console.log(`\n═══ ${successCount}/${targetChains.length} registered ═══`);
  process.exit(successCount === targetChains.length ? 0 : 1);
}

main().catch(err => {
  logger.error(err.message);
  process.exit(1);
});
