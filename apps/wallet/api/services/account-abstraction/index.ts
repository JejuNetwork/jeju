/**
 * Account Abstraction Service
 * Uses network paymaster contracts and bundler
 */

import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toHex,
} from 'viem'
import { EMPTY_CALLDATA } from '../../guards'
import * as jeju from '../jeju'
import { rpcService, type SupportedChainId } from '../rpc'

// ERC-4337 Entry Point (v0.7) - canonical address
const ENTRY_POINT_V07: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'

// Network contract addresses (from deployments)
// Contract addresses per chain - add more as contracts are deployed
const JEJU_CONTRACTS: Record<
  number,
  { entryPoint: Address; factory: Address; sponsoredPaymaster?: Address }
> = {
  1337: {
    entryPoint: ENTRY_POINT_V07,
    factory: '0x9406Cc6185a346906296840746125a0E44976454',
    sponsoredPaymaster: ZERO_ADDRESS,
  },
  420691: {
    entryPoint: ENTRY_POINT_V07,
    factory: '0x9406Cc6185a346906296840746125a0E44976454',
  },
}

const getAccountFactory = (chainId: number): Address => {
  return JEJU_CONTRACTS[chainId]?.factory || ZERO_ADDRESS
}

const getEntryPoint = (chainId: number): Address => {
  return JEJU_CONTRACTS[chainId]?.entryPoint || ENTRY_POINT_V07
}

const getSponsoredPaymaster = (chainId: number): Address | undefined => {
  return JEJU_CONTRACTS[chainId]?.sponsoredPaymaster
}

export interface SmartAccount {
  address: Address
  owner: Address
  chainId: SupportedChainId
  isDeployed: boolean
  nonce: bigint
}

export interface UserOperation {
  sender: Address
  nonce: bigint
  initCode: Hex
  callData: Hex
  callGasLimit: bigint
  verificationGasLimit: bigint
  preVerificationGas: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  paymasterAndData: Hex
  signature: Hex
}

export interface UserOpGasLimits {
  callGasLimit: bigint
  verificationGasLimit: bigint
  preVerificationGas: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

export interface PaymasterData {
  paymaster: Address
  paymasterData: Hex
  sponsoredBy?: string
}

// Simple Account ABI
const ACCOUNT_ABI = [
  {
    name: 'execute',
    type: 'function',
    inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'executeBatch',
    type: 'function',
    inputs: [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'bytes[]' }],
    outputs: [],
  },
] as const

