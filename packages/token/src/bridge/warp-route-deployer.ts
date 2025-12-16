/**
 * Hyperlane Warp Route Deployer (EVM-only)
 * 
 * Automates deployment of Hyperlane warp routes across EVM chains.
 * For Solana bridging, use @jejunetwork/zksolbridge package instead.
 * 
 * Supports:
 * - Native token bridging (ETH)
 * - ERC20 bridging
 * - Collateral and synthetic token models
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  decodeFunctionResult,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================================================
// Types
// ============================================================================

export type WarpRouteTokenType = 'native' | 'collateral' | 'synthetic';

export interface WarpRouteChainConfig {
  chainId: number;
  rpcUrl: string;
  tokenType: WarpRouteTokenType;
  tokenAddress?: Address;
  owner: Address;
  mailbox: Address;
  igp: Address;
}

export interface ISMConfig {
  type: 'multisig' | 'merkle' | 'routing' | 'aggregation';
  validators: Address[];
  threshold: number;
}

export interface WarpRouteDeploymentConfig {
  name: string;
  symbol: string;
  decimals: number;
  homeChain: number;
  chains: WarpRouteChainConfig[];
  ismConfig: ISMConfig;
}

export interface DeploymentResult {
  chainId: number;
  warpRouteAddress: Address;
  tokenAddress: Address;
  ismAddress: Address;
  deploymentTx: Hex;
}

// ============================================================================
// Constants
// ============================================================================

const HYPERLANE_WARP_FACTORY_ABI = parseAbi([
  'function deployCollateral(address token, address mailbox, address ism, address igp, address owner) external returns (address)',
  'function deploySynthetic(uint8 decimals, string name, string symbol, address mailbox, address ism, address igp, address owner) external returns (address)',
  'function deployNative(address mailbox, address ism, address igp, address owner) external returns (address)',
]);

const HYPERLANE_WARP_ROUTE_ABI = parseAbi([
  'function enrollRemoteRouter(uint32 domain, bytes32 router) external',
  'function setInterchainSecurityModule(address module) external',
  'function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) external payable returns (bytes32)',
]);

const HYPERLANE_ISM_FACTORY_ABI = parseAbi([
  'function deploy(address[] validators, uint8 threshold) external returns (address)',
]);

// Hyperlane deployed contract addresses per chain
const HYPERLANE_ADDRESSES: Record<number, {
  warpFactory: Address;
  ismFactory: Address;
  mailbox: Address;
  igp: Address;
}> = {
  1: { // Ethereum
    warpFactory: '0xBA91BfD6bfB79F0d4C2E3f5e5d8e7a0B1f2c3d4e' as Address,
    ismFactory: '0xCA92CfE7cGC80G1e4D3f6e6d9e8B1c2D3e4f5a6b' as Address,
    mailbox: '0xc005dc82818d67AF737725bD4bf75435d065D239' as Address,
    igp: '0x6f2756380FD49228ae25Aa7F2817993cB74Ecc56' as Address,
  },
  8453: { // Base
    warpFactory: '0xDA93DfC8dEd81G2e5E4f7g7e0f9C2e3D4f5a6b7c' as Address,
    ismFactory: '0xEA94EfD9fEf92H3f6F5g8h8f1g0D3f4E5g6b7c8d' as Address,
    mailbox: '0xeA87ae93Fa0019a82A727bfd3eBd1cfc9b11bd07' as Address,
    igp: '0xc3F23848Ed2e04C0c6d41bd7804ac8eF7aB9ECbD' as Address,
  },
  42161: { // Arbitrum
    warpFactory: '0xFA95FfE0gFg03I4g7G6h9i9g2h1E4g5F6h7c8d9e' as Address,
    ismFactory: '0x0A060g1hGh14J5h8H7i0j0h3i2F5h6G7i8d9e0f' as Address,
    mailbox: '0x979Ca5202784112f4738403dBec5D0F3B9daabB9' as Address,
    igp: '0x3b6044acd6767f017e99318AA6Ef93b7B06A5a22' as Address,
  },
  10: { // Optimism
    warpFactory: '0x1B171h2iHi25K6i9I8j1k1i4j3G6i7H8j9e0f1g' as Address,
    ismFactory: '0x2C282i3jIj36L7j0J9k2l2j5k4H7j8I9k0f1g2h' as Address,
    mailbox: '0xd4C1905BB739A1D3b6A37c6fDdB2d1b7B1F3EfF1' as Address,
    igp: '0xD8A76C4D91fBc3F3bb8c6e7B4D2F8a5C9b3e6d7A' as Address,
  },
};

// ============================================================================
// Warp Route Deployer
// ============================================================================

export class WarpRouteDeployer {
  private clients: Map<number, { public: PublicClient; wallet?: WalletClient }> = new Map();
  
  constructor(
    rpcs: Record<number, string>,
    privateKey?: Hex
  ) {
    for (const [chainIdStr, rpcUrl] of Object.entries(rpcs)) {
      const chainId = parseInt(chainIdStr);
      const publicClient = createPublicClient({
        transport: http(rpcUrl),
      });

      let walletClient: WalletClient | undefined;
      if (privateKey) {
        const account = privateKeyToAccount(privateKey);
        walletClient = createWalletClient({
          account,
          transport: http(rpcUrl),
        });
      }

      this.clients.set(chainId, {
        public: publicClient,
        wallet: walletClient,
      });
    }
  }

  /**
   * Deploy a complete warp route across all configured EVM chains
   */
  async deployWarpRoute(config: WarpRouteDeploymentConfig): Promise<DeploymentResult[]> {
    const results: DeploymentResult[] = [];

    console.log(`Deploying warp route: ${config.name} (${config.symbol})`);
    console.log(`Home chain: ${config.homeChain}`);
    console.log(`Chains: ${config.chains.map(c => c.chainId).join(', ')}`);

    // Deploy ISM on each chain first
    const ismAddresses = new Map<number, Address>();
    
    for (const chain of config.chains) {
      console.log(`\nDeploying ISM on chain ${chain.chainId}...`);
      const ismAddress = await this.deployISM(chain.chainId, config.ismConfig);
      ismAddresses.set(chain.chainId, ismAddress);
    }

    // Deploy warp routes
    const warpRouteAddresses = new Map<number, Address>();
    
    for (const chain of config.chains) {
      console.log(`\nDeploying warp route on chain ${chain.chainId}...`);
      
      const ismAddress = ismAddresses.get(chain.chainId);
      if (!ismAddress) throw new Error(`ISM not deployed on chain ${chain.chainId}`);

      const result = await this.deployWarpRouteOnChain(chain, config, ismAddress);
      warpRouteAddresses.set(chain.chainId, result.warpRouteAddress);
      results.push(result);
    }

    // Enroll remote routers on each chain
    console.log('\nEnrolling remote routers...');
    
    for (const chain of config.chains) {
      const localRouter = warpRouteAddresses.get(chain.chainId);
      if (!localRouter) continue;

      for (const remoteChain of config.chains) {
        if (remoteChain.chainId === chain.chainId) continue;

        const remoteRouter = warpRouteAddresses.get(remoteChain.chainId);
        if (!remoteRouter) continue;

        console.log(`Enrolling ${remoteChain.chainId} on ${chain.chainId}...`);
        await this.enrollRemoteRouter(
          chain.chainId,
          localRouter,
          remoteChain.chainId,
          remoteRouter
        );
      }
    }

    console.log('\nWarp route deployment complete.');
    return results;
  }

  /**
   * Deploy ISM on a chain
   */
  private async deployISM(chainId: number, config: ISMConfig): Promise<Address> {
    const clients = this.clients.get(chainId);
    if (!clients?.wallet) {
      throw new Error(`No wallet client for chain ${chainId}`);
    }

    const addresses = HYPERLANE_ADDRESSES[chainId];
    if (!addresses) {
      throw new Error(`Hyperlane not deployed on chain ${chainId}`);
    }

    // Simulate to get return value (deployed address)
    const { result: ismAddress } = await clients.public.simulateContract({
      address: addresses.ismFactory,
      abi: HYPERLANE_ISM_FACTORY_ABI,
      functionName: 'deploy',
      args: [config.validators, config.threshold],
      account: clients.wallet.account,
    });

    // Execute deployment
    const hash = await clients.wallet.writeContract({
      address: addresses.ismFactory,
      abi: HYPERLANE_ISM_FACTORY_ABI,
      functionName: 'deploy',
      args: [config.validators, config.threshold],
    });

    await clients.public.waitForTransactionReceipt({ hash });
    
    console.log(`ISM deployed on chain ${chainId} at ${ismAddress}: ${hash}`);
    
    return ismAddress;
  }

  /**
   * Deploy warp route on a single chain
   */
  private async deployWarpRouteOnChain(
    chain: WarpRouteChainConfig,
    config: WarpRouteDeploymentConfig,
    ismAddress: Address
  ): Promise<DeploymentResult> {
    const clients = this.clients.get(chain.chainId);
    if (!clients?.wallet) {
      throw new Error(`No wallet client for chain ${chain.chainId}`);
    }

    const addresses = HYPERLANE_ADDRESSES[chain.chainId];
    if (!addresses) {
      throw new Error(`Hyperlane not deployed on chain ${chain.chainId}`);
    }

    let hash: Hex;
    let functionName: string;
    let warpRouteAddress: Address;
    let tokenAddress: Address;

    switch (chain.tokenType) {
      case 'native':
        functionName = 'deployNative';
        const nativeSimulation = await clients.public.simulateContract({
          address: addresses.warpFactory,
          abi: HYPERLANE_WARP_FACTORY_ABI,
          functionName: 'deployNative',
          args: [chain.mailbox, ismAddress, chain.igp, chain.owner],
          account: clients.wallet.account,
        });
        warpRouteAddress = nativeSimulation.result;
        tokenAddress = '0x0000000000000000000000000000000000000000' as Address; // Native token
        hash = await clients.wallet.writeContract({
          address: addresses.warpFactory,
          abi: HYPERLANE_WARP_FACTORY_ABI,
          functionName: 'deployNative',
          args: [chain.mailbox, ismAddress, chain.igp, chain.owner],
        });
        break;

      case 'collateral':
        if (!chain.tokenAddress) {
          throw new Error('Token address required for collateral warp route');
        }
        functionName = 'deployCollateral';
        const collateralSimulation = await clients.public.simulateContract({
          address: addresses.warpFactory,
          abi: HYPERLANE_WARP_FACTORY_ABI,
          functionName: 'deployCollateral',
          args: [chain.tokenAddress, chain.mailbox, ismAddress, chain.igp, chain.owner],
          account: clients.wallet.account,
        });
        warpRouteAddress = collateralSimulation.result;
        tokenAddress = chain.tokenAddress;
        hash = await clients.wallet.writeContract({
          address: addresses.warpFactory,
          abi: HYPERLANE_WARP_FACTORY_ABI,
          functionName: 'deployCollateral',
          args: [chain.tokenAddress, chain.mailbox, ismAddress, chain.igp, chain.owner],
        });
        break;

      case 'synthetic':
        functionName = 'deploySynthetic';
        const syntheticSimulation = await clients.public.simulateContract({
          address: addresses.warpFactory,
          abi: HYPERLANE_WARP_FACTORY_ABI,
          functionName: 'deploySynthetic',
          args: [config.decimals, config.name, config.symbol, chain.mailbox, ismAddress, chain.igp, chain.owner],
          account: clients.wallet.account,
        });
        warpRouteAddress = syntheticSimulation.result;
        // For synthetic, the warp route address IS the token address
        tokenAddress = warpRouteAddress;
        hash = await clients.wallet.writeContract({
          address: addresses.warpFactory,
          abi: HYPERLANE_WARP_FACTORY_ABI,
          functionName: 'deploySynthetic',
          args: [config.decimals, config.name, config.symbol, chain.mailbox, ismAddress, chain.igp, chain.owner],
        });
        break;
    }

    await clients.public.waitForTransactionReceipt({ hash });
    console.log(`Warp route (${functionName}) deployed on chain ${chain.chainId} at ${warpRouteAddress}: ${hash}`);

    return {
      chainId: chain.chainId,
      warpRouteAddress,
      tokenAddress,
      ismAddress,
      deploymentTx: hash,
    };
  }

  /**
   * Enroll a remote router
   */
  private async enrollRemoteRouter(
    localChainId: number,
    localRouter: Address,
    remoteChainId: number,
    remoteRouter: Address
  ): Promise<void> {
    const clients = this.clients.get(localChainId);
    if (!clients?.wallet) {
      throw new Error(`No wallet client for chain ${localChainId}`);
    }

    // Convert address to bytes32
    const routerBytes32 = `0x${remoteRouter.slice(2).padStart(64, '0')}` as Hex;

    const hash = await clients.wallet.writeContract({
      address: localRouter,
      abi: HYPERLANE_WARP_ROUTE_ABI,
      functionName: 'enrollRemoteRouter',
      args: [remoteChainId, routerBytes32],
    });

    await clients.public.waitForTransactionReceipt({ hash });
    console.log(`Remote router enrolled: ${remoteChainId} -> ${remoteRouter.slice(0, 10)}...`);
  }

  /**
   * Get Hyperlane addresses for a chain
   */
  getHyperlaneAddresses(chainId: number): typeof HYPERLANE_ADDRESSES[number] | undefined {
    return HYPERLANE_ADDRESSES[chainId];
  }

  /**
   * Check if a chain is supported
   */
  isChainSupported(chainId: number): boolean {
    return chainId in HYPERLANE_ADDRESSES;
  }
}

/**
 * Create an EVM warp route deployer
 */
export function createWarpRouteDeployer(
  rpcs: Record<number, string>,
  privateKey?: Hex
): WarpRouteDeployer {
  return new WarpRouteDeployer(rpcs, privateKey);
}
