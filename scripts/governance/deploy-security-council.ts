#!/usr/bin/env bun
/**
 * Security Council Safe Deployment
 * 
 * Deploys a Gnosis Safe multisig for the Security Council role.
 * This is REQUIRED for Stage 2 decentralization - emergency actions
 * must be controlled by a multisig, not a single EOA.
 * 
 * Safe Configuration:
 * - 3-of-5 threshold (or higher)
 * - Independent keyholders from different organizations
 * - Hardware wallet signers recommended
 * 
 * Required Environment:
 *   RPC_URL - RPC endpoint
 *   DEPLOYER_PRIVATE_KEY - Wallet to deploy the Safe
 *   OWNER_1..OWNER_5 - Addresses of Safe owners
 *   THRESHOLD - Required signatures (default: 3)
 */

import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, zeroAddress, isAddress, keccak256, toBytes, getContractAddress, formatEther, decodeEventLog, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { inferChainFromRpcUrl } from '../shared/chain-utils';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

// Safe Factory and Singleton addresses (same on all chains)
const SAFE_SINGLETON = '0x41675C099F32341bf84BFc5382aF534df5C7461a';
const SAFE_PROXY_FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67';
const SAFE_FALLBACK_HANDLER = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99';

// Safe Proxy Factory ABI
const SAFE_PROXY_FACTORY_ABI = [
  'function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
  'event ProxyCreation(address indexed proxy, address singleton)',
];

// Safe Singleton ABI (minimal for setup)
const SAFE_SINGLETON_ABI = [
  'function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function isOwner(address owner) view returns (bool)',
];

interface SafeConfig {
  owners: string[];
  threshold: number;
  saltNonce?: bigint;
}

async function encodeSafeSetup(config: SafeConfig): Promise<`0x${string}`> {
  const safeAbi = parseAbi(SAFE_SINGLETON_ABI);
  
  return encodeFunctionData({
    abi: safeAbi,
    functionName: 'setup',
    args: [
      config.owners as Address[],
      config.threshold,
      zeroAddress, // to - no delegate call
      '0x' as `0x${string}`, // data - no delegate call data
      SAFE_FALLBACK_HANDLER as Address, // fallbackHandler
      zeroAddress, // paymentToken - no payment
      0n, // payment - no payment
      zeroAddress, // paymentReceiver - no payment
    ],
  });
}

async function deploySafe(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  config: SafeConfig
): Promise<Address> {
  const proxyFactoryAbi = parseAbi(SAFE_PROXY_FACTORY_ABI);
  
  // Encode setup data
  const setupData = await encodeSafeSetup(config);
  
  // Use deterministic deployment with salt
  const saltNonce = config.saltNonce ?? BigInt(Date.now());
  
  console.log('Creating Safe proxy...');
  const hash = await walletClient.writeContract({
    address: SAFE_PROXY_FACTORY as Address,
    abi: proxyFactoryAbi,
    functionName: 'createProxyWithNonce',
    args: [SAFE_SINGLETON as Address, setupData, saltNonce],
  });
  console.log(`  TX: ${hash}`);
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  // Parse ProxyCreation event to get Safe address
  const logs = receipt.logs.filter((log: { address: string }) => 
    log.address.toLowerCase() === SAFE_PROXY_FACTORY.toLowerCase()
  );
  
  if (logs.length === 0) {
    throw new Error('ProxyCreation event not found');
  }
  
  const decoded = decodeEventLog({
    abi: proxyFactoryAbi,
    eventName: 'ProxyCreation',
    topics: logs[0].topics as [`0x${string}`, ...`0x${string}`[]],
    data: logs[0].data,
  });
  const safeAddress = (decoded.args as { proxy: Address }).proxy;
  
  return safeAddress;
}

async function verifySafe(
  publicClient: ReturnType<typeof createPublicClient>,
  safeAddress: Address,
  expectedConfig: SafeConfig
): Promise<boolean> {
  const safeAbi = parseAbi(SAFE_SINGLETON_ABI);
  
  const [owners, threshold] = await Promise.all([
    publicClient.readContract({
      address: safeAddress,
      abi: safeAbi,
      functionName: 'getOwners',
    }),
    publicClient.readContract({
      address: safeAddress,
      abi: safeAbi,
      functionName: 'getThreshold',
    }),
  ]);
  
  console.log('Verifying Safe configuration...');
  console.log(`  Owners: ${owners.length}`);
  console.log(`  Threshold: ${threshold}`);
  
  // Verify threshold
  if (Number(threshold) !== expectedConfig.threshold) {
    console.log(`  ❌ Threshold mismatch: expected ${expectedConfig.threshold}, got ${threshold}`);
    return false;
  }
  
  // Verify owners
  const expectedOwnersLower = expectedConfig.owners.map(o => o.toLowerCase());
  const actualOwnersLower = owners.map((o: Address) => o.toLowerCase());
  
  for (const owner of expectedOwnersLower) {
    if (!actualOwnersLower.includes(owner)) {
      console.log(`  ❌ Missing owner: ${owner}`);
      return false;
    }
  }
  
  console.log('  ✅ Configuration verified');
  return true;
}

