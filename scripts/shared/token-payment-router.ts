/**
 * Token Payment Router
 *
 * The single entry point for all payment operations on Jeju.
 * Works with ANY app, ANY token, ANY chain.
 *
 * Features:
 * - App token preferences (Hyperscape uses HYPER, Babylon uses BABYLON)
 * - Automatic fallback to cheapest available token
 * - Cross-chain support via OIF
 * - Works for gas sponsorship AND service payments
 * - Zero bridging required
 *
 * Priority Order:
 * 1. App's preferred token (if user has it)
 * 2. App's fallback tokens (in priority order)
 * 3. Cheapest token from user's wallet with XLP liquidity
 * 4. Cross-chain via OIF intents (if user has tokens on other chains)
 *
 * Usage:
 * ```ts
 * import { createPaymentRouter, findBestPayment } from '@jejunetwork/payment';
 *
 * // Option 1: Quick one-liner
 * const option = await findBestPayment(appAddress, user, amount);
 *
 * // Option 2: Full router
 * const router = createPaymentRouter({ chainId: 420691 });
 * const options = await router.getAllPaymentOptions(request, userTokens);
 * ```
 */

import { createPublicClient, http, Address, parseAbi, formatUnits } from 'viem';

// ============ Types ============

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
  chainId: number;
  hasXLPLiquidity: boolean;
  xlpLiquidity: bigint;
}

export interface PaymentOption {
  token: Address;
  symbol: string;
  chainId: number;
  amount: bigint;
  amountUsd: number;
  reason: string;
  isPreferred: boolean;
  isCrossChain: boolean;
  route?: string;
}

export interface AppPreference {
  appAddress: Address;
  preferredToken: Address;
  tokenSymbol: string;
  allowFallback: boolean;
  fallbackTokens: Address[];
}

export interface PaymentRequest {
  appAddress: Address;
  user: Address;
  amount: bigint; // Amount in USD or native units
  isGasPayment: boolean;
  serviceName?: string;
}

export interface PaymentRouterConfig {
  chainId: number;
  rpcUrl: string;
  crossChainPaymaster: Address;
  appTokenPreference: Address;
  tokenRegistry: Address;
  priceOracle: Address;
  oifAggregator?: string; // URL for OIF aggregator API
}

// ============ ABIs ============

const CROSS_CHAIN_PAYMASTER_ABI = parseAbi([
  'function supportedTokens(address token) view returns (bool)',
  'function getTotalLiquidity(address token) view returns (uint256)',
  'function getBestPaymentTokenForApp(address appAddress, address user, uint256 gasCostETH, address[] tokens, uint256[] balances) view returns (address bestToken, uint256 tokenCost, string reason)',
  'function previewTokenCost(uint256 estimatedGas, uint256 gasPrice, address token) view returns (uint256)',
  'function checkAppPreference(address appAddress, address user, address token, uint256 balance) view returns (bool hasPreferred, address preferredToken)',
]);

