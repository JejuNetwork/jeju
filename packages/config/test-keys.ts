/**
 * @fileoverview Test Key Configuration
 * @module config/test-keys
 * 
 * Manages test keys for local development and testnet deployments.
 * 
 * Key Types:
 * - Localnet: Hardcoded Anvil keys (test mnemonic)
 * - Testnet: Generated from stored mnemonic or fresh
 * - Mainnet: Must use external key management (HSM, AWS KMS, etc.)
 * 
 * @example
 * ```ts
 * import { getTestKeys, getKeyByRole } from '@jejunetwork/config/test-keys';
 * 
 * const keys = getTestKeys('localnet');
 * const deployer = getKeyByRole('deployer', 'localnet');
 * ```
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TestnetKeyFileSchema, type KeyRole, type KeyPair, type NetworkType, type SolanaKeyPair, type TestnetKeyFile } from './schemas';

export type { KeyRole, KeyPair, SolanaKeyPair };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KEYS_DIR = join(__dirname, '../deployment/.keys');

// ============================================================================
// Types
// ============================================================================

export interface RoleConfig {
  role: KeyRole;
  description: string;
  hdPath: string;
}

export interface TestKeySet {
  mnemonic: string;
  keys: Record<KeyRole, KeyPair>;
  multisig?: {
    address: string;
    threshold: number;
    signers: string[];
  };
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Standard test mnemonic - NEVER use on mainnet
 */
export const TEST_MNEMONIC = 'test test test test test test test test test test test junk';

/**
 * Role configurations with derivation paths
 * All keys derive from the same mnemonic using different HD paths
 */
export const ROLE_CONFIGS: RoleConfig[] = [
  { role: 'deployer', description: 'Deploys all contracts', hdPath: "m/44'/60'/0'/0/0" },
  { role: 'sequencer', description: 'Produces L2 blocks', hdPath: "m/44'/60'/0'/0/1" },
  { role: 'batcher', description: 'Submits transaction batches to L1', hdPath: "m/44'/60'/0'/0/2" },
  { role: 'proposer', description: 'Submits L2 output roots to L1', hdPath: "m/44'/60'/0'/0/3" },
  { role: 'challenger', description: 'Challenges invalid output roots', hdPath: "m/44'/60'/0'/0/4" },
  { role: 'admin', description: 'Proxy admin owner', hdPath: "m/44'/60'/0'/0/5" },
  { role: 'guardian', description: 'Superchain config guardian', hdPath: "m/44'/60'/0'/0/6" },
  { role: 'feeRecipient', description: 'Receives sequencer fees', hdPath: "m/44'/60'/0'/0/7" },
  { role: 'xlp', description: 'Cross-chain liquidity provider', hdPath: "m/44'/60'/0'/0/8" },
  { role: 'multisig1', description: 'Multi-sig signer 1', hdPath: "m/44'/60'/0'/0/10" },
  { role: 'multisig2', description: 'Multi-sig signer 2', hdPath: "m/44'/60'/0'/0/11" },
  { role: 'multisig3', description: 'Multi-sig signer 3', hdPath: "m/44'/60'/0'/0/12" },
];

/**
 * Pre-computed Anvil test keys (derived from TEST_MNEMONIC)
 * These are the standard Foundry/Anvil test accounts
 */
