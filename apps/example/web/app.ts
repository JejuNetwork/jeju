type EthereumRequestMethod =
  | 'eth_requestAccounts'
  | 'personal_sign'
  | 'eth_accounts'
  | 'eth_chainId'
  | 'wallet_switchEthereumChain'
  | 'wallet_addEthereumChain'

type EthereumRequestResult<M extends EthereumRequestMethod> =
  M extends 'personal_sign'
    ? string
    : M extends 'eth_requestAccounts' | 'eth_accounts'
      ? string[]
      : M extends 'eth_chainId'
        ? string
        : null

interface AddEthereumChainParameter {
  chainId: string
  chainName: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  rpcUrls: string[]
  blockExplorerUrls?: string[]
}

interface EthereumProvider {
  request: <M extends EthereumRequestMethod>(args: {
    method: M
    params?: M extends 'wallet_addEthereumChain'
      ? [AddEthereumChainParameter]
      : M extends 'wallet_switchEthereumChain'
        ? [{ chainId: string }]
        : (string | number)[]
  }) => Promise<EthereumRequestResult<M>>
  on: (
    event: 'accountsChanged' | 'chainChanged',
    handler: (data: string[] | string) => void,
  ) => void
  removeListener: (
    event: 'accountsChanged' | 'chainChanged',
    handler: (data: string[] | string) => void,
  ) => void
}

interface Todo {
  id: string
  title: string
  description: string
  completed: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate: number | null
  createdAt: number
  updatedAt: number
  owner: string
  encryptedData: string | null
  attachmentCid: string | null
}

interface AppState {
  address: string | null
  todos: Todo[]
  loading: boolean
  error: string | null
  filter: 'all' | 'pending' | 'completed'
  isConnecting: boolean
}

interface TodoListResponse {
  todos: Todo[]
  count: number
}

interface TodoResponse {
  todo: Todo
}

interface ApiErrorResponse {
  error: string
  code?: string
}

interface EthereumProviderWithMeta extends EthereumProvider {
  isMetaMask?: boolean
  isPhantom?: boolean
  isCoinbaseWallet?: boolean
  isRabby?: boolean
  isJejuWallet?: boolean
  isBraveWallet?: boolean
  isTokenPocket?: boolean
  isTrust?: boolean
  providers?: EthereumProviderWithMeta[]
}

function hasEthereumProvider(
  win: Window,
): win is Window & { ethereum: EthereumProviderWithMeta } {
  return (
    'ethereum' in win &&
    win.ethereum !== undefined &&
    typeof (win.ethereum as EthereumProvider).request === 'function'
  )
}

/**
 * Check if a provider is an EVM-native wallet (not Phantom/Solana-first)
 * Phantom injects as window.ethereum but is primarily a Solana wallet.
 * We prefer EVM-native wallets like Rabby, MetaMask, Coinbase, etc.
 */
function isEvmNativeWallet(provider: EthereumProviderWithMeta): boolean {
  // Phantom sets isPhantom=true - it's primarily a Solana wallet
  if (provider.isPhantom) return false

  // These are EVM-native wallets
  if (provider.isJejuWallet) return true
  if (provider.isRabby) return true
  if (provider.isMetaMask) return true
  if (provider.isCoinbaseWallet) return true
  if (provider.isBraveWallet) return true
  if (provider.isTokenPocket) return true
  if (provider.isTrust) return true

  // Unknown provider - assume it's EVM-native if it has request method
  return typeof provider.request === 'function'
}

/**
 * Get Ethereum provider with preference for EVM-native wallets.
 * Priority: Jeju Wallet > Rabby > MetaMask > Other EVM > Phantom
 *
 * When multiple wallets are installed, they compete for window.ethereum.
 * Phantom (Solana-first) often takes over, so we explicitly deprioritize it.
 */
