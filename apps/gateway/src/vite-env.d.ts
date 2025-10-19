/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_TOKEN_REGISTRY_ADDRESS?: string;
  readonly VITE_PAYMASTER_FACTORY_ADDRESS?: string;
  readonly VITE_PRICE_ORACLE_ADDRESS?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  
  // elizaOS Token (Native Jeju)
  readonly VITE_ELIZAOS_TOKEN_ADDRESS?: string;
  readonly VITE_ELIZAOS_VAULT_ADDRESS?: string;
  readonly VITE_ELIZAOS_PAYMASTER_ADDRESS?: string;
  
  // CLANKER Token (Bridged from Base)
  readonly VITE_CLANKER_TOKEN_ADDRESS?: string;
  readonly VITE_CLANKER_VAULT_ADDRESS?: string;
  readonly VITE_CLANKER_PAYMASTER_ADDRESS?: string;
  
  // VIRTUAL Token (Bridged from Base)
  readonly VITE_VIRTUAL_TOKEN_ADDRESS?: string;
  readonly VITE_VIRTUAL_VAULT_ADDRESS?: string;
  readonly VITE_VIRTUAL_PAYMASTER_ADDRESS?: string;
  
  // CLANKERMON Token (Bridged from Base)
  readonly VITE_CLANKERMON_TOKEN_ADDRESS?: string;
  readonly VITE_CLANKERMON_VAULT_ADDRESS?: string;
  readonly VITE_CLANKERMON_PAYMASTER_ADDRESS?: string;
  
  // Node Staking System
  readonly VITE_NODE_STAKING_MANAGER_ADDRESS?: string;
  readonly VITE_NODE_PERFORMANCE_ORACLE_ADDRESS?: string;
  readonly VITE_NODE_EXPLORER_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

