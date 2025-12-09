/**
 * ENS Registration & Content Hash Management
 *
 * This module handles:
 * 1. ENS name registration on Sepolia testnet
 * 2. Setting contenthash to point to IPFS/Arweave content
 * 3. Verifying ENS resolution
 *
 * For production mainnet, the process is similar but costs real ETH.
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  type Hex,
  http,
  labelhash,
  namehash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Sepolia ENS contracts
const SEPOLIA_ENS = {
  registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address,
  registrar: '0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72' as Address,
  resolver: '0x8FADE66B79cC9f707aB26799354482EB93a5B7dD' as Address,
};

// Mainnet ENS contracts (for reference)
const MAINNET_ENS = {
  registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address,
  registrar: '0x253553366Da8546fC250F225fe3d25d0C782303b' as Address,
  resolver: '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63' as Address,
};

// Contenthash codec prefixes
const CODEC_PREFIXES = {
  ipfs: Uint8Array.from([0xe3, 0x01, 0x01, 0x70, 0x12, 0x20]), // ipfs-ns (CIDv0)
  ipns: Uint8Array.from([0xe5, 0x01, 0x01, 0x70, 0x12, 0x20]), // ipns-ns
  arweave: Uint8Array.from([0x90, 0xb2, 0xc6, 0x05]), // arweave-ns
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface ENSConfig {
  network: 'sepolia' | 'mainnet';
  privateKey: Hex;
  rpcUrl?: string;
}

export interface RegistrationResult {
  success: boolean;
  name: string;
  txHash?: Hex;
  error?: string;
}

export interface ContenthashResult {
  success: boolean;
  name: string;
  contenthash?: string;
  txHash?: Hex;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encode IPFS CID as ENS contenthash
 */
export function encodeIPFSContenthash(cid: string): Hex {
  // Handle CIDv0 (starts with Qm)
  if (cid.startsWith('Qm')) {
    // Decode base58 CID to bytes
    const decoded = base58Decode(cid);
    // Remove multihash prefix (first 2 bytes: 0x12, 0x20 for sha256)
    const hashBytes = decoded.slice(2);

    // Build contenthash: e3 01 01 70 12 20 <hash>
    const contenthash = new Uint8Array(
      CODEC_PREFIXES.ipfs.length + hashBytes.length
    );
    contenthash.set(CODEC_PREFIXES.ipfs);
    contenthash.set(hashBytes, CODEC_PREFIXES.ipfs.length);

    return ('0x' + Buffer.from(contenthash).toString('hex')) as Hex;
  }

  // Handle CIDv1 (starts with bafy)
  if (cid.startsWith('bafy')) {
    // CIDv1 needs different encoding
    // For simplicity, convert to CIDv0 if possible, or handle directly
    throw new Error(
      'CIDv1 encoding not yet implemented - use CIDv0 (Qm...) format'
    );
  }

  throw new Error(`Unknown CID format: ${cid}`);
}

/**
 * Encode Arweave TX ID as ENS contenthash
 */
export function encodeArweaveContenthash(txId: string): Hex {
  const txBytes = Buffer.from(txId, 'base64url');
  const contenthash = new Uint8Array(
    CODEC_PREFIXES.arweave.length + txBytes.length
  );
  contenthash.set(CODEC_PREFIXES.arweave);
  contenthash.set(txBytes, CODEC_PREFIXES.arweave.length);

  return ('0x' + Buffer.from(contenthash).toString('hex')) as Hex;
}

/**
 * Base58 decode (simplified for Qm... CIDs)
 */
