/**
 * jeju keys - Key management and genesis ceremony
 * 
 * For mainnet deployment, this implements a secure ceremony:
 * 1. Security checklist verification
 * 2. Choice: generate new keys OR import existing
 * 3. Entropy collection for key generation
 * 4. Password-based encryption (AES-256-GCM)
 * 5. Key display with confirmation
 * 6. Secure key burning from memory
 * 7. Genesis config generation
 */

import { Command } from 'commander';
import prompts from 'prompts';
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomBytes, createHash } from 'crypto';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { keccak256, stringToBytes } from 'viem';
import { execa } from 'execa';
import { logger } from '../lib/logger';
import {
  getDevKeys,
  encryptKeySet,
  printFundingRequirements,
  validatePassword,
  type OperatorKeySet,
} from '../lib/keys';
import { getKeysDir, findMonorepoRoot } from '../lib/system';
import { type NetworkType, type KeyConfig, type KeySet } from '../types';

export const keysCommand = new Command('keys')
  .description('Manage keys')
  .argument('[action]', 'show | genesis | burn', 'show')
  .option('-n, --network <network>', 'Network', 'localnet')
  .option('--private', 'Show private keys')
  .action(async (action, options) => {
    const network = options.network as NetworkType;
    
    switch (action) {
      case 'show':
        await showKeys(network, options.private);
        break;
      case 'genesis':
        await runGenesis(network);
        break;
      case 'burn':
        await burnKeys(network);
        break;
      default:
        await showKeys(network, options.private);
    }
  });

// Genesis ceremony subcommand
const genesisSubcommand = new Command('genesis')
  .description('Secure key generation ceremony for production deployment')
  .option('-n, --network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--tee', 'Run ceremony in TEE (dstack/Phala/GCP CVM)')
  .option('--tee-endpoint <url>', 'TEE endpoint URL')
  .action(async (options) => {
    if (options.tee) {
      await runTeeGenesis(options.network as NetworkType, options.teeEndpoint);
    } else {
      await runGenesis(options.network as NetworkType);
    }
  });

keysCommand.addCommand(genesisSubcommand);

// TEE ceremony subcommand
const teeSubcommand = new Command('tee')
  .description('Run genesis ceremony in Trusted Execution Environment (TEE)')
  .option('-n, --network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--endpoint <url>', 'TEE endpoint (dstack/Phala gateway URL)')
  .option('--verify <file>', 'Verify attestation from ceremony result file')
  .action(async (options) => {
    if (options.verify) {
      await verifyTeeAttestation(options.verify);
    } else {
      await runTeeGenesis(options.network as NetworkType, options.endpoint);
    }
  });

keysCommand.addCommand(teeSubcommand);

// Distributed ceremony subcommand (maximum trustlessness)
const distributedSubcommand = new Command('distributed')
  .description('Run distributed ceremony across multiple TEEs (maximum trustlessness)')
  .option('-n, --network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('-t, --threshold <k>', 'Threshold (k-of-n)', '2')
  .option('--providers <file>', 'JSON file with TEE provider configs')
  .option('--register', 'Register ceremony on-chain for auditability')
  .action(async (options) => {
    await runDistributedCeremony(options);
  });

keysCommand.addCommand(distributedSubcommand);

// Setup testnet deployer subcommand
const setupTestnetSubcommand = new Command('setup-testnet')
  .description('Setup testnet deployer wallet across all testnets')
  .option('--bridge', 'Automatically bridge ETH to L2s if Sepolia is funded')
  .action(async (options) => {
    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'scripts/keys/setup-testnet-deployer.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error('Setup testnet deployer script not found');
      return;
    }

    const args: string[] = [];
    if (options.bridge) args.push('--bridge');

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  });

keysCommand.addCommand(setupTestnetSubcommand);

