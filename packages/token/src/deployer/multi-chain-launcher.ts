import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem';
import { getChainConfig, getHomeChain } from '../config/chains';
import type {
  ChainConfig,
  ChainDeployment,
  ChainId,
  DeploymentConfig,
  DeploymentResult,
} from '../types';
import { type ContractName, deployContractCreate2 } from './contract-deployer';

export interface DeploymentStep {
  name: string;
  chainId: ChainId;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  txHash?: Hex;
  contractAddress?: string;
  error?: string;
}

export interface DeploymentProgress {
  totalSteps: number;
  completedSteps: number;
  currentStep: DeploymentStep | null;
  steps: DeploymentStep[];
}

export type DeploymentEventHandler = (progress: DeploymentProgress) => void;

export class MultiChainLauncher {
  private clients: Map<ChainId, PublicClient> = new Map();
  private progress: DeploymentProgress = {
    totalSteps: 0,
    completedSteps: 0,
    currentStep: null,
    steps: [],
  };
  private eventHandler?: DeploymentEventHandler;

  constructor(
    private readonly config: DeploymentConfig,
    eventHandler?: DeploymentEventHandler
  ) {
    this.eventHandler = eventHandler;

    // Initialize clients for all chains
    for (const chain of config.chains) {
      if (chain.chainType === 'evm') {
        const client = createPublicClient({
          transport: http(chain.rpcUrl),
        });
        this.clients.set(chain.chainId, client);
      }
    }

    this.progress.totalSteps = this.calculateTotalSteps();
  }

  async deploy(
    walletClients: Map<ChainId, WalletClient>
  ): Promise<DeploymentResult> {
    const deployments: ChainDeployment[] = [];
    const deterministicAddresses: Record<ChainId, string> = {} as Record<
      ChainId,
      string
    >;

    const homeChain = getHomeChain();
    this.updateProgress(
      'Deploy token on home chain',
      homeChain.chainId,
      'in_progress'
    );

    const homeDeployment = await this.deployHomeChain(
      walletClients.get(homeChain.chainId)!
    );
    deployments.push(homeDeployment);
    deterministicAddresses[homeChain.chainId] = homeDeployment.token;

    this.updateProgress(
      'Deploy token on home chain',
      homeChain.chainId,
      'completed'
    );

    for (const chain of this.config.chains) {
      if (chain.isHomeChain || chain.chainType !== 'evm') continue;

      const walletClient = walletClients.get(chain.chainId);
      if (!walletClient) continue;

      this.updateProgress(
        `Deploy on ${chain.name}`,
        chain.chainId,
        'in_progress'
      );

      const deployment = await this.deploySyntheticChain(
        chain,
        walletClient,
        homeDeployment.token as Address
      );
      deployments.push(deployment);
      deterministicAddresses[chain.chainId] = deployment.token;

      this.updateProgress(
        `Deploy on ${chain.name}`,
        chain.chainId,
        'completed'
      );
    }

    const solanaChain = this.config.chains.find((c) => c.chainType === 'svm');
    if (solanaChain) {
      this.updateProgress(
        'Deploy on Solana',
        solanaChain.chainId,
        'in_progress'
      );

      const solanaDeployment = await this.deploySolanaChainInternal(
        solanaChain,
        homeDeployment.token as Address
      );
      deployments.push(solanaDeployment);
      deterministicAddresses[solanaChain.chainId] = solanaDeployment.token;

      this.updateProgress('Deploy on Solana', solanaChain.chainId, 'completed');
    }

    this.updateProgress(
      'Configure Hyperlane routes',
      homeChain.chainId,
      'in_progress'
    );
    await this.configureHyperlaneRoutes(walletClients, deployments);
    this.updateProgress(
      'Configure Hyperlane routes',
      homeChain.chainId,
      'completed'
    );

    for (const allocation of this.config.liquidity.allocations) {
      this.updateProgress(
        `Deploy liquidity on chain ${allocation.chainId}`,
        allocation.chainId,
        'in_progress'
      );
      await this.deployLiquidityInternal(
        walletClients.get(allocation.chainId)!,
        allocation.chainId,
        deployments.find((d) => d.chainId === allocation.chainId)!
      );
      this.updateProgress(
        `Deploy liquidity on chain ${allocation.chainId}`,
        allocation.chainId,
        'completed'
      );
    }

    return {
      deployedAt: Date.now(),
      config: this.config,
      deployments,
      salt: this.config.deploymentSalt,
      deterministicAddresses,
    };
  }

