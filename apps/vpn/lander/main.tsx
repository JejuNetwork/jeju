import {
  detectPlatform,
  formatFileSize,
  getPlatformLabel,
  type ReleaseArtifact,
  type ReleaseManifest,
} from '@jejunetwork/types'
import type React from 'react'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

// Icons
function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-full h-full"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-full h-full"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-full h-full"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-full h-full"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-full h-full"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function ChromeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-3.953 6.848c.062.004.124.006.186.006 6.627 0 12-5.373 12-12 0-1.17-.168-2.303-.478-3.377H12c.989 0 1.93.219 2.773.611z" />
    </svg>
  )
}

function FirefoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6.066 6.066c-.248 0-.476.058-.682.157-.16-.34-.4-.657-.719-.952-1.277-1.18-3.424-1.275-4.852-.275-.276.193-.513.425-.706.685a4.51 4.51 0 0 0-2.176-.556c-.97 0-1.893.38-2.582 1.069-.689.689-1.069 1.612-1.069 2.582 0 .97.38 1.893 1.069 2.582l.01.01c-.06.134-.093.282-.093.437 0 .579.47 1.049 1.049 1.049.35 0 .66-.172.85-.435l.024.015c.52.313 1.12.48 1.736.48.622 0 1.226-.17 1.75-.492l.004.002a2.1 2.1 0 0 0 2.091 1.937c1.16 0 2.1-.94 2.1-2.1 0-.42-.123-.81-.336-1.138.213-.328.336-.718.336-1.138 0-1.16-.94-2.1-2.1-2.1-.08 0-.16.005-.238.014.07-.22.108-.454.108-.698 0-1.268-1.028-2.297-2.297-2.297-.45 0-.869.13-1.223.353a2.284 2.284 0 0 1 .058-.164c.162-.405.42-.766.75-1.056.857-.75 2.106-.836 3.065-.21.405.265.733.625.955 1.046.093.177.293.286.503.286.094 0 .186-.023.269-.068.205-.11.321-.333.288-.558a3.21 3.21 0 0 0-.115-.472 2.099 2.099 0 0 1 2.186.546c.452.452.679 1.053.679 1.654s-.227 1.202-.679 1.654c-.452.452-1.053.679-1.654.679z" />
    </svg>
  )
}

function EdgeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M21.86 17.86c.26-.63.4-1.31.4-2 0-2.21-1.34-4-3-4-1.39 0-2.59.91-3.24 2.22-.47-1.73-1.91-3.13-3.79-3.57.7-1.58 2.25-2.67 4.05-2.67 2.49 0 4.5 2.01 4.5 4.5 0 .67-.15 1.31-.4 1.88.18.13.35.27.5.43.8.8 1.26 1.9 1.26 3.04 0 1.14-.46 2.24-1.26 3.04-.8.8-1.9 1.26-3.04 1.26H5.86c-1.14 0-2.24-.46-3.04-1.26C2.02 20.09 1.56 19 1.56 17.86c0-1.14.46-2.24 1.26-3.04.15-.15.31-.29.48-.42a4.5 4.5 0 0 1-.43-1.9c0-2.49 2.01-4.5 4.5-4.5 1.8 0 3.36 1.06 4.06 2.6a5.02 5.02 0 0 0-1.16 3.22c0 .26.02.52.06.77-.71.16-1.33.61-1.7 1.21-.37.6-.52 1.31-.42 2.01.1.71.44 1.35.95 1.82.51.47 1.17.73 1.86.73h7.14c.47 0 .93-.12 1.33-.34.4-.22.74-.54.98-.93.23-.39.36-.84.36-1.3 0-.46-.13-.91-.36-1.3-.24-.39-.58-.71-.98-.93z" />
    </svg>
  )
}

