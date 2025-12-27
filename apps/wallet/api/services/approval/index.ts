/**
 * Token Approval Service
 * Uses network indexer for approval data
 */

import {
  type Address,
  encodeFunctionData,
  type Hex,
  isAddress,
  maxUint256,
} from 'viem'
import * as jeju from '../jeju'
import { rpcService, type SupportedChainId } from '../rpc'
import type { RiskLevel } from '../security'

export interface TokenApproval {
  tokenAddress: Address
  tokenSymbol: string
  spender: Address
  spenderName?: string
  allowance: bigint
  isUnlimited: boolean
  chainId: number
  riskLevel: RiskLevel
  lastUpdated: number
}

export interface NFTApproval {
  contractAddress: Address
  contractName: string
  spender: Address
  spenderName?: string
  tokenId?: bigint
  isApprovedForAll: boolean
  chainId: number
}

export interface ApprovalSummary {
  totalTokenApprovals: number
  totalNFTApprovals: number
  unlimitedApprovals: number
  highRiskApprovals: number
  tokenApprovals: TokenApproval[]
  nftApprovals: NFTApproval[]
}

// Known spender labels
const KNOWN_SPENDERS: Record<string, string> = {
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2',
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'Uniswap V3',
  '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3 Router',
  '0x1111111254eeb25477b68a50d0bca0a44a2bf7c0': '1inch',
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x Exchange',
}

// ERC20 ABI fragment
const ERC20_ABI = [
  {
    name: 'allowance',
    type: 'function',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const

class ApprovalService {
  // Get all approvals from indexer
  async getApprovals(owner: Address): Promise<ApprovalSummary> {
    try {
      const indexed = await jeju.getApprovals(owner)

      // Build approval map (latest per token+spender)
      const approvalMap = new Map<string, TokenApproval>()

      for (const a of indexed) {
        // Validate addresses from indexer
        if (!isAddress(a.token) || !isAddress(a.spender)) {
          continue
        }
        const tokenAddress: Address = a.token
        const spender: Address = a.spender

        const key = `${tokenAddress}:${spender}`
        const existing = approvalMap.get(key)
        const timestamp = new Date(a.timestamp).getTime()

        // Validate timestamp is valid
        if (Number.isNaN(timestamp)) {
          continue
        }

        if (!existing || timestamp > existing.lastUpdated) {
          // Validate value is a valid BigInt string before conversion
          let allowance: bigint
          try {
            // Ensure the value is a valid numeric string
            if (typeof a.value !== 'string' || !/^\d+$/.test(a.value)) {
              continue
            }
            allowance = BigInt(a.value)
          } catch {
            console.warn(
              `Failed to parse approval value for ${key}: ${a.value}, skipping`,
            )
            continue
          }
          const isUnlimited = allowance >= maxUint256 / 2n

          approvalMap.set(key, {
            tokenAddress,
            tokenSymbol: a.tokenSymbol,
            spender,
            spenderName: KNOWN_SPENDERS[spender.toLowerCase()],
            allowance,
            isUnlimited,
            chainId: a.chainId,
            riskLevel: isUnlimited ? 'high' : 'low',
            lastUpdated: timestamp,
          })
        }
      }

      // Filter out revoked (0 allowance)
      const tokenApprovals = Array.from(approvalMap.values())
        .filter((a) => a.allowance > 0n)
        .sort((a, b) => b.lastUpdated - a.lastUpdated)

      const unlimitedApprovals = tokenApprovals.filter(
        (a) => a.isUnlimited,
      ).length
      const highRiskApprovals = tokenApprovals.filter(
        (a) => a.riskLevel === 'high',
      ).length

      // Fetch NFT approvals from indexer
      const indexedNFTApprovals = await jeju.getNFTApprovals(owner)

      const nftApprovals: NFTApproval[] = indexedNFTApprovals.map((a) => ({
        contractAddress: a.contractAddress as Address,
        contractName: a.contractName,
        spender: a.operator as Address,
        spenderName: KNOWN_SPENDERS[a.operator.toLowerCase()],
        tokenId: a.tokenId ? BigInt(a.tokenId) : undefined,
        isApprovedForAll: a.isApprovalForAll,
        chainId: a.chainId,
      }))

      return {
        totalTokenApprovals: tokenApprovals.length,
        totalNFTApprovals: nftApprovals.length,
        unlimitedApprovals,
        highRiskApprovals,
        tokenApprovals,
        nftApprovals,
      }
    } catch (error) {
      // Re-throw with context - approval data is critical for security
      throw new Error(
        `Failed to fetch approvals: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Get allowance for specific token+spender
  async getAllowance(
    chainId: SupportedChainId,
    tokenAddress: Address,
    owner: Address,
    spender: Address,
  ): Promise<bigint> {
    const client = rpcService.getClient(chainId)
    const result = await client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, spender],
    })
    return result as bigint
  }

  // Build revoke transaction
  buildRevoke(
    _chainId: SupportedChainId,
    tokenAddress: Address,
    spender: Address,
  ): { to: Address; data: Hex; value: bigint } {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, 0n],
    })
    return { to: tokenAddress, data, value: 0n }
  }

  // Build approve transaction
  buildApprove(
    _chainId: SupportedChainId,
    tokenAddress: Address,
    spender: Address,
    amount: bigint | 'unlimited',
  ): { to: Address; data: Hex; value: bigint } {
    const approveAmount = amount === 'unlimited' ? maxUint256 : amount
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, approveAmount],
    })
    return { to: tokenAddress, data, value: 0n }
  }

  // Format allowance for display
  formatAllowance(allowance: bigint, decimals: number): string {
    if (allowance >= maxUint256 / 2n) return 'Unlimited'
    const value = Number(allowance) / 10 ** decimals
    if (value > 1e9) return `${(value / 1e9).toFixed(1)}B`
    if (value > 1e6) return `${(value / 1e6).toFixed(1)}M`
    if (value > 1e3) return `${(value / 1e3).toFixed(1)}K`
    return value.toFixed(2)
  }

  // Get spender name
  getSpenderName(address: Address): string | undefined {
    return KNOWN_SPENDERS[address.toLowerCase()]
  }
}

export const approvalService = new ApprovalService()
export { ApprovalService }
