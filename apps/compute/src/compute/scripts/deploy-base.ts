/**
 * Deploy Jeju Compute Marketplace to Ethereum (Sepolia or Mainnet)
 *
 * This script deploys all compute marketplace contracts to Ethereum.
 *
 * Prerequisites:
 * 1. PRIVATE_KEY environment variable set
 * 2. Sufficient ETH for gas fees
 * 3. Contracts compiled: cd packages/contracts && forge build
 *
 * Usage:
 *   Sepolia: NETWORK=sepolia bun run deploy:sepolia
 *   Mainnet: NETWORK=mainnet bun run deploy:mainnet
 */

import {
  Contract,
  ContractFactory,
  formatEther,
  JsonRpcProvider,
  Wallet,
} from 'ethers';

// Network configurations
const NETWORKS = {
  sepolia: {
    name: 'Sepolia',
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
  },
  mainnet: {
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io',
  },
  anvil: {
    name: 'Anvil (Local)',
    chainId: 31337,
    rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:9545',
    explorer: '',
  },
};

// Contract ABIs (minimal for deployment verification)
const VERSION_ABI = ['function version() view returns (string)'];

interface DeploymentResult {
  network: string;
  chainId: number;
  deployer: string;
  contracts: {
    registry: string;
    ledger: string;
    inference: string;
    staking: string;
    banManager: string;
  };
  timestamp: string;
  txHashes: {
    registry: string;
    ledger: string;
    inference: string;
    staking: string;
    banManager: string;
    authorization: string;
  };
}

async function loadArtifact(contractName: string): Promise<{
  abi: string[];
  bytecode: string;
}> {
  // Load from packages/contracts/out (compute contracts are in src/compute/)
  const artifactsPath = `${import.meta.dir}/../../../../../packages/contracts/out`;
  const artifact = await Bun.file(
    `${artifactsPath}/${contractName}.sol/${contractName}.json`
  ).json();

  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  };
}

