import { feeConfigAbi } from '@jejunetwork/contracts'
import { toBigInt } from '@jejunetwork/types'
import type {
  Address,
  createPublicClient,
  createWalletClient,
  Hash,
  Hex,
} from 'viem'
export type FeeCategory =
  | 'distribution'
  | 'compute'
  | 'storage'
  | 'defi'
  | 'infrastructure'
  | 'marketplace'
  | 'names'
  | 'token'

export interface DistributionFees {
  appShareBps: number
  lpShareBps: number
  contributorShareBps: number
  ethLpShareBps: number
  tokenLpShareBps: number
}

export interface ComputeFees {
  inferencePlatformFeeBps: number
  rentalPlatformFeeBps: number
  triggerPlatformFeeBps: number
}

export interface StorageFees {
  uploadFeeBps: number
  retrievalFeeBps: number
  pinningFeeBps: number
}

export interface DeFiFees {
  swapProtocolFeeBps: number
  bridgeFeeBps: number
  crossChainMarginBps: number
}

export interface InfrastructureFees {
  sequencerRevenueShareBps: number
  oracleTreasuryShareBps: number
  rpcPremiumFeeBps: number
  messagingFeeBps: number
}

export interface MarketplaceFees {
  bazaarPlatformFeeBps: number
  launchpadCreatorFeeBps: number
  launchpadCommunityFeeBps: number
  x402ProtocolFeeBps: number
}

export interface NamesFees {
  baseRegistrationPrice: bigint
  agentDiscountBps: number
  renewalDiscountBps: number
}

export interface TokenFees {
  xlpRewardShareBps: number
  protocolShareBps: number
  burnShareBps: number
  transferFeeBps: number
  bridgeFeeMinBps: number
  bridgeFeeMaxBps: number
  xlpMinStakeBps: number
  zkProofDiscountBps: number
}

export interface PendingFeeChange {
  changeId: Hex
  feeType: Hex
  effectiveAt: number
  proposedBy: Address
  executed: boolean
}

export interface FeeConfigState {
  distribution: DistributionFees
  compute: ComputeFees
  storage: StorageFees
  defi: DeFiFees
  infrastructure: InfrastructureFees
  marketplace: MarketplaceFees
  names: NamesFees
  token: TokenFees
  treasury: Address
  board: Address
  director: Address
}
let feeConfigAddress: Address | null = null
let publicClient: ReturnType<typeof createPublicClient> | null = null
let walletClient: ReturnType<typeof createWalletClient> | null = null
export function initializeFeeActions(
  _feeConfigAddress: Address,
  _publicClient: ReturnType<typeof createPublicClient>,
  _walletClient: ReturnType<typeof createWalletClient> | null,
): void {
  feeConfigAddress = _feeConfigAddress
  publicClient = _publicClient
  walletClient = _walletClient
}

function ensureReadOnly(): {
  address: Address
  public: ReturnType<typeof createPublicClient>
} {
  if (!feeConfigAddress || !publicClient) {
    throw new Error(
      'Fee actions not initialized. Call initializeFeeActions first.',
    )
  }
  return { address: feeConfigAddress, public: publicClient }
}

