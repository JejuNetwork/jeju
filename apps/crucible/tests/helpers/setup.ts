/**
 * Test Helpers for Crucible
 * Shared utilities for test setup and execution
 */

import { ethers } from 'ethers';

export const TEST_RPC_URL = process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545';
export const TEST_DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/**
 * Wait for localnet to be ready
 */
export async function waitForLocalnet(maxAttempts = 30): Promise<ethers.JsonRpcProvider> {
  const provider = new ethers.JsonRpcProvider(TEST_RPC_URL);
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await provider.getBlockNumber();
      console.log('✅ Localnet is ready');
      return provider;
    } catch (error) {
      if (i === maxAttempts - 1) {
        throw new Error('Localnet not accessible after 30 attempts. Please start: bun run dev');
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  throw new Error('Unexpected: loop ended without return');
}

/**
 * Fund a test wallet
 */
export async function fundWallet(
  address: string,
  ethAmount: string,
  tokenAddress?: string,
  tokenAmount?: string
): Promise<void> {
  const provider = new ethers.JsonRpcProvider(TEST_RPC_URL);
  const deployer = new ethers.Wallet(TEST_DEPLOYER_KEY, provider);
  
  // Send ETH
  const tx = await deployer.sendTransaction({
    to: address,
    value: ethers.parseEther(ethAmount)
  });
  await tx.wait();
  
  // Send tokens if specified
  if (tokenAddress && tokenAmount) {
    const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
    const token = new ethers.Contract(tokenAddress, erc20Abi, deployer);
    const tokenTx = await token.transfer(address, ethers.parseEther(tokenAmount));
    await tokenTx.wait();
  }
}

/**
 * Deploy a test contract
 */
export async function deployTestContract(
  abi: any[],
  bytecode: string,
  ...args: any[]
): Promise<{ address: string; contract: ethers.Contract }> {
  const provider = new ethers.JsonRpcProvider(TEST_RPC_URL);
  const deployer = new ethers.Wallet(TEST_DEPLOYER_KEY, provider);
  
  const factory = new ethers.ContractFactory(abi, bytecode, deployer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  
  return { address, contract };
}

/**
 * Load contract addresses from deployment
 */
export async function loadContractAddresses(): Promise<Record<string, string>> {
  // Try to load from file, otherwise use defaults
  try {
    const deployment = await import('../../contracts/deployments/localnet-addresses.json');
    return deployment.default || deployment;
  } catch {
    // Use defaults
    return {
      IDENTITY_REGISTRY: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      REPUTATION_REGISTRY: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
      CREDIT_MANAGER: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
      ELIZA_TOKEN: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
    };
  }
}

/**
 * Create test agent runtime configuration
 */
export function createTestRuntimeConfig(
  agentType: string,
  privateKey: string,
  addresses: Record<string, string>
) {
  return {
    NETWORK: 'localnet',
    JEJU_L2_RPC: TEST_RPC_URL,
    REDTEAM_PRIVATE_KEY: privateKey,
    AGENT_TYPE: agentType,
    GUARDIAN_ADDRESS_LOCALNET: '0x71562b71999873DB5b286dF957af199Ec94617F7',
    ...addresses
  };
}

/**
 * Wait for transaction confirmation
 */
export async function waitForTx(txHash: string, timeout = 30000): Promise<ethers.TransactionReceipt | null> {
  const provider = new ethers.JsonRpcProvider(TEST_RPC_URL);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        return receipt;
      }
    } catch (error) {
      // Keep trying
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error(`Transaction ${txHash} not confirmed after ${timeout}ms`);
}

