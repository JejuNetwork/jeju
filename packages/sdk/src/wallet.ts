/**
 * Wallet utilities for network SDK
 * Supports both EOA and ERC-4337 Smart Accounts
 */

import type { NetworkType } from "@jejunetwork/types";
import {
  createSmartAccountClient,
  type SmartAccountClient,
} from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  type LocalAccount,
  mnemonicToAccount,
  privateKeyToAccount,
} from "viem/accounts";
import { getChainConfig, getContract, getServicesConfig } from "./config";

export interface WalletConfig {
  privateKey?: Hex;
  mnemonic?: string;
  account?: LocalAccount;
  smartAccount?: boolean;
  network: NetworkType;
}

export interface JejuWallet {
  address: Address;
  account: LocalAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
  smartAccountClient?: SmartAccountClient;
  isSmartAccount: boolean;
  chain: Chain;
  sendTransaction: (params: {
    to: Address;
    value?: bigint;
    data?: Hex;
  }) => Promise<Hex>;
  signMessage: (message: string) => Promise<Hex>;
  getBalance: () => Promise<bigint>;
}

function getNetworkChain(network: NetworkType): Chain {
  const config = getChainConfig(network);
  const services = getServicesConfig(network);

  return {
    id: config.chainId,
    name: config.name,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [services.rpc.l2] },
    },
    blockExplorers: {
      default: { name: "Explorer", url: services.explorer },
    },
  };
}

export async function createWallet(config: WalletConfig): Promise<JejuWallet> {
  const chain = getNetworkChain(config.network);
  const services = getServicesConfig(config.network);

  // Create account from private key or mnemonic
  let account: LocalAccount;
  if (config.account) {
    account = config.account;
  } else if (config.privateKey) {
    account = privateKeyToAccount(config.privateKey);
  } else if (config.mnemonic) {
    account = mnemonicToAccount(config.mnemonic);
  } else {
    throw new Error("Wallet requires privateKey, mnemonic, or account");
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(services.rpc.l2),
  });

  const walletClient = createWalletClient({
    chain,
    transport: http(services.rpc.l2),
    account,
  });

  // Create smart account if enabled (default: true)
  const useSmartAccount = config.smartAccount !== false;
  let smartAccountClient: SmartAccountClient | undefined;
  let effectiveAddress: Address = account.address;

  if (useSmartAccount) {
    const entryPoint = getContract(
      "payments",
      "entryPoint",
      config.network,
    ) as Address;
    const factoryAddress = getContract(
      "payments",
      "accountFactory",
      config.network,
    ) as Address;

    // Only create smart account if contracts are deployed
    if (entryPoint && factoryAddress && entryPoint !== "0x") {
      const smartAccount = await toSimpleSmartAccount({
        client: publicClient,
        owner: account,
        entryPoint: {
          address: entryPoint,
          version: "0.7",
        },
        factoryAddress,
      });

      const bundlerUrl = `${services.gateway.api}/bundler`;

      const pimlicoClient = createPimlicoClient({
        transport: http(bundlerUrl),
        entryPoint: {
          address: entryPoint,
          version: "0.7",
        },
      });

      smartAccountClient = createSmartAccountClient({
        account: smartAccount,
        chain,
        bundlerTransport: http(bundlerUrl),
        paymaster: pimlicoClient,
      });

      effectiveAddress = smartAccount.address;
    }
  }

  const wallet: JejuWallet = {
    address: effectiveAddress,
    account,
    publicClient,
    walletClient,
    smartAccountClient,
    isSmartAccount: !!smartAccountClient,
    chain,

    async sendTransaction({ to, value, data }) {
      if (smartAccountClient?.account) {
        // SmartAccountClient's sendTransaction has compatible signature but different generics
        const hash = await smartAccountClient.sendTransaction({
          to,
          value: value ?? 0n,
          data: data ?? "0x",
          account: smartAccountClient.account,
          chain,
        });
        return hash;
      }

      const hash = await walletClient.sendTransaction({
        to,
        value: value ?? 0n,
        data: data ?? "0x",
        chain,
        account,
      });
      return hash;
    },

    async signMessage(message: string) {
      return walletClient.signMessage({ message, account });
    },

    async getBalance() {
      return publicClient.getBalance({ address: effectiveAddress });
    },
  };

  return wallet;
}
