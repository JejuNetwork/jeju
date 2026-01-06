import {
  type DetectedPlatform,
  detectPlatform as detectPlatformUtil,
  formatFileSize,
  getArchLabel,
  type ReleaseArtifact,
  type ReleaseManifest,
} from '@jejunetwork/types'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Cloud,
  Cpu,
  DollarSign,
  Download,
  Globe,
  HardDrive,
  Monitor,
  Radio,
  Server,
  Shield,
  Terminal,
  Wallet,
  Wifi,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import HardwareDetection from '../../components/HardwareDetection'
import NodeRegistrationWizard from '../../components/NodeRegistrationWizard'
import { useNetworkStats } from '../../hooks/useStaking'

const SERVICES = [
  {
    id: 'vpn',
    name: 'VPN Node',
    icon: <Shield size={24} />,
    reward: '$50/mo',
    description: 'Route encrypted VPN traffic for network users',
    requirements: 'Stable connection, low latency',
  },
  {
    id: 'cdn',
    name: 'CDN Edge',
    icon: <Globe size={24} />,
    reward: '$30/mo',
    description: 'Cache and serve static content at the edge',
    requirements: '50GB+ storage, good bandwidth',
  },
  {
    id: 'storage',
    name: 'Storage Node',
    icon: <HardDrive size={24} />,
    reward: '$40/mo',
    description: 'Store and replicate network data with IPFS',
    requirements: '500GB+ available storage',
  },
  {
    id: 'rpc',
    name: 'RPC Provider',
    icon: <Radio size={24} />,
    reward: '$80/mo',
    description: 'Serve blockchain RPC queries with low latency',
    requirements: 'Archive node or full node access',
  },
  {
    id: 'compute',
    name: 'Compute Node',
    icon: <Cpu size={24} />,
    reward: '$100/mo',
    description: 'Run containers and workers on demand',
    requirements: '8GB+ RAM, 4+ CPU cores',
  },
  {
    id: 'gpu',
    name: 'GPU Compute',
    icon: <Monitor size={24} />,
    reward: '$200+/mo',
    description: 'Provide GPU compute for AI inference and training',
    requirements: 'NVIDIA GPU with 8GB+ VRAM',
  },
]

const REQUIREMENTS = [
  {
    category: 'CPU',
    icon: <Cpu size={20} />,
    minimum: '2 cores',
    recommended: '4+ cores',
  },
  {
    category: 'Memory',
    icon: <Server size={20} />,
    minimum: '4 GB RAM',
    recommended: '8+ GB RAM',
  },
  {
    category: 'Storage',
    icon: <HardDrive size={20} />,
    minimum: '50 GB SSD',
    recommended: '500+ GB NVMe',
  },
  {
    category: 'Bandwidth',
    icon: <Wifi size={20} />,
    minimum: '100 Mbps',
    recommended: '1 Gbps+',
  },
]

const SETUP_STEPS = [
  {
    number: 1,
    title: 'Download & Install',
    description:
      'Download the Jeju Node app for your platform. Run the installer and follow the prompts.',
    icon: <Download size={20} />,
  },
  {
    number: 2,
    title: 'Connect Your Wallet',
    description:
      'Open the app and connect your Ethereum wallet. This wallet will receive your earnings.',
    icon: <Wallet size={20} />,
  },
  {
    number: 3,
    title: 'Choose Services',
    description:
      'Select which services to run based on your hardware. More services = more earnings.',
    icon: <Server size={20} />,
  },
  {
    number: 4,
    title: 'Stake & Start',
    description:
      'Stake the minimum required tokens and start your node. Begin earning immediately.',
    icon: <DollarSign size={20} />,
  },
]

// Format USD value with K/M suffixes
function formatUSD(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (Number.isNaN(num) || num === 0) return '0'
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toFixed(0)
}

