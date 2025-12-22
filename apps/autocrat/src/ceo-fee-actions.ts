/**
 * @module CEOFeeActions
 * @description CEO-controlled fee management for the entire Jeju network
 *
 * The AI CEO has the authority to:
 * - Execute fee changes proposed by the council
 * - Make emergency fee adjustments (with timelock for increases)
 * - Set token-specific fee overrides
 * - Configure service pricing across all network components
 *
 * Fee Categories:
 * - Distribution: App/LP/Contributor splits
 * - Compute: Inference, rental, trigger fees
 * - Storage: Upload, retrieval, pinning fees
 * - DeFi: Swap, bridge, cross-chain margins
 * - Infrastructure: Sequencer, oracle, RPC fees
 * - Marketplace: Bazaar, launchpad, x402 fees
 * - Names: JNS registration and renewal
 * - Token: XLP rewards, protocol share, burn, bridge fees
 */

import {
  type Address,
  type createPublicClient,
  type createWalletClient,
  type Hash,
  type Hex,
  parseAbi,
} from 'viem'

// ============ Types ============

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
  council: Address
  ceo: Address
}

// ============ ABI ============

const FEE_CONFIG_ABI = parseAbi([
  // View functions
  'function getDistributionFees() view returns (tuple(uint16 appShareBps, uint16 lpShareBps, uint16 contributorShareBps, uint16 ethLpShareBps, uint16 tokenLpShareBps))',
  'function getComputeFees() view returns (tuple(uint16 inferencePlatformFeeBps, uint16 rentalPlatformFeeBps, uint16 triggerPlatformFeeBps))',
  'function getStorageFees() view returns (tuple(uint16 uploadFeeBps, uint16 retrievalFeeBps, uint16 pinningFeeBps))',
  'function getDeFiFees() view returns (tuple(uint16 swapProtocolFeeBps, uint16 bridgeFeeBps, uint16 crossChainMarginBps))',
  'function getInfrastructureFees() view returns (tuple(uint16 sequencerRevenueShareBps, uint16 oracleTreasuryShareBps, uint16 rpcPremiumFeeBps, uint16 messagingFeeBps))',
  'function getMarketplaceFees() view returns (tuple(uint16 bazaarPlatformFeeBps, uint16 launchpadCreatorFeeBps, uint16 launchpadCommunityFeeBps, uint16 x402ProtocolFeeBps))',
  'function getNamesFees() view returns (tuple(uint256 baseRegistrationPrice, uint16 agentDiscountBps, uint16 renewalDiscountBps))',
  'function getTokenFees() view returns (tuple(uint16 xlpRewardShareBps, uint16 protocolShareBps, uint16 burnShareBps, uint16 transferFeeBps, uint16 bridgeFeeMinBps, uint16 bridgeFeeMaxBps, uint16 xlpMinStakeBps, uint16 zkProofDiscountBps))',
  'function getTreasury() view returns (address)',
  'function council() view returns (address)',
  'function ceo() view returns (address)',

  // CEO functions
  'function executeFeeChange(bytes32 changeId) external',
  'function cancelFeeChange(bytes32 changeId) external',

  // Direct setters (owner only, but CEO can be owner)
  'function setDistributionFees(uint16 appShareBps, uint16 lpShareBps, uint16 contributorShareBps, uint16 ethLpShareBps, uint16 tokenLpShareBps) external',
  'function setComputeFees(uint16 inferencePlatformFeeBps, uint16 rentalPlatformFeeBps, uint16 triggerPlatformFeeBps) external',
  'function setStorageFees(uint16 uploadFeeBps, uint16 retrievalFeeBps, uint16 pinningFeeBps) external',
  'function setDeFiFees(uint16 swapProtocolFeeBps, uint16 bridgeFeeBps, uint16 crossChainMarginBps) external',
  'function setInfrastructureFees(uint16 sequencerRevenueShareBps, uint16 oracleTreasuryShareBps, uint16 rpcPremiumFeeBps, uint16 messagingFeeBps) external',
  'function setMarketplaceFees(uint16 bazaarPlatformFeeBps, uint16 launchpadCreatorFeeBps, uint16 launchpadCommunityFeeBps, uint16 x402ProtocolFeeBps) external',
  'function setNamesFees(uint256 baseRegistrationPrice, uint16 agentDiscountBps, uint16 renewalDiscountBps) external',
  'function setTokenFees(uint16 xlpRewardShareBps, uint16 protocolShareBps, uint16 burnShareBps, uint16 transferFeeBps, uint16 bridgeFeeMinBps, uint16 bridgeFeeMaxBps, uint16 xlpMinStakeBps, uint16 zkProofDiscountBps) external',
  'function setTokenOverride(address token, uint16 xlpRewardShareBps, uint16 protocolShareBps, uint16 burnShareBps, uint16 transferFeeBps, uint16 bridgeFeeMinBps, uint16 bridgeFeeMaxBps, uint16 xlpMinStakeBps, uint16 zkProofDiscountBps) external',
  'function removeTokenOverride(address token) external',
  'function setTreasury(address newTreasury) external',
  'function setCEO(address newCeo) external',
  'function setCouncil(address newCouncil) external',

  // Council proposes, CEO executes
  'function proposeFeeChange(bytes32 feeType, bytes newValues) external returns (bytes32 changeId)',

  // Events
  'event FeeChangeProposed(bytes32 indexed changeId, bytes32 feeType, uint256 effectiveAt, address proposedBy)',
  'event FeeChangeExecuted(bytes32 indexed changeId)',
  'event FeeChangeCancelled(bytes32 indexed changeId)',
])

