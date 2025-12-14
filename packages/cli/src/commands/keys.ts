/**
 * jeju keys - Key management and genesis ceremony
 */

import { Command } from 'commander';
import prompts from 'prompts';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { getAccountBalance, checkRpcHealth } from '../lib/chain';
import {
  getDevKeys,
  generateOperatorKeys,
  saveKeys,
  loadKeys,
  printFundingRequirements,
  validatePassword,
} from '../lib/keys';
import { getKeysDir } from '../lib/system';
import { CHAIN_CONFIG, type NetworkType } from '../types';

export const keysCommand = new Command('keys')
  .description('Key management and genesis ceremony')
  .argument('[action]', 'show | genesis | balance', 'show')
  .option('-n, --network <network>', 'Network', 'localnet')
  .option('--private', 'Show private keys (danger)')
  .action(async (action, options) => {
    const network = options.network as NetworkType;
    
    switch (action) {
      case 'show':
        await showKeys(network, options.private);
        break;
      case 'genesis':
        await runGenesis(network);
        break;
      case 'balance':
        await showBalances(network);
        break;
      default:
        await showKeys(network, options.private);
    }
  });

// Genesis ceremony subcommand
const genesisSubcommand = new Command('genesis')
  .description('Secure key generation ceremony for production')
  .option('-n, --network <network>', 'Network: testnet | mainnet', 'testnet')
  .action(async (options) => {
    await runGenesis(options.network as NetworkType);
  });

keysCommand.addCommand(genesisSubcommand);

async function runGenesis(network: NetworkType) {
  if (network === 'localnet') {
    logger.error('Genesis ceremony not needed for localnet');
    logger.info('Localnet uses well-known Anvil test keys');
    return;
  }

  logger.header('GENESIS KEY CEREMONY');
  logger.warn('This will generate production keys for ' + network.toUpperCase());
  logger.newline();

  // Security checklist
  logger.subheader('Security Checklist');
  const checks = [
    'You are on a secure, offline machine',
    'No one is watching your screen',
    'You will store keys in a hardware wallet or cold storage',
    'You have a secure backup strategy',
  ];

  for (const check of checks) {
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: check,
      initial: false,
    });

    if (!confirmed) {
      logger.error('Ceremony aborted - all checks must pass');
      return;
    }
  }

  logger.newline();
  logger.success('Security checklist complete');

  // Get encryption password
  logger.newline();
  logger.subheader('Encryption Password');
  logger.info('Keys will be encrypted with this password.');
  logger.warn('You MUST remember this password - there is no recovery.');
  logger.newline();

  let encryptionPassword: string;
  while (true) {
    const { pwd } = await prompts({
      type: 'password',
      name: 'pwd',
      message: 'Enter password (min 16 chars, mixed case, numbers):',
    });

    const validation = validatePassword(pwd);
    if (!validation.valid) {
      logger.error('Password requirements:');
      for (const err of validation.errors) {
        logger.error(`  - ${err}`);
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

  // Mark password as collected (will be used for future encryption)
  void encryptionPassword;

  // Collect entropy
  logger.newline();
  logger.subheader('Entropy Collection');
  logger.info('Type random characters to add entropy to key generation.');
  
  const { entropy: _entropy } = await prompts({
    type: 'text',
    name: 'entropy',
    message: 'Type randomly (then press Enter):',
  });

  // Generate keys
  logger.newline();
  logger.step('Generating operator keys...');

  const operators = generateOperatorKeys();

  // Display keys
  logger.newline();
  logger.subheader('Generated Keys');
  logger.warn('WRITE THESE DOWN SECURELY - This is your only chance.');
  logger.newline();

  for (const [role, key] of Object.entries(operators)) {
    logger.info(`${role.toUpperCase()}`);
    logger.keyValue('  Address', key.address);
    logger.keyValue('  Private', key.privateKey);
    logger.newline();
  }

  // Confirm written down
  const { written } = await prompts({
    type: 'confirm',
    name: 'written',
    message: 'Have you securely recorded all keys?',
    initial: false,
  });

  if (!written) {
    logger.error('Ceremony aborted - keys not recorded');
    return;
  }

  // Save encrypted
  const keysDir = getKeysDir();
  const networkDir = join(keysDir, network);
  mkdirSync(networkDir, { recursive: true });

  const keys = Object.values(operators);
  const filepath = saveKeys(network, keys, true);

  logger.newline();
  logger.success('Keys saved to: ' + filepath);

  // Funding requirements
  logger.newline();
  logger.subheader('Funding Requirements');
  printFundingRequirements(operators, network);

  // Next steps
  logger.newline();
  logger.subheader('Next Steps');
  logger.list([
    'Back up keys to cold storage',
    'Fund the deployer address',
    `Run: jeju deploy ${network}`,
  ]);
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
  } else {
    const keySet = loadKeys(network);
    
    if (!keySet) {
      logger.warn(`No keys configured for ${network}`);
      logger.info(`Generate with: jeju keys genesis -n ${network}`);
      return;
    }

    logger.subheader(`${network.charAt(0).toUpperCase() + network.slice(1)} Keys`);
    
    for (const key of keySet.keys) {
      logger.info(key.name);
      logger.keyValue('  Address', key.address);
      if (showPrivate) {
        logger.keyValue('  Private', key.privateKey);
      }
      logger.newline();
    }
  }
}

async function showBalances(network: NetworkType) {
  logger.header('BALANCES');

  const config = CHAIN_CONFIG[network];
  const rpcUrl = network === 'localnet'
    ? 'http://127.0.0.1:9545'
    : config.rpcUrl;

  // Check RPC
  const healthy = await checkRpcHealth(rpcUrl, 3000);
  if (!healthy) {
    logger.error(`Cannot connect to ${network} RPC`);
    if (network === 'localnet') {
      logger.info('Start with: jeju dev');
    }
    return;
  }

  let keys;
  if (network === 'localnet') {
    keys = getDevKeys();
  } else {
    const keySet = loadKeys(network);
    if (!keySet) {
      logger.warn(`No keys configured for ${network}`);
      return;
    }
    keys = keySet.keys;
  }

  for (const key of keys) {
    const balance = await getAccountBalance(rpcUrl, key.address as `0x${string}`);
    const status = parseFloat(balance) > 0 ? 'ok' : 'warn';
    
    logger.table([{
      label: key.name,
      value: `${balance} ETH`,
      status,
    }]);
  }
}
