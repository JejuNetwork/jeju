import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodePacked,
  type Hex,
  http,
  keccak256,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { safeReadContract } from '../viem'
import {
  FEDERATED_IDENTITY_ABI,
  FEDERATED_LIQUIDITY_ABI,
  FEDERATED_SOLVER_ABI,
  NETWORK_REGISTRY_ABI,
} from './abis'
import type {
  FederationConfig,
  IdentityVerification,
  NetworkContracts,
  NetworkInfo,
  RawAttestation,
  RawNetworkInfo,
} from './types'
import { toAttestation, toNetworkInfo } from './types'

export class FederationClient {
  private config: FederationConfig
  private hubClient: ReturnType<typeof createPublicClient>
  private localClient: ReturnType<typeof createPublicClient>
  private walletClient?: WalletClient

  constructor(config: FederationConfig) {
    this.config = config
    this.hubClient = createPublicClient({ transport: http(config.hubRpcUrl) })
    this.localClient = createPublicClient({
      transport: http(config.localRpcUrl),
    })
  }

  setWallet(privateKey: Hex): void {
    const account = privateKeyToAccount(privateKey)
    this.walletClient = createWalletClient({
      account,
      transport: http(this.config.hubRpcUrl),
    })
  }

  async registerNetwork(
    name: string,
    rpcUrl: string,
    explorerUrl: string,
    wsUrl: string,
    contracts: NetworkContracts,
    genesisHash: Hex,
    stake: bigint,
  ): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet not configured')

    const contractsTuple = {
      identityRegistry: contracts.identityRegistry,
      solverRegistry: contracts.solverRegistry,
      inputSettler: contracts.inputSettler,
      outputSettler: contracts.outputSettler,
      liquidityVault: contracts.liquidityVault,
      governance: contracts.governance,
      oracle: contracts.oracle,
    }

    const account = this.walletClient.account
    if (!account) throw new Error('Wallet account not available')

