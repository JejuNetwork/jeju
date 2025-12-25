/**
 * Gnosis Safe / Multisig Support
 * Create and manage Safe wallets, propose and execute transactions
 */

import { expectValid } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { encodeFunctionData } from 'viem'
import { SafeTransactionsResponseSchema } from '../../../lib/api-responses'
import { rpcService, type SupportedChainId } from '../rpc'

// Safe Transaction Service API base URLs
const SAFE_API_URLS: Record<number, string> = {
  1: 'https://safe-transaction-mainnet.safe.global',
  10: 'https://safe-transaction-optimism.safe.global',
  8453: 'https://safe-transaction-base.safe.global',
  42161: 'https://safe-transaction-arbitrum.safe.global',
}

export interface SafeInfo {
  address: Address
  chainId: number
  owners: Address[]
  threshold: number
  nonce: number
  version: string
  modules: Address[]
  guard?: Address
}

export interface SafeTransaction {
  to: Address
  value: bigint
  data: Hex
  operation: 0 | 1 // 0 = Call, 1 = DelegateCall
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: Address
  refundReceiver: Address
  nonce: number
}

export interface SafeTransactionData extends SafeTransaction {
  safe: Address
  confirmations: SafeConfirmation[]
  confirmationsRequired: number
  isExecuted: boolean
  safeTxHash: Hex
  proposer: Address
  submissionDate: string
}

export interface SafeConfirmation {
  owner: Address
  signature: Hex
  submissionDate: string
}

const SAFE_ABI = [
  // Read functions
  {
    name: 'getOwners',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getThreshold',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'nonce',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'VERSION',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'getModulesPaginated',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'address[]' }, { type: 'address' }],
  },
  {
    name: 'getGuard',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },

  // Write functions
  {
    name: 'execTransaction',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ type: 'bool' }],
  },

  // Hash functions
  {
    name: 'getTransactionHash',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'nonce', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
] as const

