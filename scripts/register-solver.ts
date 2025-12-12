#!/usr/bin/env bun
/**
 * @fileoverview Solver Registration Script
 * 
 * Registers a solver on the OIF SolverRegistry contract.
 * Solvers must stake ETH and specify which chains they support.
 * 
 * Usage:
 *   bun run scripts/register-solver.ts --chain <chainId> [--stake <amount>]
 *   bun run scripts/register-solver.ts --all --stake 0.5
 * 
 * Environment:
 *   DEPLOYER_PRIVATE_KEY or SOLVER_PRIVATE_KEY - Solver's private key
 */

import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const logger = new Logger('register-solver');

const SOLVER_REGISTRY_ABI = [
  'function register(uint256[] calldata chains) external payable',
  'function addStake() external payable',
  'function addChain(uint256 chainId) external',
  'function getSolver(address solver) external view returns (tuple(address solver, uint256 stakedAmount, uint256 slashedAmount, uint256 totalFills, uint256 successfulFills, uint256[] supportedChains, bool isActive, uint256 registeredAt))',
  'function isSolverActive(address solver) external view returns (bool)',
  'function getSolverStake(address solver) external view returns (uint256)',
  'function getSolverChains(address solver) external view returns (uint256[])',
  'function MIN_STAKE() external view returns (uint256)',
  'function getStats() external view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeSolvers)',
];

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

// Chain names
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

interface DeployedContracts {
  solverRegistry: string;
  inputSettler: string;
  outputSettler: string;
  oracle: string;
}

function loadOIFDeployments(network: 'testnet' | 'mainnet'): Record<string, { contracts: DeployedContracts; status: string }> {
  const deploymentsPath = resolve(process.cwd(), `packages/contracts/deployments/oif-${network}.json`);
  if (!existsSync(deploymentsPath)) return {};
  const data = JSON.parse(readFileSync(deploymentsPath, 'utf-8'));
  return data.chains || {};
}

async function getSolverStatus(
  provider: ethers.JsonRpcProvider,
  registryAddress: string,
  solverAddress: string
): Promise<{
  isRegistered: boolean;
  isActive: boolean;
  stake: bigint;
  chains: number[];
}> {
  const registry = new ethers.Contract(registryAddress, SOLVER_REGISTRY_ABI, provider);
  
  const isActive = await registry.isSolverActive(solverAddress);
  const stake = await registry.getSolverStake(solverAddress);
  let chains: number[] = [];
  
  if (isActive) {
    const chainsRaw = await registry.getSolverChains(solverAddress);
    chains = chainsRaw.map((c: bigint) => Number(c));
  }
  
  return {
    isRegistered: stake > 0n || isActive,
    isActive,
    stake,
    chains,
  };
}

