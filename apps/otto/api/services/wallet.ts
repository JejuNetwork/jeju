/**
 * Otto Wallet Service
 */

import { expectValid } from '@jejunetwork/types'
import { type Address, type Hex, isAddress, isHex, verifyMessage } from 'viem'
import {
  ExternalResolveResponseSchema,
  ExternalReverseResolveResponseSchema,
  ExternalSessionKeyResponseSchema,
  ExternalSmartAccountResponseSchema,
  type OttoUser,
  OttoUserSchema,
  type Platform,
  type UserSettings,
  UserSettingsSchema,
} from '../../lib'
import { DEFAULT_CHAIN_ID, DEFAULT_SLIPPAGE_BPS } from '../config'
import { getRequiredEnv } from '../utils/validation'
import { getStateManager } from './state'

const getOAuth3BaseUrl = () =>
  getRequiredEnv('OAUTH3_API_URL', 'http://localhost:4025')

const oauth3Api = {
  account: {
    async create(body: { owner: Address; userId: string }) {
      const response = await fetch(`${getOAuth3BaseUrl()}/api/account/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error('Failed to create smart account')
      return expectValid(
        ExternalSmartAccountResponseSchema,
        await response.json(),
        'smart account response',
      )
    },
  },
  sessionKey: {
    async create(body: {
      smartAccount: Address
      permissions: {
        allowedContracts?: Address[]
        maxSpendPerTx?: string
        maxTotalSpend?: string
        allowedFunctions?: string[]
      }
      validUntil: number
    }) {
      const response = await fetch(
        `${getOAuth3BaseUrl()}/api/session-key/create`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!response.ok) throw new Error('Failed to create session key')
      return expectValid(
        ExternalSessionKeyResponseSchema,
        await response.json(),
        'session key response',
      )
    },
    async revoke(body: { smartAccount: Address; sessionKey: Address }) {
      const response = await fetch(
        `${getOAuth3BaseUrl()}/api/session-key/revoke`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      return response.ok
    },
  },
  resolve: {
    async byName(name: string) {
      const response = await fetch(
        `${getOAuth3BaseUrl()}/api/resolve/${encodeURIComponent(name)}`,
      )
      if (!response.ok) return null
      return expectValid(
        ExternalResolveResponseSchema,
        await response.json(),
        'resolve response',
      )
    },
    async byAddress(address: Address) {
      const response = await fetch(
        `${getOAuth3BaseUrl()}/api/reverse/${address}`,
      )
      if (!response.ok) return null
      return expectValid(
        ExternalReverseResolveResponseSchema,
        await response.json(),
        'reverse resolve response',
      )
    },
  },
}

export class WalletService {
  private stateManager = getStateManager()

  getOrCreateUser(platform: Platform, platformId: string): OttoUser | null {
    return this.stateManager.getUserByPlatform(platform, platformId)
  }

  getUser(userId: string): OttoUser | null {
    return this.stateManager.getUser(userId)
  }

  getUserByPlatform(platform: Platform, platformId: string): OttoUser | null {
    return this.stateManager.getUserByPlatform(platform, platformId)
  }

  async generateConnectUrl(
    platform: Platform,
    platformId: string,
    username: string,
  ): Promise<string> {
    const nonce = crypto.randomUUID()
    const requestId = crypto.randomUUID()

    const params = new URLSearchParams({
      platform,
      platformId,
      username,
      nonce,
      requestId,
    })

    return `${getOAuth3BaseUrl()}/connect/wallet?${params}`
  }

  getConnectUrl(
    platform: string,
    platformId: string,
    username: string,
  ): string {
    const nonce = crypto.randomUUID()
    const requestId = crypto.randomUUID()

    const params = new URLSearchParams({
      platform,
      platformId,
      username,
      nonce,
      requestId,
    })

    return `${getOAuth3BaseUrl()}/connect/wallet?${params}`
  }

  async verifyAndConnect(
    platform: Platform,
    platformId: string,
    username: string,
    walletAddress: Address,
    signature: Hex,
    nonce: string,
  ): Promise<OttoUser> {
    if (
      !platform ||
      !platformId ||
      !username ||
      !walletAddress ||
      !signature ||
      !nonce
    ) {
      throw new Error('All parameters are required for wallet connection')
    }

    if (!isAddress(walletAddress)) {
      throw new Error('Invalid wallet address')
    }

    if (!isHex(signature)) {
      throw new Error('Invalid signature format')
    }

    const message = this.createSignMessage(platform, platformId, nonce)
    const valid = await verifyMessage({
      address: walletAddress,
      message,
      signature,
    })

    if (!valid) {
      throw new Error('Invalid signature')
    }

    let user = this.findUserByWallet(walletAddress)

    if (user) {
      const hasLink = user.platforms.some(
        (p) => p.platform === platform && p.platformId === platformId,
      )
      if (!hasLink) {
        user.platforms.push({
          platform,
          platformId,
          username,
          linkedAt: Date.now(),
          verified: true,
        })
        this.stateManager.setUser(user)
      }
    } else {
      const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const newUser = {
        id: userId,
        platforms: [
          {
            platform,
            platformId,
            username,
            linkedAt: Date.now(),
            verified: true,
          },
        ],
        primaryWallet: walletAddress,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        settings: this.getDefaultSettings(),
      }

      user = expectValid(OttoUserSchema, newUser, 'new user')
      this.stateManager.setUser(user)
    }

    return user
  }

  private findUserByWallet(_walletAddress: Address): OttoUser | null {
    return null
  }

  async disconnect(
    userId: string,
    platform: Platform,
    platformId: string,
  ): Promise<boolean> {
    const user = this.stateManager.getUser(userId)
    if (!user) return false

    user.platforms = user.platforms.filter(
      (p) => !(p.platform === platform && p.platformId === platformId),
    )

    this.stateManager.setUser(user)
    return true
  }

  async createSmartAccount(user: OttoUser): Promise<Address> {
    if (!user.primaryWallet) {
      throw new Error('User must have a primary wallet')
    }

    const data = await oauth3Api.account.create({
      owner: user.primaryWallet,
      userId: user.id,
    })

    user.smartAccountAddress = data.address
    this.stateManager.setUser(user)
    return data.address
  }

  async createSessionKey(
    user: OttoUser,
    permissions: SessionKeyPermissions,
  ): Promise<{ address: Address; expiresAt: number }> {
    if (!user.smartAccountAddress) {
      await this.createSmartAccount(user)
    }

    const smartAccountAddress = user.smartAccountAddress
    if (!smartAccountAddress) {
      throw new Error('Failed to create or retrieve smart account address')
    }

    const expiresAt =
      Date.now() + (permissions.validForMs ?? 24 * 60 * 60 * 1000)

    const data = await oauth3Api.sessionKey.create({
      smartAccount: smartAccountAddress,
      permissions: {
        allowedContracts: permissions.allowedContracts,
        maxSpendPerTx: permissions.maxSpendPerTx?.toString(),
        maxTotalSpend: permissions.maxTotalSpend?.toString(),
        allowedFunctions: permissions.allowedFunctions,
      },
      validUntil: Math.floor(expiresAt / 1000),
    })

    user.sessionKeyAddress = data.sessionKeyAddress
    user.sessionKeyExpiry = expiresAt
    this.stateManager.setUser(user)

    return { address: data.sessionKeyAddress, expiresAt }
  }

  async revokeSessionKey(user: OttoUser): Promise<boolean> {
    if (!user.sessionKeyAddress || !user.smartAccountAddress) {
      return false
    }

    const success = await oauth3Api.sessionKey.revoke({
      smartAccount: user.smartAccountAddress,
      sessionKey: user.sessionKeyAddress,
    })

    if (!success) {
      return false
    }

    user.sessionKeyAddress = undefined
    user.sessionKeyExpiry = undefined
    this.stateManager.setUser(user)

    return true
  }

  hasValidSessionKey(user: OttoUser): boolean {
    return (
      !!user.sessionKeyAddress &&
      !!user.sessionKeyExpiry &&
      user.sessionKeyExpiry > Date.now()
    )
  }

  updateSettings(userId: string, settings: Partial<UserSettings>): boolean {
    if (!userId) {
      throw new Error('User ID is required')
    }

    const user = this.stateManager.getUser(userId)
    if (!user) {
      return false
    }

    const mergedSettings = { ...user.settings, ...settings }
    const validatedSettings = expectValid(
      UserSettingsSchema,
      mergedSettings,
      'user settings',
    )

    user.settings = validatedSettings
    this.stateManager.setUser(user)
    return true
  }

  getSettings(userId: string): UserSettings {
    if (!userId) {
      throw new Error('User ID is required')
    }
    const user = this.stateManager.getUser(userId)
    if (!user) {
      throw new Error(`User not found: ${userId}`)
    }
    return user.settings
  }

  private createSignMessage(
    platform: Platform,
    platformId: string,
    nonce: string,
  ): string {
    return `Connect ${platform} account ${platformId} to Otto Trading Agent.\n\nNonce: ${nonce}\n\nThis signature will link your wallet to your ${platform} account for trading.`
  }

  private getDefaultSettings(): UserSettings {
    return {
      defaultSlippageBps: DEFAULT_SLIPPAGE_BPS,
      defaultChainId: DEFAULT_CHAIN_ID,
      notifications: true,
    }
  }

  async resolveAddress(nameOrAddress: string): Promise<Address | null> {
    if (!nameOrAddress || typeof nameOrAddress !== 'string') {
      throw new Error('Name or address must be a non-empty string')
    }

    if (nameOrAddress.startsWith('0x') && nameOrAddress.length === 42) {
      if (!isAddress(nameOrAddress)) {
        throw new Error('Invalid address format')
      }
      return nameOrAddress
    }

    const data = await oauth3Api.resolve.byName(nameOrAddress)
    if (!data?.address) {
      return null
    }

    if (!isAddress(data.address)) {
      throw new Error('Resolved address is invalid')
    }

    return data.address
  }

  async getDisplayName(address: Address): Promise<string> {
    const data = await oauth3Api.resolve.byAddress(address)
    return data?.name ?? `${address.slice(0, 6)}...${address.slice(-4)}`
  }
}

export interface SessionKeyPermissions {
  allowedContracts?: Address[]
  maxSpendPerTx?: bigint
  maxTotalSpend?: bigint
  allowedFunctions?: string[]
  validForMs?: number
}

let walletService: WalletService | null = null

export function getWalletService(): WalletService {
  if (!walletService) {
    walletService = new WalletService()
  }
  return walletService
}
