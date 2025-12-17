/**
 * NetworkClient - Main SDK entry point
 *
 * The client name (JejuClient, etc.) comes from branding config.
 */

import type { Hex, Address, Account } from "viem";
import type { NetworkType } from "@jejunetwork/types";
import { createWallet, type JejuWallet } from "./wallet";
import { createComputeModule, type ComputeModule } from "./compute";
import { createStorageModule, type StorageModule } from "./storage";
import { createDefiModule, type DefiModule } from "./defi";
import { createGovernanceModule, type GovernanceModule } from "./governance";
import { createNamesModule, type NamesModule } from "./names";
import { createIdentityModule, type IdentityModule } from "./identity";
import { createValidationModule, type ValidationModule } from "./validation";
import { createCrossChainModule, type CrossChainModule } from "./crosschain";
import { createNFTModule, type NFTModule } from "./nfts";
import { createPaymentsModule, type PaymentsModule } from "./payments";
import { createA2AModule, type A2AModule } from "./a2a";
import { createGamesModule, type GamesModule } from "./games";
import { createContainersModule, type ContainersModule } from "./containers";
import { createLaunchpadModule, type LaunchpadModule } from "./launchpad";
import { createModerationModule, type ModerationModule } from "./moderation";
import { createWorkModule, type WorkModule } from "./work";
import { getServicesConfig, getChainConfig, getContractAddresses } from "./config";
import { getNetworkName } from "@jejunetwork/config";

export interface JejuClientConfig {
  /** Network to connect to */
  network: NetworkType;
  /** Private key (hex string starting with 0x) */
  privateKey?: Hex;
  /** Mnemonic phrase */
  mnemonic?: string;
  /** Pre-configured account */
  account?: Account;
  /** Enable ERC-4337 smart account (default: true) */
  smartAccount?: boolean;
  /** Custom RPC URL override */
  rpcUrl?: string;
  /** Custom bundler URL override */
  bundlerUrl?: string;
}

export interface JejuClient {
  /** Current network */
  readonly network: NetworkType;
  /** Chain ID */
  readonly chainId: number;
  /** Wallet address */
  readonly address: Address;
  /** Whether using smart account */
  readonly isSmartAccount: boolean;
  /** Wallet instance */
  readonly wallet: JejuWallet;

  /** Compute marketplace - GPU/CPU rentals, inference, triggers */
  readonly compute: ComputeModule;
  /** Storage marketplace - IPFS, multi-provider */
  readonly storage: StorageModule;
  /** DeFi - Swaps, liquidity, launchpad */
  readonly defi: DefiModule;
  /** Governance - Proposals, voting, delegation */
  readonly governance: GovernanceModule;
  /** JNS - Name registration and resolution */
  readonly names: NamesModule;
  /** Identity - ERC-8004, reputation, moderation */
  readonly identity: IdentityModule;
  /** Validation - ERC-8004 validation registry */
  readonly validation: ValidationModule;
  /** Cross-chain - EIL + OIF transfers and intents */
  readonly crosschain: CrossChainModule;
  /** NFTs - Cross-chain NFT bridging via Hyperlane/EIL/OIF */
  readonly nfts: NFTModule;
  /** Payments - Paymasters, x402, credits */
  readonly payments: PaymentsModule;
  /** A2A - Agent protocol client */
  readonly a2a: A2AModule;
  /** Games - Game integration contracts (Babylon, Hyperscape) */
  readonly games: GamesModule;
  /** Containers - OCI container registry */
  readonly containers: ContainersModule;
  /** Launchpad - Token and NFT launches */
  readonly launchpad: LaunchpadModule;
  /** Moderation - Evidence registry, cases, reputation labels */
  readonly moderation: ModerationModule;
  /** Work - Bounties, projects, guardians */
  readonly work: WorkModule;

  /** Get native balance */
  getBalance(): Promise<bigint>;
  /** Send transaction */
  sendTransaction(params: {
    to: Address;
    value?: bigint;
    data?: Hex;
  }): Promise<Hex>;
}

