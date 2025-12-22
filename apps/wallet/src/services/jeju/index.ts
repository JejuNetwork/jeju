/**
 * Network Infrastructure Integration
 * Single source of truth for all network services
 */

import { expectValid } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import {
  BundlerEstimateGasResponseSchema,
  BundlerReceiptResponseSchema,
  BundlerSendUserOpResponseSchema,
  GraphQLResponseSchema,
  IndexerBlocksResponseSchema,
  IndexerHealthResponseSchema,
} from '../../schemas/api-responses'

// Network infrastructure URLs
const INDEXER_URL =
  import.meta.env.VITE_JEJU_INDEXER_URL || 'http://localhost:4352'
const GRAPHQL_URL =
  import.meta.env.VITE_JEJU_GRAPHQL_URL || 'http://localhost:4350/graphql'
const BUNDLER_URL =
  import.meta.env.VITE_JEJU_BUNDLER_URL || 'http://localhost:4337'

// GraphQL query helper with schema validation
async function graphql<T extends z.ZodTypeAny>(
  query: string,
  dataSchema: T,
  context: string,
  variables?: Record<string, unknown>,
): Promise<z.infer<T>> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const validated = expectValid(
    GraphQLResponseSchema(dataSchema),
    await response.json(),
    context,
  )
  if (validated.errors?.length) throw new Error(validated.errors[0].message)
  if (!validated.data)
    throw new Error(`No data in GraphQL response for ${context}`)
  return validated.data
}

// REST API helper with schema validation
async function api<T>(
  endpoint: string,
  schema: z.ZodSchema<T>,
  context: string,
): Promise<T> {
  const response = await fetch(`${INDEXER_URL}${endpoint}`)
  if (!response.ok) throw new Error(`API error: ${response.status}`)
  return expectValid(schema, await response.json(), context)
}

// ============================================================================
// GraphQL Response Schemas
// ============================================================================

const GraphQLTransactionResponseSchema = z.object({
  hash: z.string(),
  from: z.object({ address: z.string() }),
  to: z.object({ address: z.string() }).nullable(),
  value: z.string(),
  blockNumber: z.number(),
  timestamp: z.string().optional(),
  status: z.enum(['SUCCESS', 'FAILURE', 'PENDING']),
  gasUsed: z.string().nullable(),
  input: z.string().nullable(),
})

const TransactionsDataSchema = z.object({
  transactions: z.array(GraphQLTransactionResponseSchema),
})

const TokenTransferSchema = z.object({
  token: z.string(),
  tokenSymbol: z.string(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  txHash: z.string().default(''),
  timestamp: z.string(),
})

const TokenTransfersDataSchema = z.object({
  tokenTransfers: z.array(TokenTransferSchema),
})

const TokenBalanceItemSchema = z.object({
  token: z.string(),
  symbol: z.string(),
  decimals: z.number(),
  balance: z.string(),
})

const TokenBalancesDataSchema = z.object({
  tokenBalances: z.array(TokenBalanceItemSchema),
})

const NFTTokenSchema = z.object({
  contractAddress: z.string().optional(),
  tokenId: z.string(),
  owner: z.string().optional(),
  tokenUri: z.string().nullable(),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      image: z.string().optional(),
      attributes: z
        .array(z.object({ trait_type: z.string(), value: z.string() }))
        .optional(),
    })
    .nullable(),
})

const NFTsDataSchema = z.object({
  nftTokens: z.array(NFTTokenSchema),
})

const ApprovalEventSchema = z.object({
  token: z.string(),
  tokenSymbol: z.string(),
  spender: z.string(),
  value: z.string(),
  txHash: z.string().default(''),
  timestamp: z.string(),
})

const ApprovalsDataSchema = z.object({
  approvalEvents: z.array(ApprovalEventSchema),
})

const OracleFeedSchema = z.object({
  symbol: z.string(),
  latestPrice: z.string(),
  decimals: z.number(),
  latestTimestamp: z.string(),
  latestConfidence: z.string(),
})

const OracleFeedsDataSchema = z.object({
  oracleFeeds: z.array(OracleFeedSchema),
})

const GasPriceOracleSchema = z.object({
  oracleFeeds: z.array(z.object({ latestPrice: z.string() })),
})

const IntentSchema = z.object({
  id: z.string(),
  user: z.string(),
  inputToken: z.string(),
  inputAmount: z.string(),
  outputToken: z.string(),
  minOutputAmount: z.string(),
  sourceChainId: z.number(),
  destinationChainId: z.number(),
  status: z.enum(['PENDING', 'FILLED', 'SETTLED', 'EXPIRED', 'CANCELLED']),
  solver: z.string().optional(),
  filledAmount: z.string().optional(),
  createdAt: z.string(),
})

const IntentsDataSchema = z.object({
  oifIntents: z.array(IntentSchema),
})

const SolverSchema = z.object({
  address: z.string(),
  reputation: z.number(),
  supportedChains: z.array(z.number()),
  totalFills: z.number(),
})

const SolversDataSchema = z.object({
  oifSolvers: z.array(SolverSchema),
})

