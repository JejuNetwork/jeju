/**
 * Deploy Proxy Network Contracts
 * 
 * Deploys ProxyRegistry and ProxyPayment contracts for the decentralized proxy network.
 * 
 * Usage:
 *   bun run scripts/deploy/deploy-proxy.ts
 * 
 * Environment:
 *   PRIVATE_KEY - Deployer private key
 *   JEJU_RPC_URL - RPC endpoint (default: http://127.0.0.1:6546)
 *   TREASURY_ADDRESS - Address to receive protocol fees (optional, defaults to deployer)
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, encodeDeployData, getContractAddress, type Address, type Abi, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { waitForTransactionReceipt, readContract, getBalance } from 'viem/actions';
import { parseAbi } from 'viem';
import { readFileSync } from 'fs';
import { join } from 'path';
import { inferChainFromRpcUrl } from '../shared/chain-utils';
import type { ConstructorArg, RawArtifactJson } from '../shared/contract-types';

const CONTRACTS_PATH = join(import.meta.dir, '../../packages/contracts');

interface DeployResult {
  proxyRegistry: string;
  proxyPayment: string;
  deployer: string;
  treasury: string;
  network: string;
  chainId: number;
}

async function loadArtifact(contractName: string): Promise<{ abi: Abi; bytecode: Hex }> {
  const artifactPath = join(CONTRACTS_PATH, `out/${contractName}.sol/${contractName}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8')) as RawArtifactJson;
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
  };
}

async function deployContract(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: PrivateKeyAccount,
  contractName: string,
  constructorArgs: ConstructorArg[]
): Promise<Address> {
  const artifact = await loadArtifact(contractName);
  
  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: constructorArgs,
  });

  const nonce = await publicClient.getTransactionCount({ address: account.address });
  
  const hash = await walletClient.sendTransaction({
    data: deployData,
    account,
  });

  const receipt = await waitForTransactionReceipt(publicClient, { hash });
  
  if (receipt.status !== 'success') {
    throw new Error(`Deployment failed: ${contractName} (tx: ${hash})`);
  }

  const address = receipt.contractAddress || getContractAddress({
    from: account.address,
    nonce: BigInt(nonce),
  });

  return address;
}

async function deploy(): Promise<DeployResult> {
  const rpcUrl = process.env.JEJU_RPC_URL || 'http://127.0.0.1:6546';
  const privateKey = process.env.PRIVATE_KEY;
  
  if (!privateKey) {
    console.error('PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  const chain = inferChainFromRpcUrl(rpcUrl);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const chainId = await publicClient.getChainId();

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              Network Proxy Network Contract Deployment              ║
╚══════════════════════════════════════════════════════════════════╝

Network:    ${chain.name} (chainId: ${chainId})
RPC:        ${rpcUrl}
Deployer:   ${account.address}
`);

  // Check deployer balance
  const balance = await getBalance(publicClient, { address: account.address });
  console.log(`Balance:    ${formatEther(balance)} ETH`);

  if (balance < parseEther('0.1')) {
    console.warn('⚠️  Low balance - deployment may fail');
  }

  const treasury = (process.env.TREASURY_ADDRESS || account.address) as Address;
  console.log(`Treasury:   ${treasury}\n`);

  // Load artifacts
  console.log('Loading contract artifacts...');

  // Deploy ProxyRegistry
  console.log('\n1. Deploying ProxyRegistry...');
  const registryAddress = await deployContract(
    publicClient,
    walletClient,
    account,
    'ProxyRegistry',
    [account.address, treasury]
  );
  console.log(`   ✅ ProxyRegistry deployed: ${registryAddress}`);

  // Deploy ProxyPayment
  console.log('\n2. Deploying ProxyPayment...');
  const paymentAddress = await deployContract(
    publicClient,
    walletClient,
    account,
    'ProxyPayment',
    [account.address, registryAddress, treasury]
  );
  console.log(`   ✅ ProxyPayment deployed: ${paymentAddress}`);

  // Configure contracts
  console.log('\n3. Configuring contracts...');

  const REGISTRY_ABI = parseAbi(['function setCoordinator(address) external', 'function minNodeStake() view returns (uint256)']);
  const PAYMENT_ABI = parseAbi(['function setCoordinator(address) external', 'function pricePerGb() view returns (uint256)']);

  // Set coordinator on registry (deployer for now)
  const setCoordinatorHash1 = await walletClient.writeContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'setCoordinator',
    args: [account.address],
    account,
  });
  await waitForTransactionReceipt(publicClient, { hash: setCoordinatorHash1 });
  console.log('   ✅ Registry coordinator set to deployer');

  // Set coordinator on payment contract
  const setCoordinatorHash2 = await walletClient.writeContract({
    address: paymentAddress,
    abi: PAYMENT_ABI,
    functionName: 'setCoordinator',
    args: [account.address],
    account,
  });
  await waitForTransactionReceipt(publicClient, { hash: setCoordinatorHash2 });
  console.log('   ✅ Payment coordinator set to deployer');

  // Verify deployment
  console.log('\n4. Verifying deployment...');
  
  const minStake = await readContract(publicClient, {
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'minNodeStake',
  });
  console.log(`   Registry minNodeStake: ${formatEther(minStake)} ETH`);

  const pricePerGb = await readContract(publicClient, {
    address: paymentAddress,
    abi: PAYMENT_ABI,
    functionName: 'pricePerGb',
  });
  console.log(`   Payment pricePerGb: ${formatEther(pricePerGb)} ETH`);

  const result: DeployResult = {
    proxyRegistry: registryAddress,
    proxyPayment: paymentAddress,
    deployer: account.address,
    treasury,
    network: chain.name,
    chainId,
  };

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                     Deployment Complete                          ║
╚══════════════════════════════════════════════════════════════════╝

ProxyRegistry:  ${result.proxyRegistry}
ProxyPayment:   ${result.proxyPayment}

Add to .env:
  PROXY_REGISTRY_ADDRESS=${result.proxyRegistry}
  PROXY_PAYMENT_ADDRESS=${result.proxyPayment}

Start coordinator:
  PROXY_REGISTRY_ADDRESS=${result.proxyRegistry} \\
  PROXY_PAYMENT_ADDRESS=${result.proxyPayment} \\
  COORDINATOR_PRIVATE_KEY=<your-key> \\
  bun run apps/dws/src/proxy/coordinator/server.ts
`);

  return result;
}

// Run deployment
deploy().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});


