/**
 * Otto Trading Agent - Core Types
 */

import type { Address, Hex } from 'viem'

export type Platform =
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'farcaster'
  | 'twitter'
  | 'web'

export interface PlatformUser {
  platform: Platform
  platformId: string
  username: string
  displayName?: string
  avatarUrl?: string
}

export interface PlatformMessage {
  platform: Platform
  messageId: string
  channelId: string
  userId: string
  content: string
  timestamp: number
  isCommand: boolean
  replyToId?: string
  attachments?: MessageAttachment[]
}

export interface MessageAttachment {
  type: 'image' | 'file' | 'link'
  url: string
  name?: string
  size?: number
}

export interface PlatformChannel {
  platform: Platform
  channelId: string
  name: string
  type: 'dm' | 'group' | 'guild'
  guildId?: string
  guildName?: string
}

// ============================================================================
// User & Wallet Types
// ============================================================================

export interface OttoUser {
  id: string
  platforms: UserPlatformLink[]
  primaryWallet: Address
  smartAccountAddress?: Address
  sessionKeyAddress?: Address
  sessionKeyExpiry?: number
  createdAt: number
  lastActiveAt: number
  settings: UserSettings
  // Farcaster specific
  fid?: number
  farcasterUsername?: string
}

export interface UserPlatformLink {
  platform: Platform
  platformId: string
  username: string
  linkedAt: number
  verified: boolean
}

export interface UserSettings {
  defaultSlippageBps: number
  defaultChainId: number
  notifications: boolean
  maxTradeAmount?: string
  preferredTokens?: Address[]
}

export interface TokenInfo {
  address: Address
  chainId: number
  symbol: string
  name: string
  decimals: number
  logoUrl?: string
  price?: number
  priceChange24h?: number
}

export interface Balance {
  token: TokenInfo
  balance: string
  balanceUsd?: number
}

export interface SwapQuote {
  quoteId: string
  fromToken: TokenInfo
  toToken: TokenInfo
  fromAmount: string
  toAmount: string
  toAmountMin: string
  priceImpact: number
  gasCost: string
  gasCostUsd?: number
  route: SwapRoute[]
  validUntil: number
}

export interface SwapRoute {
  protocol: string
  fromToken: Address
  toToken: Address
  portion: number
}

export interface SwapParams {
  userId: string
  fromToken: Address
  toToken: Address
  amount: string
  slippageBps?: number
  chainId?: number
}

export interface SwapResult {
  success: boolean
  txHash?: Hex
  fromAmount: string
  toAmount: string
  error?: string
}

export interface BridgeQuote {
  quoteId: string
  sourceChainId: number
  destChainId: number
  sourceToken: TokenInfo
  destToken: TokenInfo
  inputAmount: string
  outputAmount: string
  outputAmountMin: string
  fee: string
  feeUsd?: number
  estimatedTimeSeconds: number
  solver: Address
  validUntil: number
}

export interface BridgeParams {
  userId: string
  sourceChainId: number
  destChainId: number
  sourceToken: Address
  destToken: Address
  amount: string
  recipient?: Address
  maxSlippageBps?: number
}

export interface BridgeResult {
  success: boolean
  intentId?: string
  sourceTxHash?: Hex
  destTxHash?: Hex
  status: 'pending' | 'filled' | 'expired' | 'failed'
  error?: string
}

// ============================================================================
// Token Launch Types
// ============================================================================

export interface TokenLaunchParams {
  userId: string
  name: string
  symbol: string
  description?: string
  imageUrl?: string
  initialSupply: string
  initialLiquidity?: string
  chainId?: number
  taxBuyBps?: number
  taxSellBps?: number
  maxWalletBps?: number
}

export interface TokenLaunchResult {
  success: boolean
  tokenAddress?: Address
  poolAddress?: Address
  txHash?: Hex
  error?: string
}

export interface LimitOrder {
  orderId: string
  userId: string
  fromToken: TokenInfo
  toToken: TokenInfo
  fromAmount: string
  targetPrice: string
  chainId: number
  status: 'open' | 'filled' | 'cancelled' | 'expired'
  createdAt: number
  expiresAt?: number
  filledAt?: number
  filledTxHash?: Hex
}

export interface CreateLimitOrderParams {
  userId: string
  fromToken: Address
  toToken: Address
  fromAmount: string
  targetPrice: string
  chainId?: number
  expiresIn?: number
}

export type CommandName =
  | 'help'
  | 'balance'
  | 'price'
  | 'swap'
  | 'bridge'
  | 'send'
  | 'launch'
  | 'portfolio'
  | 'limit'
  | 'orders'
  | 'cancel'
  | 'connect'
  | 'disconnect'
  | 'settings'

export interface ParsedCommand {
  command: CommandName
  args: string[]
  rawArgs: string
  platform: Platform
  userId: string
  channelId: string
}

/** Data types returned from command execution */
export interface CommandResultData {
  quoteId?: string
  url?: string
  txHash?: Hex
  tokenAddress?: Address
  orderId?: string
}

export interface CommandResult {
  success: boolean
  message: string
  embed?: MessageEmbed
  buttons?: MessageButton[]
  error?: string
  data?: CommandResultData
}

