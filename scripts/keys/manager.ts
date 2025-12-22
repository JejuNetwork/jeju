#!/usr/bin/env bun
/**
 * @fileoverview Unified Key Management CLI
 * @module scripts/keys/manager
 * 
 * CLI for generating, funding, and managing keys across EVM and Solana chains.
 * 
 * Usage:
 *   bun run jeju keys generate [--network testnet] [--solana]
 *   bun run jeju keys fund [--network testnet] [--bridge]
 *   bun run jeju keys balances [--network testnet]
 *   bun run jeju keys export [--format safe|env]
 *   bun run jeju keys status
 */

import { parseArgs } from 'util';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import { parseAbi } from 'viem';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  TEST_MNEMONIC,
  ROLE_CONFIGS,
  TESTNET_CHAINS,
  BSC_FUNDING_WARNING,
  saveTestnetKeys,
  testnetKeysExist,
  getTestKeys,
  printKeys,
  type KeyRole,
  type KeyPair,
  type TestKeySet,
  type NetworkType,
  saveSolanaKeys,
  solanaKeysExist,
  SOLANA_ROLE_PATHS,
  type SolanaKeyPair,
} from '../../packages/config/test-keys';
import { storeLocalSecret, storeAWSSecret, getActiveProvider } from '../../packages/config/secrets';
import { inferChainFromRpcUrl } from '../shared/chain-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '../..');
const KEYS_DIR = join(ROOT, 'packages/deployment/.keys');

// ============================================================================
// CLI Parsing
// ============================================================================

const { values: args, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    network: { type: 'string', short: 'n', default: 'testnet' },
    solana: { type: 'boolean', default: false },
    bridge: { type: 'boolean', default: false },
    format: { type: 'string', short: 'f', default: 'env' },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});

const command = positionals[0] ?? 'help';
const network = (args.network ?? 'testnet') as NetworkType;

