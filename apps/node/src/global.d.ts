/**
 * Global type declarations for runtime environment
 */

/**
 * EIP-1193 Ethereum Provider - injected by browser wallets (MetaMask, etc.)
 * @see https://eips.ethereum.org/EIPS/eip-1193
 */
interface EIP1193Provider {
  request(args: { method: 'eth_requestAccounts' }): Promise<string[]>;
  request(args: { method: 'eth_chainId' }): Promise<string>;
  request(args: { method: 'eth_accounts' }): Promise<string[]>;
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on(event: 'accountsChanged', handler: (accounts: string[]) => void): void;
  on(event: 'chainChanged', handler: (chainId: string) => void): void;
  on(event: 'disconnect', handler: (error: { code: number; message: string }) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    /**
     * Tauri internal APIs - injected when running in Tauri context
     * @see https://tauri.app/
     */
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      transformCallback: (callback: (...args: unknown[]) => void) => number;
    };

    /**
     * EIP-1193 Ethereum Provider - injected by browser wallets
     */
    ethereum?: EIP1193Provider;
  }

  interface Navigator {
    /**
     * Device Memory API - returns approximate device memory in GB
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
     */
    deviceMemory?: number;
  }
}

export {};
