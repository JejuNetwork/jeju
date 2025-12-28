/**
 * Otto Token Launch Service
 */

import { getCoreAppUrl } from '@jejunetwork/config'
import { AddressSchema, expectValid, HexSchema } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'

// Bonding Curve Configuration
export const BondingCurveConfigSchema = z.object({
  virtualEthReserves: z
    .string()
    .refine((v) => parseFloat(v) > 0, 'Must be positive'),
  graduationTarget: z
    .string()
    .refine((v) => parseFloat(v) > 0, 'Must be positive'),
  tokenSupply: z.string().refine((v) => parseFloat(v) > 0, 'Must be positive'),
})

export type BondingCurveConfig = z.infer<typeof BondingCurveConfigSchema>

// ICO Configuration
export const ICOConfigSchema = z
  .object({
    presaleAllocationBps: z.number().int().min(0).max(10000),
    presalePrice: z
      .string()
      .refine((v) => parseFloat(v) > 0, 'Must be positive'),
    lpFundingBps: z.number().int().min(0).max(10000),
    lpLockDuration: z.number().int().min(0),
    buyerLockDuration: z.number().int().min(0),
    softCap: z.string().refine((v) => parseFloat(v) > 0, 'Must be positive'),
    hardCap: z.string().refine((v) => parseFloat(v) > 0, 'Must be positive'),
    presaleDuration: z.number().int().min(0),
  })
  .refine((data) => parseFloat(data.hardCap) >= parseFloat(data.softCap), {
    message: 'Hard cap must be >= soft cap',
    path: ['hardCap'],
  })

export type ICOConfig = z.infer<typeof ICOConfigSchema>

// Launch Type
export const LaunchTypeSchema = z.enum(['bonding', 'ico', 'simple'])
export type LaunchType = z.infer<typeof LaunchTypeSchema>

// Token Customization
export const TokenCustomizationSchema = z.object({
  // Basic Info (required)
  name: z.string().min(1).max(100),
  symbol: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9]+$/),
  imageUrl: z.string().url(),

  // Token Metadata (optional)
  description: z.string().max(2000).optional(),
  websiteUrl: z.string().url().optional(),
  twitterUrl: z.string().url().optional(),
  telegramUrl: z.string().url().optional(),
  farcasterUrl: z.string().url().optional(),
  discordUrl: z.string().url().optional(),

  // Tokenomics
  initialSupply: z.string().regex(/^\d+$/),

  // Anti-bot / Sniper protection
  antiSnipe: z.boolean().default(false),
  antiSnipeBlocks: z.number().int().min(0).max(10).default(0),
  tradingDelayBlocks: z.number().int().min(0).max(100).default(0),

  // Burn/Lock
  burnOnLaunch: z.string().regex(/^\d+$/).optional(),
  lockLiquidity: z.boolean().default(true),
  liquidityLockDuration: z
    .number()
    .int()
    .min(0)
    .default(30 * 24 * 60 * 60),
})

export type TokenCustomization = z.infer<typeof TokenCustomizationSchema>

// Fee Configuration
export const FeeTypeSchema = z.enum(['static', 'dynamic'])
export type FeeType = z.infer<typeof FeeTypeSchema>

export const FeeTierSchema = z.enum(['1', '2', '3']) // 1%, 2%, 3%
export type FeeTier = z.infer<typeof FeeTierSchema>

export const FeeConfigSchema = z.object({
  feeType: FeeTypeSchema.default('static'),
  feeTier: FeeTierSchema.default('1'), // 1% default
  // Sniper Tax: starts at 80%, decays to 5% over duration
  sniperTaxEnabled: z.boolean().default(true),
  sniperTaxDurationSeconds: z.number().int().min(0).max(300).default(15),
  sniperTaxStartBps: z.number().int().default(8000), // 80%
  sniperTaxEndBps: z.number().int().default(500), // 5%
})

export type FeeConfig = z.infer<typeof FeeConfigSchema>

