/**
 * ZKSolBridge Event Processor
 * Indexes cross-chain bridge events for the Solana ↔ EVM bridge
 */

import {
  type Log as _Log,
  type Transaction as _Transaction,
  type BlockHeader,
  type DataHandlerContext,
  EvmBatchProcessor,
  type EvmBatchProcessorFields,
} from '@subsquid/evm-processor'
import type { Store } from '@subsquid/typeorm-store'
import { assertNotNull } from '@subsquid/util-internal'
import * as bridgeAbi from './abi/zksolbridge'

// Bridge contract addresses per chain
const BRIDGE_CONTRACTS: Record<number, string> = {
  1: process.env.BRIDGE_ADDRESS_MAINNET ?? '',
  8453: process.env.BRIDGE_ADDRESS_BASE ?? '',
  42161: process.env.BRIDGE_ADDRESS_ARBITRUM ?? '',
  10: process.env.BRIDGE_ADDRESS_OPTIMISM ?? '',
  84532: process.env.BRIDGE_ADDRESS_BASE_SEPOLIA ?? '',
}

// Light client contract addresses per chain
const LIGHT_CLIENT_CONTRACTS: Record<number, string> = {
  1: process.env.LIGHT_CLIENT_ADDRESS_MAINNET ?? '',
  8453: process.env.LIGHT_CLIENT_ADDRESS_BASE ?? '',
  42161: process.env.LIGHT_CLIENT_ADDRESS_ARBITRUM ?? '',
  10: process.env.LIGHT_CLIENT_ADDRESS_OPTIMISM ?? '',
  84532: process.env.LIGHT_CLIENT_ADDRESS_BASE_SEPOLIA ?? '',
}

// Event signatures
const TRANSFER_INITIATED_TOPIC = `0x${bridgeAbi.events.TransferInitiated.topic.slice(2)}`
const TRANSFER_COMPLETED_TOPIC = `0x${bridgeAbi.events.TransferCompleted.topic.slice(2)}`
const SLOT_VERIFIED_TOPIC = `0x${bridgeAbi.events.SlotVerified.topic.slice(2)}`

const chainId = parseInt(process.env.CHAIN_ID ?? '8453', 10)
const bridgeAddress = BRIDGE_CONTRACTS[chainId]
const lightClientAddress = LIGHT_CLIENT_CONTRACTS[chainId]

export const bridgeProcessor = new EvmBatchProcessor()
  .setRpcEndpoint({
    url: assertNotNull(process.env.RPC_ETH_HTTP, 'RPC_ETH_HTTP is required'),
    rateLimit: 10,
  })
  .setFinalityConfirmation(10)
  .setBlockRange({
    from: parseInt(process.env.START_BLOCK ?? '0', 10),
  })
  .setFields({
    block: {
      timestamp: true,
      baseFeePerGas: true,
    },
    transaction: {
      from: true,
      to: true,
      value: true,
      hash: true,
      gasUsed: true,
      status: true,
    },
    log: {
      transactionHash: true,
      topics: true,
      data: true,
    },
  })
  .addLog({
    address: [bridgeAddress],
    topic0: [TRANSFER_INITIATED_TOPIC, TRANSFER_COMPLETED_TOPIC],
    transaction: true,
  })
  .addLog({
    address: [lightClientAddress],
    topic0: [SLOT_VERIFIED_TOPIC],
    transaction: true,
  })

export type Fields = EvmBatchProcessorFields<typeof bridgeProcessor>
export type Block = BlockHeader<Fields>
export type Log = _Log<Fields>
export type Transaction = _Transaction<Fields>
export type ProcessorContext<S> = DataHandlerContext<S, Fields>

// Database entities (would be defined in model/)
interface BridgeTransfer {
  id: string
  transferId: string
  token: string
  sender: string
  recipient: string
  amount: bigint
  sourceChainId: number
  destChainId: number
  status: 'initiated' | 'completed' | 'failed'
  initiatedAt: Date
  completedAt: Date | null
  initiatedTxHash: string
  completedTxHash: string | null
  slot: bigint | null
  blockNumber: number
}

interface LightClientUpdate {
  id: string
  slot: bigint
  bankHash: string
  verifiedAt: Date
  txHash: string
  blockNumber: number
}

// Process bridge events
export async function processBridgeEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const transfers: BridgeTransfer[] = []
  const lightClientUpdates: LightClientUpdate[] = []

  for (const block of ctx.blocks) {
    for (const log of block.logs) {
      if (log.address.toLowerCase() === bridgeAddress.toLowerCase()) {
        if (log.topics[0] === TRANSFER_INITIATED_TOPIC) {
          const event = bridgeAbi.events.TransferInitiated.decode(log)
          transfers.push({
            id: `${log.transactionHash}-${log.logIndex}`,
            transferId: event.transferId,
            token: event.token,
            sender: event.sender,
            recipient: event.recipient,
            amount: event.amount,
            sourceChainId: chainId,
            destChainId: Number(event.destChainId),
            status: 'initiated',
            initiatedAt: new Date(block.header.timestamp),
            completedAt: null,
            initiatedTxHash: log.transactionHash,
            completedTxHash: null,
            slot: null,
            blockNumber: block.header.height,
          })
        } else if (log.topics[0] === TRANSFER_COMPLETED_TOPIC) {
          const event = bridgeAbi.events.TransferCompleted.decode(log)
          // Update existing transfer or create completed entry
          const transfer = transfers.find(
            (t) => t.transferId === event.transferId,
          )
          if (transfer) {
            transfer.status = 'completed'
            transfer.completedAt = new Date(block.header.timestamp)
            transfer.completedTxHash = log.transactionHash
          }
        }
      }

      if (log.address.toLowerCase() === lightClientAddress.toLowerCase()) {
        if (log.topics[0] === SLOT_VERIFIED_TOPIC) {
          const event = bridgeAbi.events.SlotVerified.decode(log)
          lightClientUpdates.push({
            id: `${log.transactionHash}-${log.logIndex}`,
            slot: event.slot,
            bankHash: event.bankHash,
            verifiedAt: new Date(block.header.timestamp),
            txHash: log.transactionHash,
            blockNumber: block.header.height,
          })
        }
      }
    }
  }

  // Save to database
  // await ctx.store.upsert(transfers);
  // await ctx.store.upsert(lightClientUpdates);

  if (transfers.length > 0 || lightClientUpdates.length > 0) {
    ctx.log.info(
      `Processed ${transfers.length} transfers, ${lightClientUpdates.length} light client updates`,
    )
  }
}

// Main entry point - this file is typically run via sqd commands
// Uncomment below if running directly with node/bun
// bridgeProcessor.run(new TypeormDatabase({ supportHotBlocks: true }), async (ctx) => {
//   await processBridgeEvents(ctx);
// });