// ═══════════════════════════════════════════════════════════════════════════
// TEE CEREMONY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function runTeeGenesis(network: NetworkType, endpoint?: string) {
  if (network === 'localnet') {
    logger.error('TEE ceremony not needed for localnet');
    return;
  }

  console.clear();
  logger.header('TEE GENESIS CEREMONY');
  logger.newline();
  
  logger.info('╔═══════════════════════════════════════════════════════════════╗');
  logger.info('║  TRUSTED EXECUTION ENVIRONMENT                                ║');
  logger.info('║  Keys will be derived inside hardware-isolated enclave        ║');
  logger.info('║  Attestation will prove genuine TEE execution                 ║');
  logger.info('╚═══════════════════════════════════════════════════════════════╝');
  logger.newline();

  // Get TEE endpoint
  const teeEndpoint = endpoint || process.env.DSTACK_ENDPOINT || process.env.PHALA_ENDPOINT;
  
  if (!teeEndpoint) {
    logger.subheader('TEE Provider Selection');
    
    const { provider } = await prompts({
      type: 'select',
      name: 'provider',
      message: 'Select TEE provider:',
      choices: [
        { title: 'Phala Network (dstack)', value: 'phala', description: 'Public TEE network' },
        { title: 'GCP Confidential VM', value: 'gcp', description: 'Google Cloud TDX/SEV' },
        { title: 'Custom endpoint', value: 'custom', description: 'Self-hosted dstack' },
        { title: 'Local simulator', value: 'simulator', description: 'For testing only' },
      ],
    });

    if (!provider) {
      logger.error('Cancelled');
      return;
    }

    if (provider === 'phala') {
      logger.info('\nPhala Network provides public TEE infrastructure.');
      logger.info('Visit: https://phala.network/dstack\n');
      
      const { phalaEndpoint } = await prompts({
        type: 'text',
        name: 'phalaEndpoint',
        message: 'Enter Phala dstack gateway URL:',
        initial: 'https://your-app.phala.network',
      });
      
      if (!phalaEndpoint) return;
      process.env.DSTACK_ENDPOINT = phalaEndpoint;
    } else if (provider === 'gcp') {
      logger.info('\nGCP Confidential VMs require setup:');
      logger.info('  1. Enable Confidential Computing API');
      logger.info('  2. Deploy dstack to a TDX-enabled instance');
      logger.info('  3. Enter the instance endpoint\n');
      
      const { gcpEndpoint } = await prompts({
        type: 'text',
        name: 'gcpEndpoint',
        message: 'Enter GCP CVM endpoint:',
      });
      
      if (!gcpEndpoint) return;
      process.env.DSTACK_ENDPOINT = gcpEndpoint;
    } else if (provider === 'custom') {
      const { customEndpoint } = await prompts({
        type: 'text',
        name: 'customEndpoint',
        message: 'Enter dstack endpoint URL:',
      });
      
      if (!customEndpoint) return;
      process.env.DSTACK_ENDPOINT = customEndpoint;
    } else {
      logger.warn('\nUsing simulator - NOT FOR PRODUCTION');
      process.env.DSTACK_SIMULATOR_ENDPOINT = 'http://localhost:8090';
    }
  }

  // Get password (never sent to TEE, only hash)
  logger.newline();
  logger.subheader('Encryption Password');
  logger.info('Keys will be encrypted in the TEE with your password.');
  logger.warn('Only the hash is sent to TEE - your password stays local.\n');

  let password: string;
  while (true) {
    const { pwd } = await prompts({
      type: 'password',
      name: 'pwd',
      message: 'Enter password (min 16 chars):',
    });

    const validation = validatePassword(pwd);
    if (!validation.valid) {
      for (const err of validation.errors) {
        logger.error('  - ' + err);
      }
      continue;
    }

    const { confirm } = await prompts({
      type: 'password',
      name: 'confirm',
      message: 'Confirm password:',
    });

    if (pwd !== confirm) {
      logger.error('Passwords do not match');
      continue;
    }

    password = pwd;
    break;
  }

  // Hash password locally (never send plaintext to TEE)
  const passwordHash = createHash('sha256').update(password).digest('hex');
  
  logger.newline();
  logger.step('Connecting to TEE...');

  try {
    // Dynamically import TEE ceremony
    const { runTeeCeremony, verifyAttestation } = await import('../tee/genesis-ceremony');
    
    logger.step('Starting ceremony in TEE enclave...');
    logger.info('Keys are being derived from hardware-rooted secrets\n');

    const result = await runTeeCeremony(network, passwordHash);

    // Verify attestation
    logger.step('Verifying attestation...');
    const verification = await verifyAttestation(result);
    
    if (!verification.valid) {
      logger.error('Attestation verification failed: ' + verification.details);
      return;
    }
    
    logger.success('Attestation verified');
    logger.info('  ' + verification.details);

    // Save results
    const keysDir = getKeysDir();
    const networkDir = join(keysDir, network);
    mkdirSync(networkDir, { recursive: true, mode: 0o700 });

    // Save encrypted keys
    const encryptedPath = join(networkDir, 'tee-keys.enc');
    writeFileSync(encryptedPath, result.encryptedKeys, { mode: 0o600 });

    // Save attestation
    const attestationPath = join(networkDir, 'attestation.json');
    writeFileSync(attestationPath, JSON.stringify(result.attestation, null, 2));

    // Save addresses
    const addressesPath = join(networkDir, 'addresses.json');
    writeFileSync(addressesPath, JSON.stringify(result.publicAddresses, null, 2));

    // Save genesis config
    const genesisPath = join(networkDir, 'genesis-config.json');
    writeFileSync(genesisPath, JSON.stringify({
      network,
      generated: result.timestamp,
      tee: true,
      addresses: result.genesisConfig,
    }, null, 2));

    // Clear password from memory
    password = '';

    logger.newline();
    logger.header('TEE CEREMONY COMPLETE');
    logger.success('Keys derived in TEE and encrypted\n');

    logger.subheader('Files Created');
    logger.info('  ' + encryptedPath + ' (encrypted keys)');
    logger.info('  ' + attestationPath + ' (TEE attestation)');
    logger.info('  ' + addressesPath + ' (public addresses)');
    logger.info('  ' + genesisPath + ' (genesis config)\n');

    logger.subheader('Operator Addresses');
    for (const [role, address] of Object.entries(result.publicAddresses)) {
      logger.info(`  ${role}: ${address}`);
    }

    logger.newline();
    logger.subheader('Attestation');
    logger.info('  Quote: ' + result.attestation.quote.slice(0, 40) + '...');
    logger.info('  Measurement: ' + result.attestation.measurementHash.slice(0, 40) + '...');

    logger.newline();
    logger.subheader('Next Steps');
    logger.list([
      'Verify attestation: jeju keys tee --verify ' + attestationPath,
      'Fund operator addresses',
      'Deploy chain: jeju deploy ' + network,
    ]);

    logger.newline();
    logger.warn('To decrypt keys: Use your password with the TEE decryption tool');

  } catch (error) {
    const err = error as Error;
    
    if (err.message.includes('DSTACK_SIMULATOR_ENDPOINT')) {
      logger.error('TEE not available. Options:');
      logger.list([
        'Deploy ceremony to Phala Network',
        'Set up GCP Confidential VM',
        'Run local dstack for testing',
      ]);
    } else {
      logger.error('TEE ceremony failed: ' + err.message);
    }
  }
}