function ensureWrite(): {
  address: Address
  public: ReturnType<typeof createPublicClient>
  wallet: ReturnType<typeof createWalletClient>
} {
  if (!feeConfigAddress || !publicClient || !walletClient) {
    throw new Error(
      'Fee actions not initialized with wallet client. Write operations unavailable.',
    )
  }
  return {
    address: feeConfigAddress,
    public: publicClient,
    wallet: walletClient,
  }
}
export async function getFeeConfigState(): Promise<FeeConfigState> {
  const { address, public: client } = ensureReadOnly()

  const [
    distribution,
    compute,
    storage,
    defi,
    infrastructure,
    marketplace,
    names,
    token,
    treasury,
    board,
    director,
  ] = await Promise.all([
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'getDistributionFees',
    }),
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'getComputeFees',
    }),
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'getStorageFees',
    }),
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'getDeFiFees',
    }),
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'getInfrastructureFees',
    }),
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'getMarketplaceFees',
    }),
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'getNamesFees',
    }),
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'getTokenFees',
    }),
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'getTreasury',
    }),
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'board' as 'getTreasury', // Type workaround for viem inference
    }) as Promise<Address>,
    client.readContract({
      address,
      abi: feeConfigAbi,
      functionName: 'director' as 'getTreasury', // Type workaround for viem inference
    }) as Promise<Address>,
  ])

  return {
    distribution: {
      appShareBps: distribution.appShareBps,
      lpShareBps: distribution.lpShareBps,
      contributorShareBps: distribution.contributorShareBps,
      ethLpShareBps: distribution.ethLpShareBps,
      tokenLpShareBps: distribution.tokenLpShareBps,
    },
    compute: {
      inferencePlatformFeeBps: compute.inferencePlatformFeeBps,
      rentalPlatformFeeBps: compute.rentalPlatformFeeBps,
      triggerPlatformFeeBps: compute.triggerPlatformFeeBps,
    },
    storage: {
      uploadFeeBps: storage.uploadFeeBps,
      retrievalFeeBps: storage.retrievalFeeBps,
      pinningFeeBps: storage.pinningFeeBps,
    },
    defi: {
      swapProtocolFeeBps: defi.swapProtocolFeeBps,
      bridgeFeeBps: defi.bridgeFeeBps,
      crossChainMarginBps: defi.crossChainMarginBps,
    },
    infrastructure: {
      sequencerRevenueShareBps: infrastructure.sequencerRevenueShareBps,
      oracleTreasuryShareBps: infrastructure.oracleTreasuryShareBps,
      rpcPremiumFeeBps: infrastructure.rpcPremiumFeeBps,
      messagingFeeBps: infrastructure.messagingFeeBps,
    },
    marketplace: {
      bazaarPlatformFeeBps: marketplace.bazaarPlatformFeeBps,
      launchpadCreatorFeeBps: marketplace.launchpadCreatorFeeBps,
      launchpadCommunityFeeBps: marketplace.launchpadCommunityFeeBps,
      x402ProtocolFeeBps: marketplace.x402ProtocolFeeBps,
    },
    names: {
      baseRegistrationPrice: names.baseRegistrationPrice,
      agentDiscountBps: names.agentDiscountBps,
      renewalDiscountBps: names.renewalDiscountBps,
    },
    token: {
      xlpRewardShareBps: token.xlpRewardShareBps,
      protocolShareBps: token.protocolShareBps,
      burnShareBps: token.burnShareBps,
      transferFeeBps: token.transferFeeBps,
      bridgeFeeMinBps: token.bridgeFeeMinBps,
      bridgeFeeMaxBps: token.bridgeFeeMaxBps,
      xlpMinStakeBps: token.xlpMinStakeBps,
      zkProofDiscountBps: token.zkProofDiscountBps,
    },
    treasury,
    board,
    director,
  }
}
/**
 * Execute a pending fee change (Director only)
 * The change must have been proposed by board and passed its timelock
 */
export async function directorExecuteFeeChange(changeId: Hex): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'executeFeeChange',
    args: [changeId],
  })

  console.log(`[Director] Executed fee change: ${changeId}`)
  return hash
}

/**
 * Cancel a pending fee change (Director or Board)
 */
export async function directorCancelFeeChange(changeId: Hex): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'cancelFeeChange',
    args: [changeId],
  })

  console.log(`[Director] Cancelled fee change: ${changeId}`)
  return hash
}
export async function directorSetDistributionFees(
  fees: DistributionFees,
): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setDistributionFees',
    args: [
      fees.appShareBps,
      fees.lpShareBps,
      fees.contributorShareBps,
      fees.ethLpShareBps,
      fees.tokenLpShareBps,
    ],
  })

  console.log(
    `[Director] Updated distribution fees: app=${fees.appShareBps}, lp=${fees.lpShareBps}, contrib=${fees.contributorShareBps}`,
  )
  return hash
}

