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
function WalletIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-full h-full"
    >
      <path d="M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <path d="M16 12h.01" />
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

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-full h-full"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

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

function ZapIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-full h-full"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
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

const CHAINS = [
  { name: 'Ethereum', icon: '⟠', color: '#627EEA' },
  { name: 'Base', icon: '🔵', color: '#0052FF' },
  { name: 'Arbitrum', icon: '🔷', color: '#28A0F0' },
  { name: 'Optimism', icon: '🔴', color: '#FF0420' },
  { name: 'Polygon', icon: '💜', color: '#8247E5' },
  { name: 'BNB Chain', icon: '🟡', color: '#F3BA2F' },
  { name: 'Avalanche', icon: '🔺', color: '#E84142' },
  { name: 'Solana', icon: '◎', color: '#14F195' },
]

function App() {
  const [release, setRelease] = useState<ReleaseManifest | null>(null)
  const [detected, setDetected] = useState<ReturnType<
    typeof detectPlatform
  > | null>(null)

  useEffect(() => {
    setDetected(detectPlatform())

    fetch('/api/releases/latest')
      .then((res) => res.json())
      .then((data) => setRelease(data))
      .catch(() => {
        setRelease({
          app: 'wallet',
          version: '1.0.0',
          releasedAt: new Date().toISOString(),
          channel: 'stable',
          artifacts: [
            {
              platform: 'chrome',
              filename: 'jeju-wallet-chrome-1.0.0.zip',
              cid: 'QmWalletChrome1',
              size: 1024 * 1024 * 2.3,
              sha256: 'abc123',
            },
            {
              platform: 'firefox',
              filename: 'jeju-wallet-firefox-1.0.0.xpi',
              cid: 'QmWalletFirefox1',
              size: 1024 * 1024 * 2.1,
              sha256: 'def456',
            },
            {
              platform: 'edge',
              filename: 'jeju-wallet-edge-1.0.0.zip',
              cid: 'QmWalletEdge1',
              size: 1024 * 1024 * 2.3,
              sha256: 'ghi789',
            },
          ],
        })
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
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-jeju-500/5 via-transparent to-emerald-500/5" />
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
      <header className="relative z-10 border-b border-surface-border backdrop-blur-xl bg-surface/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <a
            href="/"
            className="flex items-center gap-3 text-jeju-400 font-bold text-xl"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-jeju-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-jeju-500/20">
              <span className="w-5 h-5 text-white">
                <WalletIcon />
              </span>
            </div>
            Network Wallet
          </a>
          <nav className="hidden md:flex items-center gap-8">
            <a
              href="#features"
              className="text-gray-400 hover:text-jeju-400 transition-colors font-medium"
            >
              Features
            </a>
            <a
              href="#chains"
              className="text-gray-400 hover:text-jeju-400 transition-colors font-medium"
            >
              Chains
            </a>
            <a
              href="#download"
              className="text-gray-400 hover:text-jeju-400 transition-colors font-medium"
            >
              Download
            </a>
            <a
              href={
                recommendedArtifact
                  ? `/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}`
                  : '#download'
              }
              className="px-6 py-2.5 bg-gradient-to-r from-jeju-500 to-emerald-500 rounded-xl text-white font-semibold hover:from-jeju-400 hover:to-emerald-400 transition-all shadow-lg shadow-jeju-500/20"
            >
              Install Extension
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 relative z-10">
        <section className="min-h-[80vh] flex flex-col items-center justify-center px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 bg-surface-elevated border border-surface-border px-4 py-2 rounded-full text-sm text-gray-400 mb-8">
            <span className="w-2 h-2 bg-jeju-400 rounded-full animate-pulse" />
            Powered by Jeju Network
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold mb-6 leading-tight">
            <span className="bg-gradient-to-r from-jeju-400 to-emerald-400 bg-clip-text text-transparent">
              One Wallet
            </span>
            <br />
            <span className="text-white">Every Chain</span>
          </h1>

          <p className="text-xl md:text-2xl text-gray-400 mb-12 max-w-2xl mx-auto">
            The cross-chain wallet that just works. No bridging, no chain
            switching. Your balance, unified across all chains.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {recommendedArtifact && detected && (
              <a
                href={`/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}`}
                className="px-8 py-4 bg-gradient-to-r from-jeju-500 to-emerald-500 rounded-xl text-white font-semibold text-lg hover:from-jeju-400 hover:to-emerald-400 transition-all shadow-lg shadow-jeju-500/20 inline-flex items-center gap-3"
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
            <a
              href="https://github.com/jejunetwork/wallet"
              target="_blank"
              rel="noopener"
              className="px-8 py-4 bg-surface-elevated border border-surface-border rounded-xl font-semibold text-lg hover:bg-surface-hover transition-all inline-flex items-center gap-3"
            >
              View on GitHub
            </a>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="px-6 py-20 bg-surface-elevated/50">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-bold text-center mb-16">
              Why Network Wallet?
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <FeatureCard
                icon={<LinkIcon />}
                title="Cross-Chain Native"
                description="Use any chain without switching networks. Your balance is unified across all supported chains."
              />
              <FeatureCard
                icon={<ZapIcon />}
                title="No Bridging Required"
                description="Forget about bridges. Intent-based fills handle cross-chain liquidity seamlessly in the background."
              />
              <FeatureCard
                icon={<ShieldIcon />}
                title="Self-Custodial"
                description="Your keys, your crypto. Full control with hardware wallet and social recovery support."
              />
            </div>
          </div>
        </section>

        {/* Chains */}
        <section id="chains" className="px-6 py-20">
          <div className="max-w-5xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-6">One Balance, All Chains</h2>
            <p className="text-xl text-gray-400 mb-12">
              Send and receive on any chain. Network Wallet handles the routing.
            </p>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-4">
              {CHAINS.map((chain) => (
                <div
                  key={chain.name}
                  className="aspect-square bg-surface-elevated border border-surface-border rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-jeju-400/30 transition-colors group"
                >
                  <span className="text-2xl group-hover:scale-110 transition-transform">
                    {chain.icon}
                  </span>
                  <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors hidden md:block">
                    {chain.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Downloads */}
        <section id="download" className="py-20 px-6 bg-surface-elevated/50">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-6">Get Network Wallet</h2>
            <p className="text-xl text-gray-400 mb-12">
              Available for all major browsers. Version{' '}
              {release?.version ?? '1.0.0'}
            </p>

            <div className="grid sm:grid-cols-3 gap-6">
              <DownloadCard
                icon={<ChromeIcon />}
                name="Chrome"
                artifact={release?.artifacts.find(
                  (a) => a.platform === 'chrome',
                )}
                recommended={detected?.browser === 'chrome'}
              />
              <DownloadCard
                icon={<FirefoxIcon />}
                name="Firefox"
                artifact={release?.artifacts.find(
                  (a) => a.platform === 'firefox',
                )}
                recommended={detected?.browser === 'firefox'}
              />
              <DownloadCard
                icon={<EdgeIcon />}
                name="Edge"
                artifact={release?.artifacts.find((a) => a.platform === 'edge')}
                recommended={detected?.browser === 'edge'}
              />
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="px-6 py-20">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-4xl font-bold text-center mb-16">
              How It Works
            </h2>

            <div className="space-y-8">
              <Step
                number={1}
                title="Install the Extension"
                description="Add Network Wallet to your browser. Import an existing seed phrase or create a new wallet."
              />
              <Step
                number={2}
                title="Deposit on Any Chain"
                description="Send tokens to your wallet on any supported chain. Your unified balance updates automatically."
              />
              <Step
                number={3}
                title="Spend Anywhere"
                description="Connect to any dApp on any chain. Network Wallet routes your transaction through the optimal path."
              />
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 px-6 bg-gradient-to-b from-jeju-500/10 to-transparent">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-6">
              Ready for the Future of Wallets?
            </h2>
            <p className="text-xl text-gray-400 mb-10">
              Join thousands of users who never think about chains anymore.
            </p>
            {recommendedArtifact && (
              <a
                href={`/storage/download/${recommendedArtifact.cid}?filename=${recommendedArtifact.filename}`}
                className="px-10 py-5 bg-gradient-to-r from-jeju-500 to-emerald-500 rounded-xl text-white font-semibold text-lg hover:from-jeju-400 hover:to-emerald-400 transition-all shadow-lg shadow-jeju-500/20 inline-flex items-center gap-3"
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
      <footer className="relative z-10 px-6 py-8 border-t border-surface-border">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-gray-500 text-sm">
            © 2025 Jeju Network. Open source & self-custodial.
          </p>
          <div className="flex gap-6 text-sm text-gray-400">
            <a
              href="https://docs.jejunetwork.io"
              className="hover:text-white transition-colors"
            >
              Docs
            </a>
            <a
              href="https://discord.gg/jeju"
              className="hover:text-white transition-colors"
            >
              Discord
            </a>
            <a
              href="https://twitter.com/jejunetwork"
              className="hover:text-white transition-colors"
            >
              Twitter
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="p-6 bg-surface-elevated border border-surface-border rounded-2xl hover:border-jeju-400/30 transition-colors">
      <div className="w-12 h-12 bg-gradient-to-br from-jeju-500/20 to-emerald-500/20 rounded-xl flex items-center justify-center mb-4 text-jeju-400">
        <span className="w-6 h-6">{icon}</span>
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400">{description}</p>
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
      <div className="w-12 h-12 bg-gradient-to-br from-jeju-500 to-emerald-500 text-white rounded-xl flex items-center justify-center font-bold text-xl flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <p className="text-gray-400">{description}</p>
      </div>
    </div>
  )
}

function DownloadCard({
  icon,
  name,
  artifact,
  recommended,
}: {
  icon: React.ReactNode
  name: string
  artifact?: ReleaseArtifact
  recommended?: boolean
}) {
  return (
    <div
      className={`bg-surface-elevated border rounded-2xl p-6 text-center transition-all ${
        recommended
          ? 'border-jeju-400/50 ring-2 ring-jeju-400/20'
          : 'border-surface-border hover:border-jeju-400/30'
      }`}
    >
      {recommended && (
        <span className="text-xs text-jeju-400 font-medium uppercase tracking-wider">
          Recommended
        </span>
      )}
      <div className="w-12 h-12 mx-auto my-4 text-gray-400">{icon}</div>
      <h3 className="text-lg font-semibold mb-1">{name}</h3>
      {artifact && (
        <p className="text-sm text-gray-500 mb-4">
          {formatFileSize(artifact.size)}
        </p>
      )}
      {artifact ? (
        <a
          href={`/storage/download/${artifact.cid}?filename=${artifact.filename}`}
          className="block w-full bg-gradient-to-r from-jeju-500/10 to-emerald-500/10 text-jeju-400 py-2.5 rounded-xl font-medium hover:from-jeju-500 hover:to-emerald-500 hover:text-white transition-all"
        >
          Download
        </a>
      ) : (
        <span className="block w-full bg-gray-800 text-gray-500 py-2.5 rounded-xl font-medium">
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
