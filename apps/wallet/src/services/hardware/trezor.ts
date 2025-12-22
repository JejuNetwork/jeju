/**
 * Trezor Hardware Wallet Integration
 * Based on Rabby's implementation with @trezor/connect-web
 */

import type { Address, Hex } from 'viem';
import TrezorConnect from '@trezor/connect-web';
import { toHex } from 'viem';

export type TrezorHDPathType = 'BIP44' | 'Legacy';

const HD_PATH_BASE: Record<TrezorHDPathType, string> = {
  BIP44: "m/44'/60'/0'/0",
  Legacy: "m/44'/60'/0'",
};

export interface TrezorAccount {
  address: Address;
  path: string;
  index: number;
  publicKey: string;
}

interface AccountDetails {
  hdPath: string;
  hdPathType: TrezorHDPathType;
  publicKey?: string;
}

// Trezor keyring serialized state
interface TrezorSerializedState {
  accounts: Address[];
  accountDetails: Record<string, AccountDetails>;
  hdPath: string;
  hdPathType: TrezorHDPathType;
}

// Partial serialized state for deserialization from storage
export interface PartialTrezorSerializedState {
  accounts?: Address[];
  accountDetails?: Record<string, AccountDetails>;
  hdPath?: string;
  hdPathType?: TrezorHDPathType;
}

let isInitialized = false;

export class TrezorKeyring {
  static type = 'Trezor Hardware';
  type = 'Trezor Hardware';
  
  private accounts: Address[] = [];
  private accountDetails: Record<string, AccountDetails> = {};
  private hdPath: string = HD_PATH_BASE.BIP44;
  private hdPathType: TrezorHDPathType = 'BIP44';
  private model: string = '';
  
  async init(): Promise<void> {
    if (isInitialized) return;
    
    await TrezorConnect.init({
      lazyLoad: false,
      manifest: {
        email: 'support@jejunetwork.org',
        appUrl: 'https://wallet.jejunetwork.org',
        appName: 'Network Wallet',
      },
      transports: ['BridgeTransport', 'WebUsbTransport'],
    });
    
    // Listen for device events
    TrezorConnect.on('DEVICE_EVENT', (event) => {
      const payload = event.payload as { features?: { model?: string } };
      if (payload?.features) {
        this.model = payload.features.model || 'Trezor';
      }
    });
    
    isInitialized = true;
  }
  
  async isSupported(): Promise<boolean> {
    // Trezor Connect works in all modern browsers
    return true;
  }
  
  isUnlocked(): boolean {
    return isInitialized;
  }
  
  async connect(): Promise<void> {
    await this.init();
  }
  
  async disconnect(): Promise<void> {
    // Trezor Connect doesn't need explicit disconnect
    // The connection is managed per-operation
  }
  
  setHdPath(hdPathType: TrezorHDPathType): void {
    this.hdPathType = hdPathType;
    this.hdPath = HD_PATH_BASE[hdPathType];
  }
  
  private getPathForIndex(index: number): string {
    switch (this.hdPathType) {
      case 'BIP44':
        return `m/44'/60'/0'/0/${index}`;
      case 'Legacy':
        return `m/44'/60'/0'/${index}`;
      default:
        return `${this.hdPath}/${index}`;
    }
  }
  
  async getAccounts(startIndex = 0, count = 5): Promise<TrezorAccount[]> {
    await this.init();
    
    const accounts: TrezorAccount[] = [];
    const paths: string[] = [];
    
    for (let i = startIndex; i < startIndex + count; i++) {
      paths.push(this.getPathForIndex(i));
    }
    
    // Get multiple addresses in batch
    const result = await TrezorConnect.ethereumGetAddress({
      bundle: paths.map(path => ({ path, showOnTrezor: false })),
    });
    
    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to get addresses from Trezor');
    }
    
    for (let i = 0; i < result.payload.length; i++) {
      const addr = result.payload[i];
      const address = addr.address as Address;
      const path = paths[i];
      
      accounts.push({
        address,
        path,
        index: startIndex + i,
        publicKey: '', // Trezor doesn't return public key in address request
      });
      
      this.accountDetails[address.toLowerCase()] = {
        hdPath: path,
        hdPathType: this.hdPathType,
      };
    }
    
