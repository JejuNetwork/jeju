/**
 * Key management utilities
 * 
 * Security features:
 * - AES-256-GCM encryption with scrypt key derivation
 * - Secure random key generation
 * - Memory clearing after use
 */

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { getKeysDir } from './system';
import { logger } from './logger';
import { WELL_KNOWN_KEYS, type KeyConfig, type KeySet, type NetworkType } from '../types';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 32;

export interface OperatorKeySet {
  sequencer: KeyConfig;
  batcher: KeyConfig;
  proposer: KeyConfig;
  challenger: KeyConfig;
  admin: KeyConfig;
  feeRecipient: KeyConfig;
  guardian: KeyConfig;
}

export function getDevKeys(): KeyConfig[] {
  return [...WELL_KNOWN_KEYS.dev];
}

export function getDefaultDeployerKey(network: NetworkType): KeyConfig {
  if (network === 'localnet') {
    return WELL_KNOWN_KEYS.dev[0];
  }
  
  const keysDir = getKeysDir();
  const keyFile = join(keysDir, network, 'deployer.json');
  
  if (existsSync(keyFile)) {
    const data = JSON.parse(readFileSync(keyFile, 'utf-8'));
    return data;
  }
  
  throw new Error(`No deployer key configured for ${network}. Run: jeju keys genesis -n ${network}`);
}

export function resolvePrivateKey(network: NetworkType): string {
  // 1. Environment variable
  if (process.env.PRIVATE_KEY) {
    return process.env.PRIVATE_KEY;
  }
  
  // 2. Network-specific key file
  const keysDir = getKeysDir();
  const keyFile = join(keysDir, network, 'deployer.json');
  if (existsSync(keyFile)) {
    const data = JSON.parse(readFileSync(keyFile, 'utf-8'));
    return data.privateKey;
  }
  
  // 3. Default dev key for localnet
  if (network === 'localnet') {
    return WELL_KNOWN_KEYS.dev[0].privateKey;
  }
  
  throw new Error(`No private key configured for ${network}`);
}

export function generateKey(name: string, role: string): KeyConfig {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    name,
    address: account.address,
    privateKey,
    role,
  };
}

export function generateOperatorKeys(): OperatorKeySet {
  return {
    sequencer: generateKey('Sequencer', 'Produces L2 blocks'),
    batcher: generateKey('Batcher', 'Submits transaction batches to L1'),
    proposer: generateKey('Proposer', 'Submits L2 output roots to L1'),
    challenger: generateKey('Challenger', 'Challenges invalid output roots'),
    admin: generateKey('Admin', 'Proxy admin owner'),
    feeRecipient: generateKey('Fee Recipient', 'Receives sequencer fees'),
    guardian: generateKey('Guardian', 'Superchain config guardian'),
  };
}

/**
 * Encrypt a KeySet using AES-256-GCM with scrypt key derivation
 * 
 * Format: salt (32) + iv (16) + authTag (16) + encrypted
 */
export async function encryptKeySet(keySet: KeySet, password: string): Promise<Buffer> {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  
  // Derive key using scrypt (memory-hard function)
  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = JSON.stringify(keySet);
  
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final(),
  ]);
  
  const authTag = cipher.getAuthTag();
  
  // Clear sensitive data from memory
  key.fill(0);
  
  // Format: salt (32) + iv (16) + authTag (16) + encrypted
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * Decrypt a KeySet
 */
export async function decryptKeySet(encrypted: Buffer, password: string): Promise<KeySet> {
  const salt = encrypted.subarray(0, 32);
  const iv = encrypted.subarray(32, 48);
  const authTag = encrypted.subarray(48, 64);
  const data = encrypted.subarray(64);
  
  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);
  
  // Clear key from memory
  key.fill(0);
  
  return JSON.parse(decrypted.toString('utf8'));
}

