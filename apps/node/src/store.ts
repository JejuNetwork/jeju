// Global state management with Zustand

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  HardwareInfo,
  WalletInfo,
  BalanceInfo,
  AgentInfo,
  BanStatus,
  ServiceWithStatus,
  BotWithStatus,
  EarningsSummary,
  ProjectedEarnings,
  StakingInfo,
  AppConfig,
  ViewType,
} from './types';

interface AppStore {
  // Navigation
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;

  // Loading states
  isLoading: boolean;
  loadingMessage: string;
  setLoading: (loading: boolean, message?: string) => void;

  // Hardware
  hardware: HardwareInfo | null;
  fetchHardware: () => Promise<void>;

  // Wallet
  wallet: WalletInfo | null;
  balance: BalanceInfo | null;
  fetchWallet: () => Promise<void>;
  fetchBalance: () => Promise<void>;

  // Agent
  agent: AgentInfo | null;
  banStatus: BanStatus | null;
  fetchAgent: () => Promise<void>;
  fetchBanStatus: () => Promise<void>;

  // Services
  services: ServiceWithStatus[];
  fetchServices: () => Promise<void>;
  startService: (serviceId: string, stakeAmount?: string) => Promise<void>;
  stopService: (serviceId: string) => Promise<void>;

  // Bots
  bots: BotWithStatus[];
  fetchBots: () => Promise<void>;
  startBot: (botId: string, capitalWei: string) => Promise<void>;
  stopBot: (botId: string) => Promise<void>;

  // Earnings
  earnings: EarningsSummary | null;
  projectedEarnings: ProjectedEarnings | null;
  fetchEarnings: () => Promise<void>;
  fetchProjectedEarnings: () => Promise<void>;

  // Staking
  staking: StakingInfo | null;
  fetchStaking: () => Promise<void>;
  stake: (serviceId: string, amountWei: string) => Promise<void>;
  unstake: (serviceId: string, amountWei: string) => Promise<void>;
  claimRewards: (serviceId?: string) => Promise<void>;

  // Config
  config: AppConfig | null;
  fetchConfig: () => Promise<void>;
  updateConfig: (updates: Partial<AppConfig>) => Promise<void>;
  setNetwork: (network: string) => Promise<void>;

  // Error handling
  error: string | null;
  clearError: () => void;

  // Initialize
  initialize: () => Promise<void>;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Navigation
  currentView: 'dashboard',
  setCurrentView: (view) => set({ currentView: view }),