// Pool Configuration
export const PoolTypeSchema = z.enum(['project10', 'project20', 'legacy'])
export type PoolType = z.infer<typeof PoolTypeSchema>

export const LiquidityPositionSchema = z.object({
  percentage: z.number().int().min(1).max(100), // % of supply in this position
  minMarketCap: z.string(), // ETH value
  maxMarketCap: z.string(), // ETH value
})

export type LiquidityPosition = z.infer<typeof LiquidityPositionSchema>

export const PoolConfigSchema = z.object({
  poolType: PoolTypeSchema.default('project10'),
  startingMarketCapEth: z.string().default('10'), // 10 ETH or 20 ETH
  // Liquidity distribution across market cap ranges
  liquidityPositions: z.array(LiquidityPositionSchema).optional(),
})

export type PoolConfig = z.infer<typeof PoolConfigSchema>

// Reward Recipients (fee sharing)
export const RewardTokenTypeSchema = z.enum(['weth', 'token', 'both'])
export type RewardTokenType = z.infer<typeof RewardTokenTypeSchema>

export const RewardRecipientSchema = z.object({
  address: AddressSchema,
  percentage: z.number().int().min(1).max(100),
  rewardToken: RewardTokenTypeSchema.default('weth'),
  isAdmin: z.boolean().default(false),
})

export type RewardRecipient = z.infer<typeof RewardRecipientSchema>

export const RewardConfigSchema = z
  .object({
    recipients: z.array(RewardRecipientSchema).min(1).max(10),
  })
  .refine(
    (data) => {
      const total = data.recipients.reduce((sum, r) => sum + r.percentage, 0)
      return total === 100
    },
    { message: 'Reward percentages must sum to 100%' },
  )

export type RewardConfig = z.infer<typeof RewardConfigSchema>

// Creator Vault Extension
export const CreatorVaultSchema = z.object({
  enabled: z.boolean().default(false),
  vaultPercentage: z.number().int().min(0).max(30).default(0), // 0%, 5%, 15%, 30%
  recipientAddress: AddressSchema,
  lockupEndDate: z.string().datetime().optional(), // ISO date
  vestingEndDate: z.string().datetime().optional(), // ISO date
})

export type CreatorVault = z.infer<typeof CreatorVaultSchema>

// Creator Buy Extension
export const CreatorBuySchema = z.object({
  enabled: z.boolean().default(false),
  ethAmount: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .default('0'), // ETH to buy at launch
})

export type CreatorBuy = z.infer<typeof CreatorBuySchema>

// Airdrop Extension
export const AirdropEntrySchema = z.object({
  address: AddressSchema,
  amount: z.string().regex(/^\d+$/),
})

export type AirdropEntry = z.infer<typeof AirdropEntrySchema>

export const AirdropConfigSchema = z.object({
  enabled: z.boolean().default(false),
  entries: z.array(AirdropEntrySchema).max(10000), // Max 10k addresses
  lockupEndDate: z.string().datetime().optional(),
  vestingEndDate: z.string().datetime().optional(),
})

export type AirdropConfig = z.infer<typeof AirdropConfigSchema>

// Preclank Configuration (social trigger feature)
export const PreclankSchema = z.object({
  enabled: z.boolean().default(false),
  triggerPhrase: z.string().min(1).max(100).optional(), // Phrase to trigger launch
  expiresAt: z.string().datetime().optional(), // When preclank expires
})

export type Preclank = z.infer<typeof PreclankSchema>

// Social Launch Configuration
export const SocialLaunchConfigSchema = z.object({
  // Farcaster
  farcasterEnabled: z.boolean().default(false),
  farcasterChannelId: z.string().optional(),
  farcasterCastOnLaunch: z.boolean().default(true),

  // Twitter
  twitterEnabled: z.boolean().default(false),
  twitterTweetOnLaunch: z.boolean().default(true),

  // Discord
  discordEnabled: z.boolean().default(false),
  discordWebhookUrl: z.string().url().optional(),

  // Telegram
  telegramEnabled: z.boolean().default(false),
  telegramChatId: z.string().optional(),

  // Custom Announcement
  announcementTemplate: z.string().max(1000).optional(),
})