export async function directorSetComputeFees(fees: ComputeFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setComputeFees',
    args: [
      fees.inferencePlatformFeeBps,
      fees.rentalPlatformFeeBps,
      fees.triggerPlatformFeeBps,
    ],
  })

  console.log(
    `[Director] Updated compute fees: inference=${fees.inferencePlatformFeeBps}, rental=${fees.rentalPlatformFeeBps}`,
  )
  return hash
}

export async function directorSetStorageFees(fees: StorageFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setStorageFees',
    args: [fees.uploadFeeBps, fees.retrievalFeeBps, fees.pinningFeeBps],
  })

  console.log(
    `[Director] Updated storage fees: upload=${fees.uploadFeeBps}, retrieval=${fees.retrievalFeeBps}`,
  )
  return hash
}

export async function directorSetDeFiFees(fees: DeFiFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setDeFiFees',
    args: [
      fees.swapProtocolFeeBps,
      fees.bridgeFeeBps,
      fees.crossChainMarginBps,
    ],
  })

  console.log(
    `[Director] Updated DeFi fees: swap=${fees.swapProtocolFeeBps}, bridge=${fees.bridgeFeeBps}`,
  )
  return hash
}

export async function directorSetInfrastructureFees(
  fees: InfrastructureFees,
): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setInfrastructureFees',
    args: [
      fees.sequencerRevenueShareBps,
      fees.oracleTreasuryShareBps,
      fees.rpcPremiumFeeBps,
      fees.messagingFeeBps,
    ],
  })

  console.log(
    `[Director] Updated infrastructure fees: sequencer=${fees.sequencerRevenueShareBps}, oracle=${fees.oracleTreasuryShareBps}`,
  )
  return hash
}

export async function directorSetMarketplaceFees(
  fees: MarketplaceFees,
): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setMarketplaceFees',
    args: [
      fees.bazaarPlatformFeeBps,
      fees.launchpadCreatorFeeBps,
      fees.launchpadCommunityFeeBps,
      fees.x402ProtocolFeeBps,
    ],
  })

  console.log(
    `[Director] Updated marketplace fees: bazaar=${fees.bazaarPlatformFeeBps}, x402=${fees.x402ProtocolFeeBps}`,
  )
  return hash
}

export async function directorSetNamesFees(fees: NamesFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setNamesFees',
    args: [
      fees.baseRegistrationPrice,
      fees.agentDiscountBps,
      fees.renewalDiscountBps,
    ],
  })

  console.log(
    `[Director] Updated names fees: base=${fees.baseRegistrationPrice}, discount=${fees.agentDiscountBps}`,
  )
  return hash
}

export async function directorSetTokenFees(fees: TokenFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setTokenFees',
    args: [
      fees.xlpRewardShareBps,
      fees.protocolShareBps,
      fees.burnShareBps,
      fees.transferFeeBps,
      fees.bridgeFeeMinBps,
      fees.bridgeFeeMaxBps,
      fees.xlpMinStakeBps,
      fees.zkProofDiscountBps,
    ],
  })

  console.log(
    `[Director] Updated token fees: xlp=${fees.xlpRewardShareBps}, protocol=${fees.protocolShareBps}, burn=${fees.burnShareBps}`,
  )
  return hash
}

export async function directorSetTokenOverride(
  token: Address,
  fees: TokenFees,
): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setTokenOverride',
    args: [
      token,
      fees.xlpRewardShareBps,
      fees.protocolShareBps,
      fees.burnShareBps,
      fees.transferFeeBps,
      fees.bridgeFeeMinBps,
      fees.bridgeFeeMaxBps,
      fees.xlpMinStakeBps,
      fees.zkProofDiscountBps,
    ],
  })

  console.log(
    `[Director] Set token override for ${token}: xlp=${fees.xlpRewardShareBps}`,
  )
  return hash
}

