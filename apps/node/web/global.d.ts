type JsonRpcValue = string | number | boolean | null
type JsonRpcArray = JsonRpcValue[] | JsonRpcObject[]
type JsonRpcObject = {
  [key: string]: JsonRpcValue | JsonRpcArray | JsonRpcObject
}
type JsonRpcParams = JsonRpcValue | JsonRpcArray | JsonRpcObject

interface TransactionReceipt {
  blockHash: string
  blockNumber: string
  transactionHash: string
  status: string
}

interface BlockData {
  number: string
  hash: string
  timestamp: string
}

interface TransactionParams {
  from: string
  to?: string
  value?: string
  data?: string
  gas?: string
  gasPrice?: string
}

interface AddEthereumChainParams {
  chainId: string
  chainName: string
  rpcUrls: string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  blockExplorerUrls?: string[]
}

interface EIP1193MethodMap {
  eth_requestAccounts: { params: never; result: string[] }
  eth_accounts: { params: never; result: string[] }
  eth_chainId: { params: never; result: string }
  net_version: { params: never; result: string }
  eth_getBalance: { params: [string, string]; result: string }
  eth_getTransactionCount: { params: [string, string]; result: string }
  eth_sendTransaction: { params: [TransactionParams]; result: string }
  eth_getTransactionReceipt: {
    params: [string]
    result: TransactionReceipt | null
  }
  personal_sign: { params: [string, string]; result: string }
  eth_signTypedData_v4: { params: [string, string]; result: string }
  eth_call: { params: [{ to: string; data: string }, string]; result: string }
  eth_estimateGas: {
    params: [{ from?: string; to?: string; value?: string; data?: string }]
    result: string
  }
  eth_blockNumber: { params: never; result: string }
  eth_getBlockByNumber: { params: [string, boolean]; result: BlockData | null }
  eth_gasPrice: { params: never; result: string }
  eth_maxPriorityFeePerGas: { params: never; result: string }
  wallet_switchEthereumChain: { params: [{ chainId: string }]; result: null }
  wallet_addEthereumChain: { params: [AddEthereumChainParams]; result: null }
}

interface EIP1193EventMap {
  accountsChanged: (accounts: string[]) => void
  chainChanged: (chainId: string) => void
  disconnect: (error: { code: number; message: string }) => void
  connect: (info: { chainId: string }) => void
  message: (message: { type: string; data: JsonRpcObject }) => void
}

type EIP1193Method = keyof EIP1193MethodMap
type EIP1193Event = keyof EIP1193EventMap

interface EIP1193Provider {
  request<M extends EIP1193Method>(
    args: EIP1193MethodMap[M]['params'] extends never
      ? { method: M }
      : { method: M; params: EIP1193MethodMap[M]['params'] },
  ): Promise<EIP1193MethodMap[M]['result']>

  request(args: {
    method: string
    params?: readonly JsonRpcParams[]
  }): Promise<JsonRpcValue | JsonRpcArray | JsonRpcObject | null>

  on<E extends EIP1193Event>(event: E, handler: EIP1193EventMap[E]): void
  removeListener<E extends EIP1193Event>(
    event: E,
    handler: EIP1193EventMap[E],
  ): void
}

type TauriInvokeArg =
  | string
  | number
  | boolean
  | null
  | TauriInvokeArg[]
  | { [key: string]: TauriInvokeArg }

type TauriInvokeResult =
  | string
  | number
  | boolean
  | null
  | TauriInvokeResult[]
  | { [key: string]: TauriInvokeResult }

type TauriCallbackArg =
  | string
  | number
  | boolean
  | null
  | TauriCallbackArg[]
  | { [key: string]: TauriCallbackArg }

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: <T extends TauriInvokeResult = TauriInvokeResult>(
        cmd: string,
        args?: Record<string, TauriInvokeArg>,
      ) => Promise<T>
      transformCallback: <T extends TauriCallbackArg[]>(
        callback: (...args: T) => void,
      ) => number
    }
    ethereum?: EIP1193Provider
  }

  interface Navigator {
    deviceMemory?: number
  }
}

export {}
