import { invoke } from '@tauri-apps/api/core'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from 'react'
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
} from '../../lib/types'
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
} from '../../lib/validation'

interface AppState {
  currentView: ViewType
  isLoading: boolean
  loadingMessage: string
  pendingOperation: string | null
  hardware: HardwareInfo | null
  wallet: WalletInfo | null
  balance: BalanceInfo | null
  agent: AgentInfo | null
  banStatus: BanStatus | null
  services: ServiceWithStatus[]
  bots: BotWithStatus[]
  earnings: EarningsSummary | null
  projectedEarnings: ProjectedEarnings | null
  staking: StakingInfo | null
  config: AppConfig | null
  error: string | null
}

type AppAction =
  | { type: 'SET_VIEW'; payload: ViewType }
  | { type: 'SET_LOADING'; payload: { isLoading: boolean; message: string } }
  | { type: 'SET_PENDING_OPERATION'; payload: string | null }
  | { type: 'SET_HARDWARE'; payload: HardwareInfo | null }
  | { type: 'SET_WALLET'; payload: WalletInfo | null }
  | { type: 'SET_BALANCE'; payload: BalanceInfo | null }
  | { type: 'SET_AGENT'; payload: AgentInfo | null }
  | { type: 'SET_BAN_STATUS'; payload: BanStatus | null }
  | { type: 'SET_SERVICES'; payload: ServiceWithStatus[] }
  | { type: 'SET_BOTS'; payload: BotWithStatus[] }
  | { type: 'SET_EARNINGS'; payload: EarningsSummary | null }
  | { type: 'SET_PROJECTED_EARNINGS'; payload: ProjectedEarnings | null }
  | { type: 'SET_STAKING'; payload: StakingInfo | null }
  | { type: 'SET_CONFIG'; payload: AppConfig | null }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_ERROR' }

const initialState: AppState = {
  currentView: 'dashboard',
  isLoading: true,
  loadingMessage: 'Initializing...',
  pendingOperation: null,
  hardware: null,
  wallet: null,
  balance: null,
  agent: null,
  banStatus: null,
  services: [],
  bots: [],
  earnings: null,
  projectedEarnings: null,
  staking: null,
  config: null,
  error: null,
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, currentView: action.payload }
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload.isLoading,
        loadingMessage: action.payload.message,
      }
    case 'SET_PENDING_OPERATION':
      return { ...state, pendingOperation: action.payload }
    case 'SET_HARDWARE':
      return { ...state, hardware: action.payload }
    case 'SET_WALLET':
      return { ...state, wallet: action.payload }
    case 'SET_BALANCE':
      return { ...state, balance: action.payload }
    case 'SET_AGENT':
      return { ...state, agent: action.payload }
    case 'SET_BAN_STATUS':
      return { ...state, banStatus: action.payload }
    case 'SET_SERVICES':
      return { ...state, services: action.payload }
    case 'SET_BOTS':
      return { ...state, bots: action.payload }
    case 'SET_EARNINGS':
      return { ...state, earnings: action.payload }
    case 'SET_PROJECTED_EARNINGS':
      return { ...state, projectedEarnings: action.payload }
    case 'SET_STAKING':
      return { ...state, staking: action.payload }
    case 'SET_CONFIG':
      return { ...state, config: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload }
    case 'CLEAR_ERROR':
      return { ...state, error: null }
    default:
      return state
  }
}

interface AppContextValue extends AppState {
  setCurrentView: (view: ViewType) => void
  setLoading: (loading: boolean, message?: string) => void
  fetchHardware: () => Promise<void>
  fetchWallet: () => Promise<void>
  fetchBalance: () => Promise<void>
  fetchAgent: () => Promise<void>
  fetchBanStatus: () => Promise<void>
  fetchServices: () => Promise<void>
  startService: (serviceId: string, stakeAmount?: string) => Promise<void>
  stopService: (serviceId: string) => Promise<void>
  fetchBots: () => Promise<void>
  startBot: (botId: string, capitalWei: string) => Promise<void>
  stopBot: (botId: string) => Promise<void>
  fetchEarnings: () => Promise<void>
  fetchProjectedEarnings: () => Promise<void>
  fetchStaking: () => Promise<void>
  stake: (serviceId: string, amountWei: string) => Promise<void>
  unstake: (serviceId: string, amountWei: string) => Promise<void>
  claimRewards: (serviceId?: string) => Promise<void>
  fetchConfig: () => Promise<void>
  updateConfig: (updates: Partial<AppConfig>) => Promise<void>
  setNetwork: (network: string) => Promise<void>
  clearError: () => void
  initialize: () => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

interface AppProviderProps {
  children: ReactNode
}

export function AppProvider({ children }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState)

  const pendingOperationRef = useRef<string | null>(null)
  const initializingRef = useRef(false)

