import type React from 'react'
import {
  DiscordIcon,
  FarcasterIcon,
  TelegramIcon,
  TwitterIcon,
  WebIcon,
  WhatsAppIcon,
} from '../components/Icons'

interface Props {
  onNavigate: (page: 'landing' | 'onboard' | 'configure' | 'chat') => void
}

export function Landing({ onNavigate }: Props) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-pattern" />
      <div className="grid-pattern" />

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-otto-darker/80 border-b border-surface-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <a
            href="/"
            className="flex items-center gap-3 text-otto-cyan font-bold text-2xl"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-otto-cyan to-otto-purple rounded-xl flex items-center justify-center text-lg shadow-lg shadow-otto-cyan/30">
              O
            </div>
            Otto
          </a>
          <nav className="hidden md:flex items-center gap-8">
            <a
              href="#features"
              className="text-white/70 hover:text-otto-cyan transition-colors font-medium"
            >
              Features
            </a>
            <a
              href="#platforms"
              className="text-white/70 hover:text-otto-cyan transition-colors font-medium"
            >
              Platforms
            </a>
            <button
              type="button"
              onClick={() => onNavigate('chat')}
              className="text-white/70 hover:text-otto-cyan transition-colors font-medium"
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => onNavigate('onboard')}
              className="btn-primary"
            >
              Get Started
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 relative z-10">
        <section className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 bg-surface-elevated border border-surface-border px-4 py-2 rounded-full text-sm text-white/80 mb-8 animate-fade-in-up">
            <span className="w-2 h-2 bg-otto-green rounded-full animate-pulse-slow" />
            Powered by ElizaOS + Jeju Network
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-extrabold mb-6 leading-tight animate-fade-in-up">
            Your <span className="gradient-text">AI Trading Agent</span>
            <br />
            for Every Platform
          </h1>

          <p className="text-xl md:text-2xl text-white/60 max-w-2xl mb-12 animate-fade-in-up">
            Trade, bridge, and launch tokens via Discord, Telegram, WhatsApp,
            Farcaster, and more. Otto is your AI-powered crypto companion.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 animate-fade-in-up">
            <button
              type="button"
              onClick={() => onNavigate('onboard')}
              className="btn-primary text-lg px-8 py-4"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Get Started
            </button>
            <a href="#platforms" className="btn-secondary text-lg px-8 py-4">
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              Add to Your Platform
            </a>
          </div>
        </section>

        {/* Platforms */}
        <section id="platforms" className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <p className="text-center text-sm uppercase tracking-widest text-white/50 mb-10">
              Available where you are
            </p>

            <div className="flex flex-wrap gap-4 justify-center max-w-4xl mx-auto">
              <PlatformButton
                icon={<TelegramIcon />}
                name="Telegram"
                href="https://t.me/otto_jeju_bot"
                className="telegram"
              />
              <PlatformButton
                icon={<DiscordIcon />}
                name="Discord"
                onClick={() => onNavigate('onboard')}
                className="discord"
              />
              <PlatformButton
                icon={<FarcasterIcon />}
                name="Farcaster"
                onClick={() => onNavigate('chat')}
                className="farcaster"
              />
              <PlatformButton
                icon={<WhatsAppIcon />}
                name="WhatsApp"
                onClick={() => onNavigate('chat')}
                className="whatsapp"
              />
              <PlatformButton
                icon={<TwitterIcon />}
                name="X / Twitter"
                href="https://twitter.com/otto_jeju"
                className="twitter"
              />
              <PlatformButton
                icon={<WebIcon />}
                name="Web Chat"
                onClick={() => onNavigate('chat')}
              />
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-bold text-center mb-16">
              Trade smarter, everywhere
            </h2>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard
                icon="⚡"
                title="Instant Swaps"
                description="Swap any token with best-rate routing across DEXs. Just say 'swap 1 ETH to USDC' and Otto handles the rest."
              />
              <FeatureCard
                icon="🌉"
                title="Cross-Chain Bridge"
                description="Bridge tokens across Ethereum, Base, Optimism, Arbitrum, and Solana with intent-based fills for speed."
              />
              <FeatureCard
                icon="🚀"
                title="Token Launch"
                description="Launch your own token with liquidity in seconds. Full-featured token creation made simple."
              />
              <FeatureCard
                icon="📊"
                title="Portfolio Tracking"
                description="View your holdings across all chains. Get real-time prices and 24h changes at a glance."
              />
              <FeatureCard
                icon="🔐"
                title="Secure & Non-Custodial"
                description="Your keys, your coins. Connect any wallet and trade with session keys for convenience."
              />
              <FeatureCard
                icon="🤖"
                title="AI-Powered"
                description="Natural language understanding powered by ElizaOS. Just chat like you would with a friend."
              />
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-6">Ready to start trading?</h2>
            <p className="text-xl text-white/60 mb-10">
              Connect your favorite platform and start trading in under a
              minute.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('onboard')}
              className="btn-primary text-lg px-10 py-5"
            >
              Get Started Free
            </button>
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
              className="hover:text-otto-cyan transition-colors"
            >
              Jeju Network
            </a>
            <a
              href="/api/info"
              className="hover:text-otto-cyan transition-colors"
            >
              API
            </a>
            <a
              href="https://github.com/jejunetwork/otto"
              target="_blank"
              rel="noopener"
              className="hover:text-otto-cyan transition-colors"
            >
              GitHub
            </a>
          </div>
          <p className="text-sm text-white/40">
            Otto Trading Agent — Powered by ElizaOS + Jeju Network
          </p>
        </div>
      </footer>
    </div>
  )
}

function PlatformButton({
  icon,
  name,
  href,
  onClick,
  className = '',
}: {
  icon: React.ReactNode
  name: string
  href?: string
  onClick?: () => void
  className?: string
}) {
  const content = (
    <>
      <span className="w-6 h-6">{icon}</span>
      {name}
    </>
  )

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener"
        className={`platform-btn ${className}`}
      >
        {content}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`platform-btn ${className}`}
    >
      {content}
    </button>
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
    <div className="card">
      <div className="w-14 h-14 bg-gradient-to-br from-otto-cyan to-otto-purple rounded-2xl flex items-center justify-center text-2xl mb-5">
        {icon}
      </div>
      <h3 className="text-xl font-semibold mb-3">{title}</h3>
      <p className="text-white/60 leading-relaxed">{description}</p>
    </div>
  )
}