function getEthereumProvider(): EthereumProvider | undefined {
  if (!hasEthereumProvider(window)) {
    return undefined
  }

  const ethereum = window.ethereum as EthereumProviderWithMeta

  // Check if there are multiple providers (EIP-5749)
  if (ethereum.providers && Array.isArray(ethereum.providers)) {
    // Priority 1: Jeju Wallet
    const jejuWallet = ethereum.providers.find((p) => p.isJejuWallet)
    if (jejuWallet) {
      console.log('[Wallet] Using Jeju Wallet')
      return jejuWallet
    }

    // Priority 2: Rabby (excellent EVM wallet)
    const rabby = ethereum.providers.find((p) => p.isRabby)
    if (rabby) {
      console.log('[Wallet] Using Rabby')
      return rabby
    }

    // Priority 3: MetaMask (but not Phantom pretending to be MetaMask)
    const metaMask = ethereum.providers.find(
      (p) => p.isMetaMask && !p.isPhantom,
    )
    if (metaMask) {
      console.log('[Wallet] Using MetaMask')
      return metaMask
    }

    // Priority 4: Any other EVM-native wallet
    const evmWallet = ethereum.providers.find((p) => isEvmNativeWallet(p))
    if (evmWallet) {
      console.log('[Wallet] Using EVM wallet')
      return evmWallet
    }

    // Fallback: First available (might be Phantom)
    console.log('[Wallet] Using first available provider')
    return ethereum.providers[0]
  }

  // Single provider - check if it's EVM-native
  if (ethereum.isJejuWallet) {
    console.log('[Wallet] Using Jeju Wallet')
    return ethereum
  }

  if (ethereum.isRabby) {
    console.log('[Wallet] Using Rabby')
    return ethereum
  }

  if (ethereum.isMetaMask && !ethereum.isPhantom) {
    console.log('[Wallet] Using MetaMask')
    return ethereum
  }

  if (ethereum.isPhantom) {
    console.log('[Wallet] Phantom detected - this is primarily a Solana wallet')
    // Still return it as fallback, but user should know
  }

  return ethereum
}

function isHTMLInputElement(
  el: Element | EventTarget | null,
): el is HTMLInputElement {
  return el instanceof HTMLInputElement
}

function isHTMLSelectElement(
  el: Element | EventTarget | null,
): el is HTMLSelectElement {
  return el instanceof HTMLSelectElement
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.error === 'string'
}

function isValidPriority(value: string): value is 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'medium' || value === 'high'
}

const API_URL = ''

// Storage keys for persistence
const STORAGE_KEYS = {
  WALLET_ADDRESS: 'jeju-tasks-wallet',
  CHAIN_ID: 'jeju-tasks-chain',
} as const

// Jeju Network configurations
const JEJU_NETWORKS = {
  localnet: {
    chainId: '0x7a69', // 31337
    chainName: 'Jeju Localnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['http://127.0.0.1:6546'],
    blockExplorerUrls: ['http://127.0.0.1:4000'],
  },
  testnet: {
    chainId: '0x66b52', // 420690
    chainName: 'Jeju Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://testnet-rpc.jejunetwork.org'],
    blockExplorerUrls: ['https://testnet-explorer.jejunetwork.org'],
  },
  mainnet: {
    chainId: '0x66b53', // 420691
    chainName: 'Jeju Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.jejunetwork.org'],
    blockExplorerUrls: ['https://explorer.jejunetwork.org'],
  },
} as const

// Determine target network based on environment
function getTargetNetwork(): AddEthereumChainParameter {
  // Check if we're on localhost
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'

  const network = isLocalhost
    ? JEJU_NETWORKS.localnet
    : window.location.hostname.includes('testnet')
      ? JEJU_NETWORKS.testnet
      : JEJU_NETWORKS.mainnet

  // Convert readonly arrays to mutable for AddEthereumChainParameter
  return {
    chainId: network.chainId,
    chainName: network.chainName,
    nativeCurrency: { ...network.nativeCurrency },
    rpcUrls: [...network.rpcUrls],
    blockExplorerUrls: [...network.blockExplorerUrls],
  }
}

// Save wallet address to localStorage
function saveWalletAddress(address: string): void {
  localStorage.setItem(STORAGE_KEYS.WALLET_ADDRESS, address)
}

// Load wallet address from localStorage
function loadWalletAddress(): string | null {
  return localStorage.getItem(STORAGE_KEYS.WALLET_ADDRESS)
}

// Clear wallet address from localStorage
function clearWalletAddress(): void {
  localStorage.removeItem(STORAGE_KEYS.WALLET_ADDRESS)
}