export function saveKeys(network: NetworkType, keys: KeyConfig[], encrypt = false): string {
  const keysDir = getKeysDir();
  const networkDir = join(keysDir, network);
  
  if (!existsSync(networkDir)) {
    mkdirSync(networkDir, { recursive: true, mode: 0o700 });
  }
  
  const keySet: KeySet = {
    network,
    created: new Date().toISOString(),
    keys,
    encrypted: encrypt,
  };
  
  const filename = encrypt ? 'operators.json.enc' : 'operators.json';
  const filepath = join(networkDir, filename);
  
  writeFileSync(filepath, JSON.stringify(keySet, null, 2), { mode: 0o600 });
  chmodSync(filepath, 0o600);
  
  // Also save deployer separately for easy access
  const deployer = keys.find(k => k.role?.includes('admin') || k.role?.includes('Admin'));
  if (deployer) {
    const deployerFile = join(networkDir, 'deployer.json');
    writeFileSync(deployerFile, JSON.stringify(deployer, null, 2), { mode: 0o600 });
    chmodSync(deployerFile, 0o600);
  }
  
  return filepath;
}

export function loadKeys(network: NetworkType): KeySet | null {
  const keysDir = getKeysDir();
  const keyFile = join(keysDir, network, 'operators.json');
  
  if (!existsSync(keyFile)) {
    return null;
  }
  
  return JSON.parse(readFileSync(keyFile, 'utf-8')) as KeySet;
}

export function hasKeys(network: NetworkType): boolean {
  const keysDir = getKeysDir();
  return existsSync(join(keysDir, network, 'operators.enc')) ||
         existsSync(join(keysDir, network, 'operators.json')) ||
         existsSync(join(keysDir, network, 'addresses.json'));
}

export function loadPrivateKey(name: string): string | null {
  const keysDir = getKeysDir();
  
  // Check for key file in any network directory
  for (const network of ['localnet', 'testnet', 'mainnet'] as const) {
    const keyFile = join(keysDir, network, `${name}.json`);
    if (existsSync(keyFile)) {
      const data = JSON.parse(readFileSync(keyFile, 'utf-8'));
      return data.privateKey;
    }
  }
  
  // Default to first dev key for deployer in localnet context
  if (name === 'deployer') {
    return WELL_KNOWN_KEYS.dev[0].privateKey;
  }
  
  return null;
}

export function showKeyInfo(key: KeyConfig): void {
  logger.keyValue('Name', key.name);
  logger.keyValue('Address', key.address);
  logger.keyValue('Role', key.role || 'N/A');
}

export function printFundingRequirements(keys: OperatorKeySet, network: NetworkType): void {
  const requirements = [
    { key: keys.admin, amount: network === 'mainnet' ? '1.0 ETH' : '0.5 ETH', purpose: 'L1 contract deployments' },
    { key: keys.batcher, amount: network === 'mainnet' ? '0.5 ETH' : '0.1 ETH', purpose: 'Submitting batches (ongoing)' },
    { key: keys.proposer, amount: network === 'mainnet' ? '0.5 ETH' : '0.1 ETH', purpose: 'Submitting proposals (ongoing)' },
    { key: keys.sequencer, amount: '0.01 ETH', purpose: 'Sequencer operations' },
  ];
  
  for (const req of requirements) {
    if (req.key) {
      logger.info(`  ${req.key.name}: ${req.key.address}`);
      logger.info(`    Required: ${req.amount} (${req.purpose})`);
      logger.newline();
    }
  }
  
  if (network === 'testnet') {
    logger.subheader('Testnet Faucets');
    logger.list([
      'https://sepoliafaucet.com',
      'https://www.alchemy.com/faucets/ethereum-sepolia',
      'https://cloud.google.com/application/web3/faucet/ethereum/sepolia',
    ]);
  }
}

export function generateEntropyString(): string {
  return randomBytes(32).toString('hex');
}

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 16) {
    errors.push('Minimum 16 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Must contain uppercase letters');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Must contain lowercase letters');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Must contain numbers');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Must contain special characters (!@#$%^&*...)');
  }
  
  return { valid: errors.length === 0, errors };
}

