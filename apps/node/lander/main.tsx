import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import {
  detectPlatform,
  formatFileSize,
  getArchLabel,
  getPlatformLabel,
  type ReleaseArch,
  type ReleaseArtifact,
  type ReleaseManifest,
  type ReleasePlatform,
} from '@jejunetwork/types'

// Icons
function ServerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function CpuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  )
}

function HardDriveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" y1="16" x2="6.01" y2="16" />
      <line x1="10" y1="16" x2="10.01" y2="16" />
    </svg>
  )
}

function WifiIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  )
}

function DollarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  )
}

function LinuxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M12.504 0c-.155 0-.311.001-.465.003-.653.014-1.293.106-1.901.305-.602.196-1.162.487-1.671.858-.504.369-.952.82-1.332 1.343-.378.519-.685 1.107-.908 1.748-.22.634-.356 1.318-.403 2.037-.045.693-.016 1.422.08 2.17.093.719.256 1.458.476 2.201l.004.014c.238.783.515 1.553.822 2.298.074.178.148.35.222.518.006.013.01.027.017.04.26.587.543 1.148.847 1.673.305.526.63 1.013.973 1.447.342.433.7.812 1.068 1.121.365.307.737.54 1.108.683.37.143.742.196 1.105.161.364-.035.72-.16 1.055-.366.336-.207.648-.496.93-.855.282-.359.531-.785.741-1.269.204-.47.369-.997.492-1.567.121-.563.204-1.167.242-1.797.036-.597.03-1.218-.018-1.851-.05-.657-.143-1.324-.28-1.99-.14-.68-.324-1.355-.548-2.009-.228-.665-.498-1.302-.804-1.89-.306-.584-.643-1.115-1.002-1.573-.355-.453-.727-.827-1.105-1.109-.376-.28-.752-.468-1.115-.556-.361-.087-.71-.074-1.033.026-.324.1-.616.304-.86.6-.242.297-.433.688-.563 1.164-.131.48-.202 1.043-.205 1.676l-.001.125c-.001.363.027.756.082 1.175.05.387.126.798.227 1.228.098.415.22.847.364 1.291.141.433.305.877.488 1.323.183.447.386.896.606 1.336.22.44.458.869.71 1.28.25.409.516.797.793 1.156.28.363.57.693.87.981.3.29.61.536.924.728.313.192.631.328.948.398.317.07.633.074.94.008.306-.067.6-.2.875-.395.276-.196.531-.454.76-.77.228-.315.429-.686.596-1.105.163-.41.296-.865.393-1.356.095-.479.158-.99.184-1.524.024-.503.017-1.026-.025-1.56-.043-.557-.12-1.124-.23-1.688-.113-.584-.26-1.161-.439-1.718-.183-.57-.4-1.117-.647-1.626-.25-.515-.53-.989-.836-1.41-.305-.42-.634-.784-.983-1.08-.348-.295-.712-.52-1.087-.666-.374-.146-.756-.212-1.139-.195" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

const SERVICES = [
  { name: 'VPN Node', icon: '🔒', reward: '~$50/month', description: 'Route VPN traffic' },
  { name: 'CDN Edge', icon: '⚡', reward: '~$30/month', description: 'Cache & serve content' },
  { name: 'Storage', icon: '💾', reward: '~$40/month', description: 'Store network data' },
  { name: 'RPC Provider', icon: '🔗', reward: '~$80/month', description: 'Serve blockchain queries' },
]