export async function directorRemoveTokenOverride(
  token: Address,
): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'removeTokenOverride',
    args: [token],
  })

  console.log(`[Director] Removed token override for ${token}`)
  return hash
}
export async function directorSetTreasury(newTreasury: Address): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: feeConfigAbi,
    functionName: 'setTreasury',
    args: [newTreasury],
  })

  console.log(`[Director] Updated treasury to ${newTreasury}`)
  return hash
}
export const directorFeeSkills = [
  {
    id: 'get-fees',
    description: 'Get current fee configuration for all categories',
    parameters: {},
  },
  {
    id: 'set-distribution-fees',
    description: 'Set app/LP/contributor revenue distribution',
    parameters: {
      appShareBps: 'App developer share (0-10000)',
      lpShareBps: 'Liquidity provider share (0-10000)',
      contributorShareBps: 'Contributor pool share (0-10000)',
      ethLpShareBps: 'ETH LP share (default 7000 = 70%)',
      tokenLpShareBps: 'Token LP share (default 3000 = 30%)',
    },
  },
  {
    id: 'set-compute-fees',
    description: 'Set compute service platform fees',
    parameters: {
      inferencePlatformFeeBps: 'AI inference platform fee',
      rentalPlatformFeeBps: 'Compute rental platform fee',
      triggerPlatformFeeBps: 'Cron trigger platform fee',
    },
  },
  {
    id: 'set-storage-fees',
    description: 'Set storage service fees',
    parameters: {
      uploadFeeBps: 'Upload fee',
      retrievalFeeBps: 'Retrieval fee',
      pinningFeeBps: 'IPFS pinning fee',
    },
  },
  {
    id: 'set-defi-fees',
    description: 'Set DeFi protocol fees',
    parameters: {
      swapProtocolFeeBps: 'Swap protocol fee (default 5 = 0.05%)',
      bridgeFeeBps: 'Bridge fee (default 10 = 0.1%)',
      crossChainMarginBps: 'Cross-chain margin (default 1000 = 10%)',
    },
  },
  {
    id: 'set-infrastructure-fees',
    description: 'Set infrastructure revenue shares',
    parameters: {
      sequencerRevenueShareBps: 'Sequencer revenue share',
      oracleTreasuryShareBps: 'Oracle treasury share',
      rpcPremiumFeeBps: 'RPC premium fee',
      messagingFeeBps: 'Cross-chain messaging fee',
    },
  },
  {
    id: 'set-marketplace-fees',
    description: 'Set marketplace platform fees',
    parameters: {
      bazaarPlatformFeeBps: 'Bazaar marketplace fee (default 250 = 2.5%)',
      launchpadCreatorFeeBps: 'Token creator share on launchpad',
      launchpadCommunityFeeBps: 'Community share on launchpad',
      x402ProtocolFeeBps: 'X402 payment protocol fee (default 50 = 0.5%)',
    },
  },
  {
    id: 'set-names-fees',
    description: 'Set JNS name registration fees',
    parameters: {
      baseRegistrationPrice: 'Base registration price in wei',
      agentDiscountBps: 'Discount for verified agents',
      renewalDiscountBps: 'Discount for renewals',
    },
  },
  {
    id: 'set-token-fees',
    description: 'Set default token economics',
    parameters: {
      xlpRewardShareBps: 'XLP reward share (default 8000 = 80%)',
      protocolShareBps: 'Protocol treasury share (default 1000 = 10%)',
      burnShareBps: 'Deflationary burn (default 1000 = 10%)',
      transferFeeBps: 'Transfer fee (default 0)',
      bridgeFeeMinBps: 'Min bridge fee (default 5 = 0.05%)',
      bridgeFeeMaxBps: 'Max bridge fee (default 100 = 1%)',
    },
  },
  {
    id: 'set-token-override',
    description: 'Set custom fees for a specific token',
    parameters: {
      token: 'Token address',
      xlpRewardShareBps: 'XLP reward share',
      protocolShareBps: 'Protocol share',
      burnShareBps: 'Burn share',
    },
  },
  {
    id: 'execute-fee-change',
    description: 'Execute a pending fee change proposed by board',
    parameters: {
      changeId: 'The change ID to execute (bytes32)',
    },
  },
  {
    id: 'cancel-fee-change',
    description: 'Cancel a pending fee change',
    parameters: {
      changeId: 'The change ID to cancel (bytes32)',
    },
  },
]

