/**
 * @fileoverview Subsquid EVM processor configuration for Jeju blockchain indexer
 * @module indexer/processor
 * 
 * Configures the blockchain indexer to capture comprehensive data from the Jeju network:
 * - All blocks with full metadata
 * - All transactions (successful and failed)
 * - All event logs from all contracts
 * - Optional traces for internal transaction tracking
 * 
 * The processor handles real-time indexing with finality confirmations and stores
 * structured data in PostgreSQL for GraphQL querying.
 * 
 * @see {@link https://docs.subsquid.io/evm-indexing/ Subsquid EVM Documentation}
 * 
 * @example Environment configuration
 * ```bash
 * RPC_ETH_HTTP=https://rpc.jeju.network  # Required: Jeju RPC endpoint
 * START_BLOCK=0                           # Optional: Starting block (default: 0)
 * ```
 */

import {assertNotNull} from '@subsquid/util-internal'
import {
    BlockHeader,
    DataHandlerContext,
    EvmBatchProcessor,
    EvmBatchProcessorFields,
    Log as _Log,
    Transaction as _Transaction,
    Trace as _Trace,
} from '@subsquid/evm-processor'

/**
 * Main blockchain processor instance
 * 
 * Configured to index the Jeju blockchain comprehensively:
 * - Connects to RPC endpoint specified in RPC_ETH_HTTP env var
 * - Waits for 10 block confirmations before considering data final
 * - Indexes ALL transactions and logs (no filtering)
 * - Extracts extensive metadata from blocks, transactions, and events
 * 
 * @remarks
 * The processor runs continuously, fetching new blocks as they're produced.
 * Data is batched for efficient database writes and made available via GraphQL API.
 * 
 * @example Using in main.ts
 * ```ts
 * import { processor } from './processor';
 * import { TypeormDatabase } from '@subsquid/typeorm-store';
 * 
 * processor.run(new TypeormDatabase(), async (ctx) => {
 *   for (let block of ctx.blocks) {
 *     // Process block data
 *   }
 * });
 * ```
 */
export const processor = new EvmBatchProcessor()
    /**
     * RPC endpoint configuration
     * 
     * Rate limit prevents overwhelming the RPC with too many concurrent requests.
     * Set to 10 requests/second for public RPCs, increase for dedicated nodes.
     */
    .setRpcEndpoint({
        url: assertNotNull(process.env.RPC_ETH_HTTP, 'No RPC endpoint supplied'),
        rateLimit: 10
    })
    /**
     * Finality confirmation depth
     * 
     * Waits for 10 block confirmations before considering data final.
     * This prevents reorg issues on the L3. Jeju has 2s block time,
     * so 10 blocks = 20 seconds of confirmation time.
     */
    .setFinalityConfirmation(10)
    /**
     * Field selection for blockchain data
     * 
     * Explicitly requests all fields needed for comprehensive indexing.
     * Requesting specific fields is more efficient than fetching everything.
     */
    .setFields({
        /** Block header fields */
        block: {
            gasUsed: true,        // Total gas used in block
            gasLimit: true,       // Block gas limit
            baseFeePerGas: true,  // EIP-1559 base fee
            difficulty: true,     // Always 0 for PoS/OP-Stack
            size: true,           // Block size in bytes
        },
        /** Transaction fields */
        transaction: {
            from: true,                    // Sender address
            to: true,                      // Recipient address (null for contract creation)
            value: true,                   // ETH value transferred
            hash: true,                    // Transaction hash
            gasPrice: true,                // Gas price (legacy or effective)
            gas: true,                     // Gas limit
            gasUsed: true,                 // Actual gas consumed
            input: true,                   // Call data
            nonce: true,                   // Sender nonce
            status: true,                  // Success (1) or failure (0)
            contractAddress: true,         // Created contract address (if creation tx)
            type: true,                    // Transaction type (0=legacy, 2=EIP-1559)
            maxFeePerGas: true,           // EIP-1559 max fee
            maxPriorityFeePerGas: true,   // EIP-1559 priority fee
        },
        /** Event log fields */
        log: {
            address: true,         // Contract that emitted the event
            data: true,            // Non-indexed event parameters
            topics: true,          // Indexed event parameters (topic0 = event signature)
            transactionHash: true, // Parent transaction hash
        },
        /** Trace fields (internal transactions) */
        trace: {
            type: true,         // call, create, suicide, reward
            action: true,       // Call parameters
            result: true,       // Call results
            error: true,        // Revert reason if failed
            subtraces: true,    // Number of child traces
            traceAddress: true, // Position in trace tree
        }
    })
    /**
     * Block range to index
     * 
     * Defaults to indexing from genesis (block 0).
     * Set START_BLOCK env var to start from a later block.
     */
    .setBlockRange({
        from: parseInt(process.env.START_BLOCK || '0'),
    })
    /**
     * Index ALL transactions
     * 
     * Empty selector {} means no filtering - captures every transaction.
     * This includes:
     * - Regular transfers
     * - Contract deployments
     * - Contract interactions
     * - Failed transactions
     * - Account abstraction (ERC-4337) UserOperations
     */
    .addTransaction({})
    /**
     * Index ALL event logs
     * 
     * CRITICAL: Empty selector {} means no filtering - captures every event!
     * 
     * This is essential for comprehensive indexing and includes:
     * - ERC20/721/1155 token transfers
     * - DeFi protocol events (swaps, deposits, borrows, etc.)
     * - Account abstraction events (UserOperationEvent, etc.)
     * - Paymaster events (TransactionSponsored, FeesDistributed, etc.)
     * - Oracle updates, governance votes, and more
     * 
     * The empty filter ensures no events are missed, making the indexer
     * truly comprehensive. Events are decoded and categorized in main.ts.
     */
    .addLog({})
    /**
     * Index transaction traces (commented out by default)
     * 
     * Traces provide internal transaction data (e.g., calls between contracts).
     * 
     * ⚠️ IMPORTANT: Requires archive node with debug_traceBlockByHash RPC method!
     * Most public RPCs don't support this. Enable only if you have an archive node.
     * 
     * To enable: Uncomment the line below
     */
    // .addTrace({})

export type Fields = EvmBatchProcessorFields<typeof processor>
export type Block = BlockHeader<Fields>
export type Log = _Log<Fields>
export type Transaction = _Transaction<Fields>
export type Trace = _Trace<Fields>
export type ProcessorContext<Store> = DataHandlerContext<Store, Fields>
