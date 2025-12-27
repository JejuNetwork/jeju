/**
 * Node Staking API Routes
 *
 * Provides API endpoints for querying node staking data from the
 * NodeStakingManager contract. Used by the node operator dashboard.
 */

import { getContract, getCurrentNetwork, getRpcUrl } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import {
  type Address,
  createPublicClient,
  formatEther,
  type Hex,
  http,
} from 'viem'

// NodeStakingManager ABI (read-only functions)
const NODE_STAKING_MANAGER_ABI = [
  {
    name: 'getNodeInfo',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        name: 'node',
        type: 'tuple',
        components: [
          { name: 'nodeId', type: 'bytes32' },
          { name: 'operator', type: 'address' },
          { name: 'stakedToken', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'stakedValueUSD', type: 'uint256' },
          { name: 'rewardToken', type: 'address' },
          { name: 'rpcUrl', type: 'string' },
          { name: 'geographicRegion', type: 'uint8' },
          { name: 'registrationTime', type: 'uint256' },
          { name: 'lastClaimTime', type: 'uint256' },
          { name: 'totalRewardsClaimed', type: 'uint256' },
          { name: 'operatorAgentId', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
      {
        name: 'perf',
        type: 'tuple',
        components: [
          { name: 'uptimeScore', type: 'uint256' },
          { name: 'requestsServed', type: 'uint256' },
          { name: 'avgResponseTime', type: 'uint256' },
          { name: 'lastUpdateTime', type: 'uint256' },
        ],
      },
      { name: 'pendingRewardsUSD', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getOperatorNodes',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getOperatorStats',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'totalNodesActive', type: 'uint256' },
          { name: 'totalStakedUSD', type: 'uint256' },
          { name: 'lifetimeRewardsUSD', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getNetworkStats',
    type: 'function',
    inputs: [],
    outputs: [
      { name: 'totalNodesActive', type: 'uint256' },
      { name: '_totalStakedUSD', type: 'uint256' },
      { name: '_totalRewardsClaimedUSD', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getTokenDistribution',
    type: 'function',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'totalStaked', type: 'uint256' },
          { name: 'totalStakedUSD', type: 'uint256' },
          { name: 'nodeCount', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'calculatePendingRewards',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getAllNodes',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    name: 'nodes',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'operator', type: 'address' },
      { name: 'stakedToken', type: 'address' },
      { name: 'stakedAmount', type: 'uint256' },
      { name: 'stakedValueUSD', type: 'uint256' },
      { name: 'rewardToken', type: 'address' },
      { name: 'rpcUrl', type: 'string' },
      { name: 'geographicRegion', type: 'uint8' },
      { name: 'registrationTime', type: 'uint256' },
      { name: 'lastClaimTime', type: 'uint256' },
      { name: 'totalRewardsClaimed', type: 'uint256' },
      { name: 'operatorAgentId', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
      { name: 'isSlashed', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'performance',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      { name: 'uptimeScore', type: 'uint256' },
      { name: 'requestsServed', type: 'uint256' },
      { name: 'avgResponseTime', type: 'uint256' },
      { name: 'lastUpdateTime', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'minStakeUSD',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'baseRewardPerMonthUSD',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'nodesByRegion',
    type: 'function',
    inputs: [{ name: 'region', type: 'uint8' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// Region enum matching the contract
const REGIONS = [
  'NorthAmerica',
  'SouthAmerica',
  'Europe',
  'Asia',
  'Africa',
  'Oceania',
  'Global',
] as const

type Region = (typeof REGIONS)[number]

interface NodeInfo {
  nodeId: Hex
  operator: Address
  stakedToken: Address
  stakedAmount: string
  stakedValueUSD: string
  rewardToken: Address
  rpcUrl: string
  region: Region
  registrationTime: number
  lastClaimTime: number
  totalRewardsClaimed: string
  operatorAgentId: number
  isActive: boolean
  isSlashed: boolean
  performance: {
    uptimeScore: number
    requestsServed: number
    avgResponseTime: number
    lastUpdateTime: number
  }
  pendingRewards: string
}

interface OperatorStats {
  totalNodesActive: number
  totalStakedUSD: string
  lifetimeRewardsUSD: string
  nodes: NodeInfo[]
}

interface NetworkStats {
  totalNodesActive: number
  totalStakedUSD: string
  totalRewardsClaimedUSD: string
  regionDistribution: Record<Region, number>
  minStakeUSD: string
  baseRewardPerMonthUSD: string
}

function getClient() {
  const network = getCurrentNetwork()
  const rpcUrl = getRpcUrl(network)
  return createPublicClient({ transport: http(rpcUrl) })
}

function getStakingManagerAddress(): Address | null {
  const network = getCurrentNetwork()
  const address = getContract('staking', 'nodeStakingManager', network)
  return address as Address | null
}

export function createStakingRouter() {
  return (
    new Elysia({ prefix: '/staking' })
      .get('/health', () => {
        const stakingManager = getStakingManagerAddress()
        return {
          status: 'healthy',
          service: 'dws-staking',
          stakingManagerConfigured: !!stakingManager,
          stakingManagerAddress: stakingManager,
        }
      })

      // Get network-wide staking statistics
      .get('/network', async ({ set }) => {
        const stakingManager = getStakingManagerAddress()
        if (!stakingManager) {
          set.status = 503
          return { error: 'Staking manager not configured' }
        }

        const client = getClient()

        const [networkStats, minStake, baseReward] = await Promise.all([
          client.readContract({
            address: stakingManager,
            abi: NODE_STAKING_MANAGER_ABI,
            functionName: 'getNetworkStats',
          }),
          client.readContract({
            address: stakingManager,
            abi: NODE_STAKING_MANAGER_ABI,
            functionName: 'minStakeUSD',
          }),
          client.readContract({
            address: stakingManager,
            abi: NODE_STAKING_MANAGER_ABI,
            functionName: 'baseRewardPerMonthUSD',
          }),
        ])

        // Get region distribution
        const regionCounts = await Promise.all(
          REGIONS.map(async (_, index) => {
            const count = await client.readContract({
              address: stakingManager,
              abi: NODE_STAKING_MANAGER_ABI,
              functionName: 'nodesByRegion',
              args: [index],
            })
            return count
          }),
        )

        const regionDistribution: Record<Region, number> = {
          NorthAmerica: 0,
          SouthAmerica: 0,
          Europe: 0,
          Asia: 0,
          Africa: 0,
          Oceania: 0,
          Global: 0,
        }
        REGIONS.forEach((region, index) => {
          regionDistribution[region] = Number(regionCounts[index])
        })

        const stats: NetworkStats = {
          totalNodesActive: Number(networkStats[0]),
          totalStakedUSD: formatEther(networkStats[1]),
          totalRewardsClaimedUSD: formatEther(networkStats[2]),
          regionDistribution,
          minStakeUSD: formatEther(minStake),
          baseRewardPerMonthUSD: formatEther(baseReward),
        }

        return stats
      })

      // Get operator's staking stats and nodes
      .get(
        '/operator/:address',
        async ({ params, set }) => {
          const stakingManager = getStakingManagerAddress()
          if (!stakingManager) {
            set.status = 503
            return { error: 'Staking manager not configured' }
          }

          const operatorAddress = params.address as Address

          const client = getClient()

          // Get operator stats
          const [statsResult, nodeIds] = await Promise.all([
            client.readContract({
              address: stakingManager,
              abi: NODE_STAKING_MANAGER_ABI,
              functionName: 'getOperatorStats',
              args: [operatorAddress],
            }),
            client.readContract({
              address: stakingManager,
              abi: NODE_STAKING_MANAGER_ABI,
              functionName: 'getOperatorNodes',
              args: [operatorAddress],
            }),
          ])

          // Get detailed info for each node
          const nodes: NodeInfo[] = await Promise.all(
            nodeIds.map(async (nodeId) => {
              const [nodeInfo, perf, pendingRewards] = await Promise.all([
                client.readContract({
                  address: stakingManager,
                  abi: NODE_STAKING_MANAGER_ABI,
                  functionName: 'nodes',
                  args: [nodeId],
                }),
                client.readContract({
                  address: stakingManager,
                  abi: NODE_STAKING_MANAGER_ABI,
                  functionName: 'performance',
                  args: [nodeId],
                }),
                client.readContract({
                  address: stakingManager,
                  abi: NODE_STAKING_MANAGER_ABI,
                  functionName: 'calculatePendingRewards',
                  args: [nodeId],
                }),
              ])

              return {
                nodeId: nodeInfo[0] as Hex,
                operator: nodeInfo[1] as Address,
                stakedToken: nodeInfo[2] as Address,
                stakedAmount: formatEther(nodeInfo[3]),
                stakedValueUSD: formatEther(nodeInfo[4]),
                rewardToken: nodeInfo[5] as Address,
                rpcUrl: nodeInfo[6] as string,
                region: REGIONS[nodeInfo[7]] || 'Global',
                registrationTime: Number(nodeInfo[8]),
                lastClaimTime: Number(nodeInfo[9]),
                totalRewardsClaimed: formatEther(nodeInfo[10]),
                operatorAgentId: Number(nodeInfo[11]),
                isActive: nodeInfo[12] as boolean,
                isSlashed: nodeInfo[13] as boolean,
                performance: {
                  uptimeScore: Number(perf[0]),
                  requestsServed: Number(perf[1]),
                  avgResponseTime: Number(perf[2]),
                  lastUpdateTime: Number(perf[3]),
                },
                pendingRewards: formatEther(pendingRewards),
              }
            }),
          )

          const stats: OperatorStats = {
            totalNodesActive: Number(statsResult.totalNodesActive),
            totalStakedUSD: formatEther(statsResult.totalStakedUSD),
            lifetimeRewardsUSD: formatEther(statsResult.lifetimeRewardsUSD),
            nodes,
          }

          return stats
        },
        {
          params: t.Object({
            address: t.String(),
          }),
        },
      )

      // Get specific node info
      .get(
        '/node/:nodeId',
        async ({ params, set }) => {
          const stakingManager = getStakingManagerAddress()
          if (!stakingManager) {
            set.status = 503
            return { error: 'Staking manager not configured' }
          }

          const nodeId = params.nodeId as Hex
          const client = getClient()

          const [nodeInfo, perf, pendingRewards] = await Promise.all([
            client.readContract({
              address: stakingManager,
              abi: NODE_STAKING_MANAGER_ABI,
              functionName: 'nodes',
              args: [nodeId],
            }),
            client.readContract({
              address: stakingManager,
              abi: NODE_STAKING_MANAGER_ABI,
              functionName: 'performance',
              args: [nodeId],
            }),
            client.readContract({
              address: stakingManager,
              abi: NODE_STAKING_MANAGER_ABI,
              functionName: 'calculatePendingRewards',
              args: [nodeId],
            }),
          ])

          // Check if node exists
          if (nodeInfo[1] === '0x0000000000000000000000000000000000000000') {
            set.status = 404
            return { error: 'Node not found' }
          }

          const node: NodeInfo = {
            nodeId: nodeInfo[0] as Hex,
            operator: nodeInfo[1] as Address,
            stakedToken: nodeInfo[2] as Address,
            stakedAmount: formatEther(nodeInfo[3]),
            stakedValueUSD: formatEther(nodeInfo[4]),
            rewardToken: nodeInfo[5] as Address,
            rpcUrl: nodeInfo[6] as string,
            region: REGIONS[nodeInfo[7]] || 'Global',
            registrationTime: Number(nodeInfo[8]),
            lastClaimTime: Number(nodeInfo[9]),
            totalRewardsClaimed: formatEther(nodeInfo[10]),
            operatorAgentId: Number(nodeInfo[11]),
            isActive: nodeInfo[12] as boolean,
            isSlashed: nodeInfo[13] as boolean,
            performance: {
              uptimeScore: Number(perf[0]),
              requestsServed: Number(perf[1]),
              avgResponseTime: Number(perf[2]),
              lastUpdateTime: Number(perf[3]),
            },
            pendingRewards: formatEther(pendingRewards),
          }

          return node
        },
        {
          params: t.Object({
            nodeId: t.String(),
          }),
        },
      )

      // Get pending rewards for a node
      .get(
        '/rewards/:nodeId',
        async ({ params, set }) => {
          const stakingManager = getStakingManagerAddress()
          if (!stakingManager) {
            set.status = 503
            return { error: 'Staking manager not configured' }
          }

          const nodeId = params.nodeId as Hex
          const client = getClient()

          const pendingRewards = await client.readContract({
            address: stakingManager,
            abi: NODE_STAKING_MANAGER_ABI,
            functionName: 'calculatePendingRewards',
            args: [nodeId],
          })

          return {
            nodeId,
            pendingRewardsUSD: formatEther(pendingRewards),
          }
        },
        {
          params: t.Object({
            nodeId: t.String(),
          }),
        },
      )

      // Get all nodes (paginated)
      .get(
        '/nodes',
        async ({ query, set }) => {
          const stakingManager = getStakingManagerAddress()
          if (!stakingManager) {
            set.status = 503
            return { error: 'Staking manager not configured' }
          }

          const limit = Math.min(parseInt(query.limit ?? '20', 10), 100)
          const offset = parseInt(query.offset ?? '0', 10)

          const client = getClient()

          const allNodeIds = await client.readContract({
            address: stakingManager,
            abi: NODE_STAKING_MANAGER_ABI,
            functionName: 'getAllNodes',
          })

          const paginatedIds = allNodeIds.slice(offset, offset + limit)

          const nodes: NodeInfo[] = await Promise.all(
            paginatedIds.map(async (nodeId) => {
              const [nodeInfo, perf, pendingRewards] = await Promise.all([
                client.readContract({
                  address: stakingManager,
                  abi: NODE_STAKING_MANAGER_ABI,
                  functionName: 'nodes',
                  args: [nodeId],
                }),
                client.readContract({
                  address: stakingManager,
                  abi: NODE_STAKING_MANAGER_ABI,
                  functionName: 'performance',
                  args: [nodeId],
                }),
                client.readContract({
                  address: stakingManager,
                  abi: NODE_STAKING_MANAGER_ABI,
                  functionName: 'calculatePendingRewards',
                  args: [nodeId],
                }),
              ])

              return {
                nodeId: nodeInfo[0] as Hex,
                operator: nodeInfo[1] as Address,
                stakedToken: nodeInfo[2] as Address,
                stakedAmount: formatEther(nodeInfo[3]),
                stakedValueUSD: formatEther(nodeInfo[4]),
                rewardToken: nodeInfo[5] as Address,
                rpcUrl: nodeInfo[6] as string,
                region: REGIONS[nodeInfo[7]] || 'Global',
                registrationTime: Number(nodeInfo[8]),
                lastClaimTime: Number(nodeInfo[9]),
                totalRewardsClaimed: formatEther(nodeInfo[10]),
                operatorAgentId: Number(nodeInfo[11]),
                isActive: nodeInfo[12] as boolean,
                isSlashed: nodeInfo[13] as boolean,
                performance: {
                  uptimeScore: Number(perf[0]),
                  requestsServed: Number(perf[1]),
                  avgResponseTime: Number(perf[2]),
                  lastUpdateTime: Number(perf[3]),
                },
                pendingRewards: formatEther(pendingRewards),
              }
            }),
          )

          return {
            nodes,
            total: allNodeIds.length,
            offset,
            limit,
          }
        },
        {
          query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
          }),
        },
      )

      // Get earnings history (from events)
      .get(
        '/history/:address',
        async ({ params, query, set }) => {
          const stakingManager = getStakingManagerAddress()
          if (!stakingManager) {
            set.status = 503
            return { error: 'Staking manager not configured' }
          }

          const operatorAddress = params.address as Address
          const fromBlock = BigInt(query.fromBlock ?? '0')
          const toBlock =
            query.toBlock === 'latest' ? 'latest' : BigInt(query.toBlock ?? '0')

          const client = getClient()

          // Get RewardsClaimed events for this operator
          const rewardsClaimedLogs = await client.getLogs({
            address: stakingManager,
            event: {
              type: 'event',
              name: 'RewardsClaimed',
              inputs: [
                { name: 'nodeId', type: 'bytes32', indexed: true },
                { name: 'operator', type: 'address', indexed: true },
                { name: 'rewardToken', type: 'address', indexed: false },
                { name: 'rewardAmount', type: 'uint256', indexed: false },
                { name: 'feesPaid', type: 'uint256', indexed: false },
              ],
            },
            args: {
              operator: operatorAddress,
            },
            fromBlock,
            toBlock: toBlock === 'latest' ? undefined : toBlock,
          })

          // Get NodeRegistered events
          const nodeRegisteredLogs = await client.getLogs({
            address: stakingManager,
            event: {
              type: 'event',
              name: 'NodeRegistered',
              inputs: [
                { name: 'nodeId', type: 'bytes32', indexed: true },
                { name: 'operator', type: 'address', indexed: true },
                { name: 'stakingToken', type: 'address', indexed: false },
                { name: 'rewardToken', type: 'address', indexed: false },
                { name: 'stakedAmount', type: 'uint256', indexed: false },
                { name: 'stakedValueUSD', type: 'uint256', indexed: false },
              ],
            },
            args: {
              operator: operatorAddress,
            },
            fromBlock,
            toBlock: toBlock === 'latest' ? undefined : toBlock,
          })

          // Combine and format
          const history = [
            ...rewardsClaimedLogs.map((log) => ({
              type: 'claim' as const,
              nodeId: log.args.nodeId as Hex,
              rewardToken: log.args.rewardToken as Address,
              amount: formatEther(log.args.rewardAmount ?? 0n),
              feesPaid: formatEther(log.args.feesPaid ?? 0n),
              blockNumber: Number(log.blockNumber),
              transactionHash: log.transactionHash,
            })),
            ...nodeRegisteredLogs.map((log) => ({
              type: 'register' as const,
              nodeId: log.args.nodeId as Hex,
              stakedToken: log.args.stakingToken as Address,
              stakedAmount: formatEther(log.args.stakedAmount ?? 0n),
              stakedValueUSD: formatEther(log.args.stakedValueUSD ?? 0n),
              blockNumber: Number(log.blockNumber),
              transactionHash: log.transactionHash,
            })),
          ].sort((a, b) => b.blockNumber - a.blockNumber)

          return {
            operator: operatorAddress,
            history,
            count: history.length,
          }
        },
        {
          params: t.Object({
            address: t.String(),
          }),
          query: t.Object({
            fromBlock: t.Optional(t.String()),
            toBlock: t.Optional(t.String()),
          }),
        },
      )
  )
}
