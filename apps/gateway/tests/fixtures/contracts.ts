/**
 * @fileoverview Contract interaction helpers for testing
 * @module gateway/tests/fixtures/contracts
 */

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

const jejuLocalnet = {
  id: 1337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:6546'] },
    public: { http: ['http://127.0.0.1:6546'] },
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
  elizaOS: `0x${string}` | undefined
  entryPoint: `0x${string}` | undefined
  paymaster: `0x${string}` | undefined
  vault: `0x${string}` | undefined
}

export async function getContractAddresses(): Promise<ContractAddresses> {
  const deployed = getDeployedAddresses(1337)
  const client = getPublicClient()

  // Allow env overrides for testing
  const tokenRegistryAddr = (process.env.VITE_TOKEN_REGISTRY_ADDRESS ||
    deployed.tokenRegistry ||
    deployed.validationRegistry) as `0x${string}` | undefined
  const paymasterFactoryAddr = (process.env.VITE_PAYMASTER_FACTORY_ADDRESS ||
    deployed.paymasterFactory) as `0x${string}` | undefined
  const priceOracleAddr = (process.env.VITE_PRICE_ORACLE_ADDRESS ||
    deployed.priceOracle) as `0x${string}` | undefined
  const nodeStakingManagerAddr = process.env
    .VITE_NODE_STAKING_MANAGER_ADDRESS as `0x${string}` | undefined
  const identityRegistryAddr = (process.env.VITE_IDENTITY_REGISTRY_ADDRESS ||
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
    elizaOS: deployed.elizaOS as `0x${string}` | undefined,
    entryPoint: deployed.entryPoint as `0x${string}` | undefined,
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
