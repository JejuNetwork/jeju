/**
 * Subsquid EVM processor configuration
 */

import {
  type Log as _Log,
  type Trace as _Trace,
  type Transaction as _Transaction,
  type BlockHeader,
  type DataHandlerContext,
  EvmBatchProcessor,
  type EvmBatchProcessorFields,
} from '@subsquid/evm-processor'
import { config } from './config'

function getRpcUrl(): string {
  if (!config.rpcEthHttp) {
    throw new Error('RPC_ETH_HTTP environment variable is required')
  }
  return config.rpcEthHttp
}

// Use 0 finality confirmation for local development (Anvil has instant finality)
// In production, this should be set to a higher value (e.g., 10)
const isLocalDev =
  getRpcUrl().includes('localhost') || getRpcUrl().includes('127.0.0.1')

export const processor = new EvmBatchProcessor()
  .setRpcEndpoint({
    url: getRpcUrl(),
    // No rate limit for local dev (Anvil), 10 req/s for production
    ...(isLocalDev ? {} : { rateLimit: 10 }),
  })
  .setFinalityConfirmation(isLocalDev ? 0 : 10)
  .setFields({
    block: {
      gasUsed: true,
      gasLimit: true,
      baseFeePerGas: true,
      difficulty: true,
      size: true,
    },
    transaction: {
      from: true,
      to: true,
      value: true,
      hash: true,
      gasPrice: true,
      gas: true,
      gasUsed: true,
      input: true,
      nonce: true,
      status: true,
      contractAddress: true,
      type: true,
      maxFeePerGas: true,
      maxPriorityFeePerGas: true,
    },
    log: {
      address: true,
      data: true,
      topics: true,
      transactionHash: true,
    },
    trace: {
      error: true,
      subtraces: true,
      callFrom: true,
      callTo: true,
      callValue: true,
      callGas: true,
      callInput: true,
      callCallType: true,
      callResultGasUsed: true,
      callResultOutput: true,
      createFrom: true,
      createValue: true,
      createGas: true,
      createInit: true,
      createResultAddress: true,
      createResultCode: true,
      createResultGasUsed: true,
      suicideAddress: true,
      suicideRefundAddress: true,
      suicideBalance: true,
      rewardAuthor: true,
      rewardValue: true,
      rewardRewardType: true,
    },
  })
  .setBlockRange({
    from: config.startBlock,
  })
  .addTransaction({})
  .addLog({})
// .addTrace({})

export type Fields = EvmBatchProcessorFields<typeof processor>
export type Block = BlockHeader<Fields>
export type Log = _Log<Fields>
export type Transaction = _Transaction<Fields>
export type Trace = _Trace<Fields>
export type ProcessorContext<Store> = DataHandlerContext<Store, Fields>
