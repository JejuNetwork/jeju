/**
 * Agent Identity Service
 *
 * Manages agent identity, wallets, and on-chain registration using:
 * - @jejunetwork/kms for key management
 * - @jejunetwork/auth for OAuth3 identity
 * - Agent0 SDK for on-chain registration
 *
 * @packageDocumentation
 */

import { getMPCCoordinator } from '@jejunetwork/kms'
import { logger } from '@jejunetwork/shared'
import type { Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getAgent0Client } from '../agent0/client'
import { agentRegistry } from '../services/agent-registry.service'
import { AgentStatus } from '../types/agent-registry'

/**
 * Identity setup options
 */
export interface IdentitySetupOptions {
  /** Skip Agent0 on-chain registration */
  skipAgent0Registration?: boolean
  /** Skip wallet provisioning */
  skipWalletProvisioning?: boolean
  /** Use existing private key instead of generating new one */
  existingPrivateKey?: `0x${string}`
}

/**
 * Agent identity result
 */
export interface AgentIdentity {
  agentId: string
  walletAddress?: string
  oauth3WalletId?: string
  agent0TokenId?: string
  registrationTxHash?: string
  publicKey?: string
}

/**
 * Agent Identity Service
 *
 * Handles the complete identity lifecycle for agents including:
 * - Wallet provisioning via MPC key generation
 * - On-chain registration via Agent0/ERC-8004
 * - Identity linking and reputation
 */
export class AgentIdentityService {
  private identities: Map<string, AgentIdentity> = new Map()