// ============ State ============

let feeConfigAddress: Address | null = null
let publicClient: ReturnType<typeof createPublicClient> | null = null
let walletClient: ReturnType<typeof createWalletClient> | null = null

// ============ Initialization ============

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
    throw new Error('Fee actions not initialized. Call initializeFeeActions first.')
  }
  return { address: feeConfigAddress, public: publicClient }
}

function ensureWrite(): {
  address: Address
  public: ReturnType<typeof createPublicClient>
  wallet: ReturnType<typeof createWalletClient>
} {
  if (!feeConfigAddress || !publicClient || !walletClient) {
    throw new Error('Fee actions not initialized with wallet client. Write operations unavailable.')
  }
  return { address: feeConfigAddress, public: publicClient, wallet: walletClient }
}

// ============ View Functions ============

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
    council,
    ceo,
  ] = await Promise.all([
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'getDistributionFees' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'getComputeFees' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'getStorageFees' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'getDeFiFees' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'getInfrastructureFees' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'getMarketplaceFees' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'getNamesFees' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'getTokenFees' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'getTreasury' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'council' }),
    client.readContract({ address, abi: FEE_CONFIG_ABI, functionName: 'ceo' }),
  ])

  return {
    distribution: distribution as DistributionFees,
    compute: compute as ComputeFees,
    storage: storage as StorageFees,
    defi: defi as DeFiFees,
    infrastructure: infrastructure as InfrastructureFees,
    marketplace: marketplace as MarketplaceFees,
    names: names as NamesFees,
    token: token as TokenFees,
    treasury: treasury as Address,
    council: council as Address,
    ceo: ceo as Address,
  }
}

// ============ CEO Fee Change Execution ============

/**
 * Execute a pending fee change (CEO only)
 * The change must have been proposed by council and passed its timelock
 */
export async function ceoExecuteFeeChange(changeId: Hex): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'executeFeeChange',
    args: [changeId],
  })

  console.log(`[CEO] Executed fee change: ${changeId}`)
  return hash
}

/**
 * Cancel a pending fee change (CEO or Council)
 */
export async function ceoCancelFeeChange(changeId: Hex): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'cancelFeeChange',
    args: [changeId],
  })

  console.log(`[CEO] Cancelled fee change: ${changeId}`)
  return hash
}

// ============ Direct Fee Setters (when CEO is owner) ============

export async function ceoSetDistributionFees(fees: DistributionFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'setDistributionFees',
    args: [
      fees.appShareBps,
      fees.lpShareBps,
      fees.contributorShareBps,
      fees.ethLpShareBps,
      fees.tokenLpShareBps,
    ],
  })

  console.log(`[CEO] Updated distribution fees: app=${fees.appShareBps}, lp=${fees.lpShareBps}, contrib=${fees.contributorShareBps}`)
  return hash
}

