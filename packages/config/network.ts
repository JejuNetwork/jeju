/**
 * @fileoverview Network Configuration
 * @module config/network
 *
 * Network deployment data - all loaded via direct JSON imports.
 * Browser-safe, no filesystem operations.
 */

// Direct JSON imports for deployment data
import localnetDeployment from '../contracts/deployments/localnet/deployment.json'
import mainnetDeployment from '../contracts/deployments/mainnet/deployment.json'
import testnetDeployment from '../contracts/deployments/testnet/deployment.json'
import { NetworkSchema, type NetworkType, RpcHexResultSchema } from './schemas'

// Types

export interface DeployedContracts {
  // Tokens
  usdc?: string
  weth?: string
  jeju?: string
  elizaOS?: string

  // Core Infrastructure
  entryPoint?: string
  creditManager?: string
  serviceRegistry?: string
  priceOracle?: string

  // Paymaster System
  tokenRegistry?: string
  paymasterFactory?: string
  liquidityPaymaster?: string
  multiTokenPaymaster?: string

  // Registry System (ERC-8004)
  identityRegistry?: string
  reputationRegistry?: string
  validationRegistry?: string

  // DeFi
  liquidityVault?: string
  feeDistributor?: string
  poolManager?: string
  swapRouter?: string
  positionManager?: string
  quoterV4?: string
  stateView?: string

  // Node Staking
  nodeStakingManager?: string
  nodePerformanceOracle?: string

  // Moderation
  banManager?: string
  reputationLabelManager?: string
  reportingSystem?: string

  // Compute Marketplace
  computeRegistry?: string
  computeRental?: string
  ledgerManager?: string
  inferenceServing?: string
  computeStaking?: string

  // Governance
  registryGovernance?: string
  futarchyGovernor?: string

  // OIF (Open Intents Framework)
  solverRegistry?: string
  inputSettler?: string
  outputSettler?: string
  oifOracle?: string

  // Games
  bazaarMarketplace?: string
  goldToken?: string
  itemsNFT?: string
  predimarket?: string

  // Bridge
  l2CrossDomainMessenger?: string
  l2StandardBridge?: string
  l2ToL1MessagePasser?: string
  l2ERC721Bridge?: string

  [key: string]: string | undefined
}

export interface NetworkInfo {
  network: NetworkType
  contracts: DeployedContracts
  chainId: number
  l1ChainId: number
  isAvailable: boolean
  rpcReachable: boolean
  hasBalance: boolean
}

// Deployment Data

type ContractCategory = Record<string, string | null>

interface DeploymentJson {
  network: string
  chainId: number
  l1ChainId: number
  tokens?: ContractCategory
  bridge?: ContractCategory
  infrastructure?: ContractCategory
  paymaster?: ContractCategory
  registry?: ContractCategory
  defi?: ContractCategory
  nodeStaking?: ContractCategory
  moderation?: ContractCategory
  compute?: ContractCategory
  oif?: ContractCategory
  games?: ContractCategory
  jns?: ContractCategory
  payments?: ContractCategory
  security?: ContractCategory
  [key: string]: string | number | ContractCategory | null | undefined
}

const deployments: Record<NetworkType, DeploymentJson> = {
  localnet: localnetDeployment as DeploymentJson,
  testnet: testnetDeployment as DeploymentJson,
  mainnet: mainnetDeployment as DeploymentJson,
}

/**
 * Extract all contract addresses from a deployment JSON
 */
function extractContracts(deployment: DeploymentJson): DeployedContracts {
  const contracts: DeployedContracts = {}

  // Categories that should be prefixed when flattening (e.g., jns.registrar -> jnsRegistrar)
  const prefixedCategories = ['jns', 'payments', 'security'] as const

  const categories = [
    'tokens',
    'bridge',
    'infrastructure',
    'paymaster',
    'registry',
    'defi',
    'nodeStaking',
    'moderation',
    'compute',
    'oif',
    'games',
    ...prefixedCategories,
  ] as const

  for (const category of categories) {
    const data = deployment[category]
    if (!data || typeof data !== 'object') continue
    const shouldPrefix = prefixedCategories.includes(
      category as (typeof prefixedCategories)[number],
    )
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.startsWith('0x')) {
        // Prefix nested keys for certain categories (jns.registrar -> jnsRegistrar)
        const contractKey = shouldPrefix
          ? `${category}${key.charAt(0).toUpperCase()}${key.slice(1)}`
          : key
        contracts[contractKey] = value
      }
    }
  }

  return contracts
}

// Pre-computed contracts per network
const contractsCache: Record<NetworkType, DeployedContracts> = {
  localnet: extractContracts(deployments.localnet),
  testnet: extractContracts(deployments.testnet),
  mainnet: extractContracts(deployments.mainnet),
}

// Defaults

/**
 * Default test accounts from Anvil/Foundry - use for local development only.
 *
 * @security WARNING: These private keys are publicly known and included in every Anvil instance.
 * NEVER send real funds to these addresses. The getDeployerConfig() function enforces
 * that these keys can ONLY be used on localnet - testnet/mainnet require explicit env vars.
 */
export const TEST_ACCOUNTS = {
  DEPLOYER: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  USER_1: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey:
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  USER_2: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey:
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
} as const

