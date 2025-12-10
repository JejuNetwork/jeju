#!/usr/bin/env bun
/**
 * Fund Testnet Deployer
 * 
 * Automated funding helper that:
 * 1. Checks current balances
 * 2. Bridges ETH from Sepolia to L2 testnets
 * 3. Provides faucet links and cast commands
 * 
 * Usage:
 *   bun run scripts/fund-testnet-deployer.ts [--bridge]
 */

import { Wallet, JsonRpcProvider, parseEther, formatEther, Contract } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

const ROOT = join(import.meta.dir, '..');
const KEYS_DIR = join(ROOT, 'packages/deployment/.keys');

// Testnet configurations with bridge contracts
const TESTNETS = {
  sepolia: {
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    symbol: 'ETH',
    explorer: 'https://sepolia.etherscan.io',
  },
  arbitrumSepolia: {
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    symbol: 'ETH',
    explorer: 'https://sepolia.arbiscan.io',
    bridge: {
      // Arbitrum Inbox for Sepolia
      contract: '0xaAe29B0366299461418F5324a79Afc425BE5ae21',
      type: 'arbitrum',
    },
  },
  optimismSepolia: {
    name: 'Optimism Sepolia',
    chainId: 11155420,
    rpcUrl: 'https://sepolia.optimism.io',
    symbol: 'ETH',
    explorer: 'https://sepolia-optimism.etherscan.io',
    bridge: {
      // OP Sepolia Portal
      contract: '0x16Fc5058F25648194471939df75CF27A2fdC48BC',
      type: 'op-stack',
    },
  },
  baseSepolia: {
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    symbol: 'ETH',
    explorer: 'https://sepolia.basescan.org',
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
    explorer: 'https://testnet.bscscan.com',
  },
} as const;

type TestnetKey = keyof typeof TESTNETS;

interface DeployerConfig {
  address: string;
  privateKey: string;
}

interface BalanceInfo {
  network: TestnetKey;
  name: string;
  balance: bigint;
  formatted: string;
  hasFunds: boolean;
}

function loadDeployerKey(): DeployerConfig {
  const keyFile = join(KEYS_DIR, 'testnet-deployer.json');
  if (!existsSync(keyFile)) {
    throw new Error('No deployer key found. Run: bun run scripts/setup-testnet-deployer.ts');
  }
  return JSON.parse(readFileSync(keyFile, 'utf-8'));
}

async function checkBalance(network: TestnetKey, address: string): Promise<BalanceInfo> {
  const config = TESTNETS[network];
  const provider = new JsonRpcProvider(config.rpcUrl);
  const balance = await provider.getBalance(address);
  
  return {
    network,
    name: config.name,
    balance,
    formatted: `${parseFloat(formatEther(balance)).toFixed(6)} ${config.symbol}`,
    hasFunds: balance > parseEther('0.005'),
  };
}

async function checkAllBalances(address: string): Promise<BalanceInfo[]> {
  console.log('\n📊 Checking balances across all testnets...\n');
  
  const results: BalanceInfo[] = [];
  
  for (const [key, config] of Object.entries(TESTNETS)) {
    process.stdout.write(`   ${config.name.padEnd(20)}`);
    const info = await checkBalance(key as TestnetKey, address);
    results.push(info);
    const status = info.hasFunds ? '✅' : '⚠️ ';
    console.log(`${status} ${info.formatted}`);
  }
  
  return results;
}

// OP Stack L1 Standard Bridge Portal ABI
const OPTIMISM_PORTAL_ABI = [
  'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data) payable',
];

// Arbitrum Inbox ABI
const ARBITRUM_INBOX_ABI = [
  'function depositEth() payable returns (uint256)',
];

