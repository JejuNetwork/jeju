import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AgentCard } from '../components/AgentCard'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAgents } from '../hooks'
import { BOT_TYPE_CONFIG } from '../lib/constants'

type BotType = 'ai_agent' | 'trading_bot' | 'org_tool'

const BOT_TYPES = Object.entries(BOT_TYPE_CONFIG).map(([type, config]) => ({
  type: type as BotType,
  ...config,
}))

export default function AgentsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showActiveOnly, setShowActiveOnly] = useState(false)
  const [selectedType, setSelectedType] = useState<BotType | undefined>(
    undefined,
  )

  // Debounce search input
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchQuery(value)
    // Simple debounce
    const timer = setTimeout(() => setDebouncedSearch(value), 300)
    return () => clearTimeout(timer)
  }

  const { data, isLoading, error, fetchNextPage, isFetchingNextPage } =
    useAgents({
      name: debouncedSearch || undefined,
      active: showActiveOnly ? true : undefined,
    })

  // Client-side type filtering since API might not support it
  const filteredAgents = useMemo(() => {
    if (!data?.agents) return []
    if (!selectedType) return data.agents
    return data.agents.filter((agent) => agent.botType === selectedType)
  }, [data?.agents, selectedType])

  const filteredTotal = selectedType
    ? filteredAgents.length
    : (data?.total ?? 0)

  return (
    <div className="max-w-6xl mx-auto">
      {/* Page Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1
            className="text-3xl md:text-4xl font-bold mb-2 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Agents
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Deployed AI agents on the network
          </p>
        </div>
        <Link to="/agents/new" className="btn-primary">
          Deploy Agent
        </Link>
      </header>

      {/* Search and Filters */}
      <div
        className="p-4 rounded-xl mb-8 space-y-4"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        {/* Search Input */}
        <div className="relative max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5"
            style={{ color: 'var(--text-tertiary)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="search"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search agents by name..."
            className="input pl-10 w-full"
            aria-label="Search agents"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Status Filters */}
          <fieldset
            className="flex items-center gap-2"
            aria-label="Status filter"
          >
            <button
              type="button"
              onClick={() => setShowActiveOnly(false)}
              className={`btn-sm ${!showActiveOnly ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={!showActiveOnly}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setShowActiveOnly(true)}
              className={`btn-sm ${showActiveOnly ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={showActiveOnly}
            >
              <span className="status-dot-active mr-2" aria-hidden="true" />
              Active
            </button>
          </fieldset>

          <span
            className="w-px h-6 hidden sm:block"
            style={{ backgroundColor: 'var(--border)' }}
            aria-hidden="true"
          />

          {/* Type Filters */}
          <fieldset
            className="flex items-center gap-2 flex-wrap"
            aria-label="Type filter"
          >
            <button
              type="button"
              onClick={() => setSelectedType(undefined)}
              className={`btn-sm ${!selectedType ? 'btn-secondary' : 'btn-ghost'}`}
              aria-pressed={!selectedType}
            >
              All Types
            </button>
            {BOT_TYPES.map((bt) => (
              <button
                key={bt.type}
                type="button"
                onClick={() => setSelectedType(bt.type)}
                className={`btn-sm ${selectedType === bt.type ? 'btn-secondary' : 'btn-ghost'}`}
                aria-pressed={selectedType === bt.type}
              >
                <span aria-hidden="true">{bt.icon}</span>
                <span className="hidden sm:inline ml-1">{bt.label}</span>
              </button>
            ))}
          </fieldset>

          {/* Result Count */}
          <span
            className="text-sm ml-auto"
            style={{ color: 'var(--text-tertiary)' }}
            aria-live="polite"
          >
            {filteredTotal} result{filteredTotal !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <output className="flex flex-col items-center justify-center py-20">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Loading agents
          </p>
        </output>
      )}

      {/* Error State */}
      {error && (
        <div
          className="card-static p-8 text-center"
          role="alert"
          aria-live="assertive"
        >
          <div className="text-5xl mb-4" role="img" aria-label="Error">
            ⚠️
          </div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--color-error)' }}
          >
            Failed to load agents
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-secondary mt-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {data && filteredAgents.length === 0 && (
        <div className="card-static p-12 text-center">
          <div
            className="text-6xl mb-6 animate-float"
            role="img"
            aria-label="Robot"
          >
            🤖
          </div>
          <h2
            className="text-2xl font-bold mb-3 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            {searchQuery
              ? 'No agents match your search'
              : showActiveOnly
                ? 'No active agents'
                : selectedType
                  ? `No ${BOT_TYPE_CONFIG[selectedType].label} agents`
                  : 'No agents registered'}
          </h2>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            {searchQuery
              ? 'Try adjusting your search or filters'
              : 'Deploy your first agent to get started'}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/agents/new" className="btn-primary">
              Deploy Agent
            </Link>
            {(showActiveOnly || selectedType || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setShowActiveOnly(false)
                  setSelectedType(undefined)
                  setSearchQuery('')
                  setDebouncedSearch('')
                }}
                className="btn-secondary"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Agent Grid */}
      {data && filteredAgents.length > 0 && (
        <ul
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children list-none"
          aria-label="Agent list"
        >
          {filteredAgents.map((agent) => (
            <li key={agent.agentId}>
              <AgentCard agent={agent} />
            </li>
          ))}
        </ul>
      )}

      {data?.hasMore && !selectedType && (
        <div className="text-center mt-10">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="btn-secondary"
          >
            {isFetchingNextPage ? <LoadingSpinner size="sm" /> : 'Load More'}
          </button>
        </div>
      )}
    </div>
  )
}
