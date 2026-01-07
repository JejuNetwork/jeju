/**
 * useBundler Hook
 *
 * ERC-4337 bundler client for sending UserOperations.
 * This enables gasless transactions via paymasters.
 *
 * The bundler is exposed at /bundler on the gateway API.
 */

import { useCallback, useState } from 'react'
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  keccak256,
  toHex,
} from 'viem'
import { useAccount, useChainId, usePublicClient, useSignMessage } from 'wagmi'

import { CHAIN_ID, RPC_URL } from '../config'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

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

export interface BundlerResult {
  userOpHash: Hex
  receipt?: {
    success: boolean
    txHash: Hex
    blockNumber: bigint
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

// ERC-4337 Entry Point v0.7 - canonical address
const ENTRY_POINT_V07: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'

// Simple Account ABI for execute
const ACCOUNT_ABI = [
  {
    name: 'execute',
    type: 'function',
    inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
    outputs: [],
  },
] as const

// Bundler URL (gateway/bundler endpoint)
function getBundlerUrl(): string {
  // Use gateway API bundler endpoint
  const baseUrl = RPC_URL.replace(/\/rpc$/, '').replace(/:\d+$/, '')
  return `${baseUrl}:4100/bundler` // Gateway port
}

// ═══════════════════════════════════════════════════════════════════════════
// RPC Calls
// ═══════════════════════════════════════════════════════════════════════════

async function bundlerRpc(method: string, params: unknown[]): Promise<unknown> {
  const url = getBundlerUrl()

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  })

  if (!response.ok) {
    throw new Error(`Bundler request failed: ${response.statusText}`)
  }

  const data = await response.json()

  if (data.error) {
    throw new Error(data.error.message || 'Bundler RPC error')
  }

  return data.result
}

