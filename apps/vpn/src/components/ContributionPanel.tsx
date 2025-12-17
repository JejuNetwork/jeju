import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, HardDrive, Users, Coins, ArrowUpDown, Clock, ToggleLeft, ToggleRight } from 'lucide-react';

interface ContributionStatus {
  vpn_bytes_used: number;
  bytes_contributed: number;
  contribution_cap: number;
  quota_remaining: number;
  is_contributing: boolean;
  is_paused: boolean;
  cdn_bytes_served: number;
  relay_bytes_served: number;
  period_start: number;
  period_end: number;
}

interface ContributionStats {
  total_bytes_contributed: number;
  total_vpn_bytes_used: number;
  contribution_ratio: number;
  tokens_earned: number;
  tokens_pending: number;
  users_helped: number;
  cdn_requests_served: number;
  uptime_seconds: number;
}

interface ContributionSettings {
  enabled: boolean;
  max_bandwidth_percent: number;
  share_cdn: boolean;
  share_vpn_relay: boolean;
  earning_mode: boolean;
  earning_bandwidth_percent: number;
  schedule_enabled: boolean;
  schedule_start: string;
  schedule_end: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ContributionPanel() {
  const [status, setStatus] = useState<ContributionStatus | null>(null);
  const [stats, setStats] = useState<ContributionStats | null>(null);
  const [settings, setSettings] = useState<ContributionSettings | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusData, statsData] = await Promise.all([
          invoke<ContributionStatus>('get_contribution_status'),
          invoke<ContributionStats>('get_contribution_stats'),
        ]);
        setStatus(statusData);
        setStats(statsData);
      } catch (error) {
        console.error('Failed to fetch contribution data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleContribution = async () => {
    if (!settings) return;
    
    const newSettings = { ...settings, enabled: !settings.enabled };
    await invoke('set_contribution_settings', { settings: newSettings });
    setSettings(newSettings);
  };

  const toggleEarningMode = async () => {
    if (!settings) return;
    
    const newSettings = { ...settings, earning_mode: !settings.earning_mode };
    await invoke('set_contribution_settings', { settings: newSettings });
    setSettings(newSettings);
  };

  const quotaPercent = status 
    ? Math.min(100, (status.bytes_contributed / Math.max(1, status.contribution_cap)) * 100)
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Fair Contribution</h2>
        <p className="text-sm text-[#606070] mt-1">
          Help power the network and earn tokens
        </p>
      </div>

      {/* Quota Progress */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[#606070]">Contribution Quota</span>
          <span className="text-sm font-medium">{quotaPercent.toFixed(1)}% of 3x limit</span>
        </div>
        <div className="h-3 bg-[#1a1a25] rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-[#00ff88] to-[#00cc6a] rounded-full transition-all duration-500"
            style={{ width: `${quotaPercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-[#606070]">
          <span>Contributed: {formatBytes(status?.bytes_contributed ?? 0)}</span>
          <span>Cap: {formatBytes(status?.contribution_cap ?? 0)}</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <HardDrive className="w-5 h-5 text-[#00ff88] mb-2" />
          <div className="text-lg font-semibold">{formatBytes(status?.cdn_bytes_served ?? 0)}</div>
          <div className="text-xs text-[#606070]">CDN Served</div>
        </div>
        <div className="card">
          <ArrowUpDown className="w-5 h-5 text-[#00cc6a] mb-2" />
          <div className="text-lg font-semibold">{formatBytes(status?.relay_bytes_served ?? 0)}</div>
          <div className="text-xs text-[#606070]">VPN Relayed</div>
        </div>
        <div className="card">
          <Users className="w-5 h-5 text-[#00aa55] mb-2" />
          <div className="text-lg font-semibold">{stats?.users_helped ?? 0}</div>
          <div className="text-xs text-[#606070]">Users Helped</div>
        </div>
        <div className="card">
          <Coins className="w-5 h-5 text-[#008844] mb-2" />
          <div className="text-lg font-semibold">{stats?.tokens_earned?.toFixed(2) ?? '0.00'}</div>
          <div className="text-xs text-[#606070]">JEJU Earned</div>
        </div>
      </div>

      {/* Contribution Settings */}
      <div className="card">
        <h3 className="font-medium mb-4">Settings</h3>
        
        {/* Enable Contribution */}
        <button 
          onClick={toggleContribution}
          className="w-full flex items-center justify-between py-3 border-b border-[#2a2a35]"
        >
          <div>
            <div className="font-medium">Auto Contribution</div>
            <div className="text-xs text-[#606070]">Share 10% bandwidth when idle</div>
          </div>
          {settings?.enabled ? (
            <ToggleRight className="w-8 h-8 text-[#00ff88]" />
          ) : (
            <ToggleLeft className="w-8 h-8 text-[#606070]" />
          )}
        </button>

        {/* Earning Mode */}
        <button 
          onClick={toggleEarningMode}
          className="w-full flex items-center justify-between py-3"
        >
          <div>
            <div className="font-medium">Earning Mode</div>
            <div className="text-xs text-[#606070]">Share 50% bandwidth, earn more tokens</div>
          </div>
          {settings?.earning_mode ? (
            <ToggleRight className="w-8 h-8 text-[#00ff88]" />
          ) : (
            <ToggleLeft className="w-8 h-8 text-[#606070]" />
          )}
        </button>
      </div>

      {/* Info */}
      <div className="bg-[#00ff88]/5 border border-[#00ff88]/20 rounded-2xl p-4">
        <div className="flex gap-3">
          <Activity className="w-5 h-5 text-[#00ff88] flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-[#00ff88] font-medium mb-1">How Fair Sharing Works</p>
            <p className="text-[#a0a0b0]">
              You get free, unlimited VPN. In exchange, you contribute up to 3x what you use 
              (capped at 10% of your bandwidth). This powers the network for everyone.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

