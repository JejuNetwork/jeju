/**
 * Ledger Hardware Wallet Integration
 * Based on Rabby's implementation with @ledgerhq/hw-app-eth
 */

import type { Address, Hex } from 'viem';
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import type Transport from '@ledgerhq/hw-transport';
import LedgerEth from '@ledgerhq/hw-app-eth';
import { toHex } from 'viem';
import { TypedDataUtils, SignTypedDataVersion } from '@metamask/eth-sig-util';

export type LedgerHDPathType = 'LedgerLive' | 'BIP44' | 'Legacy';

const HD_PATH_BASE: Record<LedgerHDPathType, string> = {
  LedgerLive: "m/44'/60'/0'/0/0",
  BIP44: "m/44'/60'/0'/0",
  Legacy: "m/44'/60'/0'",
};

export interface LedgerAccount {
  address: Address;
  path: string;
  index: number;
  publicKey: string;
}

interface AccountDetails {
  hdPath: string;
  hdPathType: LedgerHDPathType;
  publicKey?: string;
}

// Ledger keyring serialized state
interface LedgerSerializedState {
  accounts: Address[];
  accountDetails: Record<string, AccountDetails>;
  hdPath: string;
  hdPathType: LedgerHDPathType;
}

// Partial serialized state for deserialization from storage
export interface PartialLedgerSerializedState {
  accounts?: Address[];
  accountDetails?: Record<string, AccountDetails>;
  hdPath?: string;
  hdPathType?: LedgerHDPathType;
}

// Ledger error with status text
interface LedgerError extends Error {
  statusText?: string;
}

export class LedgerKeyring {
  static type = 'Ledger Hardware';
  type = 'Ledger Hardware';
  
  private transport: Transport | null = null;
  private app: LedgerEth | null = null;
  private accounts: Address[] = [];
  private accountDetails: Record<string, AccountDetails> = {};
  private hdPath: string = HD_PATH_BASE.Legacy;
  private hdPathType: LedgerHDPathType = 'Legacy';
  
  async isSupported(): Promise<boolean> {
    return TransportWebHID.isSupported();
  }
  
  isUnlocked(): boolean {
    return this.app !== null;
  }
  
