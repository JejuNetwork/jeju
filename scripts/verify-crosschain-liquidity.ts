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
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const logger = new Logger({ prefix: 'verify-crosschain' });

interface ChainStatus {
  chainId: number;
  name: string;
  connected: boolean;
  oifDeployed: boolean;
  solverLiquidity: bigint;
  activeSolvers: number;
}

interface ChainInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
}

const SOLVER_REGISTRY_ABI = [
  'function getStats() view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeSolvers)',
  'function isSolverActive(address solver) view returns (bool)',
];

const L1_STAKE_MANAGER_ABI = [
  'function getProtocolStats() view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeXLPs)',
];

// Public RPC URLs for verification
const PUBLIC_RPCS: Record<number, string> = {
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  84532: 'https://sepolia.base.org',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
  11155420: 'https://sepolia.optimism.io',
  97: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
  420690: 'https://testnet-rpc.jeju.network',
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  56: 'https://bsc-dataseed.bnbchain.org',
  420691: 'https://rpc.jeju.network',
};

// Load chain configs from chains.json
function loadChainConfigs(network: 'testnet' | 'mainnet'): ChainInfo[] {
  const chainsPath = resolve(process.cwd(), 'packages/config/chains.json');
  if (!existsSync(chainsPath)) return [];
  
  const chains = JSON.parse(readFileSync(chainsPath, 'utf-8'));
  const networkKey = network === 'testnet' ? 'testnets' : 'mainnets';
  const networkChains = chains[networkKey] || {};
  
  const result: ChainInfo[] = [];
  for (const chain of Object.values(networkChains)) {
    const c = chain as { chainId: number; name: string };
    result.push({
      chainId: c.chainId,
      name: c.name,
      rpcUrl: PUBLIC_RPCS[c.chainId] || '',
    });
  }
  return result;
}

function loadOIFDeployments(network: 'testnet' | 'mainnet') {
  const deploymentsPath = resolve(process.cwd(), `packages/contracts/deployments/oif-${network}.json`);
  if (!existsSync(deploymentsPath)) return { chains: {}, crossChainRoutes: [] };
  return JSON.parse(readFileSync(deploymentsPath, 'utf-8'));
}

function loadEILConfig(network: 'testnet' | 'mainnet') {
  const eilPath = resolve(process.cwd(), 'packages/config/eil.json');
  if (!existsSync(eilPath)) return null;
  const eil = JSON.parse(readFileSync(eilPath, 'utf-8'));
  return eil[network] || null;
}

async function checkChainConnectivity(rpcUrl: string, expectedChainId: number): Promise<boolean> {
  if (!rpcUrl) return false;
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const network = await provider.getNetwork();
  return Number(network.chainId) === expectedChainId;
}

async function checkContractDeployed(rpcUrl: string, address: string): Promise<boolean> {
  if (!address || address === '') return false;
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const code = await provider.getCode(address);
  return code !== '0x' && code.length > 2;
}

async function getOIFStats(
  rpcUrl: string,
  solverRegistryAddr: string
): Promise<{ activeSolvers: number; totalStaked: bigint }> {
  if (!solverRegistryAddr) return { activeSolvers: 0, totalStaked: 0n };
  
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const registry = new ethers.Contract(solverRegistryAddr, SOLVER_REGISTRY_ABI, provider);
  const [totalStaked, , activeSolvers] = await registry.getStats();
  return { activeSolvers: Number(activeSolvers), totalStaked };
}