  // Loading
  isLoading: true,
  loadingMessage: 'Initializing...',
  setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),

  // Hardware
  hardware: null,
  fetchHardware: async () => {
    try {
      const hardware = await invoke<HardwareInfo>('detect_hardware');
      set({ hardware });
    } catch (e) {
      set({ error: `Failed to detect hardware: ${e}` });
    }
  },

  // Wallet
  wallet: null,
  balance: null,
  fetchWallet: async () => {
    try {
      const wallet = await invoke<WalletInfo | null>('get_wallet_info');
      set({ wallet });
    } catch (e) {
      console.error('Failed to fetch wallet:', e);
    }
  },
  fetchBalance: async () => {
    try {
      const balance = await invoke<BalanceInfo>('get_balance');
      set({ balance });
    } catch (e) {
      console.error('Failed to fetch balance:', e);
    }
  },

  // Agent
  agent: null,
  banStatus: null,
  fetchAgent: async () => {
    try {
      const agent = await invoke<AgentInfo | null>('get_agent_info');
      set({ agent });
    } catch (e) {
      console.error('Failed to fetch agent:', e);
    }
  },
  fetchBanStatus: async () => {
    try {
      const banStatus = await invoke<BanStatus>('check_ban_status');
      set({ banStatus });
    } catch (e) {
      console.error('Failed to fetch ban status:', e);
    }
  },

  // Services
  services: [],
  fetchServices: async () => {
    try {
      const services = await invoke<ServiceWithStatus[]>('get_available_services');
      set({ services });
    } catch (e) {
      set({ error: `Failed to fetch services: ${e}` });
    }
  },
  startService: async (serviceId, stakeAmount) => {
    try {
      set({ isLoading: true, loadingMessage: `Starting ${serviceId}...` });
      await invoke('start_service', {
        request: {
          service_id: serviceId,
          auto_stake: !!stakeAmount,
          stake_amount: stakeAmount,
          custom_settings: null,
        },
      });
      await get().fetchServices();
    } catch (e) {
      set({ error: `Failed to start service: ${e}` });
    } finally {
      set({ isLoading: false });
    }
  },
  stopService: async (serviceId) => {
    try {
      set({ isLoading: true, loadingMessage: `Stopping ${serviceId}...` });
      await invoke('stop_service', { service_id: serviceId });
      await get().fetchServices();
    } catch (e) {
      set({ error: `Failed to stop service: ${e}` });
    } finally {
      set({ isLoading: false });
    }
  },

  // Bots
  bots: [],
  fetchBots: async () => {
    try {
      const bots = await invoke<BotWithStatus[]>('get_available_bots');
      set({ bots });
    } catch (e) {
      set({ error: `Failed to fetch bots: ${e}` });
    }
  },
  startBot: async (botId, capitalWei) => {
    try {
      set({ isLoading: true, loadingMessage: `Starting ${botId}...` });
      await invoke('start_bot', {
        request: {
          bot_id: botId,
          capital_allocation_wei: capitalWei,
        },
      });
      await get().fetchBots();
    } catch (e) {
      set({ error: `Failed to start bot: ${e}` });
    } finally {
      set({ isLoading: false });
    }
  },
  stopBot: async (botId) => {
    try {
      set({ isLoading: true, loadingMessage: `Stopping ${botId}...` });
      await invoke('stop_bot', { bot_id: botId });
      await get().fetchBots();
    } catch (e) {
      set({ error: `Failed to stop bot: ${e}` });
    } finally {
      set({ isLoading: false });
    }
  },

  // Earnings
  earnings: null,
  projectedEarnings: null,
  fetchEarnings: async () => {
    try {
      const earnings = await invoke<EarningsSummary>('get_earnings_summary');
      set({ earnings });
    } catch (e) {
      console.error('Failed to fetch earnings:', e);
    }
  },
  fetchProjectedEarnings: async () => {
    try {
      const projectedEarnings = await invoke<ProjectedEarnings>('get_projected_earnings');
      set({ projectedEarnings });
    } catch (e) {
      console.error('Failed to fetch projected earnings:', e);
    }
  },

  // Staking
  staking: null,
  fetchStaking: async () => {
    try {
      const staking = await invoke<StakingInfo>('get_staking_info');
      set({ staking });
    } catch (e) {
      console.error('Failed to fetch staking:', e);
    }
  },
  stake: async (serviceId, amountWei) => {
    try {
      set({ isLoading: true, loadingMessage: 'Staking...' });
      await invoke('stake', {
        request: {
          service_id: serviceId,
          amount_wei: amountWei,
          token_address: null,
        },
      });
      await get().fetchStaking();
    } catch (e) {
      set({ error: `Failed to stake: ${e}` });
    } finally {
      set({ isLoading: false });
    }
  },
  unstake: async (serviceId, amountWei) => {
    try {
      set({ isLoading: true, loadingMessage: 'Unstaking...' });
      await invoke('unstake', {
        request: {
          service_id: serviceId,
          amount_wei: amountWei,
        },
      });
      await get().fetchStaking();
    } catch (e) {
      set({ error: `Failed to unstake: ${e}` });
    } finally {
      set({ isLoading: false });
    }
  },
  claimRewards: async (serviceId) => {
    try {
      set({ isLoading: true, loadingMessage: 'Claiming rewards...' });
      await invoke('claim_rewards', { service_id: serviceId });
      await get().fetchStaking();
      await get().fetchEarnings();
    } catch (e) {
      set({ error: `Failed to claim rewards: ${e}` });
    } finally {
      set({ isLoading: false });
    }
  },

  // Config
  config: null,
  fetchConfig: async () => {
    try {
      const config = await invoke<AppConfig>('get_config');
      set({ config });
    } catch (e) {
      console.error('Failed to fetch config:', e);
    }
  },
  updateConfig: async (updates) => {
    try {
      const config = await invoke<AppConfig>('update_config', { request: updates });
      set({ config });
    } catch (e) {
      set({ error: `Failed to update config: ${e}` });
    }
  },
  setNetwork: async (network) => {
    try {
      set({ isLoading: true, loadingMessage: `Switching to ${network}...` });
      await invoke('set_network', { network });
      await get().fetchConfig();
    } catch (e) {
      set({ error: `Failed to set network: ${e}` });
    } finally {
      set({ isLoading: false });
    }
  },

  // Error handling
  error: null,
  clearError: () => set({ error: null }),

  // Initialize
  initialize: async () => {
    set({ isLoading: true, loadingMessage: 'Initializing Network Node...' });
    
    try {
      await get().fetchHardware();
      await get().fetchConfig();
      await get().fetchWallet();
      await get().fetchServices();
      await get().fetchBots();
      await get().fetchProjectedEarnings();
      
      if (get().wallet) {
        await get().fetchBalance();
        await get().fetchAgent();
        await get().fetchBanStatus();
        await get().fetchEarnings();
        await get().fetchStaking();
      }
    } catch (e) {
      set({ error: `Initialization failed: ${e}` });
    } finally {
      set({ isLoading: false, loadingMessage: '' });
    }
  },
}));