// Switch to Jeju network
async function switchToJejuNetwork(
  ethereum: EthereumProvider,
): Promise<boolean> {
  const targetNetwork = getTargetNetwork()

  try {
    // Try to switch to the network
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetNetwork.chainId }],
    })
    return true
  } catch (switchError) {
    const error = switchError as { code?: number }

    // Error code 4902 means the chain hasn't been added yet
    if (error.code === 4902) {
      try {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [targetNetwork],
        })
        return true
      } catch (addError) {
        console.error('Failed to add Jeju network:', addError)
        return false
      }
    }

    // User rejected the switch or other error
    console.error('Failed to switch to Jeju network:', switchError)
    return false
  }
}

// Check if currently on correct network
async function isOnCorrectNetwork(
  ethereum: EthereumProvider,
): Promise<boolean> {
  const chainId = await ethereum.request({ method: 'eth_chainId' })
  const targetNetwork = getTargetNetwork()
  return chainId === targetNetwork.chainId
}

class ApiClient {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(baseUrl: string, headers: Record<string, string> = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.headers = headers
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
        ...init?.headers,
      },
    })

    if (!response.ok) {
      const errorBody: unknown = await response.json()
      if (isApiErrorResponse(errorBody)) {
        throw new Error(errorBody.error)
      }
      throw new Error(`Request failed: ${response.status}`)
    }

    return (await response.json()) as T
  }

  async listTodos(filter?: { completed?: boolean }): Promise<TodoListResponse> {
    const params =
      filter?.completed !== undefined ? `?completed=${filter.completed}` : ''
    return this.fetch<TodoListResponse>(`/api/v1/todos${params}`)
  }

  async createTodo(input: {
    title: string
    priority: 'low' | 'medium' | 'high'
    description?: string
  }): Promise<TodoResponse> {
    return this.fetch<TodoResponse>('/api/v1/todos', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async updateTodo(
    id: string,
    input: { completed?: boolean; title?: string },
  ): Promise<TodoResponse> {
    return this.fetch<TodoResponse>(`/api/v1/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }

  async deleteTodo(id: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(`/api/v1/todos/${id}`, {
      method: 'DELETE',
    })
  }

  async encryptTodo(id: string): Promise<TodoResponse> {
    return this.fetch<TodoResponse>(`/api/v1/todos/${id}/encrypt`, {
      method: 'POST',
    })
  }
}

const state: AppState = {
  address: null,
  todos: [],
  loading: false,
  error: null,
  filter: 'all',
  isConnecting: false,
}

function setState(updates: Partial<AppState>): void {
  Object.assign(state, updates)
  render()
}

function clearError(): void {
  if (state.error) {
    setState({ error: null })
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const ethereum = getEthereumProvider()
  if (!state.address || !ethereum) {
    throw new Error('Wallet not connected')
  }

  const timestamp = Date.now().toString()
  const message = `jeju-dapp:${timestamp}`

  const signature = await ethereum.request({
    method: 'personal_sign',
    params: [message, state.address],
  })

  return {
    'x-jeju-address': state.address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-signature': signature,
  }
}

async function getAuthenticatedClient(): Promise<ApiClient> {
  const headers = await getAuthHeaders()
  return new ApiClient(API_URL, headers)
}

function validateTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) {
    throw new Error('Please enter a task title')
  }
  if (trimmed.length > 500) {
    throw new Error('Title is too long (max 500 characters)')
  }
  return trimmed
}

function validatePriority(priority: string): 'low' | 'medium' | 'high' {
  if (!isValidPriority(priority)) {
    throw new Error('Please select a valid priority')
  }
  return priority
}

async function fetchTodos(): Promise<void> {
  setState({ loading: true, error: null })

  try {
    const client = await getAuthenticatedClient()
    const completed =
      state.filter === 'all' ? undefined : state.filter === 'completed'

    const response = await client.listTodos(
      completed !== undefined ? { completed } : undefined,
    )

    setState({ todos: response.todos, loading: false })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to load tasks'
    console.error('Failed to fetch todos:', error)
    setState({ loading: false, error: message })
  }
}

async function createTodo(
  title: string,
  priority: 'low' | 'medium' | 'high',
): Promise<void> {
  try {
    const validatedTitle = validateTitle(title)
    const validatedPriority = validatePriority(priority)

    const client = await getAuthenticatedClient()
    await client.createTodo({
      title: validatedTitle,
      priority: validatedPriority,
    })

    await fetchTodos()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to create task'
    console.error('Failed to create todo:', error)
    setState({ error: message })
    throw error
  }
}

async function toggleTodo(id: string, completed: boolean): Promise<void> {
  if (!id.trim()) {
    throw new Error('Invalid todo ID')
  }

  try {
    const client = await getAuthenticatedClient()
    await client.updateTodo(id, { completed })
    await fetchTodos()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to update task'
    console.error('Failed to toggle todo:', error)
    setState({ error: message })
  }
}

async function deleteTodo(id: string): Promise<void> {
  if (!id.trim()) {
    throw new Error('Invalid todo ID')
  }

  try {
    const client = await getAuthenticatedClient()
    await client.deleteTodo(id)
    await fetchTodos()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to delete task'
    console.error('Failed to delete todo:', error)
    setState({ error: message })
  }
}

async function encryptTodo(id: string): Promise<void> {
  if (!id.trim()) {
    throw new Error('Invalid todo ID')
  }

  try {
    const client = await getAuthenticatedClient()
    await client.encryptTodo(id)
    await fetchTodos()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to encrypt task'
    console.error('Failed to encrypt todo:', error)
    setState({ error: message })
  }
}

async function connectWallet(): Promise<void> {
  const ethereum = getEthereumProvider()
  if (!ethereum) {
    setState({
      error:
        'Wallet not detected. Install MetaMask or another Web3 wallet to continue.',
    })
    return
  }

  setState({ isConnecting: true, error: null })

  // First, get accounts (connect wallet)
  const accounts = await ethereum.request({
    method: 'eth_requestAccounts',
  })

  if (accounts.length === 0) {
    setState({
      isConnecting: false,
      error: 'No accounts found. Unlock your wallet and try again.',
    })
    return
  }

  const address = accounts[0]
  if (!address.startsWith('0x')) {
    setState({ isConnecting: false, error: 'Invalid wallet address' })
    return
  }

  // Then switch to Jeju network (non-blocking - continue even if rejected)
  await switchToJejuNetwork(ethereum)

  // Save to localStorage for persistence
  saveWalletAddress(address)

  setState({ address, isConnecting: false })
  await fetchTodos()
}

function disconnectWallet(): void {
  clearWalletAddress()
  setState({ address: null, todos: [], error: null })
}

// Try to restore wallet connection on page load
async function tryRestoreWallet(): Promise<void> {
  const savedAddress = loadWalletAddress()
  if (!savedAddress) return

  const ethereum = getEthereumProvider()
  if (!ethereum) {
    clearWalletAddress()
    return
  }

  // Check if the wallet is still connected
  const accounts = await ethereum.request({ method: 'eth_accounts' })

  // Verify the saved address is still accessible
  const addressMatch = accounts.some(
    (acc) => acc.toLowerCase() === savedAddress.toLowerCase(),
  )

  if (!addressMatch) {
    clearWalletAddress()
    return
  }

  // Check if on correct network
  const onCorrectNetwork = await isOnCorrectNetwork(ethereum)
  if (!onCorrectNetwork) {
    // Try to switch, but don't block if user declines
    await switchToJejuNetwork(ethereum).catch(() => {})
  }

  // Restore the session
  setState({ address: savedAddress })
  await fetchTodos().catch((err) => {
    console.error('Failed to fetch todos on restore:', err)
  })
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getStats(): { total: number; completed: number; pending: number } {
  const total = state.todos.length
  const completed = state.todos.filter((t) => t.completed).length
  return { total, completed, pending: total - completed }
}

function render(): void {
  const app = document.getElementById('app')
  if (!app) return

  app.innerHTML = `
    <div class="min-h-screen py-6 px-4 sm:py-10 sm:px-6 lg:px-8">
      <div class="max-w-2xl mx-auto">
        ${renderHeader()}
        <main id="main-content" class="mt-8">
          ${state.address ? renderMain() : renderConnect()}
        </main>
        ${renderFooter()}
      </div>
    </div>
  `

  attachEventListeners()
}

function renderHeader(): string {
  return `
    <header class="text-center animate-fade-in">
      <div class="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl mb-4 shadow-lg"
           style="background: var(--gradient-brand);">
        <span class="text-3xl sm:text-4xl" role="img" aria-label="Tasks icon">✨</span>
      </div>
      <h1 class="text-3xl sm:text-4xl font-bold gradient-text">
        Jeju Tasks
      </h1>
      ${state.address ? renderUserBadge() : ''}
    </header>
  `
}

function getNetworkDisplayName(): string {
  const targetNetwork = getTargetNetwork()
  if (targetNetwork.chainId === JEJU_NETWORKS.localnet.chainId) {
    return 'Localnet'
  }
  if (targetNetwork.chainId === JEJU_NETWORKS.testnet.chainId) {
    return 'Testnet'
  }
  return 'Mainnet'
}

function renderUserBadge(): string {
  const address = state.address
  if (!address) return ''

  const networkName = getNetworkDisplayName()

  return `
    <div class="mt-4 flex items-center justify-center gap-3 flex-wrap">
      <div class="glass-card px-3 py-1.5 rounded-full flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-accent-500" aria-hidden="true"></span>
        <span class="text-xs font-medium text-accent-700 dark:text-accent-300">
          Jeju ${networkName}
        </span>
      </div>
      <div class="glass-card px-4 py-2 rounded-full flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-success-500 animate-pulse-soft" aria-hidden="true"></span>
        <span class="font-mono text-sm text-gray-700 dark:text-gray-300">
          ${formatAddress(address)}
        </span>
      </div>
      <button
        id="disconnect"
        class="text-sm text-gray-500 hover:text-danger-500 dark:text-gray-400 dark:hover:text-danger-400 
               transition-colors px-3 py-2 rounded-lg hover:bg-danger-400/10"
        aria-label="Disconnect wallet"
      >
        Disconnect
      </button>
    </div>
  `
}

function renderConnect(): string {
  return `
    <div class="glass-card rounded-3xl p-8 sm:p-12 text-center animate-slide-up">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6"
           style="background: var(--gradient-brand); box-shadow: var(--shadow-glow);">
        <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      </div>
      <p class="text-gray-600 dark:text-gray-400 mb-8">
        Connect your wallet to continue
      </p>
      <button
        id="connect"
        class="btn-primary text-base sm:text-lg ${state.isConnecting ? 'opacity-60 cursor-wait' : ''}"
        ${state.isConnecting ? 'disabled' : ''}
        aria-busy="${state.isConnecting}"
      >
        ${state.isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </button>
      ${state.error ? renderError() : ''}
      
      <div class="mt-10 pt-8 border-t border-gray-200 dark:border-gray-700">
        <p class="text-xs text-gray-500 dark:text-gray-500 mb-4">Powered by</p>
        <div class="flex items-center justify-center gap-4 text-xs text-gray-600 dark:text-gray-400">
          <span class="flex items-center gap-1">
            <span aria-hidden="true">🗄️</span> SQLit
          </span>
          <span class="flex items-center gap-1">
            <span aria-hidden="true">📦</span> IPFS
          </span>
          <span class="flex items-center gap-1">
            <span aria-hidden="true">🔐</span> KMS
          </span>
        </div>
      </div>
    </div>
  `
}

function renderMain(): string {
  return `
    <div class="space-y-6 animate-slide-up">
      ${renderForm()}
      ${renderFilters()}
      ${state.error ? renderError() : ''}
      <div role="region" aria-label="Task list" aria-live="polite">
        ${state.loading ? renderLoading() : renderTodoList()}
      </div>
    </div>
  `
}

function renderForm(): string {
  return `
    <form id="todo-form" class="glass-card rounded-2xl p-4 sm:p-6 shadow-lg" aria-label="Add new task">
      <div class="flex flex-col sm:flex-row gap-3">
        <div class="flex-1">
          <label for="todo-input" class="sr-only">Task title</label>
          <input
            type="text"
            id="todo-input"
            placeholder="Add a task..."
            class="input-styled w-full"
            autocomplete="off"
            maxlength="500"
            required
          />
        </div>
        <div class="flex gap-3">
          <div class="flex-1 sm:flex-none">
            <label for="priority-select" class="sr-only">Priority</label>
            <select id="priority-select" class="input-styled w-full sm:w-auto" aria-label="Task priority">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <button type="submit" class="btn-primary flex items-center gap-2" aria-label="Add task">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            <span class="hidden sm:inline">Add</span>
          </button>
        </div>
      </div>
    </form>
  `
}

function renderFilters(): string {
  const filters: Array<{
    value: AppState['filter']
    label: string
    icon: string
  }> = [
    { value: 'all', label: 'All', icon: '📋' },
    { value: 'pending', label: 'To Do', icon: '⏳' },
    { value: 'completed', label: 'Done', icon: '✅' },
  ]

  const stats = getStats()

  return `
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <nav class="flex gap-2" role="tablist" aria-label="Filter tasks">
        ${filters
          .map(
            (f) => `
          <button
            data-filter="${f.value}"
            role="tab"
            aria-selected="${state.filter === f.value}"
            aria-controls="todo-list"
            class="px-4 py-2 rounded-xl text-sm font-medium transition-all
                   ${
                     state.filter === f.value
                       ? 'bg-brand-600 text-white shadow-md'
                       : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                   }"
          >
            <span aria-hidden="true">${f.icon}</span>
            <span class="ml-1">${f.label}</span>
          </button>
        `,
          )
          .join('')}
      </nav>
      <div class="text-sm text-gray-500 dark:text-gray-400" aria-live="polite">
        ${stats.completed} of ${stats.total} completed
      </div>
    </div>
  `
}

function renderLoading(): string {
  return `
    <div class="space-y-3" aria-busy="true" aria-label="Loading tasks">
      ${Array(3)
        .fill(0)
        .map(
          () => `
        <div class="glass-card rounded-xl p-4 flex items-center gap-4">
          <div class="w-6 h-6 rounded-lg shimmer"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 w-3/4 rounded shimmer"></div>
            <div class="h-3 w-1/2 rounded shimmer"></div>
          </div>
        </div>
      `,
        )
        .join('')}
    </div>
  `
}

function renderTodoList(): string {
  if (state.todos.length === 0) {
    return renderEmptyState()
  }

  return `
    <ul id="todo-list" class="space-y-3" role="list" aria-label="Tasks">
      ${state.todos.map((todo, index) => renderTodoItem(todo, index)).join('')}
    </ul>
  `
}

function renderEmptyState(): string {
  const messages: Record<AppState['filter'], string> = {
    all: 'No tasks yet',
    pending: 'All done',
    completed: 'Nothing completed',
  }

  return `
    <div class="glass-card rounded-2xl p-8 sm:p-12 text-center">
      <p class="text-gray-500 dark:text-gray-400">
        ${messages[state.filter]}
      </p>
    </div>
  `
}

function renderTodoItem(todo: Todo, index: number): string {
  const priorityStyles: Record<string, string> = {
    low: 'priority-low',
    medium: 'priority-medium',
    high: 'priority-high',
  }

  const priorityLabels: Record<string, string> = {
    low: 'Low priority',
    medium: 'Medium priority',
    high: 'High priority',
  }

  return `
    <li class="todo-item glass-card rounded-xl p-4 flex items-start gap-4 animate-slide-in"
        style="animation-delay: ${index * 50}ms"
        data-todo-id="${todo.id}">
      <div class="pt-0.5">
        <input
          type="checkbox"
          data-toggle="${todo.id}"
          ${todo.completed ? 'checked' : ''}
          class="custom-checkbox"
          aria-label="${todo.completed ? 'Mark as incomplete' : 'Mark as complete'}: ${escapeHtml(todo.title)}"
        />
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-medium break-words ${
          todo.completed
            ? 'line-through text-gray-400 dark:text-gray-500'
            : 'text-gray-900 dark:text-white'
        }">
          ${escapeHtml(todo.title)}
        </p>
        ${
          todo.description
            ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-1 break-words">${escapeHtml(todo.description)}</p>`
            : ''
        }
        <div class="flex flex-wrap items-center gap-2 mt-2">
          <span class="${priorityStyles[todo.priority]} px-2 py-0.5 rounded-md text-xs font-medium"
                aria-label="${priorityLabels[todo.priority]}">
            ${todo.priority}
          </span>
          ${
            todo.encryptedData
              ? '<span class="text-xs text-brand-600 dark:text-brand-400 flex items-center gap-1"><span aria-hidden="true">🔒</span> Encrypted</span>'
              : ''
          }
          ${
            todo.attachmentCid
              ? '<span class="text-xs text-accent-600 dark:text-accent-400 flex items-center gap-1"><span aria-hidden="true">📎</span> File</span>'
              : ''
          }
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        ${
          !todo.encryptedData
            ? `
          <button 
            data-encrypt="${todo.id}" 
            class="icon-btn text-gray-400 hover:text-brand-600 hover:bg-brand-100 dark:hover:bg-brand-900/30"
            aria-label="Encrypt task: ${escapeHtml(todo.title)}"
            title="Encrypt with KMS"
          >
            🔐
          </button>
        `
            : ''
        }
        <button 
          data-delete="${todo.id}" 
          class="icon-btn text-gray-400 hover:text-danger-500 hover:bg-danger-100 dark:hover:bg-danger-900/30"
          aria-label="Delete task: ${escapeHtml(todo.title)}"
          title="Delete task"
        >
          🗑️
        </button>
      </div>
    </li>
  `
}

function renderError(): string {
  return `
    <div class="bg-danger-100 dark:bg-danger-900/30 border border-danger-200 dark:border-danger-800 
                rounded-xl p-4 flex items-start gap-3 animate-slide-in"
         role="alert"
         aria-live="assertive">
      <span class="text-danger-500 shrink-0" aria-hidden="true">⚠️</span>
      <div class="flex-1">
        <p class="text-sm text-danger-700 dark:text-danger-300">${escapeHtml(state.error ?? '')}</p>
      </div>
      <button
        id="dismiss-error"
        class="text-danger-500 hover:text-danger-700 p-1"
        aria-label="Dismiss error"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  `
}

function renderFooter(): string {
  return `
    <footer class="mt-12 text-center">
      <p class="text-xs text-gray-400 dark:text-gray-600">
        Jeju Network
      </p>
    </footer>
  `
}

function attachEventListeners(): void {
  // Connect wallet
  document.getElementById('connect')?.addEventListener('click', async () => {
    await connectWallet()
  })

  // Disconnect wallet
  document.getElementById('disconnect')?.addEventListener('click', () => {
    disconnectWallet()
  })

  // Dismiss error
  document.getElementById('dismiss-error')?.addEventListener('click', () => {
    clearError()
  })

  // Create todo form
  document
    .getElementById('todo-form')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const input = document.getElementById('todo-input')
      const select = document.getElementById('priority-select')

      if (!isHTMLInputElement(input) || !isHTMLSelectElement(select)) {
        setState({ error: 'Form error. Refresh and try again.' })
        return
      }

      const title = input.value.trim()
      const priority = select.value

      if (!title) {
        setState({ error: 'Please enter a task title' })
        return
      }

      try {
        await createTodo(title, validatePriority(priority))
        input.value = ''
        input.focus()
        clearError()
      } catch {
        // Error already set in createTodo
        input.focus()
      }
    })

  // Filter buttons
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const filterValue = btn.getAttribute('data-filter')
      if (
        filterValue === 'all' ||
        filterValue === 'pending' ||
        filterValue === 'completed'
      ) {
        setState({ filter: filterValue })
        await fetchTodos()
      }
    })
  })

  // Toggle todo checkboxes
  document.querySelectorAll('[data-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', async (e) => {
      const target = e.target
      if (!isHTMLInputElement(target)) return
      const id = target.getAttribute('data-toggle')
      if (!id) return
      await toggleTodo(id, target.checked)
    })
  })

  // Delete buttons
  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete')
      if (!id) return
      await deleteTodo(id)
    })
  })

  // Encrypt buttons
  document.querySelectorAll('[data-encrypt]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-encrypt')
      if (!id) return
      await encryptTodo(id)
    })
  })

  // Keyboard navigation for filter tabs
  document.querySelectorAll('[role="tab"]').forEach((tab, index, tabs) => {
    tab.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent
      let newIndex = index

      if (event.key === 'ArrowRight') {
        newIndex = (index + 1) % tabs.length
      } else if (event.key === 'ArrowLeft') {
        newIndex = (index - 1 + tabs.length) % tabs.length
      } else {
        return
      }

      event.preventDefault()
      const newTab = tabs[newIndex] as HTMLElement
      newTab.focus()
      newTab.click()
    })
  })
}

const ethereumProvider = getEthereumProvider()
if (ethereumProvider) {
  ethereumProvider.on('accountsChanged', (data: string[] | string) => {
    const accounts = Array.isArray(data) ? data : [data]
    if (accounts.length > 0 && accounts[0].startsWith('0x')) {
      saveWalletAddress(accounts[0])
      setState({ address: accounts[0] })
      fetchTodos()
    } else {
      disconnectWallet()
    }
  })

  // Handle network changes
  ethereumProvider.on('chainChanged', () => {
    // Reload the page when network changes to ensure clean state
    window.location.reload()
  })
}

// Initial render
render()

// Try to restore wallet connection after initial render
tryRestoreWallet().catch((err) => {
  console.error('Failed to restore wallet:', err)
})

export {}
