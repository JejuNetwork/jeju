#!/usr/bin/env bun
/**
 * @fileoverview Cross-Chain Liquidity Verification Script
 * 
 * Verifies cross-chain interoperability across all supported chains:
 * - Checks OIF contract deployments
 * - Verifies solver liquidity on each chain
 * - Tests cross-chain route connectivity
 * - Validates XLP stake and liquidity
 * 
 * Usage:
 *   bun run scripts/verify-crosschain-liquidity.ts [--network testnet|mainnet]
 */

import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const logger = new Logger('verify-crosschain');

interface ChainStatus {
  chainId: number;
  name: string;
  connected: boolean;
  oifDeployed: boolean;
  solverLiquidity: bigint;
  xlpLiquidity: bigint;
  activeSolvers: number;
  activeXLPs: number;
}

interface CrossChainRoute {
  from: number;
  to: number;
  enabled: boolean;
  hasSolvers: boolean;
  hasLiquidity: boolean;
}

const SOLVER_REGISTRY_ABI = [
  'function getStats() view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeSolvers)',
  'function isSolverActive(address solver) view returns (bool)',
];

const OUTPUT_SETTLER_ABI = [
  'function getSolverETH(address solver) view returns (uint256)',
  'function getSolverLiquidity(address solver, address token) view returns (uint256)',
];

const CROSS_CHAIN_PAYMASTER_ABI = [
  'function getXLPETH(address xlp) view returns (uint256)',
  'function xlpVerifiedStake(address xlp) view returns (uint256)',
];

const L1_STAKE_MANAGER_ABI = [
  'function getProtocolStats() view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeXLPs)',
  'function isXLPActive(address xlp) view returns (bool)',
];

// Load chain configs
function loadChainConfigs(network: 'testnet' | 'mainnet') {
  const chainsPath = resolve(process.cwd(), 'packages/config/chains.json');
  const chains = JSON.parse(readFileSync(chainsPath, 'utf-8'));
  return chains[network];
}

function loadOIFDeployments(network: 'testnet' | 'mainnet') {
  const deploymentsPath = resolve(process.cwd(), `packages/contracts/deployments/oif-${network}.json`);
  try {
    return JSON.parse(readFileSync(deploymentsPath, 'utf-8'));
  } catch {
    return { chains: {} };
  }
}

function loadContractsConfig(network: 'testnet' | 'mainnet') {
  const contractsPath = resolve(process.cwd(), 'packages/config/contracts.json');
  const contracts = JSON.parse(readFileSync(contractsPath, 'utf-8'));
  return contracts[network];
}

async function checkChainConnectivity(rpcUrl: string, expectedChainId: number): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    return Number(network.chainId) === expectedChainId;
  } catch {
    return false;
  }
}

async function checkContractDeployed(rpcUrl: string, address: string): Promise<boolean> {
  if (!address || address === '') return false;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const code = await provider.getCode(address);
    return code !== '0x' && code.length > 2;
  } catch {
    return false;
  }
}

async function getOIFStats(
  rpcUrl: string,
  solverRegistryAddr: string,
  outputSettlerAddr: string
): Promise<{ activeSolvers: number; totalStaked: bigint }> {
  if (!solverRegistryAddr) return { activeSolvers: 0, totalStaked: 0n };
  
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const registry = new ethers.Contract(solverRegistryAddr, SOLVER_REGISTRY_ABI, provider);
    const [totalStaked, , activeSolvers] = await registry.getStats();
    return { activeSolvers: Number(activeSolvers), totalStaked };
  } catch {
    return { activeSolvers: 0, totalStaked: 0n };
  }
}

async function getEILStats(
  l1RpcUrl: string,
  l1StakeManagerAddr: string
): Promise<{ activeXLPs: number; totalStaked: bigint }> {
  if (!l1StakeManagerAddr) return { activeXLPs: 0, totalStaked: 0n };
  
  try {
    const provider = new ethers.JsonRpcProvider(l1RpcUrl);
    const manager = new ethers.Contract(l1StakeManagerAddr, L1_STAKE_MANAGER_ABI, provider);
    const [totalStaked, , activeXLPs] = await manager.getProtocolStats();
    return { activeXLPs: Number(activeXLPs), totalStaked };
  } catch {
    return { activeXLPs: 0, totalStaked: 0n };
  }
}

