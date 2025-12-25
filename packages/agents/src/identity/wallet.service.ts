/**
 * Agent Wallet Service
 *
 * Manages agent wallet operations and transactions using:
 * - @jejunetwork/kms for MPC signing
 * - viem for blockchain interactions
 *
 * @packageDocumentation
 */

import { getMPCCoordinator } from '@jejunetwork/kms'
import { logger } from '@jejunetwork/shared'
import {
  type Address,
  createPublicClient,
  formatEther,
  type Hex,
  http,
} from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { agentIdentityService } from './identity.service'

/**
 * Wallet balance
 */
export interface WalletBalance {
  address: string
  eth: bigint
  tokens: Record<string, bigint>
}

/**
 * Transaction result
 */
export interface TransactionResult {
  hash: string
  success: boolean
  gasUsed?: bigint
  error?: string
}

/**
 * Token info for ERC20 operations
 */
interface TokenInfo {
  address: Address
  symbol: string
  decimals: number
}

/**
 * Common ERC20 tokens
 */
const KNOWN_TOKENS: Record<string, TokenInfo> = {
  USDC: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6,
  },
  USDT: {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    decimals: 6,
  },
  WETH: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18,
  },
}

/**
 * ERC20 ABI for balance/approve calls
 */
const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

/**
 * Get chain from environment
 */
function getChain() {
  const network = process.env.JEJU_NETWORK ?? 'testnet'
  return network === 'mainnet' ? mainnet : sepolia
}

/**
 * Get public client for reading chain state
 */
function getPublicClient() {
  const chain = getChain()
  const rpcUrl = process.env.RPC_URL ?? chain.rpcUrls.default.http[0]

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
}

/**
 * Agent Wallet Service
 *
 * Provides secure wallet operations for agents using MPC signing.
 */
export class AgentWalletService {
  /**
   * Get wallet balance including ETH and common tokens
   */
  async getBalance(walletAddress: string): Promise<WalletBalance> {
    logger.debug(`Getting wallet balance for ${walletAddress}`)

    const client = getPublicClient()
    const address = walletAddress as Address

    // Get ETH balance
    const ethBalance = await client.getBalance({ address })

    // Get token balances for common tokens
    const tokens: Record<string, bigint> = {}

    for (const [symbol, tokenInfo] of Object.entries(KNOWN_TOKENS)) {
      try {
        const balance = await client.readContract({
          address: tokenInfo.address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        })
        if (balance > 0n) {
          tokens[symbol] = balance
        }
      } catch {
        // Token may not exist on this network
      }
    }

    return {
      address: walletAddress,
      eth: ethBalance,
      tokens,
    }
  }

  /**
   * Sign a message with agent wallet using MPC
   */
  async signMessage(agentId: string, message: string): Promise<string> {
    logger.debug(`Signing message for agent ${agentId}`)

    const identity = await agentIdentityService.getAgentIdentity(agentId)
    if (!identity?.walletAddress) {
      throw new Error(`Agent ${agentId} has no wallet`)
    }

    const mpcCoordinator = getMPCCoordinator()

    // Sign using MPC threshold signing
    const signResult = await mpcCoordinator.sign({
      keyId: `agent-${agentId}`,
      message: Buffer.from(message).toString('hex'),
      signers: [], // Coordinator will select signers
    })

    return signResult.signature
  }

  /**
   * Sign typed data (EIP-712)
   */
  async signTypedData(
    agentId: string,
    domain: {
      name: string
      version: string
      chainId: number
      verifyingContract: Address
    },
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
  ): Promise<string> {
    logger.debug(`Signing typed data for agent ${agentId}`)

    const identity = await agentIdentityService.getAgentIdentity(agentId)
    if (!identity?.walletAddress) {
      throw new Error(`Agent ${agentId} has no wallet`)
    }

    // Compute typed data hash (EIP-712)
    const { hashTypedData } = await import('viem')
    const hash = hashTypedData({
      domain,
      types,
      primaryType: Object.keys(types)[0] as string,
      message: value as Record<string, unknown>,
    })

    const mpcCoordinator = getMPCCoordinator()

    // Sign the hash using MPC
    const signResult = await mpcCoordinator.sign({
      keyId: `agent-${agentId}`,
      message: hash.slice(2), // Remove 0x prefix
      signers: [],
    })

    return signResult.signature
  }

