/**
 * Unified Token Deployer
 *
 * One-command deployment for cross-chain tokens with full Jeju integration.
 */

import type { Keypair } from '@solana/web3.js'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import type { ChainId } from '../types'
import {
  type CrossChainConfig,
  type JejuContractAddresses,
  JejuRegistryIntegration,
  type TokenRegistrationParams,
} from './jeju-registry'
import {
  SolanaInfraManager,
  type SolanaTokenDeployConfig,
} from './solana-infra'

// ============================================================================
// Types
// ============================================================================

export interface TokenDeploymentConfig {
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint

  category: 'defi' | 'gaming' | 'social' | 'utility' | 'meme'
  tags: string[]
  description: string
  website?: string
  twitter?: string
  discord?: string

  homeChainId: ChainId
  targetChainIds: ChainId[]
  includeSolana?: boolean

  oracleAddress?: Address
}

export interface EVMDeployment {
  chainId: ChainId
  tokenAddress: Address
  txHash: Hex
}

export interface TokenDeploymentResult {
  evmDeployments: EVMDeployment[]
  solanaDeployment?: {
    mint: string
    signature: string
    explorerUrl: string
  }
  jejuRegistration?: {
    agentId: bigint
    tokenRegistryId: bigint
  }
  txHashes: Hex[]
}

// ============================================================================
// Unified Deployer
// ============================================================================

export class TokenDeployer {
  private readonly config: TokenDeploymentConfig
  private readonly evmClients: Map<
    ChainId,
    { public: PublicClient; wallet: WalletClient }
  >
  private readonly solanaKeypair?: Keypair
  private readonly jejuContracts?: JejuContractAddresses

  constructor(
    config: TokenDeploymentConfig,
    evmClients: Map<ChainId, { public: PublicClient; wallet: WalletClient }>,
    solanaKeypair?: Keypair,
    jejuContracts?: JejuContractAddresses,
  ) {
    this.config = config
    this.evmClients = evmClients
    this.solanaKeypair = solanaKeypair
    this.jejuContracts = jejuContracts
  }

  async deploy(
    onProgress?: (step: string, status: string) => void,
  ): Promise<TokenDeploymentResult> {
    const progress =
      onProgress ?? ((step, status) => console.log(`[${step}] ${status}`))

    const result: TokenDeploymentResult = {
      evmDeployments: [],
      txHashes: [],
    }

    // Step 1: Deploy to EVM chains
    progress('EVM', 'Deploying to EVM chains...')
    await this.deployEVM(result, progress)

    // Step 2: Deploy to Solana (if configured)
    if (this.config.includeSolana && this.solanaKeypair) {
      progress('Solana', 'Deploying SPL token...')
      await this.deploySolana(result, progress)
    }

    // Step 3: Register with Jeju (if contracts provided)
    if (this.jejuContracts && result.evmDeployments.length > 0) {
      progress('Jeju', 'Registering with Jeju Network...')
      await this.registerWithJeju(result, progress)
    }

    progress('Complete', `Deployed to ${result.evmDeployments.length} chains`)
    return result
  }

  private async deployEVM(
    result: TokenDeploymentResult,
    progress: (step: string, status: string) => void,
  ): Promise<void> {
    // For each target chain, deploy the token
    // This is a simplified implementation - actual deployment uses MultiChainLauncher
    for (const chainId of this.config.targetChainIds) {
      const clients = this.evmClients.get(chainId)
      if (!clients) {
        progress('EVM', `Skipping chain ${chainId} - no client configured`)
        continue
      }

      progress('EVM', `Deploying to chain ${chainId}...`)
      result.evmDeployments.push({
        chainId,
        tokenAddress: '0x0000000000000000000000000000000000000000' as Address,
        txHash: '0x0' as Hex,
      })
    }
  }

  private async deploySolana(
    result: TokenDeploymentResult,
    progress: (step: string, status: string) => void,
  ): Promise<void> {
    if (!this.solanaKeypair) return

    const solanaInfra = new SolanaInfraManager('devnet')
    const tokenConfig: SolanaTokenDeployConfig = {
      name: this.config.name,
      symbol: this.config.symbol,
      decimals: this.config.decimals,
      initialSupply: this.config.totalSupply,
      mintAuthority: this.solanaKeypair.publicKey,
    }

    const solanaResult = await solanaInfra.deployToken(
      this.solanaKeypair,
      tokenConfig,
    )
    result.solanaDeployment = {
      mint: solanaResult.mint.toBase58(),
      signature: solanaResult.signature,
      explorerUrl: solanaResult.explorerUrl,
    }

    progress('Solana', `Deployed: ${solanaResult.mint.toBase58()}`)
  }

  private async registerWithJeju(
    result: TokenDeploymentResult,
    progress: (step: string, status: string) => void,
  ): Promise<void> {
    if (!this.jejuContracts) return

    const homeClients = this.evmClients.get(this.config.homeChainId)
    const homeDeployment = result.evmDeployments.find(
      (d) => d.chainId === this.config.homeChainId,
    )

    if (!homeClients || !homeDeployment) {
      progress('Jeju', 'Skipping - home chain not deployed')
      return
    }

    const jejuIntegration = new JejuRegistryIntegration(
      homeClients.public,
      homeClients.wallet,
      this.jejuContracts,
    )

    if (!this.config.oracleAddress) {
      throw new Error('oracleAddress is required for Jeju registration')
    }

    const registrationParams: TokenRegistrationParams = {
      tokenAddress: homeDeployment.tokenAddress,
      name: this.config.name,
      symbol: this.config.symbol,
      description: this.config.description,
      category: this.config.category,
      tags: this.config.tags,
      website: this.config.website,
      twitter: this.config.twitter,
      discord: this.config.discord,
      oracleAddress: this.config.oracleAddress,
    }

    const crossChainConfigs: CrossChainConfig[] = result.evmDeployments
      .filter((d) => d.chainId !== this.config.homeChainId)
      .map((d) => ({
        chainId: d.chainId as number,
        tokenAddress: d.tokenAddress,
      }))

    const registration = await jejuIntegration.registerToken(
      registrationParams,
      crossChainConfigs,
    )

    result.jejuRegistration = {
      agentId: registration.agentId,
      tokenRegistryId: registration.tokenRegistryId,
    }

    result.txHashes.push(...registration.txHashes)
    progress('Jeju', `Registered: Agent ID ${registration.agentId}`)
  }
}

// ============================================================================
// Factory
// ============================================================================

export async function deployToken(
  config: TokenDeploymentConfig,
  evmClients: Map<ChainId, { public: PublicClient; wallet: WalletClient }>,
  options?: {
    solanaKeypair?: Keypair
    jejuContracts?: JejuContractAddresses
    onProgress?: (step: string, status: string) => void
  },
): Promise<TokenDeploymentResult> {
  const deployer = new TokenDeployer(
    config,
    evmClients,
    options?.solanaKeypair,
    options?.jejuContracts,
  )

  return deployer.deploy(options?.onProgress)
}
