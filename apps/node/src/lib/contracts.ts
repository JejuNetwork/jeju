import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getLocalnetChain,
  getMainnetChain,
  getTestnetChain,
} from '@jejunetwork/shared'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

// Schema for deployment address files
const DeploymentAddressesSchema = z.record(z.string(), z.string())

// Load addresses from deployment files
function loadAddressesFromDeployment(
  network: 'testnet' | 'mainnet',
): ContractAddresses | null {
  const deploymentPath = join(
    process.cwd(),
    'packages',
    'contracts',
    'deployments',
    network,
    'addresses.json',
  )
  if (!existsSync(deploymentPath)) {
    return null
  }
  const data = DeploymentAddressesSchema.parse(
    JSON.parse(readFileSync(deploymentPath, 'utf-8')),
  )

  // Helper to get address with validation
  const getAddress = (pascalKey: string, camelKey: string): Address => {
    const value = data[pascalKey] ?? data[camelKey]
    if (!value) {
      throw new Error(
        `Missing contract address for ${pascalKey} in ${network} deployment`,
      )
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
      throw new Error(`Invalid contract address for ${pascalKey}: ${value}`)
    }
    return value as Address
  }

  // Helper for optional addresses (contracts that may not be deployed yet)
  const getOptionalAddress = (pascalKey: string, camelKey: string): Address => {
    const value = data[pascalKey] ?? data[camelKey]
    if (!value) {
      return '0x0000000000000000000000000000000000000000' as Address
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
      throw new Error(`Invalid contract address for ${pascalKey}: ${value}`)
    }
    return value as Address
  }

  return {
    identityRegistry: getAddress('IdentityRegistry', 'identityRegistry'),
    nodeStakingManager: getAddress('NodeStakingManager', 'nodeStakingManager'),
    computeRegistry: getOptionalAddress('ComputeRegistry', 'computeRegistry'),
    computeStaking: getOptionalAddress('ComputeStaking', 'computeStaking'),
    inferenceServing: getOptionalAddress(
      'InferenceServing',
      'inferenceServing',
    ),
    triggerRegistry: getOptionalAddress('TriggerRegistry', 'triggerRegistry'),
    storageMarket: getOptionalAddress('StorageMarket', 'storageMarket'),
    contentRegistry: getOptionalAddress('ContentRegistry', 'contentRegistry'),
    oracleStakingManager: getOptionalAddress(
      'OracleStakingManager',
      'oracleStakingManager',
    ),
    feedRegistry: getOptionalAddress('FeedRegistry', 'feedRegistry'),
    reportVerifier: getOptionalAddress('ReportVerifier', 'reportVerifier'),
    proxyRegistry: getOptionalAddress('ProxyRegistry', 'proxyRegistry'),
    sequencerRegistry: getOptionalAddress(
      'SequencerRegistry',
      'sequencerRegistry',
    ),
    liquidityAggregator: getOptionalAddress(
      'LiquidityAggregator',
      'liquidityAggregator',
    ),
    solverRegistry: getOptionalAddress('SolverRegistry', 'solverRegistry'),
    feeDistributor: getOptionalAddress('FeeDistributor', 'feeDistributor'),
    banManager: getOptionalAddress('BanManager', 'banManager'),
    cdnRegistry: getOptionalAddress('CDNRegistry', 'cdnRegistry'),
    cdnBilling: getOptionalAddress('CDNBilling', 'cdnBilling'),
    vpnRegistry: getOptionalAddress('VPNRegistry', 'vpnRegistry'),
  }
}

// Chain definitions from shared config
export const jejuMainnet: Chain = getMainnetChain()
export const jejuTestnet: Chain = { ...getTestnetChain(), testnet: true }
export const networkLocalnet: Chain = getLocalnetChain()

// Contract addresses by network
export interface ContractAddresses {
  identityRegistry: Address
  nodeStakingManager: Address
  computeRegistry: Address
  computeStaking: Address
  inferenceServing: Address
  triggerRegistry: Address
  storageMarket: Address
  contentRegistry: Address
  oracleStakingManager: Address
  feedRegistry: Address
  reportVerifier: Address
  proxyRegistry: Address
  sequencerRegistry: Address
  liquidityAggregator: Address
  solverRegistry: Address
  feeDistributor: Address
  banManager: Address
  cdnRegistry: Address
  cdnBilling: Address
  vpnRegistry: Address
}

