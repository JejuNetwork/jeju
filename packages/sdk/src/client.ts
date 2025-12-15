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
import { createCrossChainModule, type CrossChainModule } from "./crosschain";
import { createPaymentsModule, type PaymentsModule } from "./payments";
import { createA2AModule, type A2AModule } from "./a2a";
import { getServicesConfig, getChainConfig } from "./config";
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
  /** Cross-chain - EIL + OIF transfers and intents */
  readonly crosschain: CrossChainModule;
  /** Payments - Paymasters, x402, credits */
  readonly payments: PaymentsModule;
  /** A2A - Agent protocol client */
  readonly a2a: A2AModule;

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

  // Create modules
  const compute = createComputeModule(wallet, network);
  const storage = createStorageModule(wallet, network);
  const defi = createDefiModule(wallet, network);
  const governance = createGovernanceModule(wallet, network);
  const names = createNamesModule(wallet, network);
  const identity = createIdentityModule(wallet, network);
  const crosschain = createCrossChainModule(wallet, network);
  const payments = createPaymentsModule(wallet, network);
  const a2a = createA2AModule(wallet, network, servicesConfig);

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
    crosschain,
    payments,
    a2a,

    getBalance: () => wallet.getBalance(),
    sendTransaction: (params) => wallet.sendTransaction(params),
  };

  return client;
}
