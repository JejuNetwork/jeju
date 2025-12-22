/**
 * GraphQL query builder utilities
 * Shared utilities for building GraphQL queries across A2A and MCP servers
 */

export interface GraphQLQuery {
  query: string
  variables?: Record<string, unknown>
}

export function buildBlockQuery(
  blockNumber?: number,
  blockHash?: string,
): GraphQLQuery {
  if (blockNumber !== undefined) {
    return {
      query: `query GetBlock($number: Int) {
        blocks(where: { number_eq: $number }, limit: 1) {
          number
          hash
          timestamp
          transactionCount
          gasUsed
          gasLimit
        }
      }`,
      variables: { number: blockNumber },
    }
  }
  if (blockHash) {
    return {
      query: `query GetBlock($hash: String) {
        blocks(where: { hash_eq: $hash }, limit: 1) {
          number
          hash
          timestamp
          transactionCount
          gasUsed
          gasLimit
        }
      }`,
      variables: { hash: blockHash },
    }
  }
  throw new Error('Either blockNumber or blockHash must be provided')
}

export function buildTransactionQuery(hash: string): GraphQLQuery {
  return {
    query: `query GetTx($hash: String!) {
      transactions(where: { hash_eq: $hash }, limit: 1) {
        hash
        from
        to
        value
        gasUsed
        status
        blockNumber
        timestamp
      }
    }`,
    variables: { hash },
  }
}

export function buildAccountQuery(address: string): GraphQLQuery {
  return {
    query: `query GetAccount($address: String!) {
      accounts(where: { id_eq: $address }, limit: 1) {
        id
        balance
        transactionCount
        contractCode
      }
    }`,
    variables: { address: address.toLowerCase() },
  }
}

export function buildTokenBalancesQuery(address: string): GraphQLQuery {
  return {
    query: `query GetTokenBalances($address: String!) {
      tokenBalances(where: { account_eq: $address, balance_gt: "0" }) {
        token { address symbol decimals name }
        balance
      }
    }`,
    variables: { address: address.toLowerCase() },
  }
}

export function buildAgentQuery(agentId: string | number): GraphQLQuery {
  const agentIdStr = typeof agentId === 'string' ? agentId : agentId.toString()
  return {
    query: `query GetAgent($agentId: BigInt!) {
      registeredAgents(where: { agentId_eq: $agentId }, limit: 1) {
        agentId
        owner
        name
        role
        a2aEndpoint
        mcpEndpoint
        isActive
        registeredAt
        metadata { key value }
      }
    }`,
    variables: { agentId: agentIdStr },
  }
}

export function buildAgentsQuery(params: {
  role?: string
  active?: boolean
  limit?: number
  offset?: number
}): GraphQLQuery {
  return {
    query: `query GetAgents($role: String, $active: Boolean, $limit: Int, $offset: Int) {
      registeredAgents(
        where: { role_eq: $role, isActive_eq: $active }
        limit: $limit
        offset: $offset
        orderBy: registeredAt_DESC
      ) {
        agentId
        owner
        name
        role
        isActive
      }
    }`,
    variables: {
      role: params.role,
      active: params.active,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    },
  }
}

export function buildLogsQuery(params: {
  address?: string
  topic0?: string
  fromBlock?: number
  toBlock?: number
  limit?: number
}): GraphQLQuery {
  return {
    query: `query GetLogs($address: String, $topic0: String, $fromBlock: Int, $toBlock: Int, $limit: Int) {
      logs(where: {
        address_eq: $address
        topic0_eq: $topic0
        block: { number_gte: $fromBlock, number_lte: $toBlock }
      }, limit: $limit, orderBy: block_number_DESC) {
        address
        topics
        data
        blockNumber
        transactionHash
      }
    }`,
    variables: {
      address: params.address,
      topic0: params.topic0,
      fromBlock: params.fromBlock,
      toBlock: params.toBlock,
      limit: params.limit ?? 100,
    },
  }
}

export function buildIntentQuery(intentId: string): GraphQLQuery {
  return {
    query: `query GetIntent($intentId: String!) {
      oifIntents(where: { intentId_eq: $intentId }, limit: 1) {
        intentId
        sender
        sourceChain
        destinationChain
        sourceToken
        destinationToken
        amount
        status
        solver
        createdAt
        settledAt
      }
    }`,
    variables: { intentId },
  }
}

export function buildSolverQuery(address: string): GraphQLQuery {
  return {
    query: `query GetSolver($address: String!) {
      oifSolvers(where: { address_eq: $address }, limit: 1) {
        address
        agentId
        stake
        isActive
        settledCount
        totalVolume
        reputation
      }
    }`,
    variables: { address: address.toLowerCase() },
  }
}

export function buildProposalQuery(proposalId: string): GraphQLQuery {
  return {
    query: `query GetProposal($proposalId: String!) {
      councilProposals(where: { proposalId_eq: $proposalId }, limit: 1) {
        proposalId
        title
        description
        proposer
        status
        votesFor
        votesAgainst
        createdAt
        executedAt
      }
    }`,
    variables: { proposalId },
  }
}

export function buildProposalsQuery(params: {
  status?: string
  limit?: number
}): GraphQLQuery {
  return {
    query: `query GetProposals($status: String, $limit: Int) {
      councilProposals(
        where: { status_eq: $status }
        limit: $limit
        orderBy: createdAt_DESC
      ) {
        proposalId
        title
        status
        votesFor
        votesAgainst
        createdAt
      }
    }`,
    variables: {
      status: params.status,
      limit: params.limit ?? 20,
    },
  }
}

export function buildNetworkStatsQuery(): GraphQLQuery {
  return {
    query: `query GetNetworkStats {
      networkSnapshots(limit: 1, orderBy: timestamp_DESC) {
        totalTransactions
        totalAccounts
        totalContracts
        totalTokens
        blockNumber
        timestamp
      }
    }`,
  }
}

export function buildTokenStatsQuery(): GraphQLQuery {
  return {
    query: `query GetTokenStats {
      tokenDistributions(limit: 10, orderBy: totalSupply_DESC) {
        token { address symbol name }
        holders
        totalSupply
        transfers24h
      }
    }`,
  }
}

export function buildAgentReputationQuery(
  agentId: string | number,
): GraphQLQuery {
  const agentIdStr = typeof agentId === 'string' ? agentId : agentId.toString()
  return {
    query: `query GetReputation($agentId: BigInt!) {
      agentFeedback(where: { agentId_eq: $agentId }) {
        score
        tag
        details
        feedbackBy
        timestamp
      }
      agentValidations(where: { agentId_eq: $agentId }) {
        validated
        validator
        timestamp
      }
    }`,
    variables: { agentId: agentIdStr },
  }
}
