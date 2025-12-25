/**
 * Otto Zod Schemas
 */

import {
  AddressSchema,
  ChainIdSchema,
  expectValid,
  HexSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

export const PlatformSchema = z.enum([
  'discord',
  'telegram',
  'whatsapp',
  'farcaster',
  'twitter',
  'web',
])

export const PlatformUserSchema = z.object({
  platform: PlatformSchema,
  platformId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
})

export const MessageAttachmentSchema = z.object({
  type: z.enum(['image', 'file', 'link']),
  url: z.string().url(),
  name: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
})

export const PlatformMessageSchema = z.object({
  platform: PlatformSchema,
  messageId: z.string().min(1),
  channelId: z.string().min(1),
  userId: z.string().min(1),
  content: z.string(),
  timestamp: z.number().int().nonnegative(),
  isCommand: z.boolean(),
  replyToId: z.string().optional(),
  attachments: z.array(MessageAttachmentSchema).default([]),
})

export const PlatformChannelSchema = z.object({
  platform: PlatformSchema,
  channelId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['dm', 'group', 'guild']),
  guildId: z.string().optional(),
  guildName: z.string().optional(),
})

// User & Wallet

export const UserPlatformLinkSchema = z.object({
  platform: PlatformSchema,
  platformId: z.string().min(1),
  username: z.string().min(1),
  linkedAt: z.number().int().nonnegative(),
  verified: z.boolean(),
})

export const UserSettingsSchema = z.object({
  defaultSlippageBps: z.number().int().min(0).max(10000),
  defaultChainId: ChainIdSchema,
  notifications: z.boolean(),
  maxTradeAmount: z.string().optional(),
  preferredTokens: z.array(AddressSchema).default([]),
})

export const OttoUserSchema = z.object({
  id: z.string().min(1),
  platforms: z.array(UserPlatformLinkSchema).min(1),
  primaryWallet: AddressSchema,
  smartAccountAddress: AddressSchema.optional(),
  sessionKeyAddress: AddressSchema.optional(),
  sessionKeyExpiry: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
  lastActiveAt: z.number().int().nonnegative(),
  settings: UserSettingsSchema,
  fid: z.number().int().positive().optional(),
  farcasterUsername: z.string().optional(),
})

export const TokenInfoSchema = z.object({
  address: AddressSchema,
  chainId: ChainIdSchema,
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals: z.number().int().min(0).max(255),
  logoUrl: z.string().url().optional(),
  price: z.number().nonnegative().optional(),
  priceChange24h: z.number().optional(),
})

export const BalanceSchema = z.object({
  token: TokenInfoSchema,
  balance: z.string().regex(/^\d+$/),
  balanceUsd: z.number().nonnegative().optional(),
})

export const SwapRouteSchema = z.object({
  protocol: z.string().min(1),
  fromToken: AddressSchema,
  toToken: AddressSchema,
  portion: z.number().min(0).max(1),
})

export const SwapQuoteSchema = z.object({
  quoteId: z.string().min(1),
  fromToken: TokenInfoSchema,
  toToken: TokenInfoSchema,
  fromAmount: z.string().regex(/^\d+$/),
  toAmount: z.string().regex(/^\d+$/),
  toAmountMin: z.string().regex(/^\d+$/),
  priceImpact: z.number(),
  gasCost: z.string().regex(/^\d+$/),
  gasCostUsd: z.number().nonnegative().optional(),
  route: z.array(SwapRouteSchema),
  validUntil: z.number().int().positive(),
})

export const SwapParamsSchema = z.object({
  userId: z.string().min(1),
  fromToken: AddressSchema,
  toToken: AddressSchema,
  amount: z.string().regex(/^\d+$/),
  slippageBps: z.number().int().min(0).max(10000).optional(),
  chainId: ChainIdSchema.optional(),
})

