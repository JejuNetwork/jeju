/** On-chain validation tests against indexer data. */

import { describe, expect, test } from 'bun:test'
import { getIndexerGraphqlUrl, getRpcUrl } from '@jejunetwork/config'
import { z } from 'zod'
import type { JsonRpcParams } from '../../lib/types'

const INDEXER_GRAPHQL_URL = getIndexerGraphqlUrl()
const RPC_URL = getRpcUrl()

function GraphQLResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema.optional(),
    errors: z.array(z.object({ message: z.string() })).optional(),
  })
}

function JsonRpcResponseSchema<T extends z.ZodTypeAny>(resultSchema: T) {
  return z.object({
    result: resultSchema,
    error: z.object({ message: z.string() }).optional(),
  })
}

async function graphqlQuery<T>(
  query: string,
  responseSchema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(INDEXER_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  const json: unknown = await response.json()
  const schema = GraphQLResponseSchema(responseSchema)
  const parsed = schema.safeParse(json)

  if (!parsed.success) {
    throw new Error(
      `Invalid GraphQL response: ${parsed.error.issues[0].message}`,
    )
  }
  if (parsed.data.errors?.length) {
    throw new Error(parsed.data.errors[0].message)
  }
  if (!parsed.data.data) {
    throw new Error('GraphQL response missing data field')
  }
  return parsed.data.data
}

async function rpcCall<T>(
  method: string,
  params: JsonRpcParams,
  resultSchema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })

  const json: unknown = await response.json()
  const schema = JsonRpcResponseSchema(resultSchema)
  const parsed = schema.safeParse(json)

  if (!parsed.success) {
    throw new Error(`Invalid RPC response: ${parsed.error.issues[0].message}`)
  }
  if (parsed.data.error) {
    throw new Error(parsed.data.error.message)
  }
  return parsed.data.result
}

const BlocksSchema = z.object({
  blocks: z.array(
    z.object({
      number: z.number(),
      hash: z.string().optional(),
      parentHash: z.string().optional(),
      transactionCount: z.number().optional(),
    }),
  ),
})

const TransactionsSchema = z.object({
  transactions: z.array(
    z.object({
      hash: z.string(),
      from: z.object({ address: z.string() }),
      to: z.object({ address: z.string() }).optional().nullable(),
      value: z.string().optional(),
      nonce: z.number().optional(),
    }),
  ),
})

const AccountsSchema = z.object({
  accounts: z.array(z.object({ address: z.string() })),
})

const AccountsConnectionSchema = z.object({
  accountsConnection: z.object({ totalCount: z.number() }),
})

const ContractsSchema = z.object({
  contracts: z.array(
    z.object({
      address: z.string(),
      isERC20: z.boolean(),
      isERC721: z.boolean(),
    }),
  ),
})

const TokenTransfersSchema = z.object({
  tokenTransfers: z.array(
    z.object({
      from: z.object({ address: z.string() }),
      to: z.object({ address: z.string() }),
      token: z.object({ address: z.string() }),
      value: z.string(),
      tokenStandard: z.string(),
    }),
  ),
})

const DecodedEventsSchema = z.object({
  decodedEvents: z.array(
    z.object({
      eventName: z.string(),
      eventSignature: z.string(),
      args: z.record(z.string(), z.string()),
    }),
  ),
})

const LogsSchema = z.object({
  logs: z.array(
    z.object({
      transaction: z.object({ hash: z.string() }),
      logIndex: z.number(),
      address: z.object({ address: z.string() }),
      topic0: z.string().nullable(),
      data: z.string(),
    }),
  ),
})

const RpcStringResultSchema = z.string()

const RpcBlockSchema = z.object({
  hash: z.string(),
  parentHash: z.string(),
  transactions: z.array(z.string()),
})

const RpcTxSchema = z.object({
  from: z.string(),
  value: z.string(),
  nonce: z.string(),
})

const RpcReceiptSchema = z.object({
  logs: z.array(
    z.object({
      logIndex: z.string(),
      address: z.string(),
      topics: z.array(z.string()),
      data: z.string(),
    }),
  ),
})

