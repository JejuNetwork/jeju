/**
 * TEE Genesis Ceremony
 * 
 * Runs inside a dstack TEE (Intel TDX) for maximum security:
 * - Keys are derived from hardware-rooted secrets
 * - Never exist outside the TEE enclave
 * - Attestation proves genuine TEE execution
 * - Encrypted output with user password
 * 
 * Supports:
 * - Phala Network dstack
 * - GCP Confidential VMs (AMD SEV / Intel TDX)
 * - Azure Confidential Computing
 * - Any TDX-enabled platform
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv, scrypt } from 'crypto';
import { promisify } from 'util';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const scryptAsync = promisify(scrypt);

export interface TeeKeyConfig {
  name: string;
  address: string;
  privateKey: string;
  role: string;
  derivationPath: string;
}

export interface TeeAttestation {
  quote: string;
  eventLog: string;
  tcbInfo: Record<string, string>;
  measurementHash: string;
}

export interface TeeCeremonyResult {
  network: string;
  timestamp: string;
  attestation: TeeAttestation;
  encryptedKeys: string; // Base64 encrypted
  publicAddresses: Record<string, string>;
  genesisConfig: Record<string, string>;
}

const OPERATOR_ROLES = [
  { name: 'Sequencer', path: '/jeju/genesis/sequencer', desc: 'Produces L2 blocks' },
  { name: 'Batcher', path: '/jeju/genesis/batcher', desc: 'Submits transaction batches to L1' },
  { name: 'Proposer', path: '/jeju/genesis/proposer', desc: 'Submits L2 output roots to L1' },
  { name: 'Challenger', path: '/jeju/genesis/challenger', desc: 'Challenges invalid output roots' },
  { name: 'Admin', path: '/jeju/genesis/admin', desc: 'Proxy admin and system owner' },
  { name: 'FeeRecipient', path: '/jeju/genesis/fee-recipient', desc: 'Receives sequencer fees' },
  { name: 'Guardian', path: '/jeju/genesis/guardian', desc: 'Superchain config guardian' },
];

// Type for dstack/tappd client (dynamically imported)
// Using permissive types to support both old and new SDK versions
interface TeeClientType {
  // New API (DstackClient 0.5.x)
  getKey?(path: string, purpose: string, algorithm: string): Promise<{ key: Uint8Array }>;
  getQuote?(reportData: Buffer): Promise<{ quote: string; event_log: string }>;
  // Legacy API (TappdClient 0.3.x)  
  deriveKey?(path?: string, subject?: string, altNames?: string[]): Promise<{ asUint8Array: (len?: number) => Uint8Array }>;
  tdxQuote?(reportData: string | Buffer | Uint8Array, hashAlgorithm?: string): Promise<{ quote: string; event_log: string }>;
  info(): Promise<{ app_id: string; instance_id: string; tcb_info: Record<string, unknown> }>;
}

/**
 * Run the genesis ceremony inside a TEE
 * This function should be executed inside a dstack CVM
 */
