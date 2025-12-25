/**
 * Across Protocol Solver Integration
 *
 * Across (across.to) is a cross-chain bridge using intents.
 * We can act as a relayer to fill deposits and earn fees.
 *
 * Flow:
 * 1. User deposits on source chain via SpokePool
 * 2. We see FundsDeposited event
 * 3. We fill on destination chain via SpokePool.fillRelay()
 * 4. Earn relayer fee (typically 5-15 bps)
 */

import { EventEmitter } from 'node:events'
import {
  type Address,
  encodeAbiParameters,
  keccak256,
  type PublicClient,
  parseAbiItem,
  parseAbiParameters,
  type WalletClient,
} from 'viem'

// Across SpokePool addresses (mainnet)
export const ACROSS_SPOKE_POOLS: Record<number, Address> = {
  1: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5', // Ethereum
  42161: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a', // Arbitrum
  10: '0x6f26Bf09B1C792e3228e5467807a900A503c0281', // Optimism
  8453: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64', // Base
  137: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096', // Polygon
}

// Testnet SpokePool addresses
export const ACROSS_SPOKE_POOLS_TESTNET: Record<number, Address> = {
  11155111: '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662', // Sepolia
  421614: '0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75', // Arbitrum Sepolia
  84532: '0x82B564983aE7274c86695917BBf8C99ECb6F0F8F', // Base Sepolia
  11155420: '0x4e8E101E1C85DB23c021eD76c6E28f2fAd3b8cc8', // OP Sepolia
}

/** Event args from V3FundsDeposited log */
interface V3FundsDepositedArgs {
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  depositId: number
  quoteTimestamp: number
  fillDeadline: number
  exclusivityDeadline: number
  depositor: Address
  recipient: Address
  exclusiveRelayer: Address
  message: `0x${string}`
}

export interface AcrossDeposit {
  depositId: number
  originChainId: number
  destinationChainId: number
  depositor: Address
  recipient: Address
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  relayerFeePct: bigint
  quoteTimestamp: number
  fillDeadline: number
  exclusivityDeadline: number
  exclusiveRelayer: Address
  message: `0x${string}`
  transactionHash: `0x${string}`
  blockNumber: bigint
}

// Across V3 FundsDeposited event
const FUNDS_DEPOSITED_EVENT = parseAbiItem(
  'event V3FundsDeposited(address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint32 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed depositor, address recipient, address exclusiveRelayer, bytes message)',
)

