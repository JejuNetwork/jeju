/**
 * Hardware Detection Component
 *
 * Displays detected system information in the browser,
 * helping users understand their hardware capabilities for node operation.
 */

import {
  type DetectedPlatform,
  detectPlatform,
  getArchLabel,
  getPlatformLabel,
  type ReleaseArch,
  type ReleasePlatform,
} from '@jejunetwork/types'
import {
  AlertCircle,
  Check,
  Cpu,
  HardDrive,
  Monitor,
  Shield,
  Wifi,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'

interface HardwareInfo {
  platform: DetectedPlatform
  cpuCores: number
  memoryGb: number
  gpuRenderer: string | null
  gpuVendor: string | null
  isSecureContext: boolean
  hasWebGPU: boolean
  browserInfo: {
    name: string
    version: string
  }
  screenResolution: string
  devicePixelRatio: number
  connectionType: string | null
}

interface HardwareRequirement {
  name: string
  minimum: string
  detected: string
  status: 'pass' | 'warning' | 'fail' | 'unknown'
  icon: React.ReactNode
}

function detectHardware(): HardwareInfo {
  const platform = detectPlatform()

  // CPU cores - navigator.hardwareConcurrency
  const cpuCores = navigator.hardwareConcurrency ?? 0

  // Memory - navigator.deviceMemory (Chrome only, in GB)
  const memoryGb = navigator.deviceMemory ?? 0

  // GPU detection via WebGL
  let gpuRenderer: string | null = null
  let gpuVendor: string | null = null
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl')
  if (gl) {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
    if (debugInfo) {
      gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
    }
  }

  // WebGPU support
  const hasWebGPU = 'gpu' in navigator && !!navigator.gpu

  // Secure context check (required for some APIs)
  const isSecureContext = window.isSecureContext

  // Browser info
  const ua = navigator.userAgent
  let browserName = 'Unknown'
  let browserVersion = ''
  if (ua.includes('Chrome') && !ua.includes('Edg')) {
    browserName = 'Chrome'
    const match = ua.match(/Chrome\/(\d+)/)
    browserVersion = match?.[1] ?? ''
  } else if (ua.includes('Firefox')) {
    browserName = 'Firefox'
    const match = ua.match(/Firefox\/(\d+)/)
    browserVersion = match?.[1] ?? ''
  } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
    browserName = 'Safari'
    const match = ua.match(/Version\/(\d+)/)
    browserVersion = match?.[1] ?? ''
  } else if (ua.includes('Edg')) {
    browserName = 'Edge'
    const match = ua.match(/Edg\/(\d+)/)
    browserVersion = match?.[1] ?? ''
  }

  // Screen info
  const screenResolution = `${window.screen.width}x${window.screen.height}`
  const devicePixelRatio = window.devicePixelRatio

  // Connection info
  const connectionType = navigator.connection?.effectiveType ?? null

  return {
    platform,
    cpuCores,
    memoryGb,
    gpuRenderer,
    gpuVendor,
    isSecureContext,
    hasWebGPU,
    browserInfo: {
      name: browserName,
      version: browserVersion,
    },
    screenResolution,
    devicePixelRatio,
    connectionType,
  }
}

type RequirementStatus = 'pass' | 'warning' | 'fail' | 'unknown'

const STATUS_COLORS: Record<RequirementStatus, string> = {
  pass: 'var(--success)',
  warning: 'var(--warning)',
  fail: 'var(--error)',
  unknown: 'var(--text-secondary)',
}

const STATUS_BORDERS: Record<RequirementStatus, string> = {
  pass: '3px solid var(--success)',
  warning: '3px solid var(--warning)',
  fail: '3px solid var(--error)',
  unknown: '3px solid var(--border)',
}

function evaluateRequirements(hardware: HardwareInfo): HardwareRequirement[] {
  const requirements: HardwareRequirement[] = []

  // CPU cores
  const cpuStatus =
    hardware.cpuCores >= 4
      ? 'pass'
      : hardware.cpuCores >= 2
        ? 'warning'
        : hardware.cpuCores > 0
          ? 'fail'
          : 'unknown'
  requirements.push({
    name: 'CPU Cores',
    minimum: '2 cores (4+ recommended)',
    detected: hardware.cpuCores > 0 ? `${hardware.cpuCores} cores` : 'Unknown',
    status: cpuStatus,
    icon: <Cpu size={18} />,
  })

  // Memory
  const memoryStatus =
    hardware.memoryGb >= 8
      ? 'pass'
      : hardware.memoryGb >= 4
        ? 'warning'
        : hardware.memoryGb > 0
          ? 'fail'
          : 'unknown'
  requirements.push({
    name: 'Memory',
    minimum: '4 GB (8+ GB recommended)',
    detected:
      hardware.memoryGb > 0 ? `${hardware.memoryGb} GB` : 'Not available',
    status: memoryStatus,
    icon: <HardDrive size={18} />,
  })

  // GPU (for GPU compute nodes)
  const gpuName = hardware.gpuRenderer?.toLowerCase() ?? ''
  const hasGoodGpu =
    gpuName.includes('nvidia') ||
    gpuName.includes('apple') ||
    gpuName.includes('amd') ||
    gpuName.includes('radeon')
  const gpuStatus = hasGoodGpu
    ? 'pass'
    : hardware.gpuRenderer
      ? 'warning'
      : 'unknown'
  requirements.push({
    name: 'GPU',
    minimum: 'NVIDIA/AMD/Apple (for GPU compute)',
    detected: hardware.gpuRenderer ?? 'Not detected',
    status: gpuStatus,
    icon: <Monitor size={18} />,
  })

  // Network connection type
  const connectionStatus =
    hardware.connectionType === '4g'
      ? 'pass'
      : hardware.connectionType === '3g'
        ? 'warning'
        : hardware.connectionType
          ? 'fail'
          : 'unknown'
  requirements.push({
    name: 'Connection',
    minimum: '100 Mbps (1 Gbps+ recommended)',
    detected: hardware.connectionType
      ? hardware.connectionType.toUpperCase()
      : 'Not available',
    status: connectionStatus,
    icon: <Wifi size={18} />,
  })

  // Secure context (needed for some crypto operations)
  requirements.push({
    name: 'Secure Context',
    minimum: 'HTTPS required',
    detected: hardware.isSecureContext ? 'Yes' : 'No',
    status: hardware.isSecureContext ? 'pass' : 'fail',
    icon: <Shield size={18} />,
  })

  return requirements
}

