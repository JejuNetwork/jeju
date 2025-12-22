/**
 * Hook for contribution status management
 * 
 * Handles fetching contribution data and settings
 */

import { useState, useEffect } from 'react';
import { invoke } from '../api';
import {
  ContributionStatusSchema,
  ContributionStatsSchema,
  ContributionSettingsSchema,
  BandwidthStateSchema,
  DWSStateSchema,
  type ContributionStatus,
  type ContributionStats,
  type ContributionSettings,
  type BandwidthState,
  type DWSState,
} from '../api/schemas';

export function useContribution() {
  const [status, setStatus] = useState<ContributionStatus | null>(null);
  const [stats, setStats] = useState<ContributionStats | null>(null);
  const [settings, setSettings] = useState<ContributionSettings | null>(null);
  const [bandwidth, setBandwidth] = useState<BandwidthState | null>(null);
  const [dws, setDws] = useState<DWSState | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusData, statsData, settingsData, bwData, dwsData] = await Promise.all([
          invoke('get_contribution_status', {}, ContributionStatusSchema),
          invoke('get_contribution_stats', {}, ContributionStatsSchema),
          invoke('get_contribution_settings', {}, ContributionSettingsSchema),
          invoke('get_bandwidth_state', {}, BandwidthStateSchema),
          invoke('get_dws_state', {}, DWSStateSchema),
        ]);
        setStatus(statusData);
        setStats(statsData);
        setSettings(settingsData);
        setBandwidth(bwData);
        setDws(dwsData);
        setError(null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to fetch contribution data');
        setError(error);
        // Fail-fast: clear all data on error
        setStatus(null);
        setStats(null);
        setSettings(null);
        setBandwidth(null);
        setDws(null);
        throw error;
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const updateSettings = async (newSettings: ContributionSettings) => {
    const validatedSettings = ContributionSettingsSchema.parse(newSettings);
    await invoke('set_contribution_settings', { settings: validatedSettings });
    setSettings(validatedSettings);
  };

  return { status, stats, settings, bandwidth, dws, updateSettings, error };
}
