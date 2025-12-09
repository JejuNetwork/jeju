import { useState } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import { useAlerts } from '../hooks/useMonitoring'
import { StatusBadge } from '../components/StatusBadge'

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info'

export function Alerts() {
  const { alerts, loading, error, refetch } = useAlerts()
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')

  const firingAlerts = alerts.filter(a => a.state === 'firing')
  
  const filteredAlerts = firingAlerts.filter(alert => {
    const matchesSearch = searchQuery === '' || 
      alert.labels.alertname?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alert.annotations.description?.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesSeverity = severityFilter === 'all' || 
      alert.labels.severity === severityFilter
    
    return matchesSearch && matchesSeverity
  })

  const criticalCount = firingAlerts.filter(a => a.labels.severity === 'critical').length
  const warningCount = firingAlerts.filter(a => a.labels.severity === 'warning').length
  const infoCount = firingAlerts.filter(a => !a.labels.severity || a.labels.severity === 'info').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold text-gradient">Alerts</h1>
        <button
          onClick={() => refetch()}
          disabled={loading}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <button
          onClick={() => setSeverityFilter('all')}
          className={`card-static p-4 text-center ${severityFilter === 'all' ? 'ring-2 ring-jeju-primary' : ''}`}
        >
          <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{firingAlerts.length}</div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Total</div>
        </button>
        
        <button
          onClick={() => setSeverityFilter('critical')}
          className={`card-static p-4 text-center ${severityFilter === 'critical' ? 'ring-2 ring-jeju-error' : ''}`}
        >
          <div className="text-2xl font-bold" style={{ color: criticalCount > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{criticalCount}</div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Critical</div>
        </button>
        
        <button
          onClick={() => setSeverityFilter('warning')}
          className={`card-static p-4 text-center ${severityFilter === 'warning' ? 'ring-2 ring-jeju-warning' : ''}`}
        >
          <div className="text-2xl font-bold" style={{ color: warningCount > 0 ? 'var(--color-warning)' : 'var(--text-primary)' }}>{warningCount}</div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Warning</div>
        </button>
        
        <button
          onClick={() => setSeverityFilter('info')}
          className={`card-static p-4 text-center ${severityFilter === 'info' ? 'ring-2 ring-jeju-info' : ''}`}
        >
          <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{infoCount}</div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Info</div>
        </button>
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

      {/* List */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card-static p-4">
              <div className="shimmer h-16 w-full rounded" />
            </div>
          ))}
        </div>
      ) : filteredAlerts.length === 0 ? (
        <div className="card-static p-8 text-center">
          <p style={{ color: 'var(--text-tertiary)' }}>
            {firingAlerts.length === 0 ? 'No active alerts' : 'No matching alerts'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAlerts.map((alert, i) => (
            <AlertCard key={i} alert={alert} />
          ))}
        </div>
      )}
    </div>
  )
}

interface Alert {
  state: string
  labels: Record<string, string>
  annotations: Record<string, string>
  activeAt?: string
}

function AlertCard({ alert }: { alert: Alert }) {
  const severity = alert.labels.severity || 'info'

  return (
    <div className="card-static p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>
              {alert.labels.alertname}
            </h3>
            <StatusBadge 
              status={severity === 'critical' ? 'offline' : severity === 'warning' ? 'warning' : 'online'}
              label={severity}
              size="sm"
              pulse={false}
            />
          </div>
          
          {alert.annotations.description && (
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              {alert.annotations.description}
            </p>
          )}
          
          <div className="flex flex-wrap gap-2">
            {Object.entries(alert.labels)
              .filter(([key]) => !['alertname', 'severity', '__name__'].includes(key))
              .slice(0, 5)
              .map(([key, value]) => (
                <span 
                  key={key}
                  className="px-2 py-1 rounded-lg text-xs font-mono"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                >
                  {key}={value}
                </span>
              ))}
          </div>
        </div>
        
        {alert.activeAt && (
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
              {new Date(alert.activeAt).toLocaleTimeString()}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
