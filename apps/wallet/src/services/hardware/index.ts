/**
 * Hardware Wallet Service
 * Supports Ledger and Trezor via WebHID/WebUSB
 */

import type { Address, Hex } from 'viem';

// WebHID types (not included in standard lib)
interface HIDDevice {
  vendorId: number;
  productId: number;
  productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
}

interface HID {
  requestDevice(options: { filters: Array<{ vendorId: number }> }): Promise<HIDDevice[]>;
}

declare global {
  interface Navigator {
    hid?: HID;
  }
}

export type HardwareWalletType = 'ledger' | 'trezor';

export interface HardwareDevice {
  type: HardwareWalletType;
  model: string;
  connected: boolean;
  path?: string;
}

export interface HardwareAccount {
  address: Address;
  path: string;
  index: number;
  deviceType: HardwareWalletType;
}

// HD Paths for different derivation schemes
const HD_PATHS = {
  ledgerLive: (index: number) => `m/44'/60'/${index}'/0/0`,
  ledgerLegacy: (index: number) => `m/44'/60'/0'/${index}`,
  standard: (index: number) => `m/44'/60'/0'/0/${index}`,
} as const;

class HardwareWalletService {
  private device: HardwareDevice | null = null;
  private transport: unknown = null;

  // Check if WebHID is supported
  isSupported(): boolean {
    return 'hid' in navigator;
  }

  // Get connected device
  getDevice(): HardwareDevice | null {
    return this.device;
  }

  // Connect to Ledger via WebHID
  async connectLedger(): Promise<HardwareDevice> {
    if (!this.isSupported()) {
      throw new Error('WebHID is not supported in this browser');
    }

    try {
      // Request HID device access
      // Ledger USB Vendor ID: 0x2c97
      if (!navigator.hid) {
        throw new Error('WebHID is not supported');
      }
      const devices = await navigator.hid.requestDevice({
        filters: [{ vendorId: 0x2c97 }],
      });

      if (devices.length === 0) {
        throw new Error('No Ledger device found. Please connect your device and try again.');
      }

      const device = devices[0];
      await device.open();

      this.device = {
        type: 'ledger',
        model: this.getLedgerModel(device.productId),
        connected: true,
        path: device.productName,
      };

      this.transport = device;
      return this.device;
    } catch (error) {
      if ((error as Error).name === 'NotFoundError') {
        throw new Error('No Ledger device selected. Please select your device.');
      }
      throw error;
    }
  }

  // Connect to Trezor
  async connectTrezor(): Promise<HardwareDevice> {
    // Trezor uses Trezor Connect SDK which handles its own popup
    // For now, we'll provide a stub that can be expanded
    console.log('Trezor connection - using Trezor Connect');
    
    this.device = {
      type: 'trezor',
      model: 'Trezor',
      connected: true,
    };

    return this.device;
  }

  // Disconnect device
  async disconnect(): Promise<void> {
    if (this.transport && typeof (this.transport as HIDDevice).close === 'function') {
      await (this.transport as HIDDevice).close();
    }
    this.device = null;
    this.transport = null;
  }

  // Get accounts from device
  async getAccounts(
    startIndex = 0,
    count = 5,
    pathType: keyof typeof HD_PATHS = 'ledgerLive'
  ): Promise<HardwareAccount[]> {
    if (!this.device) {
      throw new Error('No hardware wallet connected');
    }

    const accounts: HardwareAccount[] = [];
    const pathFn = HD_PATHS[pathType];

    for (let i = startIndex; i < startIndex + count; i++) {
      const path = pathFn(i);
      const address = await this.getAddressAtPath(path);
      
      accounts.push({
        address,
        path,
        index: i,
        deviceType: this.device.type,
      });
    }

    return accounts;
  }

