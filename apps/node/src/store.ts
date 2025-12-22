import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type {
  AgentInfo,
  AppConfig,
  BalanceInfo,
  BanStatus,
  BotWithStatus,
  EarningsSummary,
  HardwareInfo,
  ProjectedEarnings,
  ServiceWithStatus,
  StakingInfo,
  ViewType,
  WalletInfo,
} from './types'
import {
  StakeRequestSchema,
  StartBotRequestSchema,
  StartServiceRequestSchema,
  UnstakeRequestSchema,
  validateAgentInfo,
  validateAppConfig,
  validateBalanceInfo,
  validateBanStatus,
  validateBotWithStatusArray,
  validateEarningsSummary,
  validateHardwareInfo,
  validateProjectedEarnings,
  validateServiceWithStatusArray,
  validateStakingInfo,
  validateViewType,
  validateWalletInfo,
} from './validation'

interface AppStore {
  // Navigation
  currentView: ViewType
  setCurrentView: (view: ViewType) => void

  // Loading states
  isLoading: boolean
  loadingMessage: string
  setLoading: (loading: boolean, message?: string) => void

  // Operation locking to prevent race conditions
  pendingOperation: string | null

  // Hardware
  hardware: HardwareInfo | null
  fetchHardware: () => Promise<void>

  // Wallet
  wallet: WalletInfo | null
  balance: BalanceInfo | null
  fetchWallet: () => Promise<void>
  fetchBalance: () => Promise<void>

  // Agent
  agent: AgentInfo | null
  banStatus: BanStatus | null
  fetchAgent: () => Promise<void>
  fetchBanStatus: () => Promise<void>

  // Services
  services: ServiceWithStatus[]
  fetchServices: () => Promise<void>
  startService: (serviceId: string, stakeAmount?: string) => Promise<void>
  stopService: (serviceId: string) => Promise<void>

  // Bots
  bots: BotWithStatus[]
  fetchBots: () => Promise<void>
  startBot: (botId: string, capitalWei: string) => Promise<void>
  stopBot: (botId: string) => Promise<void>

  // Earnings
  earnings: EarningsSummary | null
  projectedEarnings: ProjectedEarnings | null
  fetchEarnings: () => Promise<void>
  fetchProjectedEarnings: () => Promise<void>

  // Staking
  staking: StakingInfo | null
  fetchStaking: () => Promise<void>
  stake: (serviceId: string, amountWei: string) => Promise<void>
  unstake: (serviceId: string, amountWei: string) => Promise<void>
  claimRewards: (serviceId?: string) => Promise<void>

  // Config
  config: AppConfig | null
  fetchConfig: () => Promise<void>
  updateConfig: (updates: Partial<AppConfig>) => Promise<void>
  setNetwork: (network: string) => Promise<void>

  // Error handling
  error: string | null
  clearError: () => void

  // Initialize
  initialize: () => Promise<void>
}