export type SocialLaunchConfig = z.infer<typeof SocialLaunchConfigSchema>

// Supported chains
export const SupportedChainSchema = z.enum([
  'base',
  'arbitrum',
  'ethereum',
  'unichain',
  'monad',
  'jeju',
])
export type SupportedChain = z.infer<typeof SupportedChainSchema>

export const CHAIN_IDS: Record<SupportedChain, number> = {
  base: 8453,
  arbitrum: 42161,
  ethereum: 1,
  unichain: 130, // Unichain mainnet
  monad: 42069, // Monad testnet (mainnet TBD)
  jeju: 420691,
}

// Full Launch Request
export const LaunchRequestSchema = z.object({
  userId: z.string().min(1),
  walletAddress: AddressSchema,

  // Network selection
  chain: SupportedChainSchema.default('base'),
  chainId: z.number().int().optional(), // Can override with specific chainId

  // Token Config (required)
  token: TokenCustomizationSchema,

  // Launch Type
  launchType: LaunchTypeSchema.default('bonding'),

  // Fee Configuration
  feeConfig: FeeConfigSchema.optional(),

  // Pool Configuration
  poolConfig: PoolConfigSchema.optional(),

  // Reward Recipients (fee sharing)
  rewardConfig: RewardConfigSchema.optional(),

  // Type-specific config
  bondingConfig: BondingCurveConfigSchema.optional(),
  icoConfig: ICOConfigSchema.optional(),

  // Initial Liquidity (for simple launches)
  initialLiquidity: z.string().regex(/^\d+$/).optional(),

  // Extensions
  creatorVault: CreatorVaultSchema.optional(),
  creatorBuy: CreatorBuySchema.optional(),
  airdrop: AirdropConfigSchema.optional(),
  preclank: PreclankSchema.optional(),

  // Social announcements
  social: SocialLaunchConfigSchema.optional(),
})

export type LaunchRequest = z.infer<typeof LaunchRequestSchema>

// Launch Result
export const LaunchResultSchema = z.object({
  success: z.boolean(),
  tokenAddress: AddressSchema.optional(),
  poolAddress: AddressSchema.optional(),
  bondingCurveAddress: AddressSchema.optional(),
  presaleAddress: AddressSchema.optional(),
  lpLockerAddress: AddressSchema.optional(),
  txHash: HexSchema.optional(),
  launchId: z.string().optional(),
  error: z.string().optional(),

  // Extension results
  creatorVaultAddress: AddressSchema.optional(),
  airdropContractAddress: AddressSchema.optional(),
  creatorBuyTxHash: HexSchema.optional(),

  // Preclank result
  preclankId: z.string().optional(),

  // Social announcements
  farcasterCastHash: z.string().optional(),
  twitterTweetId: z.string().optional(),
})

export type LaunchResult = z.infer<typeof LaunchResultSchema>

// Default Configurations
export const DEFAULT_BONDING_CONFIG: BondingCurveConfig = {
  virtualEthReserves: '30',
  graduationTarget: '10',
  tokenSupply: '1000000000',
}

export const DEFAULT_ICO_CONFIG: ICOConfig = {
  presaleAllocationBps: 3000, // 30%
  presalePrice: '0.0001',
  lpFundingBps: 8000, // 80% to LP
  lpLockDuration: 30 * 24 * 60 * 60, // 30 days
  buyerLockDuration: 7 * 24 * 60 * 60, // 7 days
  softCap: '5',
  hardCap: '50',
  presaleDuration: 7 * 24 * 60 * 60, // 7 days
}

export const DEGEN_CONFIG: BondingCurveConfig = {
  virtualEthReserves: '10',
  graduationTarget: '5',
  tokenSupply: '1000000000000', // 1 trillion
}

