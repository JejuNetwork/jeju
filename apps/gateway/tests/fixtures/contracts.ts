/**
 * @fileoverview Contract interaction helpers for testing
 * @module gateway/tests/fixtures/contracts
 */

import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getContractAddresses as getDeployedAddresses, isValidAddress } from '@jejunetwork/contracts';

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

async function isContractDeployed(client: ReturnType<typeof getPublicClient>, address: string | undefined): Promise<boolean> {
  if (!isValidAddress(address)) {
    return false;
  }
  const code = await client.getCode({ address: address as `0x${string}` });
  return code !== undefined && code !== '0x';
}

export async function getContractAddresses() {
  const deployed = getDeployedAddresses(1337);
  const client = getPublicClient();

  // Allow env overrides for testing
  const tokenRegistryAddr = (process.env.VITE_TOKEN_REGISTRY_ADDRESS || deployed.tokenRegistry || deployed.validationRegistry) as `0x${string}`;
  const paymasterFactoryAddr = (process.env.VITE_PAYMASTER_FACTORY_ADDRESS || deployed.paymasterFactory) as `0x${string}`;
  const priceOracleAddr = (process.env.VITE_PRICE_ORACLE_ADDRESS || deployed.priceOracle) as `0x${string}`;
  const nodeStakingManagerAddr = process.env.VITE_NODE_STAKING_MANAGER_ADDRESS as `0x${string}`;
  const identityRegistryAddr = (process.env.VITE_IDENTITY_REGISTRY_ADDRESS || deployed.identityRegistry) as `0x${string}`;

  return {
    tokenRegistry: await isContractDeployed(client, tokenRegistryAddr) ? tokenRegistryAddr : undefined as unknown as `0x${string}`,
    paymasterFactory: await isContractDeployed(client, paymasterFactoryAddr) ? paymasterFactoryAddr : undefined as unknown as `0x${string}`,
    priceOracle: await isContractDeployed(client, priceOracleAddr) ? priceOracleAddr : undefined as unknown as `0x${string}`,
    nodeStakingManager: await isContractDeployed(client, nodeStakingManagerAddr) ? nodeStakingManagerAddr : undefined as unknown as `0x${string}`,
    identityRegistry: await isContractDeployed(client, identityRegistryAddr) ? identityRegistryAddr : undefined as unknown as `0x${string}`,
    elizaOS: deployed.elizaOS,
    entryPoint: deployed.entryPoint,
    paymaster: undefined as unknown as `0x${string}`,
    vault: undefined as unknown as `0x${string}`,
  };
}

export async function fundAccount(address: `0x${string}`, amount: bigint = parseEther('10')) {
  const client = getWalletClient();
  
  await client.sendTransaction({
    to: address,
    value: amount,
  });
}