async function getEILStats(
  l1RpcUrl: string,
  l1StakeManagerAddr: string
): Promise<{ activeXLPs: number; totalStaked: bigint }> {
  if (!l1StakeManagerAddr) return { activeXLPs: 0, totalStaked: 0n };
  
  const provider = new ethers.JsonRpcProvider(l1RpcUrl, undefined, { staticNetwork: true });
  const manager = new ethers.Contract(l1StakeManagerAddr, L1_STAKE_MANAGER_ABI, provider);
  const [totalStaked, , activeXLPs] = await manager.getProtocolStats();
  return { activeXLPs: Number(activeXLPs), totalStaked };
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
  const eilConfig = loadEILConfig(network);
  
  if (chainConfigs.length === 0) {
    logger.error('No chains configured in packages/config/chains.json');
    process.exit(1);
  }
  
  // Verify each chain
  console.log('═══ Chain Status ═══\n');
  
  const chainStatuses: ChainStatus[] = [];
  
  for (const chain of chainConfigs) {
    const oifChain = oifDeployments.chains?.[chain.chainId.toString()] || {};
    
    let connected = false;
    try {
      connected = await checkChainConnectivity(chain.rpcUrl, chain.chainId);
    } catch {
      connected = false;
    }
    
    let oifDeployed = false;
    if (connected && oifChain.contracts?.solverRegistry) {
      try {
        oifDeployed = await checkContractDeployed(chain.rpcUrl, oifChain.contracts.solverRegistry);
      } catch {
        oifDeployed = false;
      }
    }
    
    let activeSolvers = 0;
    let solverLiquidity = 0n;
    
    if (oifDeployed && oifChain.contracts) {
      try {
        const stats = await getOIFStats(chain.rpcUrl, oifChain.contracts.solverRegistry);
        activeSolvers = stats.activeSolvers;
        solverLiquidity = stats.totalStaked;
      } catch {
        // Stats unavailable
      }
    }
    
    const status: ChainStatus = {
      chainId: chain.chainId,
      name: chain.name,
      connected,
      oifDeployed,
      solverLiquidity,
      activeSolvers,
    };
    
    chainStatuses.push(status);
    
    const connIcon = connected ? '✅' : '❌';
    const oifIcon = oifDeployed ? '✅' : oifChain.status === 'pending' ? '⏳' : '❌';
    
    console.log(`${chain.name} (${chain.chainId})`);
    console.log(`  ${connIcon} RPC: ${connected ? 'Connected' : 'Not reachable'}`);
    console.log(`  ${oifIcon} OIF: ${oifDeployed ? 'Deployed' : oifChain.status || 'Not deployed'}`);
    if (oifDeployed) {
      console.log(`  📊 Solvers: ${activeSolvers} active, ${ethers.formatEther(solverLiquidity)} ETH staked`);
    }
    console.log('');
  }
  
  // Verify EIL (L1 hub)
  console.log('═══ EIL Status (L1 Hub) ═══\n');
  
  if (eilConfig?.hub) {
    const hubRpc = PUBLIC_RPCS[eilConfig.hub.chainId] || '';
    let hubDeployed = false;
    let activeXLPs = 0;
    let totalStaked = 0n;
    
    if (hubRpc && eilConfig.hub.l1StakeManager) {
      try {
        hubDeployed = await checkContractDeployed(hubRpc, eilConfig.hub.l1StakeManager);
        if (hubDeployed) {
          const stats = await getEILStats(hubRpc, eilConfig.hub.l1StakeManager);
          activeXLPs = stats.activeXLPs;
          totalStaked = stats.totalStaked;
        }
      } catch {
        // Stats unavailable
      }
    }
    
    console.log(`L1 Hub: ${eilConfig.hub.name} (${eilConfig.hub.chainId})`);
    console.log(`  ${hubDeployed ? '✅' : '❌'} L1StakeManager: ${hubDeployed ? eilConfig.hub.l1StakeManager : 'Not deployed'}`);
    if (hubDeployed) {
      console.log(`  📊 XLPs: ${activeXLPs} active, ${ethers.formatEther(totalStaked)} ETH staked`);
    }
  } else {
    console.log('  ❌ EIL not configured');
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
    console.log('\nRun: bun run scripts/register-solver.ts --chain <chainId>');
    console.log('');
  }
  
  if (!eilConfig?.hub?.l1StakeManager) {
    console.log('Deploy EIL:');
    console.log('  - L1StakeManager on L1');
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
