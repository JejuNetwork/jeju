/**
 * Names Module - JNS (Network Name Service)
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, namehash } from 'viem'
import { getServicesConfig, requireContract } from '../config'
import type { JejuWallet } from '../wallet'

export interface NameInfo {
  name: string
  owner: Address
  resolver: Address
  expiresAt: number
  registeredAt: number
}

export interface NameRecords {
  address?: Address
  contentHash?: string
  text?: Record<string, string>
  a2aEndpoint?: string
  mcpEndpoint?: string
  avatar?: string
  url?: string
  description?: string
}

export interface RegisterNameParams {
  name: string
  durationYears: number
  records?: NameRecords
}

export interface NamesModule {
  // Resolution
  resolve(name: string): Promise<Address | null>
  reverseResolve(address: Address): Promise<string | null>
  getRecords(name: string): Promise<NameRecords>

  // Registration
  register(params: RegisterNameParams): Promise<Hex>
  renew(name: string, additionalYears: number): Promise<Hex>
  transfer(name: string, to: Address): Promise<Hex>

  // Records management
  setRecords(name: string, records: NameRecords): Promise<Hex>
  setAddress(name: string, address: Address): Promise<Hex>
  setText(name: string, key: string, value: string): Promise<Hex>

  // Info
  getNameInfo(name: string): Promise<NameInfo | null>
  listMyNames(): Promise<NameInfo[]>
  isAvailable(name: string): Promise<boolean>
  getRegistrationPrice(name: string, durationYears: number): Promise<bigint>
}

const JNS_REGISTRY_ABI = [
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'resolver',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'setOwner',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [],
  },
] as const

const JNS_REGISTRAR_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'duration', type: 'uint256' },
      { name: 'resolver', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'renew',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'available',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'rentPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

const JNS_RESOLVER_ABI = [
  {
    name: 'addr',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'setAddr',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'addr', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'setText',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'setContenthash',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

function normalizeName(name: string): string {
  // Ensure .jeju suffix
  if (!name.endsWith('.jeju')) {
    return `${name}.jeju`
  }
  return name
}

function getLabel(name: string): string {
  return name.replace('.jeju', '')
}

export function createNamesModule(
  wallet: JejuWallet,
  network: NetworkType,
): NamesModule {
  const registrarAddress = requireContract('jns', 'registrar', network)
  const resolverAddress = requireContract('jns', 'resolver', network)
  const services = getServicesConfig(network)

  async function resolve(name: string): Promise<Address | null> {
    const normalized = normalizeName(name)

    const response = await fetch(
      `${services.gateway.api}/jns/resolve/${normalized}`,
    )
    if (!response.ok) return null

    const data = (await response.json()) as { address: Address }
    return data.address
  }

  async function reverseResolve(address: Address): Promise<string | null> {
    const response = await fetch(
      `${services.gateway.api}/jns/reverse/${address}`,
    )
    if (!response.ok) return null

    const data = (await response.json()) as { name: string }
    return data.name
  }

  async function getRecords(name: string): Promise<NameRecords> {
    const normalized = normalizeName(name)
    const response = await fetch(
      `${services.gateway.api}/jns/records/${normalized}`,
    )
    if (!response.ok) return {}

    return (await response.json()) as NameRecords
  }

  async function register(params: RegisterNameParams): Promise<Hex> {
    const normalized = normalizeName(params.name)
    const label = getLabel(normalized)
    const duration = BigInt(params.durationYears * 365 * 24 * 60 * 60)

    const price = await getRegistrationPrice(params.name, params.durationYears)

    const data = encodeFunctionData({
      abi: JNS_REGISTRAR_ABI,
      functionName: 'register',
      args: [label, wallet.address, duration, resolverAddress],
    })

    return wallet.sendTransaction({ to: registrarAddress, data, value: price })
  }

  async function renew(name: string, additionalYears: number): Promise<Hex> {
    const normalized = normalizeName(name)
    const label = getLabel(normalized)
    const duration = BigInt(additionalYears * 365 * 24 * 60 * 60)

    const price = await getRegistrationPrice(name, additionalYears)

    const data = encodeFunctionData({
      abi: JNS_REGISTRAR_ABI,
      functionName: 'renew',
      args: [label, duration],
    })

    return wallet.sendTransaction({ to: registrarAddress, data, value: price })
  }

  async function transfer(name: string, to: Address): Promise<Hex> {
    const normalized = normalizeName(name)
    const node = namehash(normalized)

    const data = encodeFunctionData({
      abi: JNS_REGISTRY_ABI,
      functionName: 'setOwner',
      args: [node, to],
    })

    return wallet.sendTransaction({ to: resolverAddress, data })
  }

  async function setRecords(name: string, records: NameRecords): Promise<Hex> {
    normalizeName(name)

    // For simplicity, just set address if provided
    if (records.address) {
      return setAddress(name, records.address)
    }

    // Set text records
    if (records.a2aEndpoint) {
      return setText(name, 'a2a', records.a2aEndpoint)
    }

    throw new Error('No records to set')
  }

  async function setAddress(name: string, address: Address): Promise<Hex> {
    const normalized = normalizeName(name)
    const node = namehash(normalized)

    const data = encodeFunctionData({
      abi: JNS_RESOLVER_ABI,
      functionName: 'setAddr',
      args: [node, address],
    })

    return wallet.sendTransaction({ to: resolverAddress, data })
  }

  async function setText(
    name: string,
    key: string,
    value: string,
  ): Promise<Hex> {
    const normalized = normalizeName(name)
    const node = namehash(normalized)

    const data = encodeFunctionData({
      abi: JNS_RESOLVER_ABI,
      functionName: 'setText',
      args: [node, key, value],
    })

    return wallet.sendTransaction({ to: resolverAddress, data })
  }

  async function getNameInfo(name: string): Promise<NameInfo | null> {
    const normalized = normalizeName(name)
    const response = await fetch(
      `${services.gateway.api}/jns/info/${normalized}`,
    )
    if (!response.ok) return null

    return (await response.json()) as NameInfo
  }

  async function listMyNames(): Promise<NameInfo[]> {
    const response = await fetch(
      `${services.gateway.api}/jns/names/${wallet.address}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to list names: ${response.statusText}`)
    }

    const data = (await response.json()) as { names: NameInfo[] }
    return data.names
  }

  async function isAvailable(name: string): Promise<boolean> {
    const normalized = normalizeName(name)
    const response = await fetch(
      `${services.gateway.api}/jns/available/${normalized}`,
    )
    if (!response.ok) return false

    const data = (await response.json()) as { available: boolean }
    return data.available
  }

  async function getRegistrationPrice(
    name: string,
    durationYears: number,
  ): Promise<bigint> {
    const normalized = normalizeName(name)
    const response = await fetch(
      `${services.gateway.api}/jns/price/${normalized}?years=${durationYears}`,
    )
    if (!response.ok) throw new Error('Failed to get price')

    const data = (await response.json()) as { price: string }
    return BigInt(data.price)
  }

  return {
    resolve,
    reverseResolve,
    getRecords,
    register,
    renew,
    transfer,
    setRecords,
    setAddress,
    setText,
    getNameInfo,
    listMyNames,
    isAvailable,
    getRegistrationPrice,
  }
}
