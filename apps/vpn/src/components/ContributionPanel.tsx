import { useEffect, useState } from 'react';
import { invoke } from '../api';
import { Activity, HardDrive, Users, Coins, ArrowUpDown, Gauge, Database, Zap, ToggleLeft, ToggleRight } from 'lucide-react';

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

interface BandwidthState {
  total_bandwidth_mbps: number;
  user_usage_mbps: number;
  available_mbps: number;
  contribution_mbps: number;
  contribution_percent: number;
  is_user_idle: boolean;
  idle_seconds: number;
  adaptive_enabled: boolean;
}

interface DWSState {
  active: boolean;
  cache_used_mb: number;
  bytes_served: number;
  requests_served: number;
  cached_cids: number;
  earnings_wei: number;
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
  const [bandwidth, setBandwidth] = useState<BandwidthState | null>(null);
  const [dws, setDws] = useState<DWSState | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusData, statsData, bwData, dwsData] = await Promise.all([
          invoke<ContributionStatus>('get_contribution_status'),
          invoke<ContributionStats>('get_contribution_stats'),
          invoke<BandwidthState>('get_bandwidth_state'),
          invoke<DWSState>('get_dws_state'),
        ]);
        setStatus(statusData);
        setStats(statsData);
        setBandwidth(bwData);
        setDws(dwsData);
      } catch (error) {
        console.error('Failed to fetch contribution data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
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

      {/* Adaptive Bandwidth Status */}
      <div className="card bg-gradient-to-br from-[#00ff88]/5 to-transparent border-[#00ff88]/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-[#00ff88]" />
            <span className="font-medium">Adaptive Bandwidth</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs ${
            bandwidth?.is_user_idle ? 'bg-[#00ff88]/20 text-[#00ff88]' : 'bg-yellow-500/20 text-yellow-500'
          }`}>
            {bandwidth?.is_user_idle ? 'Idle - Max Sharing' : 'Active - Min Sharing'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-[#00ff88]">{bandwidth?.contribution_percent ?? 10}%</div>
            <div className="text-xs text-[#606070]">Sharing Now</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{bandwidth?.contribution_mbps ?? 0}</div>
            <div className="text-xs text-[#606070]">Mbps</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{Math.floor((bandwidth?.idle_seconds ?? 0) / 60)}</div>
            <div className="text-xs text-[#606070]">Min Idle</div>
          </div>
        </div>
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

      {/* DWS/CDN Status */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-[#00cc6a]" />
            <span className="font-medium">Edge CDN Cache</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs ${
            dws?.active ? 'bg-[#00ff88]/20 text-[#00ff88]' : 'bg-[#606070]/20 text-[#606070]'
          }`}>
            {dws?.active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[#606070]">Cache Size</span>
            <span>{dws?.cache_used_mb ?? 0} MB</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#606070]">Cached Items</span>
            <span>{dws?.cached_cids ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#606070]">Requests Served</span>
            <span>{dws?.requests_served ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#606070]">CDN Earnings</span>
            <span className="text-[#00ff88]">{((dws?.earnings_wei ?? 0) / 1e18).toFixed(4)} JEJU</span>
          </div>
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

