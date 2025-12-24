import {
  Activity,
  AlertCircle,
  Check,
  Clock,
  type LucideProps,
  RefreshCw,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { type Address, formatEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

const RefreshCwIcon = RefreshCw as ComponentType<LucideProps>
const UsersIcon = Users as ComponentType<LucideProps>
const ActivityIcon = Activity as ComponentType<LucideProps>
const ClockIcon = Clock as ComponentType<LucideProps>
const ShieldIcon = Shield as ComponentType<LucideProps>
const TrendingUpIcon = TrendingUp as ComponentType<LucideProps>
const AlertCircleIcon = AlertCircle as ComponentType<LucideProps>
const CheckIcon = Check as ComponentType<LucideProps>

const SEQUENCER_REGISTRY_ADDRESS =
  (process.env.PUBLIC_SEQUENCER_REGISTRY as Address) ||
  '0x0000000000000000000000000000000000000000'
const FEDERATION_GOVERNANCE_ADDRESS =
  (process.env.PUBLIC_FEDERATION_GOVERNANCE as Address) ||
  '0x0000000000000000000000000000000000000000'

const FEDERATION_GOVERNANCE_ABI = [
  {
    name: 'getCurrentSequencer',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getVerifiedChainIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'currentSequencerIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'lastRotation',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'rotationInterval',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'rotateSequencer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'isSequencerEligible',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'chainId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const SEQUENCER_REGISTRY_ABI = [
  {
    name: 'getActiveSequencers',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'sequencers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'stake', type: 'uint256' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastBlockProposed', type: 'uint256' },
          { name: 'blocksProposed', type: 'uint256' },
          { name: 'blocksMissed', type: 'uint256' },
          { name: 'totalRewardsEarned', type: 'uint256' },
          { name: 'pendingRewards', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'totalStaked',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getSequencerCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'MIN_STAKE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

interface SequencerInfo {
  address: string
  agentId: bigint
  stake: bigint
  reputationScore: bigint
  registeredAt: bigint
  blocksProposed: bigint
  blocksMissed: bigint
  totalRewardsEarned: bigint
  pendingRewards: bigint
  isActive: boolean
  isSlashed: boolean
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum',
  10: 'Optimism',
  420691: 'Jeju',
  420690: 'Jeju Localnet',
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
}

function getChainName(chainId: number): string {
  return CHAIN_NAMES[chainId] || `Chain ${chainId}`
}

export function SequencerDashboard() {
  const { isConnected: _isConnected } = useAccount()
  const [selectedTab, setSelectedTab] = useState<
    'overview' | 'rotation' | 'sequencers'
  >('overview')

  // Read current sequencer
  const { data: currentSequencer } = useReadContract({
    address: FEDERATION_GOVERNANCE_ADDRESS,
    abi: FEDERATION_GOVERNANCE_ABI,
    functionName: 'getCurrentSequencer',
  })

  // Read verified chains
  const { data: verifiedChains } = useReadContract({
    address: FEDERATION_GOVERNANCE_ADDRESS,
    abi: FEDERATION_GOVERNANCE_ABI,
    functionName: 'getVerifiedChainIds',
  })

  // Read rotation timing
  const { data: lastRotation } = useReadContract({
    address: FEDERATION_GOVERNANCE_ADDRESS,
    abi: FEDERATION_GOVERNANCE_ABI,
    functionName: 'lastRotation',
  })

  const { data: rotationInterval } = useReadContract({
    address: FEDERATION_GOVERNANCE_ADDRESS,
    abi: FEDERATION_GOVERNANCE_ABI,
    functionName: 'rotationInterval',
  })

  // Read active sequencers
  const { data: activeSequencers } = useReadContract({
    address: SEQUENCER_REGISTRY_ADDRESS,
    abi: SEQUENCER_REGISTRY_ABI,
    functionName: 'getActiveSequencers',
  })

  // Read total staked
  const { data: totalStaked } = useReadContract({
    address: SEQUENCER_REGISTRY_ADDRESS,
    abi: SEQUENCER_REGISTRY_ABI,
    functionName: 'totalStaked',
  })

  // Rotate sequencer
  const {
    writeContract: rotateSequencer,
    data: rotateHash,
    isPending: isRotating,
  } = useWriteContract()
  const { isLoading: isRotateConfirming, isSuccess: isRotated } =
    useWaitForTransactionReceipt({ hash: rotateHash })

  const handleRotate = () => {
    rotateSequencer({
      address: FEDERATION_GOVERNANCE_ADDRESS,
      abi: FEDERATION_GOVERNANCE_ABI,
      functionName: 'rotateSequencer',
    })
  }

  // Calculate time until next rotation
  const getTimeUntilRotation = () => {
    if (!lastRotation || !rotationInterval) return 'Unknown'
    const nextRotation = Number(lastRotation) + Number(rotationInterval)
    const now = Math.floor(Date.now() / 1000)
    const remaining = nextRotation - now
    if (remaining <= 0) return 'Ready'
    const hours = Math.floor(remaining / 3600)
    const minutes = Math.floor((remaining % 3600) / 60)
    return `${hours}h ${minutes}m`
  }

  const canRotate = () => {
    if (!lastRotation || !rotationInterval) return false
    const nextRotation = Number(lastRotation) + Number(rotationInterval)
    return Math.floor(Date.now() / 1000) >= nextRotation
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Sequencer Network</h2>
          <p className="text-gray-500 mt-1">
            Manage decentralized sequencer rotation and selection
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRotate}
            disabled={!canRotate() || isRotating || isRotateConfirming}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCwIcon
              className={`w-4 h-4 ${isRotating || isRotateConfirming ? 'animate-spin' : ''}`}
            />
            {isRotating
              ? 'Rotating...'
              : isRotateConfirming
                ? 'Confirming...'
                : 'Rotate Sequencer'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b">
        {(['overview', 'rotation', 'sequencers'] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setSelectedTab(tab)}
            className={`pb-3 px-1 font-medium capitalize ${
              selectedTab === tab
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      {selectedTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Current Sequencer */}
          <div className="bg-white rounded-xl p-6 border shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-green-100 rounded-lg">
                <ShieldIcon className="w-5 h-5 text-green-600" />
              </div>
              <span className="text-sm text-gray-500">Current Sequencer</span>
            </div>
            <div className="text-2xl font-bold">
              {currentSequencer
                ? getChainName(Number(currentSequencer))
                : 'Loading...'}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              Chain ID: {currentSequencer?.toString() || '-'}
            </div>
          </div>

          {/* Active Chains */}
          <div className="bg-white rounded-xl p-6 border shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-100 rounded-lg">
                <ActivityIcon className="w-5 h-5 text-blue-600" />
              </div>
              <span className="text-sm text-gray-500">Verified Chains</span>
            </div>
            <div className="text-2xl font-bold">
              {verifiedChains?.length ?? 0}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              Eligible for sequencing
            </div>
          </div>

          {/* Time Until Rotation */}
          <div className="bg-white rounded-xl p-6 border shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-100 rounded-lg">
                <ClockIcon className="w-5 h-5 text-purple-600" />
              </div>
              <span className="text-sm text-gray-500">Next Rotation</span>
            </div>
            <div className="text-2xl font-bold">{getTimeUntilRotation()}</div>
            <div className="text-sm text-gray-500 mt-1">
              Interval:{' '}
              {rotationInterval ? `${Number(rotationInterval) / 3600}h` : '-'}
            </div>
          </div>

          {/* Total Staked */}
          <div className="bg-white rounded-xl p-6 border shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-orange-100 rounded-lg">
                <TrendingUpIcon className="w-5 h-5 text-orange-600" />
              </div>
              <span className="text-sm text-gray-500">Total Staked</span>
            </div>
            <div className="text-2xl font-bold">
              {totalStaked ? `${formatEther(totalStaked)} JEJU` : '0 JEJU'}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {activeSequencers?.length ?? 0} active sequencers
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'rotation' && (
        <div className="space-y-6">
          {/* Rotation Schedule */}
          <div className="bg-white rounded-xl p-6 border shadow-sm">
            <h3 className="text-lg font-semibold mb-4">Rotation Schedule</h3>
            <div className="space-y-4">
              {verifiedChains?.map((chainId, index) => {
                const isCurrent = chainId === currentSequencer
                const currentIdx = currentSequencer
                  ? verifiedChains.indexOf(currentSequencer)
                  : -1
                const isNext =
                  verifiedChains.length > 1 &&
                  currentIdx >= 0 &&
                  verifiedChains[(currentIdx + 1) % verifiedChains.length] ===
                    chainId

                return (
                  <div
                    key={chainId.toString()}
                    className={`flex items-center justify-between p-4 rounded-lg ${
                      isCurrent
                        ? 'bg-green-50 border border-green-200'
                        : isNext
                          ? 'bg-blue-50 border border-blue-200'
                          : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          isCurrent
                            ? 'bg-green-500 text-white'
                            : isNext
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-300'
                        }`}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-medium">
                          {getChainName(Number(chainId))}
                        </div>
                        <div className="text-sm text-gray-500">
                          Chain ID: {chainId.toString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isCurrent && (
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                          Current
                        </span>
                      )}
                      {isNext && (
                        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                          Next
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}

              {(!verifiedChains || verifiedChains.length === 0) && (
                <div className="text-center py-8 text-gray-500">
                  <AlertCircleIcon className="w-8 h-8 mx-auto mb-2" />
                  <p>No verified chains available</p>
                </div>
              )}
            </div>
          </div>

          {/* Rotation Controls */}
          <div className="bg-white rounded-xl p-6 border shadow-sm">
            <h3 className="text-lg font-semibold mb-4">Manual Rotation</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600">
                  Trigger a sequencer rotation when the interval has passed.
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Rotation is permissionless - anyone can trigger it once ready.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRotate}
                disabled={!canRotate() || isRotating || isRotateConfirming}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRotated ? (
                  <>
                    <CheckIcon className="w-5 h-5" />
                    Rotated
                  </>
                ) : (
                  <>
                    <RefreshCwIcon
                      className={`w-5 h-5 ${isRotating || isRotateConfirming ? 'animate-spin' : ''}`}
                    />
                    {isRotating
                      ? 'Rotating...'
                      : isRotateConfirming
                        ? 'Confirming...'
                        : 'Rotate Now'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'sequencers' && (
        <div className="bg-white rounded-xl p-6 border shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Active Sequencers</h3>
          <div className="space-y-4">
            {activeSequencers?.map((addr: Address) => (
              <SequencerCard key={addr} address={addr} />
            ))}

            {(!activeSequencers || activeSequencers.length === 0) && (
              <div className="text-center py-8 text-gray-500">
                <UsersIcon className="w-8 h-8 mx-auto mb-2" />
                <p>No active sequencers</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SequencerCard({ address: addr }: { address: Address }) {
  const { data: sequencerData } = useReadContract({
    address: SEQUENCER_REGISTRY_ADDRESS,
    abi: SEQUENCER_REGISTRY_ABI,
    functionName: 'sequencers',
    args: [addr],
  })

  if (!sequencerData) return null

  // Destructure the contract return tuple into a typed object
  const seq: SequencerInfo = {
    address: addr,
    agentId: sequencerData.agentId,
    stake: sequencerData.stake,
    reputationScore: sequencerData.reputationScore,
    registeredAt: sequencerData.registeredAt,
    blocksProposed: sequencerData.blocksProposed,
    blocksMissed: sequencerData.blocksMissed,
    totalRewardsEarned: sequencerData.totalRewardsEarned,
    pendingRewards: sequencerData.pendingRewards,
    isActive: sequencerData.isActive,
    isSlashed: sequencerData.isSlashed,
  }
  const uptime =
    seq.blocksProposed > 0n
      ? (
          (Number(seq.blocksProposed) /
            (Number(seq.blocksProposed) + Number(seq.blocksMissed))) *
          100
        ).toFixed(1)
      : '100.0'

  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center gap-4">
        <div
          className={`w-3 h-3 rounded-full ${seq.isActive && !seq.isSlashed ? 'bg-green-500' : 'bg-red-500'}`}
        />
        <div>
          <div className="font-mono text-sm">
            {addr.slice(0, 8)}...{addr.slice(-6)}
          </div>
          <div className="text-sm text-gray-500">
            Agent #{seq.agentId.toString()}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="text-sm font-medium">
            {formatEther(seq.stake)} JEJU
          </div>
          <div className="text-xs text-gray-500">Staked</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">
            {seq.blocksProposed.toString()}
          </div>
          <div className="text-xs text-gray-500">Blocks</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">{uptime}%</div>
          <div className="text-xs text-gray-500">Uptime</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">
            {formatEther(seq.pendingRewards)} JEJU
          </div>
          <div className="text-xs text-gray-500">Pending</div>
        </div>
      </div>
    </div>
  )
}

export default SequencerDashboard
