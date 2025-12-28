import { Search, Shield, Star, Store, Zap } from 'lucide-react'
import { useState } from 'react'
import { useAPIListings, useAPIProviders } from '../../hooks'

export default function MarketplacePage() {
  const { data: providersData, isLoading: providersLoading } = useAPIProviders()
  const { data: listingsData, isLoading: listingsLoading } = useAPIListings()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const providers = providersData?.providers ?? []
  const listings = listingsData?.listings ?? []

  const categories = [...new Set(providers.flatMap((p) => p.categories))]

  const filteredProviders = providers.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory =
      !selectedCategory || p.categories.includes(selectedCategory)
    return matchesSearch && matchesCategory
  })

  const isLoading = providersLoading || listingsLoading

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">API Marketplace</h1>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: '250px', position: 'relative' }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            className="input"
            placeholder="Search APIs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn ${!selectedCategory ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSelectedCategory(null)}
          >
            All
          </button>
          {categories.slice(0, 5).map((cat) => (
            <button
              key={cat}
              type="button"
              className={`btn ${selectedCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div
          style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}
        >
          <div className="spinner" />
        </div>
      ) : filteredProviders.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Store size={48} />
            <h3>
              {searchQuery || selectedCategory
                ? 'No APIs found'
                : 'No APIs available'}
            </h3>
            <p>
              {searchQuery || selectedCategory
                ? 'Try different search terms or filters'
                : 'Check back later for available APIs'}
            </p>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '1rem',
          }}
        >
          {filteredProviders.map((provider) => {
            const providerListings = listings.filter(
              (l) => l.providerId === provider.id,
            )
            const avgRating =
              providerListings.length > 0
                ? providerListings.reduce((sum, l) => sum + l.rating, 0) /
                  providerListings.length
                : 0
            const totalRequests = providerListings.reduce(
              (sum, l) => sum + parseInt(l.totalRequests, 10),
              0,
            )

            return (
              <div
                key={provider.id}
                className="card"
                style={{
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '1rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--gradient)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Zap size={24} style={{ color: 'white' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                        {provider.name}
                      </span>
                      {provider.configured && (
                        <Shield size={14} style={{ color: 'var(--success)' }} />
                      )}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        marginTop: '0.25rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      {provider.categories.slice(0, 2).map((cat) => (
                        <span
                          key={cat}
                          className="badge badge-neutral"
                          style={{ fontSize: '0.7rem' }}
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <p
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: '0.9rem',
                    marginBottom: '1rem',
                    lineHeight: 1.5,
                  }}
                >
                  {provider.description}
                </p>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '1rem',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                    }}
                  >
                    {avgRating > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.85rem',
                        }}
                      >
                        <Star
                          size={14}
                          style={{
                            color: 'var(--warning)',
                            fill: 'var(--warning)',
                          }}
                        />
                        <span>{avgRating.toFixed(1)}</span>
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {totalRequests.toLocaleString()} requests
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.85rem',
                    }}
                  >
                    {provider.defaultPricePerRequest} wei/req
                  </div>
                </div>

                {provider.supportsStreaming && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <span className="badge badge-accent">Streaming</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
