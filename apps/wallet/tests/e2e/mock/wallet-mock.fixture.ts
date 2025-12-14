/**
 * Wallet Mock Fixture
 * 
 * Uses a mock ethereum provider for fast E2E tests
 * without requiring actual browser extensions.
 */

import { test as base } from '@playwright/test';
import { TEST_ACCOUNTS } from '../../fixtures/accounts';

// Type for the mock wallet
interface WalletMock {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  switchNetwork(chainId: number): Promise<void>;
  mockBalance(address: string, balance: string): void;
  mockTokenBalance(token: string, address: string, balance: string): void;
  getAddress(): string;
}

// Create the test fixture
export const test = base.extend<{ walletMock: WalletMock }>({
  walletMock: async ({ page }, use) => {
    // Inject mock provider before page loads
    await page.addInitScript(() => {
      // Prevent double injection
      if ((window as WindowWithMock).__mockProviderInjected) return;
      (window as WindowWithMock).__mockProviderInjected = true;
      
      const mockAccounts = ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
      let connected = false;
      let currentChainId = '0x2105'; // Base
      
      const mockProvider = {
        isMetaMask: true,
        isJejuWallet: true,
        
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          console.log('[MockProvider]', method, params);
          
          switch (method) {
            case 'eth_requestAccounts':
              connected = true;
              return mockAccounts;
            
            case 'eth_accounts':
              return connected ? mockAccounts : [];
            
            case 'eth_chainId':
              return currentChainId;
            
            case 'wallet_switchEthereumChain':
              const chainIdParam = params?.[0] as { chainId: string } | undefined;
              currentChainId = chainIdParam?.chainId || currentChainId;
              return null;
            
            case 'eth_getBalance':
              return '0x8AC7230489E80000'; // 10 ETH
            
            case 'personal_sign':
              return '0x' + 'ab'.repeat(65);
            
            case 'eth_signTypedData_v4':
              return '0x' + 'cd'.repeat(65);
            
            case 'eth_sendTransaction':
              return '0x' + 'ef'.repeat(32);
            
            case 'eth_call':
              return '0x0000000000000000000000000000000000000000000000000000000000000000';
            
            case 'eth_estimateGas':
              return '0x5208';
            
            case 'eth_gasPrice':
              return '0x3B9ACA00';
            
            case 'eth_blockNumber':
              return '0x1000000';
            
            case 'net_version':
              return parseInt(currentChainId, 16).toString();
            
            default:
              console.warn('[MockProvider] Unhandled method:', method);
              return null;
          }
        },
        
        on: (event: string, _callback: (...args: unknown[]) => void) => {
          console.log('[MockProvider] Registered listener for:', event);
        },
        
        removeListener: () => {},
        
        emit: (event: string, ..._args: unknown[]) => {
          console.log('[MockProvider] Emitting:', event);
        },
      };
      
      // Set as window.ethereum
      (window as WindowWithMock).ethereum = mockProvider;
      
      // Announce via EIP-6963
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: {
            uuid: 'mock-wallet',
            name: 'Mock Wallet',
            icon: 'data:image/svg+xml,<svg></svg>',
            rdns: 'io.mock.wallet',
          },
          provider: mockProvider,
        },
      }));
      
      console.log('[MockProvider] Injected successfully');
      
      // Type for window with mock provider
      interface WindowWithMock extends Window {
        __mockProviderInjected?: boolean;
        ethereum?: typeof mockProvider;
      }
    });
    
    // Create mock interface
    const walletMock: WalletMock = {
      connect: async () => {
        await page.evaluate(() => {
          const win = window as WindowWithEth;
          if (typeof win.ethereum?.request !== 'function') {
            throw new Error('Mock provider not injected');
          }
          return win.ethereum.request({ method: 'eth_requestAccounts' });
        });
      },
      
      disconnect: async () => {
        await page.evaluate(() => {
          console.log('Disconnecting mock wallet');
        });
      },
      
      switchNetwork: async (chainId: number) => {
        await page.evaluate((cid) => {
          const win = window as WindowWithEth;
          if (typeof win.ethereum?.request !== 'function') {
            throw new Error('Mock provider not injected');
          }
          return win.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x' + cid.toString(16) }],
          });
        }, chainId);
      },
      
      mockBalance: (address: string, balance: string) => {
        console.log('Mocking balance for', address, balance);
      },
      
      mockTokenBalance: (token: string, address: string, balance: string) => {
        console.log('Mocking token balance', token, address, balance);
      },
      
      getAddress: () => TEST_ACCOUNTS.primary.address,
    };
    
    await use(walletMock);
  },
});

export { expect } from '@playwright/test';

// Window type with ethereum
interface WindowWithEth extends Window {
  ethereum?: {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
}