export default function HardwareDetection() {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [requirements, setRequirements] = useState<HardwareRequirement[]>([])
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    const detected = detectHardware()
    setHardware(detected)
    setRequirements(evaluateRequirements(detected))
  }, [])

  if (!hardware) {
    return (
      <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
        <div className="spinner" />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>
          Detecting hardware...
        </p>
      </div>
    )
  }

  const passCount = requirements.filter((r) => r.status === 'pass').length
  const warningCount = requirements.filter((r) => r.status === 'warning').length
  const failCount = requirements.filter((r) => r.status === 'fail').length

  const overallStatus =
    failCount > 0 ? 'fail' : warningCount > 0 ? 'warning' : 'pass'

  return (
    <div className="card" style={{ marginBottom: '2rem' }}>
      <div className="card-header">
        <h3 className="card-title">
          <Cpu size={18} /> System Check
        </h3>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      {/* Summary */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
          padding: '1rem',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          marginBottom: isExpanded ? '1.5rem' : 0,
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-md)',
            background:
              overallStatus === 'pass'
                ? 'var(--success-soft)'
                : overallStatus === 'warning'
                  ? 'var(--warning-soft)'
                  : 'var(--error-soft)',
            color:
              overallStatus === 'pass'
                ? 'var(--success)'
                : overallStatus === 'warning'
                  ? 'var(--warning)'
                  : 'var(--error)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {overallStatus === 'pass' ? (
            <Check size={24} />
          ) : overallStatus === 'warning' ? (
            <AlertCircle size={24} />
          ) : (
            <X size={24} />
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
            {hardware.platform.os !== 'unknown' &&
              getPlatformLabel(hardware.platform.os as ReleasePlatform)}{' '}
            {hardware.platform.arch !== 'unknown' &&
              `(${getArchLabel(hardware.platform.arch as ReleaseArch)})`}
          </div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {passCount} passed
            {warningCount > 0 && `, ${warningCount} warnings`}
            {failCount > 0 && `, ${failCount} issues`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="badge badge-secondary">
            {hardware.cpuCores} cores
          </span>
          {hardware.memoryGb > 0 && (
            <span className="badge badge-secondary">
              {hardware.memoryGb} GB RAM
            </span>
          )}
          {hardware.gpuRenderer && (
            <span className="badge badge-info">GPU</span>
          )}
        </div>
      </div>

      {/* Detailed requirements */}
      {isExpanded && (
        <div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {requirements.map((req) => (
              <div
                key={req.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '0.75rem 1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  borderLeft: STATUS_BORDERS[req.status],
                }}
              >
                <div style={{ color: STATUS_COLORS[req.status] }}>
                  {req.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{req.name}</div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {req.minimum}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontWeight: 500,
                      color: STATUS_COLORS[req.status],
                    }}
                  >
                    {req.detected}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Additional Info */}
          {hardware.gpuRenderer && (
            <div
              style={{
                marginTop: '1.5rem',
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.5rem',
                }}
              >
                GPU Information
              </div>
              <div
                style={{
                  fontSize: '0.9rem',
                  fontFamily: 'var(--font-mono)',
                  wordBreak: 'break-word',
                }}
              >
                {hardware.gpuRenderer}
              </div>
              {hardware.gpuVendor && (
                <div
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginTop: '0.25rem',
                  }}
                >
                  Vendor: {hardware.gpuVendor}
                </div>
              )}
              {hardware.hasWebGPU && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    color: 'var(--success)',
                    fontSize: '0.85rem',
                  }}
                >
                  <Check size={14} /> WebGPU supported
                </div>
              )}
            </div>
          )}

          {/* Browser info */}
          <div
            style={{
              marginTop: '1rem',
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              gap: '2rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                Browser
              </div>
              <div style={{ fontWeight: 500 }}>
                {hardware.browserInfo.name} {hardware.browserInfo.version}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                Display
              </div>
              <div style={{ fontWeight: 500 }}>
                {hardware.screenResolution} @{hardware.devicePixelRatio}x
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: '1rem',
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            Note: Browser detection is limited. The desktop app provides more
            accurate hardware profiling.
          </div>
        </div>
      )}
    </div>
  )
}