function serializeUserOp(userOp: UserOperation): Record<string, string> {
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

function computeUserOpHash(
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

// ═══════════════════════════════════════════════════════════════════════════
// useBundler Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useBundler() {
  const { address: userAddress } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { signMessageAsync } = useSignMessage()

  const [status, setStatus] = useState<
    'idle' | 'building' | 'signing' | 'pending' | 'complete' | 'error'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<BundlerResult | null>(null)

  // Get smart account nonce from EntryPoint
  const getNonce = useCallback(
    async (smartAccountAddress: Address): Promise<bigint> => {
      if (!publicClient) return 0n

      try {
        const nonce = await publicClient.readContract({
          address: ENTRY_POINT_V07,
          abi: [
            {
              name: 'getNonce',
              type: 'function',
              inputs: [{ type: 'address' }, { type: 'uint192' }],
              outputs: [{ type: 'uint256' }],
            },
          ],
          functionName: 'getNonce',
          args: [smartAccountAddress, 0n],
        })
        return nonce as bigint
      } catch {
        return 0n
      }
    },
    [publicClient],
  )

  // Estimate gas for a UserOperation
  const estimateGas = useCallback(
    async (
      sender: Address,
      callData: Hex,
      initCode: Hex = '0x',
    ): Promise<{
      callGasLimit: bigint
      verificationGasLimit: bigint
      preVerificationGas: bigint
    }> => {
      const nonce = await getNonce(sender)

      const partialOp = {
        sender,
        nonce: toHex(nonce),
        initCode,
        callData,
        callGasLimit: toHex(500000n),
        verificationGasLimit: toHex(500000n),
        preVerificationGas: toHex(50000n),
        maxFeePerGas: toHex(50000000000n), // 50 gwei
        maxPriorityFeePerGas: toHex(1500000000n), // 1.5 gwei
        paymasterAndData: '0x',
        signature: '0x',
      }

      const result = (await bundlerRpc('eth_estimateUserOperationGas', [
        partialOp,
        ENTRY_POINT_V07,
      ])) as {
        callGasLimit: string
        verificationGasLimit: string
        preVerificationGas: string
      }

      return {
        callGasLimit: BigInt(result.callGasLimit),
        verificationGasLimit: BigInt(result.verificationGasLimit),
        preVerificationGas: BigInt(result.preVerificationGas),
      }
    },
    [getNonce],
  )

  // Build a UserOperation for a simple call
  const buildUserOperation = useCallback(
    async (params: {
      smartAccountAddress: Address
      to: Address
      value: bigint
      data: Hex
      paymasterAndData?: Hex
      initCode?: Hex
    }): Promise<UserOperation> => {
      const {
        smartAccountAddress,
        to,
        value,
        data,
        paymasterAndData = '0x',
        initCode = '0x',
      } = params

      // Encode execute call
      const callData = encodeFunctionData({
        abi: ACCOUNT_ABI,
        functionName: 'execute',
        args: [to, value, data],
      })

      // Get nonce
      const nonce = await getNonce(smartAccountAddress)

      // Estimate gas
      const gasEstimate = await estimateGas(
        smartAccountAddress,
        callData,
        initCode,
      )

      // Get current gas price (simplified - in production use bundler's gas oracle)
      const gasPrice = (await publicClient?.getGasPrice()) ?? 50000000000n

      return {
        sender: smartAccountAddress,
        nonce,
        initCode,
        callData,
        callGasLimit: gasEstimate.callGasLimit,
        verificationGasLimit: gasEstimate.verificationGasLimit,
        preVerificationGas: gasEstimate.preVerificationGas,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice / 10n,
        paymasterAndData,
        signature: '0x',
      }
    },
    [getNonce, estimateGas, publicClient],
  )

  // Sign a UserOperation
  const signUserOperation = useCallback(
    async (userOp: UserOperation): Promise<UserOperation> => {
      const hash = computeUserOpHash(
        userOp,
        chainId || CHAIN_ID,
        ENTRY_POINT_V07,
      )
      const signature = await signMessageAsync({ message: { raw: hash } })
      return { ...userOp, signature }
    },
    [chainId, signMessageAsync],
  )

  // Send a UserOperation to the bundler
  const sendUserOperation = useCallback(
    async (userOp: UserOperation): Promise<Hex> => {
      const serialized = serializeUserOp(userOp)
      const userOpHash = (await bundlerRpc('eth_sendUserOperation', [
        serialized,
        ENTRY_POINT_V07,
      ])) as Hex
      return userOpHash
    },
    [],
  )

  // Wait for UserOperation receipt
  const waitForReceipt = useCallback(
    async (
      userOpHash: Hex,
      maxAttempts = 30,
    ): Promise<BundlerResult['receipt']> => {
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000)) // Poll every 2 seconds

        const receipt = (await bundlerRpc('eth_getUserOperationReceipt', [
          userOpHash,
        ])) as {
          success: boolean
          receipt: { transactionHash: Hex; blockNumber: string }
        } | null

        if (receipt) {
          return {
            success: receipt.success,
            txHash: receipt.receipt.transactionHash,
            blockNumber: BigInt(receipt.receipt.blockNumber),
          }
        }
      }

      return undefined
    },
    [],
  )

  // Full flow: build, sign, send, wait
  const executeGasless = useCallback(
    async (params: {
      smartAccountAddress: Address
      to: Address
      value: bigint
      data: Hex
      paymasterAndData?: Hex
    }): Promise<BundlerResult> => {
      if (!userAddress) {
        throw new Error('Wallet not connected')
      }

      setStatus('building')
      setError(null)

      try {
        // Build UserOp
        const userOp = await buildUserOperation(params)

        // Sign
        setStatus('signing')
        const signedOp = await signUserOperation(userOp)

        // Send to bundler
        setStatus('pending')
        const userOpHash = await sendUserOperation(signedOp)

        // Wait for receipt
        const receipt = await waitForReceipt(userOpHash)

        const result: BundlerResult = { userOpHash, receipt }
        setLastResult(result)
        setStatus('complete')

        return result
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Gasless transaction failed'
        setError(message)
        setStatus('error')
        throw err
      }
    },
    [
      userAddress,
      buildUserOperation,
      signUserOperation,
      sendUserOperation,
      waitForReceipt,
    ],
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
    setLastResult(null)
  }, [])

  return {
    // State
    status,
    error,
    lastResult,

    // Actions
    buildUserOperation,
    signUserOperation,
    sendUserOperation,
    executeGasless,
    reset,

    // Utils
    getNonce,
    estimateGas,
    waitForReceipt,

    // Constants
    entryPoint: ENTRY_POINT_V07,
  }
}
