#!/usr/bin/env bun
/**
 * Token Accumulator
 * 
 * Runs in background during dev to automatically:
 * - Check balances periodically
 * - Bridge from Sepolia to L2s when funds available
 * - Track faucet cooldowns
 * - Log funding status
 * 
 * Usage:
 *   bun run scripts/token-accumulator.ts          # Run once
 *   bun run scripts/token-accumulator.ts --watch  # Run continuously
 */

import { Wallet, JsonRpcProvider, parseEther, formatEther, Contract } from 'ethers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const KEYS_DIR = join(ROOT, 'packages/deployment/.keys');
const STATE_FILE = join(KEYS_DIR, 'accumulator-state.json');

// Minimum balances we want on each network (0.01 ETH sufficient for most deployments)
const TARGET_BALANCES = {
  sepolia: parseEther('0.01'),
  arbitrumSepolia: parseEther('0.01'),
  optimismSepolia: parseEther('0.01'),
  baseSepolia: parseEther('0.01'),
  bscTestnet: parseEther('0.001'), // BSC requires mainnet BNB for faucet
} as const;

// Bridge amount when triggering auto-bridge
const BRIDGE_AMOUNT = '0.03';

// Check interval in watch mode (5 minutes)
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Faucet cooldowns in milliseconds (24 hours for most)
const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  symbol: string;
  bridge?: {
    contract: string;
    type: 'arbitrum' | 'op-stack';
  };
}

const NETWORKS: Record<string, NetworkConfig> = {
  sepolia: {
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    symbol: 'ETH',
  },
  arbitrumSepolia: {
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    symbol: 'ETH',
    bridge: {
      contract: '0xaAe29B0366299461418F5324a79Afc425BE5ae21',
      type: 'arbitrum',
    },
  },
  optimismSepolia: {
    name: 'Optimism Sepolia',
    chainId: 11155420,
    rpcUrl: 'https://sepolia.optimism.io',
    symbol: 'ETH',
    bridge: {
      contract: '0x16Fc5058F25648194471939df75CF27A2fdC48BC',
      type: 'op-stack',
    },
  },
  baseSepolia: {
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    symbol: 'ETH',
    bridge: {
      // Base Sepolia Portal on Ethereum Sepolia
      contract: '0x49f53e41452C74589E85cA1677426Ba426459e85',
      type: 'op-stack',
    },
  },
  bscTestnet: {
    name: 'BSC Testnet',
    chainId: 97,
    rpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    symbol: 'BNB',
  },
};

interface AccumulatorState {
  lastCheck: string;
  lastBridge: Record<string, string>;
  lastFaucetAttempt: Record<string, string>;
  balanceHistory: Array<{
    timestamp: string;
    balances: Record<string, string>;
  }>;
}

interface DeployerConfig {
  address: string;
  privateKey: string;
}

function loadState(): AccumulatorState {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  }
  return {
    lastCheck: '',
    lastBridge: {},
    lastFaucetAttempt: {},
    balanceHistory: [],
  };
}