export const SwapResultSchema = z.object({
  success: z.boolean(),
  txHash: HexSchema.optional(),
  fromAmount: z.string().regex(/^\d+$/),
  toAmount: z.string().regex(/^\d+$/),
  error: z.string().optional(),
})

// Bridge

export const BridgeQuoteSchema = z.object({
  quoteId: z.string().min(1),
  sourceChainId: ChainIdSchema,
  destChainId: ChainIdSchema,
  sourceToken: TokenInfoSchema,
  destToken: TokenInfoSchema,
  inputAmount: z.string().regex(/^\d+$/),
  outputAmount: z.string().regex(/^\d+$/),
  outputAmountMin: z.string().regex(/^\d+$/),
  fee: z.string().regex(/^\d+$/),
  feeUsd: z.number().nonnegative().optional(),
  estimatedTimeSeconds: z.number().int().positive(),
  solver: AddressSchema,
  validUntil: z.number().int().positive(),
})

export const BridgeParamsSchema = z.object({
  userId: z.string().min(1),
  sourceChainId: ChainIdSchema,
  destChainId: ChainIdSchema,
  sourceToken: AddressSchema,
  destToken: AddressSchema,
  amount: z.string().regex(/^\d+$/),
  recipient: AddressSchema.optional(),
  maxSlippageBps: z.number().int().min(0).max(10000).optional(),
})

export const BridgeResultSchema = z.object({
  success: z.boolean(),
  intentId: z.string().optional(),
  sourceTxHash: HexSchema.optional(),
  destTxHash: HexSchema.optional(),
  status: z.enum(['pending', 'filled', 'expired', 'failed']),
  error: z.string().optional(),
})

export const TokenLaunchParamsSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(100),
  symbol: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9]+$/),
  description: z.string().max(1000).optional(),
  imageUrl: z.string().url().optional(),
  initialSupply: z.string().regex(/^\d+$/),
  initialLiquidity: z.string().regex(/^\d+$/).optional(),
  chainId: ChainIdSchema.optional(),
  taxBuyBps: z.number().int().min(0).max(10000).optional(),
  taxSellBps: z.number().int().min(0).max(10000).optional(),
  maxWalletBps: z.number().int().min(0).max(10000).optional(),
})

export const TokenLaunchResultSchema = z.object({
  success: z.boolean(),
  tokenAddress: AddressSchema.optional(),
  poolAddress: AddressSchema.optional(),
  txHash: HexSchema.optional(),
  error: z.string().optional(),
})

// Limit Orders

export const LimitOrderSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  fromToken: TokenInfoSchema,
  toToken: TokenInfoSchema,
  fromAmount: z.string().regex(/^\d+$/),
  targetPrice: z.string().regex(/^\d+(\.\d+)?$/),
  chainId: ChainIdSchema,
  status: z.enum(['open', 'filled', 'cancelled', 'expired']),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive().optional(),
  filledAt: z.number().int().nonnegative().optional(),
  filledTxHash: HexSchema.optional(),
})

export const CreateLimitOrderParamsSchema = z.object({
  userId: z.string().min(1),
  fromToken: AddressSchema,
  toToken: AddressSchema,
  fromAmount: z.string().regex(/^\d+$/),
  targetPrice: z.string().regex(/^\d+(\.\d+)?$/),
  chainId: ChainIdSchema.optional(),
  expiresIn: z.number().int().positive().optional(),
})

// Commands

export const CommandNameSchema = z.enum([
  'help',
  'balance',
  'price',
  'swap',
  'bridge',
  'send',
  'launch',
  'portfolio',
  'limit',
  'orders',
  'cancel',
  'connect',
  'disconnect',
  'settings',
])

export const ParsedCommandSchema = z.object({
  command: CommandNameSchema,
  args: z.array(z.string()),
  rawArgs: z.string(),
  platform: PlatformSchema,
  userId: z.string().min(1),
  channelId: z.string().min(1),
})

export const EmbedFieldSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  inline: z.boolean().default(false),
})