export interface MessageEmbed {
  title?: string
  description?: string
  color?: number
  fields?: EmbedField[]
  footer?: string
  timestamp?: number
  imageUrl?: string
  thumbnailUrl?: string
}

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface MessageButton {
  label: string
  style: 'primary' | 'secondary' | 'success' | 'danger' | 'link'
  customId?: string
  url?: string
  disabled?: boolean
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface DiscordWebhookPayload {
  type: number
  token: string
  member?: {
    user: { id: string; username: string }
  }
  user?: { id: string; username: string }
  channel_id: string
  guild_id?: string
  data?: {
    name: string
    options?: Array<{ name: string; value: string | number }>
  }
  message?: {
    id: string
    content: string
    author: { id: string; username: string }
  }
}

export interface TelegramWebhookPayload {
  update_id: number
  message?: {
    message_id: number
    from: { id: number; username?: string; first_name: string }
    chat: { id: number; type: string; title?: string }
    text?: string
    date: number
  }
  callback_query?: {
    id: string
    from: { id: number; username?: string }
    message?: { chat: { id: number } }
    data?: string
  }
}

export interface TwilioWebhookPayload {
  MessageSid: string
  From: string
  To: string
  Body: string
  NumMedia?: string
  MediaUrl0?: string
}

export interface FarcasterFramePayload {
  untrustedData: {
    fid: number
    url: string
    messageHash: string
    timestamp: number
    network: number
    buttonIndex: number
    inputText?: string
    castId?: { fid: number; hash: string }
    state?: string
  }
  trustedData: {
    messageBytes: string
  }
}

export interface TwitterWebhookPayload {
  for_user_id: string
  tweet_create_events?: Array<{
    id_str: string
    text: string
    user: { id_str: string; screen_name: string }
    in_reply_to_status_id_str?: string
    created_at: string
  }>
  direct_message_events?: Array<{
    type: string
    message_create: {
      sender_id: string
      message_data: { text: string }
    }
  }>
}

/** Union of all platform-specific webhook payloads */
export type WebhookPayloadData =
  | DiscordWebhookPayload
  | TelegramWebhookPayload
  | TwilioWebhookPayload
  | FarcasterFramePayload
  | TwitterWebhookPayload

export interface WebhookPayload {
  platform: Platform
  type: string
  data: WebhookPayloadData
  timestamp: number
  signature?: string
}

export interface OttoConfig {
  port: number
  webhookPort: number
  baseUrl: string

  discord: {
    enabled: boolean
    token?: string
    applicationId?: string
    publicKey?: string
  }

  telegram: {
    enabled: boolean
    token?: string
    webhookSecret?: string
  }

  whatsapp: {
    enabled: boolean
    twilioSid?: string
    twilioToken?: string
    phoneNumber?: string
  }

  farcaster: {
    enabled: boolean
    apiKey?: string
    botFid?: number
    signerUuid?: string
  }

  twitter: {
    enabled: boolean
    apiKey?: string
    apiSecret?: string
    accessToken?: string
    accessSecret?: string
    bearerToken?: string
    botUsername?: string
  }

  trading: {
    defaultChainId: number
    defaultSlippageBps: number
    maxSlippageBps: number
    supportedChains: number[]
  }

  ai: {
    enabled: boolean
    modelEndpoint?: string
    modelApiKey?: string
  }
}

// ============================================================================
// State Types
// ============================================================================

export interface OttoState {
  users: Map<string, OttoUser>
  sessions: Map<string, UserSession>
  pendingTxs: Map<string, PendingTransaction>
  limitOrders: Map<string, LimitOrder>
}

export interface UserSession {
  sessionId: string
  userId: string
  platform: Platform
  channelId: string
  context: SessionContext
  lastMessage: number
  expiresAt: number
}

/** Data for a pending swap confirmation */
export interface PendingSwapData {
  quote: SwapQuote
  params: {
    amount: string
    from: string
    to: string
    chainId: number
  }
}

/** Data for a pending bridge confirmation */
export interface PendingBridgeData {
  quote?: BridgeQuote
  params: {
    amount: string
    token: string
    fromChain: string
    toChain: string
    sourceChainId: number
    destChainId: number
  }
}

/** Data for a pending send confirmation */
export interface PendingSendData {
  recipient: Address
  amount: string
  token: string
  chainId: number
}

/** Data for a pending token launch confirmation */
export interface PendingLaunchData {
  name: string
  symbol: string
  initialSupply: string
  initialLiquidity?: string
  chainId: number
}

/** Union of all pending action data types */
export type PendingActionData =
  | PendingSwapData
  | PendingBridgeData
  | PendingSendData
  | PendingLaunchData

/** Discriminated union for awaiting confirmation */
export type AwaitingConfirmation =
  | { type: 'swap'; data: PendingSwapData; expiresAt: number }
  | { type: 'bridge'; data: PendingBridgeData; expiresAt: number }
  | { type: 'send'; data: PendingSendData; expiresAt: number }
  | { type: 'launch'; data: PendingLaunchData; expiresAt: number }

export interface SessionContext {
  awaitingConfirmation?: AwaitingConfirmation
  recentTokens?: Address[]
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}

/** Transaction data by type */
export type TransactionData =
  | { type: 'swap'; details: PendingSwapData }
  | { type: 'bridge'; details: PendingBridgeData }
  | { type: 'send'; details: PendingSendData }
  | { type: 'launch'; details: PendingLaunchData }
  | { type: 'limit'; details: { orderId: string } }

export interface PendingTransaction {
  txId: string
  userId: string
  type: 'swap' | 'bridge' | 'send' | 'launch' | 'limit'
  txHash?: Hex
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
  createdAt: number
  updatedAt: number
  data: PendingActionData | { orderId: string }
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  embed?: MessageEmbed
  buttons?: MessageButton[]
}

export interface ChatSession {
  sessionId: string
  userId: string
  messages: ChatMessage[]
  createdAt: number
  lastActiveAt: number
}

export interface ChatRequest {
  sessionId?: string
  message: string
  userId?: string
  walletAddress?: Address
}

export interface ChatResponse {
  sessionId: string
  message: ChatMessage
  requiresAuth: boolean
  authUrl?: string
}