  async connect(): Promise<void> {
    if (this.transport) {
      await this.disconnect();
    }
    
    this.transport = await TransportWebHID.create();
    this.app = new LedgerEth(this.transport);
  }
  
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
      this.app = null;
    }
  }
  
  setHdPath(hdPathType: LedgerHDPathType): void {
    this.hdPathType = hdPathType;
    this.hdPath = HD_PATH_BASE[hdPathType];
  }
  
  private getPathForIndex(index: number): string {
    switch (this.hdPathType) {
      case 'LedgerLive':
        return `m/44'/60'/${index}'/0/0`;
      case 'BIP44':
        return `m/44'/60'/0'/0/${index}`;
      case 'Legacy':
        return `m/44'/60'/0'/${index}`;
      default:
        return `${this.hdPath}/${index}`;
    }
  }
  
  async getAccounts(startIndex = 0, count = 5): Promise<LedgerAccount[]> {
    if (!this.app) {
      throw new Error('Ledger not connected');
    }
    
    const accounts: LedgerAccount[] = [];
    
    for (let i = startIndex; i < startIndex + count; i++) {
      const path = this.getPathForIndex(i);
      const result = await this.app.getAddress(path, false, true);
      
      const address = result.address as Address;
      accounts.push({
        address,
        path,
        index: i,
        publicKey: result.publicKey,
      });
      
      // Store account details
      this.accountDetails[address.toLowerCase()] = {
        hdPath: path,
        hdPathType: this.hdPathType,
        publicKey: result.publicKey,
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
    if (!this.app) {
      throw new Error('Ledger not connected');
    }
    
    const details = this.accountDetails[address.toLowerCase()];
    if (!details) {
      throw new Error('Address not found in Ledger accounts');
    }
    
    // Determine if EIP-1559 transaction
    const isEIP1559 = tx.maxFeePerGas !== undefined;
    
    // Build raw transaction for signing
    let rawTxHex: string;
    
    if (isEIP1559) {
      // EIP-1559 transaction
      const txData = {
        to: tx.to,
        value: toHex(tx.value),
        data: tx.data,
        nonce: toHex(tx.nonce),
        gasLimit: toHex(tx.gasLimit),
        maxFeePerGas: toHex(tx.maxFeePerGas!),
        maxPriorityFeePerGas: toHex(tx.maxPriorityFeePerGas!),
        chainId: toHex(tx.chainId),
        type: '0x02',
      };
      rawTxHex = this.serializeEIP1559Tx(txData);
    } else {
      // Legacy transaction
      const txData = {
        to: tx.to,
        value: toHex(tx.value),
        data: tx.data,
        nonce: toHex(tx.nonce),
        gasLimit: toHex(tx.gasLimit),
        gasPrice: toHex(tx.gasPrice!),
        chainId: toHex(tx.chainId),
      };
      rawTxHex = this.serializeLegacyTx(txData);
    }
    
    // Sign with Ledger
    const signature = await this.app.signTransaction(
      details.hdPath,
      rawTxHex.slice(2) // Remove 0x prefix
    );
    
    // Combine transaction with signature
    const signedTx = this.buildSignedTx(rawTxHex, signature);
    return signedTx;
  }
  
  async signMessage(address: Address, message: string): Promise<Hex> {
    if (!this.app) {
      throw new Error('Ledger not connected');
    }
    
    const details = this.accountDetails[address.toLowerCase()];
    if (!details) {
      throw new Error('Address not found in Ledger accounts');
    }
    
    const messageHex = Buffer.from(message).toString('hex');
    const signature = await this.app.signPersonalMessage(details.hdPath, messageHex);
    
    // signature.v can be string or number depending on Ledger lib version
    const vNum = typeof signature.v === 'string' ? parseInt(signature.v, 16) : signature.v;
    const vHex = (vNum < 27 ? vNum + 27 : vNum).toString(16).padStart(2, '0');
    
    return `0x${signature.r}${signature.s}${vHex}` as Hex;
  }
  
  async signTypedData(
    address: Address,
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    message: Record<string, unknown>,
    primaryType: string
  ): Promise<Hex> {
    if (!this.app) {
      throw new Error('Ledger not connected');
    }
    
    const details = this.accountDetails[address.toLowerCase()];
    if (!details) {
      throw new Error('Address not found in Ledger accounts');
    }
    
    // Build EIP-712 typed data structure
    const typedData = {
      domain,
      types: { ...types, EIP712Domain: this.getEIP712DomainType(domain) },
      primaryType,
      message,
    };
    
    // Try native EIP-712 signing first (newer Ledger firmware)
    try {
      const signature = await this.app.signEIP712Message(details.hdPath, typedData);
      const vNum = typeof signature.v === 'string' ? parseInt(signature.v, 16) : signature.v;
      const vHex = vNum.toString(16).padStart(2, '0');
      return `0x${signature.r}${signature.s}${vHex}` as Hex;
    } catch (e) {
      // Fall back to hashed method for older firmware
      const err = e as LedgerError;
      if (err.statusText !== 'INS_NOT_SUPPORTED') {
        throw err;
      }
    }
    
    // Use proper EIP-712 hashing via @metamask/eth-sig-util (like Rabby)
    const sanitized = TypedDataUtils.sanitizeData(typedData as Parameters<typeof TypedDataUtils.sanitizeData>[0]);
    const domainSeparatorHex = TypedDataUtils.hashStruct(
      'EIP712Domain',
      sanitized.domain,
      sanitized.types,
      SignTypedDataVersion.V4
    ).toString('hex');
    const messageHashHex = TypedDataUtils.hashStruct(
      primaryType,
      sanitized.message as Record<string, unknown>,
      sanitized.types,
      SignTypedDataVersion.V4
    ).toString('hex');
    
    const signature = await this.app.signEIP712HashedMessage(
      details.hdPath,
      domainSeparatorHex,
      messageHashHex
    );
    
    // signature.v can be string or number depending on Ledger lib version
    const vNum = typeof signature.v === 'string' ? parseInt(signature.v, 16) : signature.v;
    const vHex = vNum.toString(16).padStart(2, '0');
    
    return `0x${signature.r}${signature.s}${vHex}` as Hex;
  }
  
  // Serialization helpers
  private serializeEIP1559Tx(tx: Record<string, string>): string {
    // EIP-1559 transaction serialization
    const fields = [
      tx.chainId,
      tx.nonce,
      tx.maxPriorityFeePerGas,
      tx.maxFeePerGas,
      tx.gasLimit,
      tx.to,
      tx.value,
      tx.data,
      [], // accessList
    ];
    return '0x02' + this.rlpEncode(fields).slice(2);
  }
  
  private serializeLegacyTx(tx: Record<string, string>): string {
    const fields = [
      tx.nonce,
      tx.gasPrice,
      tx.gasLimit,
      tx.to,
      tx.value,
      tx.data,
      tx.chainId,
      '0x',
      '0x',
    ];
    return this.rlpEncode(fields);
  }
  
  private rlpEncode(items: (string | string[])[]): string {
    // Simple RLP encoding for transactions
    const encoded = items.map(item => {
      if (Array.isArray(item)) {
        return this.rlpEncode(item);
      }
      if (item === '0x' || item === '') {
        return '80'; // Empty byte
      }
      const hex = item.startsWith('0x') ? item.slice(2) : item;
      if (hex.length === 0) return '80';
      if (hex.length === 2 && parseInt(hex, 16) < 128) {
        return hex;
      }
      const len = hex.length / 2;
      if (len <= 55) {
        return (0x80 + len).toString(16) + hex;
      }
      const lenHex = len.toString(16);
      return (0xb7 + lenHex.length / 2).toString(16) + lenHex + hex;
    }).join('');
    
    const totalLen = encoded.length / 2;
    if (totalLen <= 55) {
      return '0x' + (0xc0 + totalLen).toString(16) + encoded;
    }
    const lenHex = totalLen.toString(16);
    return '0x' + (0xf7 + lenHex.length / 2).toString(16) + lenHex + encoded;
  }
  
  private buildSignedTx(
    rawTx: string,
    signature: { v: string; r: string; s: string }
  ): Hex {
    // Build signed transaction from raw tx and signature
    
    // For simplicity, return concatenated signature
    // In production, properly encode the signed transaction
    return `${rawTx}${signature.r}${signature.s}${signature.v}` as Hex;
  }
  
  private getEIP712DomainType(domain: Record<string, unknown>): Array<{ name: string; type: string }> {
    const types: Array<{ name: string; type: string }> = [];
    if ('name' in domain) types.push({ name: 'name', type: 'string' });
    if ('version' in domain) types.push({ name: 'version', type: 'string' });
    if ('chainId' in domain) types.push({ name: 'chainId', type: 'uint256' });
    if ('verifyingContract' in domain) types.push({ name: 'verifyingContract', type: 'address' });
    if ('salt' in domain) types.push({ name: 'salt', type: 'bytes32' });
    return types;
  }
  
  // Serialization for persistence
  serialize(): LedgerSerializedState {
    return {
      accounts: this.accounts,
      accountDetails: this.accountDetails,
      hdPath: this.hdPath,
      hdPathType: this.hdPathType,
    };
  }
  
  deserialize(data: PartialLedgerSerializedState): void {
    if (data.accounts) this.accounts = data.accounts;
    if (data.accountDetails) this.accountDetails = data.accountDetails;
    if (data.hdPath) this.hdPath = data.hdPath;
    if (data.hdPathType) this.hdPathType = data.hdPathType;
  }
}

export const ledgerKeyring = new LedgerKeyring();

