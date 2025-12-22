/**
 * Farcaster FID Registration Service
 *
 * Handles FID registration, storage purchase, and signer setup on Optimism.
 */

import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  formatEther,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { optimism } from 'viem/chains'
import type {
  BundledRegistrationRequest,
  BundledRegistrationResult,
  FIDAvailability,
  FIDInfo,
  RegisterFIDRequest,
  RegisterFIDResult,
  RegistrationConfig,
  RegistrationPrice,
  StorageInfo,
  UsernameAvailability,
} from './types'

// ============ Contract Addresses ============

const DEFAULT_CONTRACTS = {
  ID_GATEWAY: '0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69' as Address,
  ID_REGISTRY: '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b' as Address,
  STORAGE_REGISTRY: '0x00000000fcce7f938e7ae6d3c335bd6a1a7c593d' as Address,
  KEY_REGISTRY: '0x00000000Fc1237824fb747aBDE0FF18990E59b7e' as Address,
  BUNDLER: '0x00000000FC04c910A0b5feA33b03E5320622718e' as Address,
  KEY_GATEWAY: '0x00000000fC56947c7E7183f8Ca4B62398CaAdf0B' as Address,
} as const

// ============ ABIs ============

const ID_GATEWAY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'recovery', type: 'address' }],
    outputs: [{ name: 'fid', type: 'uint256' }],
  },
  {
    name: 'price',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const ID_REGISTRY_ABI = [
  {
    name: 'idOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'custodyOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'fid', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'recoveryOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'fid', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'idCounter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const STORAGE_REGISTRY_ABI = [
  {
    name: 'rent',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'fid', type: 'uint256' },
      { name: 'units', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'unitPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'rentedUnitsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'fid', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

const BUNDLER_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'registration',
        type: 'tuple',
        components: [
          { name: 'to', type: 'address' },
          { name: 'recovery', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'sig', type: 'bytes' },
        ],
      },
      {
        name: 'signerParams',
        type: 'tuple[]',
        components: [
          { name: 'keyType', type: 'uint32' },
          { name: 'key', type: 'bytes' },
          { name: 'metadataType', type: 'uint8' },
          { name: 'metadata', type: 'bytes' },
          { name: 'deadline', type: 'uint256' },
          { name: 'sig', type: 'bytes' },
        ],
      },
      { name: 'storageUnits', type: 'uint256' },
    ],
    outputs: [{ name: 'fid', type: 'uint256' }],
  },
  {
    name: 'price',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'storageUnits', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ============ Resolved Config (all required) ============

interface ResolvedConfig {
  rpcUrl: string
  idGatewayAddress: Address
  storageRegistryAddress: Address
  keyRegistryAddress: Address
  bundlerAddress: Address
}

// ============ Registration Service ============

export class FIDRegistrationService {
  private config: ResolvedConfig
  private publicClient: PublicClient
  private walletClient: WalletClient | null = null

  constructor(config?: Partial<RegistrationConfig>) {
    this.config = {
      rpcUrl: config?.rpcUrl ?? 'https://mainnet.optimism.io',
      idGatewayAddress:
        config?.idGatewayAddress ?? DEFAULT_CONTRACTS.ID_GATEWAY,
      storageRegistryAddress:
        config?.storageRegistryAddress ?? DEFAULT_CONTRACTS.STORAGE_REGISTRY,
      keyRegistryAddress:
        config?.keyRegistryAddress ?? DEFAULT_CONTRACTS.KEY_REGISTRY,
      bundlerAddress: config?.bundlerAddress ?? DEFAULT_CONTRACTS.BUNDLER,
    }

    this.publicClient = createPublicClient({
      chain: optimism,
      transport: http(this.config.rpcUrl),
    }) as PublicClient
  }

  /**
   * Set wallet client for transactions
   */
  setWalletClient(walletClient: WalletClient): void {
    this.walletClient = walletClient
  }

  // ============ Registration ============

  /**
   * Register a new FID
   */
  async registerFID(request: RegisterFIDRequest): Promise<RegisterFIDResult> {
    if (!this.walletClient) {
      throw new Error('Wallet client not set')
    }
    if (!this.walletClient.account) {
      throw new Error('Wallet client must have an account')
    }

    // Get current price
    const price = await this.getRegistrationPrice(request.storageUnits ?? 1)

    // Build registration transaction
    const data = encodeFunctionData({
      abi: ID_GATEWAY_ABI,
      functionName: 'register',
      args: [request.recoveryAddress ?? request.custodyAddress],
    })

    // Send transaction
    const txHash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: optimism,
      to: this.config.idGatewayAddress,
      data,
      value: price.fidPrice,
    })

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    // Get assigned FID
    const fid = await this.getFIDByAddress(request.custodyAddress)
    if (!fid) {
      throw new Error('FID registration failed')
    }

    // Purchase storage if requested
    if (request.storageUnits && request.storageUnits > 0) {
      await this.purchaseStorage(fid, request.storageUnits)
    }

    // Register signer if provided
    if (request.signerPublicKey) {
      await this.registerSigner(fid, request.signerPublicKey)
    }

    return {
      fid,
      txHash,
      gasUsed: receipt.gasUsed,
      totalCost: price.totalPrice,
      storageUnits: request.storageUnits ?? 0,
    }
  }

  /**
   * Bundled registration (FID + signer + storage in one tx)
   */
  async registerBundled(
    request: BundledRegistrationRequest,
  ): Promise<BundledRegistrationResult> {
    if (!this.walletClient) {
      throw new Error('Wallet client not set')
    }
    if (!this.walletClient.account) {
      throw new Error('Wallet client must have an account')
    }

    // Get total price
    const price = await this.getBundledPrice(request.storageUnits)

    const deadline = Math.floor(Date.now() / 1000) + 86400 // 24 hours

    // Build bundler transaction
    const data = encodeFunctionData({
      abi: BUNDLER_ABI,
      functionName: 'register',
      args: [
        {
          to: request.custodyAddress,
          recovery: request.recoveryAddress ?? request.custodyAddress,
          deadline: BigInt(deadline),
          sig: '0x' as Hex, // Self-registration, no signature needed
        },
        request.signerPublicKey
          ? [
              {
                keyType: request.signerKeyType ?? 1, // Ed25519
                key: request.signerPublicKey,
                metadataType: 0,
                metadata: request.signerMetadata ?? ('0x' as Hex),
                deadline: BigInt(deadline),
                sig: '0x' as Hex, // Signed by custody
              },
            ]
          : [],
        BigInt(request.storageUnits),
      ],
    })

    // Send transaction
    const txHash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: optimism,
      to: this.config.bundlerAddress,
      data,
      value: price + (request.extraEth ?? 0n),
    })

    // Wait for confirmation
    await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    // Get FID
    const fid = await this.getFIDByAddress(request.custodyAddress)
    if (!fid) {
      throw new Error('Bundled registration failed')
    }

    // Calculate storage expiration (1 year from now)
    const storageExpiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000

    return {
      fid,
      txHash,
      username: request.username,
      storageExpiresAt,
      signerRegistered: !!request.signerPublicKey,
    }
  }

  // ============ Storage ============

  /**
   * Purchase additional storage
   */
  async purchaseStorage(fid: number, units: number): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet client not set')
    }
    if (!this.walletClient.account) {
      throw new Error('Wallet client must have an account')
    }

    const unitPrice = await this.getStorageUnitPrice()
    const totalPrice = unitPrice * BigInt(units)

    const data = encodeFunctionData({
      abi: STORAGE_REGISTRY_ABI,
      functionName: 'rent',
      args: [BigInt(fid), BigInt(units)],
    })

    const txHash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: optimism,
      to: this.config.storageRegistryAddress,
      data,
      value: totalPrice,
    })

    await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    return txHash
  }

  /**
   * Get storage info for FID
   */
  async getStorageInfo(fid: number): Promise<StorageInfo> {
    const units = await this.publicClient.readContract({
      address: this.config.storageRegistryAddress,
      abi: STORAGE_REGISTRY_ABI,
      functionName: 'rentedUnitsOf',
      args: [BigInt(fid)],
    })

    return {
      fid,
      totalUnits: Number(units),
      usedUnits: 0, // Would need hub query
      units: [],
    }
  }

  // ============ Signer Registration ============

  /**
   * Register a signer key for FID
   */
  async registerSigner(_fid: number, publicKey: Hex): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet client not set')
    }
    if (!this.walletClient.account) {
      throw new Error('Wallet client must have an account')
    }

    const KEY_REGISTRY_ABI = [
      {
        name: 'add',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'keyType', type: 'uint32' },
          { name: 'key', type: 'bytes' },
          { name: 'metadataType', type: 'uint8' },
          { name: 'metadata', type: 'bytes' },
        ],
        outputs: [],
      },
    ] as const

    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'add',
      args: [1, publicKey, 0, '0x' as Hex],
    })

    const txHash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: optimism,
      to: this.config.keyRegistryAddress,
      data,
    })

    await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    return txHash
  }

  // ============ Queries ============

  /**
   * Check if address has an FID
   */
  async getFIDByAddress(address: Address): Promise<number | null> {
    const fid = await this.publicClient.readContract({
      address: DEFAULT_CONTRACTS.ID_REGISTRY,
      abi: ID_REGISTRY_ABI,
      functionName: 'idOf',
      args: [address],
    })

    return fid > 0n ? Number(fid) : null
  }

  /**
   * Get FID info
   */
  async getFIDInfo(fid: number): Promise<FIDInfo | null> {
    const [custody, recovery] = await Promise.all([
      this.publicClient.readContract({
        address: DEFAULT_CONTRACTS.ID_REGISTRY,
        abi: ID_REGISTRY_ABI,
        functionName: 'custodyOf',
        args: [BigInt(fid)],
      }),
      this.publicClient.readContract({
        address: DEFAULT_CONTRACTS.ID_REGISTRY,
        abi: ID_REGISTRY_ABI,
        functionName: 'recoveryOf',
        args: [BigInt(fid)],
      }),
    ])

    const zeroAddress = '0x0000000000000000000000000000000000000000'
    if (custody === zeroAddress) {
      return null
    }

    return {
      fid,
      custodyAddress: custody,
      recoveryAddress: recovery === zeroAddress ? undefined : recovery,
      registeredAt: 0, // Would need event query
      txHash: '0x' as Hex,
    }
  }

  /**
   * Check FID availability
   */
  async checkFIDAvailability(fid: number): Promise<FIDAvailability> {
    const info = await this.getFIDInfo(fid)

    if (info) {
      return {
        available: false,
        owner: info.custodyAddress,
        reason: 'taken',
      }
    }

    // Check if FID is valid (not beyond counter)
    const counter = await this.publicClient.readContract({
      address: DEFAULT_CONTRACTS.ID_REGISTRY,
      abi: ID_REGISTRY_ABI,
      functionName: 'idCounter',
    })

    if (BigInt(fid) > counter) {
      return {
        available: false,
        reason: 'invalid',
      }
    }

    return { available: true }
  }

  /**
   * Get next available FID
   */
  async getNextFID(): Promise<number> {
    const counter = await this.publicClient.readContract({
      address: DEFAULT_CONTRACTS.ID_REGISTRY,
      abi: ID_REGISTRY_ABI,
      functionName: 'idCounter',
    })

    return Number(counter) + 1
  }

  /**
   * Check username availability
   */
  async checkUsernameAvailability(
    username: string,
  ): Promise<UsernameAvailability> {
    // Minimum length validation (Farcaster requires at least 1 char)
    if (username.length < 1) {
      return { available: false, reason: 'too_short' }
    }

    // Maximum length validation (Farcaster max is 16 chars)
    if (username.length > 16) {
      return { available: false, reason: 'invalid' }
    }

    // Must start with a letter or number (not underscore/hyphen)
    if (!/^[a-z0-9]/i.test(username)) {
      return { available: false, reason: 'invalid' }
    }

    // Only allow lowercase letters, numbers, underscores, and hyphens
    // Enforce lowercase to match Farcaster requirements
    if (!/^[a-z0-9_-]+$/.test(username.toLowerCase())) {
      return { available: false, reason: 'invalid' }
    }

    // Disallow consecutive special characters
    if (/[_-]{2,}/.test(username)) {
      return { available: false, reason: 'invalid' }
    }

    // Must not end with underscore or hyphen
    if (/[_-]$/.test(username)) {
      return { available: false, reason: 'invalid' }
    }

    // Reserved usernames that could be confusing
    const reservedUsernames = [
      'admin',
      'root',
      'system',
      'farcaster',
      'warpcast',
      'support',
      'help',
      'security',
      'official',
      'api',
    ]
    if (reservedUsernames.includes(username.toLowerCase())) {
      return { available: false, reason: 'reserved' }
    }

    // Check hub for existing registration
    // In production, query hub for username proof

    return { available: true }
  }

  // ============ Pricing ============

  /**
   * Get registration price
   */
  async getRegistrationPrice(
    storageUnits: number = 1,
  ): Promise<RegistrationPrice> {
    const [fidPrice, unitPrice] = await Promise.all([
      this.publicClient.readContract({
        address: this.config.idGatewayAddress,
        abi: ID_GATEWAY_ABI,
        functionName: 'price',
      }),
      this.getStorageUnitPrice(),
    ])

    const storagePrice = unitPrice * BigInt(storageUnits)

    return {
      fidPrice,
      storageUnitPrice: unitPrice,
      totalPrice: fidPrice + storagePrice,
    }
  }

  /**
   * Get bundled registration price
   */
  async getBundledPrice(storageUnits: number): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.config.bundlerAddress,
      abi: BUNDLER_ABI,
      functionName: 'price',
      args: [BigInt(storageUnits)],
    })
  }

  /**
   * Get storage unit price
   */
  async getStorageUnitPrice(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.config.storageRegistryAddress,
      abi: STORAGE_REGISTRY_ABI,
      functionName: 'unitPrice',
    })
  }

  /**
   * Format price for display
   */
  formatPrice(wei: bigint): string {
    return `${formatEther(wei)} ETH`
  }
}

// ============ Factory Function ============

/**
 * Create registration service
 */
export function createRegistrationService(
  config?: Partial<RegistrationConfig>,
): FIDRegistrationService {
  return new FIDRegistrationService(config)
}