async function registerSolver(
  chainId: number,
  supportedChains: number[],
  stakeAmount: string,
  privateKey: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const rpcUrl = PUBLIC_RPCS[chainId];
  if (!rpcUrl) {
    return { success: false, error: `No RPC URL for chain ${chainId}` };
  }

  const deployments = loadOIFDeployments(chainId >= 1000000 ? 'mainnet' : 'testnet');
  const chainData = deployments[chainId.toString()];
  
  if (!chainData?.contracts?.solverRegistry) {
    return { success: false, error: `SolverRegistry not deployed on chain ${chainId}` };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const registry = new ethers.Contract(chainData.contracts.solverRegistry, SOLVER_REGISTRY_ABI, wallet);

  // Check current status
  const status = await getSolverStatus(provider, chainData.contracts.solverRegistry, wallet.address);
  
  if (status.isActive) {
    logger.info(`Solver already registered on ${CHAIN_NAMES[chainId]}`);
    logger.info(`  Stake: ${ethers.formatEther(status.stake)} ETH`);
    logger.info(`  Chains: ${status.chains.map(c => CHAIN_NAMES[c] || c).join(', ')}`);
    
    // Check if we need to add more chains
    const newChains = supportedChains.filter(c => !status.chains.includes(c));
    if (newChains.length > 0) {
      logger.info(`Adding support for new chains: ${newChains.map(c => CHAIN_NAMES[c] || c).join(', ')}`);
      for (const newChain of newChains) {
        const tx = await registry.addChain(newChain);
        await tx.wait();
        logger.info(`  Added chain ${newChain}`);
      }
    }
    
    return { success: true };
  }

  // Get minimum stake
  const minStake = await registry.MIN_STAKE();
  const stake = ethers.parseEther(stakeAmount);
  
  if (stake < minStake) {
    return { 
      success: false, 
      error: `Stake ${stakeAmount} ETH is below minimum ${ethers.formatEther(minStake)} ETH` 
    };
  }

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  if (balance < stake) {
    return { 
      success: false, 
      error: `Insufficient balance: ${ethers.formatEther(balance)} ETH, need ${stakeAmount} ETH` 
    };
  }

  logger.info(`Registering solver on ${CHAIN_NAMES[chainId]}...`);
  logger.info(`  Stake: ${stakeAmount} ETH`);
  logger.info(`  Supported chains: ${supportedChains.map(c => CHAIN_NAMES[c] || c).join(', ')}`);

  const tx = await registry.register(supportedChains, { value: stake });
  logger.info(`  Transaction: ${tx.hash}`);
  
  const receipt = await tx.wait();
  
  if (receipt.status === 0) {
    return { success: false, error: 'Transaction reverted' };
  }

  return { success: true, txHash: tx.hash };
}

async function main() {
  const args = process.argv.slice(2);
  const allChains = args.includes('--all');
  const chainIdArg = args.indexOf('--chain');
  const stakeArg = args.indexOf('--stake');
  
  const specificChainId = chainIdArg !== -1 ? parseInt(args[chainIdArg + 1]) : null;
  const stakeAmount = stakeArg !== -1 ? args[stakeArg + 1] : '0.5';

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              OIF Solver Registration                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Get private key
  const privateKey = process.env.SOLVER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    logger.error('SOLVER_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, or PRIVATE_KEY required');
    console.log('\nSet one of these environment variables with your solver wallet private key');
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey);
  logger.info(`Solver address: ${wallet.address}\n`);

  // Load deployments
  const testnetDeployments = loadOIFDeployments('testnet');
  const mainnetDeployments = loadOIFDeployments('mainnet');
  const allDeployments = { ...testnetDeployments, ...mainnetDeployments };

  // Find deployed chains
  const deployedChainIds = Object.entries(allDeployments)
    .filter(([, data]) => data.status === 'deployed' && data.contracts?.solverRegistry)
    .map(([chainId]) => parseInt(chainId));

  if (deployedChainIds.length === 0) {
    logger.error('No OIF contracts deployed');
    console.log('\nDeploy OIF first: bun run scripts/deploy/oif-multichain.ts --all');
    process.exit(1);
  }

  // Determine which chains to register on
  let targetChains: number[];
  if (specificChainId) {
    if (!deployedChainIds.includes(specificChainId)) {
      logger.error(`Chain ${specificChainId} does not have OIF deployed`);
      console.log(`\nDeployed chains: ${deployedChainIds.map(c => `${CHAIN_NAMES[c]} (${c})`).join(', ')}`);
      process.exit(1);
    }
    targetChains = [specificChainId];
  } else if (allChains) {
    targetChains = deployedChainIds;
  } else {
    console.log('Available chains with OIF deployed:');
    deployedChainIds.forEach(chainId => {
      console.log(`  - ${CHAIN_NAMES[chainId] || chainId} (${chainId})`);
    });
    console.log('\nUsage:');
    console.log('  Register on specific chain: bun run scripts/register-solver.ts --chain 84532');
    console.log('  Register on all chains:     bun run scripts/register-solver.ts --all --stake 0.5');
    process.exit(0);
  }

  // Supported chains for the solver (all deployed chains)
  const supportedChains = deployedChainIds;

  console.log(`Stake amount: ${stakeAmount} ETH`);
  console.log(`Target chains: ${targetChains.map(c => CHAIN_NAMES[c] || c).join(', ')}`);
  console.log(`Supported chains: ${supportedChains.map(c => CHAIN_NAMES[c] || c).join(', ')}`);
  console.log('');

  // Register on each target chain
  const results: Array<{ chainId: number; success: boolean; error?: string }> = [];

  for (const chainId of targetChains) {
    const result = await registerSolver(chainId, supportedChains, stakeAmount, privateKey);
    results.push({ chainId, ...result });
    
    if (result.success) {
      logger.success(`${CHAIN_NAMES[chainId]}: Registered successfully`);
      if (result.txHash) {
        console.log(`   Transaction: ${result.txHash}`);
      }
    } else {
      logger.error(`${CHAIN_NAMES[chainId]}: ${result.error}`);
    }
    console.log('');
  }

  // Summary
  console.log('═══ Summary ═══\n');
  const successCount = results.filter(r => r.success).length;
  console.log(`Registered: ${successCount}/${results.length} chains`);

  if (successCount > 0) {
    console.log('\nNext steps:');
    console.log('1. Start solver agent: cd apps/gateway && bun run dev:solver');
    console.log('2. Monitor fills: bun run scripts/verify-crosschain-liquidity.ts');
  }

  process.exit(successCount === results.length ? 0 : 1);
}

main().catch(err => {
  logger.error(`Registration failed: ${err.message}`);
  process.exit(1);
});