  const withOperationLock = useCallback(
    async <T,>(
      operationName: string,
      fn: () => Promise<T>,
    ): Promise<T | undefined> => {
      if (pendingOperationRef.current !== null) {
        // If same operation is already in progress, skip silently (handles React 18 double-invoke)
        if (pendingOperationRef.current === operationName) {
          return undefined
        }
        throw new Error(
          `Operation "${operationName}" blocked: "${pendingOperationRef.current}" is already in progress`,
        )
      }
      pendingOperationRef.current = operationName
      dispatch({ type: 'SET_PENDING_OPERATION', payload: operationName })
      dispatch({
        type: 'SET_LOADING',
        payload: { isLoading: true, message: `${operationName}...` },
      })

      try {
        return await fn()
      } finally {
        pendingOperationRef.current = null
        dispatch({ type: 'SET_PENDING_OPERATION', payload: null })
        dispatch({
          type: 'SET_LOADING',
          payload: { isLoading: false, message: '' },
        })
      }
    },
    [],
  )

  const setCurrentView = useCallback((view: ViewType) => {
    const validatedView = validateViewType(view)
    dispatch({ type: 'SET_VIEW', payload: validatedView })
  }, [])

  const setLoading = useCallback((loading: boolean, message = '') => {
    dispatch({
      type: 'SET_LOADING',
      payload: { isLoading: loading, message },
    })
  }, [])

  const fetchHardware = useCallback(async () => {
    const raw = await invoke('detect_hardware')
    const hardware = validateHardwareInfo(raw)
    dispatch({ type: 'SET_HARDWARE', payload: hardware })
  }, [])

  const fetchWallet = useCallback(async () => {
    const raw = await invoke('get_wallet_info')
    if (raw === null) {
      dispatch({ type: 'SET_WALLET', payload: null })
      return
    }
    const wallet = validateWalletInfo(raw)
    dispatch({ type: 'SET_WALLET', payload: wallet })
  }, [])

  const fetchBalance = useCallback(async () => {
    const raw = await invoke('get_balance')
    const balance = validateBalanceInfo(raw)
    dispatch({ type: 'SET_BALANCE', payload: balance })
  }, [])

  const fetchAgent = useCallback(async () => {
    const raw = await invoke('get_agent_info')
    if (raw === null) {
      dispatch({ type: 'SET_AGENT', payload: null })
      return
    }
    const agent = validateAgentInfo(raw)
    dispatch({ type: 'SET_AGENT', payload: agent })
  }, [])

  const fetchBanStatus = useCallback(async () => {
    const raw = await invoke('check_ban_status')
    const banStatus = validateBanStatus(raw)
    dispatch({ type: 'SET_BAN_STATUS', payload: banStatus })
  }, [])

  const fetchServices = useCallback(async () => {
    const raw = await invoke('get_available_services')
    const services = validateServiceWithStatusArray(raw)
    dispatch({ type: 'SET_SERVICES', payload: services })
  }, [])

  const startService = useCallback(
    async (serviceId: string, stakeAmount?: string) => {
      if (
        !serviceId ||
        typeof serviceId !== 'string' ||
        serviceId.length === 0
      ) {
        throw new Error('Invalid serviceId: must be a non-empty string')
      }

      const request = StartServiceRequestSchema.parse({
        service_id: serviceId,
        auto_stake: stakeAmount !== undefined && stakeAmount !== '',
        stake_amount:
          stakeAmount !== undefined && stakeAmount !== '' ? stakeAmount : null,
        custom_settings: null,
      })

      await withOperationLock(`Starting ${serviceId}`, async () => {
        await invoke('start_service', { request })
        await fetchServices()
      })
    },
    [withOperationLock, fetchServices],
  )

  const stopService = useCallback(
    async (serviceId: string) => {
      if (
        !serviceId ||
        typeof serviceId !== 'string' ||
        serviceId.length === 0
      ) {
        throw new Error('Invalid serviceId: must be a non-empty string')
      }

      await withOperationLock(`Stopping ${serviceId}`, async () => {
        await invoke('stop_service', { service_id: serviceId })
        await fetchServices()
      })
    },
    [withOperationLock, fetchServices],
  )

  const fetchBots = useCallback(async () => {
    const raw = await invoke('get_available_bots')
    const bots = validateBotWithStatusArray(raw)
    dispatch({ type: 'SET_BOTS', payload: bots })
  }, [])

  const startBot = useCallback(
    async (botId: string, capitalWei: string) => {
      if (!botId || typeof botId !== 'string' || botId.length === 0) {
        throw new Error('Invalid botId: must be a non-empty string')
      }

      const request = StartBotRequestSchema.parse({
        bot_id: botId,
        capital_allocation_wei: capitalWei,
      })

      await withOperationLock(`Starting ${botId}`, async () => {
        await invoke('start_bot', { request })
        await fetchBots()
      })
    },
    [withOperationLock, fetchBots],
  )

  const stopBot = useCallback(
    async (botId: string) => {
      if (!botId || typeof botId !== 'string' || botId.length === 0) {
        throw new Error('Invalid botId: must be a non-empty string')
      }

      await withOperationLock(`Stopping ${botId}`, async () => {
        await invoke('stop_bot', { bot_id: botId })
        await fetchBots()
      })
    },
    [withOperationLock, fetchBots],
  )

