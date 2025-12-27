import { readContract } from '@jejunetwork/contracts'
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  type LucideProps,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import {
  getAccount,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions'
import { CONTRACTS } from '../../../lib/config'
import { getConfig } from '../../../lib/wagmi-config'
import {
  useFeedRegistry,
  useOperatorCommittees,
} from '../../hooks/useOracleNetwork'

const UsersIcon = Users as ComponentType<LucideProps>
const ShieldIcon = Shield as ComponentType<LucideProps>
const ActivityIcon = Activity as ComponentType<LucideProps>
const TrendingUpIcon = TrendingUp as ComponentType<LucideProps>
const ClockIcon = Clock as ComponentType<LucideProps>
const AlertCircleIcon = AlertCircle as ComponentType<LucideProps>
const CheckCircleIcon = CheckCircle as ComponentType<LucideProps>

interface OperatorsViewProps {
  onRegister?: () => void
}

export function OperatorsView({ onRegister }: OperatorsViewProps) {
  const { isConnected, address } = useAccount()
  const { assignedFeeds, refetch } = useOperatorCommittees(address)
  const { activeFeedIds } = useFeedRegistry()
  const [showRegistration, setShowRegistration] = useState(false)

  if (!isConnected) {
    return (
      <div className="card p-8 text-center">
        <UsersIcon size={48} className="mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Connect Wallet</h3>
        <p className="text-gray-500">
          Connect your wallet to register as an oracle operator or view your
          assignments.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Operator Status Card */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <ShieldIcon size={20} />
            Operator Status
          </h3>
          {assignedFeeds.length > 0 ? (
            <span className="flex items-center gap-1 text-green-500 text-sm">
              <CheckCircleIcon size={16} />
              Active
            </span>
          ) : (
            <span className="flex items-center gap-1 text-gray-500 text-sm">
              <AlertCircleIcon size={16} />
              Not Registered
            </span>
          )}
        </div>

        {assignedFeeds.length > 0 ? (
          <div className="space-y-4">
            <div className="grid grid-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">Assigned Feeds</div>
                <div className="text-2xl font-bold">{assignedFeeds.length}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">
                  Available Feeds
                </div>
                <div className="text-2xl font-bold">{activeFeedIds.length}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Coverage</div>
                <div className="text-2xl font-bold">
                  {activeFeedIds.length > 0
                    ? `${Math.round((assignedFeeds.length / activeFeedIds.length) * 100)}%`
                    : '0%'}
                </div>
              </div>
            </div>

            {/* Assigned Feeds List */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="text-sm font-medium mb-2">
                Your Committee Assignments
              </div>
              <div className="grid gap-2">
                {assignedFeeds.map((feedId) => (
                  <div
                    key={feedId}
                    className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800"
                  >
                    <span className="font-mono text-sm">
                      {feedId.slice(0, 10)}...{feedId.slice(-8)}
                    </span>
                    <span className="flex items-center gap-1 text-green-500 text-xs">
                      <ActivityIcon size={12} />
                      Active
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-gray-500 mb-4">
              You are not registered as an oracle operator. Register to start
              providing price data and earn rewards.
            </p>
            <button
              type="button"
              className="button"
              onClick={() => setShowRegistration(true)}
            >
              Register as Operator
            </button>
          </div>
        )}
      </div>

      {/* Registration Form */}
      {showRegistration && (
        <OperatorRegistrationForm
          onClose={() => setShowRegistration(false)}
          onSuccess={() => {
            setShowRegistration(false)
            refetch()
            onRegister?.()
          }}
        />
      )}

      {/* Performance Metrics (if registered) */}
      {assignedFeeds.length > 0 && <PerformanceMetrics />}

      {/* Requirements Card */}
      <OperatorRequirements />
    </div>
  )
}

function OperatorRegistrationForm({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const { address } = useAccount()
  const [workerKey, setWorkerKey] = useState('')
  const [stakingOracleId, setStakingOracleId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRegister = async () => {
    if (!workerKey || !address) {
      setError('Worker key is required')
      return
    }

    setIsRegistering(true)
    setError(null)

    try {
      const config = getConfig()

      // OracleNetworkConnector ABI for registration
      const ORACLE_NETWORK_ABI = [
        {
          name: 'registerOperator',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'workerKey', type: 'address' },
            { name: 'stakingOracleId', type: 'bytes32' },
            { name: 'agentId', type: 'uint256' },
          ],
          outputs: [],
        },
      ] as const

      const contractAddress = CONTRACTS.oracleNetworkConnector

      const account = getAccount(config)
      if (!account.address || !account.chain) {
        throw new Error('Wallet not connected')
      }

      const hash = await writeContract(config, {
        address: contractAddress,
        abi: ORACLE_NETWORK_ABI,
        functionName: 'registerOperator',
        args: [
          workerKey as `0x${string}`,
          (stakingOracleId ||
            '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
          BigInt(agentId ?? '0'),
        ],
        chain: account.chain,
        account: account.address,
      })

      // Wait for confirmation
      await waitForTransactionReceipt(config, { hash })

      onSuccess()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      setError(message)
    } finally {
      setIsRegistering(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">Register as Oracle Operator</h3>
        <button
          type="button"
          className="text-gray-500 hover:text-gray-700"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="space-y-4">
        {/* Worker Key */}
        <div>
          <label
            htmlFor="worker-key"
            className="block text-sm font-medium mb-1"
          >
            Worker Key Address
          </label>
          <input
            id="worker-key"
            type="text"
            className="input w-full"
            placeholder="0x..."
            value={workerKey}
            onChange={(e) => setWorkerKey(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">
            Address that will sign price reports. Can be different from your
            wallet.
          </p>
        </div>

        {/* Staking Oracle ID (optional) */}
        <div>
          <label
            htmlFor="staking-oracle-id-display"
            className="block text-sm font-medium mb-1"
          >
            Staking Oracle ID <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="staking-oracle-id-display"
            type="text"
            className="input w-full"
            placeholder="0x... (if registered with OracleStakingManager)"
            value={stakingOracleId}
            onChange={(e) => setStakingOracleId(e.target.value)}
          />
        </div>

        {/* Agent ID (optional) */}
        <div>
          <label htmlFor="agent-id" className="block text-sm font-medium mb-1">
            ERC-8004 Agent ID <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="agent-id"
            type="number"
            className="input w-full"
            placeholder="Agent ID for reputation tracking"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          />
        </div>

        {/* Info Box */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircleIcon size={16} className="text-blue-500 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-700 dark:text-blue-300">
                Requirements for Operators
              </p>
              <ul className="mt-1 text-blue-600 dark:text-blue-400 space-y-1">
                <li>• Run a reliable oracle node with 99%+ uptime</li>
                <li>• Stake tokens for slashing protection</li>
                <li>• Maintain accurate price submissions</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-4">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={isRegistering}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            onClick={handleRegister}
            disabled={isRegistering || !workerKey}
          >
            {isRegistering ? 'Registering...' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PerformanceMetrics() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const [metrics, setMetrics] = useState({
    reportsSubmitted: 0,
    reportsAccepted: 0,
    accuracy: 0,
    uptime: 0,
    disputes: 0,
    epoch: 0,
  })
  const [loading, setLoading] = useState(true)

  // Fetch operator metrics from contract
  useState(() => {
    if (!address || !publicClient) return

    const fetchMetrics = async () => {
      try {
        const contractAddress = CONTRACTS.oracleNetworkConnector

        const METRICS_ABI = [
          {
            name: 'getOperatorMetrics',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'operator', type: 'address' }],
            outputs: [
              { name: 'reportsSubmitted', type: 'uint256' },
              { name: 'reportsAccepted', type: 'uint256' },
              { name: 'disputesLost', type: 'uint256' },
              { name: 'lastActiveEpoch', type: 'uint256' },
            ],
          },
          {
            name: 'currentEpoch',
            type: 'function',
            stateMutability: 'view',
            inputs: [],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ] as const

        const [operatorMetrics, currentEpoch] = await Promise.all([
          readContract(publicClient, {
            address: contractAddress,
            abi: METRICS_ABI,
            functionName: 'getOperatorMetrics',
            args: [address],
          }) as Promise<readonly [bigint, bigint, bigint, bigint]>,
          readContract(publicClient, {
            address: contractAddress,
            abi: METRICS_ABI,
            functionName: 'currentEpoch',
          }) as Promise<bigint>,
        ])

        const submitted = Number(operatorMetrics[0])
        const accepted = Number(operatorMetrics[1])
        const disputes = Number(operatorMetrics[2])
        const lastEpoch = Number(operatorMetrics[3])
        const epoch = Number(currentEpoch)

        // Calculate uptime based on epoch participation
        const uptime = epoch > 0 ? Math.min((lastEpoch / epoch) * 100, 100) : 0

        setMetrics({
          reportsSubmitted: submitted,
          reportsAccepted: accepted,
          accuracy: submitted > 0 ? (accepted / submitted) * 100 : 0,
          uptime: Math.round(uptime * 100) / 100,
          disputes,
          epoch,
        })
      } catch (err) {
        console.error('Failed to fetch operator metrics:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchMetrics()
  })

  if (loading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
          <div className="grid grid-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-16 bg-gray-200 dark:bg-gray-700 rounded"
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-6">
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
        <TrendingUpIcon size={20} />
        Performance Metrics
      </h3>

      <div className="grid grid-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">Reports Submitted</div>
          <div className="text-xl font-bold">
            {metrics.reportsSubmitted.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Acceptance Rate</div>
          <div className="text-xl font-bold text-green-500">
            {metrics.accuracy.toFixed(2)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Uptime</div>
          <div className="text-xl font-bold text-green-500">
            {metrics.uptime}%
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Disputes Lost</div>
          <div className="text-xl font-bold">{metrics.disputes}</div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500 flex items-center gap-1">
            <ClockIcon size={14} />
            Current Epoch
          </span>
          <span className="font-mono">{metrics.epoch}</span>
        </div>
      </div>
    </div>
  )
}

function OperatorRequirements() {
  return (
    <div className="card p-6">
      <h3 className="text-lg font-bold mb-4">Operator Requirements</h3>

      <div className="space-y-3">
        <RequirementItem
          title="Stake Requirement"
          description="Minimum $1,000 USD equivalent stake in approved tokens"
          met={false}
        />
        <RequirementItem
          title="Worker Node"
          description="Run an oracle node that can sign and submit price reports"
          met={false}
        />
        <RequirementItem
          title="Data Sources"
          description="Access to onchain DEX data (Uniswap v3, etc.) without API keys"
          met={false}
        />
        <RequirementItem
          title="Uptime"
          description="Maintain 99%+ uptime for heartbeat submissions"
          met={false}
        />
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <a
          href="https://docs.jejunetwork.org/oracle/operators"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-purple-500 hover:text-purple-600"
        >
          View full operator documentation →
        </a>
      </div>
    </div>
  )
}

function RequirementItem({
  title,
  description,
  met,
}: {
  title: string
  description: string
  met: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 ${met ? 'text-green-500' : 'text-gray-300'}`}>
        {met ? (
          <CheckCircleIcon size={18} />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-current" />
        )}
      </div>
      <div>
        <div className="font-medium text-sm">{title}</div>
        <div className="text-xs text-gray-500">{description}</div>
      </div>
    </div>
  )
}

export default OperatorsView