// Default Pool Configs
export const PROJECT_10_ETH_POOL: PoolConfig = {
  poolType: 'project10',
  startingMarketCapEth: '10',
  liquidityPositions: [
    { percentage: 10, minMarketCap: '0.027', maxMarketCap: '0.056' }, // Position 1
    { percentage: 50, minMarketCap: '0.056', maxMarketCap: '1.6' }, // Position 2
    { percentage: 15, minMarketCap: '1.6', maxMarketCap: '41.7' }, // Position 3
    { percentage: 20, minMarketCap: '41.7', maxMarketCap: '500' }, // Position 4
    { percentage: 5, minMarketCap: '500', maxMarketCap: '1500' }, // Position 5
  ],
}

export const PROJECT_20_ETH_POOL: PoolConfig = {
  poolType: 'project20',
  startingMarketCapEth: '20',
  liquidityPositions: [
    { percentage: 10, minMarketCap: '0.054', maxMarketCap: '0.112' },
    { percentage: 50, minMarketCap: '0.112', maxMarketCap: '3.2' },
    { percentage: 15, minMarketCap: '3.2', maxMarketCap: '83.4' },
    { percentage: 20, minMarketCap: '83.4', maxMarketCap: '1000' },
    { percentage: 5, minMarketCap: '1000', maxMarketCap: '3000' },
  ],
}

export const LEGACY_POOL: PoolConfig = {
  poolType: 'legacy',
  startingMarketCapEth: '5',
}

// Default Fee Config
export const DEFAULT_FEE_CONFIG: FeeConfig = {
  feeType: 'static',
  feeTier: '1',
  sniperTaxEnabled: true,
  sniperTaxDurationSeconds: 15,
  sniperTaxStartBps: 8000,
  sniperTaxEndBps: 500,
}

function getBazaarApi(): string {
  const url = process.env.BAZAAR_API_URL ?? getCoreAppUrl('BAZAAR')
  if (!url) {
    throw new Error('BAZAAR_API_URL is not configured')
  }
  return url
}