/** Helper to execute operations with locking to prevent race conditions */
function withOperationLock<T>(
  operationName: string,
  get: () => AppStore,
  set: (state: Partial<AppStore>) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const currentOp = get().pendingOperation
  if (currentOp !== null) {
    throw new Error(
      `Operation "${operationName}" blocked: "${currentOp}" is already in progress`,
    )
  }
  set({
    pendingOperation: operationName,
    isLoading: true,
    loadingMessage: `${operationName}...`,
  })
  return fn().finally(() => {
    set({ pendingOperation: null, isLoading: false, loadingMessage: '' })
  })
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Navigation
  currentView: 'dashboard',
  setCurrentView: (view) => {
    const validatedView = validateViewType(view)
    set({ currentView: validatedView })
  },

  // Loading
  isLoading: true,
  loadingMessage: 'Initializing...',
  setLoading: (loading, message = '') =>
    set({ isLoading: loading, loadingMessage: message }),

  // Operation locking
  pendingOperation: null,

  // Hardware
  hardware: null,
  fetchHardware: async () => {
    const raw = await invoke('detect_hardware')
    const hardware = validateHardwareInfo(raw)
    set({ hardware })
  },

  // Wallet
  wallet: null,
  balance: null,
  fetchWallet: async () => {
    const raw = await invoke('get_wallet_info')
    if (raw === null) {
      set({ wallet: null })
      return
    }
    const wallet = validateWalletInfo(raw)
    set({ wallet })
  },
  fetchBalance: async () => {
    const raw = await invoke('get_balance')
    const balance = validateBalanceInfo(raw)
    set({ balance })
  },

  // Agent
  agent: null,
  banStatus: null,
  fetchAgent: async () => {
    const raw = await invoke('get_agent_info')
    if (raw === null) {
      set({ agent: null })
      return
    }
    const agent = validateAgentInfo(raw)
    set({ agent })
  },
  fetchBanStatus: async () => {
    const raw = await invoke('check_ban_status')
    const banStatus = validateBanStatus(raw)
    set({ banStatus })
  },

  // Services
  services: [],
  fetchServices: async () => {
    const raw = await invoke('get_available_services')
    const services = validateServiceWithStatusArray(raw)
    set({ services })
  },
  startService: async (serviceId, stakeAmount) => {
    if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
      throw new Error('Invalid serviceId: must be a non-empty string')
    }

    const request = StartServiceRequestSchema.parse({
      service_id: serviceId,
      auto_stake: stakeAmount !== undefined && stakeAmount !== '',
      stake_amount:
        stakeAmount !== undefined && stakeAmount !== '' ? stakeAmount : null,
      custom_settings: null,
    })

    return withOperationLock(`Starting ${serviceId}`, get, set, async () => {
      await invoke('start_service', { request })
      await get().fetchServices()
    })
  },
  stopService: async (serviceId) => {
    if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
      throw new Error('Invalid serviceId: must be a non-empty string')
    }

    return withOperationLock(`Stopping ${serviceId}`, get, set, async () => {
      await invoke('stop_service', { service_id: serviceId })
      await get().fetchServices()
    })
  },

  // Bots
  bots: [],
  fetchBots: async () => {
    const raw = await invoke('get_available_bots')
    const bots = validateBotWithStatusArray(raw)
    set({ bots })
  },
  startBot: async (botId, capitalWei) => {
    if (!botId || typeof botId !== 'string' || botId.length === 0) {
      throw new Error('Invalid botId: must be a non-empty string')
    }

    const request = StartBotRequestSchema.parse({
      bot_id: botId,
      capital_allocation_wei: capitalWei,
    })

    return withOperationLock(`Starting ${botId}`, get, set, async () => {
      await invoke('start_bot', { request })
      await get().fetchBots()
    })
  },
  stopBot: async (botId) => {
    if (!botId || typeof botId !== 'string' || botId.length === 0) {
      throw new Error('Invalid botId: must be a non-empty string')
    }

    return withOperationLock(`Stopping ${botId}`, get, set, async () => {
      await invoke('stop_bot', { bot_id: botId })
      await get().fetchBots()
    })
  },

  // Earnings
  earnings: null,
  projectedEarnings: null,
  fetchEarnings: async () => {
    const raw = await invoke('get_earnings_summary')
    const earnings = validateEarningsSummary(raw)
    set({ earnings })
  },
  fetchProjectedEarnings: async () => {
    const raw = await invoke('get_projected_earnings')
    const projectedEarnings = validateProjectedEarnings(raw)
    set({ projectedEarnings })
  },

  // Staking
  staking: null,
  fetchStaking: async () => {
    const raw = await invoke('get_staking_info')
    const staking = validateStakingInfo(raw)
    set({ staking })
  },
  stake: async (serviceId, amountWei) => {
    const request = StakeRequestSchema.parse({
      service_id: serviceId,
      amount_wei: amountWei,
      token_address: null,
    })

    return withOperationLock('Staking', get, set, async () => {
      await invoke('stake', { request })
      await get().fetchStaking()
    })
  },
  unstake: async (serviceId, amountWei) => {
    const request = UnstakeRequestSchema.parse({
      service_id: serviceId,
      amount_wei: amountWei,
    })

    return withOperationLock('Unstaking', get, set, async () => {
      await invoke('unstake', { request })
      await get().fetchStaking()
    })
  },
  claimRewards: async (serviceId) => {
    return withOperationLock('Claiming rewards', get, set, async () => {
      await invoke('claim_rewards', { service_id: serviceId })
      await get().fetchStaking()
      await get().fetchEarnings()
    })
  },

  // Config
  config: null,
  fetchConfig: async () => {
    const raw = await invoke('get_config')
    const config = validateAppConfig(raw)
    set({ config })
  },
  updateConfig: async (updates) => {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Invalid config updates: must be an object')
    }

    const raw = await invoke('update_config', { request: updates })
    const config = validateAppConfig(raw)
    set({ config })
  },
  setNetwork: async (network) => {
    if (!network || typeof network !== 'string' || network.length === 0) {
      throw new Error('Invalid network: must be a non-empty string')
    }

    return withOperationLock(`Switching to ${network}`, get, set, async () => {
      await invoke('set_network', { network })
      await get().fetchConfig()
    })
  },

  // Error handling
  error: null,
  clearError: () => set({ error: null }),

  // Initialize
  initialize: async () => {
    return withOperationLock('Initializing', get, set, async () => {
      await get().fetchHardware()
      await get().fetchConfig()
      await get().fetchWallet()
      await get().fetchServices()
      await get().fetchBots()
      await get().fetchProjectedEarnings()

      if (get().wallet) {
        await get().fetchBalance()
        await get().fetchAgent()
        await get().fetchBanStatus()
        await get().fetchEarnings()
        await get().fetchStaking()
      }
    })
  },
}))