export const MessageEmbedSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  color: z.number().int().optional(),
  fields: z.array(EmbedFieldSchema).default([]),
  footer: z.string().optional(),
  timestamp: z.number().int().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
})

export const MessageButtonSchema = z.object({
  label: z.string().min(1),
  style: z.enum(['primary', 'secondary', 'success', 'danger', 'link']),
  customId: z.string().optional(),
  url: z.string().url().optional(),
  disabled: z.boolean().default(false),
})

export const CommandResultDataSchema = z.object({
  quoteId: z.string().optional(),
  url: z.string().optional(),
  txHash: HexSchema.optional(),
  tokenAddress: AddressSchema.optional(),
  orderId: z.string().optional(),
})

export const CommandResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  embed: MessageEmbedSchema.optional(),
  buttons: z.array(MessageButtonSchema).default([]),
  error: z.string().optional(),
  data: CommandResultDataSchema.optional(),
})

// Webhooks

export const DiscordWebhookPayloadSchema = z.object({
  type: z.number().int(),
  token: z.string().min(1),
  member: z
    .object({
      user: z.object({
        id: z.string().min(1),
        username: z.string().min(1),
      }),
    })
    .optional(),
  user: z
    .object({
      id: z.string().min(1),
      username: z.string().min(1),
    })
    .optional(),
  channel_id: z.string().min(1),
  guild_id: z.string().optional(),
  data: z
    .object({
      name: z.string().min(1),
      options: z
        .array(
          z.object({
            name: z.string().min(1),
            value: z.union([z.string(), z.number()]),
          }),
        )
        .optional(),
    })
    .optional(),
  message: z
    .object({
      id: z.string().min(1),
      content: z.string(),
      author: z.object({
        id: z.string().min(1),
        username: z.string().min(1),
      }),
    })
    .optional(),
})

export const TelegramWebhookPayloadSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z
    .object({
      message_id: z.number().int().positive(),
      from: z.object({
        id: z.number().int(),
        username: z.string().optional(),
        first_name: z.string().min(1),
      }),
      chat: z.object({
        id: z.number().int(),
        type: z.string().min(1),
        title: z.string().optional(),
      }),
      text: z.string().optional(),
      date: z.number().int().nonnegative(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string().min(1),
      from: z.object({
        id: z.number().int(),
        username: z.string().optional(),
      }),
      message: z
        .object({
          chat: z.object({
            id: z.number().int(),
          }),
        })
        .optional(),
      data: z.string().optional(),
    })
    .optional(),
})

export const TwilioWebhookPayloadSchema = z.object({
  MessageSid: z.string().min(1),
  From: z.string().min(1),
  To: z.string().min(1),
  Body: z.string(),
  NumMedia: z.string().optional(),
  MediaUrl0: z.string().url().optional(),
})

export const FarcasterFramePayloadSchema = z.object({
  untrustedData: z.object({
    fid: z.number().int().positive(),
    url: z.string().url(),
    messageHash: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    network: z.number().int(),
    buttonIndex: z.number().int().positive(),
    inputText: z.string().optional(),
    castId: z
      .object({
        fid: z.number().int().positive(),
        hash: z.string().min(1),
      })
      .optional(),
    state: z.string().optional(),
  }),
  trustedData: z.object({
    messageBytes: z.string().min(1),
  }),
})

export const TwitterWebhookPayloadSchema = z.object({
  for_user_id: z.string().min(1),
  tweet_create_events: z
    .array(
      z.object({
        id_str: z.string().min(1),
        text: z.string(),
        user: z.object({
          id_str: z.string().min(1),
          screen_name: z.string().min(1),
        }),
        in_reply_to_status_id_str: z.string().optional(),
        created_at: z.string(),
      }),
    )
    .optional(),
  direct_message_events: z
    .array(
      z.object({
        type: z.string().min(1),
        message_create: z.object({
          sender_id: z.string().min(1),
          message_data: z.object({
            text: z.string(),
          }),
        }),
      }),
    )
    .optional(),
})

