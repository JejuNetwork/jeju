import { Elysia, t } from 'elysia'
import { type Address, createPublicClient, http } from 'viem'
import {
  ComputeAMMClient,
  REGION_NAMES,
  RESOURCE_NAMES,
  type Region,
  type ResourceType,
} from '../../../src/marketplace'

// Get contract address from config
const COMPUTE_AMM_ADDRESS = (process.env.COMPUTE_AMM_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545'

// Initialize clients
const publicClient = createPublicClient({
  transport: http(RPC_URL),
})

let ammClient: ComputeAMMClient | null = null

function getAMMClient(): ComputeAMMClient {
  if (!ammClient) {
    ammClient = new ComputeAMMClient({
      contractAddress: COMPUTE_AMM_ADDRESS,
      publicClient,
    })
  }
  return ammClient
}

// Validation schemas
const _ResourceTypeSchema = t.Union([
  t.Literal(0), // CPU
  t.Literal(1), // MEMORY
  t.Literal(2), // GPU_H100
  t.Literal(3), // GPU_A100
  t.Literal(4), // GPU_L4
  t.Literal(5), // STORAGE
  t.Literal(6), // BANDWIDTH
  t.Literal(7), // INFERENCE
])

const _RegionSchema = t.Union([
  t.Literal(0), // GLOBAL
  t.Literal(1), // NA_EAST
  t.Literal(2), // NA_WEST
  t.Literal(3), // EU_WEST
  t.Literal(4), // EU_CENTRAL
  t.Literal(5), // APAC_EAST
  t.Literal(6), // APAC_SOUTH
])

export function createMarketplaceRouter(): Elysia {
  return (
    new Elysia({ prefix: '/marketplace' })
      // =========================================================================
      // Pricing Endpoints
      // =========================================================================
      .get(
        '/price/:resourceType/:region',
        async ({ params }) => {
          const client = getAMMClient()
          const resourceType = parseInt(params.resourceType, 10) as ResourceType
          const region = parseInt(params.region, 10) as Region

          const price = await client.getSpotPrice(resourceType, region)

          return {
            resourceType,
            resourceName: RESOURCE_NAMES[resourceType],
            region,
            regionName: REGION_NAMES[region],
            priceWei: price.toString(),
            priceEth: Number(price) / 1e18,
          }
        },
        {
          params: t.Object({
            resourceType: t.String(),
            region: t.String(),
          }),
        },
      )

      .get(
        '/quote/:resourceType/:region/:quantity',
        async ({ params }) => {
          const client = getAMMClient()
          const resourceType = parseInt(params.resourceType, 10) as ResourceType
          const region = parseInt(params.region, 10) as Region
          const quantity = BigInt(params.quantity)

          const quote = await client.getQuote(resourceType, region, quantity)

          return {
            resourceType,
            resourceName: RESOURCE_NAMES[resourceType],
            region,
            regionName: REGION_NAMES[region],
            quantity: quantity.toString(),
            totalCostWei: quote.totalCost.toString(),
            totalCostEth: quote.formattedTotalCost,
            averagePriceWei: quote.averagePrice.toString(),
            averagePriceEth: quote.formattedAveragePrice,
          }
        },
        {
          params: t.Object({
            resourceType: t.String(),
            region: t.String(),
            quantity: t.String(),
          }),
        },
      )

      // =========================================================================
      // Pool Information
      // =========================================================================
      .get('/pools', async () => {
        const client = getAMMClient()
        const pools: Array<{
          resourceType: number
          resourceName: string
          region: number
          regionName: string
          totalCapacity: string
          usedCapacity: string
          utilization: number
          basePrice: string
          currentPrice: string
          active: boolean
        }> = []

        // Iterate through all resource types and regions
        for (let rt = 0; rt <= 7; rt++) {
          for (let r = 0; r <= 6; r++) {
            const pool = await client.getPoolInfo(
              rt as ResourceType,
              r as Region,
            )
            if (pool.active && pool.totalCapacity > 0n) {
              const currentPrice = await client.getSpotPrice(
                rt as ResourceType,
                r as Region,
              )
              const utilization =
                pool.totalCapacity > 0n
                  ? Number((pool.usedCapacity * 100n) / pool.totalCapacity)
                  : 0

              pools.push({
                resourceType: rt,
                resourceName: RESOURCE_NAMES[rt as ResourceType],
                region: r,
                regionName: REGION_NAMES[r as Region],
                totalCapacity: pool.totalCapacity.toString(),
                usedCapacity: pool.usedCapacity.toString(),
                utilization,
                basePrice: pool.basePrice.toString(),
                currentPrice: currentPrice.toString(),
                active: pool.active,
              })
            }
          }
        }

        return { pools }
      })

      .get(
        '/pools/:resourceType/:region',
        async ({ params }) => {
          const client = getAMMClient()
          const resourceType = parseInt(params.resourceType, 10) as ResourceType
          const region = parseInt(params.region, 10) as Region

          const pool = await client.getPoolInfo(resourceType, region)
          const currentPrice = await client.getSpotPrice(resourceType, region)
          const utilization = await client.getUtilization(resourceType, region)

          return {
            resourceType,
            resourceName: RESOURCE_NAMES[resourceType],
            region,
            regionName: REGION_NAMES[region],
            totalCapacity: pool.totalCapacity.toString(),
            usedCapacity: pool.usedCapacity.toString(),
            utilization,
            basePrice: pool.basePrice.toString(),
            minPrice: pool.minPrice.toString(),
            maxPrice: pool.maxPrice.toString(),
            currentPrice: currentPrice.toString(),
            active: pool.active,
          }
        },
        {
          params: t.Object({
            resourceType: t.String(),
            region: t.String(),
          }),
        },
      )

      // =========================================================================
      // Provider Information
      // =========================================================================
      .get('/providers/count', async () => {
        const client = getAMMClient()
        const count = await client.getProviderCount()
        return { count: count.toString() }
      })

      .get(
        '/providers/:address',
        async ({ params }) => {
          const client = getAMMClient()
          const provider = await client.getProvider(params.address as Address)

          return {
            address: provider.addr,
            stake: provider.stake.toString(),
            active: provider.active,
            reputation: provider.reputation.toString(),
            totalCapacity: provider.totalCapacity.toString(),
            allocatedCapacity: provider.allocatedCapacity.toString(),
            revenue: provider.revenue.toString(),
          }
        },
        {
          params: t.Object({
            address: t.String(),
          }),
        },
      )

      .get('/providers/min-stake', async () => {
        const client = getAMMClient()
        const stake = await client.getMinProviderStake()
        return {
          minStakeWei: stake.toString(),
          minStakeEth: Number(stake) / 1e18,
        }
      })

      // =========================================================================
      // Order Information
      // =========================================================================
      .get(
        '/orders/:orderId',
        async ({ params }) => {
          const client = getAMMClient()
          const order = await client.getOrder(params.orderId as `0x${string}`)

          return {
            orderId: order.orderId,
            user: order.user,
            resourceType: order.resourceType,
            resourceName: RESOURCE_NAMES[order.resourceType],
            region: order.region,
            regionName: REGION_NAMES[order.region],
            orderType: order.orderType,
            quantity: order.quantity.toString(),
            maxPrice: order.maxPrice.toString(),
            filledQuantity: order.filledQuantity.toString(),
            filledPrice: order.filledPrice.toString(),
            paymentToken: order.paymentToken,
            duration: order.duration.toString(),
            expiresAt: order.expiresAt.toString(),
            status: order.status,
          }
        },
        {
          params: t.Object({
            orderId: t.String(),
          }),
        },
      )

      .get(
        '/orders/user/:address',
        async ({ params }) => {
          const client = getAMMClient()
          const orderIds = await client.getUserOrders(params.address as Address)
          return { orderIds }
        },
        {
          params: t.Object({
            address: t.String(),
          }),
        },
      )

      // =========================================================================
      // Reservation Information
      // =========================================================================
      .get(
        '/reservations/:reservationId',
        async ({ params }) => {
          const client = getAMMClient()
          const reservation = await client.getReservation(
            params.reservationId as `0x${string}`,
          )

          return {
            reservationId: reservation.reservationId,
            user: reservation.user,
            resourceType: reservation.resourceType,
            resourceName: RESOURCE_NAMES[reservation.resourceType],
            region: reservation.region,
            regionName: REGION_NAMES[reservation.region],
            quantity: reservation.quantity.toString(),
            pricePerUnit: reservation.pricePerUnit.toString(),
            startTime: reservation.startTime.toString(),
            endTime: reservation.endTime.toString(),
            active: reservation.active,
          }
        },
        {
          params: t.Object({
            reservationId: t.String(),
          }),
        },
      )

      .get(
        '/reservations/user/:address',
        async ({ params }) => {
          const client = getAMMClient()
          const reservationIds = await client.getUserReservations(
            params.address as Address,
          )
          return { reservationIds }
        },
        {
          params: t.Object({
            address: t.String(),
          }),
        },
      )

      // =========================================================================
      // Protocol Information
      // =========================================================================
      .get('/protocol/fee', async () => {
        const client = getAMMClient()
        const feeBps = await client.getProtocolFeeBps()
        return {
          feeBps: feeBps.toString(),
          feePercent: Number(feeBps) / 100,
        }
      })

      // =========================================================================
      // Resource Type/Region Metadata
      // =========================================================================
      .get('/metadata/resource-types', () => {
        return {
          resourceTypes: Object.entries(RESOURCE_NAMES).map(([id, name]) => ({
            id: parseInt(id, 10),
            name,
          })),
        }
      })

      .get('/metadata/regions', () => {
        return {
          regions: Object.entries(REGION_NAMES).map(([id, name]) => ({
            id: parseInt(id, 10),
            name,
          })),
        }
      })

      // =========================================================================
      // Health Check
      // =========================================================================
      .get('/health', async () => {
        const connected =
          COMPUTE_AMM_ADDRESS !== '0x0000000000000000000000000000000000000000'

        return {
          status: connected ? 'healthy' : 'degraded',
          contractAddress: COMPUTE_AMM_ADDRESS,
          rpcUrl: RPC_URL,
          timestamp: Date.now(),
        }
      })
  )
}
