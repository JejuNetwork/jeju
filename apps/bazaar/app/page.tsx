import Link from 'next/link'

const features = [
  { href: '/coins', icon: '🪙', title: 'Coins' },
  { href: '/swap', icon: '🔄', title: 'Swap' },
  { href: '/pools', icon: '💧', title: 'Pools' },
  { href: '/markets', icon: '📊', title: 'Markets' },
  { href: '/items', icon: '🖼️', title: 'Items' },
  { href: '/names', icon: '🏷️', title: 'Names' },
  { href: '/games', icon: '🎮', title: 'Games' },
]

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <div className="text-center mb-12">
        <h1 className="text-5xl md:text-7xl font-bold mb-4">
          <span className="text-gradient">Bazaar</span>
        </h1>
        <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>
          DeFi on Jeju
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