const APP_TOKEN_PREFERENCE_ABI = parseAbi([
  'function getAppPreference(address appAddress) view returns (address appAddr, address preferredToken, string tokenSymbol, uint8 tokenDecimals, bool allowFallback, uint256 minBalance, bool isActive, address registrant, uint256 registrationTime)',
  'function getAppFallbackTokens(address appAddress) view returns (address[])',
  'function getGlobalDefaults() view returns (address[])',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

const PRICE_ORACLE_ABI = parseAbi([
  'function getPrice(address token) view returns (uint256 price, uint256 decimals)',
  'function convertAmount(address fromToken, address toToken, uint256 amount) view returns (uint256)',
]);

// ============ Token Payment Router ============

export class TokenPaymentRouter {
  private client: ReturnType<typeof createPublicClient>;
  private config: PaymentRouterConfig;
  private crossChainClients: Map<number, ReturnType<typeof createPublicClient>> = new Map();

  constructor(config: PaymentRouterConfig) {
    this.config = config;
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    });
  }

  /**
   * Add a cross-chain client for multi-chain balance lookups
   */
  addCrossChainClient(chainId: number, rpcUrl: string) {
    this.crossChainClients.set(
      chainId,
      createPublicClient({
        transport: http(rpcUrl),
      })
    );
  }

  /**
   * Get the best payment option for a request
   * This is the main entry point for the SDK
   */
  async getBestPaymentOption(
    request: PaymentRequest,
    userTokens: Address[]
  ): Promise<PaymentOption | null> {
    // 1. Get user's token balances
    const tokenInfos = await this.getUserTokenInfo(request.user, userTokens);

    // 2. Check app preference
    const appPreference = await this.getAppPreference(request.appAddress);

    // 3. Find best option considering preferences
    return this.findBestOption(request, tokenInfos, appPreference);
  }

  /**
   * Get all available payment options for a request
   */
  async getAllPaymentOptions(
    request: PaymentRequest,
    userTokens: Address[]
  ): Promise<PaymentOption[]> {
    const tokenInfos = await this.getUserTokenInfo(request.user, userTokens);
    const appPreference = await this.getAppPreference(request.appAddress);
    const options: PaymentOption[] = [];

    for (const tokenInfo of tokenInfos) {
      if (tokenInfo.balance === 0n) continue;
      if (!tokenInfo.hasXLPLiquidity) continue;

      const cost = await this.calculateTokenCost(request, tokenInfo.address);
      if (cost === null || tokenInfo.balance < cost) continue;

      const isPreferred =
        appPreference !== null && tokenInfo.address.toLowerCase() === appPreference.preferredToken.toLowerCase();

      const usdValue = await this.getTokenUsdValue(tokenInfo.address, cost);

      options.push({
        token: tokenInfo.address,
        symbol: tokenInfo.symbol,
        chainId: tokenInfo.chainId,
        amount: cost,
        amountUsd: usdValue,
        reason: isPreferred ? 'App preferred token' : 'Available with XLP liquidity',
        isPreferred,
        isCrossChain: tokenInfo.chainId !== this.config.chainId,
      });
    }

    // Sort: preferred first, then by USD cost
    options.sort((a, b) => {
      if (a.isPreferred && !b.isPreferred) return -1;
      if (!a.isPreferred && b.isPreferred) return 1;
      return a.amountUsd - b.amountUsd;
    });

    return options;
  }

  /**
   * Get user's token information including XLP liquidity
   */
  private async getUserTokenInfo(user: Address, tokens: Address[]): Promise<TokenInfo[]> {
    const infos: TokenInfo[] = [];

    for (const token of tokens) {
      const [balance, symbol, decimals, isSupported, liquidity] = await Promise.all([
        this.client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [user],
        }) as Promise<bigint>,
        this.client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }) as Promise<string>,
        this.client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }) as Promise<number>,
        this.client.readContract({
          address: this.config.crossChainPaymaster,
          abi: CROSS_CHAIN_PAYMASTER_ABI,
          functionName: 'supportedTokens',
          args: [token],
        }).catch(() => false) as Promise<boolean>,
        this.client.readContract({
          address: this.config.crossChainPaymaster,
          abi: CROSS_CHAIN_PAYMASTER_ABI,
          functionName: 'getTotalLiquidity',
          args: [token],
        }).catch(() => 0n) as Promise<bigint>,
      ]);

      infos.push({
        address: token,
        symbol,
        decimals,
        balance,
        chainId: this.config.chainId,
        hasXLPLiquidity: isSupported && liquidity > 0n,
        xlpLiquidity: liquidity,
      });
    }

    return infos;
  }

  /**
   * Get app preference configuration
   */
  private async getAppPreference(appAddress: Address): Promise<AppPreference | null> {
    if (this.config.appTokenPreference === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const [preference, fallbacks] = await Promise.all([
      this.client.readContract({
        address: this.config.appTokenPreference,
        abi: APP_TOKEN_PREFERENCE_ABI,
        functionName: 'getAppPreference',
        args: [appAddress],
      }).catch(() => null),
      this.client.readContract({
        address: this.config.appTokenPreference,
        abi: APP_TOKEN_PREFERENCE_ABI,
        functionName: 'getAppFallbackTokens',
        args: [appAddress],
      }).catch(() => [] as Address[]),
    ]);

    if (!preference || preference[6] === false) {
      return null;
    }

    return {
      appAddress,
      preferredToken: preference[1] as Address,
      tokenSymbol: preference[2] as string,
      allowFallback: preference[4] as boolean,
      fallbackTokens: fallbacks as Address[],
    };
  }

  /**
   * Find the best payment option considering all factors
   */
  private async findBestOption(
    request: PaymentRequest,
    tokenInfos: TokenInfo[],
    appPreference: AppPreference | null
  ): Promise<PaymentOption | null> {
    // Priority 1: Check if user has app's preferred token
    if (appPreference) {
      const preferredInfo = tokenInfos.find(
        (t) => t.address.toLowerCase() === appPreference.preferredToken.toLowerCase()
      );

      if (preferredInfo && preferredInfo.balance > 0n && preferredInfo.hasXLPLiquidity) {
        const cost = await this.calculateTokenCost(request, preferredInfo.address);
        if (cost !== null && preferredInfo.balance >= cost) {
          return {
            token: preferredInfo.address,
            symbol: preferredInfo.symbol,
            chainId: preferredInfo.chainId,
            amount: cost,
            amountUsd: await this.getTokenUsdValue(preferredInfo.address, cost),
            reason: 'App preferred token',
            isPreferred: true,
            isCrossChain: false,
          };
        }
      }

      // Priority 2: Check fallback tokens
      if (appPreference.allowFallback) {
        for (const fallback of appPreference.fallbackTokens) {
          const fallbackInfo = tokenInfos.find(
            (t) => t.address.toLowerCase() === fallback.toLowerCase()
          );

          if (fallbackInfo && fallbackInfo.balance > 0n && fallbackInfo.hasXLPLiquidity) {
            const cost = await this.calculateTokenCost(request, fallbackInfo.address);
            if (cost !== null && fallbackInfo.balance >= cost) {
              return {
                token: fallbackInfo.address,
                symbol: fallbackInfo.symbol,
                chainId: fallbackInfo.chainId,
                amount: cost,
                amountUsd: await this.getTokenUsdValue(fallbackInfo.address, cost),
                reason: 'App fallback token',
                isPreferred: false,
                isCrossChain: false,
              };
            }
          }
        }
      }
    }

    // Priority 3: Find cheapest available token
    let bestOption: PaymentOption | null = null;
    let lowestUsdCost = Number.MAX_VALUE;

    for (const tokenInfo of tokenInfos) {
      if (tokenInfo.balance === 0n || !tokenInfo.hasXLPLiquidity) continue;

      const cost = await this.calculateTokenCost(request, tokenInfo.address);
      if (cost === null || tokenInfo.balance < cost) continue;

      const usdCost = await this.getTokenUsdValue(tokenInfo.address, cost);

      if (usdCost < lowestUsdCost) {
        lowestUsdCost = usdCost;
        bestOption = {
          token: tokenInfo.address,
          symbol: tokenInfo.symbol,
          chainId: tokenInfo.chainId,
          amount: cost,
          amountUsd: usdCost,
          reason: 'Cheapest available token',
          isPreferred: false,
          isCrossChain: false,
        };
      }
    }

    // Priority 4: Try cross-chain via OIF (if configured)
    if (bestOption === null && this.config.oifAggregator) {
      const crossChainOption = await this.findCrossChainOption(request, tokenInfos);
      if (crossChainOption) {
        return crossChainOption;
      }
    }

    return bestOption;
  }

  /**
   * Find a cross-chain payment option via OIF
   */
  private async findCrossChainOption(
    request: PaymentRequest,
    _localTokens: TokenInfo[]
  ): Promise<PaymentOption | null> {
    if (!this.config.oifAggregator) return null;

    // Get balances from other chains
    const crossChainBalances: TokenInfo[] = [];

    for (const [chainId, client] of this.crossChainClients) {
      // Try to get user's balances on other chains
      // This would query common tokens (ETH, USDC, etc.)
      const commonTokens = this.getCommonTokens(chainId);

      for (const token of commonTokens) {
        const balance = await client.readContract({
          address: token.address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [request.user],
        }).catch(() => 0n) as bigint;

        if (balance > 0n) {
          crossChainBalances.push({
            address: token.address,
            symbol: token.symbol,
            decimals: token.decimals,
            balance,
            chainId,
            hasXLPLiquidity: true, // Assume XLP supports common tokens
            xlpLiquidity: 0n,
          });
        }
      }
    }

    // Find best cross-chain option
    let bestCrossChain: PaymentOption | null = null;
    let lowestCost = Number.MAX_VALUE;

    for (const tokenInfo of crossChainBalances) {
      // Query OIF for route cost
      const routeQuote = await this.getOIFRouteQuote(
        tokenInfo.chainId,
        this.config.chainId,
        tokenInfo.address,
        request.amount
      );

      if (!routeQuote) continue;

      const totalCost = routeQuote.inputAmount + routeQuote.fee;
      if (tokenInfo.balance < totalCost) continue;

      const usdCost = await this.getTokenUsdValue(tokenInfo.address, totalCost);

      if (usdCost < lowestCost) {
        lowestCost = usdCost;
        bestCrossChain = {
          token: tokenInfo.address,
          symbol: tokenInfo.symbol,
          chainId: tokenInfo.chainId,
          amount: totalCost,
          amountUsd: usdCost,
          reason: `Cross-chain from ${this.getChainName(tokenInfo.chainId)}`,
          isPreferred: false,
          isCrossChain: true,
          route: `${this.getChainName(tokenInfo.chainId)} → ${this.getChainName(this.config.chainId)}`,
        };
      }
    }

    return bestCrossChain;
  }

  /**
   * Get OIF route quote
   */
  private async getOIFRouteQuote(
    sourceChain: number,
    destChain: number,
    token: Address,
    amount: bigint
  ): Promise<{ inputAmount: bigint; outputAmount: bigint; fee: bigint } | null> {
    if (!this.config.oifAggregator) return null;

    const url = `${this.config.oifAggregator}/api/v1/quotes`;
    const body = {
      sourceChain,
      destinationChain: destChain,
      sourceToken: token,
      destinationToken: '0x0000000000000000000000000000000000000000', // ETH
      amount: amount.toString(),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (!response?.ok) return null;

    const quotes = await response.json().catch(() => []);
    if (quotes.length === 0) return null;

    // Return the best quote
    const best = quotes[0];
    return {
      inputAmount: BigInt(best.inputAmount),
      outputAmount: BigInt(best.outputAmount),
      fee: BigInt(best.fee),
    };
  }

  /**
   * Get common tokens for a chain (uses shared chain config from multi-chain-discovery)
   */
  private getCommonTokens(chainId: number): Array<{ address: Address; symbol: string; decimals: number }> {
    // Import-free inline config to avoid circular dependency
    // These match the tokens in multi-chain-discovery.ts
    const COMMON_TOKENS: Record<number, Array<{ address: Address; symbol: string; decimals: number }>> = {
      1: [
        { address: '0x0000000000000000000000000000000000000000' as Address, symbol: 'ETH', decimals: 18 },
        { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, symbol: 'USDC', decimals: 6 },
      ],
      42161: [
        { address: '0x0000000000000000000000000000000000000000' as Address, symbol: 'ETH', decimals: 18 },
        { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address, symbol: 'USDC', decimals: 6 },
      ],
      10: [
        { address: '0x0000000000000000000000000000000000000000' as Address, symbol: 'ETH', decimals: 18 },
        { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as Address, symbol: 'USDC', decimals: 6 },
      ],
      8453: [
        { address: '0x0000000000000000000000000000000000000000' as Address, symbol: 'ETH', decimals: 18 },
        { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address, symbol: 'USDC', decimals: 6 },
      ],
    };
    return COMMON_TOKENS[chainId] || [];
  }

  /**
   * Get human-readable chain name
   */
  private getChainName(chainId: number): string {
    const CHAIN_NAMES: Record<number, string> = {
      1: 'Ethereum',
      42161: 'Arbitrum',
      10: 'Optimism',
      8453: 'Base',
      420691: 'Jeju',
      420690: 'Jeju Testnet',
      11155111: 'Sepolia',
    };
    return CHAIN_NAMES[chainId] || `Chain ${chainId}`;
  }

  /**
   * Calculate token cost for a payment
   */
  private async calculateTokenCost(request: PaymentRequest, token: Address): Promise<bigint | null> {
    if (request.isGasPayment) {
      // For gas payments, use the paymaster's preview function
      const gasEstimate = 150000n; // Default gas estimate
      const gasPrice = await this.client.getGasPrice();

      const cost = await this.client.readContract({
        address: this.config.crossChainPaymaster,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'previewTokenCost',
        args: [gasEstimate, gasPrice, token],
      }).catch(() => null);

      return cost as bigint | null;
    } else {
      // For service payments, convert the amount using oracle
      if (this.config.priceOracle === '0x0000000000000000000000000000000000000000') {
        return request.amount;
      }

      const converted = await this.client.readContract({
        address: this.config.priceOracle,
        abi: PRICE_ORACLE_ABI,
        functionName: 'convertAmount',
        args: ['0x0000000000000000000000000000000000000000' as Address, token, request.amount],
      }).catch(() => null);

      return converted as bigint | null;
    }
  }

  /**
   * Get USD value of a token amount
   */
  private async getTokenUsdValue(token: Address, amount: bigint): Promise<number> {
    if (this.config.priceOracle === '0x0000000000000000000000000000000000000000') {
      return Number(formatUnits(amount, 18));
    }

    const result = await this.client.readContract({
      address: this.config.priceOracle,
      abi: PRICE_ORACLE_ABI,
      functionName: 'getPrice',
      args: [token],
    }).catch(() => [0n, 18n] as [bigint, bigint]);

    const [price, decimals] = result;
    const tokenDecimals = await this.client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }).catch(() => 18);

    return (Number(amount) / 10 ** tokenDecimals) * (Number(price) / 10 ** Number(decimals));
  }

  /**
   * Check if user needs to approve token spending
   */
  async needsApproval(user: Address, token: Address, amount: bigint): Promise<boolean> {
    const allowance = await this.client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [user, this.config.crossChainPaymaster],
    }) as bigint;

    return allowance < amount;
  }

  /**
   * Build paymasterAndData for a payment
   */
  buildPaymasterData(paymentOption: PaymentOption, appAddress: Address): `0x${string}` {
    const paymaster = this.config.crossChainPaymaster;
    const verificationGasLimit = 150000n;
    const postOpGasLimit = 100000n;

    let data = paymaster.slice(2).toLowerCase();
    data += verificationGasLimit.toString(16).padStart(32, '0');
    data += postOpGasLimit.toString(16).padStart(32, '0');
    data += '00'; // mode = 0 for token payment
    data += paymentOption.token.slice(2).toLowerCase();
    data += appAddress.slice(2).toLowerCase();

    return `0x${data}` as `0x${string}`;
  }
}