export const WebhookPayloadDataSchema = z.union([
  DiscordWebhookPayloadSchema,
  TelegramWebhookPayloadSchema,
  TwilioWebhookPayloadSchema,
  FarcasterFramePayloadSchema,
  TwitterWebhookPayloadSchema,
])

export const WebhookPayloadSchema = z.object({
  platform: PlatformSchema,
  type: z.string().min(1),
  data: WebhookPayloadDataSchema,
  timestamp: z.number().int().nonnegative(),
  signature: z.string().optional(),
})

// Config

export const OttoConfigSchema = z.object({
  port: z.number().int().positive(),
  webhookPort: z.number().int().positive(),
  baseUrl: z.string().url(),
  discord: z.object({
    enabled: z.boolean(),
    token: z.string().optional(),
    applicationId: z.string().optional(),
    publicKey: z.string().optional(),
  }),
  telegram: z.object({
    enabled: z.boolean(),
    token: z.string().optional(),
    webhookSecret: z.string().optional(),
  }),
  whatsapp: z.object({
    enabled: z.boolean(),
    twilioSid: z.string().optional(),
    twilioToken: z.string().optional(),
    phoneNumber: z.string().optional(),
  }),
  farcaster: z.object({
    enabled: z.boolean(),
    apiKey: z.string().optional(),
    botFid: z.number().int().nonnegative().optional(),
    signerUuid: z.string().optional(),
  }),
  twitter: z.object({
    enabled: z.boolean(),
    apiKey: z.string().optional(),
    apiSecret: z.string().optional(),
    accessToken: z.string().optional(),
    accessSecret: z.string().optional(),
    bearerToken: z.string().optional(),
    botUsername: z.string().optional(),
  }),
  trading: z.object({
    defaultChainId: ChainIdSchema,
    defaultSlippageBps: z.number().int().min(0).max(10000),
    maxSlippageBps: z.number().int().min(0).max(10000),
    supportedChains: z.array(ChainIdSchema).min(1),
  }),
  ai: z.object({
    enabled: z.boolean(),
    modelEndpoint: z.string().url().optional(),
    modelApiKey: z.string().optional(),
  }),
})

// State
export const PendingSwapDataSchema = z.object({
  quote: SwapQuoteSchema,
  params: z.object({
    amount: z.string(),
    from: z.string(),
    to: z.string(),
    chainId: z.number().int(),
  }),
})

export const PendingBridgeDataSchema = z.object({
  quote: BridgeQuoteSchema.optional(),
  params: z.object({
    amount: z.string(),
    token: z.string(),
    fromChain: z.string(),
    toChain: z.string(),
    sourceChainId: z.number().int(),
    destChainId: z.number().int(),
  }),
})

export const PendingSendDataSchema = z.object({
  recipient: AddressSchema,
  amount: z.string(),
  token: z.string(),
  chainId: z.number().int(),
})

export const PendingLaunchDataSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  initialSupply: z.string(),
  initialLiquidity: z.string().optional(),
  chainId: z.number().int(),
})

export const AwaitingConfirmationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('swap'),
    data: PendingSwapDataSchema,
    expiresAt: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('bridge'),
    data: PendingBridgeDataSchema,
    expiresAt: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('send'),
    data: PendingSendDataSchema,
    expiresAt: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('launch'),
    data: PendingLaunchDataSchema,
    expiresAt: z.number().int().positive(),
  }),
])

export const SessionContextSchema = z.object({
  awaitingConfirmation: AwaitingConfirmationSchema.optional(),
  recentTokens: z.array(AddressSchema).default([]),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .default([]),
})

export const UserSessionSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  platform: PlatformSchema,
  channelId: z.string().min(1),
  context: SessionContextSchema,
  lastMessage: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
})