function base58Decode(input: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ALPHABET_MAP = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP.set(ALPHABET[i]!, i);
  }

  const bytes = [0];
  for (const char of input) {
    const value = ALPHABET_MAP.get(char);
    if (value === undefined)
      throw new Error(`Invalid base58 character: ${char}`);

    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Handle leading zeros
  for (const char of input) {
    if (char !== '1') break;
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

// ═══════════════════════════════════════════════════════════════════════════
// ENS CLIENT
// ═══════════════════════════════════════════════════════════════════════════

export class ENSRegistrar {
  private publicClient;
  private walletClient;
  private contracts;
  private account;

  constructor(config: ENSConfig) {
    const chain = config.network === 'mainnet' ? mainnet : sepolia;
    const rpcUrl =
      config.rpcUrl ??
      (config.network === 'mainnet'
        ? 'https://eth.llamarpc.com'
        : 'https://ethereum-sepolia.publicnode.com');

    this.contracts = config.network === 'mainnet' ? MAINNET_ENS : SEPOLIA_ENS;
    this.account = privateKeyToAccount(config.privateKey);

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(rpcUrl),
    });
  }

  /**
   * Check if a name is available for registration
   */
  async isNameAvailable(name: string): Promise<boolean> {
    const label = name.replace('.eth', '');
    const labelHash = labelhash(label);

    // Call registrar.available(labelHash)
    const data = encodeFunctionData({
      abi: [
        {
          name: 'available',
          type: 'function',
          inputs: [{ name: 'id', type: 'uint256' }],
          outputs: [{ name: '', type: 'bool' }],
        },
      ],
      functionName: 'available',
      args: [BigInt(labelHash)],
    });

    const result = await this.publicClient.call({
      to: this.contracts.registrar,
      data,
    });

    // Decode boolean result
    return (
      result.data ===
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    );
  }

  /**
   * Get registration price for a name
   */
  async getRegistrationPrice(
    name: string,
    durationYears: number = 1
  ): Promise<bigint> {
    const label = name.replace('.eth', '');
    const duration = BigInt(durationYears * 365 * 24 * 60 * 60); // seconds

    const data = encodeFunctionData({
      abi: [
        {
          name: 'rentPrice',
          type: 'function',
          inputs: [
            { name: 'name', type: 'string' },
            { name: 'duration', type: 'uint256' },
          ],
          outputs: [
            { name: 'base', type: 'uint256' },
            { name: 'premium', type: 'uint256' },
          ],
        },
      ],
      functionName: 'rentPrice',
      args: [label, duration],
    });

    const result = await this.publicClient.call({
      to: this.contracts.registrar,
      data,
    });

    // Decode tuple (base, premium) and return total
    if (!result.data) return BigInt(0);
    const base = BigInt('0x' + result.data.slice(2, 66));
    const premium = BigInt('0x' + result.data.slice(66, 130));
    return base + premium;
  }

  /**
   * Get current owner of a name
   */
  async getOwner(name: string): Promise<Address | null> {
    const node = namehash(name.endsWith('.eth') ? name : `${name}.eth`);

    const data = encodeFunctionData({
      abi: [
        {
          name: 'owner',
          type: 'function',
          inputs: [{ name: 'node', type: 'bytes32' }],
          outputs: [{ name: '', type: 'address' }],
        },
      ],
      functionName: 'owner',
      args: [node as Hex],
    });

    const result = await this.publicClient.call({
      to: this.contracts.registry,
      data,
    });

    if (!result.data) return null;
    const address = ('0x' + result.data.slice(26)) as Address;
    return address === '0x0000000000000000000000000000000000000000'
      ? null
      : address;
  }

  /**
   * Get current contenthash for a name
   */
  async getContenthash(name: string): Promise<Hex | null> {
    const node = namehash(name.endsWith('.eth') ? name : `${name}.eth`);

    const data = encodeFunctionData({
      abi: [
        {
          name: 'contenthash',
          type: 'function',
          inputs: [{ name: 'node', type: 'bytes32' }],
          outputs: [{ name: '', type: 'bytes' }],
        },
      ],
      functionName: 'contenthash',
      args: [node as Hex],
    });

    const result = await this.publicClient.call({
      to: this.contracts.resolver,
      data,
    });

    if (!result.data || result.data === '0x') return null;
    // Decode bytes from ABI encoding
    const _offset = parseInt(result.data.slice(2, 66), 16);
    void _offset; // offset is part of ABI encoding but not needed for extraction
    const length = parseInt(result.data.slice(66, 130), 16);
    if (length === 0) return null;
    return ('0x' + result.data.slice(130, 130 + length * 2)) as Hex;
  }

  /**
   * Set contenthash for a name you own
   */
  async setContenthash(
    name: string,
    contenthash: Hex
  ): Promise<ContenthashResult> {
    const fullName = name.endsWith('.eth') ? name : `${name}.eth`;
    const node = namehash(fullName);

    // Check ownership
    const owner = await this.getOwner(name);
    if (owner?.toLowerCase() !== this.account.address.toLowerCase()) {
      return {
        success: false,
        name: fullName,
        error: `Not owner of ${fullName}. Owner is ${owner}`,
      };
    }

    // Encode setContenthash call
    const data = encodeFunctionData({
      abi: [
        {
          name: 'setContenthash',
          type: 'function',
          inputs: [
            { name: 'node', type: 'bytes32' },
            { name: 'hash', type: 'bytes' },
          ],
          outputs: [],
        },
      ],
      functionName: 'setContenthash',
      args: [node as Hex, contenthash],
    });

    // Send transaction
    const txHash = await this.walletClient.sendTransaction({
      to: this.contracts.resolver,
      data,
    });

    // Wait for confirmation
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      success: true,
      name: fullName,
      contenthash,
      txHash,
    };
  }

  /**
   * Set contenthash to point to IPFS CID
   */
  async setIPFSContenthash(
    name: string,
    cid: string
  ): Promise<ContenthashResult> {
    const contenthash = encodeIPFSContenthash(cid);
    return this.setContenthash(name, contenthash);
  }

  /**
   * Verify ENS resolution via .eth.limo gateway
   */
  async verifyResolution(name: string): Promise<{
    resolves: boolean;
    url: string;
    contenthash: Hex | null;
    error?: string;
  }> {
    const fullName = name.endsWith('.eth') ? name : `${name}.eth`;
    const contenthash = await this.getContenthash(name);
    const url = `https://${fullName.replace('.eth', '')}.eth.limo`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return {
      resolves: response.ok,
      url,
      contenthash,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`
ENS Registrar CLI

Commands:
  check <name>              Check if name is available
  owner <name>              Get current owner
  contenthash <name>        Get current contenthash
  set-ipfs <name> <cid>     Set contenthash to IPFS CID
  verify <name>             Verify resolution via .eth.limo

Environment:
  PRIVATE_KEY              Required for write operations
  ENS_NETWORK              'sepolia' or 'mainnet' (default: sepolia)

Example:
  bun run ens-registrar.ts check jeju-compute
  bun run ens-registrar.ts set-ipfs jeju-compute QmXxx... 
    `);
    return;
  }

  const name = args[1];
  if (!name && command !== 'help') {
    console.error('Name required');
    process.exit(1);
  }

  const privateKey = process.env.PRIVATE_KEY as Hex;
  const network = (process.env.ENS_NETWORK ?? 'sepolia') as
    | 'sepolia'
    | 'mainnet';

  // Read-only commands don't need private key
  const needsKey = ['set-ipfs', 'set-arweave'].includes(command);

  if (needsKey && !privateKey) {
    console.error(
      'PRIVATE_KEY environment variable required for write operations'
    );
    process.exit(1);
  }

  const registrar = new ENSRegistrar({
    network,
    privateKey:
      privateKey ??
      '0x0000000000000000000000000000000000000000000000000000000000000001',
  });

  switch (command) {
    case 'check': {
      const available = await registrar.isNameAvailable(name!);
      const price = await registrar.getRegistrationPrice(name!);
      console.log(`Name: ${name}.eth`);
      console.log(`Available: ${available}`);
      console.log(`Price (1 year): ${Number(price) / 1e18} ETH`);
      break;
    }

    case 'owner': {
      const owner = await registrar.getOwner(name!);
      console.log(`Name: ${name}.eth`);
      console.log(`Owner: ${owner ?? 'Not registered'}`);
      break;
    }

    case 'contenthash': {
      const hash = await registrar.getContenthash(name!);
      console.log(`Name: ${name}.eth`);
      console.log(`Contenthash: ${hash ?? 'Not set'}`);
      break;
    }

    case 'set-ipfs': {
      const cid = args[2];
      if (!cid) {
        console.error('CID required');
        process.exit(1);
      }
      console.log(`Setting ${name}.eth -> ipfs://${cid}`);
      const result = await registrar.setIPFSContenthash(name!, cid);
      console.log(result);
      break;
    }

    case 'verify': {
      const result = await registrar.verifyResolution(name!);
      console.log(`Name: ${name}.eth`);
      console.log(`URL: ${result.url}`);
      console.log(`Resolves: ${result.resolves}`);
      console.log(`Contenthash: ${result.contenthash ?? 'Not set'}`);
      if (result.error) console.log(`Error: ${result.error}`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
