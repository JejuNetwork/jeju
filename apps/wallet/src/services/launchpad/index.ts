/**
 * Launchpad Service - Token Creation & Bonding Curves
 * Launch tokens, buy/sell on bonding curves, ICO presales
 */

import { type Address, type Hex, type PublicClient, encodeFunctionData, createPublicClient, http } from 'viem';
import { getChainContracts, getNetworkRpcUrl } from '../../sdk/chains';
import { rpcService, type SupportedChainId, SUPPORTED_CHAINS } from '../rpc';

const TOKEN_LAUNCHPAD_ABI = [
  // Launch functions
  { inputs: [{ name: 'name', type: 'string' }, { name: 'symbol', type: 'string' }, { name: 'creatorFeeBps', type: 'uint16' }, { name: 'communityVault', type: 'address' }, { components: [{ name: 'virtualEthReserves', type: 'uint256' }, { name: 'graduationTarget', type: 'uint256' }, { name: 'tokenSupply', type: 'uint256' }], name: 'curveConfig', type: 'tuple' }], name: 'launchBondingCurve', outputs: [{ name: 'launchId', type: 'uint256' }, { name: 'tokenAddress', type: 'address' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'name', type: 'string' }, { name: 'symbol', type: 'string' }, { name: 'totalSupply', type: 'uint256' }, { name: 'creatorFeeBps', type: 'uint16' }, { name: 'communityVault', type: 'address' }, { components: [{ name: 'presaleAllocationBps', type: 'uint256' }, { name: 'presalePrice', type: 'uint256' }, { name: 'lpFundingBps', type: 'uint256' }, { name: 'lpLockDuration', type: 'uint256' }, { name: 'buyerLockDuration', type: 'uint256' }, { name: 'softCap', type: 'uint256' }, { name: 'hardCap', type: 'uint256' }, { name: 'presaleDuration', type: 'uint256' }], name: 'icoConfig', type: 'tuple' }], name: 'launchICO', outputs: [{ name: 'launchId', type: 'uint256' }, { name: 'tokenAddress', type: 'address' }], stateMutability: 'nonpayable', type: 'function' },
  // View functions
  { inputs: [{ name: 'launchId', type: 'uint256' }], name: 'launches', outputs: [{ name: 'id', type: 'uint256' }, { name: 'creator', type: 'address' }, { name: 'token', type: 'address' }, { name: 'launchType', type: 'uint8' }, { components: [{ name: 'creatorFeeBps', type: 'uint16' }, { name: 'communityFeeBps', type: 'uint16' }, { name: 'communityVault', type: 'address' }], name: 'feeConfig', type: 'tuple' }, { name: 'bondingCurve', type: 'address' }, { name: 'presale', type: 'address' }, { name: 'lpLocker', type: 'address' }, { name: 'createdAt', type: 'uint256' }, { name: 'graduated', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'creator', type: 'address' }], name: 'creatorLaunches', outputs: [{ type: 'uint256[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'nextLaunchId', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'tokenAddress', type: 'address' }], name: 'tokenToLaunchId', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

const BONDING_CURVE_ABI = [
  { inputs: [{ name: 'minTokensOut', type: 'uint256' }], name: 'buy', outputs: [{ type: 'uint256' }], stateMutability: 'payable', type: 'function' },
  { inputs: [{ name: 'tokensIn', type: 'uint256' }, { name: 'minEthOut', type: 'uint256' }], name: 'sell', outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'virtualEthReserves', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'virtualTokenReserves', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'realEthReserves', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'realTokenReserves', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'graduationTarget', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'graduated', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'lpPair', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'ethIn', type: 'uint256' }], name: 'getTokensOut', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'tokensIn', type: 'uint256' }], name: 'getEthOut', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'getCurrentPrice', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

const ICO_PRESALE_ABI = [
  { inputs: [{ name: 'tokensRequested', type: 'uint256' }], name: 'buy', outputs: [], stateMutability: 'payable', type: 'function' },
  { inputs: [], name: 'claim', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'refund', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'finalize', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'totalRaised', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'tokensSold', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'softCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'hardCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'endTime', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'finalized', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'buyer', type: 'address' }], name: 'contributions', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

export enum LaunchType {
  BondingCurve = 0,
  ICOPresale = 1,
}

export interface BondingCurveConfig {
  virtualEthReserves: bigint;
  graduationTarget: bigint;
  tokenSupply: bigint;
}

export interface ICOConfig {
  presaleAllocationBps: bigint;
  presalePrice: bigint;
  lpFundingBps: bigint;
  lpLockDuration: bigint;
  buyerLockDuration: bigint;
  softCap: bigint;
  hardCap: bigint;
  presaleDuration: bigint;
}

export interface Launch {
  id: bigint;
  creator: Address;
  token: Address;
  launchType: LaunchType;
  creatorFeeBps: number;
  communityFeeBps: number;
  communityVault: Address;
  bondingCurve: Address;
  presale: Address;
  lpLocker: Address;
  createdAt: bigint;
  graduated: boolean;
  chainId: number;
}

export interface BondingCurveInfo {
  address: Address;
  token: Address;
  virtualEthReserves: bigint;
  virtualTokenReserves: bigint;
  realEthReserves: bigint;
  realTokenReserves: bigint;
  graduationTarget: bigint;
  graduated: boolean;
  lpPair: Address;
  currentPrice: bigint;
  progress: number; // 0-100%
}

export interface PresaleInfo {
  address: Address;
  totalRaised: bigint;
  tokensSold: bigint;
  softCap: bigint;
  hardCap: bigint;
  endTime: bigint;
  finalized: boolean;
  progress: number;
  userContribution: bigint;
}

export interface LaunchBondingCurveParams {
  name: string;
  symbol: string;
  creatorFeeBps: number;
  communityVault?: Address;
  virtualEthReserves: bigint;
  graduationTarget: bigint;
  tokenSupply: bigint;
}

export interface LaunchICOParams {
  name: string;
  symbol: string;
  totalSupply: bigint;
  creatorFeeBps: number;
  communityVault?: Address;
  presaleAllocationBps: number;
  presalePrice: bigint;
  lpFundingBps: number;
  lpLockDays: number;
  buyerLockDays: number;
  softCap: bigint;
  hardCap: bigint;
  presaleDays: number;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const ONE_DAY = 86400;

export class LaunchpadService {
  private chainId: number;
  private clientCache = new Map<number, PublicClient>();
  
  constructor(chainId: number = 8453) {
    this.chainId = chainId;
  }
  
  setChain(chainId: number) {
    this.chainId = chainId;
  }
  
  private getContracts() {
    return getChainContracts(this.chainId);
  }
  
  private getClient(): PublicClient {
    if (this.chainId in SUPPORTED_CHAINS) {
      return rpcService.getClient(this.chainId as SupportedChainId);
    }
    if (!this.clientCache.has(this.chainId)) {
      const rpcUrl = getNetworkRpcUrl(this.chainId) || 'http://localhost:6546';
      this.clientCache.set(this.chainId, createPublicClient({ transport: http(rpcUrl) }));
    }
    return this.clientCache.get(this.chainId)!;
  }
  
  /**
   * Get all launches by a creator
   */
  async getCreatorLaunches(creator: Address): Promise<Launch[]> {
    const launchpad = this.getContracts().tokenLaunchpad;
    if (!launchpad) return [];
    
    const client = this.getClient();
    const launchIds = await client.readContract({
      address: launchpad,
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'creatorLaunches',
      args: [creator],
    });
    
    const launches: Launch[] = [];
    for (const id of launchIds) {
      const launch = await this.getLaunch(id);
      if (launch) launches.push(launch);
    }
    
    return launches;
  }
  
  /**
   * Get launch details
   */
  async getLaunch(launchId: bigint): Promise<Launch | null> {
    const launchpad = this.getContracts().tokenLaunchpad;
    if (!launchpad) return null;
    
    const client = this.getClient();
    // Returns tuple: [id, creator, token, launchType, feeConfig, bondingCurve, presale, lpLocker, createdAt, graduated]
    const result = await client.readContract({
      address: launchpad,
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'launches',
      args: [launchId],
    });
    
    const [id, creator, token, launchType, feeConfig, bondingCurve, presale, lpLocker, createdAt, graduated] = result as [
      bigint, Address, Address, number, 
      { creatorFeeBps: number; communityFeeBps: number; communityVault: Address },
      Address, Address, Address, bigint, boolean
    ];
    
    return {
      id,
      creator,
      token,
      launchType: launchType as LaunchType,
      creatorFeeBps: feeConfig.creatorFeeBps,
      communityFeeBps: feeConfig.communityFeeBps,
      communityVault: feeConfig.communityVault,
      bondingCurve,
      presale,
      lpLocker,
      createdAt,
      graduated,
      chainId: this.chainId,
    };
  }
  
  /**
   * Get bonding curve info
   */
  async getBondingCurveInfo(curveAddress: Address): Promise<BondingCurveInfo | null> {
    const client = this.getClient();
    
    const [
      token,
      virtualEth,
      virtualToken,
      realEth,
      realToken,
      graduationTarget,
      graduated,
      lpPair,
      currentPrice,
    ] = await Promise.all([
      client.readContract({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName: 'token', args: [] }),
      client.readContract({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName: 'virtualEthReserves', args: [] }),
      client.readContract({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName: 'virtualTokenReserves', args: [] }),
      client.readContract({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName: 'realEthReserves', args: [] }),
      client.readContract({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName: 'realTokenReserves', args: [] }),
      client.readContract({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName: 'graduationTarget', args: [] }),
      client.readContract({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName: 'graduated', args: [] }),
      client.readContract({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName: 'lpPair', args: [] }),
      client.readContract({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName: 'getCurrentPrice', args: [] }),
    ]);
    
    const progress = graduationTarget > 0n ? Number((realEth * 100n) / graduationTarget) : 0;
    
    return {
      address: curveAddress,
      token,
      virtualEthReserves: virtualEth,
      virtualTokenReserves: virtualToken,
      realEthReserves: realEth,
      realTokenReserves: realToken,
      graduationTarget,
      graduated,
      lpPair,
      currentPrice,
      progress: Math.min(progress, 100),
    };
  }
  
  /**
   * Get presale info
   */
  async getPresaleInfo(presaleAddress: Address, userAddress?: Address): Promise<PresaleInfo> {
    const client = this.getClient();
    
    const [totalRaised, tokensSold, softCap, hardCap, endTime, finalized] = await Promise.all([
      client.readContract({ address: presaleAddress, abi: ICO_PRESALE_ABI, functionName: 'totalRaised', args: [] }),
      client.readContract({ address: presaleAddress, abi: ICO_PRESALE_ABI, functionName: 'tokensSold', args: [] }),
      client.readContract({ address: presaleAddress, abi: ICO_PRESALE_ABI, functionName: 'softCap', args: [] }),
      client.readContract({ address: presaleAddress, abi: ICO_PRESALE_ABI, functionName: 'hardCap', args: [] }),
      client.readContract({ address: presaleAddress, abi: ICO_PRESALE_ABI, functionName: 'endTime', args: [] }),
      client.readContract({ address: presaleAddress, abi: ICO_PRESALE_ABI, functionName: 'finalized', args: [] }),
    ]);
    
    let userContribution = 0n;
    if (userAddress) {
      userContribution = await client.readContract({
        address: presaleAddress,
        abi: ICO_PRESALE_ABI,
        functionName: 'contributions',
        args: [userAddress],
      });
    }
    
    const progress = hardCap > 0n ? Number((totalRaised * 100n) / hardCap) : 0;
    
    return {
      address: presaleAddress,
      totalRaised,
      tokensSold,
      softCap,
      hardCap,
      endTime,
      finalized,
      progress: Math.min(progress, 100),
      userContribution,
    };
  }
  
  /**
   * Get quote for buying on bonding curve
   */
  async getBuyQuote(curveAddress: Address, ethIn: bigint): Promise<bigint> {
    const client = this.getClient();
    return client.readContract({
      address: curveAddress,
      abi: BONDING_CURVE_ABI,
      functionName: 'getTokensOut',
      args: [ethIn],
    });
  }
  
  /**
   * Get quote for selling on bonding curve
   */
  async getSellQuote(curveAddress: Address, tokensIn: bigint): Promise<bigint> {
    const client = this.getClient();
    return client.readContract({
      address: curveAddress,
      abi: BONDING_CURVE_ABI,
      functionName: 'getEthOut',
      args: [tokensIn],
    });
  }
  
  /**
   * Build launch bonding curve transaction
   */
  buildLaunchBondingCurveTx(params: LaunchBondingCurveParams): { to: Address; data: Hex } | null {
    const launchpad = this.getContracts().tokenLaunchpad;
    if (!launchpad) return null;
    
    const data = encodeFunctionData({
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'launchBondingCurve',
      args: [
        params.name,
        params.symbol,
        params.creatorFeeBps,
        params.communityVault || ZERO_ADDRESS,
        {
          virtualEthReserves: params.virtualEthReserves,
          graduationTarget: params.graduationTarget,
          tokenSupply: params.tokenSupply,
        },
      ],
    });
    
    return { to: launchpad, data };
  }
  
  /**
   * Build launch ICO transaction
   */
  buildLaunchICOTx(params: LaunchICOParams): { to: Address; data: Hex } | null {
    const launchpad = this.getContracts().tokenLaunchpad;
    if (!launchpad) return null;
    
    const data = encodeFunctionData({
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'launchICO',
      args: [
        params.name,
        params.symbol,
        params.totalSupply,
        params.creatorFeeBps,
        params.communityVault || ZERO_ADDRESS,
        {
          presaleAllocationBps: BigInt(params.presaleAllocationBps),
          presalePrice: params.presalePrice,
          lpFundingBps: BigInt(params.lpFundingBps),
          lpLockDuration: BigInt(params.lpLockDays * ONE_DAY),
          buyerLockDuration: BigInt(params.buyerLockDays * ONE_DAY),
          softCap: params.softCap,
          hardCap: params.hardCap,
          presaleDuration: BigInt(params.presaleDays * ONE_DAY),
        },
      ],
    });
    
    return { to: launchpad, data };
  }
  
  /**
   * Build buy on bonding curve transaction
   */
  buildBuyTx(curveAddress: Address, minTokensOut: bigint, ethValue: bigint): { to: Address; data: Hex; value: bigint } {
    const data = encodeFunctionData({
      abi: BONDING_CURVE_ABI,
      functionName: 'buy',
      args: [minTokensOut],
    });
    
    return { to: curveAddress, data, value: ethValue };
  }
  
  /**
   * Build sell on bonding curve transaction
   */
  buildSellTx(curveAddress: Address, tokensIn: bigint, minEthOut: bigint): { to: Address; data: Hex } {
    const data = encodeFunctionData({
      abi: BONDING_CURVE_ABI,
      functionName: 'sell',
      args: [tokensIn, minEthOut],
    });
    
    return { to: curveAddress, data };
  }
  
  /**
   * Build ICO buy transaction
   */
  buildICOBuyTx(presaleAddress: Address, tokensRequested: bigint, ethValue: bigint): { to: Address; data: Hex; value: bigint } {
    const data = encodeFunctionData({
      abi: ICO_PRESALE_ABI,
      functionName: 'buy',
      args: [tokensRequested],
    });
    
    return { to: presaleAddress, data, value: ethValue };
  }
  
  /**
   * Build ICO claim transaction
   */
  buildICOClaimTx(presaleAddress: Address): { to: Address; data: Hex } {
    const data = encodeFunctionData({
      abi: ICO_PRESALE_ABI,
      functionName: 'claim',
      args: [],
    });
    
    return { to: presaleAddress, data };
  }
  
  /**
   * Get recent launches
   */
  async getRecentLaunches(limit: number = 20): Promise<Launch[]> {
    const launchpad = this.getContracts().tokenLaunchpad;
    if (!launchpad) return [];
    
    const client = this.getClient();
    const nextId = await client.readContract({
      address: launchpad,
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'nextLaunchId',
      args: [],
    });
    
    const launches: Launch[] = [];
    const startId = nextId > BigInt(limit) ? nextId - BigInt(limit) : 1n;
    
    for (let i = nextId - 1n; i >= startId && i > 0n; i--) {
      const launch = await this.getLaunch(i);
      if (launch) launches.push(launch);
    }
    
    return launches;
  }
}

export const launchpadService = new LaunchpadService();