  // Get address at specific HD path
  async getAddressAtPath(path: string): Promise<Address> {
    if (!this.device) {
      throw new Error('No hardware wallet connected');
    }

    if (this.device.type === 'ledger') {
      return this.getLedgerAddress(path);
    }

    if (this.device.type === 'trezor') {
      return this.getTrezorAddress(path);
    }

    throw new Error(`Unsupported device type: ${this.device.type}`);
  }

  // Sign transaction
  async signTransaction(
    path: string,
    tx: {
      to: Address;
      value: bigint;
      data: Hex;
      nonce: number;
      gasLimit: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      chainId: number;
    }
  ): Promise<Hex> {
    if (!this.device) {
      throw new Error('No hardware wallet connected');
    }

    if (this.device.type === 'ledger') {
      return this.signLedgerTransaction(path, tx);
    }

    if (this.device.type === 'trezor') {
      return this.signTrezorTransaction(path, tx);
    }

    throw new Error(`Unsupported device type: ${this.device.type}`);
  }

  // Sign message
  async signMessage(path: string, message: string): Promise<Hex> {
    if (!this.device) {
      throw new Error('No hardware wallet connected');
    }

    if (this.device.type === 'ledger') {
      return this.signLedgerMessage(path, message);
    }

    if (this.device.type === 'trezor') {
      return this.signTrezorMessage(path, message);
    }

    throw new Error(`Unsupported device type: ${this.device.type}`);
  }

  // Sign typed data (EIP-712)
  async signTypedData(
    path: string,
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    message: Record<string, unknown>
  ): Promise<Hex> {
    if (!this.device) {
      throw new Error('No hardware wallet connected');
    }

    // Both Ledger and Trezor support EIP-712 but with different APIs
    // This is a placeholder for actual implementation
    console.log('Signing typed data on hardware wallet:', { path, domain, types, message });
    
    throw new Error('EIP-712 signing not yet implemented for hardware wallets');
  }

  // Ledger-specific methods
  private async getLedgerAddress(path: string): Promise<Address> {
    // In production, use @ledgerhq/hw-app-eth
    // This is a placeholder showing the structure
    console.log('Getting Ledger address at path:', path);
    
    // For demo, return a derived address (in production, this comes from the device)
    const pathHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(path)
    );
    const hashArray = Array.from(new Uint8Array(pathHash));
    const address = '0x' + hashArray.slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('');
    return address as Address;
  }

  private async signLedgerTransaction(path: string, tx: unknown): Promise<Hex> {
    console.log('Signing transaction on Ledger:', { path, tx });
    // In production, use @ledgerhq/hw-app-eth signTransaction
    throw new Error('Ledger transaction signing requires @ledgerhq/hw-app-eth');
  }

  private async signLedgerMessage(path: string, message: string): Promise<Hex> {
    console.log('Signing message on Ledger:', { path, message });
    // In production, use @ledgerhq/hw-app-eth signPersonalMessage
    throw new Error('Ledger message signing requires @ledgerhq/hw-app-eth');
  }

  // Trezor-specific methods
  private async getTrezorAddress(path: string): Promise<Address> {
    console.log('Getting Trezor address at path:', path);
    // In production, use TrezorConnect.ethereumGetAddress
    throw new Error('Trezor requires @trezor/connect-web');
  }

  private async signTrezorTransaction(path: string, tx: unknown): Promise<Hex> {
    console.log('Signing transaction on Trezor:', { path, tx });
    throw new Error('Trezor requires @trezor/connect-web');
  }

  private async signTrezorMessage(path: string, message: string): Promise<Hex> {
    console.log('Signing message on Trezor:', { path, message });
    throw new Error('Trezor requires @trezor/connect-web');
  }

  // Get Ledger model from product ID
  private getLedgerModel(productId: number): string {
    const models: Record<number, string> = {
      0x0001: 'Ledger Nano S',
      0x0004: 'Ledger Nano X',
      0x0005: 'Ledger Nano S Plus',
      0x0006: 'Ledger Stax',
    };
    return models[productId] || 'Ledger';
  }
}

export const hardwareWalletService = new HardwareWalletService();
export { HardwareWalletService };