  private async deployHomeChain(
    walletClient: WalletClient
  ): Promise<ChainDeployment> {
    const homeChain = getHomeChain();
    const publicClient = this.clients.get(homeChain.chainId)!;
    const txHashes: Hex[] = [];

    // 1. Deploy Token
    const tokenResult = await this.deployContractInternal(
      publicClient,
      walletClient,
      'BabylonToken',
      [
        this.config.token.name,
        this.config.token.symbol,
        this.config.token.totalSupply *
          BigInt(10 ** this.config.token.decimals),
        this.config.owner,
        true, // isHomeChain
      ]
    );
    txHashes.push(tokenResult.txHash);

    // 2. Deploy Vesting
    const vestingResult = await this.deployContractInternal(
      publicClient,
      walletClient,
      'TokenVesting',
      [tokenResult.address, this.config.owner]
    );
    txHashes.push(vestingResult.txHash);

    // 3. Deploy Fee Distributor
    const feeDistributorResult = await this.deployContractInternal(
      publicClient,
      walletClient,
      'FeeDistributor',
      [tokenResult.address, this.config.owner, 7 * 24 * 60 * 60]
    );
    txHashes.push(feeDistributorResult.txHash);

    // 4. Deploy Presale (optional)
    let presaleAddress: string | undefined;
    if (this.config.presale.enabled) {
      const presaleResult = await this.deployContractInternal(
        publicClient,
        walletClient,
        'Presale',
        [
          tokenResult.address,
          BigInt(Math.round(this.config.presale.priceUsd * 1e8)), // 8 decimals for USD
          BigInt(Math.round(this.config.presale.softCapUsd * 1e8)),
          BigInt(Math.round(this.config.presale.hardCapUsd * 1e8)),
          BigInt(this.config.presale.startTime),
          BigInt(this.config.presale.endTime),
          this.config.owner,
        ]
      );
      txHashes.push(presaleResult.txHash);
      presaleAddress = presaleResult.address;
    }

    // 5. Deploy CCA Launcher
    const ccaResult = await this.deployContractInternal(
      publicClient,
      walletClient,
      'CCALauncher',
      [
        tokenResult.address,
        '0x0000000000000000000000000000000000000000' as Address,
        this.config.owner,
      ]
    );
    txHashes.push(ccaResult.txHash);

    // 6. Initialize Token
    await this.initializeToken(
      publicClient,
      walletClient,
      tokenResult.address,
      feeDistributorResult.address
    );

    // 7. Deploy Warp Route (Collateral mode for home chain)
    const warpRouteResult = await this.deployWarpRouteInternal(
      publicClient,
      walletClient,
      tokenResult.address,
      homeChain,
      true // isCollateral
    );
    txHashes.push(warpRouteResult.txHash);

    const block = await publicClient.getBlock();

    return {
      chainId: homeChain.chainId,
      token: tokenResult.address,
      vesting: vestingResult.address,
      feeDistributor: feeDistributorResult.address,
      warpRoute: warpRouteResult.address,
      ism: warpRouteResult.address, // ISM is set on the warp route
      presale: presaleAddress,
      ccaAuction: ccaResult.address,
      deploymentTxHashes: txHashes,
      deployedAtBlock: block.number,
    };
  }

