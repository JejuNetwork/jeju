/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Network
  readonly PUBLIC_NETWORK?: 'localnet' | 'testnet' | 'mainnet'
  readonly PUBLIC_RPC_URL?: string
  readonly PUBLIC_CHAIN_ID?: string
  readonly PUBLIC_WS_URL?: string

  // WalletConnect
  readonly PUBLIC_WALLETCONNECT_PROJECT_ID?: string

  // Contract Addresses - Tokens
  readonly PUBLIC_JEJU_TOKEN_ADDRESS?: string
  readonly PUBLIC_USDC_ADDRESS?: string

  // Contract Addresses - Registry
  readonly PUBLIC_TOKEN_REGISTRY_ADDRESS?: string
  readonly PUBLIC_IDENTITY_REGISTRY_ADDRESS?: string
  readonly PUBLIC_REPUTATION_REGISTRY_ADDRESS?: string
  readonly PUBLIC_VALIDATION_REGISTRY_ADDRESS?: string

  // Contract Addresses - Moderation
  readonly PUBLIC_BAN_MANAGER_ADDRESS?: string
  readonly PUBLIC_MODERATION_MARKETPLACE_ADDRESS?: string
  readonly PUBLIC_REPORTING_SYSTEM_ADDRESS?: string
  readonly PUBLIC_REPUTATION_LABEL_MANAGER_ADDRESS?: string

  // Contract Addresses - Payments
  readonly PUBLIC_PAYMASTER_FACTORY_ADDRESS?: string
  readonly PUBLIC_PRICE_ORACLE_ADDRESS?: string
  readonly PUBLIC_ENTRY_POINT_ADDRESS?: string
  readonly PUBLIC_X402_FACILITATOR_ADDRESS?: string

  // Contract Addresses - Node Staking
  readonly PUBLIC_NODE_STAKING_MANAGER_ADDRESS?: string
  readonly PUBLIC_NODE_PERFORMANCE_ORACLE_ADDRESS?: string
  readonly PUBLIC_RPC_STAKING_ADDRESS?: string

  // Contract Addresses - JNS
  readonly PUBLIC_JNS_REGISTRY?: string
  readonly PUBLIC_JNS_RESOLVER?: string
  readonly PUBLIC_JNS_REGISTRAR?: string
  readonly PUBLIC_JNS_REVERSE_REGISTRAR?: string

  // Contract Addresses - DeFi
  readonly PUBLIC_POOL_MANAGER_ADDRESS?: string
  readonly PUBLIC_SWAP_ROUTER_ADDRESS?: string
  readonly PUBLIC_POSITION_MANAGER_ADDRESS?: string
  readonly PUBLIC_QUOTER_V4_ADDRESS?: string
  readonly PUBLIC_STATE_VIEW_ADDRESS?: string

  // Contract Addresses - Compute
  readonly PUBLIC_COMPUTE_REGISTRY_ADDRESS?: string
  readonly PUBLIC_LEDGER_MANAGER_ADDRESS?: string
  readonly PUBLIC_INFERENCE_SERVING_ADDRESS?: string
  readonly PUBLIC_COMPUTE_STAKING_ADDRESS?: string

  // Contract Addresses - Storage
  readonly PUBLIC_FILE_STORAGE_MANAGER_ADDRESS?: string

  // Contract Addresses - Governance
  readonly PUBLIC_GOVERNOR_ADDRESS?: string
  readonly PUBLIC_FUTARCHY_GOVERNOR_ADDRESS?: string

  // Service URLs
  readonly PUBLIC_INDEXER_URL?: string
  readonly PUBLIC_INDEXER_REST_URL?: string
  readonly PUBLIC_INDEXER_A2A_URL?: string
  readonly PUBLIC_INDEXER_MCP_URL?: string
  readonly PUBLIC_RPC_GATEWAY_URL?: string
  readonly PUBLIC_OAUTH3_AGENT_URL?: string
  readonly PUBLIC_IPFS_API?: string
  readonly PUBLIC_IPFS_GATEWAY?: string
  readonly PUBLIC_OIF_AGGREGATOR_URL?: string
  readonly PUBLIC_LEADERBOARD_API_URL?: string
  readonly PUBLIC_EXPLORER_URL?: string

  // Build mode
  readonly MODE?: string
  readonly DEV?: boolean
  readonly PROD?: boolean
  readonly SSR?: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
