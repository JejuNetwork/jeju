/**
 * Node Authentication - Private Key Management for Jeju Nodes
 * 
 * Simple, secure key management for node operators:
 * - Auto-generate key on first run (zero config)
 * - Import existing key via environment variable
 * - Secure storage with file permissions
 */

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';

export interface NodeIdentity {
  address: Address;
  privateKey: Hex;
  source: 'env' | 'file' | 'generated';
}

export interface NodeAuthConfig {
  keyPath?: string;
  envVar?: string;
  autoGenerate?: boolean;
  logToConsole?: boolean;
}

const DEFAULT_KEY_PATH = '.jeju/node-key';
const DEFAULT_ENV_VAR = 'NODE_PRIVATE_KEY';

export class NodeAuth {
  private identity: NodeIdentity | null = null;
  private config: Required<NodeAuthConfig>;

  constructor(config: NodeAuthConfig = {}) {
    this.config = {
      keyPath: config.keyPath ?? join(process.env.HOME ?? '.', DEFAULT_KEY_PATH),
      envVar: config.envVar ?? DEFAULT_ENV_VAR,
      autoGenerate: config.autoGenerate ?? true,
      logToConsole: config.logToConsole ?? true,
    };
  }

  /**
   * Get node identity. Tries in order:
   * 1. Environment variable
   * 2. Key file
   * 3. Generate new (if autoGenerate enabled)
   */
  async getIdentity(): Promise<NodeIdentity> {
    if (this.identity) return this.identity;

    // 1. Try environment variable
    const envKey = process.env[this.config.envVar];
    if (envKey) {
      this.identity = this.loadFromKey(envKey as Hex, 'env');
      this.log(`Loaded key from ${this.config.envVar} environment variable`);
      return this.identity;
    }

    // 2. Try key file
    if (existsSync(this.config.keyPath)) {
      const fileKey = readFileSync(this.config.keyPath, 'utf-8').trim();
      this.identity = this.loadFromKey(fileKey as Hex, 'file');
      this.log(`Loaded key from ${this.config.keyPath}`);
      return this.identity;
    }

    // 3. Generate new key
    if (this.config.autoGenerate) {
      const privateKey = generatePrivateKey();
      this.saveKeyToFile(privateKey);
      this.identity = this.loadFromKey(privateKey, 'generated');
      this.log(`Generated new node key: ${this.identity.address}`);
      this.log(`Key saved to ${this.config.keyPath}`);
      return this.identity;
    }

    throw new Error(
      `No node key found. Set ${this.config.envVar} environment variable or provide a key file at ${this.config.keyPath}`
    );
  }

  /**
   * Get just the address (faster, doesn't require loading full identity)
   */
  async getAddress(): Promise<Address> {
    const identity = await this.getIdentity();
    return identity.address;
  }

  /**
   * Import a key and save to file
   */
  async importKey(privateKey: Hex): Promise<NodeIdentity> {
    this.saveKeyToFile(privateKey);
    this.identity = this.loadFromKey(privateKey, 'file');
    this.log(`Imported key: ${this.identity.address}`);
    return this.identity;
  }

  /**
   * Generate a new key (replaces existing)
   */
  async generateKey(): Promise<NodeIdentity> {
    const privateKey = generatePrivateKey();
    this.saveKeyToFile(privateKey);
    this.identity = this.loadFromKey(privateKey, 'generated');
    this.log(`Generated new key: ${this.identity.address}`);
    return this.identity;
  }

  /**
   * Sign a message with the node key
   */
  async signMessage(message: string | Uint8Array): Promise<Hex> {
    const identity = await this.getIdentity();
    const account = privateKeyToAccount(identity.privateKey);
    return account.signMessage({ 
      message: typeof message === 'string' ? message : { raw: message }
    });
  }

  /**
   * Check if a key exists (env, file, or needs generation)
   */
  hasKey(): boolean {
    return !!(
      process.env[this.config.envVar] ||
      existsSync(this.config.keyPath)
    );
  }

  private loadFromKey(privateKey: Hex, source: NodeIdentity['source']): NodeIdentity {
    const normalized = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}` as Hex;
    const account = privateKeyToAccount(normalized);
    return {
      address: account.address,
      privateKey: normalized,
      source,
    };
  }

  private saveKeyToFile(privateKey: Hex): void {
    const dir = this.config.keyPath.split('/').slice(0, -1).join('/');
    if (dir && !existsSync(dir)) {
      const mkdirp = (p: string) => {
        if (!existsSync(p)) {
          mkdirp(p.split('/').slice(0, -1).join('/'));
          require('fs').mkdirSync(p);
        }
      };
      mkdirp(dir);
    }
    
    writeFileSync(this.config.keyPath, privateKey, 'utf-8');
    // Restrict permissions to owner only (600)
    chmodSync(this.config.keyPath, 0o600);
  }

  private log(message: string): void {
    if (this.config.logToConsole) {
      console.log(`[NodeAuth] ${message}`);
    }
  }
}

// Singleton instance for simple usage
let defaultNodeAuth: NodeAuth | null = null;

export function getNodeAuth(config?: NodeAuthConfig): NodeAuth {
  if (!defaultNodeAuth) {
    defaultNodeAuth = new NodeAuth(config);
  }
  return defaultNodeAuth;
}

export function resetNodeAuth(): void {
  defaultNodeAuth = null;
}

/**
 * Quick helper to get node address
 */
export async function getNodeAddress(): Promise<Address> {
  return getNodeAuth().getAddress();
}

/**
 * Quick helper to sign with node key
 */
export async function nodeSign(message: string | Uint8Array): Promise<Hex> {
  return getNodeAuth().signMessage(message);
}

/**
 * CLI-style initialization that prints helpful info
 */
export async function initializeNode(config?: NodeAuthConfig): Promise<NodeIdentity> {
  const auth = config ? new NodeAuth(config) : getNodeAuth();
  const identity = await auth.getIdentity();
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     JEJU NODE IDENTITY                       ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║ Address: ${identity.address}      ║`);
  console.log(`║ Source:  ${identity.source.padEnd(52)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  if (identity.source === 'generated') {
    console.log('⚠️  A new key was generated. Back up your key file or set NODE_PRIVATE_KEY.');
  }
  
  return identity;
}