function App() {
  const [release, setRelease] = useState<ReleaseManifest | null>(null)
  const [detected, setDetected] = useState<ReturnType<typeof detectPlatform> | null>(null)

  useEffect(() => {
    setDetected(detectPlatform())

    fetch('/api/releases/latest')
      .then((res) => res.json())
      .then((data) => setRelease(data))
      .catch(() => {
        setRelease({
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
              size: 1024 * 1024 * 85,
              sha256: 'abc123',
            },
            {
              platform: 'macos',
              arch: 'x64',
              filename: 'JejuNode-1.0.0-x64.dmg',
              cid: 'QmNodeMacX641',
              size: 1024 * 1024 * 92,
              sha256: 'def456',
            },
            {
              platform: 'windows',
              arch: 'x64',
              filename: 'JejuNode-1.0.0-x64.msi',
              cid: 'QmNodeWinX641',
              size: 1024 * 1024 * 78,
              sha256: 'ghi789',
            },
            {
              platform: 'linux',
              arch: 'x64',
              filename: 'JejuNode-1.0.0-x64.AppImage',
              cid: 'QmNodeLinuxX641',
              size: 1024 * 1024 * 95,
              sha256: 'jkl012',
            },
            {
              platform: 'linux',
              arch: 'arm64',
              filename: 'JejuNode-1.0.0-arm64.AppImage',
              cid: 'QmNodeLinuxArm1',
              size: 1024 * 1024 * 88,
              sha256: 'mno345',
            },
          ],
        })
      })
  }, [])

  const getRecommendedArtifact = (): ReleaseArtifact | null => {
    if (!release || !detected) return null
    return release.artifacts.find(
      (a) => a.platform === detected.os && a.arch === detected.arch,
    ) ?? release.artifacts.find(
      (a) => a.platform === detected.os,
    ) ?? null
  }

  const recommendedArtifact = getRecommendedArtifact()

  return (
    <div className="min-h-screen flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-node-purple/10 via-transparent to-node-indigo/10" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)',
            backgroundSize: '80px 80px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-surface-border backdrop-blur-xl bg-node-darker/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 text-node-purple font-bold text-xl">
            <div className="w-10 h-10 bg-node-purple rounded-xl flex items-center justify-center glow-purple">
              <span className="w-5 h-5 text-white">
                <ServerIcon />
              </span>
            </div>
            Jeju Node
          </a>
          <nav className="hidden md:flex items-center gap-8">
            <a href="#services" className="text-white/70 hover:text-node-purple-light transition-colors font-medium">
              Services
            </a>
            <a href="#requirements" className="text-white/70 hover:text-node-purple-light transition-colors font-medium">
              Requirements
            </a>
            <a href="#download" className="text-white/70 hover:text-node-purple-light transition-colors font-medium">
              Download
            </a>
            <a
              href={recommendedArtifact ? `/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}` : '#download'}
              className="bg-node-purple text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-node-purple-light transition-colors"
            >
              Download App
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 relative z-10">
        <section className="min-h-[80vh] flex flex-col items-center justify-center px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 bg-surface-elevated border border-surface-border px-4 py-2 rounded-full text-sm text-white/80 mb-8 animate-fade-in-up">
            <span className="w-2 h-2 bg-node-purple rounded-full animate-pulse-slow" />
            Earn While You Sleep
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight animate-fade-in-up">
            <span className="gradient-text">Run Infrastructure</span>
            <br />
            <span className="text-white">Earn Rewards</span>
          </h1>

          <p className="text-xl md:text-2xl text-white/60 max-w-2xl mb-12 animate-fade-in-up">
            Help power the decentralized web. Run VPN nodes, CDN edges, storage, and RPC services.
            Get paid in JEJU tokens.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 animate-fade-in-up">
            {recommendedArtifact && detected && (
              <a
                href={`/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}`}
                className="bg-node-purple text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-node-purple-light transition-colors inline-flex items-center gap-3 glow-purple"
              >
                <span className="w-6 h-6">
                  <DownloadIcon />
                </span>
                Download for {getPlatformLabel(detected.os as ReleasePlatform)}
                {detected.arch !== 'unknown' && ` (${getArchLabel(detected.arch as ReleaseArch)})`}
              </a>
            )}
            <a
              href="#download"
              className="border-2 border-white/20 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:border-node-purple hover:text-node-purple-light transition-colors inline-flex items-center gap-3"
            >
              All Downloads
            </a>
          </div>
        </section>

        {/* Stats */}
        <section className="py-16 px-6 border-t border-b border-surface-border bg-surface-elevated/30">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
            <Stat icon={<UsersIcon />} value="2,500+" label="Active Nodes" />
            <Stat icon={<GlobeIcon />} value="45+" label="Countries" />
            <Stat icon={<DollarIcon />} value="$150K+" label="Paid Monthly" />
            <Stat icon={<WifiIcon />} value="99.9%" label="Uptime" />
          </div>
        </section>

        {/* Services */}
        <section id="services" className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-bold text-center mb-6">
              Choose Your Services
            </h2>
            <p className="text-xl text-white/60 text-center mb-16 max-w-2xl mx-auto">
              Run one or multiple services based on your hardware. More services = more rewards.
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {SERVICES.map((service) => (
                <ServiceCard key={service.name} {...service} />
              ))}
            </div>
          </div>
        </section>

        {/* Requirements */}
        <section id="requirements" className="py-20 px-6 bg-surface-elevated/30">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-4xl font-bold text-center mb-16">
              System Requirements
            </h2>

            <div className="grid md:grid-cols-3 gap-8">
              <RequirementCard
                icon={<CpuIcon />}
                title="CPU"
                minimum="2 cores"
                recommended="4+ cores"
              />
              <RequirementCard
                icon={<HardDriveIcon />}
                title="Storage"
                minimum="50 GB SSD"
                recommended="500 GB+ NVMe"
              />
              <RequirementCard
                icon={<WifiIcon />}
                title="Bandwidth"
                minimum="100 Mbps"
                recommended="1 Gbps+"
              />
            </div>

            <p className="text-center text-white/50 mt-10">
              Higher specs = more service types = higher rewards
            </p>
          </div>
        </section>

        {/* Downloads */}
        <section id="download" className="py-20 px-6">
          <div className="max-w-5xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-6">Download Jeju Node</h2>
            <p className="text-xl text-white/60 mb-12">
              Available for macOS, Windows, and Linux. Version {release?.version ?? '1.0.0'}
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* macOS */}
              <PlatformDownloads
                icon={<AppleIcon />}
                name="macOS"
                artifacts={release?.artifacts.filter((a) => a.platform === 'macos') ?? []}
                recommended={detected?.os === 'macos'}
                recommendedArch={detected?.arch}
              />
              {/* Windows */}
              <PlatformDownloads
                icon={<WindowsIcon />}
                name="Windows"
                artifacts={release?.artifacts.filter((a) => a.platform === 'windows') ?? []}
                recommended={detected?.os === 'windows'}
                recommendedArch={detected?.arch}
              />
              {/* Linux */}
              <PlatformDownloads
                icon={<LinuxIcon />}
                name="Linux"
                artifacts={release?.artifacts.filter((a) => a.platform === 'linux') ?? []}
                recommended={detected?.os === 'linux'}
                recommendedArch={detected?.arch}
              />
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-20 px-6 bg-surface-elevated/30">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-4xl font-bold text-center mb-16">
              Start Earning in 3 Steps
            </h2>

            <div className="space-y-8">
              <Step
                number={1}
                title="Download & Install"
                description="Install Jeju Node on your computer. Works on macOS, Windows, and Linux."
              />
              <Step
                number={2}
                title="Configure Services"
                description="Choose which services to run based on your hardware. Stake JEJU tokens to get started."
              />
              <Step
                number={3}
                title="Earn Rewards"
                description="Run 24/7 and watch the JEJU tokens roll in. Withdraw anytime to your wallet."
              />
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 px-6 bg-gradient-to-b from-node-purple/10 to-transparent">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-6">
              Ready to Join the Network?
            </h2>
            <p className="text-xl text-white/60 mb-10">
              Download Jeju Node and start earning today.
            </p>
            {recommendedArtifact && (
              <a
                href={`/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}`}
                className="bg-node-purple text-white px-10 py-5 rounded-xl font-semibold text-lg hover:bg-node-purple-light transition-colors inline-flex items-center gap-3"
              >
                <span className="w-6 h-6">
                  <DownloadIcon />
                </span>
                Download Now
              </a>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-surface-border py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex gap-6 text-sm text-white/60">
            <a href="https://jejunetwork.org" target="_blank" rel="noopener" className="hover:text-node-purple-light transition-colors">
              Jeju Network
            </a>
            <a href="https://github.com/jejunetwork/node" target="_blank" rel="noopener" className="hover:text-node-purple-light transition-colors">
              GitHub
            </a>
            <a href="/api/info" className="hover:text-node-purple-light transition-colors">
              API
            </a>
          </div>
          <p className="text-sm text-white/40">
            © 2025 Jeju Network. Decentralized infrastructure.
          </p>
        </div>
      </footer>
    </div>
  )
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="w-10 h-10 mx-auto mb-3 text-node-purple">{icon}</div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      <div className="text-sm text-white/60">{label}</div>
    </div>
  )
}

