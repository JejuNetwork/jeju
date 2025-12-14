/**
 * Oracle Network Integration Tests
 * 
 * Tests the full oracle flow:
 * 1. Deploy contracts (or use existing)
 * 2. Register operator
 * 3. Form committee
 * 4. Submit reports
 * 5. Verify prices
 * 6. Test disputes
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
  keccak256,
  encodePacked,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';

// Anvil default accounts
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const OPERATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const WORKER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;

// Contract addresses (will be set after deployment or from env)
let FEED_REGISTRY: Address;
let REPORT_VERIFIER: Address;
let COMMITTEE_MANAGER: Address;
let FEE_ROUTER: Address;
let NETWORK_CONNECTOR: Address;

const FEED_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'createFeed',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'symbol', type: 'string' },
          { name: 'baseToken', type: 'address' },
          { name: 'quoteToken', type: 'address' },
          { name: 'decimals', type: 'uint8' },
          { name: 'heartbeatSeconds', type: 'uint32' },
          { name: 'twapWindowSeconds', type: 'uint32' },
          { name: 'minLiquidityUSD', type: 'uint256' },
          { name: 'maxDeviationBps', type: 'uint16' },
          { name: 'minOracles', type: 'uint8' },
          { name: 'quorumThreshold', type: 'uint8' },
          { name: 'requiresConfidence', type: 'bool' },
          { name: 'category', type: 'uint8' },
        ],
      },
    ],
    outputs: [{ name: 'feedId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAllFeeds',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFeed',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'feedId', type: 'bytes32' },
          { name: 'symbol', type: 'string' },
          { name: 'baseToken', type: 'address' },
          { name: 'quoteToken', type: 'address' },
          { name: 'decimals', type: 'uint8' },
          { name: 'heartbeatSeconds', type: 'uint32' },
          { name: 'twapWindowSeconds', type: 'uint32' },
          { name: 'minLiquidityUSD', type: 'uint256' },
          { name: 'maxDeviationBps', type: 'uint16' },
          { name: 'minOracles', type: 'uint8' },
          { name: 'quorumThreshold', type: 'uint8' },
          { name: 'isActive', type: 'bool' },
          { name: 'requiresConfidence', type: 'bool' },
          { name: 'category', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

const REPORT_VERIFIER_ABI = [
  {
    type: 'function',
    name: 'submitReport',
    inputs: [
      {
        name: 'submission',
        type: 'tuple',
        components: [
          {
            name: 'report',
            type: 'tuple',
            components: [
              { name: 'feedId', type: 'bytes32' },
              { name: 'price', type: 'uint256' },
              { name: 'confidence', type: 'uint256' },
              { name: 'timestamp', type: 'uint256' },
              { name: 'round', type: 'uint256' },
              { name: 'sourcesHash', type: 'bytes32' },
            ],
          },
          { name: 'signatures', type: 'bytes[]' },
        ],
      },
    ],
    outputs: [{ name: 'accepted', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getLatestPrice',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [
      { name: 'price', type: 'uint256' },
      { name: 'confidence', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'isValid', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentRound',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setAuthorizedTransmitter',
    inputs: [
      { name: 'transmitter', type: 'address' },
      { name: 'authorized', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const COMMITTEE_MANAGER_ABI = [
  {
    type: 'function',
    name: 'setGlobalAllowlist',
    inputs: [
      { name: 'operators', type: 'address[]' },
      { name: 'allowed', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addMember',
    inputs: [
      { name: 'feedId', type: 'bytes32' },
      { name: 'member', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'formCommittee',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: 'round', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isCommitteeMember',
    inputs: [
      { name: 'feedId', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

describe('Oracle Network Integration', () => {
  let publicClient: ReturnType<typeof createPublicClient>;
  let deployerClient: ReturnType<typeof createWalletClient>;
  let workerClient: ReturnType<typeof createWalletClient>;
  let feedId: Hex;

  beforeAll(async () => {
    // Setup clients
    publicClient = createPublicClient({
      chain: foundry,
      transport: http(RPC_URL),
    });

    const deployerAccount = privateKeyToAccount(DEPLOYER_KEY);
    const workerAccount = privateKeyToAccount(WORKER_KEY);

    deployerClient = createWalletClient({
      account: deployerAccount,
      chain: foundry,
      transport: http(RPC_URL),
    });

    workerClient = createWalletClient({
      account: workerAccount,
      chain: foundry,
      transport: http(RPC_URL),
    });

    // Get contract addresses from env or use defaults
    FEED_REGISTRY = (process.env.FEED_REGISTRY_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address;
    REPORT_VERIFIER = (process.env.REPORT_VERIFIER_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address;
    COMMITTEE_MANAGER = (process.env.COMMITTEE_MANAGER_ADDRESS || '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0') as Address;
    FEE_ROUTER = (process.env.FEE_ROUTER_ADDRESS || '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9') as Address;
    NETWORK_CONNECTOR = (process.env.NETWORK_CONNECTOR_ADDRESS || '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9') as Address;

    console.log('Contract addresses:');
    console.log(`  FeedRegistry: ${FEED_REGISTRY}`);
    console.log(`  ReportVerifier: ${REPORT_VERIFIER}`);
    console.log(`  CommitteeManager: ${COMMITTEE_MANAGER}`);
  });

  test('should have deployed contracts', async () => {
    const code = await publicClient.getCode({ address: FEED_REGISTRY });
    expect(code).toBeDefined();
    expect(code!.length).toBeGreaterThan(2);
  });

  test('should list feeds', async () => {
    const feeds = await publicClient.readContract({
      address: FEED_REGISTRY,
      abi: FEED_REGISTRY_ABI,
      functionName: 'getAllFeeds',
    });

    expect(Array.isArray(feeds)).toBe(true);
    console.log(`Found ${feeds.length} feeds`);

    if (feeds.length > 0) {
      feedId = feeds[0];
      console.log(`Using feed: ${feedId}`);
    }
  });

  test('should create a test feed if none exist', async () => {
    const feeds = await publicClient.readContract({
      address: FEED_REGISTRY,
      abi: FEED_REGISTRY_ABI,
      functionName: 'getAllFeeds',
    });

    if (feeds.length === 0) {
      console.log('Creating test feed...');

      const hash = await deployerClient.writeContract({
        address: FEED_REGISTRY,
        abi: FEED_REGISTRY_ABI,
        functionName: 'createFeed',
        args: [
          {
            symbol: 'TEST-USD',
            baseToken: '0x0000000000000000000000000000000000000001',
            quoteToken: '0x0000000000000000000000000000000000000002',
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: parseEther('1000'),
            maxDeviationBps: 100,
            minOracles: 1, // Allow single signer for testing
            quorumThreshold: 1,
            requiresConfidence: false,
            category: 0,
          },
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe('success');

      // Get the created feed ID
      const newFeeds = await publicClient.readContract({
        address: FEED_REGISTRY,
        abi: FEED_REGISTRY_ABI,
        functionName: 'getAllFeeds',
      });

      feedId = newFeeds[newFeeds.length - 1];
      console.log(`Created feed: ${feedId}`);
    }
  });

  test('should authorize worker as transmitter', async () => {
    const workerAddress = privateKeyToAccount(WORKER_KEY).address;

    const hash = await deployerClient.writeContract({
      address: REPORT_VERIFIER,
      abi: REPORT_VERIFIER_ABI,
      functionName: 'setAuthorizedTransmitter',
      args: [workerAddress, true],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('success');
    console.log(`Authorized ${workerAddress} as transmitter`);
  });

  test('should setup committee for feed', async () => {
    if (!feedId) {
      console.log('Skipping - no feed ID');
      return;
    }

    const workerAddress = privateKeyToAccount(WORKER_KEY).address;

    // Add worker to global allowlist
    await deployerClient.writeContract({
      address: COMMITTEE_MANAGER,
      abi: COMMITTEE_MANAGER_ABI,
      functionName: 'setGlobalAllowlist',
      args: [[workerAddress], true],
    });

    // Add worker to committee
    const hash = await deployerClient.writeContract({
      address: COMMITTEE_MANAGER,
      abi: COMMITTEE_MANAGER_ABI,
      functionName: 'addMember',
      args: [feedId, workerAddress],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('success');

    // Verify membership
    const isMember = await publicClient.readContract({
      address: COMMITTEE_MANAGER,
      abi: COMMITTEE_MANAGER_ABI,
      functionName: 'isCommitteeMember',
      args: [feedId, workerAddress],
    });

    expect(isMember).toBe(true);
    console.log(`Worker is committee member: ${isMember}`);
  });

  test('should submit a price report', async () => {
    if (!feedId) {
      console.log('Skipping - no feed ID');
      return;
    }

    // Get current round
    const currentRound = await publicClient.readContract({
      address: REPORT_VERIFIER,
      abi: REPORT_VERIFIER_ABI,
      functionName: 'getCurrentRound',
      args: [feedId],
    });

    const newRound = currentRound + 1n;
    const price = 350000000000n; // $3500.00000000
    const confidence = 9500n;
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const sourcesHash = keccak256(encodePacked(['string'], ['test-source']));

    // Create report
    const report = {
      feedId,
      price,
      confidence,
      timestamp,
      round: newRound,
      sourcesHash,
    };

    // Compute report hash
    const reportHash = keccak256(
      encodePacked(
        ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
        [report.feedId, report.price, report.confidence, report.timestamp, report.round, report.sourcesHash]
      )
    );

    // Sign the report
    const workerAccount = privateKeyToAccount(WORKER_KEY);
    const signature = await workerAccount.signMessage({
      message: { raw: toBytes(reportHash) },
    });

    // Submit report
    const hash = await workerClient.writeContract({
      address: REPORT_VERIFIER,
      abi: REPORT_VERIFIER_ABI,
      functionName: 'submitReport',
      args: [
        {
          report,
          signatures: [signature],
        },
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('success');
    console.log(`Report submitted in tx: ${receipt.transactionHash}`);
  });

  test('should read the submitted price', async () => {
    if (!feedId) {
      console.log('Skipping - no feed ID');
      return;
    }

    const [latestPrice, confidence, timestamp, isValid] = await publicClient.readContract({
      address: REPORT_VERIFIER,
      abi: REPORT_VERIFIER_ABI,
      functionName: 'getLatestPrice',
      args: [feedId],
    });

    console.log(`Latest price: ${latestPrice} (confidence: ${confidence}, valid: ${isValid})`);

    expect(latestPrice).toBeGreaterThan(0n);
    expect(isValid).toBe(true);
  });
});