class SafeService {
  /**
   * Get Safe info from chain
   */
  async getSafeInfo(
    chainId: SupportedChainId,
    safeAddress: Address,
  ): Promise<SafeInfo> {
    const client = rpcService.getClient(chainId)

    const [owners, threshold, nonce, version, modulesResult, guardAddress] =
      await Promise.all([
        client.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'getOwners',
        }) as Promise<readonly Address[]>,
        client.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'getThreshold',
        }) as Promise<bigint>,
        client.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'nonce',
        }) as Promise<bigint>,
        client.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'VERSION',
        }) as Promise<string>,
        client.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'getModulesPaginated',
          args: ['0x0000000000000000000000000000000000000001' as Address, 10n],
        }) as Promise<readonly [readonly Address[], Address]>,
        client.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'getGuard',
        }) as Promise<Address>,
      ])

    return {
      address: safeAddress,
      chainId,
      owners: [...owners],
      threshold: Number(threshold),
      nonce: Number(nonce),
      version,
      modules: [...modulesResult[0]],
      guard:
        guardAddress === '0x0000000000000000000000000000000000000000'
          ? undefined
          : guardAddress,
    }
  }

  /**
   * Check if an address is a Safe
   */
  async isSafe(chainId: SupportedChainId, address: Address): Promise<boolean> {
    await this.getSafeInfo(chainId, address)
    return true
  }

  /**
   * Get pending transactions from Safe Transaction Service
   */
  async getPendingTransactions(
    chainId: number,
    safeAddress: Address,
  ): Promise<SafeTransactionData[]> {
    const apiUrl = SAFE_API_URLS[chainId]
    if (!apiUrl) {
      throw new Error(
        `Safe Transaction Service not available for chain ${chainId}`,
      )
    }

    const response = await fetch(
      `${apiUrl}/api/v1/safes/${safeAddress}/multisig-transactions/?executed=false&ordering=-nonce`,
    )

    if (!response.ok) {
      throw new Error('Failed to fetch pending transactions')
    }

    const data = expectValid(
      SafeTransactionsResponseSchema,
      await response.json(),
      'Safe pending transactions',
    )
    return this.mapTransactionData(data.results)
  }

  /**
   * Get transaction history from Safe Transaction Service
   */
  async getTransactionHistory(
    chainId: number,
    safeAddress: Address,
  ): Promise<SafeTransactionData[]> {
    const apiUrl = SAFE_API_URLS[chainId]
    if (!apiUrl) {
      throw new Error(
        `Safe Transaction Service not available for chain ${chainId}`,
      )
    }

    const response = await fetch(
      `${apiUrl}/api/v1/safes/${safeAddress}/multisig-transactions/?executed=true&ordering=-executionDate`,
    )

    if (!response.ok) {
      throw new Error('Failed to fetch transaction history')
    }

    const data = expectValid(
      SafeTransactionsResponseSchema,
      await response.json(),
      'Safe transaction history',
    )
    return this.mapTransactionData(data.results)
  }

  /**
   * Map validated API response to SafeTransactionData
   */
  private mapTransactionData(
    results: Array<{
      safe: Address
      to: Address
      value: string
      data: Hex | null
      operation: 0 | 1
      safeTxGas: string
      baseGas: string
      gasPrice: string
      gasToken: Address
      refundReceiver: Address
      nonce: number
      confirmations: Array<{
        owner: Address
        signature: Hex
        submissionDate: string
      }>
      confirmationsRequired: number
      isExecuted: boolean
      safeTxHash: Hex
      proposer?: Address
      submissionDate?: string
    }>,
  ): SafeTransactionData[] {
    return results.map((tx) => ({
      safe: tx.safe,
      to: tx.to,
      value: BigInt(tx.value),
      data: tx.data ?? ('0x' as Hex),
      operation: tx.operation,
      safeTxGas: BigInt(tx.safeTxGas),
      baseGas: BigInt(tx.baseGas),
      gasPrice: BigInt(tx.gasPrice),
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver,
      nonce: tx.nonce,
      confirmations: tx.confirmations,
      confirmationsRequired: tx.confirmationsRequired,
      isExecuted: tx.isExecuted,
      safeTxHash: tx.safeTxHash,
      proposer: tx.proposer ?? tx.confirmations[0]?.owner ?? ('0x' as Address),
      submissionDate: tx.submissionDate ?? '',
    }))
  }

  /**
   * Propose a new transaction
   */
  async proposeTransaction(
    chainId: SupportedChainId,
    safeAddress: Address,
    tx: Omit<SafeTransaction, 'nonce'>,
    signer: {
      signMessage: (message: string) => Promise<Hex>
      address: Address
    },
  ): Promise<Hex> {
    const safeInfo = await this.getSafeInfo(chainId, safeAddress)
    const client = rpcService.getClient(chainId)

    // Get transaction hash
    const safeTxHash = (await client.readContract({
      address: safeAddress,
      abi: SAFE_ABI,
      functionName: 'getTransactionHash',
      args: [
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        BigInt(safeInfo.nonce),
      ],
    })) as Hex

    // Sign the hash
    const signature = await signer.signMessage(safeTxHash)

    // Submit to Safe Transaction Service
    const apiUrl = SAFE_API_URLS[chainId]
    if (apiUrl) {
      await this.submitToService(
        apiUrl,
        safeAddress,
        {
          ...tx,
          nonce: safeInfo.nonce,
        },
        safeTxHash,
        signer.address,
        signature,
      )
    }

    return safeTxHash
  }

  /**
   * Add confirmation to a pending transaction
   */
  async confirmTransaction(
    chainId: number,
    _safeAddress: Address,
    safeTxHash: Hex,
    signer: {
      signMessage: (message: string) => Promise<Hex>
      address: Address
    },
  ): Promise<void> {
    const apiUrl = SAFE_API_URLS[chainId]
    if (!apiUrl) {
      throw new Error(
        `Safe Transaction Service not available for chain ${chainId}`,
      )
    }

    const signature = await signer.signMessage(safeTxHash)

    const response = await fetch(
      `${apiUrl}/api/v1/multisig-transactions/${safeTxHash}/confirmations/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      },
    )

    if (!response.ok) {
      throw new Error('Failed to confirm transaction')
    }
  }

  /**
   * Execute a fully signed transaction
   */
  async executeTransaction(
    _chainId: SupportedChainId,
    safeAddress: Address,
    tx: SafeTransaction,
    signatures: Hex,
  ): Promise<{ to: Address; data: Hex; value: bigint }> {
    const data = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: 'execTransaction',
      args: [
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatures,
      ],
    })

    return {
      to: safeAddress,
      data,
      value: 0n,
    }
  }

  /**
   * Build packed signatures from confirmations
   */
  buildSignatures(confirmations: SafeConfirmation[]): Hex {
    // Sort by owner address
    const sorted = [...confirmations].sort((a, b) =>
      a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()),
    )

    // Pack signatures
    let packed = '0x'
    for (const conf of sorted) {
      // Remove 0x and append
      packed += conf.signature.slice(2)
    }

    return packed as Hex
  }

  /**
   * Create a simple ETH transfer transaction
   */
  createEthTransfer(
    to: Address,
    value: bigint,
  ): Omit<SafeTransaction, 'nonce'> {
    return {
      to,
      value,
      data: '0x' as Hex,
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: '0x0000000000000000000000000000000000000000' as Address,
      refundReceiver: '0x0000000000000000000000000000000000000000' as Address,
    }
  }

  /**
   * Create a token transfer transaction
   */
  createTokenTransfer(
    token: Address,
    to: Address,
    amount: bigint,
  ): Omit<SafeTransaction, 'nonce'> {
    const data = encodeFunctionData({
      abi: [
        {
          name: 'transfer',
          type: 'function',
          inputs: [{ type: 'address' }, { type: 'uint256' }],
          outputs: [{ type: 'bool' }],
        },
      ],
      functionName: 'transfer',
      args: [to, amount],
    })

    return {
      to: token,
      value: 0n,
      data,
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: '0x0000000000000000000000000000000000000000' as Address,
      refundReceiver: '0x0000000000000000000000000000000000000000' as Address,
    }
  }

  private async submitToService(
    apiUrl: string,
    safeAddress: Address,
    tx: SafeTransaction,
    safeTxHash: Hex,
    sender: Address,
    signature: Hex,
  ): Promise<void> {
    const response = await fetch(
      `${apiUrl}/api/v1/safes/${safeAddress}/multisig-transactions/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: tx.to,
          value: tx.value.toString(),
          data: tx.data,
          operation: tx.operation,
          safeTxGas: tx.safeTxGas.toString(),
          baseGas: tx.baseGas.toString(),
          gasPrice: tx.gasPrice.toString(),
          gasToken: tx.gasToken,
          refundReceiver: tx.refundReceiver,
          nonce: tx.nonce,
          contractTransactionHash: safeTxHash,
          sender,
          signature,
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to submit transaction: ${error}`)
    }
  }
}

export const safeService = new SafeService()
export { SafeService }
