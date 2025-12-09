import { useState } from 'react'
import { Server, Search, RefreshCw, ExternalLink, Clock, Activity } from 'lucide-react'
import { useTargets } from '../hooks/useMonitoring'
import { StatusBadge } from '../components/StatusBadge'
import { HealthRing } from '../components/HealthRing'

type HealthFilter = 'all' | 'up' | 'down'

export function Targets() {
  const { targets, upCount, downCount, loading, error, refetch } = useTargets()
  const [searchQuery, setSearchQuery] = useState('')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')

  const filteredTargets = targets.filter(target => {
    const matchesSearch = searchQuery === '' ||
      target.labels.job?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      target.labels.instance?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      target.scrapeUrl?.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesHealth = healthFilter === 'all' || target.health === healthFilter
    
    return matchesSearch && matchesHealth
  })

  const healthPercentage = targets.length > 0 
    ? Math.round((upCount / targets.length) * 100) 
    : 100

  const targetsByJob = filteredTargets.reduce((acc, target) => {
    const job = target.labels.job || 'unknown'
    if (!acc[job]) acc[job] = []
    acc[job].push(target)
    return acc
  }, {} as Record<string, typeof targets>)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold text-gradient">Targets</h1>
        <button
          onClick={() => refetch()}
          disabled={loading}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Health Overview */}
      <div className="card-static p-6">
        <div className="flex flex-col md:flex-row items-center gap-8">
          <HealthRing 
            percentage={healthPercentage}
            size={120}
            strokeWidth={10}
          />
          
          <div className="flex-1 w-full grid grid-cols-3 gap-4">
            <button
              onClick={() => setHealthFilter('all')}
              className={`p-4 rounded-xl text-center ${healthFilter === 'all' ? 'ring-2 ring-jeju-primary' : ''}`}
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{targets.length}</div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Total</div>
            </button>
            
            <button
              onClick={() => setHealthFilter('up')}
              className={`p-4 rounded-xl text-center ${healthFilter === 'up' ? 'ring-2 ring-jeju-success' : ''}`}
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="text-2xl font-bold" style={{ color: 'var(--color-success)' }}>{upCount}</div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Up</div>
            </button>
            
            <button
              onClick={() => setHealthFilter('down')}
              className={`p-4 rounded-xl text-center ${healthFilter === 'down' ? 'ring-2 ring-jeju-error' : ''}`}
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="text-2xl font-bold" style={{ color: downCount > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{downCount}</div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Down</div>
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-tertiary)' }} />
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input pl-12"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="card-static p-4 text-center" style={{ borderColor: 'var(--color-error)' }}>
          <p style={{ color: 'var(--color-error)' }}>{error}</p>
        </div>
      )}

      {/* Targets */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card-static p-4">
              <div className="shimmer h-20 w-full rounded" />
            </div>
          ))}
        </div>
      ) : filteredTargets.length === 0 ? (
        <div className="card-static p-8 text-center">
          <p style={{ color: 'var(--text-tertiary)' }}>No targets found</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(targetsByJob).map(([job, jobTargets]) => (
            <div key={job} className="card-static overflow-hidden">
              <div 
                className="px-4 py-3 flex items-center justify-between"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
                  <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{job}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge-success">{jobTargets.filter(t => t.health === 'up').length} up</span>
                  {jobTargets.some(t => t.health === 'down') && (
                    <span className="badge-error">{jobTargets.filter(t => t.health === 'down').length} down</span>
                  )}
                </div>
              </div>
              
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {jobTargets.map((target, i) => (
                  <TargetRow key={i} target={target} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface Target {
  health: string
  labels: Record<string, string>
  lastScrape: string
  lastScrapeDuration: number
  scrapeUrl: string
}

function TargetRow({ target }: { target: Target }) {
  const isUp = target.health === 'up'
  
  return (
    <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <StatusBadge 
        status={isUp ? 'online' : 'offline'}
        label={target.health}
        pulse={isUp}
      />
      
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {target.labels.instance || target.scrapeUrl}
        </p>
        <a 
          href={target.scrapeUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs font-mono truncate block hover:underline flex items-center gap-1"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {target.scrapeUrl}
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
      </div>
      
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
          <Clock className="w-3 h-3" />
          {target.lastScrape ? new Date(target.lastScrape).toLocaleTimeString() : '-'}
        </div>
        
        <div className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
          <Activity className="w-3 h-3" />
          {target.lastScrapeDuration ? `${(target.lastScrapeDuration * 1000).toFixed(0)}ms` : '-'}
        </div>
      </div>
    </div>
  )
}
