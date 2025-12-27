import { ArrowDown, ArrowUp, Clock, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { invoke } from '../../lib'
import {
  ConnectionStatsSchema,
  type ConnectionStats as ConnectionStatsType,
  type VPNConnection,
  VPNConnectionSchema,
} from '../../lib/schemas'
import { formatBytes, formatDuration } from '../../lib/utils'

interface ConnectionStatsProps {
  connection: VPNConnection
}

interface StatBoxProps {
  icon: React.ReactNode
  label: string
  value: string
}

function StatBox({ icon, label, value }: StatBoxProps) {
  return (
    <div className="bg-surface-hover rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted">{label}</span>
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  )
}

export function ConnectionStats({ connection }: ConnectionStatsProps) {
  const validatedConnection = VPNConnectionSchema.parse(connection)
  const [stats, setStats] = useState<ConnectionStatsType | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      const result = await invoke(
        'get_connection_stats',
        {},
        ConnectionStatsSchema.nullable(),
      )
      if (result) {
        setStats(result)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">Live Stats</h3>
        <span className="status-connected">Connected</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatBox
          icon={<ArrowDown className="w-4 h-4 text-accent" />}
          label="Download"
          value={formatBytes(
            stats?.bytes_down ?? validatedConnection.bytes_down,
          )}
        />
        <StatBox
          icon={<ArrowUp className="w-4 h-4 text-accent-secondary" />}
          label="Upload"
          value={formatBytes(stats?.bytes_up ?? validatedConnection.bytes_up)}
        />
        <StatBox
          icon={<Clock className="w-4 h-4 text-accent-tertiary" />}
          label="Duration"
          value={formatDuration(stats?.connected_seconds ?? 0)}
        />
        <StatBox
          icon={<Wifi className="w-4 h-4 text-accent-muted" />}
          label="Latency"
          value={`${stats?.latency_ms ?? validatedConnection.latency_ms}ms`}
        />
      </div>

      {validatedConnection.local_ip && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex justify-between text-sm">
            <span className="text-muted">VPN IP</span>
            <span className="font-mono text-accent">
              {validatedConnection.local_ip}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