export class LaunchService {
  /**
   * Launch a new token with full customization
   */
  async launchToken(request: LaunchRequest): Promise<LaunchResult> {
    const validated = expectValid(
      LaunchRequestSchema,
      request,
      'launch request',
    )

    // Handle preclank (just save for later, don't launch)
    if (validated.preclank?.enabled) {
      return this.createPreclank(validated)
    }

    // Resolve chain ID from chain name or use provided chainId
    const chainId = validated.chainId ?? CHAIN_IDS[validated.chain]

    // Apply defaults for launch type
    if (validated.launchType === 'bonding' && !validated.bondingConfig) {
      validated.bondingConfig = DEFAULT_BONDING_CONFIG
    }
    if (validated.launchType === 'ico' && !validated.icoConfig) {
      validated.icoConfig = DEFAULT_ICO_CONFIG
    }

    // Apply default fee config if not provided
    const feeConfig = validated.feeConfig ?? DEFAULT_FEE_CONFIG

    // Apply default pool config based on pool type
    let poolConfig = validated.poolConfig
    if (!poolConfig) {
      poolConfig = PROJECT_10_ETH_POOL
    } else if (poolConfig.poolType === 'project20') {
      poolConfig = { ...PROJECT_20_ETH_POOL, ...poolConfig }
    } else if (poolConfig.poolType === 'legacy') {
      poolConfig = { ...LEGACY_POOL, ...poolConfig }
    }

    // Build comprehensive launch payload
    const payload = {
      creator: validated.walletAddress,
      chainId,
      launchType: validated.launchType,

      // Token info (required)
      name: validated.token.name,
      symbol: validated.token.symbol,
      imageUrl: validated.token.imageUrl,
      description: validated.token.description,
      initialSupply: validated.token.initialSupply,

      // Token metadata (optional)
      websiteUrl: validated.token.websiteUrl,
      twitterUrl: validated.token.twitterUrl,
      telegramUrl: validated.token.telegramUrl,
      farcasterUrl: validated.token.farcasterUrl,
      discordUrl: validated.token.discordUrl,

      // Fee Configuration
      feeType: feeConfig.feeType,
      feeTierBps: parseInt(feeConfig.feeTier, 10) * 100, // Convert 1/2/3 to 100/200/300 bps
      sniperTaxEnabled: feeConfig.sniperTaxEnabled,
      sniperTaxDurationSeconds: feeConfig.sniperTaxDurationSeconds,
      sniperTaxStartBps: feeConfig.sniperTaxStartBps,
      sniperTaxEndBps: feeConfig.sniperTaxEndBps,

      // Pool Configuration
      poolType: poolConfig.poolType,
      startingMarketCapEth: poolConfig.startingMarketCapEth,
      liquidityPositions: poolConfig.liquidityPositions,

      // Reward Recipients (fee sharing)
      rewardRecipients: validated.rewardConfig?.recipients,

      // Anti-bot
      antiSnipe: validated.token.antiSnipe,
      antiSnipeBlocks: validated.token.antiSnipeBlocks,
      tradingDelayBlocks: validated.token.tradingDelayBlocks,

      // LP Lock
      lockLiquidity: validated.token.lockLiquidity,
      liquidityLockDuration: validated.token.liquidityLockDuration,

      // Type-specific configs
      ...(validated.launchType === 'bonding' && validated.bondingConfig
        ? { bondingConfig: validated.bondingConfig }
        : {}),
      ...(validated.launchType === 'ico' && validated.icoConfig
        ? { icoConfig: validated.icoConfig }
        : {}),
      ...(validated.launchType === 'simple' && validated.initialLiquidity
        ? { initialLiquidity: validated.initialLiquidity }
        : {}),

      // Extensions
      creatorVault: validated.creatorVault?.enabled
        ? {
            vaultPercentage: validated.creatorVault.vaultPercentage,
            recipientAddress: validated.creatorVault.recipientAddress,
            lockupEndDate: validated.creatorVault.lockupEndDate,
            vestingEndDate: validated.creatorVault.vestingEndDate,
          }
        : undefined,

      creatorBuy: validated.creatorBuy?.enabled
        ? {
            ethAmount: validated.creatorBuy.ethAmount,
          }
        : undefined,

      airdrop: validated.airdrop?.enabled
        ? {
            entries: validated.airdrop.entries,
            lockupEndDate: validated.airdrop.lockupEndDate,
            vestingEndDate: validated.airdrop.vestingEndDate,
          }
        : undefined,
    }

    // Call Bazaar API
    const response = await fetch(`${getBazaarApi()}/api/launchpad/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Address': validated.walletAddress,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: errorText }
    }

    const rawResult = (await response.json()) as {
      tokenAddress: string
      poolAddress?: string
      bondingCurveAddress?: string
      presaleAddress?: string
      lpLockerAddress?: string
      creatorVaultAddress?: string
      airdropContractAddress?: string
      creatorBuyTxHash?: string
      txHash: string
      launchId: string
    }

    const result: LaunchResult = {
      success: true,
      tokenAddress: rawResult.tokenAddress as Address,
      poolAddress: rawResult.poolAddress as Address | undefined,
      bondingCurveAddress: rawResult.bondingCurveAddress as Address | undefined,
      presaleAddress: rawResult.presaleAddress as Address | undefined,
      lpLockerAddress: rawResult.lpLockerAddress as Address | undefined,
      creatorVaultAddress: rawResult.creatorVaultAddress as Address | undefined,
      airdropContractAddress: rawResult.airdropContractAddress as
        | Address
        | undefined,
      creatorBuyTxHash: rawResult.creatorBuyTxHash as Hex | undefined,
      txHash: rawResult.txHash as Hex,
      launchId: rawResult.launchId,
    }

    // Handle social announcements if configured
    if (validated.social && result.success && result.tokenAddress) {
      const socialResult = await this.announceTokenLaunch(validated, result)
      result.farcasterCastHash = socialResult.farcasterCastHash
      result.twitterTweetId = socialResult.twitterTweetId
    }

    return result
  }

  /**
   * Create a preclank (social trigger for later launch)
   */
  private async createPreclank(request: LaunchRequest): Promise<LaunchResult> {
    const validated = expectValid(
      LaunchRequestSchema,
      request,
      'preclank request',
    )

    if (!validated.preclank?.triggerPhrase) {
      return { success: false, error: 'Preclank requires a trigger phrase' }
    }

    // Save preclank configuration to Bazaar
    const response = await fetch(`${getBazaarApi()}/api/launchpad/preclank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Address': validated.walletAddress,
      },
      body: JSON.stringify({
        creator: validated.walletAddress,
        triggerPhrase: validated.preclank.triggerPhrase,
        expiresAt: validated.preclank.expiresAt,
        launchConfig: {
          chain: validated.chain,
          token: validated.token,
          launchType: validated.launchType,
          feeConfig: validated.feeConfig,
          poolConfig: validated.poolConfig,
          rewardConfig: validated.rewardConfig,
          bondingConfig: validated.bondingConfig,
          icoConfig: validated.icoConfig,
          initialLiquidity: validated.initialLiquidity,
          creatorVault: validated.creatorVault,
          creatorBuy: validated.creatorBuy,
          airdrop: validated.airdrop,
          social: validated.social,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: errorText }
    }

    const rawResult = (await response.json()) as { preclankId: string }

    return {
      success: true,
      preclankId: rawResult.preclankId,
    }
  }

  /**
   * Trigger a preclank from a social post
   */
  async triggerPreclank(
    preclankId: string,
    triggeredBy: Address,
  ): Promise<LaunchResult> {
    const response = await fetch(
      `${getBazaarApi()}/api/launchpad/preclank/${preclankId}/trigger`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-Address': triggeredBy,
        },
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: errorText }
    }