export const PendingTransactionDataSchema = z.union([
  PendingSwapDataSchema,
  PendingBridgeDataSchema,
  PendingSendDataSchema,
  PendingLaunchDataSchema,
  z.object({ orderId: z.string() }),
])

export const PendingTransactionSchema = z.object({
  txId: z.string().min(1),
  userId: z.string().min(1),
  type: z.enum(['swap', 'bridge', 'send', 'launch', 'limit']),
  txHash: HexSchema.optional(),
  status: z.enum(['pending', 'submitted', 'confirmed', 'failed']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  data: PendingTransactionDataSchema,
})

// Chat API

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.number().int().nonnegative(),
  embed: MessageEmbedSchema.optional(),
  buttons: z.array(MessageButtonSchema).default([]),
})

export const ChatSessionSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  messages: z.array(ChatMessageSchema),
  createdAt: z.number().int().nonnegative(),
  lastActiveAt: z.number().int().nonnegative(),
})

export const ChatRequestSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1),
  userId: z.string().optional(),
  walletAddress: AddressSchema.optional(),
})

export const ChatResponseSchema = z.object({
  sessionId: z.string().min(1),
  message: ChatMessageSchema,
  requiresAuth: z.boolean(),
  authUrl: z.string().url().optional(),
})

// Auth

export const AuthVerifyRequestSchema = z.object({
  address: AddressSchema,
  message: z.string().min(1),
  signature: HexSchema,
  sessionId: z.string().min(1),
})

export const AuthMessageResponseSchema = z.object({
  message: z.string().min(1),
  nonce: z.string().min(1),
})

// Validation Helpers
export function validateOrNull<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context?: string,
): T | null {
  const result = schema.safeParse(data)

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((err) => `${err.path.join('.')}: ${err.message}`)
      .join(', ')

    const contextMsg = context ? `[${context}] ` : ''
    console.warn(
      `${contextMsg}Validation failed (returning null): ${errorDetails}`,
    )
    return null
  }

  return result.data
}

export function expectValidArray<T>(
  schema: z.ZodType<T>,
  items: unknown[],
  context?: string,
): T[] {
  return items.map((item, index) =>
    expectValid(schema, item, context ? `${context}[${index}]` : `[${index}]`),
  )
}

// External API Responses

export const ExternalTokenInfoResponseSchema = z.object({
  data: z
    .object({
      token: TokenInfoSchema.optional(),
    })
    .optional(),
})

export const ExternalBalancesResponseSchema = z.object({
  data: z
    .object({
      balances: z.array(BalanceSchema).default([]),
    })
    .default({ balances: [] }),
})

export const ExternalSwapExecuteResponseSchema = z.object({
  txHash: HexSchema,
  toAmount: z.string().regex(/^\d+$/),
})

export const ExternalBridgeExecuteResponseSchema = z.object({
  intentId: z.string().min(1),
  sourceTxHash: HexSchema,
})

export const ExternalBridgeStatusResponseSchema = z.object({
  status: z.enum(['open', 'pending', 'filled', 'expired']),
  sourceTxHash: HexSchema.optional(),
  destinationTxHash: HexSchema.optional(),
})

export const ExternalTokenLaunchResponseSchema = z.object({
  tokenAddress: AddressSchema,
  poolAddress: AddressSchema,
  txHash: HexSchema,
})

export const ExternalTransferResponseSchema = z.object({
  txHash: HexSchema,
})

export const ExternalSmartAccountResponseSchema = z.object({
  address: AddressSchema,
})

export const ExternalSessionKeyResponseSchema = z.object({
  sessionKeyAddress: AddressSchema,
})

export const ExternalResolveResponseSchema = z.object({
  address: AddressSchema.optional(),
})

export const ExternalReverseResolveResponseSchema = z.object({
  name: z.string().optional(),
})

export const ExternalBridgeQuotesResponseSchema = z.array(BridgeQuoteSchema)
