/**
 * DeFi Module - Swaps, liquidity, launchpad
 */

import {
  type Address,
  type Hex,
  encodeFunctionData,
  getContract,
  erc20Abi,
} from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import {
  getContract as getContractAddress,
  getServicesConfig,
} from "../config";

export interface Token {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

export interface SwapQuote {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
  priceImpact: number;
  route: Address[];
  fee: bigint;
}

export interface SwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  slippageBps?: number; // Default 50 = 0.5%
}

export interface PoolInfo {
  poolId: Hex;
  token0: Token;
  token1: Token;
  fee: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
}

export interface AddLiquidityParams {
  token0: Address;
  token1: Address;
  amount0: bigint;
  amount1: bigint;
  tickLower?: number;
  tickUpper?: number;
  slippageBps?: number;
}

export interface LiquidityPosition {
  positionId: bigint;
  token0: Address;
  token1: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowth0: bigint;
  feeGrowth1: bigint;
}

export interface LaunchTokenParams {
  name: string;
  symbol: string;
  totalSupply: bigint;
  initialLiquidity?: bigint;
}

export interface DefiModule {
  // Token info
  getToken(address: Address): Promise<Token>;
  getBalance(token: Address): Promise<bigint>;
  approve(token: Address, spender: Address, amount: bigint): Promise<Hex>;

  // Swaps
  getSwapQuote(params: SwapParams): Promise<SwapQuote>;
  swap(quote: SwapQuote): Promise<Hex>;

  // Pools
  listPools(): Promise<PoolInfo[]>;
  getPool(token0: Address, token1: Address, fee: number): Promise<PoolInfo>;

  // Liquidity
  addLiquidity(params: AddLiquidityParams): Promise<Hex>;
  removeLiquidity(positionId: bigint, percentage: number): Promise<Hex>;
  listPositions(): Promise<LiquidityPosition[]>;
  collectFees(positionId: bigint): Promise<Hex>;

  // Launchpad
  launchToken(
    params: LaunchTokenParams,
  ): Promise<{ tokenAddress: Address; txHash: Hex }>;
}

const SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const POSITION_MANAGER_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    name: "decreaseLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "liquidity", type: "uint128" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    name: "collect",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "amount0Max", type: "uint128" },
          { name: "amount1Max", type: "uint128" },
        ],
      },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
] as const;

const ERC20_FACTORY_ABI = [
  {
    name: "createToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "totalSupply", type: "uint256" },
    ],
    outputs: [{ type: "address" }],
  },
] as const;