// Across V3 fillRelay function
const FILL_RELAY_ABI = [
  {
    type: 'function',
    name: 'fillV3Relay',
    inputs: [
      {
        name: 'relayData',
        type: 'tuple',
        components: [
          { name: 'depositor', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'exclusiveRelayer', type: 'address' },
          { name: 'inputToken', type: 'address' },
          { name: 'outputToken', type: 'address' },
          { name: 'inputAmount', type: 'uint256' },
          { name: 'outputAmount', type: 'uint256' },
          { name: 'originChainId', type: 'uint256' },
          { name: 'depositId', type: 'uint32' },
          { name: 'fillDeadline', type: 'uint32' },
          { name: 'exclusivityDeadline', type: 'uint32' },
          { name: 'message', type: 'bytes' },
        ],
      },
      { name: 'repaymentChainId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

// Check if deposit is filled
const IS_DEPOSIT_FILLED_ABI = [
  {
    type: 'function',
    name: 'fillStatuses',
    inputs: [{ name: 'relayHash', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }], // 0 = unfilled, 1 = filled
    stateMutability: 'view',
  },
] as const

export class AcrossAdapter extends EventEmitter {
  private clients: Map<number, { public: PublicClient; wallet?: WalletClient }>
  private supportedChains: number[]
  private spokePoolAddresses: Record<number, Address>
  private unwatchers: Array<() => void> = []
  private running = false

  constructor(
    clients: Map<number, { public: PublicClient; wallet?: WalletClient }>,
    supportedChains: number[],
    isTestnet = false,
  ) {
    super()
    this.clients = clients
    this.supportedChains = supportedChains
    this.spokePoolAddresses = isTestnet
      ? ACROSS_SPOKE_POOLS_TESTNET
      : ACROSS_SPOKE_POOLS
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    console.log('🌉 Starting Across Protocol monitor...')

    for (const chainId of this.supportedChains) {
      const spokePool = this.spokePoolAddresses[chainId]
      if (!spokePool) {
        console.log(`[Across] No SpokePool for chain ${chainId}, skipping`)
        continue
      }

      const client = this.clients.get(chainId)
      if (!client) {
        console.log(`[Across] No client for chain ${chainId}, skipping`)
        continue
      }

      const unwatch = client.public.watchContractEvent({
        address: spokePool,
        abi: [FUNDS_DEPOSITED_EVENT],
        eventName: 'V3FundsDeposited',
        onLogs: (logs) => {
          for (const log of logs) {
            this.handleDeposit(Number(chainId), log)
          }
        },
        onError: (err) =>
          console.error(`Across error on ${chainId}:`, err.message),
      })

      this.unwatchers.push(unwatch)
      console.log(`   ✓ Watching Across SpokePool on chain ${chainId}`)
    }
  }

  stop(): void {
    this.running = false
    this.unwatchers.forEach((fn) => {
      fn()
    })
    this.unwatchers = []
  }

  private handleDeposit(
    originChainId: number,
    log: {
      args: Record<string, unknown>
      blockNumber: bigint
      transactionHash: `0x${string}`
    },
  ): void {
    const args = log.args as unknown as V3FundsDepositedArgs

    const deposit: AcrossDeposit = {
      depositId: args.depositId,
      originChainId,
      destinationChainId: Number(args.destinationChainId),
      depositor: args.depositor,
      recipient: args.recipient,
      inputToken: args.inputToken,
      outputToken: args.outputToken,
      inputAmount: args.inputAmount,
      outputAmount: args.outputAmount,
      relayerFeePct:
        ((args.inputAmount - args.outputAmount) * 10000n) / args.inputAmount,
      quoteTimestamp: args.quoteTimestamp,
      fillDeadline: args.fillDeadline,
      exclusivityDeadline: args.exclusivityDeadline,
      exclusiveRelayer: args.exclusiveRelayer,
      message: args.message,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
    }

    console.log(
      `🌉 Across deposit: ${deposit.depositId} | ${originChainId} → ${deposit.destinationChainId}`,
    )
    this.emit('deposit', deposit)
  }

  /**
   * Fill an Across deposit on the destination chain
   */
  async fill(
    deposit: AcrossDeposit,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const client = this.clients.get(deposit.destinationChainId)
    const spokePool = this.spokePoolAddresses[deposit.destinationChainId]

    if (!client?.wallet) {
      return { success: false, error: 'No wallet for destination chain' }
    }
    if (!spokePool) {
      return { success: false, error: 'No SpokePool on destination chain' }
    }

    // Check if already filled
    const relayHash = this.computeRelayHash(deposit)
    const fillStatus = await client.public.readContract({
      address: spokePool,
      abi: IS_DEPOSIT_FILLED_ABI,
      functionName: 'fillStatuses',
      args: [relayHash],
    })

    if (fillStatus > BigInt(0)) {
      return { success: false, error: 'Already filled' }
    }

    // Check exclusivity
    const now = Math.floor(Date.now() / 1000)
    if (
      deposit.exclusiveRelayer !==
        '0x0000000000000000000000000000000000000000' &&
      now < deposit.exclusivityDeadline &&
      deposit.exclusiveRelayer !== client.wallet.account?.address
    ) {
      return { success: false, error: 'Exclusive relayer period active' }
    }

    const relayData = {
      depositor: deposit.depositor,
      recipient: deposit.recipient,
      exclusiveRelayer: deposit.exclusiveRelayer,
      inputToken: deposit.inputToken,
      outputToken: deposit.outputToken,
      inputAmount: deposit.inputAmount,
      outputAmount: deposit.outputAmount,
      originChainId: BigInt(deposit.originChainId),
      depositId: deposit.depositId,
      fillDeadline: deposit.fillDeadline,
      exclusivityDeadline: deposit.exclusivityDeadline,
      message: deposit.message,
    }

    const value =
      deposit.outputToken === '0x0000000000000000000000000000000000000000'
        ? deposit.outputAmount
        : 0n

    const account = client.wallet.account
    if (!account) {
      return { success: false, error: 'No account configured' }
    }

    const hash = await client.wallet.writeContract({
      chain: client.wallet.chain,
      account,
      address: spokePool,
      abi: FILL_RELAY_ABI,
      functionName: 'fillV3Relay',
      args: [relayData, BigInt(deposit.originChainId)],
      value,
    })

    const receipt = await client.public.waitForTransactionReceipt({ hash })

    if (receipt.status === 'reverted') {
      return { success: false, error: 'Transaction reverted' }
    }

    console.log(`[Across] Fill success: ${hash}`)
    return { success: true, txHash: hash }
  }

  private computeRelayHash(deposit: AcrossDeposit): `0x${string}` {
    // Compute relay hash per Across V3 spec
    const encoded = encodeAbiParameters(
      parseAbiParameters(
        'address,address,address,address,address,uint256,uint256,uint256,uint32,uint32,uint32,bytes',
      ),
      [
        deposit.depositor,
        deposit.recipient,
        deposit.exclusiveRelayer,
        deposit.inputToken,
        deposit.outputToken,
        deposit.inputAmount,
        deposit.outputAmount,
        BigInt(deposit.originChainId),
        deposit.depositId,
        deposit.fillDeadline,
        deposit.exclusivityDeadline,
        deposit.message,
      ],
    )

    return keccak256(encoded)
  }

  /**
   * Calculate profitability of filling a deposit
   */
  evaluateProfitability(
    deposit: AcrossDeposit,
    gasPrice: bigint,
    _ethPriceUsd: number,
  ): { profitable: boolean; expectedProfitBps: number; reason?: string } {
    // Relayer fee is input - output
    const fee = deposit.inputAmount - deposit.outputAmount

    // Estimate gas cost (~200k gas for fill)
    const gasCost = BigInt(200000) * gasPrice

    // Net profit
    const netProfit = fee - gasCost

    if (netProfit <= BigInt(0)) {
      return {
        profitable: false,
        expectedProfitBps: 0,
        reason: 'Gas exceeds fee',
      }
    }

    const profitBps = Number((netProfit * BigInt(10000)) / deposit.inputAmount)

    // Minimum 5 bps profit
    if (profitBps < 5) {
      return {
        profitable: false,
        expectedProfitBps: profitBps,
        reason: 'Below minimum profit',
      }
    }

    return { profitable: true, expectedProfitBps: profitBps }
  }
}
