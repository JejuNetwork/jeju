/**
 * Account Abstraction SDK
 * ERC-4337 compatible smart account operations
 */

import type { Address, Hex, PublicClient } from 'viem'
import { concat, pad, toHex } from 'viem'

// Default EntryPoint v0.7 address
const DEFAULT_ENTRY_POINT =
  '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address

export interface Call {
  to: Address
  value?: bigint
  data?: Hex
}

export interface AAClientConfig {
  chainId: number
  publicClient: PublicClient
  bundlerUrl?: string
  entryPointAddress?: Address
}

/**
 * Account Abstraction Client for ERC-4337 operations
 */
export class AAClient {
  private _chainId: number
  private publicClient: PublicClient
  private _bundlerUrl: string
  private entryPointAddress: Address

  constructor(config: AAClientConfig) {
    this._chainId = config.chainId
    this.publicClient = config.publicClient
    this._bundlerUrl = config.bundlerUrl ?? 'http://localhost:4337'
    this.entryPointAddress = config.entryPointAddress ?? DEFAULT_ENTRY_POINT
  }

  /** Get the chain ID */
  get chainId(): number {
    return this._chainId
  }

  /** Get the bundler URL */
  get bundlerUrl(): string {
    return this._bundlerUrl
  }

  /**
   * Build calldata for a single call (execute)
   * execute(address dest, uint256 value, bytes calldata func)
   * Selector: 0xb61d27f6
   */
  buildCallData(call: Call): Hex {
    const selector = '0xb61d27f6'
    const dest = pad(call.to, { size: 32 })
    const value = pad(toHex(call.value ?? 0n), { size: 32 })
    const dataOffset = pad(toHex(96), { size: 32 }) // offset to data
    const dataLength = pad(toHex((call.data?.length ?? 2) / 2 - 1), {
      size: 32,
    })
    const data = call.data ?? '0x'

    // Pad data to 32-byte boundary
    const dataBytes = data.slice(2) // remove 0x
    const paddedLength = Math.ceil(dataBytes.length / 64) * 64
    const paddedData = dataBytes.padEnd(paddedLength, '0')

    return `${selector}${dest.slice(2)}${value.slice(2)}${dataOffset.slice(2)}${dataLength.slice(2)}${paddedData}` as Hex
  }

  /**
   * Build calldata for batch calls (executeBatch)
   * executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func)
   * Selector: 0x18dfb3c7
   */
  buildBatchCallData(calls: Call[]): Hex {
    const selector = '0x18dfb3c7'

    // Build arrays
    const destArray = calls.map((c) => c.to)
    const valueArray = calls.map((c) => c.value ?? 0n)
    const dataArray = calls.map((c) => c.data ?? '0x')

    // Manual encoding to ensure correct selector
    // Encode each array with offset/length/data structure
    const numCalls = calls.length

    // Calculate offsets (each array starts after header + 3 offsets)
    const headerSize = 32 * 3 // 3 dynamic array offsets
    let offset = headerSize

    // First array (addresses) - each address is 32 bytes
    const destOffset = offset
    offset += 32 + numCalls * 32

    // Second array (values) - each uint256 is 32 bytes
    const valueOffset = offset
    offset += 32 + numCalls * 32

    // Third array (bytes[]) - dynamic, need to calculate
    const dataOffset = offset

    // Build the encoded data
    let result = selector

    // Add offsets
    result += pad(toHex(destOffset), { size: 32 }).slice(2)
    result += pad(toHex(valueOffset), { size: 32 }).slice(2)
    result += pad(toHex(dataOffset), { size: 32 }).slice(2)

    // Add address array
    result += pad(toHex(numCalls), { size: 32 }).slice(2)
    for (const addr of destArray) {
      result += pad(addr, { size: 32 }).slice(2)
    }

    // Add value array
    result += pad(toHex(numCalls), { size: 32 }).slice(2)
    for (const val of valueArray) {
      result += pad(toHex(val), { size: 32 }).slice(2)
    }

    // Add bytes array (array of dynamic bytes)
    result += pad(toHex(numCalls), { size: 32 }).slice(2)

    // Calculate offsets for each bytes element
    let bytesOffset = numCalls * 32
    const bytesOffsets: number[] = []
    const bytesData: string[] = []

    for (const data of dataArray) {
      bytesOffsets.push(bytesOffset)
      const dataBytes = data.slice(2)
      const len = dataBytes.length / 2
      const paddedLen = Math.ceil(len / 32) * 32
      bytesOffset += 32 + paddedLen
      bytesData.push(dataBytes)
    }

    // Add offsets for bytes array elements
    for (const off of bytesOffsets) {
      result += pad(toHex(off), { size: 32 }).slice(2)
    }

    // Add bytes data
    for (const data of bytesData) {
      const len = data.length / 2
      result += pad(toHex(len), { size: 32 }).slice(2)
      const paddedLen = Math.ceil(len / 32) * 64
      result += data.padEnd(paddedLen, '0')
    }

    return result as Hex
  }

  /**
   * Build init code for account deployment
   * createAccount(address owner, uint256 salt)
   * Selector: 0x5fbfb9cf
   */
  buildInitCode(factory: Address, owner: Address, salt = 0n): Hex {
    const selector = '0x5fbfb9cf'
    const ownerPadded = pad(owner, { size: 32 })
    const saltPadded = pad(toHex(salt), { size: 32 })

    const createAccountData =
      `${selector}${ownerPadded.slice(2)}${saltPadded.slice(2)}` as Hex
    return concat([factory, createAccountData])
  }

  /**
   * Check if a smart account is deployed
   */
  async isAccountDeployed(address: Address): Promise<boolean> {
    const code = await this.publicClient.getCode({ address })
    return code !== undefined && code !== '0x' && code.length > 2
  }

  /**
   * Get the nonce for a smart account
   */
  async getNonce(address: Address, key = 0n): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.entryPointAddress,
      abi: [
        {
          type: 'function',
          name: 'getNonce',
          inputs: [
            { type: 'address', name: 'sender' },
            { type: 'uint192', name: 'key' },
          ],
          outputs: [{ type: 'uint256', name: 'nonce' }],
        },
      ],
      functionName: 'getNonce',
      args: [address, key],
    }) as Promise<bigint>
  }

  /**
   * Get the counterfactual address for a smart account
   */
  async getSmartAccountAddress(
    owner: Address,
    salt: bigint,
    factory?: Address,
  ): Promise<Address> {
    if (!factory) {
      throw new Error('Factory address required')
    }

    return this.publicClient.readContract({
      address: factory,
      abi: [
        {
          type: 'function',
          name: 'getAddress',
          inputs: [
            { type: 'address', name: 'owner' },
            { type: 'uint256', name: 'salt' },
          ],
          outputs: [{ type: 'address', name: '' }],
        },
      ],
      functionName: 'getAddress',
      args: [owner, salt],
    }) as Promise<Address>
  }

  /**
   * Get the deposit balance in EntryPoint for an account
   */
  async getDeposit(address: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.entryPointAddress,
      abi: [
        {
          type: 'function',
          name: 'balanceOf',
          inputs: [{ type: 'address', name: 'account' }],
          outputs: [{ type: 'uint256', name: '' }],
        },
      ],
      functionName: 'balanceOf',
      args: [address],
    }) as Promise<bigint>
  }
}

/**
 * Create an AAClient instance
 */
export function createAAClient(config: AAClientConfig): AAClient {
  return new AAClient(config)
}