  /**
   * Set up identity for a new agent
   *
   * Creates wallet, registers on-chain, and links identity.
   */
  async setupAgentIdentity(
    agentId: string,
    options: IdentitySetupOptions = {},
  ): Promise<AgentIdentity> {
    logger.info(`Setting up agent identity for ${agentId}`)

    const identity: AgentIdentity = { agentId }

    // Provision wallet unless skipped or existing key provided
    if (!options.skipWalletProvisioning) {
      if (options.existingPrivateKey) {
        identity.walletAddress = privateKeyToAccount(
          options.existingPrivateKey,
        ).address
        logger.info(`Using existing wallet: ${identity.walletAddress}`)
      } else {
        const walletAddress = await this.provisionWallet(agentId)
        identity.walletAddress = walletAddress
      }
    }

    // Register on-chain unless skipped
    if (!options.skipAgent0Registration && identity.walletAddress) {
      try {
        const txHash = await this.registerOnChain(
          agentId,
          identity.walletAddress,
        )
        identity.registrationTxHash = txHash

        // Extract token ID from Agent0 registration
        const agent0Client = getAgent0Client()
        const profile = await agent0Client.getAgentProfile(
          parseInt(txHash.slice(-8), 16),
        )
        if (profile) {
          identity.agent0TokenId = profile.tokenId.toString()
        }
      } catch (error) {
        logger.warn(
          'Agent0 registration failed, continuing without on-chain identity',
          {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }

    // Cache identity
    this.identities.set(agentId, identity)

    // Update agent registry status
    await agentRegistry.updateStatus(agentId, AgentStatus.ACTIVE)

    logger.info(`Agent identity setup complete`, {
      agentId,
      walletAddress: identity.walletAddress ?? null,
      agent0TokenId: identity.agent0TokenId ?? null,
    })

    return identity
  }

  /**
   * Get agent identity
   */
  async getAgentIdentity(agentId: string): Promise<AgentIdentity | null> {
    // Check cache
    const cached = this.identities.get(agentId)
    if (cached) return cached

    // Check agent registry
    const registration = await agentRegistry.getAgent(agentId)
    if (!registration) return null

    // Build identity from registration
    const identity: AgentIdentity = {
      agentId,
      walletAddress: registration.onChainData?.serverWallet,
      agent0TokenId: registration.agent0Data?.tokenId ?? undefined,
    }

    this.identities.set(agentId, identity)
    return identity
  }

  /**
   * Provision wallet via MPC key generation
   *
   * Uses FROST threshold MPC to generate a distributed key where
   * the agent never has access to the full private key.
   */
  async provisionWallet(agentId: string): Promise<string> {
    logger.info(`Provisioning MPC wallet for ${agentId}`)

    const mpcCoordinator = getMPCCoordinator()

    // Get active parties for key generation
    const activeParties = mpcCoordinator.getActiveParties()
    if (activeParties.length < 3) {
      throw new Error('Insufficient active MPC parties for key generation')
    }

    // Generate distributed key using MPC
    const partyIds = activeParties.slice(0, 3).map((p) => p.id)
    const keyGenResult = await mpcCoordinator.generateKey({
      keyId: `agent-${agentId}`,
      threshold: 2,
      totalParties: 3,
      partyIds,
      curve: 'secp256k1',
    })

    // Derive address from public key
    const walletAddress = keyGenResult.address

    logger.info(`Wallet provisioned: ${walletAddress}`)
    return walletAddress
  }

  /**
   * Register agent on-chain (ERC-8004/Agent0)
   */
  async registerOnChain(
    agentId: string,
    walletAddress: string,
  ): Promise<string> {
    logger.info(
      `Registering agent ${agentId} on-chain with wallet ${walletAddress}`,
    )

    const agent0Client = getAgent0Client()

    if (!agent0Client.isAvailable()) {
      throw new Error('Agent0 client not available for on-chain registration')
    }

    // Get agent info from registry
    const registration = await agentRegistry.getAgent(agentId)
    if (!registration) {
      throw new Error(`Agent not found in registry: ${agentId}`)
    }

    // Register with Agent0
    const result = await agent0Client.registerAgent({
      name: registration.name,
      description: registration.systemPrompt,
      walletAddress,
      capabilities: registration.capabilities,
    })

    logger.info(`Agent registered on-chain`, {
      agentId,
      tokenId: result.tokenId,
      txHash: result.txHash,
    })

    return result.txHash
  }

  /**
   * Update agent reputation on-chain
   */
  async updateReputation(
    agentId: string,
    delta: number,
    reason: string,
  ): Promise<number> {
    logger.debug(
      `Updating reputation for ${agentId}: ${delta > 0 ? '+' : ''}${delta} (${reason})`,
    )

    const identity = await this.getAgentIdentity(agentId)
    if (!identity?.agent0TokenId) {
      throw new Error(`Agent ${agentId} not registered on-chain`)
    }

    const agent0Client = getAgent0Client()

    if (!agent0Client.isAvailable()) {
      throw new Error('Agent0 client not available')
    }

    // Submit feedback to update reputation
    const rating = Math.max(-5, Math.min(5, delta))
    await agent0Client.submitFeedback({
      targetAgentId: parseInt(identity.agent0TokenId, 10),
      rating,
      comment: reason,
      tags: ['reputation-update'],
    })

    // Get updated reputation
    const summary = await agent0Client.getReputationSummary(
      agent0Client.formatAgentId(parseInt(identity.agent0TokenId, 10)),
    )

    return summary.averageScore
  }

  /**
   * Link external identity to agent
   */
  async linkExternalIdentity(
    agentId: string,
    provider: 'twitter' | 'farcaster' | 'github',
    externalId: string,
  ): Promise<void> {
    logger.info(`Linking ${provider} identity to agent ${agentId}`)

    const identity = await this.getAgentIdentity(agentId)
    if (!identity) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    // Store link in identity metadata
    const linkedIdentities =
      (
        identity as AgentIdentity & {
          linkedIdentities?: Record<string, string>
        }
      ).linkedIdentities ?? {}
    linkedIdentities[provider] = externalId

    // Update cache
    this.identities.set(agentId, {
      ...identity,
      linkedIdentities,
    } as AgentIdentity)

    logger.info(`Linked ${provider} identity ${externalId} to agent ${agentId}`)
  }

  /**
   * Verify agent owns a wallet address
   */
  async verifyWalletOwnership(
    agentId: string,
    address: Address,
    signature: `0x${string}`,
    message: string,
  ): Promise<boolean> {
    const identity = await this.getAgentIdentity(agentId)
    if (!identity?.walletAddress) {
      return false
    }

    // Verify the signature matches the agent's registered wallet
    if (identity.walletAddress.toLowerCase() !== address.toLowerCase()) {
      return false
    }

    // Verify signature using viem's verifyMessage
    const { verifyMessage } = await import('viem')
    const isValid = await verifyMessage({
      address: identity.walletAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })

    return isValid
  }

  /**
   * Clear cached identity (for testing)
   */
  clearCache(agentId?: string): void {
    if (agentId) {
      this.identities.delete(agentId)
    } else {
      this.identities.clear()
    }
  }
}

/** Singleton instance */
export const agentIdentityService = new AgentIdentityService()
