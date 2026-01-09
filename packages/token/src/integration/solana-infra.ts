/**
 * Solana Infrastructure Integration
 *
 * Provides utilities for:
 * - Connecting to Jeju's Solana RPC nodes
 * - Deploying SPL tokens
 * - Setting up Hyperlane warp routes on Solana
 */

import {
  createAssociatedTokenAccountInstruction,
  createMint,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token'
import {
  Connection,
  type Keypair,
  LAMPORTS_PER_SOL,
  type PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js'

// Types

export interface SolanaNodeConfig {
  rpcUrl: string
  wsUrl?: string
  commitment: 'processed' | 'confirmed' | 'finalized'
}

export interface SolanaTokenDeployConfig {
  name: string
  symbol: string
  decimals: number
  initialSupply: bigint
  mintAuthority: PublicKey
  freezeAuthority?: PublicKey
}

export interface SolanaDeploymentResult {
  mint: PublicKey
  signature: string
  explorerUrl: string
}

export interface HyperlaneWarpConfig {
  evmChainId: number
  evmTokenAddress: string
  solanaTokenMint: PublicKey
  isCollateral: boolean
}

export interface SolanaTerraformConfig {
  region: string
  nodeCount: number
  instanceType: string
  diskSizeGb: number
  network: 'mainnet' | 'devnet'
}

// Jeju Solana RPC Configuration

const JEJU_SOLANA_NODES: Record<string, SolanaNodeConfig> = {
  'jeju-mainnet': {
    rpcUrl: 'https://solana-rpc.jejunetwork.org',
    wsUrl: 'wss://solana-ws.jejunetwork.org',
    commitment: 'confirmed',
  },
  'jeju-devnet': {
    rpcUrl: 'https://solana-devnet-rpc.jejunetwork.org',
    wsUrl: 'wss://solana-devnet-ws.jejunetwork.org',
    commitment: 'confirmed',
  },
  'solana-mainnet': {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    commitment: 'confirmed',
  },
  'solana-devnet': {
    rpcUrl: 'https://api.devnet.solana.com',
    commitment: 'confirmed',
  },
}

// Solana Infrastructure Manager

export class SolanaInfraManager {
  private connection: Connection
  private readonly network: string

  constructor(
    network: 'mainnet' | 'devnet' = 'devnet',
    customConfig?: SolanaNodeConfig,
  ) {
    this.network = network
    const config = customConfig ?? this.selectBestNode(network)
    this.connection = new Connection(config.rpcUrl, {
      commitment: config.commitment,
      wsEndpoint: config.wsUrl,
    })
  }

  private selectBestNode(network: 'mainnet' | 'devnet'): SolanaNodeConfig {
    return network === 'mainnet'
      ? JEJU_SOLANA_NODES['solana-mainnet']
      : JEJU_SOLANA_NODES['solana-devnet']
  }

  getConnection(): Connection {
    return this.connection
  }

  async isHealthy(): Promise<boolean> {
    const version = await this.connection.getVersion()
    return version['solana-core'] !== undefined
  }

  async getStatus(): Promise<{
    slot: number
    blockHeight: number
    healthy: boolean
    latency: number
  }> {
    const start = Date.now()
    const [slot, blockHeight] = await Promise.all([
      this.connection.getSlot(),
      this.connection.getBlockHeight(),
    ])
    return {
      slot,
      blockHeight,
      healthy: true,
      latency: Date.now() - start,
    }
  }

  async deployToken(
    payer: Keypair,
    config: SolanaTokenDeployConfig,
  ): Promise<SolanaDeploymentResult> {
    console.log(`Deploying SPL token: ${config.name} (${config.symbol})`)

    const mint = await createMint(
      this.connection,
      payer,
      config.mintAuthority,
      config.freezeAuthority ?? null,
      config.decimals,
    )

    console.log(`Mint created: ${mint.toBase58()}`)

    const ata = await getAssociatedTokenAddress(mint, payer.publicKey)
    const ataInfo = await this.connection.getAccountInfo(ata)

    const tx = new Transaction()
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          payer.publicKey,
          mint,
        ),
      )
    }

    if (config.initialSupply > 0n) {
      tx.add(
        createMintToInstruction(
          mint,
          ata,
          config.mintAuthority,
          config.initialSupply,
        ),
      )
    }

    let signature = ''
    if (tx.instructions.length > 0) {
      signature = await sendAndConfirmTransaction(this.connection, tx, [payer])
      console.log(`Initial supply minted: ${signature}`)
    }

    const explorerUrl =
      this.network === 'mainnet'
        ? `https://explorer.solana.com/address/${mint.toBase58()}`
        : `https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`

    return { mint, signature, explorerUrl }
  }

  async getTokenInfo(mint: PublicKey): Promise<{
    supply: bigint
    decimals: number
    mintAuthority: PublicKey | null
    freezeAuthority: PublicKey | null
  }> {
    const mintInfo = await getMint(this.connection, mint)
    return {
      supply: mintInfo.supply,
      decimals: mintInfo.decimals,
      mintAuthority: mintInfo.mintAuthority,
      freezeAuthority: mintInfo.freezeAuthority,
    }
  }

  async airdrop(recipient: PublicKey, amount: number = 1): Promise<string> {
    if (this.network === 'mainnet') {
      throw new Error('Airdrop not available on mainnet')
    }
    const signature = await this.connection.requestAirdrop(
      recipient,
      amount * LAMPORTS_PER_SOL,
    )
    await this.connection.confirmTransaction(signature, 'confirmed')
    return signature
  }

  async getBalance(address: PublicKey): Promise<number> {
    const balance = await this.connection.getBalance(address)
    return balance / LAMPORTS_PER_SOL
  }
}

// Warp Route Manager

export class SolanaWarpRouteManager {
  // Hyperlane program addresses for reference:
  // mailbox: mainnet=EitxJuv2iBjsg2d7jVy2LDC1e2zBrx4GB5Y9h2Ko3A9Y, devnet=E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi
  // igp: mainnet=Hs7KVBU67nBnWhDj4MWXdUCMJd6v5tQYNrVDRHhhmDPF, devnet=3TJMcAhHRE7JN98URK7s5eeGfmVSvL4GAgegPq5K2nYg

  async getWarpRouteInstructions(
    config: HyperlaneWarpConfig,
  ): Promise<string[]> {
    return [
      `1. Install Hyperlane CLI: npm i -g @hyperlane-xyz/cli`,
      `2. Create warp route config for Solana <-> EVM chain ${config.evmChainId}`,
      `3. Deploy: hyperlane warp deploy --config warp-config.yaml`,
      `4. Verify: hyperlane warp verify`,
    ]
  }
}

// Factory Functions

export function createSolanaInfra(
  network: 'mainnet' | 'devnet' = 'devnet',
): SolanaInfraManager {
  return new SolanaInfraManager(network)
}

export function createSolanaWarpRouteManager(): SolanaWarpRouteManager {
  return new SolanaWarpRouteManager()
}

// Terraform Config Generator

export function generateSolanaTerraformConfig(
  config: SolanaTerraformConfig,
): string {
  return `
# Solana RPC Node Infrastructure for Jeju Network
# Auto-generated configuration

variable "solana_network" {
  default = "${config.network}"
}

variable "solana_node_count" {
  default = ${config.nodeCount}
}

variable "solana_instance_type" {
  default = "${config.instanceType}"
}

variable "solana_disk_size_gb" {
  default = ${config.diskSizeGb}
}

# See /packages/deployment/terraform/modules/aws/solana for full implementation
`
}
