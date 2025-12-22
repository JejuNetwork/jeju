/**
 * Decentralized Todo Frontend
 *
 * Uses typed fetch wrapper for API calls.
 * The backend is Elysia-based, but for browser compatibility we use
 * a typed HTTP client pattern.
 */

// ============================================================================
// Types
// ============================================================================

type EthereumRequestMethod =
  | 'eth_requestAccounts'
  | 'personal_sign'
  | 'eth_accounts'

interface EthereumRequestArgs {
  method: EthereumRequestMethod
  params?: (string | number)[]
}

// Extend Window interface for ethereum provider
interface EthereumProvider {
  request: (args: EthereumRequestArgs) => Promise<string | string[]>
  on: (event: 'accountsChanged', handler: (accounts: string[]) => void) => void
  removeListener: (
    event: 'accountsChanged',
    handler: (accounts: string[]) => void,
  ) => void
}

// Access ethereum via explicit property to avoid type conflicts
function getEthereumProvider(): EthereumProvider | undefined {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum
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
}

// ============================================================================
// API Client Types
// ============================================================================

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

// ============================================================================
// Configuration
// ============================================================================

const API_URL = 'http://localhost:4500'

// ============================================================================
// State
// ============================================================================

const state: AppState = {
  address: null,
  todos: [],
  loading: false,
  error: null,
  filter: 'all',
}

// ============================================================================
// Typed API Client
// ============================================================================

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
      const errorBody = (await response.json().catch(() => ({
        error: response.statusText,
      }))) as ApiErrorResponse
      throw new Error(errorBody.error || `Request failed: ${response.status}`)
    }

    return response.json() as Promise<T>
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

// ============================================================================
// Auth Header Generation
// ============================================================================

async function getAuthHeaders(): Promise<Record<string, string>> {
  const ethereum = getEthereumProvider()
  if (!state.address || !ethereum) {
    throw new Error('Wallet not connected')
  }

  const timestamp = Date.now().toString()
  const message = `jeju-dapp:${timestamp}`

  const signature = (await ethereum.request({
    method: 'personal_sign',
    params: [message, state.address],
  })) as string

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

// ============================================================================
// API Functions
// ============================================================================

function validateTitle(title: string): string {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('Title is required and cannot be empty')
  }
  if (title.length > 500) {
    throw new Error('Title too long (max 500 characters)')
  }
  return title.trim()
}

function validatePriority(priority: string): 'low' | 'medium' | 'high' {
  if (!['low', 'medium', 'high'].includes(priority)) {
    throw new Error('Priority must be low, medium, or high')
  }
  return priority as 'low' | 'medium' | 'high'
}

async function fetchTodos(): Promise<void> {
  state.loading = true
  state.error = null
  render()

  const client = await getAuthenticatedClient()
  const completed =
    state.filter === 'all' ? undefined : state.filter === 'completed'

  const response = await client.listTodos(
    completed !== undefined ? { completed } : undefined,
  )

  state.todos = response.todos
  state.loading = false
  render()
}

async function createTodo(
  title: string,
  priority: 'low' | 'medium' | 'high',
): Promise<void> {
  const validatedTitle = validateTitle(title)
  const validatedPriority = validatePriority(priority)

  const client = await getAuthenticatedClient()
  await client.createTodo({
    title: validatedTitle,
    priority: validatedPriority,
  })

  await fetchTodos()
}

async function toggleTodo(id: string, completed: boolean): Promise<void> {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('Todo ID is required')
  }
  if (typeof completed !== 'boolean') {
    throw new Error('Completed must be a boolean')
  }

  const client = await getAuthenticatedClient()
  await client.updateTodo(id, { completed })
  await fetchTodos()
}

async function deleteTodo(id: string): Promise<void> {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('Todo ID is required')
  }

  const client = await getAuthenticatedClient()
  await client.deleteTodo(id)
  await fetchTodos()
}

async function encryptTodo(id: string): Promise<void> {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('Todo ID is required')
  }

  const client = await getAuthenticatedClient()
  await client.encryptTodo(id)
  await fetchTodos()
}