function saveState(state: AccumulatorState): void {
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadDeployerKey(): DeployerConfig {
  const keyFile = join(KEYS_DIR, 'testnet-deployer.json');
  if (!existsSync(keyFile)) {
    throw new Error('No deployer key found. Run: bun run testnet:deployer');
  }
  return JSON.parse(readFileSync(keyFile, 'utf-8'));
}

async function getBalance(network: string, address: string): Promise<bigint> {
  const config = NETWORKS[network];
  const provider = new JsonRpcProvider(config.rpcUrl);
  return provider.getBalance(address);
}

async function getAllBalances(address: string): Promise<Record<string, bigint>> {
  const balances: Record<string, bigint> = {};
  
  for (const network of Object.keys(NETWORKS)) {
    balances[network] = await getBalance(network, address);
  }
  
  return balances;
}

const PORTAL_ABI = [
  'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data) payable',
];

const INBOX_ABI = [
  'function depositEth() payable returns (uint256)',
];

async function bridgeToL2(
  wallet: Wallet,
  targetNetwork: string,
  amount: string
): Promise<string | null> {
  const config = NETWORKS[targetNetwork];
  if (!config.bridge) return null;
  
  const amountWei = parseEther(amount);
  
  console.log(`  🌉 Bridging ${amount} ETH to ${config.name}...`);
  
  if (config.bridge.type === 'op-stack') {
    const portal = new Contract(config.bridge.contract, PORTAL_ABI, wallet);
    const tx = await portal.depositTransaction(
      wallet.address,
      amountWei,
      100000n,
      false,
      '0x',
      { value: amountWei, gasLimit: 250000n }
    );
    await tx.wait();
    console.log(`  ✅ Bridge tx: ${tx.hash}`);
    return tx.hash;
  } else if (config.bridge.type === 'arbitrum') {
    const inbox = new Contract(config.bridge.contract, INBOX_ABI, wallet);
    const tx = await inbox.depositEth({ value: amountWei, gasLimit: 250000n });
    await tx.wait();
    console.log(`  ✅ Bridge tx: ${tx.hash}`);
    return tx.hash;
  }
  
  return null;
}

function canBridge(state: AccumulatorState, network: string): boolean {
  const lastBridge = state.lastBridge[network];
  if (!lastBridge) return true;
  
  // Wait at least 30 minutes between bridge attempts to same network
  const cooldown = 30 * 60 * 1000;
  return Date.now() - new Date(lastBridge).getTime() > cooldown;
}

function formatBalance(balance: bigint, symbol: string): string {
  return `${parseFloat(formatEther(balance)).toFixed(4)} ${symbol}`;
}

async function runAccumulator(watchMode: boolean): Promise<void> {
  const deployer = loadDeployerKey();
  const state = loadState();
  
  const timestamp = new Date().toISOString();
  const shortTime = new Date().toLocaleTimeString();
  
  console.log(`\n[${shortTime}] 💰 Token Accumulator Check`);
  console.log(`  Address: ${deployer.address}`);
  
  // Get all balances
  const balances = await getAllBalances(deployer.address);
  
  // Log current balances
  console.log('\n  Current Balances:');
  for (const [network, balance] of Object.entries(balances)) {
    const config = NETWORKS[network];
    const target = TARGET_BALANCES[network as keyof typeof TARGET_BALANCES];
    const status = balance >= target ? '✅' : '⚠️';
    console.log(`    ${status} ${config.name.padEnd(18)} ${formatBalance(balance, config.symbol)}`);
  }
  
  // Store balance history (keep last 100 entries)
  state.balanceHistory.push({
    timestamp,
    balances: Object.fromEntries(
      Object.entries(balances).map(([k, v]) => [k, v.toString()])
    ),
  });
  if (state.balanceHistory.length > 100) {
    state.balanceHistory = state.balanceHistory.slice(-100);
  }
  
  // Check if we should bridge
  const sepoliaBalance = balances.sepolia;
  const minSepoliaForBridge = parseEther('0.08'); // Keep some buffer
  
  if (sepoliaBalance > minSepoliaForBridge) {
    const sepoliaProvider = new JsonRpcProvider(NETWORKS.sepolia.rpcUrl);
    const wallet = new Wallet(deployer.privateKey, sepoliaProvider);
    
    // Check which L2s need funds
    for (const network of ['arbitrumSepolia', 'optimismSepolia', 'baseSepolia'] as const) {
      const target = TARGET_BALANCES[network];
      const current = balances[network];
      
      if (current < target && canBridge(state, network)) {
        console.log(`\n  ${NETWORKS[network].name} below target, bridging...`);
        const txHash = await bridgeToL2(wallet, network, BRIDGE_AMOUNT);
        if (txHash) {
          state.lastBridge[network] = timestamp;
        }
      }
    }
  } else if (sepoliaBalance < parseEther('0.03')) {
    console.log('\n  ⚠️  Sepolia balance low. Manual faucet funding needed:');
    console.log('     • https://cloud.google.com/application/web3/faucet/ethereum/sepolia');
    console.log('     • https://www.alchemy.com/faucets/ethereum-sepolia');
  }
  
  // Update state
  state.lastCheck = timestamp;
  saveState(state);
  
  // Summary
  const funded = Object.entries(balances).filter(
    ([k, v]) => v >= TARGET_BALANCES[k as keyof typeof TARGET_BALANCES]
  );
  const unfunded = Object.entries(balances).filter(
    ([k, v]) => v < TARGET_BALANCES[k as keyof typeof TARGET_BALANCES]
  );
  
  console.log(`\n  Summary: ${funded.length}/5 networks at target balance`);
  
  if (unfunded.length > 0 && !watchMode) {
    console.log('\n  Networks needing funding:');
    for (const [network] of unfunded) {
      const config = NETWORKS[network];
      if (network === 'bscTestnet') {
        console.log(`    • ${config.name}: Request in Discord #dev-faucet`);
      } else if (network === 'sepolia') {
        console.log(`    • ${config.name}: Use faucets above`);
      } else {
        console.log(`    • ${config.name}: Will auto-bridge when Sepolia funded`);
      }
    }
  }
  
  if (watchMode) {
    console.log(`\n  Next check in ${CHECK_INTERVAL_MS / 60000} minutes...`);
  }
}

async function main(): Promise<void> {
  const watchMode = process.argv.includes('--watch');
  
  if (watchMode) {
    console.log('🔄 Token Accumulator running in watch mode');
    console.log('   Press Ctrl+C to stop\n');
    
    // Run immediately
    await runAccumulator(true);
    
    // Then run on interval
    setInterval(async () => {
      await runAccumulator(true);
    }, CHECK_INTERVAL_MS);
  } else {
    await runAccumulator(false);
  }
}

main();
