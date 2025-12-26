import { getContract } from '@jejunetwork/config'
import {
  getLocalnetChain,
  getMainnetChain,
  getTestnetChain,
} from '@jejunetwork/shared'
import { expectAddress, expectHex, ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  isAddress,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

/** Safely get contract address from config, with env var override */
function safeGetAddress(
  category: string,
  name: string,
  network: 'localnet' | 'testnet' | 'mainnet',
  envKey?: string,
): Address {
  // Check env var first if provided
  if (envKey) {
    const envValue = process.env[envKey]
    if (envValue) {
      return expectAddress(envValue, `${name} from ${envKey}`)
    }
  }

  // Try config package
  try {
    const addr = getContract(category as 'registry', name, network)
    if (addr) {
      return expectAddress(addr, `${category}.${name}`)
    }
  } catch {
    // Contract not configured
  }

  return ZERO_ADDRESS
}

/** Get required address - throws if not found */
function getRequiredAddress(
  category: string,
  name: string,
  network: 'localnet' | 'testnet' | 'mainnet',
  envKey: string,
): Address {
  const addr = safeGetAddress(category, name, network, envKey)
  if (addr === ZERO_ADDRESS) {
    throw new Error(
      `Missing ${name} address: set ${envKey} environment variable or add to contracts.json`,
    )
  }
  return addr
}

export const jejuMainnet: Chain = getMainnetChain()
export const jejuTestnet: Chain = { ...getTestnetChain(), testnet: true }
export const networkLocalnet: Chain = getLocalnetChain()

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

/** Localnet contract addresses (deterministic from Anvil deployment order) */
const LOCALNET_ADDRESSES: ContractAddresses = {
  identityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  nodeStakingManager: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  computeRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  computeStaking: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  inferenceServing: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  triggerRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
  storageMarket: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  contentRegistry: '0x68B1D87F95878fE05B998F19b66F4baba5De1aed',
  oracleStakingManager: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
  feedRegistry: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
  reportVerifier: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  proxyRegistry: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
  sequencerRegistry: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
  liquidityAggregator: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0',
  solverRegistry: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82',
  feeDistributor: '0x9A676e781A523b5d0C0e43731313A708CB607508',
  banManager: '0x0B306BF915C4d645ff596e518fAf3F9669b97016',
  cdnRegistry: '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1',
  cdnBilling: '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE',
  vpnRegistry: '0x322813FD9a801C5507C9544993C34b5A5B9B5b7b',
}

// Validate localnet addresses at module load time
for (const [key, value] of Object.entries(LOCALNET_ADDRESSES)) {
  if (!isAddress(value)) {
    throw new Error(`Invalid localnet address for ${key}: ${value}`)
  }
}

export function getContractAddresses(chainId: number): ContractAddresses {
  if (chainId === 31337) {
    return LOCALNET_ADDRESSES
  }

  // Determine network from chain ID
  const network =
    chainId === 420691 ? 'mainnet' : chainId === 420690 ? 'testnet' : null
  if (!network) {
    throw new Error(`Unknown chain ID: ${chainId}`)
  }

  // Use config package with env var fallbacks
  return {
    identityRegistry: getRequiredAddress(
      'registry',
      'identity',
      network,
      'IDENTITY_REGISTRY',
    ),
    nodeStakingManager: getRequiredAddress(
      'nodeStaking',
      'manager',
      network,
      'NODE_STAKING_MANAGER',
    ),
    computeRegistry: safeGetAddress('compute', 'registry', network, 'COMPUTE_REGISTRY'),
    computeStaking: safeGetAddress('compute', 'staking', network, 'COMPUTE_STAKING'),
    inferenceServing: safeGetAddress('compute', 'inferenceServing', network, 'INFERENCE_SERVING'),
    triggerRegistry: safeGetAddress('compute', 'triggerRegistry', network, 'TRIGGER_REGISTRY'),
    storageMarket: safeGetAddress('storage', 'market', network, 'STORAGE_MARKET'),
    contentRegistry: safeGetAddress('storage', 'contentRegistry', network, 'CONTENT_REGISTRY'),
    oracleStakingManager: safeGetAddress('oracle', 'stakingManager', network, 'ORACLE_STAKING_MANAGER'),
    feedRegistry: safeGetAddress('oracle', 'feedRegistry', network, 'FEED_REGISTRY'),
    reportVerifier: safeGetAddress('oracle', 'reportVerifier', network, 'REPORT_VERIFIER'),
    proxyRegistry: safeGetAddress('registry', 'proxy', network, 'PROXY_REGISTRY'),
    sequencerRegistry: safeGetAddress('registry', 'sequencer', network, 'SEQUENCER_REGISTRY'),
    liquidityAggregator: safeGetAddress('liquidity', 'aggregator', network, 'LIQUIDITY_AGGREGATOR'),
    solverRegistry: safeGetAddress('oif', 'solverRegistry', network, 'SOLVER_REGISTRY'),
    feeDistributor: safeGetAddress('fees', 'feeDistributor', network, 'FEE_DISTRIBUTOR'),
    banManager: safeGetAddress('moderation', 'banManager', network, 'BAN_MANAGER'),
    cdnRegistry: safeGetAddress('cdn', 'registry', network, 'CDN_REGISTRY'),
    cdnBilling: safeGetAddress('cdn', 'billing', network, 'CDN_BILLING'),
    vpnRegistry: safeGetAddress('vpn', 'registry', network, 'VPN_REGISTRY'),
  }
}

export function getChain(chainId: number): Chain {
  const mainnet = jejuMainnet
  const testnet = jejuTestnet

  switch (chainId) {
    case mainnet.id:
      return mainnet
    case testnet.id:
      return testnet
    case 31337:
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
  privateKey?: Hex,
): NodeClient {
  const chain = getChain(chainId)

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  let walletClient: WalletClient | null = null
  if (privateKey) {
    const validatedKey = expectHex(privateKey, 'privateKey')
    const account = privateKeyToAccount(validatedKey)
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
