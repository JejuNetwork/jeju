import { ArrowDown, ArrowUp, Clock, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface VPNConnection {
  connection_id: string;
  status: string;
  node: {
    node_id: string;
    country_code: string;
    region: string;
    latency_ms: number;
  };
  connected_at: number | null;
  local_ip: string | null;
  public_ip: string | null;
  bytes_up: number;
  bytes_down: number;
  latency_ms: number;
}

interface ConnectionStatsProps {
  connection: VPNConnection;
}

interface Stats {
  bytes_up: number;
  bytes_down: number;
  packets_up: number;
  packets_down: number;
  connected_seconds: number;
  latency_ms: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function ConnectionStats({ connection }: ConnectionStatsProps) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const result = await invoke<Stats | null>('get_connection_stats');
        if (result) {
          setStats(result);
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 1000);
    return () => clearInterval(interval);
  }, []);

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
            {formatBytes(stats?.bytes_down ?? connection.bytes_down)}
          </div>
        </div>

        {/* Upload */}
        <div className="bg-[#1a1a25] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUp className="w-4 h-4 text-[#00cc6a]" />
            <span className="text-xs text-[#606070]">Upload</span>
          </div>
          <div className="text-lg font-semibold">
            {formatBytes(stats?.bytes_up ?? connection.bytes_up)}
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
            {stats?.latency_ms ?? connection.latency_ms}ms
          </div>
        </div>
      </div>

      {/* IP Info */}
      {connection.local_ip && (
        <div className="mt-4 pt-4 border-t border-[#2a2a35]">
          <div className="flex justify-between text-sm">
            <span className="text-[#606070]">VPN IP</span>
            <span className="font-mono">{connection.local_ip}</span>
          </div>
        </div>
      )}
    </div>
  );
}