/**
 * Execute a Director fee skill
 */
type SkillParams = {
  appShareBps?: number | string
  lpShareBps?: number | string
  contributorShareBps?: number | string
  ethLpShareBps?: number | string
  tokenLpShareBps?: number | string
  inferencePlatformFeeBps?: number | string
  rentalPlatformFeeBps?: number | string
  triggerPlatformFeeBps?: number | string
  uploadFeeBps?: number | string
  retrievalFeeBps?: number | string
  pinningFeeBps?: number | string
  swapProtocolFeeBps?: number | string
  bridgeFeeBps?: number | string
  crossChainMarginBps?: number | string
  sequencerRevenueShareBps?: number | string
  oracleTreasuryShareBps?: number | string
  rpcPremiumFeeBps?: number | string
  messagingFeeBps?: number | string
  bazaarPlatformFeeBps?: number | string
  launchpadCreatorFeeBps?: number | string
  launchpadCommunityFeeBps?: number | string
  x402ProtocolFeeBps?: number | string
  baseRegistrationPrice?: string | bigint
  agentDiscountBps?: number | string
  renewalDiscountBps?: number | string
  xlpRewardShareBps?: number | string
  protocolShareBps?: number | string
  burnShareBps?: number | string
  transferFeeBps?: number | string
  bridgeFeeMinBps?: number | string
  bridgeFeeMaxBps?: number | string
  xlpMinStakeBps?: number | string
  zkProofDiscountBps?: number | string
  token?: Address
  changeId?: Hex
}

export interface TxHashResult {
  txHash: Hash
}

export type SkillResult = {
  success: boolean
  result: FeeConfigState | TxHashResult | null
  error?: string
}

/** Type guard for transaction hash result */
export function isTxHashResult(
  result: SkillResult['result'],
): result is TxHashResult {
  return result !== null && 'txHash' in result
}