    const hash = await this.walletClient.writeContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'registerNetwork',
      args: [
        BigInt(this.config.localChainId),
        name,
        rpcUrl,
        explorerUrl,
        wsUrl,
        contractsTuple,
        genesisHash,
      ],
      value: stake,
      chain: null,
      account,
    })

    return hash
  }

  async updateNetwork(
    name: string,
    rpcUrl: string,
    explorerUrl: string,
    wsUrl: string,
  ): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet not configured')

    const account = this.walletClient.account
    if (!account) throw new Error('Wallet account not available')

    return this.walletClient.writeContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'updateNetwork',
      args: [
        BigInt(this.config.localChainId),
        name,
        rpcUrl,
        explorerUrl,
        wsUrl,
      ],
      chain: null,
      account,
    })
  }

  async updateContracts(contracts: NetworkContracts): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet not configured')

    const contractsTuple = {
      identityRegistry: contracts.identityRegistry,
      solverRegistry: contracts.solverRegistry,
      inputSettler: contracts.inputSettler,
      outputSettler: contracts.outputSettler,
      liquidityVault: contracts.liquidityVault,
      governance: contracts.governance,
      oracle: contracts.oracle,
    }

    const account = this.walletClient.account
    if (!account) throw new Error('Wallet account not available')

    return this.walletClient.writeContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'updateContracts',
      args: [BigInt(this.config.localChainId), contractsTuple],
      chain: null,
      account,
    })
  }

  async establishTrust(targetChainId: number): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet not configured')

    const account = this.walletClient.account
    if (!account) throw new Error('Wallet account not available')

    return this.walletClient.writeContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'establishTrust',
      args: [BigInt(this.config.localChainId), BigInt(targetChainId)],
      chain: null,
      account,
    })
  }

  async revokeTrust(targetChainId: number): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet not configured')

    const account = this.walletClient.account
    if (!account) throw new Error('Wallet account not available')

    return this.walletClient.writeContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'revokeTrust',
      args: [BigInt(this.config.localChainId), BigInt(targetChainId)],
      chain: null,
      account,
    })
  }

  async getNetwork(chainId: number): Promise<NetworkInfo> {
    const result = (await safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getNetwork',
      args: [BigInt(chainId)],
    })) as RawNetworkInfo
    return toNetworkInfo(result)
  }

  async getActiveNetworks(): Promise<number[]> {
    const result = (await safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getActiveNetworks',
    })) as bigint[]
    return result.map((n) => Number(n))
  }

  async getVerifiedNetworks(): Promise<number[]> {
    const result = (await safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getVerifiedNetworks',
    })) as bigint[]
    return result.map((n) => Number(n))
  }

  async getTrustedPeers(chainId: number): Promise<number[]> {
    const result = (await safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getTrustedPeers',
      args: [BigInt(chainId)],
    })) as bigint[]
    return result.map((n) => Number(n))
  }

  async isTrusted(
    sourceChainId: number,
    targetChainId: number,
  ): Promise<boolean> {
    return safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'isTrusted',
      args: [BigInt(sourceChainId), BigInt(targetChainId)],
    }) as Promise<boolean>
  }

  async isMutuallyTrusted(chainA: number, chainB: number): Promise<boolean> {
    return safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'isMutuallyTrusted',
      args: [BigInt(chainA), BigInt(chainB)],
    }) as Promise<boolean>
  }

  async federateLocalAgent(localAgentId: number, signature: Hex): Promise<Hex> {
    if (!this.walletClient || !this.config.federatedIdentityAddress) {
      throw new Error('Wallet or FederatedIdentity not configured')
    }

    const account = this.walletClient.account
    if (!account) throw new Error('Wallet account not available')

    return this.walletClient.writeContract({
      address: this.config.federatedIdentityAddress,
      abi: FEDERATED_IDENTITY_ABI,
      functionName: 'federateLocalAgent',
      args: [BigInt(localAgentId), signature],
      chain: null,
      account,
    })
  }

  async verifyIdentity(
    originChainId: number,
    originAgentId: number,
  ): Promise<IdentityVerification> {
    if (!this.config.federatedIdentityAddress) {
      throw new Error('FederatedIdentity not configured')
    }

    const [isValid, federatedId, reputation] = (await safeReadContract(
      this.localClient,
      {
        address: this.config.federatedIdentityAddress,
        abi: FEDERATED_IDENTITY_ABI,
        functionName: 'verifyIdentity',
        args: [BigInt(originChainId), BigInt(originAgentId)],
      },
    )) as [boolean, Hex, bigint]

    let attestedNetworks: number[] = []
    if (isValid) {
      const attestations = (await safeReadContract(this.localClient, {
        address: this.config.federatedIdentityAddress,
        abi: FEDERATED_IDENTITY_ABI,
        functionName: 'getAttestations',
        args: [federatedId],
      })) as readonly RawAttestation[]
      attestedNetworks = attestations.map((a) => toAttestation(a).targetChainId)
    }

    return {
      isValid,
      federatedId,
      reputation: Number(reputation),
      attestedNetworks,
    }
  }

  async federateSolver(supportedChains: number[]): Promise<Hex> {
    if (!this.walletClient || !this.config.federatedSolverAddress) {
      throw new Error('Wallet or FederatedSolver not configured')
    }

    const account = this.walletClient.account
    if (!account) throw new Error('Wallet account not available')

    return this.walletClient.writeContract({
      address: this.config.federatedSolverAddress,
      abi: FEDERATED_SOLVER_ABI,
      functionName: 'federateLocalSolver',
      args: [supportedChains.map((c) => BigInt(c))],
      chain: null,
      account,
    })
  }

  async getSolversForRoute(
    sourceChainId: number,
    destChainId: number,
  ): Promise<Hex[]> {
    if (!this.config.federatedSolverAddress) {
      throw new Error('FederatedSolver not configured')
    }

    return safeReadContract(this.localClient, {
      address: this.config.federatedSolverAddress,
      abi: FEDERATED_SOLVER_ABI,
      functionName: 'getSolversForRoute',
      args: [BigInt(sourceChainId), BigInt(destChainId)],
    }) as Promise<Hex[]>
  }

  async getBestSolverForRoute(
    sourceChainId: number,
    destChainId: number,
  ): Promise<{
    solverId: Hex
    stake: bigint
    successRate: number
  }> {
    if (!this.config.federatedSolverAddress) {
      throw new Error('FederatedSolver not configured')
    }

    const [solverId, stake, successRate] = (await safeReadContract(
      this.localClient,
      {
        address: this.config.federatedSolverAddress,
        abi: FEDERATED_SOLVER_ABI,
        functionName: 'getBestSolverForRoute',
        args: [BigInt(sourceChainId), BigInt(destChainId)],
      },
    )) as [Hex, bigint, bigint]

    return {
      solverId,
      stake,
      successRate: Number(successRate),
    }
  }

  async registerXLP(supportedChains: number[]): Promise<Hex> {
    if (!this.walletClient || !this.config.federatedLiquidityAddress) {
      throw new Error('Wallet or FederatedLiquidity not configured')
    }

    const account = this.walletClient.account
    if (!account) throw new Error('Wallet account not available')

    return this.walletClient.writeContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'registerXLP',
      args: [supportedChains.map((c) => BigInt(c))],
      chain: null,
      account,
    })
  }

  async getTotalFederatedLiquidity(): Promise<{
    totalEth: bigint
    totalToken: bigint
  }> {
    if (!this.config.federatedLiquidityAddress) {
      throw new Error('FederatedLiquidity not configured')
    }

    const [totalEth, totalToken] = (await safeReadContract(this.localClient, {
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getTotalFederatedLiquidity',
    })) as [bigint, bigint]

    return { totalEth, totalToken }
  }

  async getBestNetworkForLiquidity(
    amount: bigint,
  ): Promise<{ chainId: number; available: bigint }> {
    if (!this.config.federatedLiquidityAddress) {
      throw new Error('FederatedLiquidity not configured')
    }

    const [chainId, available] = (await safeReadContract(this.localClient, {
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getBestNetworkForLiquidity',
      args: [amount],
    })) as [bigint, bigint]

    return { chainId: Number(chainId), available }
  }

  async createLiquidityRequest(
    token: Address,
    amount: bigint,
    targetChainId: number,
  ): Promise<Hex> {
    if (!this.walletClient || !this.config.federatedLiquidityAddress) {
      throw new Error('Wallet or FederatedLiquidity not configured')
    }

    const isETH = token === '0x0000000000000000000000000000000000000000'

    const account = this.walletClient.account
    if (!account) throw new Error('Wallet account not available')

    return this.walletClient.writeContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'createRequest',
      args: [token, amount, BigInt(targetChainId)],
      value: isETH ? amount : 0n,
      chain: null,
      account,
    })
  }

  async getXLPsForRoute(
    sourceChain: number,
    destChain: number,
  ): Promise<Address[]> {
    if (!this.config.federatedLiquidityAddress) {
      throw new Error('FederatedLiquidity not configured')
    }

    return safeReadContract(this.localClient, {
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getXLPsForRoute',
      args: [BigInt(sourceChain), BigInt(destChain)],
    }) as Promise<Address[]>
  }

  computeFederatedAgentId(chainId: number, agentId: number): Hex {
    return keccak256(
      encodePacked(
        ['string', 'uint256', 'string', 'uint256'],
        ['jeju:federated:', BigInt(chainId), ':', BigInt(agentId)],
      ),
    )
  }

  computeFederatedSolverId(solver: Address, chainId: number): Hex {
    return keccak256(
      encodePacked(
        ['string', 'uint256', 'string', 'address'],
        ['jeju:solver:', BigInt(chainId), ':', solver],
      ),
    )
  }
}

export function createFederationClient(
  config: FederationConfig,
): FederationClient {
  return new FederationClient(config)
}
