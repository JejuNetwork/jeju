import {
  type Address,
  formatEther,
  getContract,
  type PublicClient,
  type WalletClient,
} from 'viem'

// Resource types matching the smart contract
export enum ResourceType {
  CPU = 0,
  MEMORY = 1,
  GPU_H100 = 2,
  GPU_A100 = 3,
  GPU_L4 = 4,
  STORAGE = 5,
  BANDWIDTH = 6,
  INFERENCE = 7,
}

export enum Region {
  GLOBAL = 0,
  NA_EAST = 1,
  NA_WEST = 2,
  EU_WEST = 3,
  EU_CENTRAL = 4,
  APAC_EAST = 5,
  APAC_SOUTH = 6,
}

export enum OrderType {
  SPOT = 0,
  LIMIT = 1,
  RESERVED = 2,
}

export enum OrderStatus {
  PENDING = 0,
  FILLED = 1,
  PARTIAL = 2,
  CANCELLED = 3,
  EXPIRED = 4,
}

export interface ResourcePool {
  resourceType: ResourceType
  region: Region
  totalCapacity: bigint
  usedCapacity: bigint
  basePrice: bigint
  minPrice: bigint
  maxPrice: bigint
  active: boolean
}

export interface Provider {
  addr: Address
  stake: bigint
  active: boolean
  reputation: bigint
  totalCapacity: bigint
  allocatedCapacity: bigint
  revenue: bigint
}

export interface Order {
  orderId: `0x${string}`
  user: Address
  resourceType: ResourceType
  region: Region
  orderType: OrderType
  quantity: bigint
  maxPrice: bigint
  filledQuantity: bigint
  filledPrice: bigint
  paymentToken: Address
  duration: bigint
  expiresAt: bigint
  status: OrderStatus
}

export interface Reservation {
  reservationId: `0x${string}`
  user: Address
  resourceType: ResourceType
  region: Region
  quantity: bigint
  pricePerUnit: bigint
  startTime: bigint
  endTime: bigint
  active: boolean
}

export interface Quote {
  totalCost: bigint
  averagePrice: bigint
  formattedTotalCost: string
  formattedAveragePrice: string
}

