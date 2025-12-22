import { ArrowDown, ArrowUp, Clock, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { invoke } from '../api'
import {
  ConnectionStatsSchema,
  type ConnectionStats as ConnectionStatsType,
  type VPNConnection,
  VPNConnectionSchema,
} from '../api/schemas'
import { formatBytes, formatDuration } from '../shared/utils'

interface ConnectionStatsProps {
  connection: VPNConnection
}

export function ConnectionStats({ connection }: ConnectionStatsProps) {
  // Validate connection prop
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
        <h3 className="font-medium">Connection</h3>
        <span className="text-xs text-[#00ff88] bg-[#00ff88]/10 px-2 py-1 rounded-full">
          Active
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Download */}
        <div className="bg-[#1a1a25] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDown className="w-4 h-4 text-[#00ff88]" />
            <span className="text-xs text-[#606070]">Download</span>
          </div>
          <div className="text-lg font-semibold">
            {formatBytes(stats?.bytes_down ?? validatedConnection.bytes_down)}
          </div>
        </div>

        {/* Upload */}
        <div className="bg-[#1a1a25] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUp className="w-4 h-4 text-[#00cc6a]" />
            <span className="text-xs text-[#606070]">Upload</span>
          </div>
          <div className="text-lg font-semibold">
            {formatBytes(stats?.bytes_up ?? validatedConnection.bytes_up)}
          </div>
        </div>

        {/* Duration */}
        <div className="bg-[#1a1a25] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-[#00aa55]" />
            <span className="text-xs text-[#606070]">Duration</span>
          </div>
          <div className="text-lg font-semibold">
            {formatDuration(stats?.connected_seconds ?? 0)}
          </div>
        </div>

        {/* Latency */}
        <div className="bg-[#1a1a25] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <Wifi className="w-4 h-4 text-[#008844]" />
            <span className="text-xs text-[#606070]">Latency</span>
          </div>
          <div className="text-lg font-semibold">
            {stats?.latency_ms ?? validatedConnection.latency_ms}ms
          </div>
        </div>
      </div>

      {/* IP Info */}
      {validatedConnection.local_ip && (
        <div className="mt-4 pt-4 border-t border-[#2a2a35]">
          <div className="flex justify-between text-sm">
            <span className="text-[#606070]">VPN IP</span>
            <span className="font-mono">{validatedConnection.local_ip}</span>
          </div>
        </div>
      )}
    </div>
  )
}