// ============ Factory Functions ============

export function createTokenPaymentRouter(config: Partial<PaymentRouterConfig>): TokenPaymentRouter {
  const fullConfig: PaymentRouterConfig = {
    chainId: config.chainId || 420691,
    rpcUrl: config.rpcUrl || process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    crossChainPaymaster: (config.crossChainPaymaster ||
      process.env.CROSS_CHAIN_PAYMASTER_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
    appTokenPreference: (config.appTokenPreference ||
      process.env.APP_TOKEN_PREFERENCE_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
    tokenRegistry: (config.tokenRegistry ||
      process.env.TOKEN_REGISTRY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
    priceOracle: (config.priceOracle ||
      process.env.PRICE_ORACLE_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
    oifAggregator: config.oifAggregator || process.env.OIF_AGGREGATOR_URL,
  };

  return new TokenPaymentRouter(fullConfig);
}

/**
 * Quick helper: Get the best way for a user to pay
 */
export async function findBestPaymentMethod(
  appAddress: Address,
  user: Address,
  amount: bigint,
  userTokens: Address[],
  isGasPayment: boolean = true
): Promise<PaymentOption | null> {
  const router = createTokenPaymentRouter({});

  return router.getBestPaymentOption(
    {
      appAddress,
      user,
      amount,
      isGasPayment,
    },
    userTokens
  );
}

// ============ Simple API (from jeju-payment.ts) ============

/**
 * Quick one-liner to find the best payment option
 */
export async function findBestPayment(
  appAddress: Address,
  user: Address,
  amount: bigint,
  userTokens?: Address[]
): Promise<PaymentOption | null> {
  const router = createTokenPaymentRouter({});
  const tokens = userTokens || [];
  return router.getBestPaymentOption({ appAddress, user, amount, isGasPayment: true }, tokens);
}

/**
 * Format a payment option for display
 */
export function formatPaymentOption(option: PaymentOption): string {
  const crossChain = option.isCrossChain ? ` (from ${option.route})` : '';
  const preferred = option.isPreferred ? ' ⭐' : '';
  return `${option.symbol}: ${formatUnits(option.amount, 18)} (~$${option.amountUsd.toFixed(2)})${preferred}${crossChain}`;
}

// ============ Global State Management (from payment-hooks.ts) ============

let globalRouter: TokenPaymentRouter | null = null;
let globalUserAddress: Address | null = null;
let globalUserTokens: Address[] = [];
// @ts-expect-error - Global chain ID stored for future use
let globalChainId: number = 420691;

/**
 * Initialize the payment system (call once at app startup)
 */
export function initializePayment(config: Partial<PaymentRouterConfig> = {}): TokenPaymentRouter {
  globalRouter = createTokenPaymentRouter(config);
  globalChainId = config.chainId || 420691;
  return globalRouter;
}

/**
 * Set the current user address
 */
export function setUser(address: Address | null): void {
  globalUserAddress = address;
}

/**
 * Set user's known tokens
 */
export function setUserTokens(tokens: Address[]): void {
  globalUserTokens = tokens;
}

/**
 * Add cross-chain support
 */
export function addChain(chainId: number, rpcUrl: string): void {
  globalRouter?.addCrossChainClient(chainId, rpcUrl);
}

/**
 * Get the best payment option using global state
 */
export async function getBestPaymentOption(
  appAddress: Address,
  amount: bigint,
  isGasPayment: boolean = true
): Promise<PaymentOption | null> {
  if (!globalRouter || !globalUserAddress) {
    throw new Error('Payment system not initialized. Call initializePayment() first.');
  }

  return globalRouter.getBestPaymentOption(
    { appAddress, user: globalUserAddress, amount, isGasPayment },
    globalUserTokens
  );
}

/**
 * Get all available payment options using global state
 */
export async function getAllPaymentOptions(
  appAddress: Address,
  amount: bigint,
  isGasPayment: boolean = true
): Promise<PaymentOption[]> {
  if (!globalRouter || !globalUserAddress) {
    throw new Error('Payment system not initialized. Call initializePayment() first.');
  }

  return globalRouter.getAllPaymentOptions(
    { appAddress, user: globalUserAddress, amount, isGasPayment },
    globalUserTokens
  );
}

/**
 * Build paymaster data using global router
 */
export function buildPaymasterData(option: PaymentOption, appAddress: Address): `0x${string}` {
  if (!globalRouter) {
    throw new Error('Payment system not initialized.');
  }
  return globalRouter.buildPaymasterData(option, appAddress);
}

/**
 * Check approval using global state
 */
export async function checkApproval(option: PaymentOption): Promise<boolean> {
  if (!globalRouter || !globalUserAddress) {
    throw new Error('Payment system not initialized.');
  }
  return globalRouter.needsApproval(globalUserAddress, option.token, option.amount);
}

/**
 * Get payment options formatted for UI display
 */
export async function getFormattedPaymentOptions(
  appAddress: Address,
  amount: bigint
): Promise<Array<{ label: string; value: PaymentOption }>> {
  const options = await getAllPaymentOptions(appAddress, amount, true);
  return options.map((option) => ({
    label: formatPaymentOption(option),
    value: option,
  }));
}