// ============================================================================
// Account & Transaction History
// ============================================================================

export interface IndexedTransaction {
  hash: string
  from: string
  to: string | null
  value: string
  blockNumber: number
  timestamp: string
  status: 'SUCCESS' | 'FAILURE' | 'PENDING'
  gasUsed: string | null
  input: string | null
}

export interface TokenTransfer {
  token: string
  tokenSymbol: string
  from: string
  to: string
  value: string
  txHash: string
  timestamp: string
}

export interface TokenBalance {
  token: string
  symbol: string
  decimals: number
  balance: string
}

export async function getAccountHistory(
  address: Address,
  limit = 50,
): Promise<IndexedTransaction[]> {
  const data = await graphql(
    `
    query GetHistory($address: String!, $limit: Int!) {
      transactions(
        where: { OR: [{ from: { address_eq: $address } }, { to: { address_eq: $address } }] }
        orderBy: blockNumber_DESC
        limit: $limit
      ) {
        hash
        from { address }
        to { address }
        value
        blockNumber
        status
        gasUsed
        input
      }
    }
  `,
    TransactionsDataSchema,
    'getAccountHistory',
    { address: address.toLowerCase(), limit },
  )

  return data.transactions.map((tx) => ({
    hash: tx.hash,
    from: tx.from.address,
    to: tx.to?.address ?? null,
    value: tx.value,
    blockNumber: tx.blockNumber,
    timestamp: tx.timestamp ?? '',
    status: tx.status,
    gasUsed: tx.gasUsed,
    input: tx.input,
  }))
}

export async function getTokenTransfers(
  address: Address,
  limit = 50,
): Promise<TokenTransfer[]> {
  const data = await graphql(
    `
    query GetTransfers($address: String!, $limit: Int!) {
      tokenTransfers(
        where: { OR: [{ from: { address_eq: $address } }, { to: { address_eq: $address } }] }
        orderBy: timestamp_DESC
        limit: $limit
      ) {
        token { address }
        tokenSymbol: token { symbol }
        from { address }
        to { address }
        value
        transaction { hash }
        timestamp
      }
    }
  `,
    TokenTransfersDataSchema,
    'getTokenTransfers',
    { address: address.toLowerCase(), limit },
  )

  return data.tokenTransfers
}

export async function getTokenBalances(
  address: Address,
): Promise<TokenBalance[]> {
  const data = await graphql(
    `
    query GetBalances($address: String!) {
      tokenBalances(where: { account: { address_eq: $address }, balance_gt: "0" }) {
        token { address symbol decimals }
        balance
      }
    }
  `,
    TokenBalancesDataSchema,
    'getTokenBalances',
    { address: address.toLowerCase() },
  )

  return data.tokenBalances
}

// ============================================================================
// NFTs
// ============================================================================

export interface IndexedNFT {
  contractAddress: string
  tokenId: string
  owner: string
  tokenUri: string | null
  metadata: {
    name?: string
    description?: string
    image?: string
    attributes?: Array<{ trait_type: string; value: string }>
  } | null
}

export async function getNFTs(address: Address): Promise<IndexedNFT[]> {
  const data = await graphql(
    `
    query GetNFTs($address: String!) {
      nftTokens(where: { owner: { address_eq: $address } }) {
        contract { address }
        tokenId
        owner { address }
        tokenUri
        metadata
      }
    }
  `,
    NFTsDataSchema,
    'getNFTs',
    { address: address.toLowerCase() },
  )

  return data.nftTokens.map((nft) => ({
    contractAddress: nft.contractAddress ?? '',
    tokenId: nft.tokenId,
    owner: nft.owner ?? '',
    tokenUri: nft.tokenUri,
    metadata: nft.metadata,
  }))
}

// ============================================================================
// Token Approvals
// ============================================================================

export interface IndexedApproval {
  token: string
  tokenSymbol: string
  spender: string
  value: string
  txHash: string
  timestamp: string
}

export async function getApprovals(
  address: Address,
): Promise<IndexedApproval[]> {
  // Query approval events from indexer
  const data = await graphql(
    `
    query GetApprovals($address: String!) {
      approvalEvents(
        where: { owner: { address_eq: $address } }
        orderBy: timestamp_DESC
      ) {
        token { address symbol }
        spender { address }
        value
        transaction { hash }
        timestamp
      }
    }
  `,
    ApprovalsDataSchema,
    'getApprovals',
    { address: address.toLowerCase() },
  )

  return data.approvalEvents
}

// ============================================================================
// Oracle Prices
// ============================================================================

export interface OraclePrice {
  symbol: string
  price: string
  decimals: number
  timestamp: string
  confidence: string
}

export async function getOraclePrices(
  symbols: string[],
): Promise<Map<string, OraclePrice>> {
  const data = await graphql(
    `
    query GetPrices($symbols: [String!]!) {
      oracleFeeds(where: { symbol_in: $symbols, isActive_eq: true }) {
        symbol
        latestPrice
        decimals
        latestTimestamp
        latestConfidence
      }
    }
  `,
    OracleFeedsDataSchema,
    'getOraclePrices',
    { symbols },
  )

  const prices = new Map<string, OraclePrice>()
  for (const feed of data.oracleFeeds) {
    prices.set(feed.symbol, {
      symbol: feed.symbol,
      price: feed.latestPrice,
      decimals: feed.decimals,
      timestamp: feed.latestTimestamp,
      confidence: feed.latestConfidence,
    })
  }
  return prices
}