    const rawResult = (await response.json()) as {
      tokenAddress: string
      poolAddress?: string
      bondingCurveAddress?: string
      txHash: string
      launchId: string
    }

    return {
      success: true,
      tokenAddress: rawResult.tokenAddress as Address,
      poolAddress: rawResult.poolAddress as Address | undefined,
      bondingCurveAddress: rawResult.bondingCurveAddress as Address | undefined,
      txHash: rawResult.txHash as Hex,
      launchId: rawResult.launchId,
    }
  }

  /**
   * Get user's preclanks
   */
  async getUserPreclanks(walletAddress: Address): Promise<
    Array<{
      preclankId: string
      triggerPhrase: string
      expiresAt?: string
      token: { name: string; symbol: string; imageUrl: string }
      createdAt: string
    }>
  > {
    const response = await fetch(
      `${getBazaarApi()}/api/launchpad/preclank/user/${walletAddress}`,
    )
    if (!response.ok) {
      return []
    }
    return response.json()
  }

  /**
   * Preview launch (get quote without executing)
   */
  async previewLaunch(request: LaunchRequest): Promise<{
    estimatedGasCost: string
    estimatedInitialPrice: string
    estimatedMarketCap: string
    graduationMarketCap?: string
  }> {
    const validated = expectValid(
      LaunchRequestSchema,
      request,
      'launch request',
    )

    const response = await fetch(`${getBazaarApi()}/api/launchpad/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        launchType: validated.launchType,
        initialSupply: validated.token.initialSupply,
        bondingConfig: validated.bondingConfig,
        icoConfig: validated.icoConfig,
        initialLiquidity: validated.initialLiquidity,
        chainId: validated.chainId,
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to get launch preview')
    }

    return (await response.json()) as {
      estimatedGasCost: string
      estimatedInitialPrice: string
      estimatedMarketCap: string
      graduationMarketCap?: string
    }
  }

  /**
   * Announce token launch on social platforms
   */
  private async announceTokenLaunch(
    request: LaunchRequest,
    result: LaunchResult,
  ): Promise<{ farcasterCastHash?: string; twitterTweetId?: string }> {
    const announcements: {
      farcasterCastHash?: string
      twitterTweetId?: string
    } = {}

    if (!request.social) return announcements

    const message = this.formatAnnouncementMessage(request, result)

    // Farcaster announcement
    if (
      request.social.farcasterEnabled &&
      request.social.farcasterCastOnLaunch
    ) {
      try {
        const castResult = await this.postFarcasterCast(
          message,
          request.social.farcasterChannelId,
        )
        announcements.farcasterCastHash = castResult.hash
      } catch (err) {
        console.error('[LaunchService] Farcaster announcement failed:', err)
      }
    }

    // Twitter announcement
    if (request.social.twitterEnabled && request.social.twitterTweetOnLaunch) {
      try {
        const tweetResult = await this.postTwitterTweet(message)
        announcements.twitterTweetId = tweetResult.id
      } catch (err) {
        console.error('[LaunchService] Twitter announcement failed:', err)
      }
    }

    // Discord webhook
    if (request.social.discordEnabled && request.social.discordWebhookUrl) {
      try {
        await this.postDiscordWebhook(
          request.social.discordWebhookUrl,
          message,
          request,
          result,
        )
      } catch (err) {
        console.error('[LaunchService] Discord announcement failed:', err)
      }
    }

    // Telegram
    if (request.social.telegramEnabled && request.social.telegramChatId) {
      try {
        await this.postTelegramMessage(request.social.telegramChatId, message)
      } catch (err) {
        console.error('[LaunchService] Telegram announcement failed:', err)
      }
    }

    return announcements
  }

  /**
   * Format announcement message
   */
  private formatAnnouncementMessage(
    request: LaunchRequest,
    result: LaunchResult,
  ): string {
    if (request.social?.announcementTemplate) {
      return request.social.announcementTemplate
        .replace('{name}', request.token.name)
        .replace('{symbol}', request.token.symbol)
        .replace('{address}', result.tokenAddress ?? '')
        .replace('{description}', request.token.description ?? '')
    }

    return `🚀 New Token Launched: ${request.token.name} ($${request.token.symbol})

${request.token.description ? `${request.token.description}\n\n` : ''}CA: ${result.tokenAddress}

${request.token.websiteUrl ? `🌐 ${request.token.websiteUrl}` : ''}
${request.token.twitterUrl ? `🐦 ${request.token.twitterUrl}` : ''}

#crypto #newtoken #${request.token.symbol.toLowerCase()}`
  }

  /**
   * Post to Farcaster via Neynar
   */
  private async postFarcasterCast(
    text: string,
    channelId?: string,
  ): Promise<{ hash: string }> {
    const apiKey = process.env.NEYNAR_API_KEY
    const signerUuid = process.env.FARCASTER_SIGNER_UUID

    if (!apiKey || !signerUuid) {
      throw new Error('Farcaster not configured')
    }

    const response = await fetch('https://api.neynar.com/v2/farcaster/cast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_key: apiKey,
      },
      body: JSON.stringify({
        signer_uuid: signerUuid,
        text,
        channel_id: channelId,
      }),
    })

    if (!response.ok) {
      throw new Error(`Farcaster API error: ${response.status}`)
    }

    const data = (await response.json()) as { cast: { hash: string } }
    return { hash: data.cast.hash }
  }

  /**
   * Post to Twitter
   */
  private async postTwitterTweet(text: string): Promise<{ id: string }> {
    const bearerToken = process.env.TWITTER_BEARER_TOKEN

    if (!bearerToken) {
      throw new Error('Twitter not configured')
    }

    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    })

    if (!response.ok) {
      throw new Error(`Twitter API error: ${response.status}`)
    }

    const data = (await response.json()) as { data: { id: string } }
    return { id: data.data.id }
  }

  /**
   * Post to Discord webhook
   */
  private async postDiscordWebhook(
    webhookUrl: string,
    text: string,
    request: LaunchRequest,
    result: LaunchResult,
  ): Promise<void> {
    const embed = {
      title: `🚀 ${request.token.name} ($${request.token.symbol}) Launched`,
      description:
        request.token.description ?? 'A new token has been launched.',
      color: 0x00ff00,
      fields: [
        {
          name: 'Contract Address',
          value: `\`${result.tokenAddress}\``,
          inline: false,
        },
        { name: 'Supply', value: request.token.initialSupply, inline: true },
        { name: 'Launch Type', value: request.launchType, inline: true },
      ],
      thumbnail: request.token.imageUrl
        ? { url: request.token.imageUrl }
        : undefined,
      timestamp: new Date().toISOString(),
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: text,
        embeds: [embed],
      }),
    })
  }

  /**
   * Post to Telegram
   */
  private async postTelegramMessage(
    chatId: string,
    text: string,
  ): Promise<void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN

    if (!botToken) {
      throw new Error('Telegram not configured')
    }

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    })
  }

  /**
   * Get launch status/info
   */
  async getLaunchInfo(launchId: string): Promise<{
    id: string
    creator: Address
    token: Address
    launchType: LaunchType
    status: 'active' | 'graduated' | 'failed'
    createdAt: number
    progress?: number
    ethCollected?: string
    marketCap?: string
  }> {
    const response = await fetch(`${getBazaarApi()}/api/launchpad/${launchId}`)

    if (!response.ok) {
      throw new Error('Failed to get launch info')
    }

    return (await response.json()) as {
      id: string
      creator: Address
      token: Address
      launchType: LaunchType
      status: 'active' | 'graduated' | 'failed'
      createdAt: number
      progress?: number
      ethCollected?: string
      marketCap?: string
    }
  }

  /**
   * Get user's launches
   */
  async getUserLaunches(userAddress: Address): Promise<
    Array<{
      id: string
      tokenAddress: Address
      name: string
      symbol: string
      launchType: LaunchType
      status: 'active' | 'graduated' | 'failed'
      createdAt: number
    }>
  > {
    const response = await fetch(
      `${getBazaarApi()}/api/launchpad/user/${userAddress}`,
    )

    if (!response.ok) {
      return []
    }

    return (await response.json()) as Array<{
      id: string
      tokenAddress: Address
      name: string
      symbol: string
      launchType: LaunchType
      status: 'active' | 'graduated' | 'failed'
      createdAt: number
    }>
  }

  /**
   * Buy tokens from bonding curve
   */
  async buyFromBondingCurve(
    walletAddress: Address,
    bondingCurveAddress: Address,
    ethAmount: string,
    minTokens: string,
  ): Promise<{
    success: boolean
    txHash?: Hex
    tokensReceived?: string
    error?: string
  }> {
    const response = await fetch(
      `${getBazaarApi()}/api/launchpad/bonding/buy`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-Address': walletAddress,
        },
        body: JSON.stringify({
          bondingCurve: bondingCurveAddress,
          ethAmount,
          minTokens,
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error }
    }

    const result = (await response.json()) as {
      txHash: string
      tokensReceived: string
    }
    return {
      success: true,
      txHash: result.txHash as Hex,
      tokensReceived: result.tokensReceived,
    }
  }

  /**
   * Sell tokens to bonding curve
   */
  async sellToBondingCurve(
    walletAddress: Address,
    bondingCurveAddress: Address,
    tokenAmount: string,
    minEth: string,
  ): Promise<{
    success: boolean
    txHash?: Hex
    ethReceived?: string
    error?: string
  }> {
    const response = await fetch(
      `${getBazaarApi()}/api/launchpad/bonding/sell`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-Address': walletAddress,
        },
        body: JSON.stringify({
          bondingCurve: bondingCurveAddress,
          tokenAmount,
          minEth,
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error }
    }

    const result = (await response.json()) as {
      txHash: string
      ethReceived: string
    }
    return {
      success: true,
      txHash: result.txHash as Hex,
      ethReceived: result.ethReceived,
    }
  }
}

let launchService: LaunchService | null = null

export function getLaunchService(): LaunchService {
  if (!launchService) {
    launchService = new LaunchService()
  }
  return launchService
}
