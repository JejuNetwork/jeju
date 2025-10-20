#!/usr/bin/env bun
/**
 * Localnet Deployment Script
 * 
 * Deploys ALL Crucible infrastructure to localnet in one command:
 * 1. Verifies localnet is running
 * 2. Loads deployed contract addresses
 * 3. Deploys paymaster contracts
 * 4. Funds agent wallets
 * 5. Initializes database
 * 6. Verifies connectivity
 * 
 * Usage:
 *   bun run scripts/deploy-localnet.ts
 */

import { ethers } from 'ethers';
import { execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

const RPC_URL = process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function checkLocalnetRunning(): Promise<boolean> {
  console.log('🔍 Checking if localnet is running...');
  
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Localnet is running (block ${blockNumber})`);
    return true;
  } catch (error) {
    console.error('❌ Localnet is not accessible');
    console.error('   Please start localnet first: bun run dev (from repo root)');
    return false;
  }
}

async function loadContractAddresses(): Promise<Record<string, string>> {
  console.log('\n📋 Loading deployed contract addresses...');
  
  const deploymentFiles = [
    '../../contracts/deployments/localnet-addresses.json',
    '../contracts/deployments/localnet-addresses.json',
    './contracts/deployments/localnet-addresses.json'
  ];
  
  for (const filePath of deploymentFiles) {
    try {
      const fullPath = path.join(__dirname, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const addresses = JSON.parse(content);
      
      console.log('✅ Loaded contract addresses');
      console.log(`   Identity Registry: ${addresses.IDENTITY_REGISTRY}`);
      console.log(`   Reputation Registry: ${addresses.REPUTATION_REGISTRY}`);
      console.log(`   Credit Manager: ${addresses.CREDIT_MANAGER}`);
      
      return addresses;
    } catch (error) {
      // Try next path
      continue;
    }
  }
  
  console.warn('⚠️  Could not load deployment file, using defaults');
  return {
    IDENTITY_REGISTRY: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    REPUTATION_REGISTRY: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    CREDIT_MANAGER: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    ELIZA_TOKEN: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
  };
}

async function deployPaymasters(provider: ethers.JsonRpcProvider, deployer: ethers.Wallet): Promise<Record<string, string>> {
  console.log('\n💰 Loading Paymaster contracts...');
  
  // Paymasters are deployed via the main contracts deployment scripts
  // Load addresses from deployment file
  try {
    const paymasterDeployPath = path.join(__dirname, '../../../contracts/deployments/paymaster-localnet.json');
    const content = await fs.readFile(paymasterDeployPath, 'utf-8');
    const paymaster = JSON.parse(content);
    
    console.log('✅ Loaded paymaster deployments');
    console.log(`   Factory: ${paymaster.PAYMASTER_FACTORY}`);
    console.log(`   Token Registry: ${paymaster.TOKEN_REGISTRY}`);
    
    return {
      PAYMASTER_FACTORY: paymaster.PAYMASTER_FACTORY,
      TOKEN_REGISTRY: paymaster.TOKEN_REGISTRY,
      LIQUIDITY_PAYMASTER: paymaster.LIQUIDITY_PAYMASTER || ethers.ZeroAddress
    };
  } catch (error) {
    console.warn('⚠️  Paymaster deployments not found');
    console.warn('   Deploy using: cd contracts && forge script script/DeployPaymaster.s.sol --broadcast --rpc-url $JEJU_L2_RPC');
    
    return {
      PAYMASTER_FACTORY: ethers.ZeroAddress,
      TOKEN_REGISTRY: ethers.ZeroAddress,
      LIQUIDITY_PAYMASTER: ethers.ZeroAddress
    };
  }
}

async function fundAgentWallets(): Promise<void> {
  console.log('\n💵 Funding agent wallets...');
  
  try {
    execSync('bun run scripts/fund-wallets.ts', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
  } catch (error) {
    throw new Error('Failed to fund agent wallets');
  }
}

async function createEnvFile(addresses: Record<string, string>): Promise<void> {
  console.log('\n📝 Creating .env file...');
  
  const envPath = path.join(__dirname, '../.env');
  const templatePath = path.join(__dirname, '../env.template');
  
  // Check if .env already exists
  try {
    await fs.access(envPath);
    console.log('⏭️  .env already exists, skipping');
    return;
  } catch {
    // File doesn't exist, create it
  }
  
  // Read template
  let template = await fs.readFile(templatePath, 'utf-8');
  
  // Replace contract addresses
  for (const [key, value] of Object.entries(addresses)) {
    const regex = new RegExp(`${key}=.*`, 'g');
    template = template.replace(regex, `${key}=${value}`);
  }
  
  // Write .env
  await fs.writeFile(envPath, template);
  console.log('✅ .env file created');
  console.log('   ⚠️  Remember to set OPENAI_API_KEY or ANTHROPIC_API_KEY');
}

async function verifySetup(addresses: Record<string, string>): Promise<void> {
  console.log('\n🔍 Verifying setup...');
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  
  // Check deployer balance
  const balance = await provider.getBalance(deployer.address);
  console.log(`✅ Deployer balance: ${ethers.formatEther(balance)} ETH`);
  
  // Check contract deployments
  for (const [name, address] of Object.entries(addresses)) {
    if (address === ethers.ZeroAddress || !address.startsWith('0x')) {
      continue;
    }
    
    try {
      const code = await provider.getCode(address);
      if (code === '0x') {
        console.warn(`⚠️  ${name}: No code at ${address}`);
      } else {
        console.log(`✅ ${name}: Deployed at ${address}`);
      }
    } catch (error) {
      console.warn(`⚠️  ${name}: Could not verify ${address}`);
    }
  }
}

async function createDataDirectories(): Promise<void> {
  console.log('\n📁 Creating data directories...');
  
  const dirs = [
    path.join(__dirname, '../data'),
    path.join(__dirname, '../data/evidence'),
    path.join(__dirname, '../logs')
  ];
  
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(`✅ Created ${path.basename(dir)}/`);
    } catch (error) {
      console.warn(`⚠️  Could not create ${dir}`);
    }
  }
}

async function main() {
  console.log('🔥 Jeju Crucible - Localnet Deployment');
  console.log('=====================================\n');
  
  try {
    // Step 1: Check localnet
    if (!await checkLocalnetRunning()) {
      process.exit(1);
    }
    
    // Step 2: Load contract addresses
    const addresses = await loadContractAddresses();
    
    // Step 3: Deploy paymasters (optional)
    const paymasterAddresses = await deployPaymasters(
      new ethers.JsonRpcProvider(RPC_URL),
      new ethers.Wallet(DEPLOYER_KEY, new ethers.JsonRpcProvider(RPC_URL))
    );
    
    const allAddresses = {
      ...addresses,
      ...paymasterAddresses
    };
    
    // Step 4: Create directories
    await createDataDirectories();
    
    // Step 5: Create .env file
    await createEnvFile(allAddresses);
    
    // Step 6: Fund agent wallets
    await fundAgentWallets();
    
    // Step 7: Verify setup
    await verifySetup(allAddresses);
    
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ Crucible deployment complete!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Add AI API key to .env:');
    console.log('     OPENAI_API_KEY=sk-...');
    console.log('');
    console.log('  2. Start Crucible:');
    console.log('     bun run dev');
    console.log('     OR');
    console.log('     docker-compose -f docker/docker-compose.yml up -d');
    console.log('');
    console.log('  3. Monitor agents:');
    console.log('     curl http://localhost:7777/api/agents');
    console.log('');
    console.log('  4. View dashboard:');
    console.log('     open http://localhost:7777/dashboard');
    console.log('');
    
  } catch (error) {
    console.error('\n❌ Deployment failed:', error);
    process.exit(1);
  }
}

main();

