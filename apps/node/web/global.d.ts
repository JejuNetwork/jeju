/**
 * Global type declarations for runtime environment
 */

/** JSON-RPC primitive values */
type JsonRpcValue = string | number | boolean | null
/** JSON-RPC array */
type JsonRpcArray = JsonRpcValue[] | JsonRpcObject[]
/** JSON-RPC object */
type JsonRpcObject = {
  [key: string]: JsonRpcValue | JsonRpcArray | JsonRpcObject
}
/** JSON-RPC parameter types */
type JsonRpcParams = JsonRpcValue | JsonRpcArray | JsonRpcObject

/** Transaction receipt returned by eth_getTransactionReceipt */
interface TransactionReceipt {
  blockHash: string
  blockNumber: string
  transactionHash: string
  status: string
}

/** Block data returned by eth_getBlockByNumber */
interface BlockData {
  number: string
  hash: string
  timestamp: string
}

/** Transaction parameters for eth_sendTransaction */
interface TransactionParams {
  from: string
  to?: string
  value?: string
  data?: string
  gas?: string
  gasPrice?: string
}

/** Chain parameters for wallet_addEthereumChain */
interface AddEthereumChainParams {
  chainId: string
  chainName: string
  rpcUrls: string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  blockExplorerUrls?: string[]
}

/** EIP-1193 RPC method to params/return type mapping */
interface EIP1193MethodMap {
  // Account methods
  eth_requestAccounts: { params: never; result: string[] }
  eth_accounts: { params: never; result: string[] }

  // Chain methods
  eth_chainId: { params: never; result: string }
  net_version: { params: never; result: string }

  // Balance and nonce
  eth_getBalance: { params: [string, string]; result: string }
  eth_getTransactionCount: { params: [string, string]; result: string }

  // Transaction methods
  eth_sendTransaction: { params: [TransactionParams]; result: string }
  eth_getTransactionReceipt: {
    params: [string]
    result: TransactionReceipt | null
  }

  // Signing methods
  personal_sign: { params: [string, string]; result: string }
  eth_signTypedData_v4: { params: [string, string]; result: string }

  // Contract calls
  eth_call: { params: [{ to: string; data: string }, string]; result: string }
  eth_estimateGas: {
    params: [{ from?: string; to?: string; value?: string; data?: string }]
    result: string
  }

  // Block methods
  eth_blockNumber: { params: never; result: string }
  eth_getBlockByNumber: { params: [string, boolean]; result: BlockData | null }

  // Gas price
  eth_gasPrice: { params: never; result: string }
  eth_maxPriorityFeePerGas: { params: never; result: string }

  // Wallet methods
  wallet_switchEthereumChain: { params: [{ chainId: string }]; result: null }
  wallet_addEthereumChain: { params: [AddEthereumChainParams]; result: null }
}

/** EIP-1193 event to handler type mapping */
interface EIP1193EventMap {
  accountsChanged: (accounts: string[]) => void
  chainChanged: (chainId: string) => void
  disconnect: (error: { code: number; message: string }) => void
  connect: (info: { chainId: string }) => void
  message: (message: { type: string; data: JsonRpcObject }) => void
}

/** Known EIP-1193 method names */
type EIP1193Method = keyof EIP1193MethodMap

/** Known EIP-1193 event names */
type EIP1193Event = keyof EIP1193EventMap

/**
 * EIP-1193 Ethereum Provider - injected by browser wallets (MetaMask, etc.)
 * @see https://eips.ethereum.org/EIPS/eip-1193
 */
interface EIP1193Provider {
  /**
   * Make a JSON-RPC request
   * @param args The method and optional params
   * @returns Promise resolving to the result
   */
  request<M extends EIP1193Method>(
    args: EIP1193MethodMap[M]['params'] extends never
      ? { method: M }
      : { method: M; params: EIP1193MethodMap[M]['params'] },
  ): Promise<EIP1193MethodMap[M]['result']>

  /**
   * Fallback for unlisted RPC methods - params and return are JSON-RPC compatible
   */
  request(args: {
    method: string
    params?: readonly JsonRpcParams[]
  }): Promise<JsonRpcValue | JsonRpcArray | JsonRpcObject | null>

  /**
   * Subscribe to provider events
   */
  on<E extends EIP1193Event>(event: E, handler: EIP1193EventMap[E]): void

  /**
   * Unsubscribe from provider events
   */
  removeListener<E extends EIP1193Event>(
    event: E,
    handler: EIP1193EventMap[E],
  ): void
}

/** Tauri invoke argument types - JSON-serializable values */
type TauriInvokeArg =
  | string
  | number
  | boolean
  | null
  | TauriInvokeArg[]
  | { [key: string]: TauriInvokeArg }

/** Tauri invoke return types - JSON-deserializable values */
type TauriInvokeResult =
  | string
  | number
  | boolean
  | null
  | TauriInvokeResult[]
  | { [key: string]: TauriInvokeResult }

/** Tauri callback argument types */
type TauriCallbackArg =
  | string
  | number
  | boolean
  | null
  | TauriCallbackArg[]
  | { [key: string]: TauriCallbackArg }

declare global {
  interface Window {
    /**
     * Tauri internal APIs - injected when running in Tauri context
     * @see https://tauri.app/
     */
    __TAURI_INTERNALS__?: {
      invoke: <T extends TauriInvokeResult = TauriInvokeResult>(
        cmd: string,
        args?: Record<string, TauriInvokeArg>,
      ) => Promise<T>
      transformCallback: <T extends TauriCallbackArg[]>(
        callback: (...args: T) => void,
      ) => number
    }

    /**
     * EIP-1193 Ethereum Provider - injected by browser wallets
     */
    ethereum?: EIP1193Provider
  }

  interface Navigator {
    /**
     * Device Memory API - returns approximate device memory in GB
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
     */
    deviceMemory?: number
  }
}

export {}