export async function runTeeCeremony(
  network: 'testnet' | 'mainnet',
  passwordHash: string, // SHA-256 hash of user password (password never sent to TEE)
): Promise<TeeCeremonyResult> {
  // Check for simulator mode first
  if (process.env.DSTACK_SIMULATOR_ENDPOINT) {
    console.log('[TEE-SIM] Running in simulator mode');
    return runSimulatedCeremony(network, passwordHash);
  }
  
  let client: TeeClientType;
  let useNewApi = false;
  
  try {
    // Try to import dstack SDK
    const dstackModule = await import('@phala/dstack-sdk');
    
    // Try new DstackClient first, fall back to TappdClient
    const mod = dstackModule as Record<string, unknown>;
    
    if ('DstackClient' in mod && typeof mod.DstackClient === 'function') {
      const DstackClient = mod.DstackClient as new () => TeeClientType;
      client = new DstackClient();
      useNewApi = true;
    } else if ('TappdClient' in mod && typeof mod.TappdClient === 'function') {
      const TappdClient = mod.TappdClient as new () => TeeClientType;
      client = new TappdClient();
      useNewApi = false;
    } else {
      throw new Error('No compatible client found in @phala/dstack-sdk');
    }
  } catch (error) {
    const err = error as Error;
    
    throw new Error(
      'dstack SDK not available. Install with: bun add @phala/dstack-sdk\n' +
      'Or set DSTACK_SIMULATOR_ENDPOINT for testing.\n' +
      'Original error: ' + err.message
    );
  }

  console.log('[TEE] Genesis ceremony starting...');
  console.log('[TEE] Network:', network);
  console.log('[TEE] Verifying TEE environment...');

  // Get TEE info for attestation
  const info = await client.info();
  console.log('[TEE] App ID:', info.app_id);
  console.log('[TEE] Instance ID:', info.instance_id);

  // Generate operator keys using TEE key derivation
  console.log('[TEE] Deriving operator keys from hardware root...');
  
  const keys: TeeKeyConfig[] = [];
  const addresses: Record<string, string> = {};

  for (const role of OPERATOR_ROLES) {
    // Derive key from TEE's hardware-rooted secret
    const keyPath = `${role.path}/${network}`;
    
    let privateKeyHex: string;
    
    if (useNewApi && client.getKey) {
      // New DstackClient API
      const keyResult = await client.getKey(keyPath, 'ethereum-signing', 'secp256k1');
      privateKeyHex = Buffer.from(keyResult.key).toString('hex');
    } else if (client.deriveKey) {
      // Legacy TappdClient API
      const keyResult = await client.deriveKey(keyPath, role.name);
      privateKeyHex = Buffer.from(keyResult.asUint8Array(32)).toString('hex');
    } else {
      throw new Error('No key derivation method available');
    }
    
    // Convert TEE-derived key to Ethereum account
    const account = privateKeyToAccount(('0x' + privateKeyHex) as `0x${string}`);

    const keyConfig: TeeKeyConfig = {
      name: role.name,
      address: account.address,
      privateKey: account.privateKey,
      role: role.desc,
      derivationPath: keyPath,
    };

    keys.push(keyConfig);
    addresses[role.name.toLowerCase()] = account.address;

    console.log(`[TEE] Derived ${role.name}: ${account.address}`);
  }

  // Generate attestation quote
  console.log('[TEE] Generating attestation quote...');
  
  // Include key addresses in attestation for verification
  const timestamp = new Date().toISOString();
  const measurementData = JSON.stringify({
    network,
    timestamp,
    addresses,
  });
  const measurementHash = createHash('sha256').update(measurementData).digest('hex');
  
  let quote: { quote: string; event_log: string };
  
  if (useNewApi && client.getQuote) {
    // New DstackClient API
    quote = await client.getQuote(Buffer.from(measurementHash, 'hex'));
  } else if (client.tdxQuote) {
    // Legacy TappdClient API
    quote = await client.tdxQuote(Buffer.from(measurementHash, 'hex'), 'raw');
  } else {
    throw new Error('No attestation method available');
  }
  
  console.log('[TEE] Attestation quote generated');

  // Encrypt keys with password-derived key
  console.log('[TEE] Encrypting keys...');
  
  const encryptedBundle = await encryptKeys(keys, passwordHash);
  
  // Clear sensitive data from memory
  for (const key of keys) {
    key.privateKey = '0x' + '0'.repeat(64);
  }

  console.log('[TEE] Keys encrypted and cleared from memory');

  // Build genesis config
  const genesisConfig: Record<string, string> = {
    SystemOwner: addresses.admin,
    Sequencer: addresses.sequencer,
    Batcher: addresses.batcher,
    Proposer: addresses.proposer,
    Challenger: addresses.challenger,
    Guardian: addresses.guardian,
    BaseFeeVaultRecipient: addresses.feerecipient,
    L1FeeVaultRecipient: addresses.feerecipient,
    SequencerFeeVaultRecipient: addresses.feerecipient,
  };

  console.log('[TEE] Genesis ceremony complete');

  return {
    network,
    timestamp,
    attestation: {
      quote: quote.quote,
      eventLog: quote.event_log,
      tcbInfo: info.tcb_info as Record<string, string>,
      measurementHash,
    },
    encryptedKeys: encryptedBundle,
    publicAddresses: addresses,
    genesisConfig,
  };
}

/**
 * Simulated ceremony for testing (NOT FOR PRODUCTION)
 */
