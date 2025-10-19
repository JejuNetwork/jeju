/**
 * @fileoverview Contract interaction helpers for testing
 * @module gateway/tests/fixtures/contracts
 */

import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const TEST_WALLET = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
};

const jejuLocalnet = {
  id: 1337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:9545'] },
    public: { http: ['http://127.0.0.1:9545'] },
  },
} as const;

export function getPublicClient() {
  return createPublicClient({
    chain: jejuLocalnet,
    transport: http(),
  });
}

export function getWalletClient(privateKey: string = TEST_WALLET.privateKey) {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  
  return createWalletClient({
    account,
    chain: jejuLocalnet,
    transport: http(),
  });
}

export async function getContractAddresses() {
  return {
    tokenRegistry: process.env.VITE_TOKEN_REGISTRY_ADDRESS as `0x${string}`,
    paymasterFactory: process.env.VITE_PAYMASTER_FACTORY_ADDRESS as `0x${string}`,
    priceOracle: process.env.VITE_PRICE_ORACLE_ADDRESS as `0x${string}`,
    nodeStakingManager: process.env.VITE_NODE_STAKING_MANAGER_ADDRESS as `0x${string}`,
    identityRegistry: process.env.VITE_IDENTITY_REGISTRY_ADDRESS as `0x${string}`,
  };
}

export async function fundAccount(address: `0x${string}`, amount: bigint = parseEther('10')) {
  const client = getWalletClient();
  
  await client.sendTransaction({
    to: address,
    value: amount,
  });
}

