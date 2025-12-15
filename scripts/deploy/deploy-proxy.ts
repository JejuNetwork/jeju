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
 *   JEJU_RPC_URL - RPC endpoint (default: http://127.0.0.1:9545)
 *   TREASURY_ADDRESS - Address to receive protocol fees (optional, defaults to deployer)
 */

import { Contract, ContractFactory, JsonRpcProvider, Wallet, parseEther, formatEther } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

const CONTRACTS_PATH = join(import.meta.dir, '../../packages/contracts');

interface DeployResult {
  proxyRegistry: string;
  proxyPayment: string;
  deployer: string;
  treasury: string;
  network: string;
  chainId: number;
}

async function loadArtifact(contractName: string): Promise<{ abi: unknown[]; bytecode: string }> {
  const artifactPath = join(CONTRACTS_PATH, `out/${contractName}.sol/${contractName}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  };
}

async function deploy(): Promise<DeployResult> {
  const rpcUrl = process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545';
  const privateKey = process.env.PRIVATE_KEY;
  
  if (!privateKey) {
    console.error('PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              Network Proxy Network Contract Deployment              ║
╚══════════════════════════════════════════════════════════════════╝

Network:    ${network.name} (chainId: ${network.chainId})
RPC:        ${rpcUrl}
Deployer:   ${wallet.address}
`);

  // Check deployer balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance:    ${formatEther(balance)} ETH`);

  if (balance < parseEther('0.1')) {
    console.warn('⚠️  Low balance - deployment may fail');
  }

  const treasury = process.env.TREASURY_ADDRESS || wallet.address;
  console.log(`Treasury:   ${treasury}\n`);

  // Load artifacts
  console.log('Loading contract artifacts...');
  const registryArtifact = await loadArtifact('ProxyRegistry');
  const paymentArtifact = await loadArtifact('ProxyPayment');

  // Deploy ProxyRegistry
  console.log('\n1. Deploying ProxyRegistry...');
  const registryFactory = new ContractFactory(
    registryArtifact.abi,
    registryArtifact.bytecode,
    wallet
  );
  const registry = await registryFactory.deploy(wallet.address, treasury);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`   ✅ ProxyRegistry deployed: ${registryAddress}`);

  // Deploy ProxyPayment
  console.log('\n2. Deploying ProxyPayment...');
  const paymentFactory = new ContractFactory(
    paymentArtifact.abi,
    paymentArtifact.bytecode,
    wallet
  );
  const payment = await paymentFactory.deploy(wallet.address, registryAddress, treasury);
  await payment.waitForDeployment();
  const paymentAddress = await payment.getAddress();
  console.log(`   ✅ ProxyPayment deployed: ${paymentAddress}`);

  // Configure contracts
  console.log('\n3. Configuring contracts...');

  // Set coordinator on registry (deployer for now)
  const registryContract = new Contract(registryAddress, registryArtifact.abi, wallet);
  await registryContract.setCoordinator(wallet.address);
  console.log('   ✅ Registry coordinator set to deployer');

  // Set coordinator on payment contract
  const paymentContract = new Contract(paymentAddress, paymentArtifact.abi, wallet);
  await paymentContract.setCoordinator(wallet.address);
  console.log('   ✅ Payment coordinator set to deployer');

  // Verify deployment
  console.log('\n4. Verifying deployment...');
  
  const minStake = await registryContract.minNodeStake();
  console.log(`   Registry minNodeStake: ${formatEther(minStake)} ETH`);

  const pricePerGb = await paymentContract.pricePerGb();
  console.log(`   Payment pricePerGb: ${formatEther(pricePerGb)} ETH`);

  const result: DeployResult = {
    proxyRegistry: registryAddress,
    proxyPayment: paymentAddress,
    deployer: wallet.address,
    treasury,
    network: network.name,
    chainId: Number(network.chainId),
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
  bun run apps/compute/src/proxy/coordinator/server.ts
`);

  return result;
}

// Run deployment
deploy().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});