export async function ceoSetComputeFees(fees: ComputeFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'setComputeFees',
    args: [fees.inferencePlatformFeeBps, fees.rentalPlatformFeeBps, fees.triggerPlatformFeeBps],
  })

  console.log(`[CEO] Updated compute fees: inference=${fees.inferencePlatformFeeBps}, rental=${fees.rentalPlatformFeeBps}`)
  return hash
}

export async function ceoSetStorageFees(fees: StorageFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'setStorageFees',
    args: [fees.uploadFeeBps, fees.retrievalFeeBps, fees.pinningFeeBps],
  })

  console.log(`[CEO] Updated storage fees: upload=${fees.uploadFeeBps}, retrieval=${fees.retrievalFeeBps}`)
  return hash
}

export async function ceoSetDeFiFees(fees: DeFiFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'setDeFiFees',
    args: [fees.swapProtocolFeeBps, fees.bridgeFeeBps, fees.crossChainMarginBps],
  })

  console.log(`[CEO] Updated DeFi fees: swap=${fees.swapProtocolFeeBps}, bridge=${fees.bridgeFeeBps}`)
  return hash
}

export async function ceoSetInfrastructureFees(fees: InfrastructureFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'setInfrastructureFees',
    args: [
      fees.sequencerRevenueShareBps,
      fees.oracleTreasuryShareBps,
      fees.rpcPremiumFeeBps,
      fees.messagingFeeBps,
    ],
  })

  console.log(`[CEO] Updated infrastructure fees: sequencer=${fees.sequencerRevenueShareBps}, oracle=${fees.oracleTreasuryShareBps}`)
  return hash
}

export async function ceoSetMarketplaceFees(fees: MarketplaceFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'setMarketplaceFees',
    args: [
      fees.bazaarPlatformFeeBps,
      fees.launchpadCreatorFeeBps,
      fees.launchpadCommunityFeeBps,
      fees.x402ProtocolFeeBps,
    ],
  })

  console.log(`[CEO] Updated marketplace fees: bazaar=${fees.bazaarPlatformFeeBps}, x402=${fees.x402ProtocolFeeBps}`)
  return hash
}

export async function ceoSetNamesFees(fees: NamesFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'setNamesFees',
    args: [fees.baseRegistrationPrice, fees.agentDiscountBps, fees.renewalDiscountBps],
  })

  console.log(`[CEO] Updated names fees: base=${fees.baseRegistrationPrice}, discount=${fees.agentDiscountBps}`)
  return hash
}

export async function ceoSetTokenFees(fees: TokenFees): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
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

  console.log(`[CEO] Updated token fees: xlp=${fees.xlpRewardShareBps}, protocol=${fees.protocolShareBps}, burn=${fees.burnShareBps}`)
  return hash
}

export async function ceoSetTokenOverride(
  token: Address,
  fees: TokenFees,
): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
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

  console.log(`[CEO] Set token override for ${token}: xlp=${fees.xlpRewardShareBps}`)
  return hash
}

export async function ceoRemoveTokenOverride(token: Address): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'removeTokenOverride',
    args: [token],
  })

  console.log(`[CEO] Removed token override for ${token}`)
  return hash
}

// ============ Governance Management ============

export async function ceoSetTreasury(newTreasury: Address): Promise<Hash> {
  const { address, wallet } = ensureWrite()

  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: wallet.account ?? null,
    address,
    abi: FEE_CONFIG_ABI,
    functionName: 'setTreasury',
    args: [newTreasury],
  })

  console.log(`[CEO] Updated treasury to ${newTreasury}`)
  return hash
}

// ============ CEO Fee Skills ============

