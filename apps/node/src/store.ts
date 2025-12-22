// Global state management with Zustand
// Fail-fast validation with expect/throw patterns

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
import {
  validateHardwareInfo,
  validateWalletInfo,
  validateBalanceInfo,
  validateAgentInfo,
  validateBanStatus,
  validateServiceWithStatusArray,
  validateBotWithStatusArray,
  validateEarningsSummary,
  validateProjectedEarnings,
  validateAppConfig,
  validateViewType,
  StartServiceRequestSchema,
  StartBotRequestSchema,
  StakeRequestSchema,
  UnstakeRequestSchema,
} from './validation';
import { validateStakingInfo } from './validation';

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
  setCurrentView: (view) => {
    const validatedView = validateViewType(view);
    set({ currentView: validatedView });
  },

  // Loading
  isLoading: true,
  loadingMessage: 'Initializing...',
  setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),

  // Hardware
  hardware: null,
  fetchHardware: async () => {
    const raw = await invoke('detect_hardware');
    const hardware = validateHardwareInfo(raw);
    set({ hardware });
  },

  // Wallet
  wallet: null,
  balance: null,
  fetchWallet: async () => {
    const raw = await invoke('get_wallet_info');
    if (raw === null) {
      set({ wallet: null });
      return;
    }
    const wallet = validateWalletInfo(raw);
    set({ wallet });
  },
  fetchBalance: async () => {
    const raw = await invoke('get_balance');
    const balance = validateBalanceInfo(raw);
    set({ balance });
  },

  // Agent
  agent: null,
  banStatus: null,
  fetchAgent: async () => {
    const raw = await invoke('get_agent_info');
    if (raw === null) {
      set({ agent: null });
      return;
    }
    const agent = validateAgentInfo(raw);
    set({ agent });
  },
  fetchBanStatus: async () => {
    const raw = await invoke('check_ban_status');
    const banStatus = validateBanStatus(raw);
    set({ banStatus });
  },

  // Services
  services: [],
  fetchServices: async () => {
    const raw = await invoke('get_available_services');
    const services = validateServiceWithStatusArray(raw);
    set({ services });
  },
  startService: async (serviceId, stakeAmount) => {
    if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
      throw new Error('Invalid serviceId: must be a non-empty string');
    }
    
    const request = StartServiceRequestSchema.parse({
      service_id: serviceId,
      auto_stake: stakeAmount !== undefined && stakeAmount !== '',
      stake_amount: stakeAmount !== undefined && stakeAmount !== '' ? stakeAmount : null,
      custom_settings: null,
    });
    
    set({ isLoading: true, loadingMessage: `Starting ${serviceId}...` });
    await invoke('start_service', { request });
    await get().fetchServices();
    set({ isLoading: false });
  },
  stopService: async (serviceId) => {
    if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
      throw new Error('Invalid serviceId: must be a non-empty string');
    }
    
    set({ isLoading: true, loadingMessage: `Stopping ${serviceId}...` });
    await invoke('stop_service', { service_id: serviceId });
    await get().fetchServices();
    set({ isLoading: false });
  },

  // Bots
  bots: [],
  fetchBots: async () => {
    const raw = await invoke('get_available_bots');
    const bots = validateBotWithStatusArray(raw);
    set({ bots });
  },
  startBot: async (botId, capitalWei) => {
    if (!botId || typeof botId !== 'string' || botId.length === 0) {
      throw new Error('Invalid botId: must be a non-empty string');
    }
    
    const request = StartBotRequestSchema.parse({
      bot_id: botId,
      capital_allocation_wei: capitalWei,
    });
    
    set({ isLoading: true, loadingMessage: `Starting ${botId}...` });
    await invoke('start_bot', { request });
    await get().fetchBots();
    set({ isLoading: false });
  },
  stopBot: async (botId) => {
    if (!botId || typeof botId !== 'string' || botId.length === 0) {
      throw new Error('Invalid botId: must be a non-empty string');
    }
    
    set({ isLoading: true, loadingMessage: `Stopping ${botId}...` });
    await invoke('stop_bot', { bot_id: botId });
    await get().fetchBots();
    set({ isLoading: false });
  },

  // Earnings
  earnings: null,
  projectedEarnings: null,
  fetchEarnings: async () => {
    const raw = await invoke('get_earnings_summary');
    const earnings = validateEarningsSummary(raw);
    set({ earnings });
  },
  fetchProjectedEarnings: async () => {
    const raw = await invoke('get_projected_earnings');
    const projectedEarnings = validateProjectedEarnings(raw);
    set({ projectedEarnings });
  },

  // Staking
  staking: null,
  fetchStaking: async () => {
    const raw = await invoke('get_staking_info');
    const staking = validateStakingInfo(raw);
    set({ staking });
  },
  stake: async (serviceId, amountWei) => {
    const request = StakeRequestSchema.parse({
      service_id: serviceId,
      amount_wei: amountWei,
      token_address: null,
    });
    
    set({ isLoading: true, loadingMessage: 'Staking...' });
    await invoke('stake', { request });
    await get().fetchStaking();
    set({ isLoading: false });
  },
  unstake: async (serviceId, amountWei) => {
    const request = UnstakeRequestSchema.parse({
      service_id: serviceId,
      amount_wei: amountWei,
    });
    
    set({ isLoading: true, loadingMessage: 'Unstaking...' });
    await invoke('unstake', { request });
    await get().fetchStaking();
    set({ isLoading: false });
  },
  claimRewards: async (serviceId) => {
    set({ isLoading: true, loadingMessage: 'Claiming rewards...' });
    await invoke('claim_rewards', { service_id: serviceId });
    await get().fetchStaking();
    await get().fetchEarnings();
    set({ isLoading: false });
  },

  // Config
  config: null,
  fetchConfig: async () => {
    const raw = await invoke('get_config');
    const config = validateAppConfig(raw);
    set({ config });
  },
  updateConfig: async (updates) => {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Invalid config updates: must be an object');
    }
    
    const raw = await invoke('update_config', { request: updates });
    const config = validateAppConfig(raw);
    set({ config });
  },
  setNetwork: async (network) => {
    if (!network || typeof network !== 'string' || network.length === 0) {
      throw new Error('Invalid network: must be a non-empty string');
    }
    
    set({ isLoading: true, loadingMessage: `Switching to ${network}...` });
    await invoke('set_network', { network });
    await get().fetchConfig();
    set({ isLoading: false });
  },

  // Error handling
  error: null,
  clearError: () => set({ error: null }),

  // Initialize
  initialize: async () => {
    set({ isLoading: true, loadingMessage: 'Initializing Network Node...' });
    
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
    
    set({ isLoading: false, loadingMessage: '' });
  },
}));

