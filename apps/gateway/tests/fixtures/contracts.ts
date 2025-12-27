/**
 * @fileoverview Contract interaction helpers for testing
 * @module gateway/tests/fixtures/contracts
 *
 * Uses @jejunetwork/config and @jejunetwork/contracts for defaults.
 */

import { getChainId, getContractsConfig, getRpcUrl } from '@jejunetwork/config'
import {
  getContractAddresses as getDeployedAddresses,
  isValidAddress,
} from '@jejunetwork/contracts'
import { createPublicClient, createWalletClient, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const TEST_WALLET = {
  privateKey:
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
}

const chainId = getChainId('localnet')
const rpcUrl = getRpcUrl('localnet')

const jejuLocalnet = {
  id: chainId,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
    public: { http: [rpcUrl] },
  },
} as const

export function getPublicClient() {
  return createPublicClient({
    chain: jejuLocalnet,
    transport: http(),
  })
}

export function getWalletClient(privateKey: string = TEST_WALLET.privateKey) {
  const account = privateKeyToAccount(privateKey as `0x${string}`)

  return createWalletClient({
    account,
    chain: jejuLocalnet,
    transport: http(),
  })
}

async function isContractDeployed(
  client: ReturnType<typeof getPublicClient>,
  address: string | undefined,
): Promise<boolean> {
  if (!isValidAddress(address)) {
    return false
  }
  const code = await client.getCode({ address: address as `0x${string}` })
  return code !== undefined && code !== '0x'
}

/** Contract addresses that may or may not be deployed */
export interface ContractAddresses {
  tokenRegistry: `0x${string}` | undefined
  paymasterFactory: `0x${string}` | undefined
  priceOracle: `0x${string}` | undefined
  nodeStakingManager: `0x${string}` | undefined
  identityRegistry: `0x${string}` | undefined
  jeju: `0x${string}` | undefined
  entryPoint: `0x${string}` | undefined
  paymaster: `0x${string}` | undefined
  vault: `0x${string}` | undefined
}

export async function getContractAddresses(): Promise<ContractAddresses> {
  const deployed = getDeployedAddresses(chainId)
  const config = getContractsConfig('localnet')
  const client = getPublicClient()

  // Use config for all addresses
  const tokenRegistryAddr = (config.registry.TokenRegistry ||
    deployed.tokenRegistry ||
    deployed.validationRegistry) as `0x${string}` | undefined
  const paymasterFactoryAddr = (config.payments.PaymasterFactory ||
    deployed.paymasterFactory) as `0x${string}` | undefined
  const priceOracleAddr = (config.payments.PriceOracle ||
    deployed.priceOracle) as `0x${string}` | undefined
  const nodeStakingManagerAddr = config.nodeStaking.NodeStakingManager as
    | `0x${string}`
    | undefined
  const identityRegistryAddr = (config.registry.IdentityRegistry ||
    deployed.identityRegistry) as `0x${string}` | undefined

  return {
    tokenRegistry:
      tokenRegistryAddr && (await isContractDeployed(client, tokenRegistryAddr))
        ? tokenRegistryAddr
        : undefined,
    paymasterFactory:
      paymasterFactoryAddr &&
      (await isContractDeployed(client, paymasterFactoryAddr))
        ? paymasterFactoryAddr
        : undefined,
    priceOracle:
      priceOracleAddr && (await isContractDeployed(client, priceOracleAddr))
        ? priceOracleAddr
        : undefined,
    nodeStakingManager:
      nodeStakingManagerAddr &&
      (await isContractDeployed(client, nodeStakingManagerAddr))
        ? nodeStakingManagerAddr
        : undefined,
    identityRegistry:
      identityRegistryAddr &&
      (await isContractDeployed(client, identityRegistryAddr))
        ? identityRegistryAddr
        : undefined,
    jeju: (config.tokens.JEJU || deployed.jeju) as `0x${string}` | undefined,
    entryPoint: (config.payments.EntryPoint || deployed.entryPoint) as
      | `0x${string}`
      | undefined,
    paymaster: undefined,
    vault: undefined,
  }
}

export async function fundAccount(
  address: `0x${string}`,
  amount: bigint = parseEther('10'),
) {
  const client = getWalletClient()

  await client.sendTransaction({
    to: address,
    value: amount,
  })
}
