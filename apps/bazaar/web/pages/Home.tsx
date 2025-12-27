/**
 * Home Page
 *
 * Vibrant, welcoming landing page for Bazaar marketplace
 */

import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'

const features = [
  {
    href: '/swap',
    icon: '🔄',
    title: 'Swap',
    description: 'Trade tokens instantly with the best rates',
    gradient: 'from-orange-500 to-amber-500',
  },
  {
    href: '/pools',
    icon: '💧',
    title: 'Pools',
    description: 'Provide liquidity and earn trading fees',
    gradient: 'from-cyan-500 to-blue-500',
  },
  {
    href: '/perps',
    icon: '📈',
    title: 'Perps',
    description: 'Trade perpetuals with up to 50x leverage',
    gradient: 'from-green-500 to-emerald-500',
  },
  {
    href: '/coins',
    icon: '🪙',
    title: 'Coins',
    description: 'Discover and launch new tokens',
    gradient: 'from-yellow-500 to-orange-500',
  },
  {
    href: '/markets',
    icon: '🔮',
    title: 'Predictions',
    description: 'Bet on real-world outcomes',
    gradient: 'from-purple-500 to-pink-500',
  },
  {
    href: '/items',
    icon: '🖼️',
    title: 'Items',
    description: 'Collect and trade digital collectibles',
    gradient: 'from-pink-500 to-rose-500',
  },
]

const quickStats = [
  { label: 'Total Volume', value: '$12.5M+', icon: '📊' },
  { label: 'Active Traders', value: '2,400+', icon: '👥' },
  { label: 'Tokens Listed', value: '150+', icon: '🪙' },
]

export default function HomePage() {
  const { isConnected } = useAccount()

  return (
    <div className="min-h-[80vh] flex flex-col">
      {/* Hero Section */}
      <section className="text-center py-8 md:py-16 animate-fade-in">
        {/* Island emoji with float animation */}
        <div className="text-6xl md:text-8xl mb-6 animate-float" aria-hidden="true">
          🏝️
        </div>

        {/* Main headline */}
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold mb-4">
          <span className="text-gradient">Bazaar</span>
        </h1>

        {/* Tagline */}
        <p className="text-lg sm:text-xl md:text-2xl text-secondary max-w-2xl mx-auto mb-8 px-4">
          Your friendly marketplace for tokens, collectibles, and predictions.
          <span className="hidden sm:inline"> Trade, swap, and have fun on the network.</span>
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center px-4">
          {isConnected ? (
            <>
              <Link to="/swap" className="btn-primary text-lg flex items-center justify-center gap-2 group">
                Start Trading
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link to="/portfolio" className="btn-secondary text-lg">
                View Portfolio
              </Link>
            </>
          ) : (
            <>
              <Link to="/coins" className="btn-primary text-lg flex items-center justify-center gap-2 group">
                Explore Coins
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link to="/markets" className="btn-secondary text-lg">
                Browse Markets
              </Link>
            </>
          )}
        </div>
      </section>

      {/* Quick Stats */}
      <section className="py-8" aria-label="Platform statistics">
        <div className="flex flex-wrap justify-center gap-6 md:gap-12">
          {quickStats.map((stat, index) => (
            <div
              key={stat.label}
              className={`text-center animate-fade-in-up stagger-${index + 1}`}
            >
              <div className="text-3xl mb-1" aria-hidden="true">{stat.icon}</div>
              <div className="text-2xl md:text-3xl font-bold text-primary">{stat.value}</div>
              <div className="text-sm text-tertiary">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section className="flex-1 py-8 md:py-12">
        <h2 className="sr-only">Features</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 max-w-5xl mx-auto px-4">
          {features.map((feature, index) => (
            <Link
              key={feature.href}
              to={feature.href}
              className={`group relative animate-fade-in-up stagger-${index + 1}`}
            >
              <article className="card p-5 md:p-6 h-full hover:scale-[1.03] transition-all duration-300">
                {/* Gradient background on hover */}
                <div
                  className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}
                  aria-hidden="true"
                />

                {/* Icon */}
                <div className="text-4xl md:text-5xl mb-3 group-hover:scale-110 group-hover:animate-wiggle transition-transform">
                  {feature.icon}
                </div>

                {/* Title */}
                <h3 className="text-lg md:text-xl font-bold text-primary mb-1">
                  {feature.title}
                </h3>

                {/* Description - hidden on smallest screens */}
                <p className="text-sm text-secondary line-clamp-2 hidden sm:block">
                  {feature.description}
                </p>

                {/* Arrow indicator */}
                <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ArrowRight className="w-5 h-5 text-primary-color" />
                </div>
              </article>
            </Link>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-12 text-center">
        <div className="card-static max-w-2xl mx-auto p-8 md:p-10 bg-gradient-to-br from-orange-500/5 to-purple-500/5 border-dashed">
          <h2 className="text-2xl md:text-3xl font-bold mb-3 text-primary">
            Ready to dive in?
          </h2>
          <p className="text-secondary mb-6 max-w-md mx-auto">
            Connect your wallet to start trading, earning rewards, and joining the community.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/coins/launch" className="btn-primary">
              Launch a Token
            </Link>
            <Link to="/rewards" className="btn-secondary">
              Earn Rewards
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
