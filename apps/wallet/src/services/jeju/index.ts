/**
 * Network Infrastructure Integration
 * Single source of truth for all network services
 */

import type { Address, Hex } from 'viem';

// Network infrastructure URLs
const INDEXER_URL = import.meta.env.VITE_JEJU_INDEXER_URL || 'http://localhost:4352';
const GRAPHQL_URL = import.meta.env.VITE_JEJU_GRAPHQL_URL || 'http://localhost:4350/graphql';
const BUNDLER_URL = import.meta.env.VITE_JEJU_BUNDLER_URL || 'http://localhost:4337';

// GraphQL query helper
async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(errors[0].message);
  return data;
}

// REST API helper
async function api<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${INDEXER_URL}${endpoint}`);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// ============================================================================
// Account & Transaction History
// ============================================================================

export interface IndexedTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  blockNumber: number;
  timestamp: string;
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';
  gasUsed: string | null;
  input: string | null;
}

export interface TokenTransfer {
  token: string;
  tokenSymbol: string;
  from: string;
  to: string;
  value: string;
  txHash: string;
  timestamp: string;
}

export interface TokenBalance {
  token: string;
  symbol: string;
  decimals: number;
  balance: string;
}

export async function getAccountHistory(address: Address, limit = 50): Promise<IndexedTransaction[]> {
  const data = await graphql<{ transactions: IndexedTransaction[] }>(`
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
  `, { address: address.toLowerCase(), limit });
  
  return data.transactions.map(tx => ({
    ...tx,
    from: (tx.from as unknown as { address: string }).address,
    to: (tx.to as unknown as { address: string } | null)?.address ?? null,
  }));
}

export async function getTokenTransfers(address: Address, limit = 50): Promise<TokenTransfer[]> {
  const data = await graphql<{ tokenTransfers: TokenTransfer[] }>(`
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
  `, { address: address.toLowerCase(), limit });
  
  return data.tokenTransfers;
}

export async function getTokenBalances(address: Address): Promise<TokenBalance[]> {
  const data = await graphql<{ tokenBalances: TokenBalance[] }>(`
    query GetBalances($address: String!) {
      tokenBalances(where: { account: { address_eq: $address }, balance_gt: "0" }) {
        token { address symbol decimals }
        balance
      }
    }
  `, { address: address.toLowerCase() });
  
  return data.tokenBalances;
}

// ============================================================================
// NFTs
// ============================================================================

export interface IndexedNFT {
  contractAddress: string;
  tokenId: string;
  owner: string;
  tokenUri: string | null;
  metadata: {
    name?: string;
    description?: string;
    image?: string;
    attributes?: Array<{ trait_type: string; value: string }>;
  } | null;
}

export async function getNFTs(address: Address): Promise<IndexedNFT[]> {
  const data = await graphql<{ nftTokens: IndexedNFT[] }>(`
    query GetNFTs($address: String!) {
      nftTokens(where: { owner: { address_eq: $address } }) {
        contract { address }
        tokenId
        owner { address }
        tokenUri
        metadata
      }
    }
  `, { address: address.toLowerCase() });
  
  return data.nftTokens;
}

// ============================================================================
// Token Approvals
// ============================================================================

export interface IndexedApproval {
  token: string;
  tokenSymbol: string;
  spender: string;
  value: string;
  txHash: string;
  timestamp: string;
}

export async function getApprovals(address: Address): Promise<IndexedApproval[]> {
  // Query approval events from indexer
  const data = await graphql<{ approvalEvents: IndexedApproval[] }>(`
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
  `, { address: address.toLowerCase() });
  
  return data.approvalEvents;
}

// ============================================================================
// Oracle Prices
// ============================================================================

export interface OraclePrice {
  symbol: string;
  price: string;
  decimals: number;
  timestamp: string;
  confidence: string;
}

interface OracleFeedResult {
  symbol: string;
  latestPrice: string;
  decimals: number;
  latestTimestamp: string;
  latestConfidence: string;
}

export async function getOraclePrices(symbols: string[]): Promise<Map<string, OraclePrice>> {
  const data = await graphql<{ oracleFeeds: OracleFeedResult[] }>(`
    query GetPrices($symbols: [String!]!) {
      oracleFeeds(where: { symbol_in: $symbols, isActive_eq: true }) {
        symbol
        latestPrice
        decimals
        latestTimestamp
        latestConfidence
      }
    }
  `, { symbols });
  
  const prices = new Map<string, OraclePrice>();
  for (const feed of data.oracleFeeds) {
    prices.set(feed.symbol, {
      symbol: feed.symbol,
      price: feed.latestPrice,
      decimals: feed.decimals,
      timestamp: feed.latestTimestamp,
      confidence: feed.latestConfidence,
    });
  }
  return prices;
}

export async function getGasPrice(): Promise<{ slow: bigint; standard: bigint; fast: bigint }> {
  try {
    const data = await graphql<{ oracleFeeds: Array<{ latestPrice: string }> }>(`
      query {
        oracleFeeds(where: { category_eq: L2_GAS, isActive_eq: true }, limit: 1) {
          latestPrice
        }
      }
    `);
    
    const baseGas = BigInt(data.oracleFeeds[0]?.latestPrice || '1000000000');
    return {
      slow: baseGas * 80n / 100n,
      standard: baseGas,
      fast: baseGas * 120n / 100n,
    };
  } catch {
    return { slow: 1000000000n, standard: 1500000000n, fast: 2000000000n };
  }
}

// ============================================================================
// OIF Intents
// ============================================================================

export interface Intent {
  id: string;
  user: string;
  inputToken: string;
  inputAmount: string;
  outputToken: string;
  minOutputAmount: string;
  sourceChainId: number;
  destinationChainId: number;
  status: 'PENDING' | 'FILLED' | 'SETTLED' | 'EXPIRED' | 'CANCELLED';
  solver?: string;
  filledAmount?: string;
  createdAt: string;
}

export async function getIntents(address: Address): Promise<Intent[]> {
  const data = await graphql<{ oifIntents: Intent[] }>(`
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
  `, { address: address.toLowerCase() });
  
  return data.oifIntents;
}

export async function getSolvers(): Promise<Array<{
  address: string;
  reputation: number;
  supportedChains: number[];
  totalFills: number;
}>> {
  const data = await graphql<{ oifSolvers: Array<{
    address: string;
    reputation: number;
    supportedChains: number[];
    totalFills: number;
  }> }>(`
    query {
      oifSolvers(where: { isActive_eq: true }, orderBy: reputation_DESC, limit: 20) {
        address
        reputation
        supportedChains
        totalFills
      }
    }
  `);
  
  return data.oifSolvers;
}

// ============================================================================
// Bundler (ERC-4337)
// ============================================================================

export async function sendUserOperation(
  chainId: number,
  userOp: Record<string, string>,
  entryPoint: Address
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
  });
  
  const { result, error } = await response.json();
  if (error) throw new Error(error.message);
  return result as Hex;
}

export async function estimateUserOperationGas(
  chainId: number,
  userOp: Record<string, string>,
  entryPoint: Address
): Promise<{
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
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
  });
  
  const { result, error } = await response.json();
  if (error) throw new Error(error.message);
  
  return {
    callGasLimit: BigInt(result.callGasLimit),
    verificationGasLimit: BigInt(result.verificationGasLimit),
    preVerificationGas: BigInt(result.preVerificationGas),
  };
}

export async function getUserOperationReceipt(
  chainId: number,
  userOpHash: Hex
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
  });
  
  const { result } = await response.json();
  if (!result) return null;
  
  return {
    success: result.success,
    txHash: result.receipt.transactionHash,
  };
}

// ============================================================================
// Indexer Health
// ============================================================================

export async function getIndexerHealth(): Promise<{ status: string; latestBlock: number }> {
  const health = await api<{ status: string }>('/health');
  const blocks = await api<{ blocks: Array<{ number: number }> }>('/api/blocks?limit=1');
  
  return {
    status: health.status,
    latestBlock: blocks.blocks[0]?.number ?? 0,
  };
}