// Fallback release data when API is unavailable (clearly marked as dev)
const FALLBACK_RELEASE: ReleaseManifest = {
  app: 'node',
  version: '1.0.0',
  releasedAt: new Date().toISOString(),
  channel: 'stable',
  artifacts: [
    {
      platform: 'macos',
      arch: 'arm64',
      filename: 'JejuNode-1.0.0-arm64.dmg',
      cid: 'QmNodeMacArm1',
      size: 89128960,
      sha256: 'abc123',
    },
    {
      platform: 'macos',
      arch: 'x64',
      filename: 'JejuNode-1.0.0-x64.dmg',
      cid: 'QmNodeMacX64',
      size: 96468992,
      sha256: 'def456',
    },
    {
      platform: 'windows',
      arch: 'x64',
      filename: 'JejuNode-1.0.0-x64.msi',
      cid: 'QmNodeWinX64',
      size: 81788928,
      sha256: 'ghi789',
    },
    {
      platform: 'linux',
      arch: 'x64',
      filename: 'JejuNode-1.0.0-x64.AppImage',
      cid: 'QmNodeLinuxX64',
      size: 99614720,
      sha256: 'jkl012',
    },
    {
      platform: 'linux',
      arch: 'arm64',
      filename: 'JejuNode-1.0.0-arm64.AppImage',
      cid: 'QmNodeLinuxArm',
      size: 92274688,
      sha256: 'mno345',
    },
  ],
}