function ServiceCard({
  name,
  icon,
  reward,
  description,
}: {
  name: string
  icon: string
  reward: string
  description: string
}) {
  return (
    <div className="bg-surface-elevated border border-surface-border rounded-2xl p-6 hover:border-node-purple/30 transition-colors group">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{name}</h3>
      <p className="text-white/60 text-sm mb-4">{description}</p>
      <div className="flex items-center justify-between">
        <span className="text-node-purple-light font-semibold">{reward}</span>
        <span className="text-xs text-white/40">estimated</span>
      </div>
    </div>
  )
}

function RequirementCard({
  icon,
  title,
  minimum,
  recommended,
}: {
  icon: React.ReactNode
  title: string
  minimum: string
  recommended: string
}) {
  return (
    <div className="bg-surface-elevated border border-surface-border rounded-2xl p-6">
      <div className="w-12 h-12 bg-node-purple/20 rounded-xl flex items-center justify-center mb-4 text-node-purple">
        <span className="w-6 h-6">{icon}</span>
      </div>
      <h3 className="text-xl font-semibold mb-4">{title}</h3>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-white/60">Minimum</span>
          <span className="font-medium">{minimum}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/60">Recommended</span>
          <span className="font-medium text-node-purple-light">{recommended}</span>
        </div>
      </div>
    </div>
  )
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex gap-6 items-start">
      <div className="w-12 h-12 bg-node-purple text-white rounded-xl flex items-center justify-center font-bold text-xl flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <p className="text-white/60">{description}</p>
      </div>
    </div>
  )
}

