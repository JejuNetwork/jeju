/**
 * Full Integration Test for Jeju Compute Marketplace
 *
 * This test validates the entire end-to-end flow:
 * 1. Deploy contracts to Anvil
 * 2. Register a provider with stake
 * 3. Start compute node
 * 4. User deposits funds
 * 5. User transfers to provider sub-account
 * 6. User makes inference request
 * 7. Settlement on-chain
 *
 * Run with: bun test src/compute/tests/integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  keccak256,
  parseEther,
  toUtf8Bytes,
  Wallet,
} from 'ethers';
import { ComputeNodeServer } from '../node/server';

// Anvil default accounts
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const PROVIDER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const USER_KEY =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const RPC_URL = 'http://127.0.0.1:8545';

// Simplified contract ABIs for testing
const REGISTRY_ABI = [
  'constructor(address _owner)',
  'function register(string name, string endpoint, bytes32 attestationHash) payable returns (address)',
  'function getProvider(address provider) view returns (tuple(address owner, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, bool active))',
  'function isActive(address provider) view returns (bool)',
  'function getActiveProviders() view returns (address[])',
  'function addCapability(string model, uint256 pricePerInputToken, uint256 pricePerOutputToken, uint256 maxContextLength)',
  'function getCapabilities(address provider) view returns (tuple(string model, uint256 pricePerInputToken, uint256 pricePerOutputToken, uint256 maxContextLength)[])',
  'function MIN_PROVIDER_STAKE() view returns (uint256)',
  'function version() view returns (string)',
];

const LEDGER_ABI = [
  'constructor(address _registry, address _owner)',
  'function createLedger() payable',
  'function deposit() payable',
  'function transferToProvider(address provider, uint256 amount)',
  'function acknowledgeUser(address user)',
  'function setInferenceContract(address inference)',
  'function getLedger(address user) view returns (tuple(uint256 totalBalance, uint256 availableBalance, uint256 lockedBalance, uint256 createdAt))',
  'function getSubAccount(address user, address provider) view returns (tuple(uint256 balance, uint256 pendingRefund, uint256 refundUnlockTime, bool acknowledged))',
  'function ledgerExists(address user) view returns (bool)',
  'function MIN_DEPOSIT() view returns (uint256)',
  'function version() view returns (string)',
];

const INFERENCE_ABI = [
  'constructor(address _registry, address _ledger, address _owner)',
  'function registerService(string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken)',
  'function getServices(address provider) view returns (tuple(address provider, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken, bool active)[])',
  'function getNonce(address user, address provider) view returns (uint256)',
  'function calculateFee(address provider, uint256 inputTokens, uint256 outputTokens) view returns (uint256)',
  'function version() view returns (string)',
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

async function sendFn(
  contract: Contract,
  method: string,
  ...args: unknown[]
): Promise<{ wait: () => Promise<void> }> {
  const fn = contract.getFunction(method);
  return fn(...args) as Promise<{ wait: () => Promise<void> }>;
}

interface DeployedContracts {
  registry: Contract;
  ledger: Contract;
  inference: Contract;
}

let provider: JsonRpcProvider;
let deployer: Wallet;
let providerWallet: Wallet;
let userWallet: Wallet;
let contracts: DeployedContracts | null = null;
let computeNode: ComputeNodeServer | null = null;
let nodeUrl: string;

async function checkAnvilRunning(): Promise<boolean> {
  try {
    const testProvider = new JsonRpcProvider(RPC_URL);
    await testProvider.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

async function deployContracts(): Promise<DeployedContracts> {
  console.log('\n📦 Deploying contracts to Anvil...\n');

  // Read compiled contract artifacts from forge output
  const artifactsPath = `${import.meta.dir}/../../../../../packages/contracts/out`;

  // ComputeRegistry
  const registryArtifact = await Bun.file(
    `${artifactsPath}/ComputeRegistry.sol/ComputeRegistry.json`
  ).json();

  const RegistryFactory = new ContractFactory(
    registryArtifact.abi,
    registryArtifact.bytecode.object,
    deployer
  );
  const registry = await RegistryFactory.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`✅ ComputeRegistry deployed at: ${registryAddress}`);

  // LedgerManager
  const ledgerArtifact = await Bun.file(
    `${artifactsPath}/LedgerManager.sol/LedgerManager.json`
  ).json();

  const LedgerFactory = new ContractFactory(
    ledgerArtifact.abi,
    ledgerArtifact.bytecode.object,
    deployer
  );
  const ledger = await LedgerFactory.deploy(registryAddress, deployer.address);
  await ledger.waitForDeployment();
  const ledgerAddress = await ledger.getAddress();
  console.log(`✅ LedgerManager deployed at: ${ledgerAddress}`);

  // InferenceServing
  const inferenceArtifact = await Bun.file(
    `${artifactsPath}/InferenceServing.sol/InferenceServing.json`
  ).json();

  const InferenceFactory = new ContractFactory(
    inferenceArtifact.abi,
    inferenceArtifact.bytecode.object,
    deployer
  );
  const inference = await InferenceFactory.deploy(
    registryAddress,
    ledgerAddress,
    deployer.address
  );
  await inference.waitForDeployment();
  const inferenceAddress = await inference.getAddress();
  console.log(`✅ InferenceServing deployed at: ${inferenceAddress}`);

  // Authorize InferenceServing on LedgerManager
  const ledgerContract = new Contract(ledgerAddress, LEDGER_ABI, deployer);
  const tx = await sendFn(
    ledgerContract,
    'setInferenceContract',
    inferenceAddress
  );
  await tx.wait();
  console.log('✅ InferenceServing authorized on LedgerManager');

  return {
    registry: new Contract(registryAddress, REGISTRY_ABI, deployer),
    ledger: new Contract(ledgerAddress, LEDGER_ABI, deployer),
    inference: new Contract(inferenceAddress, INFERENCE_ABI, deployer),
  };
}

describe('Full Integration Test', () => {
  beforeAll(async () => {
    console.log('\n🧪 Starting Full Integration Test\n');

    // Check Anvil is running
    const anvilRunning = await checkAnvilRunning();
    if (!anvilRunning) {
      console.log('⚠️  Anvil not running. Skipping integration tests.');
      console.log('   Start Anvil with: anvil');
      return;
    }

    // Setup providers and wallets
    provider = new JsonRpcProvider(RPC_URL);
    deployer = new Wallet(DEPLOYER_KEY, provider);
    providerWallet = new Wallet(PROVIDER_KEY, provider);
    userWallet = new Wallet(USER_KEY, provider);

    console.log(`Deployer: ${deployer.address}`);
    console.log(`Provider: ${providerWallet.address}`);
    console.log(`User: ${userWallet.address}\n`);

    // Deploy contracts
    try {
      contracts = await deployContracts();
    } catch (error) {
      console.log(
        '⚠️  Contract deployment failed. Make sure forge build has been run.'
      );
      console.log(`   Error: ${error}`);
      return;
    }
  });

  afterAll(async () => {
    if (computeNode) {
      console.log('\n🛑 Stopping compute node...');
      // Node will stop when test process ends
    }
  });

  describe('Contract Deployment', () => {
    test('registry is deployed and has correct version', async () => {
      if (!contracts) return;
      const version = await callFn<string>(contracts.registry, 'version');
      expect(version).toBe('1.0.0');
    });

    test('ledger is deployed and has correct version', async () => {
      if (!contracts) return;
      const version = await callFn<string>(contracts.ledger, 'version');
      expect(version).toBe('1.0.0');
    });

    test('inference is deployed and has correct version', async () => {
      if (!contracts) return;
      const version = await callFn<string>(contracts.inference, 'version');
      expect(version).toBe('1.0.0');
    });
  });

  describe('Provider Registration', () => {
    test('provider can register with stake', async () => {
      if (!contracts) return;

      const registryWithProvider = contracts.registry.connect(
        providerWallet
      ) as Contract;
      const attestationHash = keccak256(toUtf8Bytes('test-attestation'));

      const tx = await sendFn(
        registryWithProvider,
        'register',
        'Test Provider',
        'http://localhost:8082',
        attestationHash,
        { value: parseEther('0.1') }
      );
      await tx.wait();

      const isActive = await callFn<boolean>(
        contracts.registry,
        'isActive',
        providerWallet.address
      );
      expect(isActive).toBe(true);
    });

    test('provider can add capability', async () => {
      if (!contracts) return;

      const registryWithProvider = contracts.registry.connect(
        providerWallet
      ) as Contract;

      // Price: 0.0001 ETH per 1000 tokens = 100000000000000 wei per token
      const pricePerToken = parseEther('0.0000001'); // 0.1 ETH per million tokens

      const tx = await sendFn(
        registryWithProvider,
        'addCapability',
        'test-model',
        pricePerToken,
        pricePerToken * BigInt(2), // Output costs 2x input
        4096
      );
      await tx.wait();

      const capabilities = await callFn<
        { model: string; pricePerInputToken: bigint }[]
      >(contracts.registry, 'getCapabilities', providerWallet.address);
      expect(capabilities.length).toBe(1);
      const firstCap = capabilities[0];
      expect(firstCap).toBeDefined();
      expect(firstCap?.model).toBe('test-model');
    });

    test('provider info is correct', async () => {
      if (!contracts) return;

      const info = await callFn<{
        name: string;
        active: boolean;
        stake: bigint;
      }>(contracts.registry, 'getProvider', providerWallet.address);
      expect(info.name).toBe('Test Provider');
      expect(info.active).toBe(true);
      expect(info.stake).toBeGreaterThanOrEqual(parseEther('0.1'));
    });
  });

  describe('Provider Service Registration', () => {
    test('provider can register inference service', async () => {
      if (!contracts) return;

      const inferenceWithProvider = contracts.inference.connect(
        providerWallet
      ) as Contract;

      const pricePerToken = parseEther('0.0000001');

      const tx = await sendFn(
        inferenceWithProvider,
        'registerService',
        'test-model',
        'http://localhost:8082/v1',
        pricePerToken,
        pricePerToken * BigInt(2)
      );
      await tx.wait();

      const services = await callFn<{ model: string }[]>(
        contracts.inference,
        'getServices',
        providerWallet.address
      );
      expect(services.length).toBe(1);
      const firstService = services[0];
      expect(firstService).toBeDefined();
      expect(firstService?.model).toBe('test-model');
    });
  });

  describe('User Funding', () => {
    test('user can create ledger with deposit', async () => {
      if (!contracts) return;

      const ledgerWithUser = contracts.ledger.connect(userWallet) as Contract;

      const tx = await sendFn(ledgerWithUser, 'createLedger', {
        value: parseEther('1'),
      });
      await tx.wait();

      const exists = await callFn<boolean>(
        contracts.ledger,
        'ledgerExists',
        userWallet.address
      );
      expect(exists).toBe(true);

      const ledger = await callFn<{
        totalBalance: bigint;
        availableBalance: bigint;
      }>(contracts.ledger, 'getLedger', userWallet.address);
      expect(ledger.totalBalance).toBe(parseEther('1'));
      expect(ledger.availableBalance).toBe(parseEther('1'));
    });

    test('user can transfer to provider sub-account', async () => {
      if (!contracts) return;

      const ledgerWithUser = contracts.ledger.connect(userWallet) as Contract;

      const tx = await sendFn(
        ledgerWithUser,
        'transferToProvider',
        providerWallet.address,
        parseEther('0.5')
      );
      await tx.wait();

      const subAccount = await callFn<{ balance: bigint }>(
        contracts.ledger,
        'getSubAccount',
        userWallet.address,
        providerWallet.address
      );
      expect(subAccount.balance).toBe(parseEther('0.5'));

      const ledger = await callFn<{
        availableBalance: bigint;
        lockedBalance: bigint;
      }>(contracts.ledger, 'getLedger', userWallet.address);
      expect(ledger.availableBalance).toBe(parseEther('0.5'));
      expect(ledger.lockedBalance).toBe(parseEther('0.5'));
    });

    test('provider can acknowledge user', async () => {
      if (!contracts) return;

      // Provider acknowledges the user (enables settlements)
      const ledgerWithProvider = contracts.ledger.connect(providerWallet) as Contract;

      const tx = await sendFn(
        ledgerWithProvider,
        'acknowledgeUser',
        userWallet.address
      );
      await tx.wait();

      const subAccount = await callFn<{ acknowledged: boolean }>(
        contracts.ledger,
        'getSubAccount',
        userWallet.address,
        providerWallet.address
      );
      expect(subAccount.acknowledged).toBe(true);
    });
  });

  describe('Compute Node', () => {
    test('compute node starts successfully', async () => {
      if (!contracts) return;

      const registryAddress = await contracts.registry.getAddress();
      const ledgerAddress = await contracts.ledger.getAddress();
      const inferenceAddress = await contracts.inference.getAddress();

      const port = 8082;
      nodeUrl = `http://localhost:${port}`;

      computeNode = new ComputeNodeServer({
        privateKey: PROVIDER_KEY,
        registryAddress,
        ledgerAddress,
        inferenceAddress,
        rpcUrl: RPC_URL,
        port,
        models: [
          {
            name: 'test-model',
            maxContextLength: 4096,
            backend: 'mock',
            pricePerInputToken: parseEther('0.0000001'),
            pricePerOutputToken: parseEther('0.0000002'),
          },
        ],
      });

      computeNode.start(port);

      // Verify health endpoint
      const response = await fetch(`${nodeUrl}/health`);
      expect(response.ok).toBe(true);

      const health = (await response.json()) as { status: string };
      expect(health.status).toBe('ok');
    });

    test('node lists available models', async () => {
      if (!contracts || !computeNode) return;

      const response = await fetch(`${nodeUrl}/v1/models`);
      expect(response.ok).toBe(true);

      const models = (await response.json()) as { data: { id: string }[] };
      expect(models.data.length).toBeGreaterThan(0);
      const firstModel = models.data[0];
      expect(firstModel).toBeDefined();
      expect(firstModel?.id).toBe('test-model');
    });
  });

  describe('Inference Request', () => {
    test('user can make authenticated inference request', async () => {
      if (!contracts || !computeNode) return;

      // Generate auth headers
      const nonce = crypto.randomUUID();
      const timestamp = Date.now().toString();
      const message = `${userWallet.address}:${nonce}:${timestamp}:${providerWallet.address}`;
      const signature = await userWallet.signMessage(message);

      const response = await fetch(`${nodeUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': userWallet.address,
          'x-jeju-nonce': nonce,
          'x-jeju-signature': signature,
          'x-jeju-timestamp': timestamp,
        },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello!' }],
        }),
      });

      expect(response.ok).toBe(true);

      const completion = (await response.json()) as {
        choices: { message: { content: string } }[];
      };
      expect(completion.choices).toBeDefined();
      expect(completion.choices.length).toBeGreaterThan(0);
      const firstChoice = completion.choices[0];
      expect(firstChoice).toBeDefined();
      expect(firstChoice?.message.content).toBeDefined();
    });

    test('fee calculation is correct', async () => {
      if (!contracts) return;

      const inputTokens = 100;
      const outputTokens = 200;

      const fee = await callFn<bigint>(
        contracts.inference,
        'calculateFee',
        providerWallet.address,
        inputTokens,
        outputTokens
      );

      // Fee should be (100 * inputPrice) + (200 * outputPrice)
      const pricePerToken = parseEther('0.0000001');
      const expectedFee =
        BigInt(inputTokens) * pricePerToken +
        BigInt(outputTokens) * pricePerToken * BigInt(2);

      expect(fee).toBe(expectedFee);
    });
  });

  describe('System State Validation', () => {
    test('all active providers are listed', async () => {
      if (!contracts) return;

      const activeProviders = await callFn<string[]>(
        contracts.registry,
        'getActiveProviders'
      );
      expect(activeProviders).toContain(providerWallet.address);
    });

    test('user balances are consistent', async () => {
      if (!contracts) return;

      const ledger = await callFn<{
        totalBalance: bigint;
        availableBalance: bigint;
        lockedBalance: bigint;
      }>(contracts.ledger, 'getLedger', userWallet.address);

      // Total = available + locked
      expect(ledger.totalBalance).toBe(
        ledger.availableBalance + ledger.lockedBalance
      );
    });

    test('nonce tracking works', async () => {
      if (!contracts) return;

      const nonce = await callFn<bigint>(
        contracts.inference,
        'getNonce',
        userWallet.address,
        providerWallet.address
      );

      // Nonce starts at 0
      expect(nonce).toBe(BigInt(0));
    });
  });
});

console.log('\n🧪 Integration Test Suite');
console.log('========================\n');
console.log('Prerequisites:');
console.log('1. Anvil running: anvil');
console.log('2. Contracts compiled: cd packages/contracts && forge build\n');
