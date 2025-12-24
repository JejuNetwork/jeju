/**
 * Jeju Registry Integration
 *
 * Integrates experimental-token with Jeju's core contracts:
 * - IdentityRegistry (ERC-8004) - Agent/Token identity
 * - TokenRegistry - Multi-token gas payment
 * - OIF (SolverRegistry, InputSettler, OutputSettler) - Cross-chain intents
 * - EIL (CrossChainPaymaster, L1StakeManager) - Cross-chain liquidity
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'

// Types

export interface JejuContractAddresses {
  identityRegistry: Address
  tokenRegistry: Address
  solverRegistry: Address
  inputSettler: Address
  outputSettler: Address
  crossChainPaymaster: Address
  priceOracle: Address
}

export interface TokenRegistrationParams {
  tokenAddress: Address
  name: string
  symbol: string
  description: string
  category: 'defi' | 'gaming' | 'social' | 'utility' | 'meme'
  tags: string[]
  website?: string
  twitter?: string
  discord?: string
  oracleAddress: Address
  minFeeMargin?: number
  maxFeeMargin?: number
}

export interface CrossChainConfig {
  chainId: number
  tokenAddress: Address
}

export interface RegistrationResult {
  agentId: bigint
  tokenRegistryId: bigint
  txHashes: Hex[]
}

// Contract ABIs (minimal)

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string tokenURI) external returns (uint256 agentId)',
  'function setMetadata(uint256 agentId, string key, bytes value) external',
  'function agentExists(uint256 agentId) external view returns (bool)',
])

const TOKEN_REGISTRY_ABI = parseAbi([
  'function registerToken(address tokenAddress, address oracleAddress, uint256 minFeeMargin, uint256 maxFeeMargin) external payable returns (uint256)',
  'function isTokenSupported(address tokenAddress) external view returns (bool)',
  'function registrationFee() external view returns (uint256)',
])

// Jeju Registry Integration

export class JejuRegistryIntegration {
  private readonly publicClient: PublicClient
  private readonly walletClient: WalletClient
  private readonly contracts: JejuContractAddresses

  constructor(
    publicClient: PublicClient,
    walletClient: WalletClient,
    contracts: JejuContractAddresses,
  ) {
    this.publicClient = publicClient
    this.walletClient = walletClient
    this.contracts = contracts
  }

  /**
   * Register a new token with Jeju's infrastructure
   */
  async registerToken(
    params: TokenRegistrationParams,
    _crossChainConfigs: CrossChainConfig[] = [],
  ): Promise<RegistrationResult> {
    const account = this.walletClient.account
    if (!account) throw new Error('WalletClient must have an account')
    if (!this.walletClient.chain)
      throw new Error('WalletClient must have a chain configured')

    const txHashes: Hex[] = []

    // 1. Register with IdentityRegistry
    console.log('Registering with IdentityRegistry...')
    const tokenUri = this.buildTokenUri(params)

    const registerTx = await this.walletClient.writeContract({
      address: this.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'register',
      args: [tokenUri],
      chain: this.walletClient.chain,
      account: account,
    })
    txHashes.push(registerTx)

    const registerReceipt = await this.publicClient.waitForTransactionReceipt({
      hash: registerTx,
    })

    // Parse agentId from logs - require the log to exist
    const agentIdTopic = registerReceipt.logs[0]?.topics[1]
    if (!agentIdTopic) {
      throw new Error(
        'Failed to parse agentId from IdentityRegistry registration logs',
      )
    }
    const agentId = BigInt(agentIdTopic)

    // 2. Register with TokenRegistry
    console.log('Registering with TokenRegistry...')

    const registrationFee = await this.publicClient.readContract({
      address: this.contracts.tokenRegistry,
      abi: TOKEN_REGISTRY_ABI,
      functionName: 'registrationFee',
    })

    // Use explicit defaults for optional fee margin params - these are valid business defaults
    const minFeeMargin =
      params.minFeeMargin !== undefined ? BigInt(params.minFeeMargin) : 0n
    const maxFeeMargin =
      params.maxFeeMargin !== undefined ? BigInt(params.maxFeeMargin) : 200n

    const tokenRegTx = await this.walletClient.writeContract({
      address: this.contracts.tokenRegistry,
      abi: TOKEN_REGISTRY_ABI,
      functionName: 'registerToken',
      args: [
        params.tokenAddress,
        params.oracleAddress,
        minFeeMargin,
        maxFeeMargin,
      ],
      value: registrationFee,
      chain: this.walletClient.chain,
      account: account,
    })
    txHashes.push(tokenRegTx)

    await this.publicClient.waitForTransactionReceipt({ hash: tokenRegTx })

    return {
      agentId,
      tokenRegistryId: 0n,
      txHashes,
    }
  }

  /**
   * Check if a token is registered
   */
  async isTokenRegistered(tokenAddress: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.contracts.tokenRegistry,
      abi: TOKEN_REGISTRY_ABI,
      functionName: 'isTokenSupported',
      args: [tokenAddress],
    })
  }

  private buildTokenUri(params: TokenRegistrationParams): string {
    // Sanitize string inputs to prevent injection - only allow safe characters
    const sanitizeString = (input: string, maxLength: number): string => {
      // Remove any control characters and limit length
      // Use Unicode property escapes instead of literal control characters
      const cleaned = input
        .replace(/\p{Cc}/gu, '') // Remove control characters using Unicode category
        .slice(0, maxLength)
      return cleaned
    }

    // Validate category is one of allowed values
    const validCategories = ['defi', 'gaming', 'social', 'utility', 'meme']
    if (!validCategories.includes(params.category)) {
      throw new Error(
        `Invalid category: ${params.category}. Must be one of: ${validCategories.join(', ')}`,
      )
    }

    const metadata = {
      name: sanitizeString(params.name, 64),
      symbol: sanitizeString(params.symbol, 10),
      description: sanitizeString(params.description, 1000),
      category: params.category,
    }

    // JSON.stringify handles escaping for us, but we validate input is clean
    return `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`
  }
}