export async function createJejuClient(
  config: JejuClientConfig,
): Promise<JejuClient> {
  if (!config.privateKey && !config.mnemonic && !config.account) {
    throw new Error(
      `${getNetworkName()}Client requires privateKey, mnemonic, or account`,
    );
  }

  const network = config.network;
  const chainConfig = getChainConfig(network);
  const servicesConfig = getServicesConfig(network);

  // Create wallet
  const wallet = await createWallet({
    privateKey: config.privateKey,
    mnemonic: config.mnemonic,
    account: config.account,
    smartAccount: config.smartAccount,
    network,
  });

  // Get contract addresses for modules that need them
  const contractAddresses = getContractAddresses(network);

  // Create modules
  const compute = createComputeModule(wallet, network);
  const storage = createStorageModule(wallet, network);
  const defi = createDefiModule(wallet, network);
  const governance = createGovernanceModule(wallet, network);
  const names = createNamesModule(wallet, network);
  const identity = createIdentityModule(wallet, network);
  const validation = createValidationModule(wallet, network, wallet.publicClient);
  const crosschain = createCrossChainModule(wallet, network);
  const nfts = createNFTModule(wallet, network);
  const payments = createPaymentsModule(wallet, network);
  const a2a = createA2AModule(wallet, network, servicesConfig);

  // Create extended modules (may not be available on all networks)
  const games = contractAddresses.gameIntegration
    ? createGamesModule(wallet, network)
    : createStubGamesModule();
  const containers = contractAddresses.containerRegistry
    ? createContainersModule(wallet, network)
    : createStubContainersModule();
  const launchpad = contractAddresses.tokenLaunchpad
    ? createLaunchpadModule(wallet, network)
    : createStubLaunchpadModule();
  const moderation = createModerationModule(wallet, network);
  const work = createWorkModule(wallet, network);

  const client: JejuClient = {
    network,
    chainId: chainConfig.chainId,
    address: wallet.address,
    isSmartAccount: wallet.isSmartAccount,
    wallet,

    compute,
    storage,
    defi,
    governance,
    names,
    identity,
    validation,
    crosschain,
    nfts,
    payments,
    a2a,
    games,
    containers,
    launchpad,
    moderation,
    work,

    getBalance: () => wallet.getBalance(),
    sendTransaction: (params) => wallet.sendTransaction(params),
  };

  return client;
}

// Stub modules for when contracts are not available
function createStubGamesModule(): GamesModule {
  const notAvailable = (): never => {
    throw new Error("GameIntegration contract not deployed on this network");
  };
  return {
    getContracts: notAvailable,
    getGameAgentId: notAvailable,
    isPlayerAllowed: notAvailable,
    getPlayerAgentId: notAvailable,
    linkAgentId: notAvailable,
    unlinkAgentId: notAvailable,
    getGoldBalance: notAvailable,
    getGoldTotalSupply: notAvailable,
    transferGold: notAvailable,
    approveGold: notAvailable,
    mintGold: notAvailable,
    burnGold: notAvailable,
    getItemBalance: notAvailable,
    getItemBalances: notAvailable,
    getItemUri: notAvailable,
    mintItem: notAvailable,
    mintItems: notAvailable,
    burnItem: notAvailable,
    transferItem: notAvailable,
    transferItems: notAvailable,
    setItemApprovalForAll: notAvailable,
    isItemApprovedForAll: notAvailable,
    getPlayerInfo: notAvailable,
    getGameStats: notAvailable,
  };
}

function createStubContainersModule(): ContainersModule {
  const notAvailable = (): never => {
    throw new Error("ContainerRegistry contract not deployed on this network");
  };
  return {
    createRepository: notAvailable,
    getRepository: notAvailable,
    getRepositoryByName: notAvailable,
    listMyRepositories: notAvailable,
    starRepository: notAvailable,
    unstarRepository: notAvailable,
    grantAccess: notAvailable,
    revokeAccess: notAvailable,
    hasAccess: notAvailable,
    publishImage: notAvailable,
    getManifest: notAvailable,
    getManifestByTag: notAvailable,
    recordPull: notAvailable,
    signImage: notAvailable,
    getRepoId: () => {
      throw new Error("ContainerRegistry contract not deployed on this network");
    },
    parseImageReference: () => {
      throw new Error("ContainerRegistry contract not deployed on this network");
    },
  };
}

function createStubLaunchpadModule(): LaunchpadModule {
  const notAvailable = (): never => {
    throw new Error("Launchpad contracts not deployed on this network");
  };
  return {
    createToken: notAvailable,
    createPresale: notAvailable,
    contribute: notAvailable,
    claim: notAvailable,
    refund: notAvailable,
    finalizePresale: notAvailable,
    getPresale: notAvailable,
    getUserContribution: notAvailable,
    listActivePresales: notAvailable,
    createBondingCurve: notAvailable,
    buyFromCurve: notAvailable,
    sellToCurve: notAvailable,
    getCurve: notAvailable,
    getBuyPrice: notAvailable,
    getSellPrice: notAvailable,
    listActiveCurves: notAvailable,
    lockLP: notAvailable,
    unlockLP: notAvailable,
    extendLPLock: notAvailable,
    getLPLock: notAvailable,
    listMyLPLocks: notAvailable,
  };
}
