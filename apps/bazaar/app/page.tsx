import Link from 'next/link'

const features = [
  { href: '/swap', icon: '🔄', title: 'Swap' },
  { href: '/pools', icon: '💧', title: 'Pools' },
  { href: '/perps', icon: '📈', title: 'Perps' },
  { href: '/charts', icon: '📊', title: 'Charts' },
  { href: '/intel', icon: '🔮', title: 'Intel' },
  { href: '/coins', icon: '🪙', title: 'Coins' },
  { href: '/markets', icon: '🎯', title: 'Predict' },
  { href: '/items', icon: '🖼️', title: 'NFTs' },
]

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <div className="text-center mb-12">
        <h1 className="text-5xl md:text-7xl font-bold mb-4">
          <span className="text-gradient">Bazaar</span>
        </h1>
        <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>
          DeFi on the network
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 w-full max-w-3xl">
        {features.map((feature) => (
          <Link key={feature.href} href={feature.href} className="group">
            <div className="card p-6 text-center hover:border-bazaar-primary">
              <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">
                {feature.icon}
              </div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {feature.title}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