async function bridgeToOptimismStack(
  wallet: Wallet,
  targetNetwork: 'optimismSepolia' | 'baseSepolia',
  amountEth: string
): Promise<string> {
  const config = TESTNETS[targetNetwork];
  const bridge = config.bridge;
  
  const portal = new Contract(bridge.contract, OPTIMISM_PORTAL_ABI, wallet);
  const amount = parseEther(amountEth);
  
  console.log(`   Depositing ${amountEth} ETH to ${config.name}...`);
  
  const tx = await portal.depositTransaction(
    wallet.address, // _to: recipient on L2
    amount,         // _value: amount to deposit
    100000n,        // _gasLimit: L2 gas
    false,          // _isCreation: not creating contract
    '0x',           // _data: empty
    { value: amount, gasLimit: 200000n }
  );
  
  console.log(`   Tx: ${TESTNETS.sepolia.explorer}/tx/${tx.hash}`);
  await tx.wait();
  
  return tx.hash;
}

async function bridgeToArbitrum(
  wallet: Wallet,
  amountEth: string
): Promise<string> {
  const config = TESTNETS.arbitrumSepolia;
  const bridge = config.bridge;
  
  const amount = parseEther(amountEth);
  
  console.log(`   Depositing ${amountEth} ETH to ${config.name}...`);
  
  // Arbitrum uses depositEth function on the inbox
  const inbox = new Contract(bridge.contract, ARBITRUM_INBOX_ABI, wallet);
  const tx = await inbox.depositEth({ value: amount, gasLimit: 200000n });
  
  console.log(`   Tx: ${TESTNETS.sepolia.explorer}/tx/${tx.hash}`);
  await tx.wait();
  
  return tx.hash;
}

async function bridgeToL2s(privateKey: string, amountPerChain: string) {
  const sepoliaProvider = new JsonRpcProvider(TESTNETS.sepolia.rpcUrl);
  const wallet = new Wallet(privateKey, sepoliaProvider);
  
  const sepoliaBalance = await sepoliaProvider.getBalance(wallet.address);
  const requiredAmount = parseEther(amountPerChain) * 3n + parseEther('0.05'); // 3 chains + gas
  
  if (sepoliaBalance < requiredAmount) {
    console.log(`\n❌ Insufficient Sepolia balance for bridging`);
    console.log(`   Need: ${formatEther(requiredAmount)} ETH`);
    console.log(`   Have: ${formatEther(sepoliaBalance)} ETH`);
    return;
  }
  
  console.log('\n🌉 Bridging ETH to L2 testnets...\n');
  
  // Check which L2s need funds
  const balances = await Promise.all([
    checkBalance('arbitrumSepolia', wallet.address),
    checkBalance('optimismSepolia', wallet.address),
    checkBalance('baseSepolia', wallet.address),
  ]);
  
  for (const bal of balances) {
    if (bal.hasFunds) {
      console.log(`   ✅ ${bal.name} already funded (${bal.formatted})`);
      continue;
    }
    
    console.log(`\n   🔄 ${bal.name}`);
    
    if (bal.network === 'arbitrumSepolia') {
      await bridgeToArbitrum(wallet, amountPerChain);
    } else if (bal.network === 'optimismSepolia' || bal.network === 'baseSepolia') {
      await bridgeToOptimismStack(wallet, bal.network, amountPerChain);
    }
    
    console.log(`   ✅ Bridge initiated. Funds arrive in ~10-15 minutes.`);
  }
}

function printCastCommands(address: string, privateKey: string) {
  console.log(`
═══════════════════════════════════════════════════════════════════════════════
 MANUAL FUNDING - Cast Commands
═══════════════════════════════════════════════════════════════════════════════

If automated bridging isn't working, use these cast commands:

1. BRIDGE TO OPTIMISM SEPOLIA:
   cast send --rpc-url ${TESTNETS.sepolia.rpcUrl} \\
     --private-key $DEPLOYER_PRIVATE_KEY \\
     ${TESTNETS.optimismSepolia.bridge?.contract} \\
     "depositTransaction(address,uint256,uint64,bool,bytes)" \\
     ${address} 0.02ether 100000 false 0x \\
     --value 0.02ether

2. BRIDGE TO BASE SEPOLIA:
   cast send --rpc-url ${TESTNETS.sepolia.rpcUrl} \\
     --private-key $DEPLOYER_PRIVATE_KEY \\
     ${TESTNETS.baseSepolia.bridge?.contract} \\
     "depositTransaction(address,uint256,uint64,bool,bytes)" \\
     ${address} 0.02ether 100000 false 0x \\
     --value 0.02ether

3. BRIDGE TO ARBITRUM SEPOLIA:
   cast send --rpc-url ${TESTNETS.sepolia.rpcUrl} \\
     --private-key $DEPLOYER_PRIVATE_KEY \\
     ${TESTNETS.arbitrumSepolia.bridge?.contract} \\
     --value 0.02ether

Set your private key first:
   export DEPLOYER_PRIVATE_KEY=${privateKey}

═══════════════════════════════════════════════════════════════════════════════
`);
}