async function connectWallet(): Promise<void> {
  const ethereum = getEthereumProvider()
  if (!ethereum) {
    state.error = 'Please install MetaMask or another Web3 wallet'
    render()
    return
  }

  const accounts = (await ethereum.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (accounts.length === 0) {
    throw new Error('No accounts returned from wallet')
  }

  const address = accounts[0]
  if (!address.startsWith('0x')) {
    throw new Error(`Invalid address format: ${address}`)
  }

  state.address = address
  await fetchTodos()
}

function disconnectWallet(): void {
  state.address = null
  state.todos = []
  render()
}

// ============================================================================
// Rendering
// ============================================================================

function render(): void {
  const app = document.getElementById('app')
  if (!app) return

  app.innerHTML = `
    <div class="max-w-4xl mx-auto px-4 py-8">
      ${renderHeader()}
      ${state.address ? renderMain() : renderConnect()}
    </div>
  `

  attachEventListeners()
}

function renderHeader(): string {
  return `
    <header class="mb-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
            📝 Decentralized Todo
          </h1>
          <p class="text-gray-600 dark:text-gray-400 mt-1">
            Powered by Jeju Network • CQL • IPFS • KMS
          </p>
        </div>
        ${
          state.address
            ? `
          <div class="flex items-center gap-4">
            <span class="text-sm text-gray-600 dark:text-gray-400">
              ${state.address.slice(0, 6)}...${state.address.slice(-4)}
            </span>
            <button id="disconnect" class="px-4 py-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400">
              Disconnect
            </button>
          </div>
        `
            : ''
        }
      </div>
    </header>
  `
}

function renderConnect(): string {
  return `
    <div class="text-center py-16">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-jeju-100 dark:bg-jeju-900 mb-4">
        <svg class="w-8 h-8 text-jeju-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      </div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Connect Your Wallet
      </h2>
      <p class="text-gray-600 dark:text-gray-400 mb-6">
        Connect your wallet to access your decentralized todos
      </p>
      <button id="connect" class="px-6 py-3 bg-jeju-600 text-white rounded-lg hover:bg-jeju-700 transition-colors">
        Connect Wallet
      </button>
      ${state.error ? `<p class="mt-4 text-red-600">${state.error}</p>` : ''}
    </div>
  `
}

function renderMain(): string {
  return `
    <main>
      ${renderForm()}
      ${renderFilters()}
      ${state.loading ? renderLoading() : renderTodoList()}
    </main>
  `
}

function renderForm(): string {
  return `
    <form id="todo-form" class="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <div class="flex gap-4">
        <input 
          type="text" 
          id="todo-input"
          placeholder="What needs to be done?"
          class="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                 bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                 focus:ring-2 focus:ring-jeju-500 focus:border-transparent"
        />
        <select id="priority-select" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
        </select>
        <button type="submit" class="px-6 py-2 bg-jeju-600 text-white rounded-lg hover:bg-jeju-700 transition-colors">
          Add
        </button>
      </div>
    </form>
  `
}

function renderFilters(): string {
  const filters = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'completed', label: 'Completed' },
  ]

  return `
    <div class="flex gap-2 mb-4">
      ${filters
        .map(
          (f) => `
        <button 
          data-filter="${f.value}"
          class="px-4 py-2 rounded-lg text-sm transition-colors
                 ${
                   state.filter === f.value
                     ? 'bg-jeju-600 text-white'
                     : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                 }"
        >
          ${f.label}
        </button>
      `,
        )
        .join('')}
    </div>
  `
}

function renderLoading(): string {
  return `
    <div class="text-center py-8">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-jeju-600 border-r-transparent"></div>
      <p class="mt-2 text-gray-600 dark:text-gray-400">Loading todos...</p>
    </div>
  `
}

function renderTodoList(): string {
  if (state.todos.length === 0) {
    return `
      <div class="text-center py-8">
        <p class="text-gray-600 dark:text-gray-400">No todos yet. Create one above.</p>
      </div>
    `
  }

  return `
    <ul class="space-y-2">
      ${state.todos.map(renderTodoItem).join('')}
    </ul>
  `
}

function renderTodoItem(todo: Todo): string {
  const priorityColors = {
    low: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    medium:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  }

  return `
    <li class="fade-in bg-white dark:bg-gray-800 rounded-lg shadow p-4 flex items-center gap-4">
      <input 
        type="checkbox" 
        data-toggle="${todo.id}"
        ${todo.completed ? 'checked' : ''}
        class="w-5 h-5 rounded border-gray-300 text-jeju-600 focus:ring-jeju-500"
      />
      <div class="flex-1">
        <span class="${todo.completed ? 'line-through text-gray-500' : 'text-gray-900 dark:text-white'}">
          ${escapeHtml(todo.title)}
        </span>
        ${todo.description ? `<p class="text-sm text-gray-500 dark:text-gray-400">${escapeHtml(todo.description)}</p>` : ''}
        ${todo.encryptedData ? '<span class="ml-2 text-xs text-jeju-600">🔒 Encrypted</span>' : ''}
        ${todo.attachmentCid ? '<span class="ml-2 text-xs text-purple-600">📎 Attachment</span>' : ''}
      </div>
      <span class="px-2 py-1 text-xs rounded ${priorityColors[todo.priority]}">
        ${todo.priority}
      </span>
      <div class="flex gap-2">
        ${
          !todo.encryptedData
            ? `
          <button data-encrypt="${todo.id}" class="p-2 text-gray-400 hover:text-jeju-600" title="Encrypt">
            🔐
          </button>
        `
            : ''
        }
        <button data-delete="${todo.id}" class="p-2 text-gray-400 hover:text-red-600" title="Delete">
          🗑️
        </button>
      </div>
    </li>
  `
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ============================================================================
// Event Listeners
// ============================================================================

function attachEventListeners(): void {
  // Connect button
  document.getElementById('connect')?.addEventListener('click', connectWallet)

  // Disconnect button
  document
    .getElementById('disconnect')
    ?.addEventListener('click', disconnectWallet)

  // Form submit with validation
  document
    .getElementById('todo-form')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const input = document.getElementById('todo-input') as HTMLInputElement
      const select = document.getElementById(
        'priority-select',
      ) as HTMLSelectElement

      if (!input || !select) {
        state.error = 'Form elements not found'
        render()
        return
      }

      const title = input.value.trim()
      const priority = select.value

      if (!title) {
        state.error = 'Title is required'
        render()
        return
      }

      await createTodo(title, validatePriority(priority))
      input.value = ''
      state.error = null
    })

  // Filter buttons
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.filter = btn.getAttribute('data-filter') as
        | 'all'
        | 'pending'
        | 'completed'
      await fetchTodos()
    })
  })

  // Toggle checkboxes
  document.querySelectorAll('[data-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', async (e) => {
      const target = e.target as HTMLElement
      const id = target.getAttribute('data-toggle')
      if (!id) return
      const checked = (target as HTMLInputElement).checked
      await toggleTodo(id, checked)
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
}

// ============================================================================
// Account Change Listener
// ============================================================================

const ethereumProvider = getEthereumProvider()
if (ethereumProvider) {
  ethereumProvider.on('accountsChanged', (accounts: string[]) => {
    if (accounts.length > 0) {
      state.address = accounts[0]
      fetchTodos()
    } else {
      disconnectWallet()
    }
  })
}

// ============================================================================
// Initialize
// ============================================================================

render()
