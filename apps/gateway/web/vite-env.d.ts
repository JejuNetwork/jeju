/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string
  readonly VITE_CHAIN_ID?: string
  readonly VITE_TOKEN_REGISTRY_ADDRESS?: string
  readonly VITE_PAYMASTER_FACTORY_ADDRESS?: string
  readonly VITE_PRICE_ORACLE_ADDRESS?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string

  // JEJU Token (Native Token)
  readonly VITE_JEJU_TOKEN_ADDRESS?: string
  readonly VITE_JEJU_VAULT_ADDRESS?: string
  readonly VITE_JEJU_PAYMASTER_ADDRESS?: string

  // Node Staking System
  readonly VITE_NODE_STAKING_MANAGER_ADDRESS?: string
  readonly VITE_NODE_PERFORMANCE_ORACLE_ADDRESS?: string
  readonly VITE_NODE_EXPLORER_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