function App() {
  const [release, setRelease] = useState<ReleaseManifest | null>(null)
  const [detected, setDetected] = useState<ReturnType<
    typeof detectPlatform
  > | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Detect platform
    setDetected(detectPlatform())

    // Fetch latest release - fail properly if unavailable
    fetch('/api/releases/latest')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch releases: ${res.status}`)
        }
        return res.json()
      })
      .then((data) => {
        setRelease(data)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load release info:', err)
        setError(
          'Release information temporarily unavailable. Please check back later.',
        )
        setLoading(false)
      })
  }, [])

  const getRecommendedArtifact = (): ReleaseArtifact | null => {
    if (!release || !detected) return null
    return (
      release.artifacts.find((a) => a.platform === detected.browser) ??
      release.artifacts[0] ??
      null
    )
  }

  const recommendedArtifact = getRecommendedArtifact()

  return (
    <div className="min-h-screen flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-vpn-green/5 via-transparent to-transparent" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-surface-border backdrop-blur-xl bg-vpn-darker/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <a
            href="/"
            className="flex items-center gap-3 text-vpn-green font-bold text-xl"
          >
            <div className="w-10 h-10 bg-vpn-green rounded-xl flex items-center justify-center glow-green">
              <span className="w-5 h-5 text-vpn-dark">
                <ShieldIcon />
              </span>
            </div>
            Jeju VPN
          </a>
          <nav className="hidden md:flex items-center gap-8">
            <a
              href="#features"
              className="text-white/70 hover:text-vpn-green transition-colors font-medium"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-white/70 hover:text-vpn-green transition-colors font-medium"
            >
              How It Works
            </a>
            <a
              href="#download"
              className="text-white/70 hover:text-vpn-green transition-colors font-medium"
            >
              Download
            </a>
            <a
              href={
                recommendedArtifact
                  ? `/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}`
                  : '#download'
              }
              className="bg-vpn-green text-vpn-dark px-6 py-2.5 rounded-xl font-semibold hover:bg-vpn-green-dark transition-colors"
            >
              Install Extension
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 relative z-10">
        <section className="min-h-[80vh] flex flex-col items-center justify-center px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 bg-surface-elevated border border-surface-border px-4 py-2 rounded-full text-sm text-white/80 mb-8 animate-fade-in-up">
            <span className="w-2 h-2 bg-vpn-green rounded-full animate-pulse-slow" />
            Free & Community Powered
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold mb-6 leading-tight animate-fade-in-up">
            <span className="gradient-text">Free VPN</span>
            <br />
            For Everyone
          </h1>

          <p className="text-xl md:text-2xl text-white/60 max-w-2xl mb-12 animate-fade-in-up">
            Unlimited VPN access powered by the community. Use the network when
            you need it, contribute bandwidth when you don't.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 animate-fade-in-up">
            {!loading && !error && recommendedArtifact && detected && (
              <a
                href={`/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}`}
                className="bg-vpn-green text-vpn-dark px-8 py-4 rounded-xl font-semibold text-lg hover:bg-vpn-green-dark transition-colors inline-flex items-center gap-3 glow-green"
              >
                <span className="w-6 h-6">
                  <DownloadIcon />
                </span>
                Install for{' '}
                {getPlatformLabel(
                  detected.browser as 'chrome' | 'firefox' | 'edge' | 'safari',
                )}
              </a>
            )}
            {loading && (
              <span className="bg-white/10 text-white/50 px-8 py-4 rounded-xl font-semibold text-lg inline-flex items-center gap-3">
                Loading...
              </span>
            )}
            <a
              href="#download"
              className="border-2 border-white/20 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:border-vpn-green hover:text-vpn-green transition-colors inline-flex items-center gap-3"
            >
              All Downloads
            </a>
          </div>
        </section>

        {/* Features Highlights */}
        <section className="py-16 px-6 border-t border-b border-surface-border bg-surface-elevated/30">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
            <Stat icon={<ShieldIcon />} value="100%" label="Free Forever" />
            <Stat icon={<GlobeIcon />} value="P2P" label="Decentralized" />
            <Stat icon={<HeartIcon />} value="Open" label="Source" />
            <Stat icon={<UsersIcon />} value="Community" label="Powered" />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-bold text-center mb-16">
              Why Choose Jeju VPN?
            </h2>

            <div className="grid md:grid-cols-3 gap-8">
              <FeatureCard
                icon="🔒"
                title="Truly Free"
                description="No subscriptions, no hidden fees. Contribute bandwidth when idle, get unlimited VPN access in return."
              />
              <FeatureCard
                icon="🌐"
                title="Decentralized"
                description="No central servers to shut down. The network is run by users like you, making it censorship-resistant."
              />
              <FeatureCard
                icon="⚡"
                title="Fast & Reliable"
                description="Our P2P architecture means traffic takes the shortest path. Plus, more users = more bandwidth."
              />
              <FeatureCard
                icon="🛡️"
                title="Privacy First"
                description="No logs, no tracking. Your traffic is encrypted end-to-end. We can't see what you do."
              />
              <FeatureCard
                icon="🤝"
                title="Community Powered"
                description="Help others access the free internet while you're not using it. Give back to the community."
              />
              <FeatureCard
                icon="🔗"
                title="JNS Resolver"
                description="Access .jeju domains and resolve Jeju Name Service records directly in your browser."
              />
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section
          id="how-it-works"
          className="py-20 px-6 bg-surface-elevated/30"
        >
          <div className="max-w-4xl mx-auto">
            <h2 className="text-4xl font-bold text-center mb-16">
              How It Works
            </h2>

            <div className="space-y-8">
              <Step
                number={1}
                title="Install the Extension"
                description="Add Jeju VPN to Chrome, Firefox, or Edge. Takes less than 30 seconds."
              />
              <Step
                number={2}
                title="Connect to VPN"
                description="Click to connect. Choose from 30+ countries or let us pick the fastest server."
              />
              <Step
                number={3}
                title="Give Back When Idle"
                description="Enable contribution mode to share a small amount of bandwidth. Help others while you're AFK."
              />
            </div>
          </div>
        </section>

        {/* Downloads */}
        <section id="download" className="py-20 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-6">Download Jeju VPN</h2>

            {loading && (
              <p className="text-xl text-white/60 mb-12">
                Loading release information...
              </p>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 mb-12">
                <p className="text-red-400">{error}</p>
                <p className="text-sm text-white/50 mt-2">
                  Extensions will be available in browser stores. Check back
                  soon.
                </p>
              </div>
            )}

            {!loading && !error && (
              <>
                <p className="text-xl text-white/60 mb-12">
                  Available for all major browsers. Version{' '}
                  {release?.version ?? 'unavailable'}
                </p>

                <div className="grid sm:grid-cols-3 gap-6">
                  <DownloadCard
                    icon={<ChromeIcon />}
                    name="Chrome"
                    artifact={release?.artifacts.find(
                      (a) => a.platform === 'chrome',
                    )}
                    recommended={detected?.browser === 'chrome'}
                    storeUrl="https://chrome.google.com/webstore"
                  />
                  <DownloadCard
                    icon={<FirefoxIcon />}
                    name="Firefox"
                    artifact={release?.artifacts.find(
                      (a) => a.platform === 'firefox',
                    )}
                    recommended={detected?.browser === 'firefox'}
                    storeUrl="https://addons.mozilla.org"
                  />
                  <DownloadCard
                    icon={<EdgeIcon />}
                    name="Edge"
                    artifact={release?.artifacts.find(
                      (a) => a.platform === 'edge',
                    )}
                    recommended={detected?.browser === 'edge'}
                    storeUrl="https://microsoftedge.microsoft.com/addons"
                  />
                </div>

                <p className="mt-8 text-sm text-white/40">
                  Extension pending review in browser stores. Direct download
                  available now.
                </p>
              </>
            )}
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 px-6 bg-gradient-to-b from-vpn-green/10 to-transparent">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-6">Ready to Browse Freely?</h2>
            <p className="text-xl text-white/60 mb-10">
              Join thousands of users who trust Jeju VPN for their privacy.
            </p>
            {recommendedArtifact && (
              <a
                href={`/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}`}
                className="bg-vpn-green text-vpn-dark px-10 py-5 rounded-xl font-semibold text-lg hover:bg-vpn-green-dark transition-colors inline-flex items-center gap-3"
              >
                <span className="w-6 h-6">
                  <DownloadIcon />
                </span>
                Get Started Free
              </a>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-surface-border py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex gap-6 text-sm text-white/60">
            <a
              href="https://jejunetwork.org"
              target="_blank"
              rel="noopener"
              className="hover:text-vpn-green transition-colors"
            >
              Jeju Network
            </a>
            <a
              href="https://github.com/jejunetwork/vpn"
              target="_blank"
              rel="noopener"
              className="hover:text-vpn-green transition-colors"
            >
              GitHub
            </a>
            <a
              href="/api/info"
              className="hover:text-vpn-green transition-colors"
            >
              API
            </a>
          </div>
          <p className="text-sm text-white/40">
            © 2025 Jeju Network. Open source & decentralized.
          </p>
        </div>
      </footer>
    </div>
  )
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode
  value: string
  label: string
}) {
  return (
    <div className="text-center">
      <div className="w-10 h-10 mx-auto mb-3 text-vpn-green">{icon}</div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      <div className="text-sm text-white/60">{label}</div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div className="bg-surface-elevated border border-surface-border rounded-2xl p-6 hover:border-vpn-green/30 transition-colors">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-white/60 leading-relaxed">{description}</p>
    </div>
  )
}

function Step({
  number,
  title,
  description,
}: {
  number: number
  title: string
  description: string
}) {
  return (
    <div className="flex gap-6 items-start">
      <div className="w-12 h-12 bg-vpn-green text-vpn-dark rounded-xl flex items-center justify-center font-bold text-xl flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <p className="text-white/60">{description}</p>
      </div>
    </div>
  )
}

function DownloadCard({
  icon,
  name,
  artifact,
  recommended,
  storeUrl,
}: {
  icon: React.ReactNode
  name: string
  artifact?: ReleaseArtifact
  recommended?: boolean
  storeUrl?: string
}) {
  return (
    <div
      className={`bg-surface-elevated border rounded-2xl p-6 text-center transition-all ${
        recommended
          ? 'border-vpn-green/50 ring-2 ring-vpn-green/20'
          : 'border-surface-border hover:border-vpn-green/30'
      }`}
    >
      {recommended && (
        <span className="text-xs text-vpn-green font-medium uppercase tracking-wider">
          Recommended
        </span>
      )}
      <div className="w-12 h-12 mx-auto my-4 text-white/80">{icon}</div>
      <h3 className="text-lg font-semibold mb-1">{name}</h3>
      {artifact && (
        <p className="text-sm text-white/50 mb-4">
          {formatFileSize(artifact.size)}
        </p>
      )}
      {artifact ? (
        <a
          href={`/storage/download/${artifact.cid}?filename=${artifact.filename}`}
          className="block w-full bg-vpn-green/10 text-vpn-green py-2.5 rounded-xl font-medium hover:bg-vpn-green hover:text-vpn-dark transition-colors"
        >
          Download
        </a>
      ) : (
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener"
          className="block w-full bg-white/5 text-white/60 py-2.5 rounded-xl font-medium hover:bg-white/10 transition-colors"
        >
          Coming Soon
        </a>
      )}
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<App />)
}