export const ceoFeeSkills = [
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
    description: 'Execute a pending fee change proposed by council',
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
 * Execute a CEO fee skill
 */
export async function executeCEOFeeSkill(
  skillId: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; result: Record<string, unknown> | null; error?: string }> {
  try {
    switch (skillId) {
      case 'get-fees': {
        const state = await getFeeConfigState()
        return { success: true, result: state as unknown as Record<string, unknown> }
      }

      case 'set-distribution-fees': {
        const hash = await ceoSetDistributionFees({
          appShareBps: Number(params.appShareBps),
          lpShareBps: Number(params.lpShareBps),
          contributorShareBps: Number(params.contributorShareBps),
          ethLpShareBps: Number(params.ethLpShareBps || 7000),
          tokenLpShareBps: Number(params.tokenLpShareBps || 3000),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-compute-fees': {
        const hash = await ceoSetComputeFees({
          inferencePlatformFeeBps: Number(params.inferencePlatformFeeBps),
          rentalPlatformFeeBps: Number(params.rentalPlatformFeeBps),
          triggerPlatformFeeBps: Number(params.triggerPlatformFeeBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-storage-fees': {
        const hash = await ceoSetStorageFees({
          uploadFeeBps: Number(params.uploadFeeBps),
          retrievalFeeBps: Number(params.retrievalFeeBps),
          pinningFeeBps: Number(params.pinningFeeBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-defi-fees': {
        const hash = await ceoSetDeFiFees({
          swapProtocolFeeBps: Number(params.swapProtocolFeeBps),
          bridgeFeeBps: Number(params.bridgeFeeBps),
          crossChainMarginBps: Number(params.crossChainMarginBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-infrastructure-fees': {
        const hash = await ceoSetInfrastructureFees({
          sequencerRevenueShareBps: Number(params.sequencerRevenueShareBps),
          oracleTreasuryShareBps: Number(params.oracleTreasuryShareBps),
          rpcPremiumFeeBps: Number(params.rpcPremiumFeeBps),
          messagingFeeBps: Number(params.messagingFeeBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-marketplace-fees': {
        const hash = await ceoSetMarketplaceFees({
          bazaarPlatformFeeBps: Number(params.bazaarPlatformFeeBps),
          launchpadCreatorFeeBps: Number(params.launchpadCreatorFeeBps),
          launchpadCommunityFeeBps: Number(params.launchpadCommunityFeeBps),
          x402ProtocolFeeBps: Number(params.x402ProtocolFeeBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-names-fees': {
        const hash = await ceoSetNamesFees({
          baseRegistrationPrice: BigInt(params.baseRegistrationPrice as string),
          agentDiscountBps: Number(params.agentDiscountBps),
          renewalDiscountBps: Number(params.renewalDiscountBps),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-token-fees': {
        const hash = await ceoSetTokenFees({
          xlpRewardShareBps: Number(params.xlpRewardShareBps),
          protocolShareBps: Number(params.protocolShareBps),
          burnShareBps: Number(params.burnShareBps),
          transferFeeBps: Number(params.transferFeeBps || 0),
          bridgeFeeMinBps: Number(params.bridgeFeeMinBps || 5),
          bridgeFeeMaxBps: Number(params.bridgeFeeMaxBps || 100),
          xlpMinStakeBps: Number(params.xlpMinStakeBps || 1000),
          zkProofDiscountBps: Number(params.zkProofDiscountBps || 2000),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'set-token-override': {
        const hash = await ceoSetTokenOverride(params.token as Address, {
          xlpRewardShareBps: Number(params.xlpRewardShareBps),
          protocolShareBps: Number(params.protocolShareBps),
          burnShareBps: Number(params.burnShareBps),
          transferFeeBps: Number(params.transferFeeBps || 0),
          bridgeFeeMinBps: Number(params.bridgeFeeMinBps || 5),
          bridgeFeeMaxBps: Number(params.bridgeFeeMaxBps || 100),
          xlpMinStakeBps: Number(params.xlpMinStakeBps || 1000),
          zkProofDiscountBps: Number(params.zkProofDiscountBps || 2000),
        })
        return { success: true, result: { txHash: hash } }
      }

      case 'execute-fee-change': {
        const hash = await ceoExecuteFeeChange(params.changeId as Hex)
        return { success: true, result: { txHash: hash } }
      }

      case 'cancel-fee-change': {
        const hash = await ceoCancelFeeChange(params.changeId as Hex)
        return { success: true, result: { txHash: hash } }
      }

      default:
        return { success: false, result: null, error: `Unknown skill: ${skillId}` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, result: null, error: message }
  }
}

