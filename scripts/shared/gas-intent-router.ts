/**
 * Gas Intent Router
 * 
 * Selects the optimal token for gas payment based on:
 * 1. User's wallet balances across ALL chains
 * 2. Available XLP liquidity on CrossChainPaymaster
 * 3. Token/ETH exchange rates from price oracle
 * 4. Gas costs on target chain
 * 5. Cross-chain availability via EIL
 * 
 * This enables users to pay gas with ANY token in their wallet,
 * on ANY chain, choosing the most cost-effective option automatically.
 * No bridging required - XLPs handle cross-chain liquidity.
 */

import { createPublicClient, http, parseAbi, formatEther, formatUnits, Address } from 'viem';

// ============ Types ============

export interface TokenBalance {
  address: Address;
  symbol: string;
  name: string;
  balance: bigint;
  decimals: number;
  usdValue: number;
  chainId: number;
}

export interface CrossChainTokenInfo {
  localAddress: Address;
  remoteAddress: Address;
  chainId: number;
  liquidity: bigint;
  isActive: boolean;
}

export interface PaymasterOption {
  paymasterAddress: Address;
  tokenAddress: Address;
  tokenSymbol: string;
  availableLiquidity: bigint;
  exchangeRate: bigint; // tokens per ETH (scaled by 1e18)
  estimatedCost: bigint;
  estimatedCostUsd: number;
  isRecommended: boolean;
  reason: string;
  chainId: number;
  isCrossChain: boolean;
}

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  ethCost: bigint;
  ethCostUsd: number;
}

export interface RouterConfig {
  rpcUrl: string;
  chainId: number;
  paymasterFactoryAddress: Address;
  priceOracleAddress: Address;
  crossChainPaymasterAddress: Address;
  tokenRegistryAddress: Address;
}

export interface CrossChainRouterConfig {
  chains: {
    chainId: number;
    rpcUrl: string;
    crossChainPaymaster: Address;
  }[];
}

// ============ ABIs ============

const PAYMASTER_FACTORY_ABI = parseAbi([
  'function getAllPaymasters() view returns (address[])',
  'function getPaymasterInfo(address paymaster) view returns (address token, uint256 stakedEth, bool isActive)',
  'function getCrossChainPaymaster() view returns (address)',
]);

const PAYMASTER_ABI = parseAbi([
  'function token() view returns (address)',
  'function getQuote(uint256 ethAmount) view returns (uint256)',
  'function availableLiquidity() view returns (uint256)',
]);

const CROSS_CHAIN_PAYMASTER_ABI = parseAbi([
  'function supportedTokens(address token) view returns (bool)',
  'function getTotalLiquidity(address token) view returns (uint256)',
  'function previewTokenCost(uint256 estimatedGas, uint256 gasPrice, address token) view returns (uint256)',
  'function getBestGasToken(address user, uint256 gasCostETH, address[] tokens) view returns (address bestToken, uint256 tokenCost)',
  'function canSponsor(uint256 gasCost, address paymentToken, address userAddress) view returns (bool canSponsor, uint256 tokenCost, uint256 userBalance)',
  'function getPaymasterStatus() view returns (uint256 ethLiquidity, uint256 entryPointBalance, uint256 supportedTokenCount, uint256 totalGasFees, bool oracleSet)',
  'function tokenExchangeRates(address token) view returns (uint256)',
]);

const TOKEN_REGISTRY_ABI = parseAbi([
  'function getTokenCrossChainInfo(address token) view returns (uint256[] chainIds, uint256[] liquidity)',
  'function findBestChainForGas(address token, uint256 requiredLiquidity) view returns (uint256 bestChainId, uint256 availableLiquidity)',
  'function getSupportedChains() view returns (uint256[])',
  'function getCrossChainConfig(address token, uint256 chainId) view returns ((uint256 chainId, address tokenAddress, address paymasterAddress, uint256 liquidity, bool isActive))',
]);

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

const PRICE_ORACLE_ABI = parseAbi([
  'function getPrice(address token) view returns (uint256 price, uint8 decimals)',
  'function getETHPrice() view returns (uint256)',
  'function convertAmount(address fromToken, address toToken, uint256 amount) view returns (uint256)',
]);