/** L2 Predeploy addresses (same on all OP-Stack chains) */
export const L2_PREDEPLOYS = {
  L2CrossDomainMessenger: '0x4200000000000000000000000000000000000007',
  L2StandardBridge: '0x4200000000000000000000000000000000000010',
  L2ToL1MessagePasser: '0x4200000000000000000000000000000000000016',
  L2ERC721Bridge: '0x4200000000000000000000000000000000000014',
  GasPriceOracle: '0x420000000000000000000000000000000000000F',
  L1Block: '0x4200000000000000000000000000000000000015',
  WETH: '0x4200000000000000000000000000000000000006',
} as const

/** Standard ERC-4337 EntryPoint */
export const ENTRYPOINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'

// Configuration Loading

/**
 * Load deployed contract addresses for a network
 */
export function loadDeployedContracts(network: NetworkType): DeployedContracts {
  return { ...contractsCache[network], weth: L2_PREDEPLOYS.WETH }
}

// Network Detection & Status

/**
 * Get the current network based on environment or default
 * Validates JEJU_NETWORK env var and throws on invalid values
 */
export function getCurrentNetwork(): NetworkType {
  const envNetwork = process.env.JEJU_NETWORK

  // No env var set - default to localnet for development
  if (!envNetwork) return 'localnet'

  // Validate with Zod schema
  const result = NetworkSchema.safeParse(envNetwork)
  if (!result.success) {
    throw new Error(
      `Invalid JEJU_NETWORK: ${envNetwork}. Must be one of: localnet, testnet, mainnet`,
    )
  }

  return result.data
}

/**
 * Check if an RPC endpoint is reachable
 */
export async function checkRpcReachable(rpcUrl: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    }),
    signal: controller.signal,
  }).catch((): null => null)

  clearTimeout(timeout)

  if (!response?.ok) return false

  const parseResult = RpcHexResultSchema.safeParse(await response.json())
  if (!parseResult.success) return false
  return parseResult.data.result !== undefined
}

/**
 * Check if an address has balance on a network
 */
export async function checkHasBalance(
  rpcUrl: string,
  address: string,
): Promise<boolean> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1,
    }),
  }).catch((): null => null)

  if (!response?.ok) return false

  const parseResult = RpcHexResultSchema.safeParse(await response.json())
  if (!parseResult.success || !parseResult.data.result) return false

  const balance = BigInt(parseResult.data.result)
  return balance > BigInt(0)
}

/**
 * Get complete network info with availability status
 */
export async function getNetworkInfo(
  network: NetworkType,
  rpcUrl: string,
): Promise<NetworkInfo> {
  const deployment = deployments[network]
  const contracts = loadDeployedContracts(network)

  // Check RPC availability
  const rpcReachable = await checkRpcReachable(rpcUrl)

  // Check if we have a funded account
  let hasBalance = false
  if (rpcReachable) {
    const deployerAddress =
      process.env.DEPLOYER_ADDRESS || TEST_ACCOUNTS.DEPLOYER.address
    hasBalance = await checkHasBalance(rpcUrl, deployerAddress)
  }

  return {
    network,
    contracts,
    chainId: deployment.chainId,
    l1ChainId: deployment.l1ChainId,
    isAvailable: rpcReachable && hasBalance,
    rpcReachable,
    hasBalance,
  }
}

// Convenience Getters

/**
 * Get chain ID for a network
 */
export function getChainId(network?: NetworkType): number {
  const net = network || getCurrentNetwork()
  return deployments[net].chainId
}

/**
 * Get a specific contract address
 */
export function getContractAddress(
  contractName: keyof DeployedContracts,
  network?: NetworkType,
): string {
  const net = network || getCurrentNetwork()

  // Check environment variable first
  const envKey = `${String(contractName)
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()}_ADDRESS`
  const envAddress = process.env[envKey]
  if (envAddress) return envAddress

  // Load from deployment data
  const contracts = loadDeployedContracts(net)
  const address = contracts[contractName]

  if (!address) {
    throw new Error(
      `Contract ${contractName} not deployed on ${net}. ` +
        `Run deployment first or set ${envKey} environment variable.`,
    )
  }

  return address
}

/**
 * Get deployer configuration
 * For localnet, uses test accounts. For other networks, requires explicit env vars.
 */
export function getDeployerConfig(): { address: string; privateKey: string } {
  const network = getCurrentNetwork()

  // For localnet, allow test accounts as fallback
  if (network === 'localnet') {
    return {
      address: process.env.DEPLOYER_ADDRESS ?? TEST_ACCOUNTS.DEPLOYER.address,
      privateKey:
        process.env.DEPLOYER_PRIVATE_KEY ?? TEST_ACCOUNTS.DEPLOYER.privateKey,
    }
  }

  // For testnet/mainnet, require explicit configuration
  const address = process.env.DEPLOYER_ADDRESS
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY

  if (!address) {
    throw new Error(
      `DEPLOYER_ADDRESS required for ${network}. Test accounts only allowed on localnet.`,
    )
  }
  if (!privateKey) {
    throw new Error(
      `DEPLOYER_PRIVATE_KEY required for ${network}. Test accounts only allowed on localnet.`,
    )
  }

  return { address, privateKey }
}