export function createDefiModule(
  wallet: JejuWallet,
  network: NetworkType,
): DefiModule {
  const swapRouterAddress = getContractAddress(
    "defi",
    "swapRouter",
    network,
  ) as Address;
  const positionManagerAddress = getContractAddress(
    "defi",
    "positionManager",
    network,
  ) as Address;
  const tokenFactoryAddress = getContractAddress(
    "registry",
    "tokenFactory",
    network,
  ) as Address;
  const services = getServicesConfig(network);

  async function getToken(address: Address): Promise<Token> {
    const token = getContract({
      address,
      abi: erc20Abi,
      client: wallet.publicClient,
    });

    const [name, symbol, decimals] = await Promise.all([
      token.read.name() as Promise<string>,
      token.read.symbol() as Promise<string>,
      token.read.decimals() as Promise<number>,
    ]);

    return { address, name, symbol, decimals };
  }

  async function getBalance(tokenAddress: Address): Promise<bigint> {
    // Native ETH
    if (tokenAddress === "0x0000000000000000000000000000000000000000") {
      return wallet.getBalance();
    }

    const token = getContract({
      address: tokenAddress,
      abi: erc20Abi,
      client: wallet.publicClient,
    });

    return (await token.read.balanceOf([wallet.address])) as bigint;
  }

  async function approve(
    token: Address,
    spender: Address,
    amount: bigint,
  ): Promise<Hex> {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    });

    return wallet.sendTransaction({ to: token, data });
  }

  async function getSwapQuote(params: SwapParams): Promise<SwapQuote> {
    // Fetch quote from the API
    const response = await fetch(`${services.gateway.api}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get swap quote: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      amountOut: string;
      priceImpact: number;
      route: Address[];
      fee: string;
    };

    const slippage = params.slippageBps ?? 50;
    const amountOut = BigInt(data.amountOut);
    const amountOutMin = (amountOut * BigInt(10000 - slippage)) / 10000n;

    return {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      amountOut,
      amountOutMin,
      priceImpact: data.priceImpact,
      route: data.route,
      fee: BigInt(data.fee),
    };
  }

  async function swap(quote: SwapQuote): Promise<Hex> {
    // Approve if not native ETH
    if (quote.tokenIn !== "0x0000000000000000000000000000000000000000") {
      await approve(quote.tokenIn, swapRouterAddress, quote.amountIn);
    }

    const data = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: quote.tokenIn,
          tokenOut: quote.tokenOut,
          fee: 3000, // 0.3%
          recipient: wallet.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 1800), // 30 min
          amountIn: quote.amountIn,
          amountOutMinimum: quote.amountOutMin,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    const value =
      quote.tokenIn === "0x0000000000000000000000000000000000000000"
        ? quote.amountIn
        : 0n;

    return wallet.sendTransaction({ to: swapRouterAddress, data, value });
  }

  async function listPools(): Promise<PoolInfo[]> {
    const response = await fetch(`${services.gateway.api}/pools`);
    if (!response.ok)
      throw new Error(`Failed to list pools: ${response.statusText}`);

    const data = (await response.json()) as {
      pools: Array<{
        poolId: Hex;
        token0: Token;
        token1: Token;
        fee: number;
        liquidity: string;
        sqrtPriceX96: string;
        tick: number;
      }>;
    };

    return data.pools.map((p) => ({
      ...p,
      liquidity: BigInt(p.liquidity),
      sqrtPriceX96: BigInt(p.sqrtPriceX96),
    }));
  }

  async function getPool(
    token0: Address,
    token1: Address,
    fee: number,
  ): Promise<PoolInfo> {
    const pools = await listPools();
    const pool = pools.find(
      (p) =>
        ((p.token0.address.toLowerCase() === token0.toLowerCase() &&
          p.token1.address.toLowerCase() === token1.toLowerCase()) ||
          (p.token0.address.toLowerCase() === token1.toLowerCase() &&
            p.token1.address.toLowerCase() === token0.toLowerCase())) &&
        p.fee === fee,
    );

    if (!pool) throw new Error("Pool not found");
    return pool;
  }

  async function addLiquidity(params: AddLiquidityParams): Promise<Hex> {
    // Approve tokens
    await approve(params.token0, positionManagerAddress, params.amount0);
    await approve(params.token1, positionManagerAddress, params.amount1);

    const slippage = params.slippageBps ?? 50;
    const amount0Min = (params.amount0 * BigInt(10000 - slippage)) / 10000n;
    const amount1Min = (params.amount1 * BigInt(10000 - slippage)) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

    const data = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "mint",
      args: [
        {
          token0: params.token0,
          token1: params.token1,
          fee: 3000,
          tickLower: params.tickLower ?? -887220,
          tickUpper: params.tickUpper ?? 887220,
          amount0Desired: params.amount0,
          amount1Desired: params.amount1,
          amount0Min,
          amount1Min,
          recipient: wallet.address,
          deadline,
        },
      ],
    });

    return wallet.sendTransaction({ to: positionManagerAddress, data });
  }

  async function removeLiquidity(
    positionId: bigint,
    percentage: number,
  ): Promise<Hex> {
    const positions = await listPositions();
    const position = positions.find((p) => p.positionId === positionId);
    if (!position) throw new Error("Position not found");

    const liquidityToRemove = (position.liquidity * BigInt(percentage)) / 100n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

    const data = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId: positionId,
          liquidity: liquidityToRemove,
          amount0Min: 0n,
          amount1Min: 0n,
          deadline,
        },
      ],
    });

    return wallet.sendTransaction({ to: positionManagerAddress, data });
  }

  async function listPositions(): Promise<LiquidityPosition[]> {
    const response = await fetch(
      `${services.gateway.api}/positions/${wallet.address}`,
    );
    if (!response.ok) return [];

    const data = (await response.json()) as {
      positions: Array<{
        positionId: string;
        token0: Address;
        token1: Address;
        tickLower: number;
        tickUpper: number;
        liquidity: string;
        feeGrowth0: string;
        feeGrowth1: string;
      }>;
    };

    return data.positions.map((p) => ({
      positionId: BigInt(p.positionId),
      token0: p.token0,
      token1: p.token1,
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      liquidity: BigInt(p.liquidity),
      feeGrowth0: BigInt(p.feeGrowth0),
      feeGrowth1: BigInt(p.feeGrowth1),
    }));
  }

  async function collectFees(positionId: bigint): Promise<Hex> {
    const data = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "collect",
      args: [
        {
          tokenId: positionId,
          recipient: wallet.address,
          amount0Max: BigInt("340282366920938463463374607431768211455"), // uint128 max
          amount1Max: BigInt("340282366920938463463374607431768211455"),
        },
      ],
    });

    return wallet.sendTransaction({ to: positionManagerAddress, data });
  }

  async function launchToken(
    params: LaunchTokenParams,
  ): Promise<{ tokenAddress: Address; txHash: Hex }> {
    const data = encodeFunctionData({
      abi: ERC20_FACTORY_ABI,
      functionName: "createToken",
      args: [params.name, params.symbol, params.totalSupply],
    });

    const txHash = await wallet.sendTransaction({
      to: tokenFactoryAddress,
      data,
    });

    // Get the created token address from the transaction receipt
    const receipt = await wallet.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const log = receipt.logs.find((l) => l.topics[0] === "0x...");
    const tokenAddress = (log?.address ?? "0x0") as Address;

    return { tokenAddress, txHash };
  }

  return {
    getToken,
    getBalance,
    approve,
    getSwapQuote,
    swap,
    listPools,
    getPool,
    addLiquidity,
    removeLiquidity,
    listPositions,
    collectFees,
    launchToken,
  };
}