// ============ Core Router ============

export class GasIntentRouter {
  private client: ReturnType<typeof createPublicClient>;
  private config: RouterConfig;
  private crossChainClients: Map<number, ReturnType<typeof createPublicClient>> = new Map();

  constructor(config: RouterConfig) {
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
   * Get all user token balances that could be used for gas (single chain)
   */
  async getUserTokenBalances(userAddress: Address, tokenAddresses: Address[]): Promise<TokenBalance[]> {
    const balances: TokenBalance[] = [];

    for (const tokenAddress of tokenAddresses) {
      const [balance, symbol, name, decimals] = await Promise.all([
        this.client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [userAddress],
        }) as Promise<bigint>,
        this.client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }) as Promise<string>,
        this.client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'name',
        }) as Promise<string>,
        this.client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }) as Promise<number>,
      ]);

      if (balance > 0n) {
        const usdValue = await this.getTokenUsdValue(tokenAddress, balance, decimals);
        balances.push({
          address: tokenAddress,
          symbol,
          name,
          balance,
          decimals,
          usdValue,
          chainId: this.config.chainId,
        });
      }
    }

    // Sort by USD value (highest first)
    return balances.sort((a, b) => b.usdValue - a.usdValue);
  }

  /**
   * Get user token balances across ALL configured chains
   */
  async getMultiChainBalances(
    userAddress: Address, 
    tokensByChain: Map<number, Address[]>
  ): Promise<TokenBalance[]> {
    const allBalances: TokenBalance[] = [];

    // Get balances from main chain
    const mainTokens = tokensByChain.get(this.config.chainId) || [];
    if (mainTokens.length > 0) {
      const mainBalances = await this.getUserTokenBalances(userAddress, mainTokens);
      allBalances.push(...mainBalances);
    }

    // Get balances from cross-chain clients
    for (const [chainId, client] of this.crossChainClients) {
      const tokens = tokensByChain.get(chainId) || [];
      if (tokens.length === 0) continue;

      for (const tokenAddress of tokens) {
        const [balance, symbol, name, decimals] = await Promise.all([
          client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [userAddress],
          }) as Promise<bigint>,
          client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'symbol',
          }) as Promise<string>,
          client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'name',
          }) as Promise<string>,
          client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'decimals',
          }) as Promise<number>,
        ]).catch(() => [0n, '', '', 18] as [bigint, string, string, number]);

        if (balance > 0n) {
          const usdValue = await this.getTokenUsdValue(tokenAddress, balance, decimals);
          allBalances.push({
            address: tokenAddress,
            symbol,
            name,
            balance,
            decimals,
            usdValue,
            chainId,
          });
        }
      }
    }

    return allBalances.sort((a, b) => b.usdValue - a.usdValue);
  }

  /**
   * Get available gas payment options from CrossChainPaymaster
   */
  async getCrossChainPaymasterOptions(gasEstimate: GasEstimate, supportedTokens: Address[]): Promise<PaymasterOption[]> {
    const options: PaymasterOption[] = [];

    if (this.config.crossChainPaymasterAddress === '0x0000000000000000000000000000000000000000') {
      return options;
    }

    for (const token of supportedTokens) {
      const [isSupported, liquidity, tokenCost, exchangeRate] = await Promise.all([
        this.client.readContract({
          address: this.config.crossChainPaymasterAddress,
          abi: CROSS_CHAIN_PAYMASTER_ABI,
          functionName: 'supportedTokens',
          args: [token],
        }) as Promise<boolean>,
        this.client.readContract({
          address: this.config.crossChainPaymasterAddress,
          abi: CROSS_CHAIN_PAYMASTER_ABI,
          functionName: 'getTotalLiquidity',
          args: [token],
        }).catch(() => 0n) as Promise<bigint>,
        this.client.readContract({
          address: this.config.crossChainPaymasterAddress,
          abi: CROSS_CHAIN_PAYMASTER_ABI,
          functionName: 'previewTokenCost',
          args: [gasEstimate.gasLimit, gasEstimate.gasPrice, token],
        }).catch(() => gasEstimate.ethCost) as Promise<bigint>,
        this.client.readContract({
          address: this.config.crossChainPaymasterAddress,
          abi: CROSS_CHAIN_PAYMASTER_ABI,
          functionName: 'tokenExchangeRates',
          args: [token],
        }).catch(() => 10n ** 18n) as Promise<bigint>,
      ]);

      if (!isSupported) continue;

      const [symbol] = await Promise.all([
        this.client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }) as Promise<string>,
      ]);

      const estimatedCostUsd = await this.getTokenUsdValue(token, tokenCost, 18);

      options.push({
        paymasterAddress: this.config.crossChainPaymasterAddress,
        tokenAddress: token,
        tokenSymbol: symbol,
        availableLiquidity: liquidity,
        exchangeRate,
        estimatedCost: tokenCost,
        estimatedCostUsd,
        isRecommended: false,
        reason: '',
        chainId: this.config.chainId,
        isCrossChain: true,
      });
    }

    return options;
  }

  /**
   * Get available paymaster options
   */
  async getPaymasterOptions(gasEstimate: GasEstimate): Promise<PaymasterOption[]> {
    const options: PaymasterOption[] = [];
    
    if (this.config.paymasterFactoryAddress === '0x0000000000000000000000000000000000000000') {
      return options;
    }

    const paymasters = await this.client.readContract({
      address: this.config.paymasterFactoryAddress,
      abi: PAYMASTER_FACTORY_ABI,
      functionName: 'getAllPaymasters',
    }) as Address[];

    for (const paymasterAddr of paymasters) {
      const [token, stakedEth, isActive] = await this.client.readContract({
        address: this.config.paymasterFactoryAddress,
        abi: PAYMASTER_FACTORY_ABI,
        functionName: 'getPaymasterInfo',
        args: [paymasterAddr],
      }) as [Address, bigint, boolean];

      if (!isActive) continue;

      const [symbol, liquidity, quote] = await Promise.all([
        this.client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }) as Promise<string>,
        this.client.readContract({
          address: paymasterAddr,
          abi: PAYMASTER_ABI,
          functionName: 'availableLiquidity',
        }).catch(() => stakedEth) as Promise<bigint>,
        this.client.readContract({
          address: paymasterAddr,
          abi: PAYMASTER_ABI,
          functionName: 'getQuote',
          args: [gasEstimate.ethCost],
        }) as Promise<bigint>,
      ]);

      // Calculate exchange rate and USD cost
      const exchangeRate = gasEstimate.ethCost > 0n 
        ? (quote * BigInt(10 ** 18)) / gasEstimate.ethCost 
        : BigInt(0);
      
      const estimatedCostUsd = await this.getTokenUsdValue(token, quote, 18);

      options.push({
        paymasterAddress: paymasterAddr,
        tokenAddress: token,
        tokenSymbol: symbol,
        availableLiquidity: liquidity,
        exchangeRate,
        estimatedCost: quote,
        estimatedCostUsd,
        isRecommended: false,
        reason: '',
        chainId: this.config.chainId,
        isCrossChain: false,
      });
    }

    return options;
  }

  /**
   * Select the best gas payment option for a user (single chain)
   */
  async selectOptimalPayment(
    userAddress: Address,
    gasEstimate: GasEstimate,
    supportedTokens: Address[]
  ): Promise<{
    recommendation: PaymasterOption | null;
    alternatives: PaymasterOption[];
    userBalances: TokenBalance[];
  }> {
    // Get user balances and paymaster options in parallel
    const [userBalances, legacyOptions, crossChainOptions] = await Promise.all([
      this.getUserTokenBalances(userAddress, supportedTokens),
      this.getPaymasterOptions(gasEstimate),
      this.getCrossChainPaymasterOptions(gasEstimate, supportedTokens),
    ]);

    // Merge all options
    const paymasterOptions = [...legacyOptions, ...crossChainOptions];

    // Filter to options where user has sufficient balance
    const viableOptions = paymasterOptions.filter(option => {
      const userBalance = userBalances.find(
        b => b.address.toLowerCase() === option.tokenAddress.toLowerCase()
      );
      return userBalance && userBalance.balance >= option.estimatedCost;
    });

    // Score each option
    const scoredOptions = viableOptions.map(option => {
      const userBalance = userBalances.find(
        b => b.address.toLowerCase() === option.tokenAddress.toLowerCase()
      )!;

      // Scoring factors:
      // 1. Lower USD cost is better (weight: 40%)
      // 2. Higher liquidity ratio is better (weight: 30%)  
      // 3. User has more of this token (weight: 30%)
      
      const costScore = 100 - Math.min(option.estimatedCostUsd * 100, 100);
      const liquidityRatio = Number(option.availableLiquidity) / Number(option.estimatedCost);
      const liquidityScore = Math.min(liquidityRatio * 10, 100);
      const balanceRatio = Number(userBalance.balance) / Number(option.estimatedCost);
      const balanceScore = Math.min(balanceRatio * 10, 100);

      const totalScore = costScore * 0.4 + liquidityScore * 0.3 + balanceScore * 0.3;

      return {
        ...option,
        score: totalScore,
        reason: this.generateReason(option, userBalance, liquidityRatio),
      };
    });

    // Sort by score
    scoredOptions.sort((a, b) => b.score - a.score);

    // Mark recommendation
    if (scoredOptions.length > 0) {
      scoredOptions[0].isRecommended = true;
    }

    return {
      recommendation: scoredOptions[0] || null,
      alternatives: scoredOptions.slice(1),
      userBalances,
    };
  }

  /**
   * Select the best gas payment option across ALL chains
   * @description Finds the cheapest way to pay gas using tokens from any chain
   */
  async selectBestCrossChainPayment(
    userAddress: Address,
    gasEstimate: GasEstimate,
    tokensByChain: Map<number, Address[]>
  ): Promise<{
    recommendation: PaymasterOption | null;
    alternatives: PaymasterOption[];
    userBalances: TokenBalance[];
    requiresBridge: boolean;
  }> {
    // Get all balances across chains
    const allBalances = await this.getMultiChainBalances(userAddress, tokensByChain);

    // Get options from cross-chain paymaster
    const mainChainTokens = tokensByChain.get(this.config.chainId) || [];
    const crossChainOptions = await this.getCrossChainPaymasterOptions(gasEstimate, mainChainTokens);

    // For each cross-chain token, check if user has balance on ANY chain
    const viableOptions: Array<PaymasterOption & { score: number; sourceChainId: number }> = [];

    for (const option of crossChainOptions) {
      // Find user's best balance for this token across all chains
      const tokenBalances = allBalances.filter(
        b => b.symbol === option.tokenSymbol || 
             b.address.toLowerCase() === option.tokenAddress.toLowerCase()
      );

      for (const balance of tokenBalances) {
        if (balance.balance >= option.estimatedCost) {
          const costScore = 100 - Math.min(option.estimatedCostUsd * 100, 100);
          const liquidityRatio = Number(option.availableLiquidity) / Number(option.estimatedCost);
          const liquidityScore = Math.min(liquidityRatio * 10, 100);
          const balanceRatio = Number(balance.balance) / Number(option.estimatedCost);
          const balanceScore = Math.min(balanceRatio * 10, 100);

          // Penalty for cross-chain (requires bridging/XLP)
          const crossChainPenalty = balance.chainId !== this.config.chainId ? 10 : 0;

          const totalScore = costScore * 0.4 + liquidityScore * 0.3 + balanceScore * 0.3 - crossChainPenalty;

          viableOptions.push({
            ...option,
            score: totalScore,
            sourceChainId: balance.chainId,
            reason: balance.chainId !== this.config.chainId 
              ? `Cross-chain from ${balance.chainId}` 
              : this.generateReason(option, balance, liquidityRatio),
            isCrossChain: balance.chainId !== this.config.chainId,
          });
        }
      }
    }

    // Sort by score
    viableOptions.sort((a, b) => b.score - a.score);

    if (viableOptions.length > 0) {
      viableOptions[0].isRecommended = true;
    }

    const recommendation = viableOptions[0] || null;
    const requiresBridge = recommendation?.sourceChainId !== this.config.chainId;

    return {
      recommendation,
      alternatives: viableOptions.slice(1),
      userBalances: allBalances,
      requiresBridge,
    };
  }

  /**
   * Quick check: Can user pay gas with ANY of their tokens?
   */
  async canPayGas(userAddress: Address, gasEstimate: GasEstimate, supportedTokens: Address[]): Promise<{
    canPay: boolean;
    bestOption: PaymasterOption | null;
  }> {
    const result = await this.selectOptimalPayment(userAddress, gasEstimate, supportedTokens);
    return {
      canPay: result.recommendation !== null,
      bestOption: result.recommendation,
    };
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(
    to: Address,
    data: `0x${string}`,
    value: bigint = 0n
  ): Promise<GasEstimate> {
    const [gasLimit, gasPrice, ethPrice] = await Promise.all([
      this.client.estimateGas({
        to,
        data,
        value,
      }),
      this.client.getGasPrice(),
      this.getETHPrice(),
    ]);

    const ethCost = gasLimit * gasPrice;
    const ethCostUsd = Number(formatEther(ethCost)) * ethPrice;

    return {
      gasLimit,
      gasPrice,
      ethCost,
      ethCostUsd,
    };
  }

  // ============ Helper Functions ============

  private async getTokenUsdValue(
    tokenAddress: Address,
    amount: bigint,
    decimals: number
  ): Promise<number> {
    if (this.config.priceOracleAddress === '0x0000000000000000000000000000000000000000') {
      return 0;
    }

    const [price, priceDecimals] = await this.client.readContract({
      address: this.config.priceOracleAddress,
      abi: PRICE_ORACLE_ABI,
      functionName: 'getPrice',
      args: [tokenAddress],
    }).catch(() => [0n, 8]) as [bigint, number];

    const tokenAmount = Number(formatUnits(amount, decimals));
    const tokenPrice = Number(price) / 10 ** priceDecimals;

    return tokenAmount * tokenPrice;
  }

  private async getETHPrice(): Promise<number> {
    if (this.config.priceOracleAddress === '0x0000000000000000000000000000000000000000') {
      return 3000; // Default fallback
    }

    const ethPrice = await this.client.readContract({
      address: this.config.priceOracleAddress,
      abi: PRICE_ORACLE_ABI,
      functionName: 'getETHPrice',
    }).catch(() => 3000n * 10n ** 8n) as bigint;

    return Number(ethPrice) / 10 ** 8;
  }

  private generateReason(
    option: PaymasterOption,
    userBalance: TokenBalance,
    liquidityRatio: number
  ): string {
    const reasons: string[] = [];

    if (option.estimatedCostUsd < 0.10) {
      reasons.push('Low cost');
    }

    if (liquidityRatio > 100) {
      reasons.push('High liquidity');
    }

    const balanceRatio = Number(userBalance.balance) / Number(option.estimatedCost);
    if (balanceRatio > 10) {
      reasons.push('Sufficient balance');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'Available option';
  }
}

// ============ Factory Function ============

export function createGasRouter(config: Partial<RouterConfig> = {}): GasIntentRouter {
  const fullConfig: RouterConfig = {
    rpcUrl: config.rpcUrl || process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    chainId: config.chainId || 1337,
    paymasterFactoryAddress: (config.paymasterFactoryAddress || 
      process.env.PAYMASTER_FACTORY_ADDRESS || 
      '0x0000000000000000000000000000000000000000') as Address,
    priceOracleAddress: (config.priceOracleAddress || 
      process.env.PRICE_ORACLE_ADDRESS || 
      '0x0000000000000000000000000000000000000000') as Address,
    crossChainPaymasterAddress: (config.crossChainPaymasterAddress ||
      process.env.CROSS_CHAIN_PAYMASTER_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
    tokenRegistryAddress: (config.tokenRegistryAddress ||
      process.env.TOKEN_REGISTRY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
  };

  return new GasIntentRouter(fullConfig);
}

/**
 * Create a multi-chain gas router with configured cross-chain clients
 */
export function createMultiChainGasRouter(
  mainConfig: Partial<RouterConfig>,
  crossChainConfig: CrossChainRouterConfig
): GasIntentRouter {
  const router = createGasRouter(mainConfig);

  for (const chain of crossChainConfig.chains) {
    router.addCrossChainClient(chain.chainId, chain.rpcUrl);
  }

  return router;
}

// ============ Utility Functions ============

/**
 * Format a paymaster option for display
 */
export function formatPaymasterOption(option: PaymasterOption): string {
  return `${option.tokenSymbol}: ~$${option.estimatedCostUsd.toFixed(4)} ${option.isRecommended ? '(Recommended)' : ''}`;
}

/**
 * Generate paymasterAndData for a selected option (legacy format)
 */
export function generatePaymasterData(
  paymasterAddress: Address,
  tokenAddress: Address,
  maxTokenAmount: bigint,
  serviceName: string = ''
): `0x${string}` {
  // Format: [paymaster(20)][verificationGasLimit(16)][postOpGasLimit(16)][serviceName length(1)][serviceName][token index(1)]
  const verificationGasLimit = 100000n;
  const postOpGasLimit = 50000n;
  
  const serviceNameBytes = new TextEncoder().encode(serviceName);
  const serviceNameLength = serviceNameBytes.length;
  
  // Simple encoding: paymaster + gas limits + service name + max token amount
  let data = paymasterAddress.slice(2);
  data += verificationGasLimit.toString(16).padStart(32, '0');
  data += postOpGasLimit.toString(16).padStart(32, '0');
  data += serviceNameLength.toString(16).padStart(2, '0');
  data += Buffer.from(serviceNameBytes).toString('hex');
  data += tokenAddress.slice(2);
  data += maxTokenAmount.toString(16).padStart(64, '0');
  
  return `0x${data}` as `0x${string}`;
}

/**
 * Generate paymasterAndData for CrossChainPaymaster (token payment mode)
 * Format: [paymaster(20)][verificationGas(16)][postOpGas(16)][mode(1)][token(20)][appAddress(20)]
 */
export function generateCrossChainPaymasterData(
  paymasterAddress: Address,
  tokenAddress: Address,
  appAddress: Address,
  verificationGasLimit: bigint = 150000n,
  postOpGasLimit: bigint = 100000n
): `0x${string}` {
  let data = paymasterAddress.slice(2).toLowerCase();
  data += verificationGasLimit.toString(16).padStart(32, '0');
  data += postOpGasLimit.toString(16).padStart(32, '0');
  data += '00'; // mode = 0 for token payment
  data += tokenAddress.slice(2).toLowerCase();
  data += appAddress.slice(2).toLowerCase();
  
  return `0x${data}` as `0x${string}`;
}

/**
 * Generate paymasterAndData for voucher mode (cross-chain transfers)
 * Format: [paymaster(20)][verificationGas(16)][postOpGas(16)][mode(1)][voucherId(32)][xlp(20)]
 */
export function generateVoucherPaymasterData(
  paymasterAddress: Address,
  voucherId: `0x${string}`,
  xlpAddress: Address,
  verificationGasLimit: bigint = 150000n,
  postOpGasLimit: bigint = 100000n
): `0x${string}` {
  let data = paymasterAddress.slice(2).toLowerCase();
  data += verificationGasLimit.toString(16).padStart(32, '0');
  data += postOpGasLimit.toString(16).padStart(32, '0');
  data += '01'; // mode = 1 for voucher
  data += voucherId.slice(2);
  data += xlpAddress.slice(2).toLowerCase();
  
  return `0x${data}` as `0x${string}`;
}

/**
 * Parse paymasterAndData to determine payment mode and details
 */
export function parsePaymasterData(paymasterAndData: `0x${string}`): {
  paymasterAddress: Address;
  mode: 'token' | 'voucher';
  tokenAddress?: Address;
  appAddress?: Address;
  voucherId?: `0x${string}`;
  xlpAddress?: Address;
} {
  const data = paymasterAndData.slice(2);
  const paymasterAddress = `0x${data.slice(0, 40)}` as Address;
  const mode = data.slice(104, 106) === '00' ? 'token' : 'voucher';

  if (mode === 'token') {
    return {
      paymasterAddress,
      mode,
      tokenAddress: `0x${data.slice(106, 146)}` as Address,
      appAddress: `0x${data.slice(146, 186)}` as Address,
    };
  } else {
    return {
      paymasterAddress,
      mode,
      voucherId: `0x${data.slice(106, 170)}` as `0x${string}`,
      xlpAddress: `0x${data.slice(170, 210)}` as Address,
    };
  }
}