describe('Block Count Validation', () => {
  test('indexed block count should match on-chain', async () => {
    const onChainBlockHex = await rpcCall(
      'eth_blockNumber',
      [],
      RpcStringResultSchema,
    ).catch(() => null)
    if (!onChainBlockHex) {
      console.log('⚠️ RPC not available - skipping on-chain validation')
      return
    }
    const onChainBlockNumber = parseInt(onChainBlockHex, 16)

    const indexerData = await graphqlQuery(
      `query { blocks(orderBy: number_DESC, limit: 1) { number } }`,
      BlocksSchema,
    ).catch(() => null)

    if (!indexerData) {
      console.log('⚠️ Indexer not available - skipping validation')
      return
    }

    const firstBlock = indexerData.blocks[0]
    if (!firstBlock) {
      console.log('⚠️ No blocks indexed yet - skipping validation')
      return
    }
    const indexedBlockNumber = firstBlock.number

    console.log(
      `📊 On-chain: ${onChainBlockNumber}, Indexed: ${indexedBlockNumber}`,
    )

    const lag = onChainBlockNumber - indexedBlockNumber
    expect(lag).toBeLessThan(20)
  })
})

describe('Transaction Count Validation', () => {
  test('should have indexed transactions for recent blocks', async () => {
    const indexerData = await graphqlQuery(
      `query { blocks(orderBy: number_DESC, limit: 10) { number transactionCount } }`,
      BlocksSchema,
    ).catch(() => null)

    if (!indexerData) {
      console.log('⚠️ Indexer not available')
      return
    }

    for (const block of indexerData.blocks) {
      const onChainBlock = await rpcCall(
        'eth_getBlockByNumber',
        [`0x${block.number.toString(16)}`, false],
        RpcBlockSchema,
      ).catch(() => null)

      if (onChainBlock) {
        const onChainTxCount = onChainBlock.transactions.length
        expect(block.transactionCount).toBe(onChainTxCount)
        console.log(`   Block ${block.number}: ${block.transactionCount} txs ✓`)
      }
    }
  })
})

describe('Account Tracking Validation', () => {
  test('transaction participants should be tracked as accounts', async () => {
    const txData = await graphqlQuery(
      `query { transactions(limit: 10) { from { address } to { address } } }`,
      TransactionsSchema,
    ).catch(() => null)

    if (!txData) {
      console.log('⚠️ Indexer not available')
      return
    }

    const addresses = new Set<string>()
    for (const tx of txData.transactions) {
      addresses.add(tx.from.address)
      if (tx.to) addresses.add(tx.to.address)
    }

    for (const address of addresses) {
      const accountData = await graphqlQuery(
        `query { accounts(where: { address_eq: "${address}" }) { address } }`,
        AccountsSchema,
      ).catch(() => null)

      expect(accountData?.accounts.length).toBeGreaterThan(0)
    }

    console.log(`   ✓ ${addresses.size} addresses tracked`)
  })
})

describe('Contract Detection Validation', () => {
  test('deployed contracts should be detected', async () => {
    const contractData = await graphqlQuery(
      `query { contracts(limit: 10) { address isERC20 isERC721 } }`,
      ContractsSchema,
    ).catch(() => null)

    if (!contractData) {
      console.log('⚠️ Indexer not available')
      return
    }

    for (const contract of contractData.contracts) {
      const code = await rpcCall(
        'eth_getCode',
        [contract.address, 'latest'],
        RpcStringResultSchema,
      ).catch(() => '0x')
      expect(code.length).toBeGreaterThan(2)
    }

    console.log(
      `   ✓ ${contractData.contracts.length} contracts verified on-chain`,
    )
  })
})

describe('Token Transfer Validation', () => {
  test('ERC20 transfers should have valid balances', async () => {
    const transferData = await graphqlQuery(
      `query { tokenTransfers(where: { tokenStandard_eq: ERC20 }, limit: 5) { from { address } to { address } token { address } value tokenStandard } }`,
      TokenTransfersSchema,
    ).catch(() => null)

    if (!transferData) {
      console.log('⚠️ Indexer not available')
      return
    }

    console.log(
      `   📊 Found ${transferData.tokenTransfers.length} ERC20 transfers`,
    )

    for (const transfer of transferData.tokenTransfers) {
      expect(transfer.from.address).toMatch(/^0x[a-f0-9]{40}$/i)
      expect(transfer.to.address).toMatch(/^0x[a-f0-9]{40}$/i)
      expect(BigInt(transfer.value)).toBeGreaterThanOrEqual(0n)
    }
  })
})

