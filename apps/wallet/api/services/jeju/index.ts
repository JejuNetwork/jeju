import { expectValid } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import {
  GraphQLResponseSchema,
  IndexerBlocksResponseSchema,
  IndexerHealthResponseSchema,
} from '../../../lib/api-responses'
import { API_URLS, fetchApi, jsonRpcRequest } from '../../../lib/eden'

const INDEXER_URL = API_URLS.indexer
const GRAPHQL_URL = API_URLS.graphql
const BUNDLER_URL = API_URLS.bundler

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

async function api<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  context: string,
): Promise<T> {
  const data = await fetchApi<T>(INDEXER_URL, endpoint)
  return expectValid(schema, data, context)
}

const GraphQLTransactionResponseSchema = z.object({
  hash: z.string(),
  chainId: z.number().optional(),
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
  chainId: z.number(),
  owner: z.string().optional(),
  tokenUri: z.string().nullable(),
  collectionName: z.string().optional(),
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
  chainId: z.number().optional(),
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

export interface IndexedTransaction {
  hash: string
  chainId: number
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
        chainId
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
    chainId: tx.chainId ?? 420691, // Default to Jeju mainnet
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

export interface IndexedNFT {
  contractAddress: string
  tokenId: string
  chainId: number
  owner: string
  tokenUri: string | null
  collectionName?: string
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
        contract { address chainId name }
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
    chainId: nft.chainId,
    owner: nft.owner ?? '',
    tokenUri: nft.tokenUri,
    collectionName: nft.collectionName,
    metadata: nft.metadata,
  }))
}

const SingleNFTDataSchema = z.object({
  nftToken: z
    .object({
      contractAddress: z.string().optional(),
      tokenId: z.string(),
      chainId: z.number(),
      owner: z.string().optional(),
      tokenUri: z.string().nullable(),
      collectionName: z.string().optional(),
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
    .nullable(),
})

export async function getNFT(
  contractAddress: Address,
  tokenId: string,
): Promise<IndexedNFT | null> {
  const data = await graphql(
    `
    query GetNFT($contractAddress: String!, $tokenId: String!) {
      nftToken(where: { contract_address_eq: $contractAddress, tokenId_eq: $tokenId }) {
        contract { address chainId name }
        tokenId
        owner { address }
        tokenUri
        metadata
      }
    }
  `,
    SingleNFTDataSchema,
    'getNFT',
    { contractAddress: contractAddress.toLowerCase(), tokenId },
  )

  if (!data.nftToken) return null

  return {
    contractAddress: data.nftToken.contractAddress ?? '',
    tokenId: data.nftToken.tokenId,
    chainId: data.nftToken.chainId,
    owner: data.nftToken.owner ?? '',
    tokenUri: data.nftToken.tokenUri,
    collectionName: data.nftToken.collectionName,
    metadata: data.nftToken.metadata,
  }
}

export interface IndexedApproval {
  token: string
  tokenSymbol: string
  spender: string
  value: string
  txHash: string
  timestamp: string
  chainId: number
}

export async function getApprovals(
  address: Address,
): Promise<IndexedApproval[]> {
  const data = await graphql(
    `
    query GetApprovals($address: String!) {
      tokenApprovalEvents(
        where: { owner: { address_eq: $address } }
        orderBy: timestamp_DESC
      ) {
        token { address symbol }
        spender { address }
        value
        transaction { hash }
        timestamp
        chainId
      }
    }
  `,
    ApprovalsDataSchema,
    'getApprovals',
    { address: address.toLowerCase() },
  )

  return data.approvalEvents.map((a) => ({
    ...a,
    chainId: a.chainId ?? 420691, // Default to Jeju mainnet
  }))
}

export interface IndexedNFTApproval {
  contractAddress: string
  contractName: string
  operator: string
  tokenId: string | null
  isApprovalForAll: boolean
  approved: boolean
  txHash: string
  timestamp: string
  chainId: number
}

const NFTApprovalsDataSchema = z.object({
  nftApprovalEvents: z.array(
    z.object({
      token: z.object({
        address: z.string(),
        name: z.string().optional(),
      }),
      operator: z.object({ address: z.string() }),
      tokenId: z.string().nullable(),
      isApprovalForAll: z.boolean(),
      approved: z.boolean(),
      transaction: z.object({ hash: z.string() }),
      timestamp: z.string(),
      chainId: z.number(),
    }),
  ),
})

export async function getNFTApprovals(
  address: Address,
): Promise<IndexedNFTApproval[]> {
  const data = await graphql(
    `
    query GetNFTApprovals($address: String!) {
      nftApprovalEvents(
        where: { owner: { address_eq: $address }, approved_eq: true }
        orderBy: timestamp_DESC
      ) {
        token { address }
        operator { address }
        tokenId
        isApprovalForAll
        approved
        transaction { hash }
        timestamp
        chainId
      }
    }
  `,
    NFTApprovalsDataSchema,
    'getNFTApprovals',
    { address: address.toLowerCase() },
  )

  return data.nftApprovalEvents.map((a) => ({
    contractAddress: a.token.address,
    contractName: a.token.name ?? 'Unknown Collection',
    operator: a.operator.address,
    tokenId: a.tokenId,
    isApprovalForAll: a.isApprovalForAll,
    approved: a.approved,
    txHash: a.transaction.hash,
    timestamp: a.timestamp,
    chainId: a.chainId,
  }))
}

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

  if (!data.oracleFeeds[0].latestPrice) {
    throw new Error('No gas price oracle feed available')
  }

  const baseGas = BigInt(data.oracleFeeds[0].latestPrice)
  return {
    slow: (baseGas * 80n) / 100n,
    standard: baseGas,
    fast: (baseGas * 120n) / 100n,
  }
}

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

export async function sendUserOperation(
  chainId: number,
  userOp: Record<string, string>,
  entryPoint: Address,
): Promise<Hex> {
  const result = await jsonRpcRequest<Hex>(
    `${BUNDLER_URL}/${chainId}`,
    'eth_sendUserOperation',
    [userOp, entryPoint],
  )
  return result
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
  const result = await jsonRpcRequest<{
    callGasLimit: string
    verificationGasLimit: string
    preVerificationGas: string
  }>(`${BUNDLER_URL}/${chainId}`, 'eth_estimateUserOperationGas', [
    userOp,
    entryPoint,
  ])

  return {
    callGasLimit: BigInt(result.callGasLimit),
    verificationGasLimit: BigInt(result.verificationGasLimit),
    preVerificationGas: BigInt(result.preVerificationGas),
  }
}

export async function getUserOperationReceipt(
  chainId: number,
  userOpHash: Hex,
): Promise<{ success: boolean; txHash: Hex } | null> {
  try {
    const result = await jsonRpcRequest<{
      success: boolean
      receipt: { transactionHash: Hex }
    } | null>(`${BUNDLER_URL}/${chainId}`, 'eth_getUserOperationReceipt', [
      userOpHash,
    ])

    if (!result) return null

    return {
      success: result.success,
      txHash: result.receipt.transactionHash,
    }
  } catch {
    return null
  }
}

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
    latestBlock: blocks.blocks[0].number ?? 0,
  }
}
