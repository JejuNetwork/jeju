/**
 * Injected Provider Script
 * 
 * This script runs in the page context and provides window.ethereum
 * compatible with EIP-1193 and other wallet standards.
 */

import type { Address, Hex } from 'viem';

// ============================================================================
// EIP-1193 Types
// ============================================================================

/** Valid parameter types for EIP-1193 requests (JSON-RPC compatible) */
type EIP1193Param = string | number | boolean | null | EIP1193ParamObject | EIP1193Param[];

interface EIP1193ParamObject {
  [key: string]: EIP1193Param;
}

interface RequestArguments {
  method: string;
  params?: EIP1193Param[];
}

interface ProviderRpcError extends Error {
  code: number;
  data?: EIP1193Param;
}

// ============================================================================
// Event Types
// ============================================================================

/** Provider event names from EIP-1193 */
type ProviderEventName = 'chainChanged' | 'accountsChanged' | 'connect' | 'disconnect' | 'message';

/** Event argument types by event name */
interface ProviderEventArgs {
  chainChanged: [chainId: Hex];
  accountsChanged: [accounts: Address[]];
  connect: [info: { chainId: Hex }];
  disconnect: [error: { code: number; message: string }];
  message: [message: { type: string; data: EIP1193Param }];
}

/** Type-safe event callback for specific event */
type TypedEventCallback<T extends ProviderEventName> = (...args: ProviderEventArgs[T]) => void;

/** Generic event callback (for internal Map storage) */
type EventCallback = (...args: ProviderEventArgs[ProviderEventName]) => void;

/** Internal event data structure from page messages */
interface InternalEventData {
  chainId?: Hex;
  accounts?: Address[];
}

/** Message received from content script */
interface ResponseMessage {
  type: 'jeju_response';
  id: string;
  result?: EIP1193Param;
  error?: { code: number; message: string };
}

/** Event message received from content script */
interface EventMessage {
  type: 'jeju_event';
  event: string;
  data: InternalEventData;
}

type WindowMessage = ResponseMessage | EventMessage | { type: string };

class NetworkProvider {
  private events: Map<ProviderEventName, Set<EventCallback>> = new Map();
  private pendingRequests: Map<string, { resolve: (v: EIP1193Param) => void; reject: (e: Error) => void }> = new Map();
  
  readonly isJeju = true;
  readonly isMetaMask = true; // For compatibility
  
  chainId: Hex | null = null;
  selectedAddress: Address | null = null;
  networkVersion: string | null = null;
  
  constructor() {
    this.setupEventListener();
    this.initialize();
  }

  private setupEventListener(): void {
    window.addEventListener('message', (event: MessageEvent<WindowMessage>) => {
      if (event.source !== window) return;
      
      const data = event.data;
      if (!data || typeof data !== 'object' || !('type' in data)) return;
      
      // Handle responses
      if (data.type === 'jeju_response') {
        const msg = data as ResponseMessage;
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            const error = new Error(msg.error.message) as ProviderRpcError;
            error.code = msg.error.code;
            pending.reject(error);
          } else {
            pending.resolve(msg.result ?? null);
          }
        }
      }
      
      // Handle events
      if (data.type === 'jeju_event') {
        const msg = data as EventMessage;
        this.handleEvent(msg.event, msg.data);
      }
    });
  }

  private async initialize(): Promise<void> {
    const chainId = await this.request({ method: 'eth_chainId' });
    if (typeof chainId === 'string') {
      this.chainId = chainId as Hex;
      this.networkVersion = parseInt(this.chainId, 16).toString();
    }
    
    const accounts = await this.request({ method: 'eth_accounts' });
    if (Array.isArray(accounts) && accounts.length > 0 && typeof accounts[0] === 'string') {
      this.selectedAddress = accounts[0] as Address;
    }
  }

  private handleEvent(eventName: string, data: InternalEventData): void {
    switch (eventName) {
      case 'chainChanged': {
        const chainId = data.chainId;
        if (chainId) {
          this.chainId = chainId;
          this.networkVersion = parseInt(this.chainId, 16).toString();
          this.emit('chainChanged', this.chainId);
        }
        break;
      }
        
      case 'accountsChanged': {
        const accounts = data.accounts ?? [];
        this.selectedAddress = accounts[0] ?? null;
        this.emit('accountsChanged', accounts);
        break;
      }
        
      case 'connect':
        if (this.chainId) {
          this.emit('connect', { chainId: this.chainId });
        }
        break;
        
      case 'disconnect':
        this.selectedAddress = null;
        this.emit('disconnect', { code: 4900, message: 'Disconnected' });
        break;
    }
  }

  async request(args: RequestArguments): Promise<EIP1193Param> {
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
  async enable(): Promise<Address[]> {
    const result = await this.request({ method: 'eth_requestAccounts' });
    return result as Address[];
  }

  async send(method: string, params?: EIP1193Param[]): Promise<EIP1193Param> {
    return this.request({ method, params });
  }

  async sendAsync(
    payload: { method: string; params?: EIP1193Param[]; id?: number },
    callback: (error: Error | null, response?: { result: EIP1193Param }) => void
  ): Promise<void> {
    const result = await this.request({ method: payload.method, params: payload.params });
    callback(null, { result });
  }

  // Event emitter interface - EIP-1193 compliant
  on<T extends ProviderEventName>(event: T, callback: TypedEventCallback<T>): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(callback as EventCallback);
    return this;
  }

  once<T extends ProviderEventName>(event: T, callback: TypedEventCallback<T>): this {
    const wrapped = ((...args: ProviderEventArgs[T]) => {
      this.removeListener(event, wrapped);
      callback(...args);
    }) as TypedEventCallback<T>;
    return this.on(event, wrapped);
  }

  removeListener<T extends ProviderEventName>(event: T, callback: TypedEventCallback<T>): this {
    this.events.get(event)?.delete(callback as EventCallback);
    return this;
  }

  removeAllListeners(event?: ProviderEventName): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }

  private emit<T extends ProviderEventName>(event: T, ...args: ProviderEventArgs[T]): void {
    this.events.get(event)?.forEach(callback => {
      (callback as TypedEventCallback<T>)(...args);
    });
  }

  // EIP-6963 support
  getProviderInfo(): EIP6963ProviderInfo {
    return {
      uuid: 'c2a0e8c4-6c6b-4f3a-8d4e-9f0b1a2c3d4e',
      name: 'Network Wallet',
      icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iIzEwQjk4MSIvPjx0ZXh0IHg9IjY0IiB5PSI4MCIgZm9udC1zaXplPSI2NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtZmFtaWx5PSJzeXN0ZW0tdWkiIGZvbnQtd2VpZ2h0PSJib2xkIj5KPC90ZXh0Pjwvc3ZnPg==',
      rdns: 'network.jeju.wallet',
    };
  }
}

/** EIP-6963 Provider Info */
interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
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

// Export the provider type
export type { NetworkProvider, EIP1193Param };

// Set as window.ethereum and window.jeju
// NetworkProvider is EIP-1193 compatible - assignment is safe at runtime
// Window.jeju is declared in globals.d.ts, Window.ethereum is declared by viem
Object.defineProperty(window, 'jeju', { value: provider, writable: true });
if (!window.ethereum) {
  Object.defineProperty(window, 'ethereum', { value: provider, writable: true, configurable: true });
}

// Provider injected

