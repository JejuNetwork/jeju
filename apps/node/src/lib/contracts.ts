/**
 * Contract connections for Node services
 */

import { createPublicClient, createWalletClient, http, type Address, type Chain, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getLocalnetChain, getTestnetChain, getMainnetChain } from '@jejunetwork/shared';

// Chain definitions from shared config
export const networkMainnet: Chain = getMainnetChain();
export const networkTestnet: Chain = { ...getTestnetChain(), testnet: true };
export const networkLocalnet: Chain = getLocalnetChain();

// Aliases for backward compatibility
export const jejuMainnet = networkMainnet;
export const jejuTestnet = networkTestnet;
export const jejuLocalnet = networkLocalnet;

// Contract addresses by network
export interface ContractAddresses {
  identityRegistry: Address;
  nodeStakingManager: Address;
  computeRegistry: Address;
  computeStaking: Address;
  inferenceServing: Address;
  triggerRegistry: Address;
  storageMarket: Address;
  oracleStakingManager: Address;
  feedRegistry: Address;
  reportVerifier: Address;
  proxyRegistry: Address;
  sequencerRegistry: Address;
  liquidityAggregator: Address;
  solverRegistry: Address;
  feeDistributor: Address;
  banManager: Address;
}

export function getContractAddresses(chainId: number): ContractAddresses {
  // For localnet, addresses are deployed by bootstrap script
  // These are deterministic based on CREATE2
  if (chainId === 1337) {
    return {
      identityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
      nodeStakingManager: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address,
      computeRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address,
      computeStaking: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address,
      inferenceServing: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' as Address,
      triggerRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707' as Address,
      storageMarket: '0x0165878A594ca255338adfa4d48449f69242Eb8F' as Address,
      oracleStakingManager: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853' as Address,
      feedRegistry: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6' as Address,
      reportVerifier: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318' as Address,
      proxyRegistry: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788' as Address,
      sequencerRegistry: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e' as Address,
      liquidityAggregator: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0' as Address,
      solverRegistry: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82' as Address,
      feeDistributor: '0x9A676e781A523b5d0C0e43731313A708CB607508' as Address,
      banManager: '0x0B306BF915C4d645ff596e518fAf3F9669b97016' as Address,
    };
  }

  // Testnet addresses
  if (chainId === 420691) {
    return {
      identityRegistry: '0x0000000000000000000000000000000000000000' as Address, // TODO: Deploy
      nodeStakingManager: '0x0000000000000000000000000000000000000000' as Address,
      computeRegistry: '0x0000000000000000000000000000000000000000' as Address,
      computeStaking: '0x0000000000000000000000000000000000000000' as Address,
      inferenceServing: '0x0000000000000000000000000000000000000000' as Address,
      triggerRegistry: '0x0000000000000000000000000000000000000000' as Address,
      storageMarket: '0x0000000000000000000000000000000000000000' as Address,
      oracleStakingManager: '0x0000000000000000000000000000000000000000' as Address,
      feedRegistry: '0x0000000000000000000000000000000000000000' as Address,
      reportVerifier: '0x0000000000000000000000000000000000000000' as Address,
      proxyRegistry: '0x0000000000000000000000000000000000000000' as Address,
      sequencerRegistry: '0x0000000000000000000000000000000000000000' as Address,
      liquidityAggregator: '0x0000000000000000000000000000000000000000' as Address,
      solverRegistry: '0x0000000000000000000000000000000000000000' as Address,
      feeDistributor: '0x0000000000000000000000000000000000000000' as Address,
      banManager: '0x0000000000000000000000000000000000000000' as Address,
    };
  }

  throw new Error(`Unknown chain ID: ${chainId}`);
}

export function getChain(chainId: number): Chain {
  const mainnet = networkMainnet;
  const testnet = networkTestnet;
  
  switch (chainId) {
    case mainnet.id: return mainnet;
    case testnet.id: return testnet;
    case 1337: return networkLocalnet;
    default: throw new Error(`Unknown chain ID: ${chainId}`);
  }
}

export interface NodeClient {
  publicClient: PublicClient;
  walletClient: WalletClient | null;
  addresses: ContractAddresses;
  chainId: number;
}

export function createNodeClient(
  rpcUrl: string,
  chainId: number,
  privateKey?: string
): NodeClient {
  const chain = getChain(chainId);
  
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  let walletClient: WalletClient | null = null;
  if (privateKey) {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
  }

  const addresses = getContractAddresses(chainId);

  return {
    publicClient,
    walletClient,
    addresses,
    chainId,
  };
}

