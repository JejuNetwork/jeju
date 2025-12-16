#!/usr/bin/env bun
/**
 * @deprecated Use 'jeju token deploy hyperlane' instead
 * 
 * Deploy Hyperlane infrastructure to Jeju Testnet
 * 
 * This script deploys:
 * - MultisigISM (Interchain Security Module)
 * - InterchainGasPaymaster (IGP)
 * - Mailbox
 * 
 * Then updates the config file with the deployed addresses.
 * 
 * Usage:
 *   jeju token deploy hyperlane --network testnet
 *   jeju token deploy hyperlane --network testnet --dry-run
 */

import { createPublicClient, createWalletClient, http, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { preloadAllArtifacts, loadArtifact, deployContract } from '../src/deployer/contract-deployer';

// Jeju Testnet config
const JEJU_TESTNET = {
  chainId: 420690,
  rpcUrl: 'https://testnet-rpc.jeju.network',
  name: 'Jeju Testnet',
};

// Hyperlane domain ID (same as chain ID for simplicity)
const DOMAIN_ID = 420690;

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     Deploy Hyperlane to Jeju Testnet                         ║
║     Mailbox + IGP + MultisigISM                              ║
╚══════════════════════════════════════════════════════════════╝
`);

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex;
  
  if (!privateKey && !DRY_RUN) {
    console.error('❌ DEPLOYER_PRIVATE_KEY not set');
    process.exit(1);
  }

  const account = privateKey 
    ? privateKeyToAccount(privateKey)
    : privateKeyToAccount('0x0000000000000000000000000000000000000000000000000000000000000001');

  console.log(`Chain: ${JEJU_TESTNET.name} (${JEJU_TESTNET.chainId})`);
  console.log(`Domain ID: ${DOMAIN_ID}`);
  console.log(`Deployer: ${account.address}`);
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log();

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE');
    console.log();
    console.log('Would deploy:');
    console.log('  1. MultisigISM - Validator-based message verification');
    console.log('  2. InterchainGasPaymaster - Gas payment handling');
    console.log('  3. Mailbox - Message dispatch and processing');
    console.log();
    console.log('Configuration:');
    console.log('  - Default validator: deployer address');
    console.log('  - Threshold: 1 (single validator for testnet)');
    console.log('  - Gas oracles for: Sepolia, Base Sepolia, Arbitrum Sepolia, Jeju');
    console.log();
    console.log('To deploy, run without --dry-run:');
    console.log('  DEPLOYER_PRIVATE_KEY=0x... bun run scripts/deploy-hyperlane-jeju.ts');
    return;
  }

  // Create clients
  const publicClient = createPublicClient({
    transport: http(JEJU_TESTNET.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    transport: http(JEJU_TESTNET.rpcUrl),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${Number(balance) / 1e18} ETH`);
  
  if (balance < BigInt(1e16)) {
    console.error('❌ Insufficient balance. Need at least 0.01 ETH for deployment.');
    process.exit(1);
  }

  // Preload artifacts
  console.log('Loading contract artifacts...');
  await preloadAllArtifacts();
  
  console.log('Building Hyperlane contracts...');
  const { execSync } = await import('child_process');
  execSync('forge build --root contracts', { 
    cwd: import.meta.dir + '/..', 
    stdio: 'inherit' 
  });

  console.log();
  console.log('Deploying contracts...');
  console.log();

  // 1. Deploy MultisigISM
  console.log('1. Deploying MultisigISM...');
  const ismResult = await deployContract(
    publicClient,
    walletClient,
    'MultisigISM',
    [account.address, [account.address], 1]
  );
  console.log(`   MultisigISM: ${ismResult.address}`);
  console.log(`   TX: ${ismResult.txHash}`);

  // 2. Deploy IGP
  console.log('2. Deploying InterchainGasPaymaster...');
  const igpResult = await deployContract(
    publicClient,
    walletClient,
    'InterchainGasPaymaster',
    [account.address]
  );
  console.log(`   InterchainGasPaymaster: ${igpResult.address}`);
  console.log(`   TX: ${igpResult.txHash}`);

  // 3. Deploy Mailbox
  console.log('3. Deploying Mailbox...');
  const mailboxResult = await deployContract(
    publicClient,
    walletClient,
    'Mailbox',
    [DOMAIN_ID, account.address]
  );
  console.log(`   Mailbox: ${mailboxResult.address}`);
  console.log(`   TX: ${mailboxResult.txHash}`);

  // 4. Configure Mailbox
  console.log('4. Configuring Mailbox...');
  
  const mailboxArtifact = await loadArtifact('Mailbox');
  
  // Set default ISM
  const setIsmHash = await walletClient.writeContract({
    address: mailboxResult.address,
    abi: mailboxArtifact.abi,
    functionName: 'setDefaultIsm',
    args: [ismResult.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: setIsmHash });
  console.log('   Set default ISM');

  // Set required hook (IGP)
  const setHookHash = await walletClient.writeContract({
    address: mailboxResult.address,
    abi: mailboxArtifact.abi,
    functionName: 'setRequiredHook',
    args: [igpResult.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: setHookHash });
  console.log('   Set required hook (IGP)');

  // 5. Configure IGP with gas oracles
  console.log('5. Configuring IGP gas oracles...');
  
  const igpArtifact = await loadArtifact('InterchainGasPaymaster');
  
  const domains = [11155111, 84532, 421614, 420690]; // Sepolia, Base Sepolia, Arb Sepolia, Jeju
  const exchangeRates = domains.map(() => BigInt(1e10)); // 1:1 ETH
  const gasPrices = [
    BigInt(20e9),  // Sepolia: 20 gwei
    BigInt(1e9),   // Base Sepolia: 1 gwei
    BigInt(1e9),   // Arb Sepolia: 1 gwei
    BigInt(1e9),   // Jeju: 1 gwei
  ];

  const setOraclesHash = await walletClient.writeContract({
    address: igpResult.address,
    abi: igpArtifact.abi,
    functionName: 'setGasOracles',
    args: [domains, exchangeRates, gasPrices],
  });
  await publicClient.waitForTransactionReceipt({ hash: setOraclesHash });
  console.log('   Set gas oracles for all chains');

  console.log();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DEPLOYMENT COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  console.log('Deployed addresses:');
  console.log(`  Mailbox:     ${mailboxResult.address}`);
  console.log(`  IGP:         ${igpResult.address}`);
  console.log(`  MultisigISM: ${ismResult.address}`);
  console.log();

  // Update chains.ts with deployed addresses
  const chainsPath = `${import.meta.dir}/../src/config/chains.ts`;
  let chainsContent = await Bun.file(chainsPath).text();

  // Update JEJU_HYPERLANE_DEFAULTS
  chainsContent = chainsContent.replace(
    /const JEJU_HYPERLANE_DEFAULTS = \{[^}]+\};/,
    `const JEJU_HYPERLANE_DEFAULTS = {
  // Deployed: ${new Date().toISOString()}
  mailbox: '${mailboxResult.address}',
  igp: '${igpResult.address}',
};`
  );

  await Bun.write(chainsPath, chainsContent);
  console.log(`Updated: ${chainsPath}`);

  // Also save a separate deployment record
  const deploymentPath = `${import.meta.dir}/../deployments/jeju-hyperlane-${Date.now()}.json`;
  const deployment = {
    chain: 'jeju-testnet',
    chainId: JEJU_TESTNET.chainId,
    domainId: DOMAIN_ID,
    deployer: account.address,
    timestamp: new Date().toISOString(),
    contracts: {
      mailbox: mailboxResult.address,
      igp: igpResult.address,
      ism: ismResult.address,
    },
    transactions: {
      mailbox: mailboxResult.txHash,
      igp: igpResult.txHash,
      ism: ismResult.txHash,
    },
  };
  await Bun.write(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`Deployment record: ${deploymentPath}`);
}

main().catch(err => {
  console.error('❌ Deployment failed:', err);
  process.exit(1);
});