async function runSimulatedCeremony(
  network: 'testnet' | 'mainnet',
  passwordHash: string,
): Promise<TeeCeremonyResult> {
  console.log('[TEE-SIM] WARNING: Running simulated ceremony');
  console.log('[TEE-SIM] This is for testing only - NOT FOR PRODUCTION');
  
  const keys: TeeKeyConfig[] = [];
  const addresses: Record<string, string> = {};
  const timestamp = new Date().toISOString();

  for (const role of OPERATOR_ROLES) {
    const account = privateKeyToAccount(generatePrivateKey());
    
    keys.push({
      name: role.name,
      address: account.address,
      privateKey: account.privateKey,
      role: role.desc,
      derivationPath: `${role.path}/${network}`,
    });
    
    addresses[role.name.toLowerCase()] = account.address;
  }

  const measurementData = JSON.stringify({ network, timestamp, addresses });
  const measurementHash = createHash('sha256').update(measurementData).digest('hex');
  
  const encryptedBundle = await encryptKeys(keys, passwordHash);
  
  // Clear keys
  for (const key of keys) {
    key.privateKey = '0x' + '0'.repeat(64);
  }

  return {
    network,
    timestamp,
    attestation: {
      quote: 'SIMULATED_QUOTE_' + randomBytes(32).toString('hex'),
      eventLog: JSON.stringify([{ event: 'simulated', data: 'test' }]),
      tcbInfo: { simulated: 'true' },
      measurementHash,
    },
    encryptedKeys: encryptedBundle,
    publicAddresses: addresses,
    genesisConfig: {
      SystemOwner: addresses.admin,
      Sequencer: addresses.sequencer,
      Batcher: addresses.batcher,
      Proposer: addresses.proposer,
      Challenger: addresses.challenger,
      Guardian: addresses.guardian,
      BaseFeeVaultRecipient: addresses.feerecipient,
      L1FeeVaultRecipient: addresses.feerecipient,
      SequencerFeeVaultRecipient: addresses.feerecipient,
    },
  };
}

/**
 * Encrypt keys with password hash
 */
async function encryptKeys(keys: TeeKeyConfig[], passwordHash: string): Promise<string> {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const encryptionKey = (await scryptAsync(passwordHash, salt, 32)) as Buffer;
  
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const keysJson = JSON.stringify(keys);
  const encrypted = Buffer.concat([
    cipher.update(keysJson, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  
  // Combine: salt + iv + authTag + encrypted
  const bundle = Buffer.concat([salt, iv, authTag, encrypted]);
  
  // Clear key from memory
  encryptionKey.fill(0);
  
  return bundle.toString('base64');
}

/**
 * Verify attestation quote from TEE ceremony
 */
export async function verifyAttestation(result: TeeCeremonyResult): Promise<{
  valid: boolean;
  details: string;
}> {
  // Check for simulated attestation
  if (result.attestation.quote.startsWith('SIMULATED_')) {
    return { 
      valid: false, 
      details: 'SIMULATED attestation - NOT valid for production' 
    };
  }

  if (!result.attestation.quote || result.attestation.quote.length < 100) {
    return { valid: false, details: 'Invalid or missing attestation quote' };
  }

  // Verify measurement hash matches addresses
  const expectedMeasurement = createHash('sha256').update(JSON.stringify({
    network: result.network,
    timestamp: result.timestamp,
    addresses: result.publicAddresses,
  })).digest('hex');

  if (result.attestation.measurementHash !== expectedMeasurement) {
    return { valid: false, details: 'Measurement hash mismatch' };
  }

  return { 
    valid: true, 
    details: 'Attestation verified (full verification requires Intel attestation service)' 
  };
}

/**
 * Decrypt ceremony result with password
 */
export async function decryptCeremonyKeys(
  encryptedKeys: string,
  password: string,
): Promise<TeeKeyConfig[]> {
  const passwordHash = createHash('sha256').update(password).digest('hex');
  const encrypted = Buffer.from(encryptedKeys, 'base64');
  
  const salt = encrypted.subarray(0, 32);
  const iv = encrypted.subarray(32, 48);
  const authTag = encrypted.subarray(48, 64);
  const data = encrypted.subarray(64);
  
  const key = (await scryptAsync(passwordHash, salt, 32)) as Buffer;
  
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);
  
  key.fill(0);
  
  return JSON.parse(decrypted.toString('utf8'));
}

// Docker compose for TEE deployment
export const TEE_COMPOSE_TEMPLATE = `
version: '3'
services:
  genesis-ceremony:
    image: ghcr.io/jejunetwork/genesis-ceremony:latest
    environment:
      - NETWORK=\${NETWORK}
      - PASSWORD_HASH=\${PASSWORD_HASH}
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
    ports:
      - "8080:8080"
`;
