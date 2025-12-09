/**
 * Gas Intent Router
 * 
 * Selects the optimal token for gas payment based on:
 * 1. User's wallet balances
 * 2. Available paymaster liquidity
 * 3. Token/ETH exchange rates
 * 4. Gas costs
 * 
 * This enables users to pay gas in any token they hold
 * while choosing the most cost-effective option.
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
}

// ============ ABIs ============

const PAYMASTER_FACTORY_ABI = parseAbi([
  'function getAllPaymasters() view returns (address[])',
  'function getPaymasterInfo(address paymaster) view returns (address token, uint256 stakedEth, bool isActive)',
]);

const PAYMASTER_ABI = parseAbi([
  'function token() view returns (address)',
  'function getQuote(uint256 ethAmount) view returns (uint256)',
  'function availableLiquidity() view returns (uint256)',
]);

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
]);

const PRICE_ORACLE_ABI = parseAbi([
  'function getPrice(address token) view returns (uint256 price, uint8 decimals)',
  'function getETHPrice() view returns (uint256)',
]);

// ============ Core Router ============

export class GasIntentRouter {
  private client: ReturnType<typeof createPublicClient>;
  private config: RouterConfig;

  constructor(config: RouterConfig) {
    this.config = config;
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    });
  }

  /**
   * Get all user token balances that could be used for gas
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
        });
      }
    }

    // Sort by USD value (highest first)
    return balances.sort((a, b) => b.usdValue - a.usdValue);
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
        ? (quote * 10n ** 18n) / gasEstimate.ethCost 
        : 0n;
      
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
      });
    }

    return options;
  }

  /**
   * Select the best gas payment option for a user
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
    const [userBalances, paymasterOptions] = await Promise.all([
      this.getUserTokenBalances(userAddress, supportedTokens),
      this.getPaymasterOptions(gasEstimate),
    ]);

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
  };

  return new GasIntentRouter(fullConfig);
}

// ============ Utility Functions ============

/**
 * Format a paymaster option for display
 */
export function formatPaymasterOption(option: PaymasterOption): string {
  return `${option.tokenSymbol}: ~$${option.estimatedCostUsd.toFixed(4)} ${option.isRecommended ? '(Recommended)' : ''}`;
}

/**
 * Generate paymasterAndData for a selected option
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