export function getContractAddresses(chainId: number): ContractAddresses {
  // For localnet, addresses are deployed by bootstrap script
  // These are deterministic based on CREATE2
  if (chainId === 1337) {
    return {
      identityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
      nodeStakingManager:
        '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address,
      computeRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address,
      computeStaking: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address,
      inferenceServing: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' as Address,
      triggerRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707' as Address,
      storageMarket: '0x0165878A594ca255338adfa4d48449f69242Eb8F' as Address,
      contentRegistry: '0x68B1D87F95878fE05B998F19b66F4baba5De1aed' as Address,
      oracleStakingManager:
        '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853' as Address,
      feedRegistry: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6' as Address,
      reportVerifier: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318' as Address,
      proxyRegistry: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788' as Address,
      sequencerRegistry:
        '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e' as Address,
      liquidityAggregator:
        '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0' as Address,
      solverRegistry: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82' as Address,
      feeDistributor: '0x9A676e781A523b5d0C0e43731313A708CB607508' as Address,
      banManager: '0x0B306BF915C4d645ff596e518fAf3F9669b97016' as Address,
      cdnRegistry: '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1' as Address,
      cdnBilling: '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE' as Address,
      vpnRegistry: '0x322813Fd9A801c5507c9544993c34B5a5b9B5b7B' as Address,
    }
  }

  // Testnet addresses - loaded from deployment files or environment
  if (chainId === 420691) {
    const fromDeployment = loadAddressesFromDeployment('testnet')
    if (fromDeployment) {
      return fromDeployment
    }

    // Helper to get required address from environment
    const getEnvAddress = (envKey: string, name: string): Address => {
      const value = process.env[envKey]
      if (!value) {
        throw new Error(
          `Missing ${name} address: set ${envKey} environment variable or deploy contracts`,
        )
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
        throw new Error(`Invalid ${name} address in ${envKey}: ${value}`)
      }
      return value as Address
    }

    // Helper for optional addresses
    const getOptionalEnvAddress = (envKey: string): Address => {
      const value = process.env[envKey]
      if (!value) {
        return '0x0000000000000000000000000000000000000000' as Address
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
        throw new Error(`Invalid address in ${envKey}: ${value}`)
      }
      return value as Address
    }

    return {
      identityRegistry: getEnvAddress('IDENTITY_REGISTRY', 'IdentityRegistry'),
      nodeStakingManager: getEnvAddress(
        'NODE_STAKING_MANAGER',
        'NodeStakingManager',
      ),
      computeRegistry: getOptionalEnvAddress('COMPUTE_REGISTRY'),
      computeStaking: getOptionalEnvAddress('COMPUTE_STAKING'),
      inferenceServing: getOptionalEnvAddress('INFERENCE_SERVING'),
      triggerRegistry: getOptionalEnvAddress('TRIGGER_REGISTRY'),
      storageMarket: getOptionalEnvAddress('STORAGE_MARKET'),
      contentRegistry: getOptionalEnvAddress('CONTENT_REGISTRY'),
      oracleStakingManager: getOptionalEnvAddress('ORACLE_STAKING_MANAGER'),
      feedRegistry: getOptionalEnvAddress('FEED_REGISTRY'),
      reportVerifier: getOptionalEnvAddress('REPORT_VERIFIER'),
      proxyRegistry: getOptionalEnvAddress('PROXY_REGISTRY'),
      sequencerRegistry: getOptionalEnvAddress('SEQUENCER_REGISTRY'),
      liquidityAggregator: getOptionalEnvAddress('LIQUIDITY_AGGREGATOR'),
      solverRegistry: getOptionalEnvAddress('SOLVER_REGISTRY'),
      feeDistributor: getOptionalEnvAddress('FEE_DISTRIBUTOR'),
      banManager: '0x0000000000000000000000000000000000000000' as Address,
      cdnRegistry: '0x0000000000000000000000000000000000000000' as Address,
      cdnBilling: '0x0000000000000000000000000000000000000000' as Address,
      vpnRegistry: getOptionalEnvAddress('VPN_REGISTRY'),
    }
  }

  throw new Error(`Unknown chain ID: ${chainId}`)
}

export function getChain(chainId: number): Chain {
  const mainnet = jejuMainnet
  const testnet = jejuTestnet

  switch (chainId) {
    case mainnet.id:
      return mainnet
    case testnet.id:
      return testnet
    case 1337:
      return networkLocalnet
    default:
      throw new Error(`Unknown chain ID: ${chainId}`)
  }
}

export interface NodeClient {
  publicClient: PublicClient
  walletClient: WalletClient | null
  addresses: ContractAddresses
  chainId: number
}

export function createNodeClient(
  rpcUrl: string,
  chainId: number,
  privateKey?: string,
): NodeClient {
  const chain = getChain(chainId)

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  let walletClient: WalletClient | null = null
  if (privateKey) {
    const account = privateKeyToAccount(privateKey as `0x${string}`)
    walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    })
  }

  const addresses = getContractAddresses(chainId)

  return {
    publicClient,
    walletClient,
    addresses,
    chainId,
  }
}