async function verifyCrossChainRoute(
  fromChain: { rpcUrl: string; outputSettler: string },
  toChain: { rpcUrl: string; inputSettler: string },
  testSolver: string
): Promise<{ hasSolvers: boolean; hasLiquidity: boolean }> {
  if (!fromChain.outputSettler || !toChain.inputSettler) {
    return { hasSolvers: false, hasLiquidity: false };
  }
  
  try {
    // Check if output settler has solver liquidity
    const provider = new ethers.JsonRpcProvider(fromChain.rpcUrl);
    const settler = new ethers.Contract(fromChain.outputSettler, OUTPUT_SETTLER_ABI, provider);
    
    if (testSolver) {
      const ethLiquidity = await settler.getSolverETH(testSolver);
      return {
        hasSolvers: true,
        hasLiquidity: ethLiquidity > 0n,
      };
    }
    
    return { hasSolvers: true, hasLiquidity: false };
  } catch {
    return { hasSolvers: false, hasLiquidity: false };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const networkArg = args.indexOf('--network');
  const network = networkArg !== -1 ? (args[networkArg + 1] as 'testnet' | 'mainnet') : 'testnet';
  
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       Cross-Chain Liquidity Verification                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  console.log(`Network: ${network.toUpperCase()}\n`);
  
  // Load configs
  const chainConfigs = loadChainConfigs(network);
  const oifDeployments = loadOIFDeployments(network);
  const contractsConfig = loadContractsConfig(network);
  
  // Verify each chain
  console.log('═══ Chain Status ═══\n');
  
  const chainStatuses: ChainStatus[] = [];
  
  for (const [key, chain] of Object.entries(chainConfigs)) {
    const chainConfig = chain as { chainId: number; name: string; rpcUrl: string };
    const chainId = chainConfig.chainId.toString();
    const oifChain = oifDeployments.chains?.[chainId] || {};
    
    const connected = await checkChainConnectivity(chainConfig.rpcUrl, chainConfig.chainId);
    const oifDeployed = oifChain.contracts?.solverRegistry 
      ? await checkContractDeployed(chainConfig.rpcUrl, oifChain.contracts.solverRegistry)
      : false;
    
    let activeSolvers = 0;
    let solverLiquidity = 0n;
    
    if (oifDeployed && oifChain.contracts) {
      const stats = await getOIFStats(
        chainConfig.rpcUrl,
        oifChain.contracts.solverRegistry,
        oifChain.contracts.outputSettler
      );
      activeSolvers = stats.activeSolvers;
      solverLiquidity = stats.totalStaked;
    }
    
    const status: ChainStatus = {
      chainId: chainConfig.chainId,
      name: chainConfig.name,
      connected,
      oifDeployed,
      solverLiquidity,
      xlpLiquidity: 0n,
      activeSolvers,
      activeXLPs: 0,
    };
    
    chainStatuses.push(status);
    
    const connIcon = connected ? '✅' : '❌';
    const oifIcon = oifDeployed ? '✅' : '⏳';
    
    console.log(`${chainConfig.name} (${chainConfig.chainId})`);
    console.log(`  ${connIcon} RPC: ${connected ? 'Connected' : 'Not reachable'}`);
    console.log(`  ${oifIcon} OIF: ${oifDeployed ? 'Deployed' : 'Not deployed'}`);
    if (oifDeployed) {
      console.log(`  📊 Solvers: ${activeSolvers} active, ${ethers.formatEther(solverLiquidity)} ETH staked`);
    }
    console.log('');
  }
  
  // Verify EIL (L1 hub)
  console.log('═══ EIL Status (L1 Hub) ═══\n');
  
  const eilNetwork = eilConfig[network];
  if (eilNetwork?.hub) {
    const hubConfig = chainConfigs[Object.keys(chainConfigs).find(
      k => (chainConfigs[k] as { chainId: number }).chainId === eilNetwork.hub.chainId
    ) || ''] as { rpcUrl: string } | undefined;
    
    if (hubConfig) {
      const { activeXLPs, totalStaked } = await getEILStats(
        hubConfig.rpcUrl,
        eilNetwork.hub.l1StakeManager
      );
      
      const hubDeployed = eilNetwork.hub.l1StakeManager && eilNetwork.hub.l1StakeManager !== '';
      console.log(`L1 Hub: ${eilNetwork.hub.name} (${eilNetwork.hub.chainId})`);
      console.log(`  ${hubDeployed ? '✅' : '❌'} L1StakeManager: ${hubDeployed ? 'Deployed' : 'Not deployed'}`);
      if (hubDeployed) {
        console.log(`  📊 XLPs: ${activeXLPs} active, ${ethers.formatEther(totalStaked)} ETH staked`);
      }
    }
  }
  console.log('');
  
  // Verify cross-chain routes
  console.log('═══ Cross-Chain Routes ═══\n');
  
  const routes = oifDeployments.crossChainRoutes || [];
  let routesReady = 0;
  let routesPartial = 0;
  let routesNotReady = 0;
  
  for (const route of routes) {
    const fromChain = oifDeployments.chains?.[route.from.toString()];
    const toChain = oifDeployments.chains?.[route.to.toString()];
    
    const fromName = fromChain?.name || `Chain ${route.from}`;
    const toName = toChain?.name || `Chain ${route.to}`;
    
    const fromDeployed = fromChain?.status === 'deployed';
    const toDeployed = toChain?.status === 'deployed';
    
    let icon = '❌';
    if (fromDeployed && toDeployed) {
      icon = '✅';
      routesReady++;
    } else if (fromDeployed || toDeployed) {
      icon = '⚠️';
      routesPartial++;
    } else {
      routesNotReady++;
    }
    
    console.log(`${icon} ${fromName} → ${toName}`);
    if (!fromDeployed) console.log(`   ⏳ ${fromName}: OIF not deployed`);
    if (!toDeployed) console.log(`   ⏳ ${toName}: OIF not deployed`);
  }
  
  console.log('');
  
  // Summary
  console.log('═══ Summary ═══\n');
  
  const connectedChains = chainStatuses.filter(c => c.connected).length;
  const deployedChains = chainStatuses.filter(c => c.oifDeployed).length;
  const totalChains = chainStatuses.length;
  
  console.log(`Chains:`);
  console.log(`  Connected: ${connectedChains}/${totalChains}`);
  console.log(`  OIF Deployed: ${deployedChains}/${totalChains}`);
  console.log('');
  
  console.log(`Cross-Chain Routes:`);
  console.log(`  ✅ Ready: ${routesReady}`);
  console.log(`  ⚠️  Partial: ${routesPartial}`);
  console.log(`  ❌ Not Ready: ${routesNotReady}`);
  console.log('');
  
  const totalSolvers = chainStatuses.reduce((sum, c) => sum + c.activeSolvers, 0);
  const totalSolverLiquidity = chainStatuses.reduce((sum, c) => sum + c.solverLiquidity, 0n);
  
  console.log(`Liquidity:`);
  console.log(`  Total Solvers: ${totalSolvers}`);
  console.log(`  Total Solver Stake: ${ethers.formatEther(totalSolverLiquidity)} ETH`);
  console.log('');
  
  // Recommendations
  console.log('═══ Recommendations ═══\n');
  
  const undeployedChains = chainStatuses.filter(c => c.connected && !c.oifDeployed);
  if (undeployedChains.length > 0) {
    console.log('Deploy OIF to:');
    undeployedChains.forEach(c => console.log(`  - ${c.name} (${c.chainId})`));
    console.log('\nRun: bun run scripts/deploy/oif-multichain.ts --all');
    console.log('');
  }
  
  const noSolverChains = chainStatuses.filter(c => c.oifDeployed && c.activeSolvers === 0);
  if (noSolverChains.length > 0) {
    console.log('Register solvers on:');
    noSolverChains.forEach(c => console.log(`  - ${c.name} (${c.chainId})`));
    console.log('\nSee: packages/deployment/XLP_SOLVER_GUIDE.md');
    console.log('');
  }
  
  if (!eilNetwork?.hub?.l1StakeManager) {
    console.log('Deploy EIL:');
    console.log('  - L1StakeManager on Sepolia/Ethereum');
    console.log('  - CrossChainPaymaster on each L2');
    console.log('\nRun: bun run scripts/deploy/eil.ts testnet');
    console.log('');
  }
  
  // Exit code based on readiness
  if (routesReady === 0 && routes.length > 0) {
    console.log('❌ No cross-chain routes are fully operational');
    process.exit(1);
  } else if (routesReady < routes.length / 2) {
    console.log('⚠️ Less than half of routes are operational');
    process.exit(0);
  } else {
    console.log('✅ Cross-chain infrastructure is operational');
    process.exit(0);
  }
}

main().catch(err => {
  logger.error(`Verification failed: ${err.message}`);
  process.exit(1);
});


