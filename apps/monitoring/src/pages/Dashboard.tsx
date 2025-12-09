import { AlertTriangle, Target, Zap, Server, Clock, TrendingUp } from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { HealthRing } from '../components/HealthRing'
import { useSystemHealth, useTargets, useAlerts, useOIFStats } from '../hooks/useMonitoring'
import { Link } from 'react-router-dom'

export function Dashboard() {
  const systemHealth = useSystemHealth()
  const { targets, upCount } = useTargets()
  const { alerts } = useAlerts()
  const { stats: oifStats, loading: oifLoading } = useOIFStats()

  const healthPercentage = targets.length > 0 
    ? Math.round((upCount / targets.length) * 100) 
    : 100

  const firingAlerts = alerts.filter(a => a.state === 'firing')

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Health Overview */}
      <div className="card-static p-6 md:p-8">
        <div className="flex flex-col lg:flex-row items-center gap-8">
          <div className="flex-shrink-0">
            <HealthRing 
              percentage={healthPercentage}
              size={160}
              strokeWidth={12}
              status={systemHealth.status === 'healthy' ? 'success' : systemHealth.status === 'degraded' ? 'warning' : 'error'}
            />
          </div>

          <div className="flex-1 w-full">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {systemHealth.status}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Status</div>
              </div>
              
              <div className="text-center p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {upCount}/{targets.length}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Targets</div>
              </div>
              
              <div className="text-center p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-2xl font-bold" style={{ color: firingAlerts.length > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>
                  {firingAlerts.length}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Alerts</div>
              </div>
              
              <div className="text-center p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {oifStats?.activeSolvers ?? '-'}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Solvers</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatCard
          label="Targets"
          value={`${upCount}/${targets.length}`}
          icon={<Target className="w-6 h-6" />}
          status={upCount === targets.length ? 'success' : upCount > 0 ? 'warning' : 'error'}
          loading={systemHealth.loading}
        />
        
        <StatCard
          label="Alerts"
          value={firingAlerts.length}
          icon={<AlertTriangle className="w-6 h-6" />}
          status={firingAlerts.length === 0 ? 'success' : firingAlerts.some(a => a.labels.severity === 'critical') ? 'error' : 'warning'}
          loading={systemHealth.loading}
        />
        
        <StatCard
          label="Intents"
          value={oifStats?.totalIntents ?? '-'}
          icon={<Zap className="w-6 h-6" />}
          status="info"
          loading={oifLoading}
        />
        
        <StatCard
          label="Volume"
          value={oifStats?.totalVolumeUsd ? `$${formatNumber(parseInt(oifStats.totalVolumeUsd) / 1e18)}` : '-'}
          icon={<TrendingUp className="w-6 h-6" />}
          status="success"
          loading={oifLoading}
        />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <QuickLinkCard 
          to="/alerts"
          icon={<AlertTriangle className="w-6 h-6" />}
          title="Alerts"
          count={firingAlerts.length}
          gradient="from-red-500 to-orange-500"
        />
        
        <QuickLinkCard 
          to="/targets"
          icon={<Server className="w-6 h-6" />}
          title="Targets"
          count={upCount}
          countSuffix={`/${targets.length}`}
          gradient="from-blue-500 to-cyan-500"
        />
        
        <QuickLinkCard 
          to="/oif"
          icon={<Zap className="w-6 h-6" />}
          title="OIF"
          count={oifStats?.activeSolvers ?? 0}
          gradient="from-purple-500 to-pink-500"
        />
      </div>

      {/* Recent Alerts */}
      <div className="card-static p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Clock className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
            Recent Alerts
          </h2>
          <Link 
            to="/alerts"
            className="text-sm font-medium hover:underline"
            style={{ color: 'var(--color-primary)' }}
          >
            View all
          </Link>
        </div>
        
        {firingAlerts.length === 0 ? (
          <div 
            className="text-center py-6 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No active alerts</p>
          </div>
        ) : (
          <div className="space-y-3">
            {firingAlerts.slice(0, 5).map((alert, i) => (
              <div 
                key={i}
                className="flex items-center gap-4 p-3 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className={`status-dot-lg ${alert.labels.severity === 'critical' ? 'status-offline' : 'status-warning'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {alert.labels.alertname}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {alert.labels.job}
                  </p>
                </div>
                <span className={`badge ${alert.labels.severity === 'critical' ? 'badge-error' : 'badge-warning'}`}>
                  {alert.labels.severity || 'warning'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface QuickLinkCardProps {
  to: string
  icon: React.ReactNode
  title: string
  count: number
  countSuffix?: string
  gradient: string
}

function QuickLinkCard({ to, icon, title, count, countSuffix, gradient }: QuickLinkCardProps) {
  return (
    <Link to={to} className="group">
      <div className="card p-4 md:p-6 h-full flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white group-hover:scale-110 transition-transform`}>
          {icon}
        </div>
        
        <div className="flex-1">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{title}</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {count}{countSuffix}
          </p>
        </div>
      </div>
    </Link>
  )
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(2)}K`
  return num.toFixed(2)
}