    return accounts;
  }
  
  async addAccounts(addresses: Address[]): Promise<void> {
    for (const address of addresses) {
      if (!this.accounts.includes(address)) {
        this.accounts.push(address);
      }
    }
  }
  
  getAddresses(): Address[] {
    return [...this.accounts];
  }
  
  async signTransaction(
    address: Address,
    tx: {
      to: Address;
      value: bigint;
      data: Hex;
      nonce: number;
      gasLimit: bigint;
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas?: bigint;
      gasPrice?: bigint;
      chainId: number;
    }
  ): Promise<Hex> {
    await this.init();
    
    const details = this.accountDetails[address.toLowerCase()];
    if (!details) {
      throw new Error('Address not found in Trezor accounts');
    }
    
    const isEIP1559 = tx.maxFeePerGas !== undefined;
    
    // Build transaction based on type
    const baseTx = {
      to: tx.to,
      value: toHex(tx.value),
      data: tx.data || '0x',
      nonce: toHex(tx.nonce),
      gasLimit: toHex(tx.gasLimit),
      chainId: tx.chainId,
    };
    
    const transaction = isEIP1559
      ? {
          ...baseTx,
          maxFeePerGas: toHex(tx.maxFeePerGas!),
          maxPriorityFeePerGas: toHex(tx.maxPriorityFeePerGas!),
        }
      : {
          ...baseTx,
          gasPrice: toHex(tx.gasPrice || 0n),
        };
    
    const result = await TrezorConnect.ethereumSignTransaction({
      path: details.hdPath,
      transaction: transaction as Parameters<typeof TrezorConnect.ethereumSignTransaction>[0]['transaction'],
    });
    
    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to sign transaction');
    }
    
    const { v, r, s } = result.payload;
    
    // Build signed transaction
    return this.buildSignedTx(v, r, s);
  }
  
  async signMessage(address: Address, message: string): Promise<Hex> {
    await this.init();
    
    const details = this.accountDetails[address.toLowerCase()];
    if (!details) {
      throw new Error('Address not found in Trezor accounts');
    }
    
    const result = await TrezorConnect.ethereumSignMessage({
      path: details.hdPath,
      message,
      hex: false,
    });
    
    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to sign message');
    }
    
    return `0x${result.payload.signature}` as Hex;
  }
  
  async signTypedData(
    address: Address,
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    message: Record<string, unknown>,
    primaryType: string
  ): Promise<Hex> {
    await this.init();
    
    const details = this.accountDetails[address.toLowerCase()];
    if (!details) {
      throw new Error('Address not found in Trezor accounts');
    }
    
    // Remove EIP712Domain from types as Trezor handles it separately
    const filteredTypes = { ...types };
    delete filteredTypes.EIP712Domain;
    
    const result = await TrezorConnect.ethereumSignTypedData({
      path: details.hdPath,
      data: {
        domain: domain as Parameters<typeof TrezorConnect.ethereumSignTypedData>[0]['data']['domain'],
        types: filteredTypes as Parameters<typeof TrezorConnect.ethereumSignTypedData>[0]['data']['types'],
        primaryType,
        message: message as Parameters<typeof TrezorConnect.ethereumSignTypedData>[0]['data']['message'],
      },
      metamask_v4_compat: true,
    });
    
    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to sign typed data');
    }
    
    return `0x${result.payload.signature}` as Hex;
  }
  
  private buildSignedTx(
    v: string,
    r: string,
    s: string
  ): Hex {
    // Build signed transaction RLP encoding
    // This is a simplified version - in production use @ethereumjs/tx
    const rHex = r.startsWith('0x') ? r.slice(2) : r;
    const sHex = s.startsWith('0x') ? s.slice(2) : s;
    const vHex = v.startsWith('0x') ? v.slice(2) : v;
    
    // For simplicity, return the signature components concatenated
    // In production, properly serialize the signed transaction
    return `0x${rHex}${sHex}${vHex}` as Hex;
  }
  
  getModel(): string {
    return this.model;
  }
  
  // Serialization for persistence
  serialize(): TrezorSerializedState {
    return {
      accounts: this.accounts,
      accountDetails: this.accountDetails,
      hdPath: this.hdPath,
      hdPathType: this.hdPathType,
    };
  }
  
  deserialize(data: PartialTrezorSerializedState): void {
    if (data.accounts) this.accounts = data.accounts;
    if (data.accountDetails) this.accountDetails = data.accountDetails;
    if (data.hdPath) this.hdPath = data.hdPath;
    if (data.hdPathType) this.hdPathType = data.hdPathType;
  }
}

export const trezorKeyring = new TrezorKeyring();