function PlatformDownloads({
  icon,
  name,
  artifacts,
  recommended,
  recommendedArch,
}: {
  icon: React.ReactNode
  name: string
  artifacts: ReleaseArtifact[]
  recommended?: boolean
  recommendedArch?: string
}) {
  return (
    <div
      className={`bg-surface-elevated border rounded-2xl p-6 transition-all ${
        recommended ? 'border-node-purple/50 ring-2 ring-node-purple/20' : 'border-surface-border'
      }`}
    >
      {recommended && (
        <span className="text-xs text-node-purple font-medium uppercase tracking-wider">Your Platform</span>
      )}
      <div className="w-10 h-10 mx-auto my-4 text-white/80">{icon}</div>
      <h3 className="text-lg font-semibold mb-4">{name}</h3>

      {artifacts.length > 0 ? (
        <div className="space-y-2">
          {artifacts.map((artifact) => {
            const isRecommendedArch = recommendedArch === artifact.arch
            return (
              <a
                key={artifact.cid}
                href={`/storage/download/${artifact.cid}?filename=${artifact.filename}`}
                className={`block w-full py-2.5 px-4 rounded-xl font-medium transition-colors text-left ${
                  isRecommendedArch
                    ? 'bg-node-purple text-white hover:bg-node-purple-light'
                    : 'bg-white/5 text-white/80 hover:bg-white/10'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span>{artifact.arch ? getArchLabel(artifact.arch) : 'Download'}</span>
                  <span className="text-xs opacity-70">{formatFileSize(artifact.size)}</span>
                </div>
              </a>
            )
          })}
        </div>
      ) : (
        <span className="block w-full bg-white/5 text-white/40 py-2.5 rounded-xl font-medium text-center">
          Coming Soon
        </span>
      )}
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<App />)
}