export async function getGasPrice(): Promise<{
  slow: bigint
  standard: bigint
  fast: bigint
}> {
  const data = await graphql(
    `
    query {
      oracleFeeds(where: { category_eq: L2_GAS, isActive_eq: true }, limit: 1) {
        latestPrice
      }
    }
  `,
    GasPriceOracleSchema,
    'getGasPrice',
  )

  if (!data.oracleFeeds[0]?.latestPrice) {
    throw new Error('No gas price oracle feed available')
  }

  const baseGas = BigInt(data.oracleFeeds[0].latestPrice)
  return {
    slow: (baseGas * 80n) / 100n,
    standard: baseGas,
    fast: (baseGas * 120n) / 100n,
  }
}

// ============================================================================
// OIF Intents
// ============================================================================

export interface Intent {
  id: string
  user: string
  inputToken: string
  inputAmount: string
  outputToken: string
  minOutputAmount: string
  sourceChainId: number
  destinationChainId: number
  status: 'PENDING' | 'FILLED' | 'SETTLED' | 'EXPIRED' | 'CANCELLED'
  solver?: string
  filledAmount?: string
  createdAt: string
}

export async function getIntents(address: Address): Promise<Intent[]> {
  const data = await graphql(
    `
    query GetIntents($address: String!) {
      oifIntents(where: { user: { address_eq: $address } }, orderBy: createdAt_DESC, limit: 50) {
        id
        intentId
        user { address }
        inputToken
        inputAmount
        outputToken
        minOutputAmount
        sourceChainId
        destinationChainId
        status
        solver { address }
        filledAmount
        createdAt
      }
    }
  `,
    IntentsDataSchema,
    'getIntents',
    { address: address.toLowerCase() },
  )

  return data.oifIntents
}

export async function getSolvers(): Promise<
  Array<{
    address: string
    reputation: number
    supportedChains: number[]
    totalFills: number
  }>
> {
  const data = await graphql(
    `
    query {
      oifSolvers(where: { isActive_eq: true }, orderBy: reputation_DESC, limit: 20) {
        address
        reputation
        supportedChains
        totalFills
      }
    }
  `,
    SolversDataSchema,
    'getSolvers',
  )

  return data.oifSolvers
}

// ============================================================================
// Bundler (ERC-4337)
// ============================================================================

export async function sendUserOperation(
  chainId: number,
  userOp: Record<string, string>,
  entryPoint: Address,
): Promise<Hex> {
  const response = await fetch(`${BUNDLER_URL}/${chainId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendUserOperation',
      params: [userOp, entryPoint],
    }),
  })

  const data = expectValid(
    BundlerSendUserOpResponseSchema,
    await response.json(),
    'sendUserOperation',
  )
  if (data.error) throw new Error(data.error.message)
  if (!data.result) throw new Error('No result in sendUserOperation response')
  return data.result
}

export async function estimateUserOperationGas(
  chainId: number,
  userOp: Record<string, string>,
  entryPoint: Address,
): Promise<{
  callGasLimit: bigint
  verificationGasLimit: bigint
  preVerificationGas: bigint
}> {
  const response = await fetch(`${BUNDLER_URL}/${chainId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_estimateUserOperationGas',
      params: [userOp, entryPoint],
    }),
  })

  const data = expectValid(
    BundlerEstimateGasResponseSchema,
    await response.json(),
    'estimateUserOperationGas',
  )
  if (data.error) throw new Error(data.error.message)

  return {
    callGasLimit: BigInt(data.result.callGasLimit),
    verificationGasLimit: BigInt(data.result.verificationGasLimit),
    preVerificationGas: BigInt(data.result.preVerificationGas),
  }
}

export async function getUserOperationReceipt(
  chainId: number,
  userOpHash: Hex,
): Promise<{ success: boolean; txHash: Hex } | null> {
  const response = await fetch(`${BUNDLER_URL}/${chainId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getUserOperationReceipt',
      params: [userOpHash],
    }),
  })

  const data = expectValid(
    BundlerReceiptResponseSchema,
    await response.json(),
    'getUserOperationReceipt',
  )
  if (!data.result) return null

  return {
    success: data.result.success,
    txHash: data.result.receipt.transactionHash,
  }
}

// ============================================================================
// Indexer Health
// ============================================================================

export async function getIndexerHealth(): Promise<{
  status: string
  latestBlock: number
}> {
  const health = await api(
    '/health',
    IndexerHealthResponseSchema,
    'indexer health',
  )
  const blocks = await api(
    '/api/blocks?limit=1',
    IndexerBlocksResponseSchema,
    'indexer blocks',
  )

  return {
    status: health.status,
    latestBlock: blocks.blocks[0]?.number ?? 0,
  }
}