  private async deploySyntheticChain(
    chain: ChainConfig,
    walletClient: WalletClient,
    _homeTokenAddress: Address
  ): Promise<ChainDeployment> {
    const publicClient = this.clients.get(chain.chainId)!;
    const txHashes: Hex[] = [];

    // 1. Deploy Token (synthetic - no initial supply)
    const tokenResult = await this.deployContractInternal(
      publicClient,
      walletClient,
      'BabylonToken',
      [
        this.config.token.name,
        this.config.token.symbol,
        0n,
        this.config.owner,
        false, // not home chain
      ]
    );
    txHashes.push(tokenResult.txHash);

    // 2. Deploy Vesting
    const vestingResult = await this.deployContractInternal(
      publicClient,
      walletClient,
      'TokenVesting',
      [tokenResult.address, this.config.owner]
    );
    txHashes.push(vestingResult.txHash);

    // 3. Deploy Fee Distributor
    const feeDistributorResult = await this.deployContractInternal(
      publicClient,
      walletClient,
      'FeeDistributor',
      [tokenResult.address, this.config.owner, 7 * 24 * 60 * 60]
    );
    txHashes.push(feeDistributorResult.txHash);

    // 4. Deploy Warp Route (Synthetic mode - mint/burn)
    const warpRouteResult = await this.deployWarpRouteInternal(
      publicClient,
      walletClient,
      tokenResult.address,
      chain,
      false // not collateral (synthetic)
    );
    txHashes.push(warpRouteResult.txHash);

    // 5. Initialize Token
    await this.initializeToken(
      publicClient,
      walletClient,
      tokenResult.address,
      feeDistributorResult.address
    );

    // 6. Authorize Warp Route to mint/burn
    await this.authorizeWarpRoute(
      walletClient,
      tokenResult.address,
      warpRouteResult.address
    );

    const block = await publicClient.getBlock();

    return {
      chainId: chain.chainId,
      token: tokenResult.address,
      vesting: vestingResult.address,
      feeDistributor: feeDistributorResult.address,
      warpRoute: warpRouteResult.address,
      ism: warpRouteResult.address,
      deploymentTxHashes: txHashes,
      deployedAtBlock: block.number,
    };
  }

  /**
   * Deploy token on Solana chain
   * Creates SPL token - warp route setup requires Hyperlane CLI/SDK
   */
  private async deploySolanaChainInternal(
    chain: ChainConfig,
    _homeTokenAddress: Address
  ): Promise<ChainDeployment> {
    // For production, this would:
    // 1. Use the Solana keypair from environment
    // 2. Create SPL token via @solana/spl-token
    // 3. Set up Hyperlane warp route via their CLI

    // For now, return a placeholder indicating Solana needs manual setup
    // Solana deployment requires different tooling (Anchor, Solana CLI)

    const isMainnet = chain.chainId === 'solana-mainnet';
    const message = isMainnet
      ? 'Solana mainnet requires manual SPL token creation'
      : 'Solana devnet token - use CLI for deployment';

    console.log(`[Solana] ${message}`);
    console.log(`[Solana] Use 'spl-token create-token' to create the token`);
    console.log(`[Solana] Then run Hyperlane CLI to set up warp route`);

    // Return placeholder - actual deployment done via CLI
    return {
      chainId: chain.chainId,
      token: 'PENDING_SOLANA_TOKEN_MINT',
      vesting: '',
      feeDistributor: '',
      warpRoute: chain.hyperlaneMailbox,
      ism: chain.hyperlaneMailbox,
      deploymentTxHashes: [],
      deployedAtBlock: 0n,
    };
  }

  private async configureHyperlaneRoutes(
    walletClients: Map<ChainId, WalletClient>,
    deployments: ChainDeployment[]
  ): Promise<void> {
    for (const deployment of deployments) {
      const walletClient = walletClients.get(deployment.chainId);
      if (!walletClient) continue;

      for (const otherDeployment of deployments) {
        if (deployment.chainId === otherDeployment.chainId) continue;
        await this.enrollRemoteRouter(
          walletClient,
          deployment.warpRoute as Address,
          otherDeployment.chainId,
          otherDeployment.warpRoute
        );
      }
    }
  }