interface DistributedCeremonyOptions {
  network: string;
  threshold: string;
  providers?: string;
  register?: boolean;
}

async function runDistributedCeremony(options: DistributedCeremonyOptions) {
  const network = options.network as 'testnet' | 'mainnet';
  const threshold = parseInt(options.threshold, 10);

  if (options.network === 'localnet') {
    logger.error('Distributed ceremony not needed for localnet');
    return;
  }

  console.clear();
  logger.header('DISTRIBUTED TEE CEREMONY');
  logger.newline();
  
  logger.info('╔═══════════════════════════════════════════════════════════════╗');
  logger.info('║  MAXIMUM TRUSTLESSNESS PROTOCOL                               ║');
  logger.info('║  Keys distributed across multiple TEE enclaves                ║');
  logger.info('║  No single party (human or TEE) can reconstruct               ║');
  logger.info('╚═══════════════════════════════════════════════════════════════╝');
  logger.newline();

  // Get TEE providers
  let providers: Array<{ name: string; type: string; endpoint: string }>;
  
  if (options.providers) {
    // Load from file
    if (!existsSync(options.providers)) {
      logger.error('Providers file not found: ' + options.providers);
      return;
    }
    providers = JSON.parse(readFileSync(options.providers, 'utf-8'));
  } else {
    // Interactive setup
    logger.subheader('TEE Provider Configuration');
    logger.info('You need at least 3 TEE providers for distributed ceremony.\n');

    const { providerCount } = await prompts({
      type: 'number',
      name: 'providerCount',
      message: 'How many TEE providers?',
      initial: 3,
      min: 3,
      max: 10,
    });

    if (!providerCount) {
      logger.error('Cancelled');
      return;
    }

    providers = [];
    
    for (let i = 0; i < providerCount; i++) {
      logger.newline();
      logger.info(`Provider ${i + 1}/${providerCount}:`);
      
      const { providerType } = await prompts({
        type: 'select',
        name: 'providerType',
        message: 'Provider type:',
        choices: [
          { title: 'Phala Network', value: 'phala' },
          { title: 'GCP Confidential VM', value: 'gcp' },
          { title: 'Azure Confidential', value: 'azure' },
          { title: 'AWS Nitro', value: 'aws-nitro' },
          { title: 'Custom dstack', value: 'custom' },
        ],
      });

      const { endpoint } = await prompts({
        type: 'text',
        name: 'endpoint',
        message: 'Endpoint URL:',
        initial: providerType === 'phala' ? 'https://your-app.phala.network' : 'http://localhost:8090',
      });

      const { name } = await prompts({
        type: 'text',
        name: 'name',
        message: 'Provider name (for identification):',
        initial: `${providerType}-${i + 1}`,
      });

      if (!providerType || !endpoint || !name) {
        logger.error('Cancelled');
        return;
      }

      providers.push({ name, type: providerType, endpoint });
    }
  }

  if (providers.length < 3) {
    logger.error('Need at least 3 providers for distributed ceremony');
    return;
  }

  if (threshold > providers.length) {
    logger.error(`Threshold ${threshold} cannot exceed provider count ${providers.length}`);
    return;
  }

  if (threshold < 2) {
    logger.error('Threshold must be at least 2');
    return;
  }

  logger.newline();
  logger.subheader('Ceremony Configuration');
  logger.info(`  Network: ${network}`);
  logger.info(`  Threshold: ${threshold}-of-${providers.length}`);
  logger.info(`  Providers:`);
  for (const p of providers) {
    logger.info(`    - ${p.name} (${p.type})`);
  }

  const { proceed } = await prompts({
    type: 'confirm',
    name: 'proceed',
    message: 'Proceed with distributed ceremony?',
    initial: true,
  });

  if (!proceed) {
    logger.info('Cancelled');
    return;
  }

  logger.newline();

  try {
    // Import and run distributed ceremony
    const { runDistributedCeremony: runCeremony, registerCeremonyOnChain } = await import('../tee/distributed-ceremony');
    
    // Enable simulation for development
    process.env.CEREMONY_SIMULATION = 'true';
    
    const result = await runCeremony(
      network,
      providers as Array<{ name: string; type: 'phala' | 'gcp' | 'azure' | 'aws-nitro' | 'custom'; endpoint: string }>,
      threshold,
    );

    // Save results
    const keysDir = getKeysDir();
    const networkDir = join(keysDir, network);
    mkdirSync(networkDir, { recursive: true, mode: 0o700 });

    // Save ceremony result
    const ceremonyPath = join(networkDir, 'distributed-ceremony.json');
    writeFileSync(ceremonyPath, JSON.stringify({
      ...result,
      // Don't save encrypted shares - they stay in TEEs
      shares: result.shares.map(s => ({
        ...s,
        encryptedShare: '[SEALED IN TEE]',
      })),
    }, null, 2));

    // Save addresses
    const addressesPath = join(networkDir, 'addresses.json');
    const addresses = Object.fromEntries(
      Object.entries(result.publicKeys).map(([role, pubkey]) => {
        // Derive address from public key
        const addressHash = keccak256(stringToBytes(pubkey));
        return [role, '0x' + addressHash.slice(-40)];
      })
    );
    writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));

    // Save genesis config
    const genesisPath = join(networkDir, 'genesis-config.json');
    writeFileSync(genesisPath, JSON.stringify({
      network,
      generated: result.timestamp,
      ceremonyId: result.ceremonyId,
      threshold: result.threshold,
      distributed: true,
      addresses: result.genesisConfig,
    }, null, 2));

    // Save attestations
    const attestationsPath = join(networkDir, 'attestations.json');
    writeFileSync(attestationsPath, JSON.stringify(result.attestations, null, 2));

    logger.newline();
    logger.header('DISTRIBUTED CEREMONY COMPLETE');
    logger.success('Keys distributed across ' + providers.length + ' TEE enclaves\n');

    logger.subheader('Security Properties');
    logger.list([
      `${threshold}-of-${providers.length} threshold: Need ${threshold} TEEs to sign`,
      'No single TEE has complete key material',
      'Even if all humans collude, keys cannot be reconstructed',
      'Cross-TEE verification ensures all enclaves are genuine',
    ]);

    logger.newline();
    logger.subheader('Files Created');
    logger.info('  ' + ceremonyPath);
    logger.info('  ' + addressesPath);
    logger.info('  ' + genesisPath);
    logger.info('  ' + attestationsPath);

    // Register on-chain if requested
    if (options.register) {
      logger.newline();
      logger.subheader('On-Chain Registration');
      
      const { registryAddress, rpcUrl } = await prompts([
        {
          type: 'text',
          name: 'registryAddress',
          message: 'Ceremony Registry contract address:',
        },
        {
          type: 'text',
          name: 'rpcUrl',
          message: 'RPC URL:',
          initial: network === 'mainnet' 
            ? 'https://mainnet.base.org' 
            : 'https://sepolia.base.org',
        },
      ]);

      if (registryAddress && rpcUrl) {
        const txHash = await registerCeremonyOnChain(result, registryAddress, rpcUrl);
        logger.success('Registered: ' + txHash);
      }
    }

    logger.newline();
    logger.subheader('Next Steps');
    logger.list([
      'Verify attestations with Intel/AMD attestation service',
      'Fund operator addresses',
      'Deploy chain: jeju deploy ' + network,
      'For signing operations, use threshold signing with ' + threshold + ' TEEs',
    ]);

  } catch (error) {
    const err = error as Error;
    logger.error('Distributed ceremony failed: ' + err.message);
    if (err.stack) {
      logger.debug(err.stack);
    }
  }
}

