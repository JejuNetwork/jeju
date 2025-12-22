/// <reference types="bun-types" />

interface ImportMetaEnv {
  readonly VITE_AUTOCRAT_API: string
  readonly VITE_AUTOCRAT_ADDRESS: string
  readonly VITE_CHAIN_ID: string
  readonly VITE_WALLETCONNECT_PROJECT_ID: string
  readonly VITE_OAUTH3_AGENT_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
