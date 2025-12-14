#!/usr/bin/env bun
/**
 * Setup Testnet Deployer
 * 
 * Generates a deployer key and funds it on all testnets:
 * - Ethereum Sepolia (L1)
 * - Arbitrum Sepolia
 * - Optimism Sepolia
 * - Base Sepolia
 * - BSC Testnet
 * 
 * Usage:
 *   bun run scripts/setup-testnet-deployer.ts
 */

import { Wallet, JsonRpcProvider, parseEther, formatEther } from 'ethers';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const KEYS_DIR = join(ROOT, 'packages/deployment/.keys');

// Testnet configurations
const TESTNETS = {
  sepolia: {
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    faucets: [
      'https://www.alchemy.com/faucets/ethereum-sepolia',
      'https://cloud.google.com/application/web3/faucet/ethereum/sepolia',
      'https://sepoliafaucet.com',
    ],
  },
  arbitrumSepolia: {
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    explorer: 'https://sepolia.arbiscan.io',
    faucets: [
      'https://www.alchemy.com/faucets/arbitrum-sepolia',
    ],
    bridge: {
      from: 'sepolia',
      contract: '0x0000000000000000000000000000000000000064',
      method: 'value-transfer',
    },
  },
  optimismSepolia: {
    name: 'Optimism Sepolia',
    chainId: 11155420,
    rpcUrl: 'https://sepolia.optimism.io',
    explorer: 'https://sepolia-optimism.etherscan.io',
    faucets: [
      'https://www.alchemy.com/faucets/optimism-sepolia',
    ],
    bridge: {
      from: 'sepolia',
      contract: '0x16Fc5058F25648194471939df75CF27A2fdC48BC',
      method: 'depositETH',
    },
  },
  baseSepolia: {
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    faucets: [
      'https://www.alchemy.com/faucets/base-sepolia',
    ],
    bridge: {
      from: 'sepolia',
      contract: '0x49f53e41452C74589E85cA1677426Ba426459e85',
      method: 'depositETH',
    },
  },
  bscTestnet: {
    name: 'BSC Testnet',
    chainId: 97,
    rpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    explorer: 'https://testnet.bscscan.com',
    faucets: [
      'https://www.bnbchain.org/en/testnet-faucet',
    ],
  },
} as const;

type TestnetKey = keyof typeof TESTNETS;

interface DeployerConfig {
  address: string;
  privateKey: string;
  createdAt: string;
}

interface BalanceResult {
  network: string;
  balance: string;
  balanceWei: string;
  hasFunds: boolean;
}

function generateDeployerKey(): DeployerConfig {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    createdAt: new Date().toISOString(),
  };
}

function loadExistingKey(): DeployerConfig | null {
  const keyFile = join(KEYS_DIR, 'testnet-deployer.json');
  if (existsSync(keyFile)) {
    const content = readFileSync(keyFile, 'utf-8');
    return JSON.parse(content) as DeployerConfig;
  }
  return null;
}

function saveDeployerKey(config: DeployerConfig): void {
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true });
  }
  const keyFile = join(KEYS_DIR, 'testnet-deployer.json');
  writeFileSync(keyFile, JSON.stringify(config, null, 2), { mode: 0o600 });
  console.log(`\n✅ Deployer key saved to: ${keyFile}`);
}

async function checkBalance(network: TestnetKey, address: string): Promise<BalanceResult> {
  const config = TESTNETS[network];
  const provider = new JsonRpcProvider(config.rpcUrl);
  
  const balance = await provider.getBalance(address);
  const balanceEth = formatEther(balance);
  
  return {
    network: config.name,
    balance: `${parseFloat(balanceEth).toFixed(6)} ETH`,
    balanceWei: balance.toString(),
    hasFunds: balance > parseEther('0.001'),
  };
}

async function checkAllBalances(address: string): Promise<BalanceResult[]> {
  const results: BalanceResult[] = [];
  
  console.log('\n📊 Checking balances on all testnets...\n');
  
  for (const [key, config] of Object.entries(TESTNETS)) {
    process.stdout.write(`  Checking ${config.name}... `);
    const result = await checkBalance(key as TestnetKey, address);
    results.push(result);
    console.log(result.hasFunds ? `✅ ${result.balance}` : `⚠️  ${result.balance}`);
  }
  
  return results;
}