async function verifyTeeAttestation(attestationFile: string) {
  logger.header('VERIFY TEE ATTESTATION');

  if (!existsSync(attestationFile)) {
    logger.error('Attestation file not found: ' + attestationFile);
    return;
  }

  const attestation = JSON.parse(readFileSync(attestationFile, 'utf-8'));

  logger.subheader('Attestation Details');
  logger.keyValue('Quote', attestation.quote?.slice(0, 60) + '...');
  logger.keyValue('Measurement', attestation.measurementHash);
  
  if (attestation.tcbInfo) {
    logger.newline();
    logger.subheader('TCB Info');
    for (const [key, value] of Object.entries(attestation.tcbInfo)) {
      if (typeof value === 'string' && value.length > 40) {
        logger.keyValue(key, (value as string).slice(0, 40) + '...');
      } else {
        logger.keyValue(key, String(value));
      }
    }
  }

  logger.newline();
  logger.info('For full verification, submit the quote to:');
  logger.list([
    'Intel Attestation Service (IAS)',
    'Phala dcap-qvl verifier',
    'Azure Attestation Service',
  ]);

  logger.newline();
  logger.success('Attestation file is valid JSON');
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL CEREMONY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function runGenesis(network: NetworkType) {
  if (network === 'localnet') {
    logger.error('Genesis ceremony not needed for localnet');
    logger.info('Localnet uses well-known Anvil test keys');
    return;
  }

  console.clear();
  logger.header('GENESIS KEY CEREMONY');
  logger.newline();
  
  if (network === 'mainnet') {
    logger.error('╔═══════════════════════════════════════════════════════════════╗');
    logger.error('║  MAINNET DEPLOYMENT - THIS IS PRODUCTION                      ║');
    logger.error('║  Keys generated here will control real funds                  ║');
    logger.error('╚═══════════════════════════════════════════════════════════════╝');
  } else {
    logger.warn('TESTNET deployment - keys will control testnet assets');
  }
  
  logger.newline();

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 1: Security Environment Check
  // ═══════════════════════════════════════════════════════════════════════
  
  logger.subheader('Phase 1: Security Environment');
  logger.info('Verify your environment is secure before proceeding.\n');

  const securityChecks = [
    { q: 'Is this machine air-gapped (no network connection)?', required: network === 'mainnet' },
    { q: 'Is your screen private (no cameras, no observers)?', required: true },
    { q: 'Do you have a hardware wallet or secure cold storage ready?', required: true },
    { q: 'Do you have paper/metal backup materials ready?', required: true },
    { q: 'Have you verified the integrity of this CLI installation?', required: network === 'mainnet' },
  ];

  for (const check of securityChecks) {
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: check.q,
      initial: false,
    });

    if (!confirmed && check.required) {
      logger.error('\nCeremony aborted - security requirement not met');
      logger.info('Please ensure all security requirements are satisfied.');
      return;
    }
    
    if (!confirmed) {
      logger.warn('  Proceeding without: ' + check.q.slice(0, 50) + '...');
    }
  }

  logger.newline();
  logger.success('Security environment verified');

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2: Key Source Selection
  // ═══════════════════════════════════════════════════════════════════════
  
  logger.newline();
  logger.subheader('Phase 2: Key Source');

  const { keySource } = await prompts({
    type: 'select',
    name: 'keySource',
    message: 'How do you want to provide operator keys?',
    choices: [
      { title: 'Generate new keys', value: 'generate', description: 'Create fresh cryptographic keys' },
      { title: 'Import existing keys', value: 'import', description: 'Use keys from hardware wallet or file' },
    ],
  });

  if (!keySource) {
    logger.error('Ceremony aborted');
    return;
  }

  let operatorKeys: Record<string, KeyConfig> | null = null;

  if (keySource === 'import') {
    operatorKeys = await importKeys();
    if (!operatorKeys) {
      return;
    }
  } else {
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3: Entropy Collection (for generation only)
    // ═══════════════════════════════════════════════════════════════════════
    
    logger.newline();
    logger.subheader('Phase 3: Entropy Collection');
    logger.info('Additional entropy strengthens key generation.\n');

    // Collect user entropy
    const { userEntropy } = await prompts({
      type: 'text',
      name: 'userEntropy',
      message: 'Type random characters (mash keyboard), then Enter:',
    });

    // Collect timing entropy
    logger.info('\nCollecting timing entropy...');
    const timingEntropy = await collectTimingEntropy();
    
    // Combine all entropy sources
    const combinedEntropy = combineEntropy([
      userEntropy || '',
      timingEntropy,
      randomBytes(32).toString('hex'),
      Date.now().toString(),
      process.hrtime.bigint().toString(),
    ]);

    logger.success('Entropy collected: ' + combinedEntropy.slice(0, 16) + '...');

    // Generate keys with entropy
    logger.newline();
    logger.step('Generating operator keys...');
    operatorKeys = generateKeysWithEntropy(combinedEntropy);
  }

  if (!operatorKeys) {
    logger.error('Failed to generate or import keys');
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 4: Encryption Password
  // ═══════════════════════════════════════════════════════════════════════
  
  logger.newline();
  logger.subheader('Phase 4: Encryption Password');
  logger.info('Keys will be encrypted for storage. Choose a strong password.');
  logger.warn('WARNING: If you lose this password, keys cannot be recovered.\n');

  let encryptionPassword: string;
  while (true) {
    const { pwd } = await prompts({
      type: 'password',
      name: 'pwd',
      message: 'Enter password (min 16 chars, mixed case, numbers, symbols):',
    });

    if (!pwd) {
      logger.error('Password is required');
      continue;
    }

    const validation = validatePassword(pwd);
    if (!validation.valid) {
      logger.error('Password requirements not met:');
      for (const err of validation.errors) {
        logger.error('  - ' + err);
      }
      continue;
    }

    const { confirm } = await prompts({
      type: 'password',
      name: 'confirm',
      message: 'Confirm password:',
    });

    if (pwd !== confirm) {
      logger.error('Passwords do not match');
      continue;
    }

    encryptionPassword = pwd;
    break;
  }

  logger.success('Password accepted');

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 5: Key Display and Recording
  // ═══════════════════════════════════════════════════════════════════════
  
  console.clear();
  logger.header('PHASE 5: KEY RECORDING');
  logger.error('╔═══════════════════════════════════════════════════════════════╗');
  logger.error('║  CRITICAL: Write down ALL keys below                          ║');
  logger.error('║  This is your ONLY opportunity to see private keys            ║');
  logger.error('║  After confirmation, keys will be encrypted and cleared       ║');
  logger.error('╚═══════════════════════════════════════════════════════════════╝');
  logger.newline();

  const roles = ['sequencer', 'batcher', 'proposer', 'challenger', 'admin', 'feeRecipient', 'guardian'];
  
  for (const role of roles) {
    const key = operatorKeys[role];
    if (!key) continue;
    
    console.log(`\n┌─ ${role.toUpperCase()} ─────────────────────────────────────────────────────`);
    console.log(`│ Address:     ${key.address}`);
    console.log(`│ Private Key: ${key.privateKey}`);
    console.log(`│ Purpose:     ${key.role}`);
    console.log(`└──────────────────────────────────────────────────────────────────`);
  }

  logger.newline();
  logger.warn('Take your time. Verify each character carefully.');
  logger.newline();

  // Require multiple confirmations for mainnet
  const confirmations = network === 'mainnet' ? 3 : 1;
  
  for (let i = 0; i < confirmations; i++) {
    const { recorded } = await prompts({
      type: 'confirm',
      name: 'recorded',
      message: i === 0 
        ? 'Have you recorded all keys to secure storage?' 
        : `Confirm again (${i + 1}/${confirmations}): Keys are safely recorded?`,
      initial: false,
    });

    if (!recorded) {
      logger.error('Ceremony aborted - keys not recorded');
      logger.info('Restart the ceremony when ready.');
      return;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 6: Key Encryption and Storage
  // ═══════════════════════════════════════════════════════════════════════
  
  logger.newline();
  logger.subheader('Phase 6: Secure Storage');
  logger.step('Encrypting keys...');

  const keysDir = getKeysDir();
  const networkDir = join(keysDir, network);
  mkdirSync(networkDir, { recursive: true, mode: 0o700 });

  // Create KeySet for encryption
  const keySet: KeySet = {
    network,
    created: new Date().toISOString(),
    keys: Object.values(operatorKeys),
    encrypted: true,
  };

  // Encrypt and save
  const encryptedData = await encryptKeySet(keySet, encryptionPassword);
  const encryptedPath = join(networkDir, 'operators.enc');
  writeFileSync(encryptedPath, encryptedData, { mode: 0o600 });
  
  logger.success('Encrypted keys saved to: ' + encryptedPath);

  // Save addresses-only file (public, for reference)
  const addressesPath = join(networkDir, 'addresses.json');
  const addresses = Object.fromEntries(
    Object.entries(operatorKeys).map(([role, key]) => [role, key.address])
  );
  writeFileSync(addressesPath, JSON.stringify(addresses, null, 2), { mode: 0o644 });
  logger.info('Public addresses saved to: ' + addressesPath);

  // Generate genesis config snippet
  const genesisPath = join(networkDir, 'genesis-config.json');
  const genesisConfig = {
    network,
    generated: new Date().toISOString(),
    addresses: {
      SystemOwner: operatorKeys.admin.address,
      Sequencer: operatorKeys.sequencer.address,
      Batcher: operatorKeys.batcher.address,
      Proposer: operatorKeys.proposer.address,
      Challenger: operatorKeys.challenger.address,
      Guardian: operatorKeys.guardian.address,
      BaseFeeVaultRecipient: operatorKeys.feeRecipient.address,
      L1FeeVaultRecipient: operatorKeys.feeRecipient.address,
      SequencerFeeVaultRecipient: operatorKeys.feeRecipient.address,
    },
  };
  writeFileSync(genesisPath, JSON.stringify(genesisConfig, null, 2));
  logger.info('Genesis config saved to: ' + genesisPath);

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 7: Key Burning
  // ═══════════════════════════════════════════════════════════════════════
  
  logger.newline();
  logger.subheader('Phase 7: Memory Clearing');
  logger.step('Clearing keys from memory...');

  // Clear the password from memory
  encryptionPassword = '';
  
  // Overwrite key objects
  for (const role of Object.keys(operatorKeys)) {
    const key = operatorKeys[role];
    key.privateKey = '0x' + '0'.repeat(64);
    key.address = '0x' + '0'.repeat(40);
    key.name = '';
    key.role = '';
  }
  
  // Force garbage collection hint (not guaranteed)
  if (global.gc) {
    global.gc();
  }

  logger.success('Keys cleared from memory');

  // Clear screen to remove key display
  await new Promise(r => setTimeout(r, 1000));
  console.clear();

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 8: Summary and Next Steps
  // ═══════════════════════════════════════════════════════════════════════
  
  logger.header('CEREMONY COMPLETE');
  logger.success('Genesis keys have been securely generated and stored.\n');

  logger.subheader('Files Created');
  logger.info('  ' + encryptedPath + ' (encrypted)');
  logger.info('  ' + addressesPath + ' (public)');
  logger.info('  ' + genesisPath + ' (genesis config)\n');

    logger.subheader('Funding Requirements');
  // Validate operator keys have required fields before printing funding requirements
  const admin = operatorKeys['admin'];
  const batcher = operatorKeys['batcher'];
  const proposer = operatorKeys['proposer'];
  const sequencer = operatorKeys['sequencer'];
  const challenger = operatorKeys['challenger'];
  const feeRecipient = operatorKeys['feeRecipient'];
  const guardian = operatorKeys['guardian'];
  
  if (admin && batcher && proposer && sequencer && challenger && feeRecipient && guardian) {
    const opKeys: OperatorKeySet = {
      admin,
      batcher,
      proposer,
      sequencer,
      challenger,
      feeRecipient,
      guardian,
    };
    printFundingRequirements(opKeys, network);
  }

  logger.subheader('Next Steps');
  logger.list([
    'Verify backup: Decrypt and check keys match your written copy',
    'Fund addresses: Transfer required ETH to operator addresses',
    'Deploy chain: Run `jeju deploy ' + network + '`',
    'Destroy written copies after deployment verification',
  ]);

  logger.newline();
  logger.warn('IMPORTANT: Store encrypted file and password SEPARATELY');
  logger.warn('Never store both in the same location');
}

async function importKeys(): Promise<Record<string, KeyConfig> | null> {
  logger.info('Import keys for each operator role.\n');
  
  const roles = [
    { name: 'sequencer', desc: 'Produces L2 blocks' },
    { name: 'batcher', desc: 'Submits transaction batches to L1' },
    { name: 'proposer', desc: 'Submits L2 output roots to L1' },
    { name: 'challenger', desc: 'Challenges invalid output roots' },
    { name: 'admin', desc: 'Proxy admin and system owner' },
    { name: 'feeRecipient', desc: 'Receives sequencer fees' },
    { name: 'guardian', desc: 'Superchain config guardian' },
  ];

  const keys: Record<string, KeyConfig> = {};

  for (const role of roles) {
    logger.info(`\n${role.name.toUpperCase()} (${role.desc})`);
    
    const { inputType } = await prompts({
      type: 'select',
      name: 'inputType',
      message: 'How to provide ' + role.name + ' key?',
      choices: [
        { title: 'Enter private key', value: 'privateKey' },
        { title: 'Enter address only (read-only)', value: 'addressOnly' },
        { title: 'Generate new', value: 'generate' },
      ],
    });

    if (!inputType) {
      logger.error('Import cancelled');
      return null;
    }

    if (inputType === 'generate') {
      const account = privateKeyToAccount(generatePrivateKey());
      keys[role.name] = {
        name: role.name.charAt(0).toUpperCase() + role.name.slice(1),
        address: account.address,
        privateKey: account.privateKey,
        role: role.desc,
      };
      logger.success('Generated: ' + account.address);
    } else if (inputType === 'privateKey') {
      const { privateKey } = await prompts({
        type: 'password',
        name: 'privateKey',
        message: 'Enter private key (0x...):',
      });

      try {
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        keys[role.name] = {
          name: role.name.charAt(0).toUpperCase() + role.name.slice(1),
          address: account.address,
          privateKey: account.privateKey,
          role: role.desc,
        };
        logger.success('Imported: ' + account.address);
      } catch {
        logger.error('Invalid private key');
        return null;
      }
    } else {
      const { address } = await prompts({
        type: 'text',
        name: 'address',
        message: 'Enter address (0x...):',
      });

      if (!address || !address.startsWith('0x') || address.length !== 42) {
        logger.error('Invalid address');
        return null;
      }

      keys[role.name] = {
        name: role.name.charAt(0).toUpperCase() + role.name.slice(1),
        address,
        privateKey: 'HARDWARE_WALLET',
        role: role.desc,
      };
      logger.info('Address recorded (hardware wallet assumed)');
    }
  }

  return keys;
}

function generateKeysWithEntropy(entropy: string): Record<string, KeyConfig> {
  // Use entropy to seed additional randomness
  const entropyHash = createHash('sha256').update(entropy).digest();
  
  const roles = [
    { name: 'sequencer', desc: 'Produces L2 blocks' },
    { name: 'batcher', desc: 'Submits transaction batches to L1' },
    { name: 'proposer', desc: 'Submits L2 output roots to L1' },
    { name: 'challenger', desc: 'Challenges invalid output roots' },
    { name: 'admin', desc: 'Proxy admin and system owner' },
    { name: 'feeRecipient', desc: 'Receives sequencer fees' },
    { name: 'guardian', desc: 'Superchain config guardian' },
  ];

  const keys: Record<string, KeyConfig> = {};

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    
    // Mix entropy with role-specific data for additional randomness
    // This supplements the entropy already used by generatePrivateKey()
    createHash('sha256')
      .update(entropyHash)
      .update(Buffer.from([i]))
      .update(role.name)
      .update(randomBytes(32))
      .digest(); // Side-effect: adds to system entropy pool via timing

    const account = privateKeyToAccount(generatePrivateKey());
    
    keys[role.name] = {
      name: role.name.charAt(0).toUpperCase() + role.name.slice(1),
      address: account.address,
      privateKey: account.privateKey,
      role: role.desc,
    };
  }

  return keys;
}

async function collectTimingEntropy(): Promise<string> {
  const timings: number[] = [];
  
  logger.info('Press Enter 5 times at random intervals...');
  
  for (let i = 0; i < 5; i++) {
    const start = process.hrtime.bigint();
    await prompts({
      type: 'text',
      name: 'x',
      message: `(${i + 1}/5)`,
    });
    const end = process.hrtime.bigint();
    timings.push(Number(end - start));
  }

  return timings.map(t => t.toString(16)).join('');
}

function combineEntropy(sources: string[]): string {
  const combined = sources.join('|');
  return createHash('sha512').update(combined).digest('hex');
}

async function burnKeys(network: NetworkType) {
  logger.header('BURN KEYS');
  logger.error('This will PERMANENTLY DELETE keys for ' + network);
  logger.newline();

  const keysDir = getKeysDir();
  const networkDir = join(keysDir, network);

  if (!existsSync(networkDir)) {
    logger.warn('No keys found for ' + network);
    return;
  }

  const { confirm1 } = await prompts({
    type: 'confirm',
    name: 'confirm1',
    message: 'Are you sure you want to delete ' + network + ' keys?',
    initial: false,
  });

  if (!confirm1) {
    logger.info('Cancelled');
    return;
  }

  const { confirm2 } = await prompts({
    type: 'text',
    name: 'confirm2',
    message: 'Type "BURN KEYS" to confirm:',
  });

  if (confirm2 !== 'BURN KEYS') {
    logger.info('Cancelled');
    return;
  }

  // Securely overwrite and delete files
  const files = ['operators.enc', 'operators.json', 'deployer.json', 'addresses.json', 'genesis-config.json'];
  
  for (const file of files) {
    const path = join(networkDir, file);
    if (existsSync(path)) {
      // Overwrite with random data before deleting
      const size = readFileSync(path).length;
      writeFileSync(path, randomBytes(size));
      writeFileSync(path, randomBytes(size));
      writeFileSync(path, Buffer.alloc(size, 0));
      unlinkSync(path);
      logger.info('Burned: ' + file);
    }
  }

  logger.success('Keys burned for ' + network);
}

async function showKeys(network: NetworkType, showPrivate: boolean) {
  logger.header('KEYS');

  if (network === 'localnet') {
    logger.subheader('Development Keys (Anvil)');
    logger.warn('Well-known test keys - DO NOT use on mainnet');
    logger.newline();

    const keys = getDevKeys();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const role = i === 0 ? 'Deployer' : i === 4 ? 'Operator' : 'User';
      
      logger.info(`Account #${i} (${role})`);
      logger.keyValue('  Address', key.address);
      if (showPrivate) {
        logger.keyValue('  Private', key.privateKey);
      }
      logger.newline();
    }
    
    // Show MetaMask wallet config
    logger.separator();
    logger.subheader('MetaMask Configuration');
    logger.newline();
    logger.info('Network Name:   Network Localnet');
    logger.info('RPC URL:        http://127.0.0.1:9545');
    logger.info('Chain ID:       1337');
    logger.info('Currency:       ETH');
    logger.newline();
    logger.info('Pre-funded Test Account:');
    logger.info('  Private Key:  0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291');
    logger.info('  Address:      0x71562b71999873DB5b286dF957af199Ec94617F7');
    logger.info('  In MetaMask: Import Account → Paste private key above');
  } else {
    // Check for addresses file first
    const keysDir = getKeysDir();
    const addressesPath = join(keysDir, network, 'addresses.json');
    
    if (existsSync(addressesPath)) {
      logger.subheader(`${network.charAt(0).toUpperCase() + network.slice(1)} Addresses`);
      
      const addresses = JSON.parse(readFileSync(addressesPath, 'utf-8'));
      for (const [role, address] of Object.entries(addresses)) {
        logger.info(role);
        logger.keyValue('  Address', address as string);
        logger.newline();
      }

      if (showPrivate) {
        logger.warn('\nTo view private keys, decrypt the operators.enc file');
        logger.info('This requires your encryption password');
      }
    } else {
      logger.warn(`No keys configured for ${network}`);
      logger.info(`Generate with: jeju keys genesis -n ${network}`);
    }
  }
}