const FACTORY_ABI = [
  {
    name: 'createAccount',
    type: 'function',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'getAddress',
    type: 'function',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const

class AccountAbstractionService {
  private accounts = new Map<string, SmartAccount>()

  // Get smart account address (counterfactual)
  async getSmartAccountAddress(
    owner: Address,
    chainId: SupportedChainId,
    salt = 0n,
  ): Promise<Address> {
    const key = `${chainId}:${owner}`
    const cached = this.accounts.get(key)
    if (cached) return cached.address

    const factory = getAccountFactory(chainId)
    if (!factory || factory === '0x') {
      throw new Error(`Account factory not deployed on chain ${chainId}`)
    }

    const client = rpcService.getClient(chainId)

    // Compute address using factory
    const address = (await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: 'getAddress',
      args: [owner, salt],
    })) as Address

    // Check if deployed
    const code = await client.getCode({ address })
    const isDeployed = code !== undefined && code !== '0x'

    const account: SmartAccount = {
      address,
      owner,
      chainId,
      isDeployed,
      nonce: 0n,
    }

    this.accounts.set(key, account)
    return address
  }

  // Create smart account
  async createSmartAccount(
    owner: Address,
    chainId: SupportedChainId,
  ): Promise<SmartAccount> {
    await this.getSmartAccountAddress(owner, chainId)
    const account = this.accounts.get(`${chainId}:${owner}`)
    if (!account) {
      throw new Error(
        `Failed to create smart account for ${owner} on chain ${chainId}`,
      )
    }
    return account
  }

  // Build UserOperation
  async buildUserOperation(params: {
    smartAccount: SmartAccount
    calls: Array<{ to: Address; value: bigint; data: Hex }>
    usePaymaster?: boolean
    gasToken?: Address
  }): Promise<UserOperation> {
    const { smartAccount, calls, usePaymaster = true } = params
    const { chainId } = smartAccount

    // Encode callData
    let callData: Hex
    if (calls.length === 1) {
      callData = encodeFunctionData({
        abi: ACCOUNT_ABI,
        functionName: 'execute',
        args: [calls[0].to, calls[0].value, calls[0].data],
      })
    } else {
      callData = encodeFunctionData({
        abi: ACCOUNT_ABI,
        functionName: 'executeBatch',
        args: [
          calls.map((c) => c.to),
          calls.map((c) => c.value),
          calls.map((c) => c.data),
        ],
      })
    }

    // Init code (if not deployed)
    const factory = getAccountFactory(chainId)
    const initCode = smartAccount.isDeployed
      ? EMPTY_CALLDATA
      : concat([
          factory,
          encodeFunctionData({
            abi: FACTORY_ABI,
            functionName: 'createAccount',
            args: [smartAccount.owner, 0n],
          }),
        ])

    // Get nonce
    const nonce = await this.getNonce(smartAccount)

    // Estimate gas
    const entryPoint = getEntryPoint(chainId)
    const gasEstimate = await this.estimateGas(
      chainId,
      {
        sender: smartAccount.address,
        nonce,
        initCode,
        callData,
      },
      entryPoint,
    )

    // Get paymaster data
    let paymasterAndData: Hex = EMPTY_CALLDATA
    if (usePaymaster) {
      const sponsoredPaymaster = getSponsoredPaymaster(chainId)
      if (sponsoredPaymaster) {
        // Simple sponsored paymaster - just include address
        // Address is a Hex-compatible type (0x prefixed string)
        paymasterAndData = sponsoredPaymaster
      }
    }

    return {
      sender: smartAccount.address,
      nonce,
      initCode,
      callData,
      callGasLimit: gasEstimate.callGasLimit,
      verificationGasLimit: gasEstimate.verificationGasLimit,
      preVerificationGas: gasEstimate.preVerificationGas,
      maxFeePerGas: gasEstimate.maxFeePerGas,
      maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
      paymasterAndData,
      signature: EMPTY_CALLDATA,
    }
  }

  // Sign UserOperation
  async signUserOperation(
    userOp: UserOperation,
    signer: { signMessage: (args: { message: { raw: Hex } }) => Promise<Hex> },
    chainId: SupportedChainId,
  ): Promise<UserOperation> {
    const entryPoint = getEntryPoint(chainId)
    const userOpHash = this.getUserOpHash(userOp, chainId, entryPoint)
    const signature = await signer.signMessage({ message: { raw: userOpHash } })
    return { ...userOp, signature }
  }

  // Send UserOperation via the network bundler
  async sendUserOperation(
    userOp: UserOperation,
    chainId: SupportedChainId,
  ): Promise<Hex> {
    const entryPoint = getEntryPoint(chainId)
    return jeju.sendUserOperation(
      chainId,
      this.serializeUserOp(userOp),
      entryPoint,
    )
  }

  // Get UserOperation receipt
  async getUserOperationReceipt(
    userOpHash: Hex,
    chainId: SupportedChainId,
  ): Promise<{ success: boolean; txHash: Hex } | null> {
    return jeju.getUserOperationReceipt(chainId, userOpHash)
  }

  // Estimate gas via bundler
  async estimateGas(
    chainId: SupportedChainId,
    partialOp: { sender: Address; nonce: bigint; initCode: Hex; callData: Hex },
    entryPoint: Address,
  ): Promise<UserOpGasLimits> {
    const estimate = await jeju.estimateUserOperationGas(
      chainId,
      {
        sender: partialOp.sender,
        nonce: toHex(partialOp.nonce),
        initCode: partialOp.initCode,
        callData: partialOp.callData,
        callGasLimit: toHex(500000n),
        verificationGasLimit: toHex(500000n),
        preVerificationGas: toHex(50000n),
        maxFeePerGas: toHex(50000000000n),
        maxPriorityFeePerGas: toHex(1500000000n),
        paymasterAndData: '0x',
        signature: '0x',
      },
      entryPoint,
    )

    // Get current gas prices
    const gasPrices = await jeju.getGasPrice()

    return {
      ...estimate,
      maxFeePerGas: gasPrices.fast,
      maxPriorityFeePerGas: gasPrices.standard / 10n,
    }
  }

  // Get nonce from EntryPoint
  private async getNonce(account: SmartAccount): Promise<bigint> {
    const client = rpcService.getClient(account.chainId)
    const entryPoint = getEntryPoint(account.chainId)

    const nonce = await client.readContract({
      address: entryPoint,
      abi: [
        {
          name: 'getNonce',
          type: 'function',
          inputs: [{ type: 'address' }, { type: 'uint192' }],
          outputs: [{ type: 'uint256' }],
        },
      ],
      functionName: 'getNonce',
      args: [account.address, 0n],
    })

    return nonce as bigint
  }

  // Compute UserOp hash
  private getUserOpHash(
    userOp: UserOperation,
    chainId: number,
    entryPoint: Address,
  ): Hex {
    const packed = encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bytes32' },
      ],
      [
        userOp.sender,
        userOp.nonce,
        keccak256(userOp.initCode),
        keccak256(userOp.callData),
        userOp.callGasLimit,
        userOp.verificationGasLimit,
        userOp.preVerificationGas,
        userOp.maxFeePerGas,
        userOp.maxPriorityFeePerGas,
        keccak256(userOp.paymasterAndData),
      ],
    )

    const userOpHash = keccak256(packed)

    return keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
        [userOpHash, entryPoint, BigInt(chainId)],
      ),
    )
  }

  // Serialize UserOp for JSON-RPC
  private serializeUserOp(userOp: UserOperation): Record<string, string> {
    return {
      sender: userOp.sender,
      nonce: toHex(userOp.nonce),
      initCode: userOp.initCode,
      callData: userOp.callData,
      callGasLimit: toHex(userOp.callGasLimit),
      verificationGasLimit: toHex(userOp.verificationGasLimit),
      preVerificationGas: toHex(userOp.preVerificationGas),
      maxFeePerGas: toHex(userOp.maxFeePerGas),
      maxPriorityFeePerGas: toHex(userOp.maxPriorityFeePerGas),
      paymasterAndData: userOp.paymasterAndData,
      signature: userOp.signature,
    }
  }
}

export const aaService = new AccountAbstractionService()
export { AccountAbstractionService }