// Contract ABI (subset for client usage)
const COMPUTE_AMM_ABI = [
  {
    inputs: [
      {
        internalType: 'enum ComputeAMM.ResourceType',
        name: 'resourceType',
        type: 'uint8',
      },
      { internalType: 'enum ComputeAMM.Region', name: 'region', type: 'uint8' },
    ],
    name: 'getSpotPrice',
    outputs: [{ internalType: 'uint256', name: 'price', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'enum ComputeAMM.ResourceType',
        name: 'resourceType',
        type: 'uint8',
      },
      { internalType: 'enum ComputeAMM.Region', name: 'region', type: 'uint8' },
      { internalType: 'uint256', name: 'quantity', type: 'uint256' },
    ],
    name: 'getQuote',
    outputs: [
      { internalType: 'uint256', name: 'totalCost', type: 'uint256' },
      { internalType: 'uint256', name: 'averagePrice', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'enum ComputeAMM.ResourceType',
        name: 'resourceType',
        type: 'uint8',
      },
      { internalType: 'enum ComputeAMM.Region', name: 'region', type: 'uint8' },
    ],
    name: 'getPoolInfo',
    outputs: [
      {
        components: [
          {
            internalType: 'enum ComputeAMM.ResourceType',
            name: 'resourceType',
            type: 'uint8',
          },
          {
            internalType: 'enum ComputeAMM.Region',
            name: 'region',
            type: 'uint8',
          },
          { internalType: 'uint256', name: 'totalCapacity', type: 'uint256' },
          { internalType: 'uint256', name: 'usedCapacity', type: 'uint256' },
          { internalType: 'uint256', name: 'basePrice', type: 'uint256' },
          { internalType: 'uint256', name: 'minPrice', type: 'uint256' },
          { internalType: 'uint256', name: 'maxPrice', type: 'uint256' },
          { internalType: 'bool', name: 'active', type: 'bool' },
        ],
        internalType: 'struct ComputeAMM.ResourcePool',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'registerProvider',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'enum ComputeAMM.ResourceType',
        name: 'resourceType',
        type: 'uint8',
      },
      { internalType: 'enum ComputeAMM.Region', name: 'region', type: 'uint8' },
      { internalType: 'uint256', name: 'capacity', type: 'uint256' },
    ],
    name: 'addCapacity',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'enum ComputeAMM.ResourceType',
        name: 'resourceType',
        type: 'uint8',
      },
      { internalType: 'enum ComputeAMM.Region', name: 'region', type: 'uint8' },
      { internalType: 'uint256', name: 'quantity', type: 'uint256' },
      { internalType: 'uint256', name: 'maxPrice', type: 'uint256' },
      { internalType: 'address', name: 'paymentToken', type: 'address' },
    ],
    name: 'placeSpotOrder',
    outputs: [{ internalType: 'bytes32', name: 'orderId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'enum ComputeAMM.ResourceType',
        name: 'resourceType',
        type: 'uint8',
      },
      { internalType: 'enum ComputeAMM.Region', name: 'region', type: 'uint8' },
      { internalType: 'uint256', name: 'quantity', type: 'uint256' },
      { internalType: 'uint256', name: 'maxPrice', type: 'uint256' },
      { internalType: 'address', name: 'paymentToken', type: 'address' },
      { internalType: 'uint256', name: 'expiresIn', type: 'uint256' },
    ],
    name: 'placeLimitOrder',
    outputs: [{ internalType: 'bytes32', name: 'orderId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'enum ComputeAMM.ResourceType',
        name: 'resourceType',
        type: 'uint8',
      },
      { internalType: 'enum ComputeAMM.Region', name: 'region', type: 'uint8' },
      { internalType: 'uint256', name: 'quantity', type: 'uint256' },
      { internalType: 'uint256', name: 'duration', type: 'uint256' },
      { internalType: 'address', name: 'paymentToken', type: 'address' },
    ],
    name: 'createReservation',
    outputs: [
      { internalType: 'bytes32', name: 'reservationId', type: 'bytes32' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: 'orderId', type: 'bytes32' }],
    name: 'cancelOrder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'getUserOrders',
    outputs: [{ internalType: 'bytes32[]', name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'getUserReservations',
    outputs: [{ internalType: 'bytes32[]', name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: 'orderId', type: 'bytes32' }],
    name: 'orders',
    outputs: [
      { internalType: 'bytes32', name: 'orderId', type: 'bytes32' },
      { internalType: 'address', name: 'user', type: 'address' },
      {
        internalType: 'enum ComputeAMM.ResourceType',
        name: 'resourceType',
        type: 'uint8',
      },
      { internalType: 'enum ComputeAMM.Region', name: 'region', type: 'uint8' },
      {
        internalType: 'enum ComputeAMM.OrderType',
        name: 'orderType',
        type: 'uint8',
      },
      { internalType: 'uint256', name: 'quantity', type: 'uint256' },
      { internalType: 'uint256', name: 'maxPrice', type: 'uint256' },
      { internalType: 'uint256', name: 'filledQuantity', type: 'uint256' },
      { internalType: 'uint256', name: 'filledPrice', type: 'uint256' },
      { internalType: 'address', name: 'paymentToken', type: 'address' },
      { internalType: 'uint256', name: 'duration', type: 'uint256' },
      { internalType: 'uint256', name: 'expiresAt', type: 'uint256' },
      {
        internalType: 'enum ComputeAMM.OrderStatus',
        name: 'status',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'reservationId', type: 'bytes32' },
    ],
    name: 'reservations',
    outputs: [
      { internalType: 'bytes32', name: 'reservationId', type: 'bytes32' },
      { internalType: 'address', name: 'user', type: 'address' },
      {
        internalType: 'enum ComputeAMM.ResourceType',
        name: 'resourceType',
        type: 'uint8',
      },
      { internalType: 'enum ComputeAMM.Region', name: 'region', type: 'uint8' },
      { internalType: 'uint256', name: 'quantity', type: 'uint256' },
      { internalType: 'uint256', name: 'pricePerUnit', type: 'uint256' },
      { internalType: 'uint256', name: 'startTime', type: 'uint256' },
      { internalType: 'uint256', name: 'endTime', type: 'uint256' },
      { internalType: 'bool', name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'provider', type: 'address' }],
    name: 'providers',
    outputs: [
      { internalType: 'address', name: 'addr', type: 'address' },
      { internalType: 'uint256', name: 'stake', type: 'uint256' },
      { internalType: 'bool', name: 'active', type: 'bool' },
      { internalType: 'uint256', name: 'reputation', type: 'uint256' },
      { internalType: 'uint256', name: 'totalCapacity', type: 'uint256' },
      { internalType: 'uint256', name: 'allocatedCapacity', type: 'uint256' },
      { internalType: 'uint256', name: 'revenue', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getAllPools',
    outputs: [{ internalType: 'bytes32[]', name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getProviderCount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'minProviderStake',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'protocolFeeBps',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export interface ComputeAMMClientConfig {
  contractAddress: Address
  publicClient: PublicClient
  walletClient?: WalletClient
}

/**
 * Client for interacting with the ComputeAMM smart contract
 */
export class ComputeAMMClient {
  private contract
  private config: ComputeAMMClientConfig

  constructor(config: ComputeAMMClientConfig) {
    this.config = config
    this.contract = getContract({
      address: config.contractAddress,
      abi: COMPUTE_AMM_ABI,
      client: {
        public: config.publicClient,
        wallet: config.walletClient,
      },
    })
  }

  // ============================================================================
  // Read Functions
  // ============================================================================

  /**
   * Get the current spot price for a resource type in a region
   */
  async getSpotPrice(
    resourceType: ResourceType,
    region: Region,
  ): Promise<bigint> {
    return this.contract.read.getSpotPrice([resourceType, region])
  }

  /**
   * Get a quote for purchasing a specific quantity
   */
  async getQuote(
    resourceType: ResourceType,
    region: Region,
    quantity: bigint,
  ): Promise<Quote> {
    const [totalCost, averagePrice] = await this.contract.read.getQuote([
      resourceType,
      region,
      quantity,
    ])

    return {
      totalCost,
      averagePrice,
      formattedTotalCost: formatEther(totalCost),
      formattedAveragePrice: formatEther(averagePrice),
    }
  }

  /**
   * Get pool information for a resource type and region
   */
  async getPoolInfo(
    resourceType: ResourceType,
    region: Region,
  ): Promise<ResourcePool> {
    const pool = await this.contract.read.getPoolInfo([resourceType, region])
    return {
      resourceType: pool.resourceType as ResourceType,
      region: pool.region as Region,
      totalCapacity: pool.totalCapacity,
      usedCapacity: pool.usedCapacity,
      basePrice: pool.basePrice,
      minPrice: pool.minPrice,
      maxPrice: pool.maxPrice,
      active: pool.active,
    }
  }

  /**
   * Get provider information
   */
  async getProvider(address: Address): Promise<Provider> {
    const provider = await this.contract.read.providers([address])
    return {
      addr: provider.addr,
      stake: provider.stake,
      active: provider.active,
      reputation: provider.reputation,
      totalCapacity: provider.totalCapacity,
      allocatedCapacity: provider.allocatedCapacity,
      revenue: provider.revenue,
    }
  }

  /**
   * Get order information
   */
  async getOrder(orderId: `0x${string}`): Promise<Order> {
    const order = await this.contract.read.orders([orderId])
    return {
      orderId: order.orderId,
      user: order.user,
      resourceType: order.resourceType as ResourceType,
      region: order.region as Region,
      orderType: order.orderType as OrderType,
      quantity: order.quantity,
      maxPrice: order.maxPrice,
      filledQuantity: order.filledQuantity,
      filledPrice: order.filledPrice,
      paymentToken: order.paymentToken,
      duration: order.duration,
      expiresAt: order.expiresAt,
      status: order.status as OrderStatus,
    }
  }

  /**
   * Get reservation information
   */
  async getReservation(reservationId: `0x${string}`): Promise<Reservation> {
    const res = await this.contract.read.reservations([reservationId])
    return {
      reservationId: res.reservationId,
      user: res.user,
      resourceType: res.resourceType as ResourceType,
      region: res.region as Region,
      quantity: res.quantity,
      pricePerUnit: res.pricePerUnit,
      startTime: res.startTime,
      endTime: res.endTime,
      active: res.active,
    }
  }

  /**
   * Get all orders for a user
   */
  async getUserOrders(user: Address): Promise<`0x${string}`[]> {
    return this.contract.read.getUserOrders([user])
  }

  /**
   * Get all reservations for a user
   */
  async getUserReservations(user: Address): Promise<`0x${string}`[]> {
    return this.contract.read.getUserReservations([user])
  }

  /**
   * Get all pool IDs
   */
  async getAllPools(): Promise<`0x${string}`[]> {
    return this.contract.read.getAllPools()
  }

  /**
   * Get total provider count
   */
  async getProviderCount(): Promise<bigint> {
    return this.contract.read.getProviderCount()
  }

  /**
   * Get minimum provider stake requirement
   */
  async getMinProviderStake(): Promise<bigint> {
    return this.contract.read.minProviderStake()
  }

  /**
   * Get protocol fee in basis points
   */
  async getProtocolFeeBps(): Promise<bigint> {
    return this.contract.read.protocolFeeBps()
  }

  // ============================================================================
  // Write Functions
  // ============================================================================

  private requireWalletClient(): WalletClient {
    if (!this.config.walletClient) {
      throw new Error('Wallet client required for write operations')
    }
    return this.config.walletClient
  }

  /**
   * Register as a compute provider
   */
  async registerProvider(stakeAmount: bigint): Promise<`0x${string}`> {
    const walletClient = this.requireWalletClient()
    const [account] = await walletClient.getAddresses()

    return walletClient.writeContract({
      address: this.config.contractAddress,
      abi: COMPUTE_AMM_ABI,
      functionName: 'registerProvider',
      account,
      value: stakeAmount,
    })
  }

  /**
   * Add capacity to a resource pool
   */
  async addCapacity(
    resourceType: ResourceType,
    region: Region,
    capacity: bigint,
  ): Promise<`0x${string}`> {
    const walletClient = this.requireWalletClient()
    const [account] = await walletClient.getAddresses()

    return walletClient.writeContract({
      address: this.config.contractAddress,
      abi: COMPUTE_AMM_ABI,
      functionName: 'addCapacity',
      args: [resourceType, region, capacity],
      account,
    })
  }

  /**
   * Place a spot order for immediate execution
   */
  async placeSpotOrder(params: {
    resourceType: ResourceType
    region: Region
    quantity: bigint
    maxPrice: bigint
    paymentToken: Address
  }): Promise<`0x${string}`> {
    const walletClient = this.requireWalletClient()
    const [account] = await walletClient.getAddresses()

    return walletClient.writeContract({
      address: this.config.contractAddress,
      abi: COMPUTE_AMM_ABI,
      functionName: 'placeSpotOrder',
      args: [
        params.resourceType,
        params.region,
        params.quantity,
        params.maxPrice,
        params.paymentToken,
      ],
      account,
    })
  }

  /**
   * Place a limit order that executes when price drops below maxPrice
   */
  async placeLimitOrder(params: {
    resourceType: ResourceType
    region: Region
    quantity: bigint
    maxPrice: bigint
    paymentToken: Address
    expiresIn: bigint
  }): Promise<`0x${string}`> {
    const walletClient = this.requireWalletClient()
    const [account] = await walletClient.getAddresses()

    return walletClient.writeContract({
      address: this.config.contractAddress,
      abi: COMPUTE_AMM_ABI,
      functionName: 'placeLimitOrder',
      args: [
        params.resourceType,
        params.region,
        params.quantity,
        params.maxPrice,
        params.paymentToken,
        params.expiresIn,
      ],
      account,
    })
  }

  /**
   * Create a reserved capacity position
   */
  async createReservation(params: {
    resourceType: ResourceType
    region: Region
    quantity: bigint
    duration: bigint
    paymentToken: Address
  }): Promise<`0x${string}`> {
    const walletClient = this.requireWalletClient()
    const [account] = await walletClient.getAddresses()

    return walletClient.writeContract({
      address: this.config.contractAddress,
      abi: COMPUTE_AMM_ABI,
      functionName: 'createReservation',
      args: [
        params.resourceType,
        params.region,
        params.quantity,
        params.duration,
        params.paymentToken,
      ],
      account,
    })
  }

  /**
   * Cancel a pending order
   */
  async cancelOrder(orderId: `0x${string}`): Promise<`0x${string}`> {
    const walletClient = this.requireWalletClient()
    const [account] = await walletClient.getAddresses()

    return walletClient.writeContract({
      address: this.config.contractAddress,
      abi: COMPUTE_AMM_ABI,
      functionName: 'cancelOrder',
      args: [orderId],
      account,
    })
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  /**
   * Calculate the price with slippage tolerance
   */
  calculateMaxPriceWithSlippage(price: bigint, slippageBps: number): bigint {
    return price + (price * BigInt(slippageBps)) / 10000n
  }

  /**
   * Get utilization percentage for a pool
   */
  async getUtilization(
    resourceType: ResourceType,
    region: Region,
  ): Promise<number> {
    const pool = await this.getPoolInfo(resourceType, region)
    if (pool.totalCapacity === 0n) return 0
    return Number((pool.usedCapacity * 100n) / pool.totalCapacity)
  }

  /**
   * Get all pool information including current prices
   */
  async getAllPoolsWithPrices(): Promise<
    Array<ResourcePool & { currentPrice: bigint; utilization: number }>
  > {
    const poolIds = await this.getAllPools()
    const results: Array<
      ResourcePool & { currentPrice: bigint; utilization: number }
    > = []

    for (const _poolId of poolIds) {
      // Decode pool ID to get resource type and region
      // Pool ID = keccak256(resourceType, region)
      // We need to iterate through all combinations to find matches
      for (let rt = 0; rt <= 7; rt++) {
        for (let r = 0; r <= 6; r++) {
          const pool = await this.getPoolInfo(rt as ResourceType, r as Region)
          if (pool.active && pool.totalCapacity > 0n) {
            const currentPrice = await this.getSpotPrice(
              rt as ResourceType,
              r as Region,
            )
            const utilization =
              pool.totalCapacity > 0n
                ? Number((pool.usedCapacity * 100n) / pool.totalCapacity)
                : 0

            // Check if this pool matches the poolId
            results.push({
              ...pool,
              currentPrice,
              utilization,
            })
          }
        }
      }
      break // We get all pools in the first iteration
    }

    return results
  }

  /**
   * Estimate gas for a spot order
   */
  async estimateSpotOrderGas(params: {
    resourceType: ResourceType
    region: Region
    quantity: bigint
    maxPrice: bigint
    paymentToken: Address
  }): Promise<bigint> {
    const walletClient = this.requireWalletClient()
    const [account] = await walletClient.getAddresses()

    return this.config.publicClient.estimateContractGas({
      address: this.config.contractAddress,
      abi: COMPUTE_AMM_ABI,
      functionName: 'placeSpotOrder',
      args: [
        params.resourceType,
        params.region,
        params.quantity,
        params.maxPrice,
        params.paymentToken,
      ],
      account,
    })
  }
}

// Export factory function
export function createComputeAMMClient(
  config: ComputeAMMClientConfig,
): ComputeAMMClient {
  return new ComputeAMMClient(config)
}

// Export resource type helpers
export const RESOURCE_NAMES: Record<ResourceType, string> = {
  [ResourceType.CPU]: 'vCPU Hours',
  [ResourceType.MEMORY]: 'Memory GB-Hours',
  [ResourceType.GPU_H100]: 'NVIDIA H100 GPU Hours',
  [ResourceType.GPU_A100]: 'NVIDIA A100 GPU Hours',
  [ResourceType.GPU_L4]: 'NVIDIA L4 GPU Hours',
  [ResourceType.STORAGE]: 'Storage GB-Months',
  [ResourceType.BANDWIDTH]: 'Bandwidth GB',
  [ResourceType.INFERENCE]: 'Inference Tokens (1k)',
}

export const REGION_NAMES: Record<Region, string> = {
  [Region.GLOBAL]: 'Global',
  [Region.NA_EAST]: 'North America East',
  [Region.NA_WEST]: 'North America West',
  [Region.EU_WEST]: 'Europe West',
  [Region.EU_CENTRAL]: 'Europe Central',
  [Region.APAC_EAST]: 'Asia Pacific East',
  [Region.APAC_SOUTH]: 'Asia Pacific South',
}