function printFaucetLinks(address: string) {
  console.log(`
═══════════════════════════════════════════════════════════════════════════════
 FAUCET LINKS - Get Initial Testnet ETH
═══════════════════════════════════════════════════════════════════════════════

Your address: ${address}

ETHEREUM SEPOLIA (Primary - fund this first):
  • Google Cloud: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
  • Alchemy: https://www.alchemy.com/faucets/ethereum-sepolia
  • Sepolia Faucet: https://sepoliafaucet.com
  • QuickNode: https://faucet.quicknode.com/ethereum/sepolia
  • Bware Labs: https://bwarelabs.com/faucets/ethereum-sepolia

ARBITRUM SEPOLIA:
  • Alchemy: https://www.alchemy.com/faucets/arbitrum-sepolia
  • Bware Labs: https://bwarelabs.com/faucets/arbitrum-sepolia

OPTIMISM SEPOLIA:
  • Alchemy: https://www.alchemy.com/faucets/optimism-sepolia
  • Bware Labs: https://bwarelabs.com/faucets/optimism-sepolia

BASE SEPOLIA:
  • Alchemy: https://www.alchemy.com/faucets/base-sepolia
  • Bware Labs: https://bwarelabs.com/faucets/base-sepolia
  • Superchain Faucet: https://app.optimism.io/faucet
  • Coinbase: https://portal.cdp.coinbase.com/products/faucet

BSC TESTNET (requires 0.002 BNB on mainnet OR use these):
  • Official: https://www.bnbchain.org/en/testnet-faucet
  • QuickNode: https://faucet.quicknode.com/binance-smart-chain/bnb-testnet
  • Discord: https://discord.gg/bnbchain (request in #dev-faucet channel)

═══════════════════════════════════════════════════════════════════════════════
`);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Jeju Network - Testnet Deployer Funding                                     ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  const deployer = loadDeployerKey();
  console.log(`📍 Deployer Address: ${deployer.address}`);
  
  const balances = await checkAllBalances(deployer.address);
  
  const funded = balances.filter(b => b.hasFunds);
  const unfunded = balances.filter(b => !b.hasFunds);
  
  console.log('\n───────────────────────────────────────────────────────────────────────────────');
  if (funded.length === balances.length) {
    console.log('✅ All testnets funded');
  } else {
    console.log(`✅ Funded: ${funded.map(b => b.name).join(', ') || 'None'}`);
    console.log(`⚠️  Needs funding: ${unfunded.map(b => b.name).join(', ')}`);
  }
  console.log('───────────────────────────────────────────────────────────────────────────────');
  
  const sepoliaBalance = balances.find(b => b.network === 'sepolia');
  
  if (process.argv.includes('--bridge')) {
    if (sepoliaBalance && sepoliaBalance.balance > parseEther('0.1')) {
      await bridgeToL2s(deployer.privateKey, '0.02');
      
      console.log('\n⏳ Waiting 30 seconds for bridges to process...');
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      await checkAllBalances(deployer.address);
    } else {
      console.log('\n❌ Insufficient Sepolia balance for bridging (need > 0.1 ETH)');
      printFaucetLinks(deployer.address);
    }
  } else if (sepoliaBalance && sepoliaBalance.hasFunds && unfunded.some(b => b.network !== 'sepolia' && b.network !== 'bscTestnet')) {
    console.log('\n💡 Sepolia has funds. Run with --bridge to fund L2s:');
    console.log('   bun run scripts/fund-testnet-deployer.ts --bridge');
  } else if (!sepoliaBalance?.hasFunds) {
    printFaucetLinks(deployer.address);
  }
  
  printCastCommands(deployer.address, deployer.privateKey);
}

main();
