/**
 * Mainnet Integration Test for Jeju Compute Marketplace
 *
 * This test validates the deployed contracts on Sepolia or Ethereum Mainnet.
 *
 * Prerequisites:
 * 1. Contracts deployed via deploy-base.ts
 * 2. PRIVATE_KEY with funds for testing
 * 3. NETWORK environment variable set
 *
 * Run with:
 *   NETWORK=sepolia PRIVATE_KEY=0x... bun test src/compute/tests/mainnet.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  Contract,
  formatEther,
  JsonRpcProvider,
  keccak256,
  parseEther,
  toUtf8Bytes,
  Wallet,
} from 'ethers';

// Network configurations
const NETWORKS = {
  sepolia: {
    name: 'Sepolia',
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    minBalance: parseEther('0.01'), // Need at least 0.01 ETH
  },
  mainnet: {
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io',
    minBalance: parseEther('0.001'), // Need at least 0.001 ETH
  },
};

// Contract ABIs
const REGISTRY_ABI = [
  'function version() view returns (string)',
  'function register(string name, string endpoint, bytes32 attestationHash) payable returns (address)',
  'function getProvider(address provider) view returns (tuple(address owner, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, bool active))',
  'function isActive(address provider) view returns (bool)',
  'function getActiveProviders() view returns (address[])',
  'function MIN_PROVIDER_STAKE() view returns (uint256)',
];

const LEDGER_ABI = [
  'function version() view returns (string)',
  'function createLedger() payable',
  'function deposit() payable',
  'function getLedger(address user) view returns (tuple(uint256 totalBalance, uint256 availableBalance, uint256 lockedBalance, uint256 createdAt))',
  'function ledgerExists(address user) view returns (bool)',
  'function MIN_DEPOSIT() view returns (uint256)',
];

const INFERENCE_ABI = [
  'function version() view returns (string)',
  'function getServices(address provider) view returns (tuple(address provider, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken, bool active)[])',
  'function calculateFee(address provider, uint256 inputTokens, uint256 outputTokens) view returns (uint256)',
];

const STAKING_ABI = [
  'function version() view returns (string)',
  'function MIN_USER_STAKE() view returns (uint256)',
  'function MIN_PROVIDER_STAKE() view returns (uint256)',
  'function MIN_GUARDIAN_STAKE() view returns (uint256)',
];

// Helper to safely call contract functions
async function callFn<T>(
  contract: Contract,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const fn = contract.getFunction(method);
  return fn(...args) as Promise<T>;
}

interface Deployment {
  network: string;
  chainId: number;
  contracts: {
    registry: string;
    ledger: string;
    inference: string;
    staking: string;
    banManager: string;
  };
}

let provider: JsonRpcProvider;
let wallet: Wallet;
let deployment: Deployment | null = null;
let registry: Contract;
let ledger: Contract;
let inference: Contract;
let staking: Contract;
let networkConfig: (typeof NETWORKS)[keyof typeof NETWORKS];
let skipTests = false;

describe('Mainnet Integration Test', () => {
  beforeAll(async () => {
    const networkName = (
      process.env.NETWORK || 'sepolia'
    ).toLowerCase() as keyof typeof NETWORKS;
    networkConfig = NETWORKS[networkName];

    if (!networkConfig) {
      console.log(`⚠️  Unknown network: ${networkName}. Skipping tests.`);
      skipTests = true;
      return;
    }

    console.log(`\n🧪 Integration Test - ${networkConfig.name}\n`);

    // Load deployment
    try {
      const deploymentPath = `${import.meta.dir}/../../../deployments/${networkName}.json`;
      deployment = await Bun.file(deploymentPath).json();
      console.log(`Loaded deployment from ${deploymentPath}`);
    } catch {
      console.log(
        `⚠️  No deployment found for ${networkName}. Run deploy-base.ts first.`
      );
      skipTests = true;
      return;
    }

    // Check private key
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.log(`⚠️  PRIVATE_KEY not set. Running read-only tests.`);
    }

    // Setup provider
    provider = new JsonRpcProvider(networkConfig.rpcUrl);

    // Verify chain ID
    const chainId = (await provider.getNetwork()).chainId;
    if (Number(chainId) !== networkConfig.chainId) {
      console.log(
        `⚠️  Chain ID mismatch: expected ${networkConfig.chainId}, got ${chainId}`
      );
      skipTests = true;
      return;
    }

    // Setup wallet if key provided
    if (privateKey) {
      wallet = new Wallet(privateKey, provider);
      const balance = await provider.getBalance(wallet.address);
      console.log(`Wallet: ${wallet.address}`);
      console.log(`Balance: ${formatEther(balance)} ETH`);

      if (balance < networkConfig.minBalance) {
        console.log(
          `⚠️  Insufficient balance. Need at least ${formatEther(networkConfig.minBalance)} ETH`
        );
      }
    }

    // Setup contracts (only if deployment loaded)
    if (deployment) {
      const signerOrProvider = wallet || provider;
      registry = new Contract(
        deployment.contracts.registry,
        REGISTRY_ABI,
        signerOrProvider
      );
      ledger = new Contract(
        deployment.contracts.ledger,
        LEDGER_ABI,
        signerOrProvider
      );
      inference = new Contract(
        deployment.contracts.inference,
        INFERENCE_ABI,
        signerOrProvider
      );
      staking = new Contract(
        deployment.contracts.staking,
        STAKING_ABI,
        signerOrProvider
      );

      console.log('\nContracts:');
      console.log(`  Registry:  ${deployment.contracts.registry}`);
      console.log(`  Ledger:    ${deployment.contracts.ledger}`);
      console.log(`  Inference: ${deployment.contracts.inference}`);
      console.log(`  Staking:   ${deployment.contracts.staking}`);
      console.log('');
    }
  });

  afterAll(async () => {
    console.log('\n🏁 Integration tests complete\n');
  });

  describe('Contract Verification', () => {
    test('registry contract is deployed and has version', async () => {
      if (skipTests) return;
      expect(deployment).not.toBeNull();
      if (!deployment) return;

      const code = await provider.getCode(deployment.contracts.registry);
      expect(code).not.toBe('0x');

      const version = await callFn<string>(registry, 'version');
      expect(version).toBe('1.0.0');
    });

    test('ledger contract is deployed and has version', async () => {
      if (skipTests) return;
      expect(deployment).not.toBeNull();
      if (!deployment) return;

      const code = await provider.getCode(deployment.contracts.ledger);
      expect(code).not.toBe('0x');

      const version = await callFn<string>(ledger, 'version');
      expect(version).toBe('1.0.0');
    });

    test('inference contract is deployed and has version', async () => {
      if (skipTests) return;
      expect(deployment).not.toBeNull();
      if (!deployment) return;

      const code = await provider.getCode(deployment.contracts.inference);
      expect(code).not.toBe('0x');

      const version = await callFn<string>(inference, 'version');
      expect(version).toBe('1.0.0');
    });

    test('staking contract is deployed and has version', async () => {
      if (skipTests) return;
      expect(deployment).not.toBeNull();
      if (!deployment) return;

      const code = await provider.getCode(deployment.contracts.staking);
      expect(code).not.toBe('0x');

      const version = await callFn<string>(staking, 'version');
      expect(version).toBe('1.0.0');
    });
  });

  describe('Contract Configuration', () => {
    test('registry has correct minimum stake', async () => {
      if (skipTests || !deployment) return;

      const minStake = await callFn<bigint>(registry, 'MIN_PROVIDER_STAKE');
      expect(minStake).toBe(parseEther('0.01'));
    });

    test('ledger has correct minimum deposit', async () => {
      if (skipTests || !deployment) return;

      const minDeposit = await callFn<bigint>(ledger, 'MIN_DEPOSIT');
      expect(minDeposit).toBe(parseEther('0.001'));
    });

    test('staking has correct stake requirements', async () => {
      if (skipTests || !deployment) return;

      const userStake = await callFn<bigint>(staking, 'MIN_USER_STAKE');
      const providerStake = await callFn<bigint>(staking, 'MIN_PROVIDER_STAKE');
      const guardianStake = await callFn<bigint>(staking, 'MIN_GUARDIAN_STAKE');

      expect(userStake).toBe(parseEther('0.01'));
      expect(providerStake).toBe(parseEther('0.1'));
      expect(guardianStake).toBe(parseEther('1'));
    });
  });

  describe('Read Operations', () => {
    test('can query active providers', async () => {
      if (skipTests || !deployment) return;

      const providers = await callFn<string[]>(registry, 'getActiveProviders');
      expect(Array.isArray(providers)).toBe(true);
      console.log(`  Active providers: ${providers.length}`);
    });

    test('can check if address has ledger', async () => {
      if (skipTests || !deployment || !wallet) return;

      const exists = await callFn<boolean>(
        ledger,
        'ledgerExists',
        wallet.address
      );
      expect(typeof exists).toBe('boolean');
      console.log(`  User has ledger: ${exists}`);
    });
  });

  describe('Write Operations (requires funds)', () => {
    test.skip('can create ledger with deposit', async () => {
      if (skipTests || !deployment || !wallet) return;

      const exists = await callFn<boolean>(
        ledger,
        'ledgerExists',
        wallet.address
      );
      if (exists) {
        console.log('  Ledger already exists, skipping creation');
        return;
      }

      const balance = await provider.getBalance(wallet.address);
      if (balance < parseEther('0.01')) {
        console.log('  Insufficient balance for ledger creation');
        return;
      }

      // Create ledger with minimum deposit
      const fn = ledger.getFunction('createLedger');
      const tx = await fn({ value: parseEther('0.001') });
      await tx.wait();

      const newExists = await callFn<boolean>(
        ledger,
        'ledgerExists',
        wallet.address
      );
      expect(newExists).toBe(true);
    });

    test.skip('can register as provider', async () => {
      if (skipTests || !deployment || !wallet) return;

      const isActive = await callFn<boolean>(
        registry,
        'isActive',
        wallet.address
      );
      if (isActive) {
        console.log('  Already registered as provider, skipping');
        return;
      }

      const balance = await provider.getBalance(wallet.address);
      if (balance < parseEther('0.15')) {
        console.log('  Insufficient balance for provider registration');
        return;
      }

      const attestationHash = keccak256(
        toUtf8Bytes(`jeju-test-${Date.now()}`)
      );

      const fn = registry.getFunction('register');
      const tx = await fn(
        'Test Provider',
        'https://compute.jeju.network/v1',
        attestationHash,
        { value: parseEther('0.1') }
      );
      await tx.wait();

      const newIsActive = await callFn<boolean>(
        registry,
        'isActive',
        wallet.address
      );
      expect(newIsActive).toBe(true);
    });
  });
});

console.log('\n🧪 Integration Test Suite');
console.log('==================================\n');
console.log('Prerequisites:');
console.log(
  '1. Deploy contracts: NETWORK=sepolia PRIVATE_KEY=0x... bun run src/compute/scripts/deploy-base.ts'
);
console.log(
  '2. Run tests: NETWORK=sepolia PRIVATE_KEY=0x... bun test src/compute/tests/mainnet.test.ts'
);
console.log('');
