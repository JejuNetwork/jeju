import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Container,
  Cpu,
  Database,
  Gauge,
  Globe,
  HardDrive,
  Layers,
  Play,
  Server,
  Shield,
  Square,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../store'
import type { ServiceWithStatus } from '../types'
import { formatDuration, formatEther, formatUsd } from '../utils'
import {
  NonTeeWarningBadge,
  PrivacyWarning,
  TeeStatusIndicator,
} from './PrivacyWarning'

interface ComputeConfig {
  type: 'cpu' | 'gpu' | 'both'
  cpuCores: number
  gpuIds: number[]
  useDocker: boolean
  pricePerHour: string
}

const serviceIcons: Record<string, React.ReactNode> = {
  compute: <Cpu size={20} />,
  compute_cpu: <Cpu size={20} />,
  compute_gpu: <Gauge size={20} />,
  storage: <HardDrive size={20} />,
  oracle: <Database size={20} />,
  proxy: <Globe size={20} />,
  cron: <Clock size={20} />,
  rpc: <Server size={20} />,
  xlp: <Coins size={20} />,
  solver: <Zap size={20} />,
  sequencer: <Layers size={20} />,
}

export function Services() {
  const { services, startService, stopService, hardware, wallet } =
    useAppStore()
  const [expandedService, setExpandedService] = useState<string | null>(null)
  const [confirmingSequencer, setConfirmingSequencer] = useState(false)
  const [showPrivacyWarning, setShowPrivacyWarning] = useState(false)
  const [pendingComputeConfig, setPendingComputeConfig] =
    useState<ComputeConfig | null>(null)
  const [computeConfig, setComputeConfig] = useState<ComputeConfig>({
    type: 'both',
    cpuCores: Math.floor((hardware?.cpu?.cores_physical || 4) / 2),
    gpuIds: hardware?.gpus?.map((_, i) => i) || [],
    useDocker: true,
    pricePerHour: '0.01',
  })

  // Check TEE availability
  const hasCpuTee =
    hardware?.tee?.attestation_available &&
    (hardware.tee.has_intel_tdx ||
      hardware.tee.has_intel_sgx ||
      hardware.tee.has_amd_sev)
  const hasGpuTee = hardware?.tee?.has_nvidia_cc

  const isNonTeeCompute = (type: 'cpu' | 'gpu' | 'both') => {
    if (type === 'cpu') return !hasCpuTee
    if (type === 'gpu') return !hasGpuTee
    return !hasCpuTee || !hasGpuTee
  }

  const handleToggleService = async (service: ServiceWithStatus) => {
    if (!wallet) {
      alert('Please connect a wallet first')
      return
    }

    if (service.status.running) {
      if (service.metadata.id === 'sequencer') {
        if (
          !confirm(
            'Stopping the sequencer may result in missed blocks and slashing. Are you sure?',
          )
        ) {
          return
        }
      }
      await stopService(service.metadata.id)
    } else {
      if (service.metadata.id === 'sequencer') {
        setConfirmingSequencer(true)
        return
      }

      // Handle compute service with TEE check
      if (service.metadata.id === 'compute') {
        if (isNonTeeCompute(computeConfig.type)) {
          setPendingComputeConfig(computeConfig)
          setShowPrivacyWarning(true)
          return
        }
      }

      const stakeAmount =
        service.metadata.min_stake_eth > 0
          ? (service.metadata.min_stake_eth * 1e18).toString()
          : undefined
      await startService(service.metadata.id, stakeAmount)
    }
  }

  const handleAcceptNonTee = async () => {
    setShowPrivacyWarning(false)
    if (pendingComputeConfig) {
      // Start compute service with non-TEE config
      const service = services.find((s) => s.metadata.id === 'compute')
      if (service) {
        const stakeAmount =
          service.metadata.min_stake_eth > 0
            ? (service.metadata.min_stake_eth * 1e18).toString()
            : undefined
        await startService(service.metadata.id, stakeAmount)
      }
    }
    setPendingComputeConfig(null)
  }

  const handleConfirmSequencer = async () => {
    const service = services.find((s) => s.metadata.id === 'sequencer')
    if (!service) return

    const stakeAmount = (service.metadata.min_stake_eth * 1e18).toString()
    await startService('sequencer', stakeAmount)
    setConfirmingSequencer(false)
  }

  // Separate compute service for special handling
  const computeService = services.find((s) => s.metadata.id === 'compute')
  const otherServices = services.filter((s) => s.metadata.id !== 'compute')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Services</h1>
        <p className="text-volcanic-400 mt-1">
          Configure and manage node services to earn rewards
        </p>
      </div>

      {/* Hardware Summary */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Your Hardware</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-sm text-volcanic-400">CPU Cores</p>
            <p className="text-xl font-bold">
              {hardware?.cpu?.cores_physical || 0}
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">Memory</p>
            <p className="text-xl font-bold">
              {((hardware?.memory?.total_mb || 0) / 1024).toFixed(0)} GB
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">GPUs</p>
            <p className="text-xl font-bold">{hardware?.gpus?.length || 0}</p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">Docker</p>
            <p className="text-xl font-bold flex items-center gap-2">
              {hardware?.docker?.runtime_available ? (
                <>
                  <Container size={16} className="text-jeju-400" />
                  Ready
                </>
              ) : hardware?.docker?.available ? (
                <span className="text-yellow-400">Stopped</span>
              ) : (
                <span className="text-volcanic-500">Not installed</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">TEE</p>
            <p className="text-xl font-bold flex items-center gap-2">
              {hardware?.tee?.attestation_available ? (
                <>
                  <Shield size={16} className="text-jeju-400" />
                  Available
                </>
              ) : (
                <span className="text-volcanic-500">None</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Compute Service - Special Section */}
      {computeService && (
        <div className="card border-2 border-jeju-500/30">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-jeju-600/20 text-jeju-400">
                <Cpu size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Compute Provider</h2>
                <p className="text-sm text-volcanic-400">
                  Offer your CPU and GPU for AI inference and general compute
                </p>
              </div>
            </div>

            {computeService.status.running && (
              <div className="flex items-center gap-2">
                <span className="status-healthy" />
                <span className="text-sm text-green-400">Running</span>
              </div>
            )}
          </div>

          {/* Compute Type Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* CPU Compute */}
            <div
              className={clsx(
                'p-4 rounded-xl border-2 cursor-pointer transition-all',
                computeConfig.type === 'cpu' || computeConfig.type === 'both'
                  ? 'border-jeju-500 bg-jeju-500/10'
                  : 'border-volcanic-700 hover:border-volcanic-600',
              )}
              onClick={() =>
                setComputeConfig((c) => ({
                  ...c,
                  type:
                    c.type === 'cpu'
                      ? 'both'
                      : c.type === 'gpu'
                        ? 'both'
                        : 'cpu',
                }))
              }
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Cpu size={18} />
                  <span className="font-semibold">CPU Compute</span>
                </div>
                <TeeStatusIndicator
                  available={!!hasCpuTee}
                  type={
                    hardware?.tee?.has_intel_tdx
                      ? 'Intel TDX'
                      : hardware?.tee?.has_intel_sgx
                        ? 'Intel SGX'
                        : hardware?.tee?.has_amd_sev
                          ? 'AMD SEV'
                          : null
                  }
                />
              </div>

              <p className="text-sm text-volcanic-400 mb-3">
                Docker containers, batch processing, general compute tasks
              </p>

              <div className="flex items-center gap-4 text-sm">
                <span className="text-volcanic-500">
                  {hardware?.cpu?.cores_physical || 0} cores available
                </span>
                <span className="text-jeju-400">~$0.05/hr per core</span>
              </div>

              {(computeConfig.type === 'cpu' ||
                computeConfig.type === 'both') && (
                <div className="mt-3 pt-3 border-t border-volcanic-700">
                  <label className="text-sm text-volcanic-400">
                    Cores to allocate:
                  </label>
                  <input
                    type="range"
                    min="1"
                    max={hardware?.cpu?.cores_physical || 4}
                    value={computeConfig.cpuCores}
                    onChange={(e) =>
                      setComputeConfig((c) => ({
                        ...c,
                        cpuCores: parseInt(e.target.value, 10),
                      }))
                    }
                    className="w-full mt-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex justify-between text-xs text-volcanic-500">
                    <span>1 core</span>
                    <span className="text-jeju-400 font-bold">
                      {computeConfig.cpuCores} cores
                    </span>
                    <span>{hardware?.cpu?.cores_physical || 4} cores</span>
                  </div>
                </div>
              )}

              {!hasCpuTee && (
                <div className="mt-3">
                  <NonTeeWarningBadge computeType="cpu" />
                </div>
              )}
            </div>

            {/* GPU Compute */}
            <div
              className={clsx(
                'p-4 rounded-xl border-2 transition-all',
                (hardware?.gpus?.length || 0) === 0
                  ? 'border-volcanic-800 bg-volcanic-900/50 opacity-50 cursor-not-allowed'
                  : computeConfig.type === 'gpu' ||
                      computeConfig.type === 'both'
                    ? 'border-jeju-500 bg-jeju-500/10 cursor-pointer'
                    : 'border-volcanic-700 hover:border-volcanic-600 cursor-pointer',
              )}
              onClick={() => {
                if ((hardware?.gpus?.length || 0) === 0) return
                setComputeConfig((c) => ({
                  ...c,
                  type:
                    c.type === 'gpu'
                      ? 'both'
                      : c.type === 'cpu'
                        ? 'both'
                        : 'gpu',
                }))
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Gauge size={18} />
                  <span className="font-semibold">GPU Compute</span>
                </div>
                {(hardware?.gpus?.length || 0) > 0 && (
                  <TeeStatusIndicator
                    available={!!hasGpuTee}
                    type={hasGpuTee ? 'NVIDIA CC' : null}
                  />
                )}
              </div>

              <p className="text-sm text-volcanic-400 mb-3">
                AI inference, machine learning, image generation
              </p>

              {(hardware?.gpus?.length || 0) > 0 ? (
                <>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-volcanic-500">
                      {hardware?.gpus?.length} GPU
                      {(hardware?.gpus?.length || 0) > 1 ? 's' : ''} detected
                    </span>
                    <span className="text-jeju-400">~$0.50/hr per GPU</span>
                  </div>

                  {(computeConfig.type === 'gpu' ||
                    computeConfig.type === 'both') &&
                    hardware?.gpus && (
                      <div className="mt-3 pt-3 border-t border-volcanic-700 space-y-2">
                        {hardware.gpus.map((gpu, i) => (
                          <label
                            key={`gpu-${gpu.index}`}
                            className="flex items-center gap-3 cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={computeConfig.gpuIds.includes(i)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setComputeConfig((c) => ({
                                    ...c,
                                    gpuIds: [...c.gpuIds, i],
                                  }))
                                } else {
                                  setComputeConfig((c) => ({
                                    ...c,
                                    gpuIds: c.gpuIds.filter((id) => id !== i),
                                  }))
                                }
                              }}
                              className="rounded border-volcanic-600"
                            />
                            <span className="text-sm">
                              [{i}] {gpu.name} ({gpu.memory_total_mb}MB)
                            </span>
                          </label>
                        ))}
                      </div>
                    )}

                  {!hasGpuTee && (
                    <div className="mt-3">
                      <NonTeeWarningBadge computeType="gpu" />
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-volcanic-500">
                  No NVIDIA GPUs detected. Install nvidia-smi to enable.
                </div>
              )}
            </div>
          </div>

          {/* Docker Option */}
          <div className="flex items-center justify-between p-3 bg-volcanic-800/50 rounded-lg mb-4">
            <div className="flex items-center gap-3">
              <Container size={18} className="text-volcanic-400" />
              <div>
                <p className="font-medium">Docker Containers</p>
                <p className="text-xs text-volcanic-400">
                  Required for isolated compute jobs
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {hardware?.docker?.runtime_available ? (
                <span className="text-sm text-green-400">Docker Ready</span>
              ) : hardware?.docker?.available ? (
                <span className="text-sm text-yellow-400">
                  Docker not running
                </span>
              ) : (
                <span className="text-sm text-red-400">
                  Docker not installed
                </span>
              )}
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={computeConfig.useDocker}
                  onChange={(e) =>
                    setComputeConfig((c) => ({
                      ...c,
                      useDocker: e.target.checked,
                    }))
                  }
                  className="sr-only peer"
                  disabled={!hardware?.docker?.runtime_available}
                />
                <div className="w-11 h-6 bg-volcanic-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-jeju-500" />
              </label>
            </div>
          </div>

          {/* Pricing */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1">
              <label className="text-sm text-volcanic-400">
                Hourly Rate (ETH)
              </label>
              <input
                type="number"
                step="0.001"
                value={computeConfig.pricePerHour}
                onChange={(e) =>
                  setComputeConfig((c) => ({
                    ...c,
                    pricePerHour: e.target.value,
                  }))
                }
                className="input mt-1 w-full"
              />
            </div>
            <div className="text-right">
              <p className="text-sm text-volcanic-400">Estimated monthly</p>
              <p className="text-xl font-bold text-jeju-400">
                $
                {(
                  parseFloat(computeConfig.pricePerHour || '0') *
                  24 *
                  30 *
                  2500
                ).toFixed(0)}
              </p>
            </div>
          </div>

          {/* Start/Stop Button */}
          <button
            onClick={() => handleToggleService(computeService)}
            disabled={
              !computeService.meets_requirements &&
              !computeService.status.running
            }
            className={clsx(
              'w-full btn flex items-center justify-center gap-2',
              computeService.status.running ? 'btn-danger' : 'btn-primary',
            )}
          >
            {computeService.status.running ? (
              <>
                <Square size={18} />
                Stop Compute Provider
              </>
            ) : (
              <>
                <Play size={18} />
                Start Compute Provider
              </>
            )}
          </button>

          {/* Running Stats */}
          {computeService.status.running && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-volcanic-700">
              <div>
                <p className="text-sm text-volcanic-400">Uptime</p>
                <p className="font-semibold">
                  {formatDuration(computeService.status.uptime_seconds)}
                </p>
              </div>
              <div>
                <p className="text-sm text-volcanic-400">Jobs Completed</p>
                <p className="font-semibold">
                  {computeService.status.requests_served}
                </p>
              </div>
              <div>
                <p className="text-sm text-volcanic-400">Earned</p>
                <p className="font-semibold text-jeju-400">
                  {formatEther(computeService.status.earnings_wei)} ETH
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Other Services Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Other Services</h2>

        {otherServices.map((service) => (
          <motion.div
            key={service.metadata.id}
            layout
            className={clsx(
              'card transition-all duration-200',
              service.status.running &&
                'border-jeju-500/50 shadow-lg shadow-jeju-500/10',
              !service.meets_requirements && 'opacity-60',
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div
                  className={clsx(
                    'p-3 rounded-xl',
                    service.status.running
                      ? 'bg-jeju-600/20 text-jeju-400'
                      : 'bg-volcanic-800 text-volcanic-400',
                  )}
                >
                  {serviceIcons[service.metadata.id] || <Server size={20} />}
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{service.metadata.name}</h3>
                    {service.metadata.is_advanced && (
                      <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                        Advanced
                      </span>
                    )}
                    {service.status.running && (
                      <span className="status-healthy" />
                    )}
                  </div>

                  <p className="text-sm text-volcanic-400 mt-1 max-w-xl">
                    {service.metadata.description}
                  </p>

                  <div className="flex items-center gap-4 mt-3 text-sm">
                    <span className="text-volcanic-500">
                      Min Stake: {service.metadata.min_stake_eth} ETH
                    </span>
                    <span className="text-jeju-400">
                      ~
                      {formatUsd(
                        service.metadata.estimated_earnings_per_hour_usd,
                      )}
                      /hr
                    </span>
                  </div>

                  {/* Requirement Issues */}
                  {service.requirement_issues.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {service.requirement_issues.map((issue) => (
                        <div
                          key={issue}
                          className="flex items-center gap-2 text-sm text-yellow-400"
                        >
                          <AlertTriangle size={14} />
                          {issue}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Warnings for advanced services */}
                  {service.metadata.warnings.length > 0 &&
                    expandedService === service.metadata.id && (
                      <div className="mt-3 p-3 bg-volcanic-800/50 rounded-lg space-y-1">
                        {service.metadata.warnings.map((warning) => (
                          <p
                            key={warning}
                            className="text-sm text-volcanic-400"
                          >
                            {warning}
                          </p>
                        ))}
                      </div>
                    )}

                  {/* Running Stats */}
                  {service.status.running && (
                    <div className="flex items-center gap-6 mt-3 text-sm">
                      <span className="text-volcanic-400">
                        Uptime: {formatDuration(service.status.uptime_seconds)}
                      </span>
                      <span className="text-volcanic-400">
                        Requests: {service.status.requests_served}
                      </span>
                      <span className="text-jeju-400">
                        Earned: {formatEther(service.status.earnings_wei)} ETH
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {service.metadata.warnings.length > 0 && (
                  <button
                    onClick={() =>
                      setExpandedService(
                        expandedService === service.metadata.id
                          ? null
                          : service.metadata.id,
                      )
                    }
                    className="btn-ghost p-2"
                  >
                    {expandedService === service.metadata.id ? (
                      <ChevronUp size={18} />
                    ) : (
                      <ChevronDown size={18} />
                    )}
                  </button>
                )}

                <button
                  onClick={() => handleToggleService(service)}
                  disabled={
                    !service.meets_requirements && !service.status.running
                  }
                  className={clsx(
                    'btn flex items-center gap-2',
                    service.status.running ? 'btn-danger' : 'btn-primary',
                  )}
                >
                  {service.status.running ? (
                    <>
                      <Square size={16} />
                      Stop
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      Start
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Non-TEE Privacy Warning Modal */}
      <AnimatePresence>
        {showPrivacyWarning && (
          <PrivacyWarning
            computeType={pendingComputeConfig?.type || 'both'}
            teeAvailable={false}
            onAccept={handleAcceptNonTee}
            onCancel={() => {
              setShowPrivacyWarning(false)
              setPendingComputeConfig(null)
            }}
          />
        )}
      </AnimatePresence>

      {/* Sequencer Confirmation Modal */}
      <AnimatePresence>
        {confirmingSequencer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-volcanic-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setConfirmingSequencer(false)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="card max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 text-yellow-400 mb-4">
                <AlertTriangle size={24} />
                <h2 className="text-xl font-bold">Sequencer Warning</h2>
              </div>

              <div className="space-y-4 text-volcanic-300">
                <p>
                  Running a sequencer is a{' '}
                  <strong className="text-white">
                    high-responsibility role
                  </strong>{' '}
                  with significant staking requirements and slashing risks.
                </p>

                <div className="bg-volcanic-800/50 rounded-lg p-4 space-y-2">
                  <p className="text-sm text-red-400">
                    ⚠️ Double-signing: 10% slash + permanent ban
                  </p>
                  <p className="text-sm text-red-400">⚠️ Censorship: 5% slash</p>
                  <p className="text-sm text-yellow-400">
                    ⚠️ Downtime (100+ blocks): 1% slash
                  </p>
                  <p className="text-sm text-yellow-400">
                    ⚠️ 7-day unbonding period
                  </p>
                </div>

                <p>
                  This requires a{' '}
                  <strong className="text-white">dedicated machine</strong> that
                  must remain online 24/7. Are you sure you want to proceed?
                </p>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setConfirmingSequencer(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSequencer}
                  className="btn-danger flex-1"
                >
                  I Understand, Start Sequencer
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