async function deploy(): Promise<DeploymentResult> {
  // Get network
  const networkName = (process.env.NETWORK || 'anvil').toLowerCase();
  const network = NETWORKS[networkName as keyof typeof NETWORKS];

  if (!network) {
    throw new Error(
      `Unknown network: ${networkName}. Use: sepolia, mainnet, or anvil`
    );
  }

  // Get private key
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable required');
  }

  console.log(`\n🚀 Deploying Jeju Compute Marketplace\n`);
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`RPC: ${network.rpcUrl}\n`);

  // Setup provider and wallet
  const provider = new JsonRpcProvider(network.rpcUrl);
  const wallet = new Wallet(privateKey, provider);

  // Verify chain ID
  const chainId = (await provider.getNetwork()).chainId;
  if (Number(chainId) !== network.chainId) {
    throw new Error(
      `Chain ID mismatch: expected ${network.chainId}, got ${chainId}`
    );
  }

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${formatEther(balance)} ETH\n`);

  if (balance === BigInt(0)) {
    throw new Error('Deployer has no ETH for gas fees');
  }

  // Estimate total gas needed (rough estimate)
  const estimatedGas = BigInt(5_000_000); // ~5M gas total
  const gasPrice = (await provider.getFeeData()).gasPrice || BigInt(1e9);
  const estimatedCost = estimatedGas * gasPrice;

  console.log(`Estimated deployment cost: ~${formatEther(estimatedCost)} ETH`);

  if (balance < estimatedCost) {
    console.log(`⚠️  Warning: Balance may be insufficient for full deployment`);
  }

  // Confirm mainnet deployment
  if (networkName === 'mainnet') {
    console.log('\n⚠️  MAINNET DEPLOYMENT - This will use real funds!');
    console.log('Press Ctrl+C within 10 seconds to cancel...\n');
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  const txHashes: DeploymentResult['txHashes'] = {
    registry: '',
    ledger: '',
    inference: '',
    staking: '',
    banManager: '',
    authorization: '',
  };

  // Deploy BanManager
  console.log('Deploying BanManager...');
  const banManagerArtifact = await loadArtifact('BanManager');
  const BanManagerFactory = new ContractFactory(
    banManagerArtifact.abi,
    banManagerArtifact.bytecode,
    wallet
  );
  const banManager = await BanManagerFactory.deploy(
    wallet.address,
    wallet.address
  );
  await banManager.waitForDeployment();
  const banManagerAddress = await banManager.getAddress();
  txHashes.banManager = banManager.deploymentTransaction()?.hash || '';
  console.log(`✅ BanManager: ${banManagerAddress}`);

  // Deploy ComputeRegistry
  console.log('Deploying ComputeRegistry...');
  const registryArtifact = await loadArtifact('ComputeRegistry');
  const RegistryFactory = new ContractFactory(
    registryArtifact.abi,
    registryArtifact.bytecode,
    wallet
  );
  const registry = await RegistryFactory.deploy(wallet.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  txHashes.registry = registry.deploymentTransaction()?.hash || '';
  console.log(`✅ ComputeRegistry: ${registryAddress}`);

  // Deploy LedgerManager
  console.log('Deploying LedgerManager...');
  const ledgerArtifact = await loadArtifact('LedgerManager');
  const LedgerFactory = new ContractFactory(
    ledgerArtifact.abi,
    ledgerArtifact.bytecode,
    wallet
  );
  const ledger = await LedgerFactory.deploy(registryAddress, wallet.address);
  await ledger.waitForDeployment();
  const ledgerAddress = await ledger.getAddress();
  txHashes.ledger = ledger.deploymentTransaction()?.hash || '';
  console.log(`✅ LedgerManager: ${ledgerAddress}`);

  // Deploy InferenceServing
  console.log('Deploying InferenceServing...');
  const inferenceArtifact = await loadArtifact('InferenceServing');
  const InferenceFactory = new ContractFactory(
    inferenceArtifact.abi,
    inferenceArtifact.bytecode,
    wallet
  );
  const inference = await InferenceFactory.deploy(
    registryAddress,
    ledgerAddress,
    wallet.address
  );
  await inference.waitForDeployment();
  const inferenceAddress = await inference.getAddress();
  txHashes.inference = inference.deploymentTransaction()?.hash || '';
  console.log(`✅ InferenceServing: ${inferenceAddress}`);

  // Authorize InferenceServing on LedgerManager
  console.log('Authorizing InferenceServing on LedgerManager...');
  const ledgerContract = new Contract(
    ledgerAddress,
    ['function setInferenceContract(address)'],
    wallet
  );
  const setInferenceFn = ledgerContract.getFunction('setInferenceContract');
  const authTx = await setInferenceFn(inferenceAddress);
  await authTx.wait();
  txHashes.authorization = authTx.hash;
  console.log(`✅ Authorization complete`);

  // Deploy ComputeStaking
  console.log('Deploying ComputeStaking...');
  const stakingArtifact = await loadArtifact('ComputeStaking');
  const StakingFactory = new ContractFactory(
    stakingArtifact.abi,
    stakingArtifact.bytecode,
    wallet
  );
  const staking = await StakingFactory.deploy(
    banManagerAddress,
    wallet.address
  );
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();
  txHashes.staking = staking.deploymentTransaction()?.hash || '';
  console.log(`✅ ComputeStaking: ${stakingAddress}`);

  // Final balance
  const finalBalance = await provider.getBalance(wallet.address);
  const gasUsed = balance - finalBalance;
  console.log(`\nGas used: ${formatEther(gasUsed)} ETH`);
  console.log(`Remaining balance: ${formatEther(finalBalance)} ETH`);

  const result: DeploymentResult = {
    network: network.name,
    chainId: network.chainId,
    deployer: wallet.address,
    contracts: {
      registry: registryAddress,
      ledger: ledgerAddress,
      inference: inferenceAddress,
      staking: stakingAddress,
      banManager: banManagerAddress,
    },
    timestamp: new Date().toISOString(),
    txHashes,
  };

  // Save deployment
  const deploymentPath = `${import.meta.dir}/../../../deployments/${networkName}.json`;
  await Bun.write(deploymentPath, JSON.stringify(result, null, 2));
  console.log(`\n📁 Deployment saved to: ${deploymentPath}`);

  // Print summary
  console.log('\n========== DEPLOYMENT SUMMARY ==========\n');
  console.log(`Network: ${result.network}`);
  console.log(`Chain ID: ${result.chainId}`);
  console.log(`Deployer: ${result.deployer}`);
  console.log('');
  console.log('Contracts:');
  console.log(`  BanManager:      ${result.contracts.banManager}`);
  console.log(`  ComputeRegistry: ${result.contracts.registry}`);
  console.log(`  LedgerManager:   ${result.contracts.ledger}`);
  console.log(`  InferenceServing: ${result.contracts.inference}`);
  console.log(`  ComputeStaking:  ${result.contracts.staking}`);
  console.log('');

  if (network.explorer) {
    console.log('Explorer Links:');
    console.log(
      `  BanManager:      ${network.explorer}/address/${result.contracts.banManager}`
    );
    console.log(
      `  ComputeRegistry: ${network.explorer}/address/${result.contracts.registry}`
    );
    console.log(
      `  LedgerManager:   ${network.explorer}/address/${result.contracts.ledger}`
    );
    console.log(
      `  InferenceServing: ${network.explorer}/address/${result.contracts.inference}`
    );
    console.log(
      `  ComputeStaking:  ${network.explorer}/address/${result.contracts.staking}`
    );
  }

  console.log('\n=========================================\n');

  return result;
}

// Validation function
async function validate(networkName: string): Promise<boolean> {
  const network = NETWORKS[networkName as keyof typeof NETWORKS];
  if (!network) {
    throw new Error(`Unknown network: ${networkName}`);
  }

  // Load deployment
  const deploymentPath = `${import.meta.dir}/../../../deployments/${networkName}.json`;
  let deployment: DeploymentResult;

  try {
    deployment = await Bun.file(deploymentPath).json();
  } catch {
    console.log(`No deployment found for ${networkName}`);
    return false;
  }

  console.log(`\n🔍 Validating deployment on ${network.name}\n`);

  const provider = new JsonRpcProvider(network.rpcUrl);

  let allValid = true;

  for (const [name, address] of Object.entries(deployment.contracts)) {
    const code = await provider.getCode(address);
    const hasCode = code !== '0x';

    if (hasCode) {
      // Try to get version
      const contract = new Contract(address, VERSION_ABI, provider);
      try {
        const versionFn = contract.getFunction('version');
        const version = await versionFn();
        console.log(`✅ ${name}: ${address} (v${version})`);
      } catch {
        console.log(`✅ ${name}: ${address} (deployed, no version)`);
      }
    } else {
      console.log(`❌ ${name}: ${address} (NO CODE)`);
      allValid = false;
    }
  }

  console.log(
    `\nValidation: ${allValid ? '✅ All contracts deployed' : '❌ Some contracts missing'}\n`
  );

  return allValid;
}

// Main
async function main() {
  const command = process.argv[2];

  if (command === 'validate') {
    const networkName = process.env.NETWORK || 'anvil';
    await validate(networkName);
  } else {
    await deploy();
  }
}

main().catch((error) => {
  console.error('Deployment failed:', error);
  process.exit(1);
});