export async function executeDirectorFeeSkill(
  skillId: string,
  params: SkillParams,
): Promise<SkillResult> {
  try {
    switch (skillId) {
      case 'get-fees': {
        const state = await getFeeConfigState()
        return {
          success: true,
          result: state,
        }
      }

      case 'set-distribution-fees': {
        const hash = await directorSetDistributionFees({
          appShareBps: Number(params.appShareBps),
          lpShareBps: Number(params.lpShareBps),
          contributorShareBps: Number(params.contributorShareBps),
          ethLpShareBps: Number(params.ethLpShareBps ?? 7000),
          tokenLpShareBps: Number(params.tokenLpShareBps ?? 3000),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-compute-fees': {
        const hash = await directorSetComputeFees({
          inferencePlatformFeeBps: Number(params.inferencePlatformFeeBps),
          rentalPlatformFeeBps: Number(params.rentalPlatformFeeBps),
          triggerPlatformFeeBps: Number(params.triggerPlatformFeeBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-storage-fees': {
        const hash = await directorSetStorageFees({
          uploadFeeBps: Number(params.uploadFeeBps),
          retrievalFeeBps: Number(params.retrievalFeeBps),
          pinningFeeBps: Number(params.pinningFeeBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-defi-fees': {
        const hash = await directorSetDeFiFees({
          swapProtocolFeeBps: Number(params.swapProtocolFeeBps),
          bridgeFeeBps: Number(params.bridgeFeeBps),
          crossChainMarginBps: Number(params.crossChainMarginBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-infrastructure-fees': {
        const hash = await directorSetInfrastructureFees({
          sequencerRevenueShareBps: Number(params.sequencerRevenueShareBps),
          oracleTreasuryShareBps: Number(params.oracleTreasuryShareBps),
          rpcPremiumFeeBps: Number(params.rpcPremiumFeeBps),
          messagingFeeBps: Number(params.messagingFeeBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-marketplace-fees': {
        const hash = await directorSetMarketplaceFees({
          bazaarPlatformFeeBps: Number(params.bazaarPlatformFeeBps),
          launchpadCreatorFeeBps: Number(params.launchpadCreatorFeeBps),
          launchpadCommunityFeeBps: Number(params.launchpadCommunityFeeBps),
          x402ProtocolFeeBps: Number(params.x402ProtocolFeeBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-names-fees': {
        if (params.baseRegistrationPrice === undefined) {
          throw new Error('baseRegistrationPrice is required')
        }
        const hash = await directorSetNamesFees({
          baseRegistrationPrice: toBigInt(params.baseRegistrationPrice),
          agentDiscountBps: Number(params.agentDiscountBps),
          renewalDiscountBps: Number(params.renewalDiscountBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-token-fees': {
        const hash = await directorSetTokenFees({
          xlpRewardShareBps: Number(params.xlpRewardShareBps),
          protocolShareBps: Number(params.protocolShareBps),
          burnShareBps: Number(params.burnShareBps),
          transferFeeBps: Number(params.transferFeeBps ?? 0),
          bridgeFeeMinBps: Number(params.bridgeFeeMinBps ?? 5),
          bridgeFeeMaxBps: Number(params.bridgeFeeMaxBps ?? 100),
          xlpMinStakeBps: Number(params.xlpMinStakeBps ?? 1000),
          zkProofDiscountBps: Number(params.zkProofDiscountBps ?? 2000),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-token-override': {
        const token = params.token
        if (!token) {
          throw new Error('token is required for set-token-override')
        }
        const hash = await directorSetTokenOverride(token, {
          xlpRewardShareBps: Number(params.xlpRewardShareBps),
          protocolShareBps: Number(params.protocolShareBps),
          burnShareBps: Number(params.burnShareBps),
          transferFeeBps: Number(params.transferFeeBps ?? 0),
          bridgeFeeMinBps: Number(params.bridgeFeeMinBps ?? 5),
          bridgeFeeMaxBps: Number(params.bridgeFeeMaxBps ?? 100),
          xlpMinStakeBps: Number(params.xlpMinStakeBps ?? 1000),
          zkProofDiscountBps: Number(params.zkProofDiscountBps ?? 2000),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'execute-fee-change': {
        if (!params.changeId) throw new Error('changeId is required')
        const hash = await directorExecuteFeeChange(params.changeId)
        return { success: true, result: { txHash: hash } }
      }

      case 'cancel-fee-change': {
        if (!params.changeId) throw new Error('changeId is required')
        const hash = await directorCancelFeeChange(params.changeId)
        return { success: true, result: { txHash: hash } }
      }

      default:
        return {
          success: false,
          result: null,
          error: `Unknown skill: ${skillId}`,
        }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, result: null, error: message }
  }
}

/**
 * Get pending fee changes
 */
export async function getPendingFeeChanges(): Promise<PendingFeeChange[]> {
  const { address, public: client } = ensureReadOnly()

  // Query FeeChangeProposed events that haven't been executed or cancelled
  const proposedLogs = await client.getLogs({
    address,
    event: {
      type: 'event',
      name: 'FeeChangeProposed',
      inputs: [
        { name: 'changeId', type: 'bytes32', indexed: true },
        { name: 'feeType', type: 'bytes32', indexed: false },
        { name: 'effectiveAt', type: 'uint256', indexed: false },
        { name: 'proposedBy', type: 'address', indexed: false },
      ],
    },
    fromBlock: 'earliest',
    toBlock: 'latest',
  })

  const executedLogs = await client.getLogs({
    address,
    event: {
      type: 'event',
      name: 'FeeChangeExecuted',
      inputs: [{ name: 'changeId', type: 'bytes32', indexed: true }],
    },
    fromBlock: 'earliest',
    toBlock: 'latest',
  })

  const cancelledLogs = await client.getLogs({
    address,
    event: {
      type: 'event',
      name: 'FeeChangeCancelled',
      inputs: [{ name: 'changeId', type: 'bytes32', indexed: true }],
    },
    fromBlock: 'earliest',
    toBlock: 'latest',
  })

  const executedIds = new Set(executedLogs.map((l) => l.args.changeId as Hex))
  const cancelledIds = new Set(cancelledLogs.map((l) => l.args.changeId as Hex))

  const pending: PendingFeeChange[] = []
  for (const log of proposedLogs) {
    const changeId = log.args.changeId as Hex
    if (!executedIds.has(changeId) && !cancelledIds.has(changeId)) {
      pending.push({
        changeId,
        feeType: log.args.feeType as Hex,
        effectiveAt: Number(log.args.effectiveAt),
        proposedBy: log.args.proposedBy as Address,
        executed: false,
      })
    }
  }

  return pending
}

export interface FeeChangeHistoryEntry {
  changeId: Hex
  feeType: Hex
  effectiveAt: number
  proposedBy: Address
  status: 'proposed' | 'executed' | 'cancelled'
  blockNumber: bigint
  transactionHash: Hex
}

/**
 * Get fee change history
 */
export async function getFeeChangeHistory(
  limit = 50,
): Promise<FeeChangeHistoryEntry[]> {
  const { address, public: client } = ensureReadOnly()

  // Query all fee change events
  const [proposedLogs, executedLogs, cancelledLogs] = await Promise.all([
    client.getLogs({
      address,
      event: {
        type: 'event',
        name: 'FeeChangeProposed',
        inputs: [
          { name: 'changeId', type: 'bytes32', indexed: true },
          { name: 'feeType', type: 'bytes32', indexed: false },
          { name: 'effectiveAt', type: 'uint256', indexed: false },
          { name: 'proposedBy', type: 'address', indexed: false },
        ],
      },
      fromBlock: 'earliest',
      toBlock: 'latest',
    }),
    client.getLogs({
      address,
      event: {
        type: 'event',
        name: 'FeeChangeExecuted',
        inputs: [{ name: 'changeId', type: 'bytes32', indexed: true }],
      },
      fromBlock: 'earliest',
      toBlock: 'latest',
    }),
    client.getLogs({
      address,
      event: {
        type: 'event',
        name: 'FeeChangeCancelled',
        inputs: [{ name: 'changeId', type: 'bytes32', indexed: true }],
      },
      fromBlock: 'earliest',
      toBlock: 'latest',
    }),
  ])

  const executedMap = new Map<
    Hex,
    { blockNumber: bigint; transactionHash: Hex }
  >()
  const cancelledMap = new Map<
    Hex,
    { blockNumber: bigint; transactionHash: Hex }
  >()

  for (const log of executedLogs) {
    executedMap.set(log.args.changeId as Hex, {
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    })
  }

  for (const log of cancelledLogs) {
    cancelledMap.set(log.args.changeId as Hex, {
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    })
  }

  const history: FeeChangeHistoryEntry[] = []
  for (const log of proposedLogs) {
    const changeId = log.args.changeId as Hex
    const executed = executedMap.get(changeId)
    const cancelled = cancelledMap.get(changeId)

    let status: 'proposed' | 'executed' | 'cancelled' = 'proposed'
    let blockNumber = log.blockNumber
    let transactionHash = log.transactionHash

    if (executed) {
      status = 'executed'
      blockNumber = executed.blockNumber
      transactionHash = executed.transactionHash
    } else if (cancelled) {
      status = 'cancelled'
      blockNumber = cancelled.blockNumber
      transactionHash = cancelled.transactionHash
    }

    history.push({
      changeId,
      feeType: log.args.feeType as Hex,
      effectiveAt: Number(log.args.effectiveAt),
      proposedBy: log.args.proposedBy as Address,
      status,
      blockNumber,
      transactionHash,
    })
  }

  // Sort by block number descending (most recent first) and limit
  return history
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .slice(0, limit)
}