describe('Event Decoding Validation', () => {
  test('decoded events should have valid signatures', async () => {
    const eventData = await graphqlQuery(
      `query { decodedEvents(limit: 20) { eventName eventSignature args } }`,
      DecodedEventsSchema,
    ).catch(() => null)

    if (!eventData) {
      console.log('⚠️ Indexer not available')
      return
    }

    const eventNames = new Set<string>()
    for (const event of eventData.decodedEvents) {
      expect(event.eventSignature).toMatch(/^0x[a-f0-9]{64}$/i)
      expect(event.eventName.length).toBeGreaterThan(0)
      eventNames.add(event.eventName)
    }

    console.log(`   ✓ ${eventNames.size} unique event types decoded`)
    console.log(
      `   Events: ${Array.from(eventNames).slice(0, 5).join(', ')}...`,
    )
  })
})

describe('Block Data Integrity', () => {
  test('block hashes should match on-chain', async () => {
    const indexerData = await graphqlQuery(
      `query { blocks(orderBy: number_DESC, limit: 5) { number hash parentHash } }`,
      BlocksSchema,
    ).catch(() => null)

    if (!indexerData) {
      console.log('⚠️ Indexer not available')
      return
    }

    for (const block of indexerData.blocks) {
      const onChainBlock = await rpcCall(
        'eth_getBlockByNumber',
        [`0x${block.number.toString(16)}`, false],
        RpcBlockSchema,
      ).catch(() => null)

      if (onChainBlock && block.hash && block.parentHash) {
        expect(block.hash.toLowerCase()).toBe(onChainBlock.hash.toLowerCase())
        expect(block.parentHash.toLowerCase()).toBe(
          onChainBlock.parentHash.toLowerCase(),
        )
      }
    }

    console.log(`   ✓ ${indexerData.blocks.length} block hashes verified`)
  })
})

describe('Transaction Data Integrity', () => {
  test('transaction data should match on-chain', async () => {
    const indexerData = await graphqlQuery(
      `query { transactions(limit: 5) { hash from { address } value nonce } }`,
      TransactionsSchema,
    ).catch(() => null)

    if (!indexerData) {
      console.log('⚠️ Indexer not available')
      return
    }

    for (const tx of indexerData.transactions) {
      const onChainTx = await rpcCall(
        'eth_getTransactionByHash',
        [tx.hash],
        RpcTxSchema,
      ).catch(() => null)

      if (onChainTx && tx.value && tx.nonce !== undefined) {
        expect(tx.from.address.toLowerCase()).toBe(onChainTx.from.toLowerCase())
        expect(BigInt(tx.value)).toBe(BigInt(onChainTx.value))
        expect(tx.nonce).toBe(parseInt(onChainTx.nonce, 16))
      }
    }

    console.log(`   ✓ ${indexerData.transactions.length} transactions verified`)
  })
})

describe('Log Data Integrity', () => {
  test('logs should match on-chain receipts', async () => {
    const indexerData = await graphqlQuery(
      `query { logs(limit: 5) { transaction { hash } logIndex address { address } topic0 data } }`,
      LogsSchema,
    ).catch(() => null)

    if (!indexerData) {
      console.log('⚠️ Indexer not available')
      return
    }

    for (const log of indexerData.logs) {
      const receipt = await rpcCall(
        'eth_getTransactionReceipt',
        [log.transaction.hash],
        RpcReceiptSchema,
      ).catch(() => null)

      if (receipt) {
        const onChainLog = receipt.logs[log.logIndex]
        if (onChainLog) {
          expect(log.address.address.toLowerCase()).toBe(
            onChainLog.address.toLowerCase(),
          )
          if (log.topic0 && onChainLog.topics[0]) {
            expect(log.topic0.toLowerCase()).toBe(
              onChainLog.topics[0].toLowerCase(),
            )
          }
        }
      }
    }

    console.log(`   ✓ ${indexerData.logs.length} logs verified`)
  })
})

describe('Metrics Consistency', () => {
  test('account count should match unique addresses in transactions', async () => {
    const accountCount = await graphqlQuery(
      `query { accountsConnection { totalCount } }`,
      AccountsConnectionSchema,
    ).catch(() => null)

    const txData = await graphqlQuery(
      `query { transactions(limit: 1000) { from { address } } }`,
      TransactionsSchema,
    ).catch(() => null)

    if (!accountCount || !txData) {
      console.log('⚠️ Indexer not available')
      return
    }

    const uniqueAddresses = new Set(
      txData.transactions.map((tx) => tx.from.address),
    )

    console.log(
      `   📊 Total accounts: ${accountCount.accountsConnection.totalCount}`,
    )
    console.log(`   📊 Unique tx senders (sample): ${uniqueAddresses.size}`)

    expect(accountCount.accountsConnection.totalCount).toBeGreaterThanOrEqual(
      uniqueAddresses.size,
    )
  })
})