async function bridgeToL2(
  privateKey: string,
  targetNetwork: 'arbitrumSepolia' | 'optimismSepolia' | 'baseSepolia',
  amount: string
): Promise<string | null> {
  const config = TESTNETS[targetNetwork];
  const bridge = config.bridge;
  
  if (!bridge) return null;
  
  const sourceConfig = TESTNETS[bridge.from as TestnetKey];
  const provider = new JsonRpcProvider(sourceConfig.rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  
  const balance = await provider.getBalance(wallet.address);
  const amountWei = parseEther(amount);
  
  if (balance < amountWei + parseEther('0.01')) {
    console.log(`⚠️  Insufficient Sepolia balance for bridging to ${config.name}`);
    return null;
  }
  
  console.log(`\n🌉 Bridging ${amount} ETH to ${config.name}...`);
  
  let tx;
  if (bridge.method === 'depositETH') {
    // OP Stack bridge - call depositETH with gas limit
    const bridgeAbi = [
      'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data) payable',
    ];
    const bridgeContract = new (await import('ethers')).Contract(bridge.contract, bridgeAbi, wallet);
    tx = await bridgeContract.depositTransaction(
      wallet.address,
      amountWei,
      100000n, // gas limit for L2
      false,
      '0x',
      { value: amountWei }
    );
  } else {
    // Arbitrum - direct value transfer to inbox
    tx = await wallet.sendTransaction({
      to: bridge.contract,
      value: amountWei,
    });
  }
  
  console.log(`  Transaction: ${sourceConfig.explorer}/tx/${tx.hash}`);
  console.log('  Waiting for confirmation...');
  
  await tx.wait();
  console.log(`✅ Bridge transaction confirmed. Funds will arrive on ${config.name} in ~10-15 minutes.`);
  
  return tx.hash;
}

function printFaucetInstructions(address: string): void {
  console.log(`
═══════════════════════════════════════════════════════════════════════════════
 FAUCET INSTRUCTIONS - Fund your deployer wallet
═══════════════════════════════════════════════════════════════════════════════

 Your deployer address: ${address}

 1. ETHEREUM SEPOLIA (Primary - needed for L2 bridges)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    • Alchemy Faucet (0.5 ETH/day):
      https://www.alchemy.com/faucets/ethereum-sepolia
    
    • Google Cloud Faucet (0.05 ETH):
      https://cloud.google.com/application/web3/faucet/ethereum/sepolia
    
    • Sepolia Faucet:
      https://sepoliafaucet.com

 2. ARBITRUM SEPOLIA
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    • Option A: Bridge from Sepolia (this script can do it)
    • Option B: Direct faucet:
      https://www.alchemy.com/faucets/arbitrum-sepolia

 3. OPTIMISM SEPOLIA
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    • Option A: Bridge from Sepolia (this script can do it)
    • Option B: Direct faucet:
      https://www.alchemy.com/faucets/optimism-sepolia

 4. BASE SEPOLIA
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    • Option A: Bridge from Sepolia (this script can do it)
    • Option B: Direct faucet:
      https://www.alchemy.com/faucets/base-sepolia

 5. BSC TESTNET
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    • BNB Testnet Faucet:
      https://www.bnbchain.org/en/testnet-faucet

═══════════════════════════════════════════════════════════════════════════════
`);
}

function printEnvInstructions(config: DeployerConfig): void {
  console.log(`
═══════════════════════════════════════════════════════════════════════════════
 ENVIRONMENT SETUP
═══════════════════════════════════════════════════════════════════════════════

 Add to your .env.testnet file:

   DEPLOYER_PRIVATE_KEY=${config.privateKey}
   DEPLOYER_ADDRESS=${config.address}

═══════════════════════════════════════════════════════════════════════════════
`);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Jeju Network - Testnet Deployer Setup                                       ║
║  Sets up deployer wallet across all testnets                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  // Check for existing key
  let deployerConfig = loadExistingKey();
  
  if (deployerConfig) {
    console.log('📂 Found existing deployer key');
    console.log(`   Address: ${deployerConfig.address}`);
    console.log(`   Created: ${deployerConfig.createdAt}`);
  } else {
    console.log('🔑 Generating new deployer key...');
    deployerConfig = generateDeployerKey();
    saveDeployerKey(deployerConfig);
    console.log(`   Address: ${deployerConfig.address}`);
  }

  // Check balances on all networks
  const balances = await checkAllBalances(deployerConfig.address);
  
  // Summary
  const funded = balances.filter(b => b.hasFunds);
  const unfunded = balances.filter(b => !b.hasFunds);
  
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log(` BALANCE SUMMARY`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  
  if (funded.length > 0) {
    console.log('\n ✅ Funded networks:');
    funded.forEach(b => console.log(`    • ${b.network}: ${b.balance}`));
  }
  
  if (unfunded.length > 0) {
    console.log('\n ⚠️  Needs funding:');
    unfunded.forEach(b => console.log(`    • ${b.network}: ${b.balance}`));
  }

  // Check if Sepolia has funds for bridging
  const sepoliaBalance = balances.find(b => b.network === 'Ethereum Sepolia');
  const sepoliaHasBridgingFunds = sepoliaBalance && BigInt(sepoliaBalance.balanceWei) > parseEther('0.1');
  
  if (sepoliaHasBridgingFunds) {
    console.log('\n🌉 Sepolia has sufficient balance for bridging to L2s');
    
    // Check which L2s need funding
    const l2sNeedingFunds: Array<'arbitrumSepolia' | 'optimismSepolia' | 'baseSepolia'> = [];
    
    for (const network of ['arbitrumSepolia', 'optimismSepolia', 'baseSepolia'] as const) {
      const balance = balances.find(b => b.network === TESTNETS[network].name);
      if (balance && !balance.hasFunds) {
        l2sNeedingFunds.push(network);
      }
    }
    
    if (l2sNeedingFunds.length > 0) {
      console.log('\nWould you like to bridge to these L2s?');
      l2sNeedingFunds.forEach(n => console.log(`  • ${TESTNETS[n].name}`));
      console.log('\nRun with --bridge flag to automatically bridge:');
      console.log('  bun run scripts/setup-testnet-deployer.ts --bridge');
    }
    
    // Auto-bridge if flag is set
    if (process.argv.includes('--bridge')) {
      for (const network of l2sNeedingFunds) {
        await bridgeToL2(deployerConfig.privateKey, network, '0.02');
      }
    }
  } else {
    // Print faucet instructions
    printFaucetInstructions(deployerConfig.address);
  }
  
  // Print env setup instructions
  printEnvInstructions(deployerConfig);
  
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(' NEXT STEPS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`
 1. Fund your wallet using the faucets above
 2. Run this script again to check balances:
    bun run scripts/setup-testnet-deployer.ts
    
 3. Once Sepolia is funded, bridge to L2s:
    bun run scripts/setup-testnet-deployer.ts --bridge
    
 4. Add keys to your .env.testnet:
    cp env.testnet .env.testnet
    # Then add DEPLOYER_PRIVATE_KEY and DEPLOYER_ADDRESS
    
 5. Deploy contracts:
    bun run contracts:deploy:testnet
`);
}

main();