export default function RunNodePage() {
  const [release, setRelease] = useState<ReleaseManifest | null>(null)
  const [detected, setDetected] = useState<DetectedPlatform | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [releaseError, setReleaseError] = useState<string | null>(null)

  // Fetch real network stats from the staking contract
  const { data: networkStats, isLoading: statsLoading } = useNetworkStats()

  useEffect(() => {
    const platform = detectPlatformUtil()
    setDetected(platform)
    setSelectedPlatform(platform.os)

    fetch('/releases/node/latest')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch releases')
        return res.json()
      })
      .then(
        (
          data: ReleaseManifest & {
            _source?: 'storage' | 'development'
            _storageError?: string
          },
        ) => {
          setRelease(data)
          // Check if we're using development placeholders
          if (data._source === 'development') {
            setReleaseError('Development mode: Downloads not available yet')
          } else if (data._storageError) {
            setReleaseError(`Storage warning: ${data._storageError}`)
          }
          setLoading(false)
        },
      )
      .catch((err: Error) => {
        // Log error for debugging but don't expose to console in production
        if (import.meta.env.DEV) {
          console.error('Failed to fetch release data:', err.message)
        }
        setRelease(FALLBACK_RELEASE)
        setReleaseError('Could not load release data')
        setLoading(false)
      })
  }, [])

  const getRecommendedArtifact = (): ReleaseArtifact | null => {
    if (!release || !detected) return null
    return (
      release.artifacts.find(
        (a) => a.platform === detected.os && a.arch === detected.arch,
      ) ??
      release.artifacts.find((a) => a.platform === detected.os) ??
      null
    )
  }

  const getArtifactsForPlatform = (platform: string): ReleaseArtifact[] => {
    if (!release) return []
    return release.artifacts.filter((a) => a.platform === platform)
  }

  const recommendedArtifact = getRecommendedArtifact()

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Run a Node</h1>
          <p className="page-subtitle">
            Turn your spare compute into income. Provide infrastructure and earn
            rewards.
          </p>
        </div>
      </div>

      {/* Development Warning */}
      {releaseError && (
        <div
          className="card"
          style={{
            background: 'var(--warning-soft)',
            border: '1px solid var(--warning)',
            marginBottom: '1.5rem',
            padding: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
          <span style={{ color: 'var(--warning)' }}>
            {releaseError}. Node software is under active development.
          </span>
        </div>
      )}

      {/* Hero Section with Main CTA */}
      <div
        className="card"
        style={{
          background:
            'linear-gradient(135deg, var(--accent-soft) 0%, var(--bg-elevated) 100%)',
          border: '1px solid var(--accent)',
          marginBottom: '2rem',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '2rem',
            alignItems: 'center',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '1.75rem',
                fontWeight: 700,
                marginBottom: '0.75rem',
              }}
            >
              Become a Provider
            </h2>
            <p
              style={{
                color: 'var(--text-secondary)',
                marginBottom: '1.5rem',
                maxWidth: '500px',
              }}
            >
              Contribute your spare compute to the decentralized web. Run VPN,
              CDN, storage, and compute services to earn rewards.
            </p>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {loading ? (
                <div
                  className="skeleton"
                  style={{ width: '200px', height: '48px' }}
                />
              ) : releaseError ? (
                <a
                  href="#cli-install"
                  className="btn btn-primary"
                  style={{ padding: '0.875rem 1.5rem' }}
                >
                  <Terminal size={20} /> CLI Install (Dev)
                </a>
              ) : recommendedArtifact && detected ? (
                <a
                  href={`/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}`}
                  className="btn btn-primary"
                  style={{ padding: '0.875rem 1.5rem', fontSize: '1rem' }}
                >
                  <Download size={20} />
                  Download for{' '}
                  {detected.os === 'macos'
                    ? 'macOS'
                    : detected.os === 'windows'
                      ? 'Windows'
                      : detected.os === 'linux'
                        ? 'Linux'
                        : 'your platform'}
                </a>
              ) : (
                <a href="#downloads" className="btn btn-primary">
                  <Download size={20} /> View Downloads
                </a>
              )}
              <a
                href="#cli-install"
                className="btn btn-secondary"
                style={{ padding: '0.875rem 1.5rem' }}
              >
                <Terminal size={20} /> CLI Install
              </a>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '1.5rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-lg)',
              minWidth: '180px',
            }}
          >
            <DollarSign size={32} style={{ color: 'var(--success)' }} />
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 700,
                color: 'var(--success)',
              }}
            >
              {statsLoading ? (
                <div
                  className="skeleton"
                  style={{ width: '80px', height: '40px' }}
                />
              ) : networkStats ? (
                `$${formatUSD(networkStats.baseRewardPerMonthUSD)}`
              ) : (
                'TBD'
              )}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Base Reward/Mo
            </div>
          </div>
        </div>
      </div>

      {/* Network Stats */}
      <div className="stats-grid" style={{ marginBottom: '2rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Server size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Active Nodes</div>
            <div className="stat-value">
              {statsLoading ? (
                <div
                  className="skeleton"
                  style={{ width: '60px', height: '24px' }}
                />
              ) : networkStats ? (
                networkStats.totalNodesActive.toLocaleString()
              ) : (
                '—'
              )}
            </div>
            <div className="stat-change">On-chain verified</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Staked</div>
            <div className="stat-value">
              {statsLoading ? (
                <div
                  className="skeleton"
                  style={{ width: '80px', height: '24px' }}
                />
              ) : networkStats ? (
                `$${formatUSD(networkStats.totalStakedUSD)}`
              ) : (
                '—'
              )}
            </div>
            <div className="stat-change">Network TVL</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Min. Stake</div>
            <div className="stat-value">
              {statsLoading ? (
                <div
                  className="skeleton"
                  style={{ width: '60px', height: '24px' }}
                />
              ) : networkStats ? (
                `$${formatUSD(networkStats.minStakeUSD)}`
              ) : (
                '—'
              )}
            </div>
            <div className="stat-change">Required to join</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Cloud size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Rewards Paid</div>
            <div className="stat-value">
              {statsLoading ? (
                <div
                  className="skeleton"
                  style={{ width: '80px', height: '24px' }}
                />
              ) : networkStats ? (
                `$${formatUSD(networkStats.totalRewardsClaimedUSD)}`
              ) : (
                '—'
              )}
            </div>
            <div className="stat-change">All time</div>
          </div>
        </div>
      </div>

      {/* Available Services */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Server size={18} /> Services You Can Provide
          </h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
          }}
        >
          {SERVICES.map((service) => (
            <div
              key={service.id}
              style={{
                padding: '1.25rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                }}
              >
                <div
                  style={{
                    padding: '0.75rem',
                    background: 'var(--accent-soft)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--accent)',
                  }}
                >
                  {service.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <h4 style={{ fontWeight: 600 }}>{service.name}</h4>
                    <span
                      style={{
                        color: 'var(--success)',
                        fontWeight: 600,
                        fontSize: '0.9rem',
                      }}
                    >
                      ~{service.reward}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-secondary)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    {service.description}
                  </p>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {service.requirements}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* System Requirements */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Cpu size={18} /> System Requirements
          </h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          {REQUIREMENTS.map((req) => (
            <div
              key={req.category}
              style={{
                padding: '1.25rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  padding: '0.75rem',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.75rem',
                }}
              >
                {req.icon}
              </div>
              <h4 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>
                {req.category}
              </h4>
              <div
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.25rem',
                }}
              >
                Minimum: {req.minimum}
              </div>
              <div
                style={{
                  fontSize: '0.9rem',
                  color: 'var(--accent)',
                  fontWeight: 500,
                }}
              >
                Recommended: {req.recommended}
              </div>
            </div>
          ))}
        </div>
        <p
          style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            marginTop: '1rem',
            fontSize: '0.9rem',
          }}
        >
          Higher specs enable more services and higher rewards
        </p>
      </div>

      {/* Hardware Detection */}
      <HardwareDetection />

      {/* Node Registration Wizard */}
      <NodeRegistrationWizard />

      {/* Downloads Section */}
      <div id="downloads" className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Download size={18} /> Download Jeju Node
          </h3>
          {release && (
            <span
              className="badge badge-info"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              v{release.version}
            </span>
          )}
        </div>

        {/* Platform Tabs */}
        <div className="tabs" style={{ marginBottom: '1.5rem' }}>
          <button
            type="button"
            className={`tab ${selectedPlatform === 'macos' ? 'active' : ''}`}
            onClick={() => setSelectedPlatform('macos')}
          >
            macOS
          </button>
          <button
            type="button"
            className={`tab ${selectedPlatform === 'windows' ? 'active' : ''}`}
            onClick={() => setSelectedPlatform('windows')}
          >
            Windows
          </button>
          <button
            type="button"
            className={`tab ${selectedPlatform === 'linux' ? 'active' : ''}`}
            onClick={() => setSelectedPlatform('linux')}
          >
            Linux
          </button>
        </div>

        {loading ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '2rem',
            }}
          >
            <div className="spinner" />
          </div>
        ) : releaseError ? (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <AlertTriangle size={48} style={{ color: 'var(--warning)' }} />
            <h4>Downloads Not Available</h4>
            <p style={{ marginBottom: '1rem' }}>
              Node software is still in development. Use the CLI installation
              below for dev builds.
            </p>
            <a href="#cli-install" className="btn btn-secondary">
              <Terminal size={18} /> CLI Installation
            </a>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {selectedPlatform &&
              getArtifactsForPlatform(selectedPlatform).map((artifact) => {
                const isRecommended =
                  detected &&
                  artifact.platform === detected.os &&
                  artifact.arch === detected.arch
                const isPlaceholder = artifact.cid.includes('PLACEHOLDER')

                if (isPlaceholder) {
                  return (
                    <div
                      key={artifact.filename}
                      className="btn btn-secondary"
                      style={{
                        justifyContent: 'space-between',
                        padding: '1rem 1.25rem',
                        opacity: 0.6,
                        cursor: 'not-allowed',
                      }}
                    >
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                        }}
                      >
                        <Download size={18} />
                        <span>
                          {artifact.arch
                            ? getArchLabel(artifact.arch)
                            : 'Download'}
                          <span
                            style={{
                              marginLeft: '0.5rem',
                              fontSize: '0.75rem',
                            }}
                          >
                            (Coming Soon)
                          </span>
                        </span>
                      </span>
                    </div>
                  )
                }

                return (
                  <a
                    key={artifact.cid}
                    href={`/storage/download/${artifact.cid}?filename=${artifact.filename}`}
                    className={`btn ${isRecommended ? 'btn-primary' : 'btn-secondary'}`}
                    style={{
                      justifyContent: 'space-between',
                      padding: '1rem 1.25rem',
                    }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                      }}
                    >
                      <Download size={18} />
                      <span>
                        {artifact.arch
                          ? getArchLabel(artifact.arch)
                          : 'Download'}
                        {isRecommended && (
                          <span
                            style={{
                              marginLeft: '0.5rem',
                              fontSize: '0.75rem',
                              opacity: 0.8,
                            }}
                          >
                            (Recommended)
                          </span>
                        )}
                      </span>
                    </span>
                    <span
                      style={{
                        fontSize: '0.85rem',
                        opacity: 0.8,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {formatFileSize(artifact.size)}
                    </span>
                  </a>
                )
              })}
            {selectedPlatform &&
              getArtifactsForPlatform(selectedPlatform).length === 0 && (
                <div className="empty-state" style={{ padding: '2rem' }}>
                  <p>No downloads available for this platform yet.</p>
                </div>
              )}
          </div>
        )}
      </div>

      {/* CLI Installation */}
      <div id="cli-install" className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Terminal size={18} /> Command Line Installation
          </h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          For advanced users or headless servers, install via the command line:
        </p>
        <div
          style={{
            background: 'var(--bg-tertiary)',
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem',
            overflowX: 'auto',
          }}
        >
          <div style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            # Install globally with Bun
          </div>
          <div style={{ color: 'var(--accent)' }}>
            bun install -g @jejunetwork/node
          </div>
          <div
            style={{
              color: 'var(--text-muted)',
              marginTop: '1rem',
              marginBottom: '0.5rem',
            }}
          >
            # Check hardware and capabilities
          </div>
          <div>jeju-node status</div>
          <div
            style={{
              color: 'var(--text-muted)',
              marginTop: '1rem',
              marginBottom: '0.5rem',
            }}
          >
            # Start the node daemon
          </div>
          <div>jeju-node start --all</div>
        </div>
      </div>

      {/* Staking Information */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Wallet size={18} /> Staking Requirements
          </h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Node operators must stake JEJU tokens as collateral. This ensures
          quality service and enables earnings. Stakes are fully refundable when
          you deregister.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              padding: '1.25rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: '1.75rem',
                fontWeight: 700,
                color: 'var(--accent)',
                marginBottom: '0.25rem',
              }}
            >
              0.5 JEJU
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Minimum Stake
            </div>
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginTop: '0.25rem',
              }}
            >
              CDN Edge only
            </div>
          </div>
          <div
            style={{
              padding: '1.25rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: '1.75rem',
                fontWeight: 700,
                color: 'var(--accent)',
                marginBottom: '0.25rem',
              }}
            >
              5 JEJU
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Recommended Stake
            </div>
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginTop: '0.25rem',
              }}
            >
              All services
            </div>
          </div>
          <div
            style={{
              padding: '1.25rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: '1.75rem',
                fontWeight: 700,
                color: 'var(--success)',
                marginBottom: '0.25rem',
              }}
            >
              10-15%
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Est. APY
            </div>
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginTop: '0.25rem',
              }}
            >
              Based on uptime
            </div>
          </div>
        </div>

        <div
          style={{
            padding: '1rem',
            background: 'var(--info-soft)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
        >
          <Shield
            size={18}
            style={{ color: 'var(--info)', marginTop: '2px', flexShrink: 0 }}
          />
          <div style={{ fontSize: '0.9rem' }}>
            <strong>Slashing Protection:</strong> Your stake is protected.
            Slashing only occurs for provable malicious behavior
            (double-signing, serving invalid data). Hardware failures and
            downtime do not result in stake loss, only reduced earnings.
          </div>
        </div>
      </div>

      {/* Setup Steps */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Check size={18} /> How It Works
          </h3>
        </div>
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {SETUP_STEPS.map((step) => (
            <div
              key={step.number}
              style={{
                display: 'flex',
                gap: '1.25rem',
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--gradient)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '1.25rem',
                  flexShrink: 0,
                }}
              >
                {step.number}
              </div>
              <div>
                <h4
                  style={{
                    fontWeight: 600,
                    marginBottom: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {step.icon} {step.title}
                </h4>
                <p
                  style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}
                >
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Already have a node? */}
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <h3 style={{ marginBottom: '0.75rem' }}>Already Running a Node?</h3>
        <p
          style={{
            color: 'var(--text-secondary)',
            marginBottom: '1.5rem',
          }}
        >
          View your registered nodes, track earnings, and manage your
          infrastructure.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
          <a href="/provider/nodes" className="btn btn-primary">
            <Server size={18} /> My Nodes <ArrowRight size={16} />
          </a>
          <a href="/provider/earnings" className="btn btn-secondary">
            <DollarSign size={18} /> View Earnings
          </a>
        </div>
      </div>
    </div>
  )
}