  const fetchEarnings = useCallback(async () => {
    const raw = await invoke('get_earnings_summary')
    const earnings = validateEarningsSummary(raw)
    dispatch({ type: 'SET_EARNINGS', payload: earnings })
  }, [])

  const fetchProjectedEarnings = useCallback(async () => {
    const raw = await invoke('get_projected_earnings')
    const projectedEarnings = validateProjectedEarnings(raw)
    dispatch({ type: 'SET_PROJECTED_EARNINGS', payload: projectedEarnings })
  }, [])

  const fetchStaking = useCallback(async () => {
    const raw = await invoke('get_staking_info')
    const staking = validateStakingInfo(raw)
    dispatch({ type: 'SET_STAKING', payload: staking })
  }, [])

  const stake = useCallback(
    async (serviceId: string, amountWei: string) => {
      const request = StakeRequestSchema.parse({
        service_id: serviceId,
        amount_wei: amountWei,
        token_address: null,
      })

      await withOperationLock('Staking', async () => {
        await invoke('stake', { request })
        await fetchStaking()
      })
    },
    [withOperationLock, fetchStaking],
  )

  const unstake = useCallback(
    async (serviceId: string, amountWei: string) => {
      const request = UnstakeRequestSchema.parse({
        service_id: serviceId,
        amount_wei: amountWei,
      })

      await withOperationLock('Unstaking', async () => {
        await invoke('unstake', { request })
        await fetchStaking()
      })
    },
    [withOperationLock, fetchStaking],
  )

  const claimRewards = useCallback(
    async (serviceId?: string) => {
      await withOperationLock('Claiming rewards', async () => {
        await invoke('claim_rewards', { service_id: serviceId })
        await fetchStaking()
        await fetchEarnings()
      })
    },
    [withOperationLock, fetchStaking, fetchEarnings],
  )

  const fetchConfig = useCallback(async () => {
    const raw = await invoke('get_config')
    const config = validateAppConfig(raw)
    dispatch({ type: 'SET_CONFIG', payload: config })
  }, [])

  const updateConfig = useCallback(async (updates: Partial<AppConfig>) => {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Invalid config updates: must be an object')
    }

    const raw = await invoke('update_config', { request: updates })
    const config = validateAppConfig(raw)
    dispatch({ type: 'SET_CONFIG', payload: config })
  }, [])

  const setNetwork = useCallback(
    async (network: string) => {
      if (!network || typeof network !== 'string' || network.length === 0) {
        throw new Error('Invalid network: must be a non-empty string')
      }

      await withOperationLock(`Switching to ${network}`, async () => {
        await invoke('set_network', { network })
        await fetchConfig()
      })
    },
    [withOperationLock, fetchConfig],
  )

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' })
  }, [])

  const initialize = useCallback(async () => {
    if (initializingRef.current) return
    initializingRef.current = true

    try {
      await withOperationLock('Initializing', async () => {
        await fetchHardware()
        await fetchConfig()
        await fetchWallet()
        await fetchServices()
        await fetchBots()
        await fetchProjectedEarnings()

        const raw = await invoke('get_wallet_info')
        if (raw !== null) {
          await fetchBalance()
          await fetchAgent()
          await fetchBanStatus()
          await fetchEarnings()
          await fetchStaking()
        }
      })
    } catch (err) {
      console.error('Initialization error:', err)
    }
  }, [
    withOperationLock,
    fetchHardware,
    fetchConfig,
    fetchWallet,
    fetchServices,
    fetchBots,
    fetchProjectedEarnings,
    fetchBalance,
    fetchAgent,
    fetchBanStatus,
    fetchEarnings,
    fetchStaking,
  ])

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      setCurrentView,
      setLoading,
      fetchHardware,
      fetchWallet,
      fetchBalance,
      fetchAgent,
      fetchBanStatus,
      fetchServices,
      startService,
      stopService,
      fetchBots,
      startBot,
      stopBot,
      fetchEarnings,
      fetchProjectedEarnings,
      fetchStaking,
      stake,
      unstake,
      claimRewards,
      fetchConfig,
      updateConfig,
      setNetwork,
      clearError,
      initialize,
    }),
    [
      state,
      setCurrentView,
      setLoading,
      fetchHardware,
      fetchWallet,
      fetchBalance,
      fetchAgent,
      fetchBanStatus,
      fetchServices,
      startService,
      stopService,
      fetchBots,
      startBot,
      stopBot,
      fetchEarnings,
      fetchProjectedEarnings,
      fetchStaking,
      stake,
      unstake,
      claimRewards,
      fetchConfig,
      updateConfig,
      setNetwork,
      clearError,
      initialize,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppStore(): AppContextValue {
  const context = useContext(AppContext)
  if (context === null) {
    throw new Error('useAppStore must be used within an AppProvider')
  }
  return context
}