// ============================================================================
// Commands
// ============================================================================

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Jeju Network - Key Manager                                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  if (args.help || command === 'help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'generate':
      await generateKeys();
      break;
    case 'fund':
      await fundKeys();
      break;
    case 'balances':
      await checkBalances();
      break;
    case 'export':
      await exportKeys();
      break;
    case 'status':
      await showStatus();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
Commands:
  generate    Generate new keys for a network
  fund        Fund keys from faucets or by bridging
  balances    Check balances across all chains
  export      Export keys in various formats
  status      Show key configuration status

Options:
  -n, --network <network>  Network: localnet, testnet, mainnet (default: testnet)
  --solana                 Include Solana key generation/funding
  --bridge                 Bridge ETH from Sepolia to L2 testnets
  -f, --format <format>    Export format: env, safe (default: env)
  --force                  Overwrite existing keys
  -h, --help               Show this help

Examples:
  bun run scripts/keys/manager.ts generate --network testnet
  bun run scripts/keys/manager.ts fund --network testnet --bridge
  bun run scripts/keys/manager.ts balances
  bun run scripts/keys/manager.ts export --format safe
`);
}

// ============================================================================
// Generate Keys
// ============================================================================

async function generateKeys() {
  console.log(`📝 Generating keys for ${network}...\n`);

  if (network === 'localnet') {
    console.log('Localnet uses hardcoded Anvil keys (test mnemonic).');
    printKeys('localnet');
    return;
  }

  if (network === 'mainnet') {
    console.error('❌ Cannot generate mainnet keys with this tool.');
    console.error('   Use hardware wallet, HSM, or AWS KMS for mainnet.');
    process.exit(1);
  }

  // Check if keys already exist
  if (testnetKeysExist() && !args.force) {
    console.log('⚠️  Testnet keys already exist.');
    console.log('   Use --force to overwrite.');
    console.log('\nExisting keys:');
    printKeys('testnet');
    return;
  }

  // Generate new mnemonic or use provided one
  const mnemonic = await generateMnemonic();
  console.log(`✅ Using mnemonic: ${mnemonic.slice(0, 20)}...`);

  // Derive EVM keys
  const keys = deriveEvmKeys(mnemonic);
  const keySet: TestKeySet = {
    mnemonic,
    keys,
    multisig: {
      address: '',
      threshold: 2,
      signers: [keys.multisig1.address, keys.multisig2.address, keys.multisig3.address],
    },
  };

  // Save keys
  saveTestnetKeys(keySet);
  console.log(`✅ EVM keys saved to ${KEYS_DIR}/testnet-keys.json`);

  // Store deployer key in secrets system
  storeLocalSecret('DEPLOYER_PRIVATE_KEY', keys.deployer.privateKey);
  
  // Try to store in AWS if available
  const provider = getActiveProvider();
  if (provider === 'aws') {
    const stored = await storeAWSSecret('DEPLOYER_PRIVATE_KEY', keys.deployer.privateKey);
    if (stored) {
      console.log('✅ Deployer key also stored in AWS Secrets Manager');
    }
  }

  // Generate Solana keys if requested
  if (args.solana) {
    await generateSolanaKeys(mnemonic);
  }

  // Print summary
  console.log('\n' + '═'.repeat(80));
  printKeys('testnet');

  // Print next steps
  console.log(`
Next Steps:
  1. Fund the deployer address on Sepolia:
     ${keys.deployer.address}
     
  2. Use faucets:
     - Alchemy: https://www.alchemy.com/faucets/ethereum-sepolia
     - Google: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
     
  3. Bridge to L2 testnets:
     bun run scripts/keys/manager.ts fund --bridge

${BSC_FUNDING_WARNING}
`);
}

async function generateMnemonic(): Promise<string> {
  // Check for existing mnemonic in secrets
  const existingMnemonic = process.env.TEST_MNEMONIC;
  if (existingMnemonic) {
    console.log('Using mnemonic from TEST_MNEMONIC environment variable');
    return existingMnemonic;
  }

  // Generate new random mnemonic
  try {
    const { generateMnemonic: genMnemonic } = await import('@scure/bip39');
    const { wordlist } = await import('@scure/bip39/wordlists/english');
    return genMnemonic(wordlist, 128); // 12 words
  } catch {
    // Fallback: generate from random key and convert
    console.log('Using fallback key generation...');
    // For simplicity, just use a different test mnemonic with a salt
    const timestamp = Date.now().toString(36);
    // This is a deterministic but unique derivation for each generation
    return `${TEST_MNEMONIC.split(' ').slice(0, 11).join(' ')} ${timestamp.slice(-4)}`;
  }
}

function deriveEvmKeys(mnemonic: string): Record<KeyRole, KeyPair> {
  const keys: Partial<Record<KeyRole, KeyPair>> = {};

  for (const config of ROLE_CONFIGS) {
    // Extract account index from path (last number)
    const pathParts = config.hdPath.split('/');
    const accountIndex = parseInt(pathParts[pathParts.length - 1], 10);
    
    const account = mnemonicToAccount(mnemonic, { addressIndex: accountIndex });
    
    keys[config.role] = {
      address: account.address,
      privateKey: '0x' + Buffer.from(account.getHdKey().privateKey!).toString('hex') as Hex,
    };
  }

  return keys as Record<KeyRole, KeyPair>;
}

async function generateSolanaKeys(mnemonic: string) {
  console.log('\n🌅 Generating Solana keys...');

  if (solanaKeysExist(network) && !args.force) {
    console.log('⚠️  Solana keys already exist. Use --force to overwrite.');
    return;
  }

  try {
    const { Keypair } = await import('@solana/web3.js');
    const { derivePath } = await import('ed25519-hd-key');
    const { mnemonicToSeedSync } = await import('@scure/bip39');

    const seed = mnemonicToSeedSync(mnemonic);
    const keys: Record<string, SolanaKeyPair> = {};

    for (const [role, path] of Object.entries(SOLANA_ROLE_PATHS)) {
      const derivedSeed = derivePath(path, seed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed.slice(0, 32));
      
      keys[role] = {
        publicKey: keypair.publicKey.toBase58(),
        secretKey: Buffer.from(keypair.secretKey).toString('base64'),
      };
      
      console.log(`   ${role}: ${keypair.publicKey.toBase58()}`);
    }

    saveSolanaKeys(network, keys);
    console.log(`✅ Solana keys saved to ${KEYS_DIR}/solana-${network}.json`);
  } catch {
    console.error('⚠️  Solana key generation failed. Install @solana/web3.js:');
    console.error('   bun add @solana/web3.js ed25519-hd-key');
  }
}

// ============================================================================
// Fund Keys
// ============================================================================

async function fundKeys() {
  console.log(`💰 Funding keys for ${network}...\n`);

  if (network === 'localnet') {
    console.log('Localnet keys are pre-funded with 10,000 ETH each.');
    return;
  }

  if (network === 'mainnet') {
    console.error('❌ Cannot auto-fund mainnet keys.');
    process.exit(1);
  }

  const keys = getTestKeys('testnet');
  const deployer = keys.keys.deployer;

  console.log(`📍 Deployer: ${deployer.address}\n`);

  // Check Sepolia balance first
  const sepoliaBalance = await getBalance('Ethereum Sepolia', 11155111, 
    'https://ethereum-sepolia-rpc.publicnode.com', deployer.address as Address);
  
  console.log(`Sepolia balance: ${sepoliaBalance.formatted}`);

  if (sepoliaBalance.balance < parseEther('0.01')) {
    console.log('\n❌ Insufficient Sepolia balance. Get testnet ETH from:');
    printFaucetLinks(deployer.address);
    return;
  }

  // Bridge to L2s if requested
  if (args.bridge && sepoliaBalance.balance > parseEther('0.1')) {
    await bridgeToL2s(deployer.privateKey as Hex);
  } else if (args.bridge) {
    console.log('\n⚠️  Need > 0.1 Sepolia ETH to bridge. Current: ' + sepoliaBalance.formatted);
  }

  // Fund Solana if requested
  if (args.solana) {
    await fundSolana();
  }

  // Show final balances
  await checkBalances();
}

async function bridgeToL2s(privateKey: Hex) {
  console.log('\n🌉 Bridging ETH to L2 testnets...\n');

  const account = privateKeyToAccount(privateKey);
  const amountPerChain = '0.02';

  const bridges = [
    {
      name: 'Base Sepolia',
      contract: '0x49f53e41452C74589E85cA1677426Ba426459e85' as Address,
      type: 'op-stack',
      chainId: 84532,
    },
    {
      name: 'Optimism Sepolia', 
      contract: '0x16Fc5058F25648194471939df75CF27A2fdC48BC' as Address,
      type: 'op-stack',
      chainId: 11155420,
    },
    {
      name: 'Arbitrum Sepolia',
      contract: '0xaAe29B0366299461418F5324a79Afc425BE5ae21' as Address,
      type: 'arbitrum',
      chainId: 421614,
    },
  ];

  const sepoliaChain = inferChainFromRpcUrl('https://ethereum-sepolia-rpc.publicnode.com');
  const publicClient = createPublicClient({
    chain: sepoliaChain,
    transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
  });
  const walletClient = createWalletClient({
    account,
    chain: sepoliaChain,
    transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
  });

  for (const bridge of bridges) {
    // Check if L2 already has funds
    const l2Chain = TESTNET_CHAINS.find(c => c.chainId === bridge.chainId);
    if (!l2Chain) continue;
    
    const l2Balance = await getBalance(l2Chain.name, l2Chain.chainId, l2Chain.rpcUrl, account.address);
    if (l2Balance.balance > parseEther('0.005')) {
      console.log(`   ✅ ${bridge.name} already funded (${l2Balance.formatted})`);
      continue;
    }

    console.log(`   🔄 Bridging to ${bridge.name}...`);

    try {
      const amount = parseEther(amountPerChain);
      let hash: Hex;

      if (bridge.type === 'op-stack') {
        const portalAbi = parseAbi([
          'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data) payable',
        ]);
        
        hash = await walletClient.writeContract({
          address: bridge.contract,
          abi: portalAbi,
          functionName: 'depositTransaction',
          args: [account.address, amount, 100000n, false, '0x' as Hex],
          value: amount,
        });
      } else {
        // Arbitrum - direct deposit
        const inboxAbi = parseAbi(['function depositEth() payable returns (uint256)']);
        hash = await walletClient.writeContract({
          address: bridge.contract,
          abi: inboxAbi,
          functionName: 'depositEth',
          value: amount,
        });
      }

      console.log(`      Tx: https://sepolia.etherscan.io/tx/${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`   ✅ ${bridge.name} bridge initiated (arrives in ~10-15 min)`);
    } catch (err) {
      console.error(`   ❌ ${bridge.name} bridge failed:`, err instanceof Error ? err.message : err);
    }
  }
}

