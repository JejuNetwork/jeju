import React from 'react'
import ReactDOM from 'react-dom/client'

// Simple landing page - no backend dependencies
function App() {
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            <span className="bg-gradient-to-r from-jeju-400 to-emerald-400 bg-clip-text text-transparent">
              Network Wallet
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-400 mb-12 max-w-2xl mx-auto">
            Seamless cross-chain wallet with no bridging, no chain switching.
            One balance across all chains.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://chrome.google.com/webstore"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-gradient-to-r from-jeju-600 to-jeju-500 rounded-xl text-white font-semibold hover:from-jeju-500 hover:to-jeju-400 transition-all shadow-lg shadow-jeju-500/20"
            >
              Install Extension
            </a>
            <a
              href="https://github.com/jejunetwork/wallet"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-surface-elevated border border-surface-border rounded-xl font-semibold hover:bg-surface-hover transition-all"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </main>

      {/* Features */}
      <section className="px-6 py-20 bg-surface-elevated/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Why Network Wallet?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon="🌐"
              title="Cross-Chain Native"
              description="Use any chain without switching networks. Your balance is unified across all supported chains."
            />
            <FeatureCard
              icon="⚡"
              title="No Bridging Required"
              description="Forget about bridges. We handle cross-chain liquidity seamlessly in the background."
            />
            <FeatureCard
              icon="🔐"
              title="Self-Custodial"
              description="Your keys, your crypto. Full control with hardware wallet support."
            />
          </div>
        </div>
      </section>

      {/* Supported Chains */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-8">Supported Chains</h2>
          <div className="flex flex-wrap justify-center gap-4">
            {[
              'Ethereum',
              'Base',
              'Arbitrum',
              'Optimism',
              'BNB Chain',
              'Polygon',
              'Avalanche',
              'Solana',
            ].map((chain) => (
              <span
                key={chain}
                className="px-4 py-2 bg-surface-elevated border border-surface-border rounded-lg text-sm"
              >
                {chain}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-surface-border">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-gray-500 text-sm">
            © 2025 Jeju Network. Open source.
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
  icon: string
  title: string
  description: string
}) {
  return (
    <div className="p-6 bg-surface-elevated border border-surface-border rounded-2xl">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
