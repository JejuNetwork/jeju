/**
 * Injected Provider Script
 * 
 * This script runs in the page context and provides window.ethereum
 * compatible with EIP-1193 and other wallet standards.
 */

interface RequestArguments {
  method: string;
  params?: unknown[];
}

interface ProviderRpcError extends Error {
  code: number;
  data?: unknown;
}

type EventCallback = (...args: unknown[]) => void;

class NetworkProvider {
  private events: Map<string, Set<EventCallback>> = new Map();
  private pendingRequests: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  
  readonly isJeju = true;
  readonly isMetaMask = true; // For compatibility
  
  chainId: string | null = null;
  selectedAddress: string | null = null;
  networkVersion: string | null = null;
  
  constructor() {
    this.setupEventListener();
    this.initialize();
  }

  private setupEventListener(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      
      const data = event.data;
      
      // Handle responses
      if (data?.type === 'jeju_response') {
        const pending = this.pendingRequests.get(data.id);
        if (pending) {
          this.pendingRequests.delete(data.id);
          if (data.error) {
            const error = new Error(data.error.message) as ProviderRpcError;
            error.code = data.error.code;
            pending.reject(error);
          } else {
            pending.resolve(data.result);
          }
        }
      }
      
      // Handle events
      if (data?.type === 'jeju_event') {
        this.handleEvent(data.event, data.data);
      }
    });
  }

  private async initialize(): Promise<void> {
    try {
      this.chainId = await this.request({ method: 'eth_chainId' }) as string;
      this.networkVersion = parseInt(this.chainId, 16).toString();
      
      const accounts = await this.request({ method: 'eth_accounts' }) as string[];
      if (accounts.length > 0) {
        this.selectedAddress = accounts[0];
      }
    } catch {
      // Extension might not be ready
    }
  }

  private handleEvent(eventName: string, data: Record<string, unknown>): void {
    switch (eventName) {
      case 'chainChanged':
        this.chainId = data.chainId as string;
        this.networkVersion = parseInt(this.chainId, 16).toString();
        this.emit('chainChanged', this.chainId);
        break;
        
      case 'accountsChanged':
        const accounts = data.accounts as string[];
        this.selectedAddress = accounts[0] ?? null;
        this.emit('accountsChanged', accounts);
        break;
        
      case 'connect':
        this.emit('connect', { chainId: this.chainId });
        break;
        
      case 'disconnect':
        this.selectedAddress = null;
        this.emit('disconnect', { code: 4900, message: 'Disconnected' });
        break;
    }
  }

  async request(args: RequestArguments): Promise<unknown> {
    const id = crypto.randomUUID();
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      window.postMessage({
        type: 'jeju_request',
        method: args.method,
        params: args.params,
        id,
      }, '*');
      
      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timed out'));
        }
      }, 300000);
    });
  }

  // Legacy methods for compatibility
  async enable(): Promise<string[]> {
    return this.request({ method: 'eth_requestAccounts' }) as Promise<string[]>;
  }

  async send(method: string, params?: unknown[]): Promise<unknown> {
    return this.request({ method, params });
  }

  async sendAsync(
    payload: { method: string; params?: unknown[]; id?: number },
    callback: (error: Error | null, response?: { result: unknown }) => void
  ): Promise<void> {
    try {
      const result = await this.request({ method: payload.method, params: payload.params });
      callback(null, { result });
    } catch (error) {
      callback(error as Error);
    }
  }

  // Event emitter interface
  on(event: string, callback: EventCallback): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(callback);
    return this;
  }

  once(event: string, callback: EventCallback): this {
    const wrapped: EventCallback = (...args) => {
      this.removeListener(event, wrapped);
      callback(...args);
    };
    return this.on(event, wrapped);
  }

  removeListener(event: string, callback: EventCallback): this {
    this.events.get(event)?.delete(callback);
    return this;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }

  private emit(event: string, ...args: unknown[]): void {
    this.events.get(event)?.forEach(callback => {
      try {
        callback(...args);
      } catch (err) {
        console.error('Event callback error:', err);
      }
    });
  }

  // EIP-6963 support
  getProviderInfo() {
    return {
      uuid: 'c2a0e8c4-6c6b-4f3a-8d4e-9f0b1a2c3d4e',
      name: 'Network Wallet',
      icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iIzEwQjk4MSIvPjx0ZXh0IHg9IjY0IiB5PSI4MCIgZm9udC1zaXplPSI2NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtZmFtaWx5PSJzeXN0ZW0tdWkiIGZvbnQtd2VpZ2h0PSJib2xkIj5KPC90ZXh0Pjwvc3ZnPg==',
      rdns: 'network.jeju.wallet',
    };
  }
}

// Create and expose the provider
const provider = new NetworkProvider();

// Announce via EIP-6963
function announceProvider(): void {
  const info = provider.getProviderInfo();
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info, provider },
  }));
}

window.addEventListener('eip6963:requestProvider', announceProvider);
announceProvider();

// Set as window.ethereum
declare global {
  interface Window {
    ethereum?: NetworkProvider;
    jeju?: NetworkProvider;
  }
}

if (!window.ethereum) {
  window.ethereum = provider;
}
window.jeju = provider;

console.log('Network Wallet provider injected');

