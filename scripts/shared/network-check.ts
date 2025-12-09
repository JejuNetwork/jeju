/**
 * @fileoverview Network availability checks with graceful warnings
 * @module scripts/shared/network-check
 * 
 * Provides utilities for checking network availability and skipping
 * unavailable networks with helpful warnings instead of hard failures.
 */

import type { NetworkType } from '@jejunetwork/types/chain';

interface NetworkCheckResult {
  available: boolean;
  rpcReachable: boolean;
  hasBalance: boolean;
  chainId: number | null;
  blockNumber: number | null;
  warnings: string[];
}

const NETWORK_CONFIGS: Record<NetworkType, { rpcUrl: string; chainId: number; name: string }> = {
  localnet: {
    rpcUrl: process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    chainId: 1337,
    name: 'Jeju Localnet',
  },
  testnet: {
    rpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network',
    chainId: 420690,
    name: 'Jeju Testnet',
  },
  mainnet: {
    rpcUrl: process.env.JEJU_MAINNET_RPC_URL || 'https://rpc.jeju.network',
    chainId: 420691,
    name: 'Jeju Mainnet',
  },
};

/**
 * Check if an RPC endpoint is reachable and return chain info
 */
async function checkRpc(rpcUrl: string): Promise<{ reachable: boolean; chainId: number | null; blockNumber: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const makeCall = async (method: string, params: unknown[] = []): Promise<unknown> => {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { result?: unknown; error?: { message: string } };
    if (data.error) throw new Error(data.error.message);
    return data.result;
  };

  try {
    const [chainIdHex, blockNumberHex] = await Promise.all([
      makeCall('eth_chainId'),
      makeCall('eth_blockNumber'),
    ]);
    
    clearTimeout(timeout);
    
    return {
      reachable: true,
      chainId: parseInt(chainIdHex as string, 16),
      blockNumber: parseInt(blockNumberHex as string, 16),
    };
  } catch {
    clearTimeout(timeout);
    return { reachable: false, chainId: null, blockNumber: null };
  }
}

/**
 * Check if an address has ETH balance
 */
async function checkBalance(rpcUrl: string, address: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
    });
    
    if (!response.ok) return false;
    
    const data = await response.json() as { result?: string };
    if (!data.result) return false;
    
    return BigInt(data.result) > BigInt(0);
  } catch {
    return false;
  }
}

/**
 * Check if a network is available for operations
 */
export async function checkNetwork(network: NetworkType): Promise<NetworkCheckResult> {
  const config = NETWORK_CONFIGS[network];
  const warnings: string[] = [];
  
  // Check RPC
  const rpcCheck = await checkRpc(config.rpcUrl);
  
  if (!rpcCheck.reachable) {
    warnings.push(`${config.name} RPC not reachable at ${config.rpcUrl}`);
    
    if (network === 'localnet') {
      warnings.push('Start localnet with: bun run localnet:start');
    } else {
      warnings.push(`Check if ${config.name} is online or set JEJU_${network.toUpperCase()}_RPC_URL`);
    }
    
    return {
      available: false,
      rpcReachable: false,
      hasBalance: false,
      chainId: null,
      blockNumber: null,
      warnings,
    };
  }
  
  // Verify chain ID
  if (rpcCheck.chainId !== config.chainId) {
    warnings.push(`Chain ID mismatch: expected ${config.chainId}, got ${rpcCheck.chainId}`);
  }
  
  // Check balance (only if deployer address is set)
  const deployerAddress = process.env.DEPLOYER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const hasBalance = await checkBalance(config.rpcUrl, deployerAddress);
  
  if (!hasBalance) {
    warnings.push(`Deployer ${deployerAddress.slice(0, 10)}... has no balance on ${config.name}`);
    
    if (network === 'testnet') {
      warnings.push('Get testnet ETH from: https://www.alchemy.com/faucets/base-sepolia');
    } else if (network === 'mainnet') {
      warnings.push('Fund deployer wallet with ETH before deployment');
    }
  }
  
  return {
    available: rpcCheck.reachable && hasBalance,
    rpcReachable: rpcCheck.reachable,
    hasBalance,
    chainId: rpcCheck.chainId,
    blockNumber: rpcCheck.blockNumber,
    warnings,
  };
}

/**
 * Check network and skip with warning if not available
 * Returns true if network is available, false if should skip
 */
export async function checkNetworkOrSkip(network: NetworkType, operation: string): Promise<boolean> {
  const result = await checkNetwork(network);
  
  if (!result.available) {
    console.log(`\n⚠️  Skipping ${operation} on ${network}:`);
    result.warnings.forEach(w => console.log(`   - ${w}`));
    console.log('');
    return false;
  }
  
  console.log(`✅ ${network}: RPC reachable (block ${result.blockNumber}), balance OK`);
  return true;
}

/**
 * Require network to be available, throw if not
 */
export async function requireNetwork(network: NetworkType, operation: string): Promise<void> {
  const result = await checkNetwork(network);
  
  if (!result.available) {
    const issues = result.warnings.join('\n   - ');
    throw new Error(`Cannot ${operation} on ${network}:\n   - ${issues}`);
  }
}

/**
 * Print network status summary
 */
export async function printNetworkStatus(): Promise<void> {
  console.log('\n📡 Network Status\n');
  
  const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet'];
  
  for (const network of networks) {
    const result = await checkNetwork(network);
    const config = NETWORK_CONFIGS[network];
    
    const statusIcon = result.available ? '✅' : result.rpcReachable ? '⚠️' : '❌';
    const statusText = result.available 
      ? `ready (block ${result.blockNumber})` 
      : result.rpcReachable 
        ? 'no balance' 
        : 'unreachable';
    
    console.log(`${statusIcon} ${config.name.padEnd(15)} ${statusText}`);
    
    if (!result.available && result.warnings.length > 0) {
      console.log(`   ${result.warnings[0]}`);
    }
  }
  
  console.log('');
}

