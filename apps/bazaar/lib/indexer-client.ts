import { INDEXER_URL as CONFIG_INDEXER_URL } from '../config';

const INDEXER_URL = CONFIG_INDEXER_URL;

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

async function graphqlQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
    next: { revalidate: 4 }, // Revalidate every 4 seconds for fresh data
  })

  const json = (await response.json()) as GraphQLResponse<T>

  if (json.errors) {
    throw new Error(`GraphQL Error: ${json.errors[0].message}`)
  }

  if (!json.data) {
    throw new Error('No data returned from GraphQL query')
  }

  return json.data
}

export async function getJejuTokens(filter?: {
  limit?: number
  offset?: number
  verified?: boolean
}) {
  const query = `
    query GetTokens($limit: Int, $offset: Int, $isERC20: Boolean) {
      contracts(
        where: { isERC20_eq: $isERC20 }
        limit: $limit
        offset: $offset
        orderBy: firstSeenAt_DESC
      ) {
        id
        address
        contractType
        isERC20
        firstSeenAt
        lastSeenAt
        creator {
          address
        }
      }
    }
  `

  interface QueryResult {
    contracts: Array<{
      id: string
      address: string
      contractType: string
      isERC20: boolean
      firstSeenAt: string
      lastSeenAt: string
      creator: {
        address: string
      }
      decodedEvents: Array<{
        eventName: string
        args: Record<string, unknown>
        timestamp: string
      }>
    }>
  }

  const result = await graphqlQuery<QueryResult>(query, {
    limit: filter?.limit || 50,
    offset: filter?.offset || 0,
    isERC20: true,
  })

  return result.contracts
}

export async function getTokenTransfers(tokenAddress: string, limit = 50) {
  const query = `
    query GetTokenTransfers($tokenAddress: String!, $limit: Int!) {
      tokenTransfers(
        where: { token: { address_eq: $tokenAddress } }
        limit: $limit
        orderBy: timestamp_DESC
      ) {
        id
        tokenStandard
        from {
          address
        }
        to {
          address
        }
        value
        timestamp
        transaction {
          hash
        }
        block {
          number
        }
      }
    }
  `

  interface QueryResult {
    tokenTransfers: Array<{
      id: string
      tokenStandard: string
      from: { address: string }
      to: { address: string }
      value: string
      timestamp: string
      transaction: { hash: string }
      block: { number: number }
    }>
  }

  const result = await graphqlQuery<QueryResult>(query, {
    tokenAddress: tokenAddress.toLowerCase(),
    limit,
  })

  return result.tokenTransfers
}

export async function getTokenHolders(tokenAddress: string, limit = 100) {
  const query = `
    query GetTokenHolders($tokenAddress: String!, $limit: Int!) {
      tokenBalances(
        where: { token: { address_eq: $tokenAddress }, balance_gt: "0" }
        limit: $limit
        orderBy: balance_DESC
      ) {
        id
        balance
        account {
          address
          firstSeenBlock
        }
        lastUpdated
        transferCount
      }
    }
  `

  interface QueryResult {
    tokenBalances: Array<{
      id: string
      balance: string
      account: {
        address: string
        firstSeenBlock: number
      }
      lastUpdated: string
      transferCount: number
    }>
  }

  const result = await graphqlQuery<QueryResult>(query, {
    tokenAddress: tokenAddress.toLowerCase(),
    limit,
  })

  return result.tokenBalances
}

export async function getLatestBlocks(limit = 10) {
  const query = `
    query GetBlocks($limit: Int!) {
      blocks(limit: $limit, orderBy: number_DESC) {
        number
        hash
        timestamp
        transactionCount
        gasUsed
      }
    }
  `

  interface QueryResult {
    blocks: Array<{
      number: number
      hash: string
      timestamp: string
      transactionCount: number
      gasUsed: string
    }>
  }

  const result = await graphqlQuery<QueryResult>(query, { limit })
  return result.blocks
}

export async function getContractDetails(address: string) {
  const query = `
    query GetContract($address: String!) {
      contracts(where: { address_eq: $address }, limit: 1) {
        id
        address
        contractType
        isERC20
        isERC721
        isERC1155
        creator {
          address
        }
        creationTransaction {
          hash
        }
        creationBlock {
          number
          timestamp
        }
        firstSeenAt
        lastSeenAt
      }
    }
  `

  interface QueryResult {
    contracts: Array<{
      id: string
      address: string
      contractType: string
      isERC20: boolean
      isERC721: boolean
      isERC1155: boolean
      creator: {
        address: string
      }
      creationTransaction: {
        hash: string
      }
      creationBlock: {
        number: number
        timestamp: string
      }
      firstSeenAt: string
      lastSeenAt: string
    }>
  }

  const result = await graphqlQuery<QueryResult>(query, {
    address: address.toLowerCase(),
  })

  return result.contracts[0]
}