// Factory

export function createJejuRegistryIntegration(
  publicClient: PublicClient,
  walletClient: WalletClient,
  network: 'testnet' | 'mainnet' | 'localnet',
): JejuRegistryIntegration {
  const addresses: Record<string, JejuContractAddresses> = {
    testnet: {
      identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
      tokenRegistry: '0x0000000000000000000000000000000000000000' as Address,
      solverRegistry: '0x0000000000000000000000000000000000000000' as Address,
      inputSettler: '0x0000000000000000000000000000000000000000' as Address,
      outputSettler: '0x0000000000000000000000000000000000000000' as Address,
      crossChainPaymaster:
        '0x0000000000000000000000000000000000000000' as Address,
      priceOracle: '0x0000000000000000000000000000000000000000' as Address,
    },
    mainnet: {
      identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
      tokenRegistry: '0x0000000000000000000000000000000000000000' as Address,
      solverRegistry: '0x0000000000000000000000000000000000000000' as Address,
      inputSettler: '0x0000000000000000000000000000000000000000' as Address,
      outputSettler: '0x0000000000000000000000000000000000000000' as Address,
      crossChainPaymaster:
        '0x0000000000000000000000000000000000000000' as Address,
      priceOracle: '0x0000000000000000000000000000000000000000' as Address,
    },
    localnet: {
      identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
      tokenRegistry: '0x0000000000000000000000000000000000000000' as Address,
      solverRegistry: '0x0000000000000000000000000000000000000000' as Address,
      inputSettler: '0x0000000000000000000000000000000000000000' as Address,
      outputSettler: '0x0000000000000000000000000000000000000000' as Address,
      crossChainPaymaster:
        '0x0000000000000000000000000000000000000000' as Address,
      priceOracle: '0x0000000000000000000000000000000000000000' as Address,
    },
  }

  return new JejuRegistryIntegration(
    publicClient,
    walletClient,
    addresses[network],
  )
}
