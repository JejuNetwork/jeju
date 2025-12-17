/**
 * Contract connections for Node services
 */

import { createPublicClient, createWalletClient, http, type Address, type Chain, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getLocalnetChain, getTestnetChain, getMainnetChain } from '@jejunetwork/shared';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Load addresses from deployment files
function loadAddressesFromDeployment(network: 'testnet' | 'mainnet'): ContractAddresses | null {
  try {
    const deploymentPath = join(process.cwd(), 'packages', 'contracts', 'deployments', network, 'addresses.json');
    if (!existsSync(deploymentPath)) {
      return null;
    }
    const data = JSON.parse(readFileSync(deploymentPath, 'utf-8')) as Record<string, string>;
    return {
      identityRegistry: (data.IdentityRegistry || data.identityRegistry || '0x0000000000000000000000000000000000000000') as Address,
      nodeStakingManager: (data.NodeStakingManager || data.nodeStakingManager || '0x0000000000000000000000000000000000000000') as Address,
      computeRegistry: (data.ComputeRegistry || data.computeRegistry || '0x0000000000000000000000000000000000000000') as Address,
      computeStaking: (data.ComputeStaking || data.computeStaking || '0x0000000000000000000000000000000000000000') as Address,
      inferenceServing: (data.InferenceServing || data.inferenceServing || '0x0000000000000000000000000000000000000000') as Address,
      triggerRegistry: (data.TriggerRegistry || data.triggerRegistry || '0x0000000000000000000000000000000000000000') as Address,
      storageMarket: (data.StorageMarket || data.storageMarket || '0x0000000000000000000000000000000000000000') as Address,
      contentRegistry: (data.ContentRegistry || data.contentRegistry || '0x0000000000000000000000000000000000000000') as Address,
      oracleStakingManager: (data.OracleStakingManager || data.oracleStakingManager || '0x0000000000000000000000000000000000000000') as Address,
      feedRegistry: (data.FeedRegistry || data.feedRegistry || '0x0000000000000000000000000000000000000000') as Address,
      reportVerifier: (data.ReportVerifier || data.reportVerifier || '0x0000000000000000000000000000000000000000') as Address,
      proxyRegistry: (data.ProxyRegistry || data.proxyRegistry || '0x0000000000000000000000000000000000000000') as Address,
      sequencerRegistry: (data.SequencerRegistry || data.sequencerRegistry || '0x0000000000000000000000000000000000000000') as Address,
      liquidityAggregator: (data.LiquidityAggregator || data.liquidityAggregator || '0x0000000000000000000000000000000000000000') as Address,
      solverRegistry: (data.SolverRegistry || data.solverRegistry || '0x0000000000000000000000000000000000000000') as Address,
      feeDistributor: (data.FeeDistributor || data.feeDistributor || '0x0000000000000000000000000000000000000000') as Address,
      banManager: (data.BanManager || data.banManager || '0x0000000000000000000000000000000000000000') as Address,
      cdnRegistry: (data.CDNRegistry || data.cdnRegistry || '0x0000000000000000000000000000000000000000') as Address,
      cdnBilling: (data.CDNBilling || data.cdnBilling || '0x0000000000000000000000000000000000000000') as Address,
    };
  } catch {
    return null;
  }
}

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
  contentRegistry: Address;
  oracleStakingManager: Address;
  feedRegistry: Address;
  reportVerifier: Address;
  proxyRegistry: Address;
  sequencerRegistry: Address;
  liquidityAggregator: Address;
  solverRegistry: Address;
  feeDistributor: Address;
  banManager: Address;
  cdnRegistry: Address;
  cdnBilling: Address;
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
      contentRegistry: '0x68B1D87F95878fE05B998F19b66F4baba5De1aed' as Address,
      oracleStakingManager: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853' as Address,
      feedRegistry: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6' as Address,
      reportVerifier: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318' as Address,
      proxyRegistry: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788' as Address,
      sequencerRegistry: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e' as Address,
      liquidityAggregator: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0' as Address,
      solverRegistry: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82' as Address,
      feeDistributor: '0x9A676e781A523b5d0C0e43731313A708CB607508' as Address,
      banManager: '0x0B306BF915C4d645ff596e518fAf3F9669b97016' as Address,
      cdnRegistry: '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1' as Address,
      cdnBilling: '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE' as Address,
    };
  }

  // Testnet addresses - loaded from deployment files or environment
  if (chainId === 420691) {
    return loadAddressesFromDeployment('testnet') || {
      identityRegistry: (process.env.IDENTITY_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
      nodeStakingManager: (process.env.NODE_STAKING_MANAGER || '0x0000000000000000000000000000000000000000') as Address,
      computeRegistry: (process.env.COMPUTE_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
      computeStaking: (process.env.COMPUTE_STAKING || '0x0000000000000000000000000000000000000000') as Address,
      inferenceServing: (process.env.INFERENCE_SERVING || '0x0000000000000000000000000000000000000000') as Address,
      triggerRegistry: (process.env.TRIGGER_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
      storageMarket: (process.env.STORAGE_MARKET || '0x0000000000000000000000000000000000000000') as Address,
      contentRegistry: (process.env.CONTENT_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
      oracleStakingManager: (process.env.ORACLE_STAKING_MANAGER || '0x0000000000000000000000000000000000000000') as Address,
      feedRegistry: (process.env.FEED_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
      reportVerifier: (process.env.REPORT_VERIFIER || '0x0000000000000000000000000000000000000000') as Address,
      proxyRegistry: (process.env.PROXY_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
      sequencerRegistry: (process.env.SEQUENCER_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
      liquidityAggregator: (process.env.LIQUIDITY_AGGREGATOR || '0x0000000000000000000000000000000000000000') as Address,
      solverRegistry: (process.env.SOLVER_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
      feeDistributor: (process.env.FEE_DISTRIBUTOR || '0x0000000000000000000000000000000000000000') as Address,
      banManager: '0x0000000000000000000000000000000000000000' as Address,
      cdnRegistry: '0x0000000000000000000000000000000000000000' as Address,
      cdnBilling: '0x0000000000000000000000000000000000000000' as Address,
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