  /**
   * Send a transaction
   */
  async sendTransaction(
    agentId: string,
    to: string,
    value: bigint,
    data?: string,
  ): Promise<TransactionResult> {
    logger.info(
      `Sending transaction from agent ${agentId} to ${to}: ${formatEther(value)} ETH`,
    )

    const identity = await agentIdentityService.getAgentIdentity(agentId)
    if (!identity?.walletAddress) {
      throw new Error(`Agent ${agentId} has no wallet`)
    }

    const client = getPublicClient()
    const chain = getChain()

    // Get nonce
    const nonce = await client.getTransactionCount({
      address: identity.walletAddress as Address,
    })

    // Estimate gas
    const gasLimit = await client.estimateGas({
      account: identity.walletAddress as Address,
      to: to as Address,
      value,
      data: data as Hex | undefined,
    })

    // Get gas price
    const gasPrice = await client.getGasPrice()

    // Build transaction
    const tx = {
      to: to as Address,
      value,
      data: data as Hex | undefined,
      nonce,
      gasLimit,
      gasPrice,
      chainId: chain.id,
    }

    // Serialize and sign transaction using MPC
    const { serializeTransaction, keccak256 } = await import('viem')
    const serialized = serializeTransaction(tx)
    const txHash = keccak256(serialized)

    const mpcCoordinator = getMPCCoordinator()
    const signResult = await mpcCoordinator.sign({
      keyId: `agent-${agentId}`,
      message: txHash.slice(2),
      signers: [],
    })

    // Append signature to transaction
    const signedTx = serializeTransaction(tx, {
      r: `0x${signResult.signature.slice(0, 64)}` as Hex,
      s: `0x${signResult.signature.slice(64, 128)}` as Hex,
      v: BigInt(parseInt(signResult.signature.slice(128, 130), 16)),
    })

    // Broadcast transaction
    const hash = await client.request({
      method: 'eth_sendRawTransaction',
      params: [signedTx],
    })

    logger.info(`Transaction sent: ${hash}`)

    // Wait for receipt
    const receipt = await client.waitForTransactionReceipt({
      hash: hash as Hex,
    })

    return {
      hash: receipt.transactionHash,
      success: receipt.status === 'success',
      gasUsed: receipt.gasUsed,
    }
  }

  /**
   * Approve token spending
   */
  async approveToken(
    agentId: string,
    tokenAddress: string,
    spender: string,
    amount: bigint,
  ): Promise<TransactionResult> {
    logger.info(`Approving ${amount} tokens for ${spender}`)

    const { encodeFunctionData } = await import('viem')

    // Encode approve call
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender as Address, amount],
    })

    return this.sendTransaction(agentId, tokenAddress, 0n, data)
  }

  /**
   * Transfer tokens
   */
  async transferToken(
    agentId: string,
    tokenAddress: string,
    to: string,
    amount: bigint,
  ): Promise<TransactionResult> {
    logger.info(`Transferring ${amount} tokens to ${to}`)

    const { encodeFunctionData } = await import('viem')

    // Encode transfer call
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to as Address, amount],
    })

    return this.sendTransaction(agentId, tokenAddress, 0n, data)
  }

  /**
   * Get estimated gas for a transaction
   */
  async estimateGas(
    from: string,
    to: string,
    value: bigint,
    data?: string,
  ): Promise<bigint> {
    const client = getPublicClient()

    return client.estimateGas({
      account: from as Address,
      to: to as Address,
      value,
      data: data as Hex | undefined,
    })
  }

  /**
   * Check if agent has sufficient balance for a transaction
   */
  async hasSufficientBalance(
    agentId: string,
    requiredEth: bigint,
    tokenRequirements?: Record<string, bigint>,
  ): Promise<boolean> {
    const identity = await agentIdentityService.getAgentIdentity(agentId)
    if (!identity?.walletAddress) {
      return false
    }

    const balance = await this.getBalance(identity.walletAddress)

    // Check ETH
    if (balance.eth < requiredEth) {
      return false
    }

    // Check tokens if specified
    if (tokenRequirements) {
      for (const [symbol, required] of Object.entries(tokenRequirements)) {
        const available = balance.tokens[symbol] ?? 0n
        if (available < required) {
          return false
        }
      }
    }

    return true
  }
}

/** Singleton instance */
export const agentWalletService = new AgentWalletService()