  private async enrollRemoteRouter(
    walletClient: WalletClient,
    localWarpRoute: Address,
    remoteDomain: ChainId,
    remoteRouter: string
  ): Promise<void> {
    const domainId = this.getDomainId(remoteDomain);
    const routerBytes32 = this.addressToBytes32(remoteRouter);

    const abi = parseAbi([
      'function enrollRemoteRouter(uint32 domain, bytes32 router) external',
    ]);

    const account = walletClient.account;
    if (!account) throw new Error('WalletClient must have an account');

    await walletClient.writeContract({
      address: localWarpRoute,
      abi,
      functionName: 'enrollRemoteRouter',
      args: [domainId, routerBytes32],
      chain: walletClient.chain ?? null,
      account,
    });
  }

  /**
   * Deploy liquidity to a DEX
   * Note: This requires the deployer to have ETH for the pair
   */
  private async deployLiquidityInternal(
    _walletClient: WalletClient,
    chainId: ChainId,
    _deployment: ChainDeployment
  ): Promise<void> {
    const allocation = this.config.liquidity.allocations.find(
      (a) => a.chainId === chainId
    );
    if (!allocation) return;

    const chain = getChainConfig(chainId);
    if (!chain.dexRouter) {
      console.log(`[Liquidity] No DEX router configured for chain ${chainId}`);
      return;
    }

    const publicClient = this.clients.get(chainId);
    if (!publicClient) {
      console.log(`[Liquidity] No public client for chain ${chainId}`);
      return;
    }

    const liquidityTokens =
      (((this.config.token.totalSupply *
        BigInt(this.config.token.allocation.liquidity)) /
        100n) *
        BigInt(allocation.percentage)) /
      100n;

    // For production, this would add liquidity
    // Currently logs the intended action
    console.log(`[Liquidity] Chain ${chainId}:`);
    console.log(`  Tokens: ${liquidityTokens}`);
    console.log(`  DEX: ${allocation.dex}`);
    console.log(`  Router: ${chain.dexRouter}`);
    console.log('  Note: Liquidity deployment requires ETH in deployer wallet');
    console.log('  Use the liquidity-deployer module for manual deployment');
  }

  /**
   * Deploy a contract using CREATE2 for deterministic addresses
   */
  private async deployContractInternal(
    publicClient: PublicClient,
    walletClient: WalletClient,
    contractName: ContractName,
    constructorArgs: readonly unknown[]
  ): Promise<{ address: Address; txHash: Hex }> {
    // Use CREATE2 for deterministic addresses across chains
    const result = await deployContractCreate2(
      publicClient,
      walletClient,
      contractName,
      constructorArgs,
      this.config.deploymentSalt
    );
    return result;
  }

  /**
   * Deploy a WarpRoute contract for cross-chain token transfers
   */
  private async deployWarpRouteInternal(
    publicClient: PublicClient,
    walletClient: WalletClient,
    tokenAddress: Address,
    chain: ChainConfig,
    isCollateral: boolean
  ): Promise<{ address: Address; txHash: Hex }> {
    // Deploy the WarpRoute contract
    const result = await this.deployContractInternal(
      publicClient,
      walletClient,
      'WarpRoute',
      [
        chain.hyperlaneMailbox as Address, // mailbox
        tokenAddress, // token
        isCollateral, // isCollateral
        this.config.owner, // owner
      ]
    );

    // Configure the warp route with IGP
    const account = walletClient.account;
    if (!account) throw new Error('WalletClient must have an account');

    const abi = parseAbi([
      'function setInterchainGasPaymaster(address _igp) external',
    ]);

    await walletClient.writeContract({
      address: result.address,
      abi,
      functionName: 'setInterchainGasPaymaster',
      args: [chain.hyperlaneIgp as Address],
      chain: walletClient.chain ?? null,
      account,
    });

    return result;
  }