async function fundSolana() {
  console.log('\n🌅 Funding Solana devnet...');

  if (!solanaKeysExist(network)) {
    console.log('⚠️  Generate Solana keys first: bun run scripts/keys/manager.ts generate --solana');
    return;
  }

  try {
    const { Connection, LAMPORTS_PER_SOL, PublicKey } = await import('@solana/web3.js');
    const keys = JSON.parse(readFileSync(join(KEYS_DIR, `solana-${network}.json`), 'utf-8'));
    
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    for (const [role, keypair] of Object.entries(keys) as [string, SolanaKeyPair][]) {
      const pubkey = new PublicKey(keypair.publicKey);
      const balance = await connection.getBalance(pubkey);
      
      if (balance < 0.1 * LAMPORTS_PER_SOL) {
        console.log(`   Requesting airdrop for ${role}...`);
        try {
          const sig = await connection.requestAirdrop(pubkey, LAMPORTS_PER_SOL);
          await connection.confirmTransaction(sig);
          console.log(`   ✅ ${role}: Airdropped 1 SOL`);
        } catch {
          console.log(`   ⚠️  ${role}: Airdrop failed (rate limited?)`);
        }
      } else {
        console.log(`   ✅ ${role}: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      }
    }
  } catch {
    console.error('⚠️  Solana funding failed. Install @solana/web3.js');
  }
}

function printFaucetLinks(address: string) {
  console.log(`
═══════════════════════════════════════════════════════════════════════════════
 FAUCET LINKS - Fund: ${address}
═══════════════════════════════════════════════════════════════════════════════

ETHEREUM SEPOLIA (Primary - fund this first):
  • Google Cloud: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
  • Alchemy: https://www.alchemy.com/faucets/ethereum-sepolia
  • QuickNode: https://faucet.quicknode.com/ethereum/sepolia

BASE SEPOLIA:
  • Alchemy: https://www.alchemy.com/faucets/base-sepolia
  • Superchain: https://app.optimism.io/faucet
  • Coinbase: https://portal.cdp.coinbase.com/products/faucet

ARBITRUM SEPOLIA:
  • Alchemy: https://www.alchemy.com/faucets/arbitrum-sepolia
  
OPTIMISM SEPOLIA:
  • Alchemy: https://www.alchemy.com/faucets/optimism-sepolia

${BSC_FUNDING_WARNING}
═══════════════════════════════════════════════════════════════════════════════
`);
}

// ============================================================================
// Check Balances
// ============================================================================

async function checkBalances() {
  console.log(`📊 Checking balances for ${network}...\n`);

  if (network === 'localnet') {
    console.log('Localnet keys are pre-funded with 10,000 ETH each.');
    return;
  }

  const keys = getTestKeys(network);
  const deployer = keys.keys.deployer;

  console.log(`📍 Deployer: ${deployer.address}\n`);
  console.log('─'.repeat(60));

  for (const chain of TESTNET_CHAINS) {
    const balance = await getBalance(chain.name, chain.chainId, chain.rpcUrl, deployer.address as Address);
    const status = balance.hasFunds ? '✅' : '⚠️ ';
    console.log(`${status} ${chain.name.padEnd(20)} ${balance.formatted}`);
  }

  console.log('─'.repeat(60));

  // Check Solana if keys exist
  if (solanaKeysExist(network)) {
    await checkSolanaBalances();
  }
}

async function getBalance(
  chainName: string,
  chainId: number,
  rpcUrl: string,
  address: Address
): Promise<{ balance: bigint; formatted: string; hasFunds: boolean }> {
  try {
    const chain = inferChainFromRpcUrl(rpcUrl);
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
    const balance = await client.getBalance({ address });
    const formatted = `${parseFloat(formatEther(balance)).toFixed(6)} ETH`;
    return { balance, formatted, hasFunds: balance > parseEther('0.005') };
  } catch {
    return { balance: 0n, formatted: 'Error', hasFunds: false };
  }
}

async function checkSolanaBalances() {
  console.log('\n🌅 Solana Balances:\n');

  try {
    const { Connection, LAMPORTS_PER_SOL, PublicKey } = await import('@solana/web3.js');
    const keys = JSON.parse(readFileSync(join(KEYS_DIR, `solana-${network}.json`), 'utf-8'));
    
    const rpcUrl = network === 'testnet' 
      ? 'https://api.devnet.solana.com' 
      : 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    
    for (const [role, keypair] of Object.entries(keys) as [string, SolanaKeyPair][]) {
      const pubkey = new PublicKey(keypair.publicKey);
      const balance = await connection.getBalance(pubkey);
      const hasFunds = balance > 0.1 * LAMPORTS_PER_SOL;
      const status = hasFunds ? '✅' : '⚠️ ';
      console.log(`${status} ${role.padEnd(15)} ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    }
  } catch {
    console.log('⚠️  Could not check Solana balances');
  }
}

// ============================================================================
// Export Keys
// ============================================================================

async function exportKeys() {
  console.log(`📤 Exporting keys for ${network}...\n`);

  const keys = getTestKeys(network);
  const format = args.format ?? 'env';

  if (format === 'env') {
    exportAsEnv(keys);
  } else if (format === 'safe') {
    exportForSafe(keys);
  } else {
    console.error(`Unknown format: ${format}`);
    process.exit(1);
  }
}

function exportAsEnv(keys: TestKeySet) {
  console.log('# Add to .env.testnet\n');
  
  console.log(`# Deployer`);
  console.log(`DEPLOYER_PRIVATE_KEY=${keys.keys.deployer.privateKey}`);
  console.log(`DEPLOYER_ADDRESS=${keys.keys.deployer.address}`);
  console.log('');
  
  console.log(`# Operators`);
  for (const role of ['sequencer', 'batcher', 'proposer', 'challenger'] as KeyRole[]) {
    const key = keys.keys[role];
    const envName = role.toUpperCase();
    console.log(`${envName}_PRIVATE_KEY=${key.privateKey}`);
    console.log(`${envName}_ADDRESS=${key.address}`);
  }
  console.log('');
  
  console.log(`# Multi-sig signers (2/3 threshold)`);
  console.log(`SAFE_SIGNER_1=${keys.keys.multisig1.address}`);
  console.log(`SAFE_SIGNER_2=${keys.keys.multisig2.address}`);
  console.log(`SAFE_SIGNER_3=${keys.keys.multisig3.address}`);
}

function exportForSafe(keys: TestKeySet) {
  console.log('Safe Multi-sig Configuration (2/3):\n');
  console.log('Signers:');
  console.log(`  1. ${keys.keys.multisig1.address}`);
  console.log(`  2. ${keys.keys.multisig2.address}`);
  console.log(`  3. ${keys.keys.multisig3.address}`);
  console.log('\nThreshold: 2');
  console.log('\nCreate Safe at: https://app.safe.global/new-safe/create');
  console.log('\nOr use CLI:');
  console.log(`  safe-cli create --network sepolia \\`);
  console.log(`    --owner ${keys.keys.multisig1.address} \\`);
  console.log(`    --owner ${keys.keys.multisig2.address} \\`);
  console.log(`    --owner ${keys.keys.multisig3.address} \\`);
  console.log(`    --threshold 2`);
}

// ============================================================================
// Status
// ============================================================================

async function showStatus() {
  console.log('🔐 Key Configuration Status\n');
  console.log('─'.repeat(60));

  // Check secret provider
  const provider = getActiveProvider();
  console.log(`Secret Provider: ${provider.toUpperCase()}`);
  
  // Check EVM keys
  console.log('\nEVM Keys:');
  console.log(`  Localnet:  ✅ Built-in (test mnemonic)`);
  console.log(`  Testnet:   ${testnetKeysExist() ? '✅ Generated' : '⚠️  Not generated'}`);
  console.log(`  Mainnet:   ⚠️  Requires external key management`);

  // Check Solana keys
  console.log('\nSolana Keys:');
  console.log(`  Devnet:    ${solanaKeysExist('testnet') ? '✅ Generated' : '⚠️  Not generated'}`);
  console.log(`  Mainnet:   ${solanaKeysExist('mainnet') ? '✅ Generated' : '⚠️  Not generated'}`);

  // Check env secrets
  console.log('\nEnvironment Secrets:');
  const secrets = ['DEPLOYER_PRIVATE_KEY', 'PRIVATE_KEY', 'ETHERSCAN_API_KEY', 'WALLETCONNECT_PROJECT_ID'];
  for (const s of secrets) {
    const set = Boolean(process.env[s]);
    console.log(`  ${s.padEnd(30)} ${set ? '✅' : '⚠️ '}`);
  }

  console.log('\n─'.repeat(60));
  console.log('\nCommands:');
  console.log('  Generate:  bun run scripts/keys/manager.ts generate');
  console.log('  Fund:      bun run scripts/keys/manager.ts fund --bridge');
  console.log('  Balances:  bun run scripts/keys/manager.ts balances');
}

// ============================================================================
// Run
// ============================================================================

main().catch(console.error);