async function main(): Promise<void> {
  console.log('🔐 Security Council Safe Deployment\n');

  const network = process.env.NETWORK || 'localnet';
  const rpcUrl = process.env.RPC_URL || process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  
  // Check if we're on a testnet/mainnet where Safe is deployed
  const chain = inferChainFromRpcUrl(rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  
  console.log(`Network: ${network} (chainId: ${chainId})`);
  console.log(`RPC: ${rpcUrl}\n`);

  // Get owners from environment
  const owners: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const owner = process.env[`OWNER_${i}`];
    if (owner && isAddress(owner)) {
      owners.push(owner);
    }
  }

  if (owners.length < 3) {
    console.log('Insufficient owners specified. For Stage 2 compliance:');
    console.log('  - Minimum 3 owners required');
    console.log('  - Set OWNER_1, OWNER_2, OWNER_3, etc. environment variables');
    console.log('');
    
    // For local testing, create test owners
    if (network === 'localnet') {
      console.log('Creating test owners for localnet...');
      const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (!deployerKey) {
        console.error('DEPLOYER_PRIVATE_KEY required');
        process.exit(1);
      }
      
      // Generate deterministic test addresses
      const { generatePrivateKey } = await import('viem/accounts');
      for (let i = 0; i < 5; i++) {
        const account = privateKeyToAccount(generatePrivateKey());
        owners.push(account.address);
        console.log(`  Test Owner ${i + 1}: ${account.address}`);
      }
      console.log('');
    } else {
      console.error('Cannot proceed without owners for non-localnet deployment');
      process.exit(1);
    }
  }

  const threshold = parseInt(process.env.THRESHOLD || '3', 10);
  
  if (threshold > owners.length) {
    console.error(`Threshold (${threshold}) cannot exceed number of owners (${owners.length})`);
    process.exit(1);
  }
  
  if (threshold < 2) {
    console.error('Threshold must be at least 2 for Stage 2 compliance');
    process.exit(1);
  }

  console.log(`Owners: ${owners.length}`);
  owners.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
  console.log(`Threshold: ${threshold}-of-${owners.length}`);
  console.log('');

  // Check if Safe Factory is deployed
  const factoryCode = await publicClient.getBytecode({ address: SAFE_PROXY_FACTORY as Address });
  if (factoryCode === undefined || factoryCode === '0x') {
    console.log('⚠️  Safe Proxy Factory not deployed on this network');
    console.log('   For localnet, Safe deployment is simulated');
    console.log('   For mainnet/testnet, use a network where Safe is deployed');
    console.log('');
    
    // For localnet, just output the intended configuration
    const salt = keccak256(toBytes('security_council_safe'));
    const initCodeHash = keccak256('0x' as `0x${string}`);
    const simulatedSafe = getContractAddress({
      from: SAFE_PROXY_FACTORY as Address,
      bytecode: initCodeHash,
      opcode: 'CREATE2',
      salt,
    });
    
    console.log('Simulated Safe Address:', simulatedSafe);
    console.log('');
    console.log('To use this on mainnet/testnet:');
    console.log('  1. Deploy on a chain with Safe contracts (Base, Ethereum, etc.)');
    console.log('  2. Set owners and threshold via Safe UI');
    console.log('  3. Update GovernanceTimelock.securityCouncil to Safe address');
    
    // Save simulated config
    const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`);
    let deployment: Record<string, string> = {};
    if (existsSync(deploymentFile)) {
      deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
    }
    deployment.securityCouncil = simulatedSafe;
    deployment.securityCouncilConfig = JSON.stringify({ owners, threshold });
    writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
    console.log(`\nConfig saved to ${deploymentFile}`);
    
    return;
  }

  // Deploy Safe
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) {
    console.error('DEPLOYER_PRIVATE_KEY required');
    process.exit(1);
  }
  
  const deployerAccount = privateKeyToAccount(deployerKey as `0x${string}`);
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account: deployerAccount });
  console.log(`Deployer: ${deployerAccount.address}`);
  
  const balance = await publicClient.getBalance({ address: deployerAccount.address });
  console.log(`Balance: ${formatEther(balance)} ETH\n`);

  const config: SafeConfig = {
    owners,
    threshold,
    saltNonce: BigInt(Date.now()),
  };

  try {
    const safeAddress = await deploySafe(publicClient, walletClient, config);
    console.log(`\n✅ Security Council Safe deployed: ${safeAddress}`);
    
    // Verify configuration
    await verifySafe(publicClient, safeAddress, config);
    
    // Save to deployments
    const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`);
    let deployment: Record<string, string> = {};
    if (existsSync(deploymentFile)) {
      deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
    }
    deployment.securityCouncil = safeAddress;
    writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
    console.log(`\nSaved to ${deploymentFile}`);
    
    console.log('\n📋 Next Steps:');
    console.log('  1. Update GovernanceTimelock.securityCouncil to:', safeAddress);
    console.log('  2. Have all owners verify they can sign');
    console.log('  3. Test emergency actions via Safe');
  } catch (error) {
    console.error('Deployment failed:', error);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

