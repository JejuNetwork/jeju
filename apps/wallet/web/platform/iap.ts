/**
 * In-App Purchases - Platform-specific IAP handling
 */

export interface IAPProduct {
  id: string
  title: string
  description: string
  price: string
  currency: string
  priceAmountMicros: number
}

export interface IAPPurchase {
  productId: string
  transactionId: string
  timestamp: number
  receipt?: string
}

export interface IAPConfig {
  platform: 'ios' | 'android' | 'web'
  sandbox?: boolean
}

/**
 * In-App Purchase Service
 */
export class IAPService {
  private platform: 'ios' | 'android' | 'web'
  private sandbox: boolean
  private products: Map<string, IAPProduct> = new Map()
  private purchases: IAPPurchase[] = []

  constructor(config: IAPConfig) {
    this.platform = config.platform
    this.sandbox = config.sandbox ?? false
  }

  /**
   * Initialize the IAP service
   */
  async initialize(): Promise<void> {
    // Platform-specific initialization
    console.log(`[IAP] Initializing for ${this.platform}`)
  }

  /**
   * Load available products
   */
  async loadProducts(productIds: string[]): Promise<IAPProduct[]> {
    // In a real implementation, this would fetch from App Store / Play Store
    const products: IAPProduct[] = productIds.map((id) => ({
      id,
      title: `Product ${id}`,
      description: `Description for ${id}`,
      price: '$9.99',
      currency: 'USD',
      priceAmountMicros: 9990000,
    }))

    for (const product of products) {
      this.products.set(product.id, product)
    }

    return products
  }

  /**
   * Get a product by ID
   */
  getProduct(productId: string): IAPProduct | undefined {
    return this.products.get(productId)
  }

  /**
   * Purchase a product
   */
  async purchase(productId: string): Promise<IAPPurchase> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error(`Product ${productId} not found`)
    }

    // In a real implementation, this would trigger native purchase flow
    const purchase: IAPPurchase = {
      productId,
      transactionId: `txn-${Date.now()}`,
      timestamp: Date.now(),
    }

    this.purchases.push(purchase)
    return purchase
  }

  /**
   * Restore previous purchases
   */
  async restorePurchases(): Promise<IAPPurchase[]> {
    // In a real implementation, this would restore from App Store / Play Store
    return this.purchases
  }

  /**
   * Verify a purchase receipt
   */
  async verifyPurchase(_purchase: IAPPurchase): Promise<boolean> {
    // In a real implementation, this would verify with backend
    return true
  }
}

/**
 * Create an IAP service
 */
export function createIAPService(config: IAPConfig): IAPService {
  return new IAPService(config)
}

// ============================================================================
// IAP Compliance Functions
// ============================================================================

export type FeatureType =
  | 'crypto-purchase'
  | 'nft-purchase'
  | 'subscription'
  | 'swap-with-fee'
  | 'staking'

export interface FeatureAvailability {
  available: boolean
  requiresExternalBrowser: boolean
  message?: string
}

/**
 * Check if a feature is available on the current platform
 * On web, all features are available without IAP restrictions
 */
export function checkFeatureAvailability(
  _feature: FeatureType,
): FeatureAvailability {
  // On web platform, all features are available
  return {
    available: true,
    requiresExternalBrowser: false,
  }
}

/**
 * Get IAP compliance message for a feature
 * Returns null if no message is needed (web platform)
 */
export function getIAPComplianceMessage(_feature: FeatureType): string | null {
  // On web platform, no compliance messages needed
  return null
}

/**
 * Check if purchases require external browser (iOS/Android only)
 */
export function requiresExternalPurchase(): boolean {
  // On web platform, no external purchase required
  return false
}

export interface PurchaseParams {
  type: 'crypto' | 'nft' | 'subscription'
  asset?: string
  amount?: string
  recipient?: string
}

/**
 * Generate a purchase URL for external browser flow
 */
export function getPurchaseUrl(params: PurchaseParams): string {
  const baseUrl = 'https://wallet.jejunetwork.org/purchase'
  const searchParams = new URLSearchParams()

  searchParams.set('type', params.type)
  if (params.asset) searchParams.set('asset', params.asset)
  if (params.amount) searchParams.set('amount', params.amount)
  if (params.recipient) searchParams.set('recipient', params.recipient)

  return `${baseUrl}?${searchParams.toString()}`
}
