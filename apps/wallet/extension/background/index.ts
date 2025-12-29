import { expectAddress, expectHex } from '@jejunetwork/types'
import { type Address, type Hex, isAddress, isHex } from 'viem'
import { z } from 'zod'
import { jnsResolver } from '../../api/services/jns/resolver'
import { expectNonEmpty, expectSchema } from '../../lib/validation'
import { storage } from '../../web/platform/storage'
import type {
  AddEthereumChainParameter,
  BroadcastEventData,
  CrossChainTransferData,
  EIP1193Param,
  ExtensionMessageResponse,
  JNSGatewayStatus,
  JNSResolution,
  JNSResolverSettings,
  SubmitIntentData,
} from '../types'

/** Type assertion to narrow string to Hex after validation */
function asHex(value: string): Hex {
  if (!value.startsWith('0x')) {
    throw new Error(`Expected hex string starting with 0x, got: ${value}`)
  }
  return value as Hex
}

/** Type assertion to narrow string to Address after validation */
function asAddress(value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`Invalid address: ${value}`)
  }
  return value
}

/** Returns value if defined, throws if null/undefined */
function requireDefined<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${name} is required`)
  }
  return value
}

const MessageTypeSchema = z.enum([
  'connect',
  'disconnect',
  'eth_requestAccounts',
  'eth_accounts',
  'eth_chainId',
  'eth_sendTransaction',
  'eth_signTypedData_v4',
  'personal_sign',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'jeju_crossChainTransfer',
  'jeju_submitIntent',
  // JNS message types
  'jns_getSettings',
  'jns_updateSettings',
  'jns_resolve',
  'jns_clearCache',
  'jns_getStatus',
])

// EIP1193Param is already typed, we validate the structure at runtime
const EIP1193ParamSchema: z.ZodType<EIP1193Param> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.string(), EIP1193ParamSchema),
    z.array(EIP1193ParamSchema),
  ]),
)

const MessageDataSchema = z.record(z.string(), EIP1193ParamSchema)

const MessageSchema = z.object({
  type: MessageTypeSchema,
  data: MessageDataSchema.optional(),
  id: z.string().optional(),
})

const WalletStateSchema = z.object({
  isLocked: z.boolean(),
  accounts: z.array(
    z.string().refine((val) => isAddress(val), { error: 'Invalid address' }),
  ),
  chainId: z.string().refine((val) => /^0x[0-9a-fA-F]+$/.test(val), {
    error: 'Invalid chainId hex',
  }),
  connectedSites: z.array(z.string().min(1)),
})

const SendTransactionDataSchema = z.object({
  to: z
    .string()
    .refine((val) => isAddress(val), { error: 'Invalid to address' }),
  value: z.string().optional(),
  data: z
    .string()
    .refine((val) => isHex(val), { error: 'Invalid data hex' })
    .optional(),
  gas: z.string().optional(),
  gasPrice: z.string().optional(),
})

const PersonalSignDataSchema = z.object({
  message: z.string().min(1),
  address: z
    .string()
    .refine((val) => isAddress(val), { error: 'Invalid address' }),
})

const SignTypedDataSchema = z.object({
  address: z
    .string()
    .refine((val) => isAddress(val), { error: 'Invalid address' }),
  data: z.string().min(1),
})

const SwitchChainDataSchema = z.object({
  chainId: z.string().refine((val) => /^0x[0-9a-fA-F]+$/.test(val), {
    error: 'Invalid chainId hex',
  }),
})

const PopupResponseSchema = z.object({
  type: z.literal('popup_response'),
  requestId: z.string().uuid(),
  approved: z.boolean(),
  hash: z
    .string()
    .refine((val) => isHex(val), { error: 'Invalid hash hex' })
    .optional(),
  signature: z
    .string()
    .refine((val) => isHex(val), { error: 'Invalid signature hex' })
    .optional(),
  intentId: z
    .string()
    .refine((val) => isHex(val), { error: 'Invalid intentId hex' })
    .optional(),
})

const ConnectionResponseSchema = z.object({
  type: z.literal('connection_response'),
  origin: z.string().min(1),
  approved: z.boolean(),
})

// EIP-3085: wallet_addEthereumChain parameters
const AddEthereumChainSchema = z.object({
  chainId: z.string().refine((val) => /^0x[0-9a-fA-F]+$/.test(val), {
    message: 'Invalid chainId hex',
  }),
  chainName: z.string().min(1),
  nativeCurrency: z.object({
    name: z.string().min(1),
    symbol: z.string().min(2).max(6),
    decimals: z.literal(18),
  }),
  rpcUrls: z.array(z.string().url()).min(1),
  blockExplorerUrls: z.array(z.string().url()).optional(),
  iconUrls: z.array(z.string().url()).optional(),
})

// Jeju cross-chain transfer parameters
const CrossChainTransferSchema = z.object({
  sourceChainId: z.number().int().positive(),
  destinationChainId: z.number().int().positive(),
  token: z
    .string()
    .refine((val) => isAddress(val), { message: 'Invalid token address' }),
  amount: z.string().min(1),
  recipient: z
    .string()
    .refine((val) => isAddress(val), { message: 'Invalid recipient address' }),
  maxFee: z.string().optional(),
})

// Jeju intent submission parameters
const SubmitIntentSchema = z.object({
  inputToken: z
    .string()
    .refine((val) => isAddress(val), { message: 'Invalid inputToken address' }),
  inputAmount: z.string().min(1),
  outputToken: z.string().refine((val) => isAddress(val), {
    message: 'Invalid outputToken address',
  }),
  minOutputAmount: z.string().min(1),
  destinationChainId: z.number().int().positive(),
  recipient: z
    .string()
    .refine((val) => isAddress(val), { message: 'Invalid recipient address' })
    .optional(),
  maxFee: z.string().optional(),
  deadline: z.number().int().positive().optional(),
})

type Message = z.infer<typeof MessageSchema>
type WalletState = z.infer<typeof WalletStateSchema>

// Initialize wallet state
const defaultState: WalletState = {
  isLocked: true,
  accounts: [],
  chainId: '0x2105', // Base mainnet
  connectedSites: [],
}

let walletState: WalletState = { ...defaultState }

// Load state on startup
async function loadState(): Promise<void> {
  const saved = await storage.getJSON('wallet_state', WalletStateSchema)
  if (saved) {
    walletState = { ...defaultState, ...saved }
  }
}

async function saveState(): Promise<void> {
  await storage.setJSON('wallet_state', walletState)
}

// Handle messages from content script
chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    const validatedMessage = expectSchema(message, MessageSchema, 'message')
    const origin = expectNonEmpty(sender.origin ?? '', 'sender.origin')

    handleMessage(validatedMessage, origin)
      .then(sendResponse)
      .catch((error: Error) => sendResponse({ error: error.message }))
    return true // Keep channel open for async response
  },
)

async function handleMessage(
  message: Message,
  origin: string,
): Promise<ExtensionMessageResponse> {
  expectNonEmpty(origin, 'origin')

  switch (message.type) {
    case 'eth_requestAccounts':
      return handleRequestAccounts(origin)

    case 'eth_accounts':
      return handleGetAccounts(origin)

    case 'eth_chainId':
      return walletState.chainId

    case 'eth_sendTransaction': {
      const data = requireDefined(message.data, 'message.data')
      const validated = expectSchema(
        data,
        SendTransactionDataSchema,
        'eth_sendTransaction data',
      )
      return handleSendTransaction(validated)
    }

    case 'personal_sign': {
      const data = requireDefined(message.data, 'message.data')
      const validated = expectSchema(
        data,
        PersonalSignDataSchema,
        'personal_sign data',
      )
      return handlePersonalSign(validated)
    }

    case 'eth_signTypedData_v4': {
      const data = requireDefined(message.data, 'message.data')
      const validated = expectSchema(
        data,
        SignTypedDataSchema,
        'eth_signTypedData_v4 data',
      )
      return handleSignTypedData(validated)
    }

    case 'wallet_switchEthereumChain': {
      const data = requireDefined(message.data, 'message.data')
      const validated = expectSchema(
        data,
        SwitchChainDataSchema,
        'wallet_switchEthereumChain data',
      )
      return handleSwitchChain(validated)
    }

    case 'wallet_addEthereumChain': {
      const data = requireDefined(message.data, 'message.data')
      const validated = expectSchema(
        data,
        AddEthereumChainSchema,
        'wallet_addEthereumChain data',
      )
      // Convert validated schema to typed interface
      const chainParam: AddEthereumChainParameter = {
        ...validated,
        chainId: asHex(validated.chainId),
      }
      return handleAddChain(chainParam)
    }

    case 'jeju_crossChainTransfer': {
      const data = requireDefined(message.data, 'message.data')
      const validated = expectSchema(
        data,
        CrossChainTransferSchema,
        'jeju_crossChainTransfer data',
      )
      // Convert validated schema to typed interface
      const transferData: CrossChainTransferData = {
        ...validated,
        token: asAddress(validated.token),
        recipient: asAddress(validated.recipient),
      }
      return handleCrossChainTransfer(transferData)
    }

    case 'jeju_submitIntent': {
      const data = requireDefined(message.data, 'message.data')
      const validated = expectSchema(
        data,
        SubmitIntentSchema,
        'jeju_submitIntent data',
      )
      // Convert validated schema to typed interface
      const intentData: SubmitIntentData = {
        ...validated,
        inputToken: asAddress(validated.inputToken),
        outputToken: asAddress(validated.outputToken),
        recipient: validated.recipient
          ? asAddress(validated.recipient)
          : undefined,
      }
      return handleSubmitIntent(intentData)
    }

    case 'connect':
      return handleConnect(origin)

    case 'disconnect':
      return handleDisconnect(origin)

    // JNS handlers
    case 'jns_getSettings':
      return handleJnsGetSettings()

    case 'jns_updateSettings': {
      const data = requireDefined(message.data, 'message.data')
      return handleJnsUpdateSettings(data as Partial<JNSResolverSettings>)
    }

    case 'jns_resolve': {
      const data = requireDefined(message.data, 'message.data')
      const domain = data.domain as string
      return handleJnsResolve(domain)
    }

    case 'jns_clearCache':
      return handleJnsClearCache()

    case 'jns_getStatus':
      return handleJnsGetStatus()

    default:
      throw new Error(`Unknown message type: ${message.type}`)
  }
}

async function handleRequestAccounts(origin: string): Promise<string[]> {
  expectNonEmpty(origin, 'origin')

  if (walletState.isLocked) {
    // Open popup to unlock
    await openPopup('unlock')
    throw new Error('Wallet is locked')
  }

  if (!walletState.connectedSites.includes(origin)) {
    // Open popup to approve connection
    await openPopup('connect', { origin })
    // Wait for user approval
    return new Promise((resolve, reject) => {
      const listener = (msg: unknown) => {
        const validated = expectSchema(
          msg,
          ConnectionResponseSchema,
          'connection_response',
        )
        if (validated.origin === origin) {
          chrome.runtime.onMessage.removeListener(listener)
          if (validated.approved) {
            walletState.connectedSites.push(origin)
            saveState()
            resolve(walletState.accounts)
          } else {
            reject(new Error('User rejected connection'))
          }
        }
      }
      chrome.runtime.onMessage.addListener(listener)
    })
  }

  return walletState.accounts
}

async function handleGetAccounts(origin: string): Promise<string[]> {
  if (walletState.isLocked || !walletState.connectedSites.includes(origin)) {
    return []
  }
  return walletState.accounts
}

async function handleConnect(origin: string): Promise<boolean> {
  expectNonEmpty(origin, 'origin')

  if (!walletState.connectedSites.includes(origin)) {
    walletState.connectedSites.push(origin)
    await saveState()
  }
  return true
}

async function handleDisconnect(origin: string): Promise<boolean> {
  expectNonEmpty(origin, 'origin')

  walletState.connectedSites = walletState.connectedSites.filter(
    (s) => s !== origin,
  )
  await saveState()
  return true
}

async function handleSendTransaction(
  tx: z.infer<typeof SendTransactionDataSchema>,
): Promise<Hex> {
  expectAddress(tx.to, 'tx.to')
  if (tx.data) {
    expectHex(tx.data, 'tx.data')
  }

  // Open popup for transaction approval
  const result = await openPopupWithResult('transaction', { tx })
  if (!result.approved) {
    throw new Error('User rejected transaction')
  }

  const hash = requireDefined(result.hash, 'result.hash')
  return hash
}

async function handlePersonalSign(
  data: z.infer<typeof PersonalSignDataSchema>,
): Promise<Hex> {
  expectNonEmpty(data.message, 'data.message')
  expectAddress(data.address, 'data.address')

  const result = await openPopupWithResult('sign', {
    type: 'personal_sign',
    message: data.message,
    address: asAddress(data.address),
  })
  if (!result.approved) {
    throw new Error('User rejected signature')
  }

  const signature = requireDefined(result.signature, 'result.signature')
  return signature
}

async function handleSignTypedData(
  data: z.infer<typeof SignTypedDataSchema>,
): Promise<Hex> {
  expectAddress(data.address, 'data.address')
  expectNonEmpty(data.data, 'data.data')

  const result = await openPopupWithResult('sign', {
    type: 'eth_signTypedData_v4',
    data: data.data,
    address: asAddress(data.address),
  })
  if (!result.approved) {
    throw new Error('User rejected signature')
  }

  const signature = requireDefined(result.signature, 'result.signature')
  return signature
}

async function handleSwitchChain(
  data: z.infer<typeof SwitchChainDataSchema>,
): Promise<null> {
  expectNonEmpty(data.chainId, 'data.chainId')
  if (!/^0x[0-9a-fA-F]+$/.test(data.chainId)) {
    throw new Error(`Invalid chainId format: ${data.chainId}`)
  }

  walletState.chainId = data.chainId
  await saveState()

  // Notify all connected tabs
  broadcastToTabs({ type: 'chainChanged', chainId: asHex(data.chainId) })

  return null
}

async function handleAddChain(
  chainData: AddEthereumChainParameter,
): Promise<null> {
  // Open popup to approve adding chain
  const result = await openPopupWithResult('add_chain', chainData)
  if (!result.approved) {
    throw new Error('User rejected adding chain')
  }
  return null
}

async function handleCrossChainTransfer(
  data: CrossChainTransferData,
): Promise<Hex> {
  const result = await openPopupWithResult('cross_chain', data)
  if (!result.approved) {
    throw new Error('User rejected cross-chain transfer')
  }

  const requestId = requireDefined(result.requestId, 'result.requestId')
  return asHex(requestId)
}

async function handleSubmitIntent(data: SubmitIntentData): Promise<Hex> {
  const result = await openPopupWithResult('intent', data)
  if (!result.approved) {
    throw new Error('User rejected intent')
  }

  const intentId = requireDefined(result.intentId, 'result.intentId')
  return intentId
}

// JNS Handler Functions

async function handleJnsGetSettings(): Promise<JNSResolverSettings> {
  await jnsResolver.init()
  return jnsResolver.getSettings()
}

async function handleJnsUpdateSettings(
  settings: Partial<JNSResolverSettings>,
): Promise<JNSResolverSettings> {
  await jnsResolver.init()
  return jnsResolver.updateSettings(settings)
}

async function handleJnsResolve(domain: string): Promise<JNSResolution | null> {
  await jnsResolver.init()
  return jnsResolver.resolve(domain)
}

async function handleJnsClearCache(): Promise<{ success: boolean }> {
  await jnsResolver.init()
  await jnsResolver.clearCache()
  return { success: true }
}

async function handleJnsGetStatus(): Promise<JNSGatewayStatus> {
  await jnsResolver.init()
  return jnsResolver.checkStatus()
}

/** Popup parameter types */
type PopupParams =
  | { origin: string }
  | { tx: z.infer<typeof SendTransactionDataSchema> }
  | { type: 'personal_sign'; message: string; address: Address }
  | { type: 'eth_signTypedData_v4'; data: string; address: Address }
  | AddEthereumChainParameter
  | CrossChainTransferData
  | SubmitIntentData

/** Result from popup user interaction */
interface PopupResult {
  approved: boolean
  hash?: Hex
  signature?: Hex
  requestId?: string
  intentId?: Hex
}

/** Message with type field for runtime checks */
interface TypedMessage {
  type: unknown
}

// Track pending popup requests to prevent reentrancy
const pendingPopupRequests = new Map<
  string,
  {
    resolve: (result: PopupResult) => void
    windowId?: number
    createdAt: number
  }
>()

// Popup timeout (5 minutes)
const POPUP_TIMEOUT_MS = 5 * 60 * 1000

// Maximum concurrent popup requests per type to prevent DoS
const MAX_PENDING_POPUPS = 10

// Popup management
async function openPopup(path: string, params?: PopupParams): Promise<void> {
  expectNonEmpty(path, 'path')

  const url = new URL(chrome.runtime.getURL('popup.html'))
  url.hash = `/${path}`
  if (params) {
    url.searchParams.set('data', JSON.stringify(params))
  }

  await chrome.windows.create({
    url: url.toString(),
    type: 'popup',
    width: 420,
    height: 680,
    focused: true,
  })
}

async function openPopupWithResult(
  path: string,
  params: PopupParams,
): Promise<PopupResult> {
  expectNonEmpty(path, 'path')

  // Prevent too many pending requests (DoS protection)
  if (pendingPopupRequests.size >= MAX_PENDING_POPUPS) {
    // Clean up old timed-out requests first
    const now = Date.now()
    for (const [reqId, req] of pendingPopupRequests) {
      if (now - req.createdAt > POPUP_TIMEOUT_MS) {
        req.resolve({ approved: false })
        pendingPopupRequests.delete(reqId)
      }
    }

    // If still too many, reject
    if (pendingPopupRequests.size >= MAX_PENDING_POPUPS) {
      throw new Error('Too many pending approval requests')
    }
  }

  const requestId = crypto.randomUUID()
  const url = new URL(chrome.runtime.getURL('popup.html'))
  url.hash = `/${path}`
  url.searchParams.set('requestId', requestId)
  url.searchParams.set('data', JSON.stringify(params))

  const window = await chrome.windows.create({
    url: url.toString(),
    type: 'popup',
    width: 420,
    height: 680,
    focused: true,
  })

  return new Promise((resolve) => {
    // Store the pending request
    pendingPopupRequests.set(requestId, {
      resolve,
      windowId: window.id,
      createdAt: Date.now(),
    })

    // Set up timeout to prevent hanging promises
    const timeoutId = setTimeout(() => {
      if (pendingPopupRequests.has(requestId)) {
        pendingPopupRequests.delete(requestId)
        chrome.runtime.onMessage.removeListener(listener)
        resolve({ approved: false })
      }
    }, POPUP_TIMEOUT_MS)

    const listener = (msg: unknown) => {
      // Only process if it matches the expected schema and request ID
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return
      const typed = msg as TypedMessage
      if (typed.type !== 'popup_response') return

      const validated = expectSchema(msg, PopupResponseSchema, 'popup_response')
      if (validated.requestId === requestId) {
        clearTimeout(timeoutId)
        chrome.runtime.onMessage.removeListener(listener)
        pendingPopupRequests.delete(requestId)
        resolve({
          approved: validated.approved,
          hash: validated.hash ? asHex(validated.hash) : undefined,
          signature: validated.signature
            ? asHex(validated.signature)
            : undefined,
          requestId: validated.requestId,
          intentId: validated.intentId ? asHex(validated.intentId) : undefined,
        })
      }
    }
    chrome.runtime.onMessage.addListener(listener)
  })
}

function broadcastToTabs(message: BroadcastEventData): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message)
      }
    }
  })
}

// Initialize
loadState()

// Keep service worker alive (MV3)
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(() => {
  // Periodic check to keep service worker active
})

// Background script initialized
