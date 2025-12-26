/**
 * Browser shim for @jejunetwork/sdk
 * The SDK has Node.js dependencies but its types are used by @jejunetwork/ui.
 * This shim provides empty implementations for browser builds.
 */

// Type-only exports (no runtime behavior needed)
export interface JejuClient {
  identity: {
    lookupName: (name: string) => Promise<null>
    resolveName: (name: string) => Promise<null>
    reverseLookup: (address: string) => Promise<null>
    registerName: (name: string, resolver: string) => Promise<null>
  }
  crosschain: {
    getConfig: () => Promise<null>
    quote: () => Promise<null>
    swap: () => Promise<null>
    getXLPPosition: () => Promise<null>
    getAllVouchers: () => Promise<null>
    registerAsXLP: () => Promise<null>
    stake: () => Promise<null>
    unstake: () => Promise<null>
    claimFees: () => Promise<null>
    startUnbonding: () => Promise<null>
    completeUnbonding: () => Promise<null>
  }
  payments: {
    getServices: () => Promise<null>
    getBalance: () => Promise<null>
    deposit: () => Promise<null>
  }
  governance: {
    createProposal: () => Promise<null>
    vote: () => Promise<null>
    execute: () => Promise<null>
    getProposal: () => Promise<null>
    getProposals: () => Promise<null>
  }
  defi: {
    getPositions: () => Promise<null>
    stake: () => Promise<null>
    unstake: () => Promise<null>
    claim: () => Promise<null>
  }
  compute: {
    submitJob: () => Promise<null>
    getJob: () => Promise<null>
    getJobResult: () => Promise<null>
    getAvailableWorkers: () => Promise<null>
    getNodeStats: () => Promise<null>
  }
  storage: {
    pin: () => Promise<null>
    unpin: () => Promise<null>
  }
}

export interface EILConfig {
  chainId: number
  contractAddress: string
}

export interface XLPPosition {
  xlpAddress: string
  stakedAmount: bigint
  unbondingAmount: bigint
  pendingFees: bigint
  lastClaimTime: bigint
}

export interface QuoteResult {
  sourceAmount: bigint
  destAmount: bigint
  fee: bigint
}

export interface PaymentService {
  id: string
  name: string
  price: bigint
}

export interface Proposal {
  id: string
  title: string
  description: string
  status: string
}

export interface StakingPosition {
  amount: bigint
  rewards: bigint
}

export interface ComputeJob {
  id: string
  status: string
}

export interface ComputeWorker {
  id: string
  available: boolean
}

export interface NodeStats {
  totalNodes: number
  activeNodes: number
}

export interface PinInfo {
  cid: string
  status: string
}

export interface UploadOptions {
  name?: string
}

export interface UploadResult {
  cid: string
}

export interface Voucher {
  id: string
  amount: bigint
}

// Factory function - returns null since we can't create real clients in browser
export function createJejuClient(): JejuClient {
  throw new Error('SDK not available in browser. Use contract hooks instead.')
}