  private async initializeToken(
    _publicClient: PublicClient,
    walletClient: WalletClient,
    tokenAddress: Address,
    feeDistributorAddress: Address
  ): Promise<void> {
    const account = walletClient.account;
    if (!account) throw new Error('WalletClient must have an account');

    const { fees, maxWalletPercent, maxTxPercent } = this.config.token;
    const abi = parseAbi([
      'function initialize(address feeDistributor, address treasury, address creatorWallet, uint16 holdersFeeBps, uint16 creatorsFeeBps, uint16 treasuryFeeBps, uint16 burnFeeBps, uint256 maxWalletPercent, uint256 maxTxPercent) external',
    ]);
    const holdersBps = Math.round(fees.distribution.holders * 100);
    const creatorsBps = Math.round(fees.distribution.creators * 100);
    const treasuryBps = Math.round(fees.distribution.treasury * 100);
    const burnBps = Math.round(fees.distribution.burn * 100);

    await walletClient.writeContract({
      address: tokenAddress,
      abi,
      functionName: 'initialize',
      args: [
        feeDistributorAddress,
        this.config.owner,
        this.config.owner,
        holdersBps,
        creatorsBps,
        treasuryBps,
        burnBps,
        BigInt(maxWalletPercent),
        BigInt(maxTxPercent),
      ],
      chain: walletClient.chain ?? null,
      account,
    });
  }

  private async authorizeWarpRoute(
    walletClient: WalletClient,
    tokenAddress: Address,
    warpRouteAddress: Address
  ): Promise<void> {
    const account = walletClient.account;
    if (!account) throw new Error('WalletClient must have an account');

    const abi = parseAbi([
      'function setMinter(address minter, bool authorized) external',
      'function setBurner(address burner, bool authorized) external',
    ]);

    await walletClient.writeContract({
      address: tokenAddress,
      abi,
      functionName: 'setMinter',
      args: [warpRouteAddress, true],
      chain: walletClient.chain ?? null,
      account,
    });

    await walletClient.writeContract({
      address: tokenAddress,
      abi,
      functionName: 'setBurner',
      args: [warpRouteAddress, true],
      chain: walletClient.chain ?? null,
      account,
    });
  }

  private getDomainId(chainId: ChainId): number {
    if (typeof chainId === 'string') {
      return chainId === 'solana-mainnet' ? 1399811149 : 1399811150;
    }
    return chainId;
  }

  private addressToBytes32(address: string): Hex {
    const clean = address.toLowerCase().replace('0x', '');
    return `0x${clean.padStart(64, '0')}` as Hex;
  }

  private calculateTotalSteps(): number {
    let steps = 1; // Home chain
    steps += this.config.chains.filter(
      (c) => !c.isHomeChain && c.chainType === 'evm'
    ).length;
    if (this.config.chains.some((c) => c.chainType === 'svm')) steps += 1;
    steps += 1; // Hyperlane config
    steps += this.config.liquidity.allocations.length;
    return steps;
  }

  private updateProgress(
    name: string,
    chainId: ChainId,
    status: DeploymentStep['status']
  ): void {
    const step: DeploymentStep = { name, chainId, status };

    if (status === 'completed') {
      this.progress.completedSteps++;
    }

    this.progress.currentStep = step;

    const existingIndex = this.progress.steps.findIndex(
      (s) => s.name === name && s.chainId === chainId
    );

    if (existingIndex >= 0) {
      this.progress.steps[existingIndex] = step;
    } else {
      this.progress.steps.push(step);
    }

    this.eventHandler?.({ ...this.progress });
  }

  getProgress(): DeploymentProgress {
    return { ...this.progress };
  }
}