export const ANVIL_KEYS: Record<KeyRole, KeyPair> = {
  deployer: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  sequencer: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  batcher: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
  proposer: {
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  },
  challenger: {
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  },
  admin: {
    address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    privateKey: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  },
  guardian: {
    address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
    privateKey: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  },
  feeRecipient: {
    address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
    privateKey: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  },
  xlp: {
    address: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
    privateKey: '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  },
  multisig1: {
    address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
    privateKey: '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
  },
  multisig2: {
    address: '0xBcd4042DE499D14e55001CcbB24a551F3b954096',
    privateKey: '0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897',
  },
  multisig3: {
    address: '0x71bE63f3384f5fb98995898A86B02Fb2426c5788',
    privateKey: '0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82',
  },
};

// ============================================================================
// Key Access
// ============================================================================

/**
 * Get test keys for a network
 */
export function getTestKeys(network: NetworkType): TestKeySet {
  if (network === 'localnet') {
    return {
      mnemonic: TEST_MNEMONIC,
      keys: ANVIL_KEYS,
      multisig: {
        address: '', // Created dynamically
        threshold: 2,
        signers: [
          ANVIL_KEYS.multisig1.address,
          ANVIL_KEYS.multisig2.address,
          ANVIL_KEYS.multisig3.address,
        ],
      },
    };
  }
  
  if (network === 'testnet') {
    return loadTestnetKeys();
  }
  
  throw new Error(
    'Mainnet keys cannot be loaded from test-keys module. ' +
    'Use HSM, AWS KMS, or hardware wallet for mainnet operations.'
  );
}

/**
 * Get a single key by role
 */
export function getKeyByRole(role: KeyRole, network: NetworkType): KeyPair {
  const keys = getTestKeys(network);
  return keys.keys[role];
}

/**
 * Get deployer key (most common operation)
 */
export function getDeployerKey(network: NetworkType): KeyPair {
  return getKeyByRole('deployer', network);
}

/**
 * Get multi-sig signer keys
 */
export function getMultisigSigners(network: NetworkType): KeyPair[] {
  const keys = getTestKeys(network);
  return [
    keys.keys.multisig1,
    keys.keys.multisig2,
    keys.keys.multisig3,
  ];
}

// ============================================================================
// Testnet Key Management
// ============================================================================

function getTestnetKeysPath(): string {
  return join(KEYS_DIR, 'testnet-keys.json');
}

function loadTestnetKeys(): TestKeySet {
  const path = getTestnetKeysPath();
  
  if (!existsSync(path)) {
    throw new Error(
      'Testnet keys not found. Generate them with:\n' +
      '  bun run jeju keys generate --network testnet'
    );
  }
  
  const data = TestnetKeyFileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
  
  return {
    mnemonic: data.mnemonic,
    keys: data.keys,
    multisig: {
      address: '',
      threshold: 2,
      signers: [
        data.keys.multisig1.address,
        data.keys.multisig2.address,
        data.keys.multisig3.address,
      ],
    },
  };
}

/**
 * Check if testnet keys exist
 */
export function testnetKeysExist(): boolean {
  return existsSync(getTestnetKeysPath());
}

/**
 * Save testnet keys (called by key generation script)
 */
export function saveTestnetKeys(keySet: TestKeySet): void {
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  }
  
  const data: TestnetKeyFile = {
    mnemonic: keySet.mnemonic,
    createdAt: new Date().toISOString(),
    keys: keySet.keys,
  };
  
  writeFileSync(getTestnetKeysPath(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ============================================================================
// Solana Keys
// ============================================================================

/**
 * Solana derivation paths (using BIP44 with Solana coin type 501)
 */
export const SOLANA_ROLE_PATHS: Record<string, string> = {
  deployer: "m/44'/501'/0'/0'",
  operator: "m/44'/501'/1'/0'",
  xlp: "m/44'/501'/2'/0'",
};

/**
 * Get Solana keys path
 */
function getSolanaKeysPath(network: NetworkType): string {
  return join(KEYS_DIR, `solana-${network}.json`);
}

/**
 * Check if Solana keys exist
 */
export function solanaKeysExist(network: NetworkType): boolean {
  return existsSync(getSolanaKeysPath(network));
}

/**
 * Load Solana keys
 */
export function loadSolanaKeys(network: NetworkType): Record<string, SolanaKeyPair> {
  const path = getSolanaKeysPath(network);
  
  if (!existsSync(path)) {
    throw new Error(
      `Solana ${network} keys not found. Generate them with:\n` +
      `  bun run jeju keys generate --network ${network} --solana`
    );
  }
  
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Save Solana keys
 */
export function saveSolanaKeys(network: NetworkType, keys: Record<string, SolanaKeyPair>): void {
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  }
  
  writeFileSync(getSolanaKeysPath(network), JSON.stringify(keys, null, 2), { mode: 0o600 });
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Format keys for display (hides most of private key)
 */
export function formatKeyForDisplay(key: KeyPair): string {
  const pk = key.privateKey;
  return `${key.address} (${pk.slice(0, 6)}...${pk.slice(-4)})`;
}

/**
 * Get role description
 */
export function getRoleDescription(role: KeyRole): string {
  const config = ROLE_CONFIGS.find(c => c.role === role);
  return config?.description ?? role;
}

/**
 * Print all keys for a network (with truncated private keys)
 */
export function printKeys(network: NetworkType): void {
  const keys = getTestKeys(network);
  
  console.log(`\n🔑 ${network.toUpperCase()} Keys\n`);
  console.log('─'.repeat(80));
  
  for (const config of ROLE_CONFIGS) {
    const key = keys.keys[config.role];
    console.log(`${config.role.padEnd(15)} ${key.address}`);
    console.log(`${''.padEnd(15)} ${key.privateKey.slice(0, 10)}...${key.privateKey.slice(-6)}`);
    console.log(`${''.padEnd(15)} ${config.description}\n`);
  }
  
  console.log('─'.repeat(80));
  console.log('Multi-sig (2/3):');
  console.log(`  Signers: ${keys.multisig?.signers.join(', ')}`);
  console.log('');
}

// ============================================================================
// Chain-Specific Helpers
// ============================================================================

export interface ChainBalance {
  chainName: string;
  chainId: number;
  address: string;
  balance: string;
  hasFunds: boolean;
}

/**
 * Chains that need funding for testnet operations
 */
export const TESTNET_CHAINS = [
  { name: 'Ethereum Sepolia', chainId: 11155111, rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com' },
  { name: 'Base Sepolia', chainId: 84532, rpcUrl: 'https://sepolia.base.org' },
  { name: 'Arbitrum Sepolia', chainId: 421614, rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc' },
  { name: 'Optimism Sepolia', chainId: 11155420, rpcUrl: 'https://sepolia.optimism.io' },
  { name: 'BSC Testnet', chainId: 97, rpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545' },
  { name: 'Jeju Testnet', chainId: 420690, rpcUrl: 'https://testnet-rpc.jejunetwork.org' },
] as const;

/**
 * BSC funding requirement warning
 */
export const BSC_FUNDING_WARNING = `
⚠️  BSC Testnet Funding
   BSC testnet faucet requires 0.002+ BNB on mainnet for verification.
   Either:
   1. Send 0.002 BNB to the deployer address on BSC mainnet
   2. Use Discord faucet: https://discord.gg/bnbchain
   3. Skip BSC for initial testing
`;
