'use client'

import { useEffect, useState } from 'react'
import { formatEther } from 'viem'
import { useReadContract } from 'wagmi'
import {
  AUTOMATION_REGISTRY_ABI,
  type AutomationConfigTuple,
  type AutomationStateTuple,
  CHAINLINK_CONTRACTS,
  CHAINLINK_GOVERNANCE_ABI,
  type ChainlinkStats,
  type GovernanceConfigTuple,
  ORACLE_ROUTER_ABI,
  type OracleConfigTuple,
  type OracleStatsTuple,
  parseAutomationConfig,
  parseAutomationState,
  parseGovernanceConfig,
  parseOracleConfig,
  parseOracleStats,
  parseRevenueConfig,
  parseVRFFeeConfig,
  type RevenueConfigTuple,
  VRF_COORDINATOR_ABI,
  type VRFFeeConfigTuple,
} from '../../config/chainlink'

function Tab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm rounded-t-lg ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
    >
      {label}
    </button>
  )
}

function Stat({
  title,
  value,
  sub,
}: {
  title: string
  value: string
  sub?: string
}) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

export function ChainlinkDashboard() {
  const [tab, setTab] = useState<
    'vrf' | 'automation' | 'oracle' | 'governance'
  >('vrf')
  const [stats, setStats] = useState<ChainlinkStats | null>(null)

  const { data: vrfFeeConfigRaw } = useReadContract({
    address: CHAINLINK_CONTRACTS.vrfCoordinator,
    abi: VRF_COORDINATOR_ABI,
    functionName: 'feeConfig',
  })
  const { data: vrfMinConf } = useReadContract({
    address: CHAINLINK_CONTRACTS.vrfCoordinator,
    abi: VRF_COORDINATOR_ABI,
    functionName: 'minimumRequestConfirmations',
  })
  const { data: vrfMaxGas } = useReadContract({
    address: CHAINLINK_CONTRACTS.vrfCoordinator,
    abi: VRF_COORDINATOR_ABI,
    functionName: 'maxGasLimit',
  })
  const { data: autoConfigRaw } = useReadContract({
    address: CHAINLINK_CONTRACTS.automationRegistry,
    abi: AUTOMATION_REGISTRY_ABI,
    functionName: 'config',
  })
  const { data: autoStateRaw } = useReadContract({
    address: CHAINLINK_CONTRACTS.automationRegistry,
    abi: AUTOMATION_REGISTRY_ABI,
    functionName: 'getState',
  })
  const { data: activeKeepers } = useReadContract({
    address: CHAINLINK_CONTRACTS.automationRegistry,
    abi: AUTOMATION_REGISTRY_ABI,
    functionName: 'getActiveKeepers',
  })
  const { data: oracleConfigRaw } = useReadContract({
    address: CHAINLINK_CONTRACTS.oracleRouter,
    abi: ORACLE_ROUTER_ABI,
    functionName: 'config',
  })
  const { data: oracleStatsRaw } = useReadContract({
    address: CHAINLINK_CONTRACTS.oracleRouter,
    abi: ORACLE_ROUTER_ABI,
    functionName: 'getStats',
  })
  const { data: activeOracles } = useReadContract({
    address: CHAINLINK_CONTRACTS.oracleRouter,
    abi: ORACLE_ROUTER_ABI,
    functionName: 'getActiveOracles',
  })
  const { data: govConfigRaw } = useReadContract({
    address: CHAINLINK_CONTRACTS.chainlinkGovernance,
    abi: CHAINLINK_GOVERNANCE_ABI,
    functionName: 'config',
  })
  const { data: revConfigRaw } = useReadContract({
    address: CHAINLINK_CONTRACTS.chainlinkGovernance,
    abi: CHAINLINK_GOVERNANCE_ABI,
    functionName: 'revenueConfig',
  })
  const { data: isPaused } = useReadContract({
    address: CHAINLINK_CONTRACTS.chainlinkGovernance,
    abi: CHAINLINK_GOVERNANCE_ABI,
    functionName: 'paused',
  })

  // Parse tuple data using type-safe helpers
  const vrfFeeConfig = vrfFeeConfigRaw
    ? parseVRFFeeConfig(vrfFeeConfigRaw as VRFFeeConfigTuple)
    : null
  const autoConfig = autoConfigRaw
    ? parseAutomationConfig(autoConfigRaw as AutomationConfigTuple)
    : null
  const autoState = autoStateRaw
    ? parseAutomationState(autoStateRaw as AutomationStateTuple)
    : null
  const oracleConfig = oracleConfigRaw
    ? parseOracleConfig(oracleConfigRaw as OracleConfigTuple)
    : null
  const oracleStats = oracleStatsRaw
    ? parseOracleStats(oracleStatsRaw as OracleStatsTuple)
    : null
  const govConfig = govConfigRaw
    ? parseGovernanceConfig(govConfigRaw as GovernanceConfigTuple)
    : null
  const revConfig = revConfigRaw
    ? parseRevenueConfig(revConfigRaw as RevenueConfigTuple)
    : null

  useEffect(() => {
    if (autoState && oracleStats) {
      setStats({
        vrf: {
          totalSubscriptions: 0,
          totalRequests: 0n,
          totalFeesCollected: 0n,
        },
        automation: {
          totalUpkeeps: Number(autoState.upkeepCount),
          activeUpkeeps: Number(autoState.totalActive),
          totalPerforms: autoState.totalPerforms,
          totalFeesCollected: autoState.totalFees,
          activeKeepers: activeKeepers?.length ?? 0,
        },
        oracle: {
          totalRequests: oracleStats.totalRequests,
          totalFulfilled: oracleStats.totalFulfilled,
          totalFeesCollected: oracleStats.totalCollected,
          activeJobs: Number(oracleStats.activeJobs),
          activeOracles: activeOracles?.length ?? 0,
        },
      })
    }
  }, [autoState, oracleStats, activeKeepers, activeOracles])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Chainlink Services</h2>
          <p className="text-gray-500">
            VRF, Automation, and Oracle management
          </p>
        </div>
        {isPaused && (
          <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm">
            Paused
          </span>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat
            title="Active Upkeeps"
            value={stats.automation.activeUpkeeps.toString()}
          />
          <Stat
            title="Active Keepers"
            value={stats.automation.activeKeepers.toString()}
          />
          <Stat
            title="Oracle Requests"
            value={stats.oracle.totalFulfilled.toString()}
          />
          <Stat
            title="Fees Collected"
            value={`${formatEther(stats.automation.totalFeesCollected + stats.oracle.totalFeesCollected)} ETH`}
          />
        </div>
      )}

      <div className="flex gap-2 border-b">
        <Tab label="VRF" active={tab === 'vrf'} onClick={() => setTab('vrf')} />
        <Tab
          label="Automation"
          active={tab === 'automation'}
          onClick={() => setTab('automation')}
        />
        <Tab
          label="Oracle"
          active={tab === 'oracle'}
          onClick={() => setTab('oracle')}
        />
        <Tab
          label="Governance"
          active={tab === 'governance'}
          onClick={() => setTab('governance')}
        />
      </div>

      <div className="bg-white rounded-lg border p-6">
        {tab === 'vrf' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">VRF Config</h3>
            <Row
              label="Min Confirmations"
              value={vrfMinConf?.toString() ?? '-'}
            />
            <Row label="Max Gas" value={vrfMaxGas?.toLocaleString() ?? '-'} />
            {vrfFeeConfig && (
              <>
                <Row
                  label="Flat Fee (LINK)"
                  value={`${vrfFeeConfig.fulfillmentFlatFeeLinkPPM / 1e6} LINK`}
                />
                <Row
                  label="Premium"
                  value={`${vrfFeeConfig.premiumPercentage}%`}
                />
              </>
            )}
          </div>
        )}

        {tab === 'automation' && autoConfig && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Automation Config</h3>
            <Row
              label="Min Stake"
              value={`${formatEther(autoConfig.minKeeperStake)} ETH`}
            />
            <Row
              label="Max Gas"
              value={autoConfig.maxPerformGas.toLocaleString()}
            />
            <Row
              label="Gas Ceiling"
              value={`${autoConfig.gasCeilingMultiplier}x`}
            />
            <Row
              label="Check Gas Limit"
              value={autoConfig.checkGasLimit.toLocaleString()}
            />
          </div>
        )}

        {tab === 'oracle' && oracleConfig && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Oracle Config</h3>
            <Row
              label="Min Payment"
              value={`${formatEther(oracleConfig.minPayment)} ETH`}
            />
            <Row label="Timeout" value={`${oracleConfig.requestTimeout}s`} />
            <Row
              label="Oracle Fee"
              value={`${oracleConfig.oracleFeeBps / 100}%`}
            />
            <Row
              label="Protocol Fee"
              value={`${oracleConfig.protocolFeeBps / 100}%`}
            />
          </div>
        )}

        {tab === 'governance' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Governance</h3>
            {govConfig && (
              <>
                <Row
                  label="Proposal Delay"
                  value={`${Number(govConfig.proposalDelay) / 86400} days`}
                />
                <Row
                  label="Grace Period"
                  value={`${Number(govConfig.gracePeriod) / 86400} days`}
                />
                <Row
                  label="Voting Period"
                  value={`${Number(govConfig.votingPeriod) / 86400} days`}
                />
              </>
            )}
            {revConfig && (
              <>
                <Row
                  label="Treasury"
                  value={`${revConfig.treasuryBps / 100}%`}
                />
                <Row
                  label="Operational"
                  value={`${revConfig.operationalBps / 100}%`}
                />
                <Row
                  label="Community"
                  value={`${revConfig.communityBps / 100}%`}
                />
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Create Proposal
        </button>
        <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
          View Proposals
        </button>
      </div>
    </div>
  )
}

export default ChainlinkDashboard
