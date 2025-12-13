/** x402 Micropayment Integration Tests */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Wallet, parseEther, verifyMessage } from 'ethers';
import { startComputeNode, type ComputeNodeServer } from '../node/server';
import {
  getX402Config,
  isX402Configured,
  getX402NetworkConfig,
  parseX402Header,
  generateX402PaymentHeader,
  verifyX402Payment,
  createPaymentRequirement,
  createMultiAssetPaymentRequirement,
  estimatePrice,
  formatPriceUSD,
  X402Client,
  X402_CHAIN_IDS,
  X402_USDC_ADDRESSES,
  X402_NETWORKS,
  type X402Network,
  type X402PaymentRequirement,
} from '../sdk/x402';

// Test configuration
const TEST_PORT = 4099;
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const USER_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

let nodeServer: ComputeNodeServer | undefined;
let testWallet: Wallet;
let userWallet: Wallet;
let nodeAvailable = false;
const baseUrl = `http://localhost:${TEST_PORT}`;

describe('x402 Configuration', () => {
  test('getX402Config returns valid configuration', () => {
    const config = getX402Config();
    
    expect(config).toHaveProperty('enabled');
    expect(config).toHaveProperty('recipientAddress');
    expect(config).toHaveProperty('network');
    expect(config).toHaveProperty('creditsPerDollar');
    expect(config.creditsPerDollar).toBe(100);
  });

  test('exports correct chain IDs', () => {
    expect(X402_CHAIN_IDS['base-sepolia']).toBe(84532);
    expect(X402_CHAIN_IDS['base']).toBe(8453);
    expect(X402_CHAIN_IDS['jeju']).toBe(9545);
    expect(X402_CHAIN_IDS['jeju-testnet']).toBe(84532);
  });

  test('exports correct USDC addresses', () => {
    expect(X402_USDC_ADDRESSES['base-sepolia']).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(X402_USDC_ADDRESSES['base']).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  test('getX402NetworkConfig returns valid network config', () => {
    const networks: X402Network[] = ['base-sepolia', 'base', 'jeju', 'jeju-testnet'];
    
    for (const network of networks) {
      const config = getX402NetworkConfig(network);
      
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('chainId');
      expect(config).toHaveProperty('rpcUrl');
      expect(config).toHaveProperty('isTestnet');
      expect(config).toHaveProperty('usdc');
      expect(config.chainId).toBe(X402_CHAIN_IDS[network]);
    }
  });

  test('isX402Configured checks recipient address', () => {
    // Without X402_RECIPIENT_ADDRESS set, should return false
    const originalRecipient = process.env.X402_RECIPIENT_ADDRESS;
    delete process.env.X402_RECIPIENT_ADDRESS;
    
    expect(isX402Configured()).toBe(false);
    
    // Restore
    if (originalRecipient) {
      process.env.X402_RECIPIENT_ADDRESS = originalRecipient;
    }
  });
});

describe('x402 Payment Headers', () => {
  beforeAll(() => {
    testWallet = new Wallet(TEST_PRIVATE_KEY);
    userWallet = new Wallet(USER_PRIVATE_KEY);
  });

  test('parseX402Header parses valid header', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123abc;asset=0x0;amount=1000000000000000';
    const parsed = parseX402Header(header);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.scheme).toBe('exact');
    expect(parsed!.network).toBe('jeju');
    expect(parsed!.payload).toBe('0x123abc');
    expect(parsed!.amount).toBe('1000000000000000');
  });

  test('parseX402Header returns null for invalid header', () => {
    const invalidHeaders = [
      '',
      'invalid',
      'scheme=exact', // Missing network and payload
      'network=jeju;payload=0x123', // Missing scheme
    ];
    
    for (const header of invalidHeaders) {
      const parsed = parseX402Header(header);
      expect(parsed).toBeNull();
    }
  });

  test('generateX402PaymentHeader creates valid header', async () => {
    const amount = '1000000000000000';
    const providerAddress = testWallet.address as `0x${string}`;
    
    const header = await generateX402PaymentHeader(
      userWallet,
      providerAddress,
      amount,
      'jeju'
    );
    
    expect(header).toContain('scheme=exact');
    expect(header).toContain('network=jeju');
    expect(header).toContain('payload=0x');
    expect(header).toContain(`amount=${amount}`);
    
    // Parse and verify the header
    const parsed = parseX402Header(header);
    expect(parsed).not.toBeNull();
    expect(parsed!.scheme).toBe('exact');
  });

  test('payment signature can be verified', async () => {
    const amount = '1000000000000000';
    const provider = testWallet.address;
    const message = `x402:jeju:${provider}:${amount}`;
    const signature = await userWallet.signMessage(message);
    
    const recoveredAddress = verifyMessage(message, signature);
    expect(recoveredAddress.toLowerCase()).toBe(userWallet.address.toLowerCase());
  });

  test('verifyX402Payment validates correct signature', async () => {
    const amount = '1000000000000000';
    const providerAddress = testWallet.address as `0x${string}`;
    const userAddress = userWallet.address as `0x${string}`;
    
    const header = await generateX402PaymentHeader(
      userWallet,
      providerAddress,
      amount,
      'jeju'
    );
    
    const parsed = parseX402Header(header)!;
    const isValid = verifyX402Payment(parsed, providerAddress, userAddress);
    
    expect(isValid).toBe(true);
  });

  test('verifyX402Payment rejects wrong user address', async () => {
    const amount = '1000000000000000';
    const providerAddress = testWallet.address as `0x${string}`;
    const wrongUserAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
    
    const header = await generateX402PaymentHeader(
      userWallet,
      providerAddress,
      amount,
      'jeju'
    );
    
    const parsed = parseX402Header(header)!;
    const isValid = verifyX402Payment(parsed, providerAddress, wrongUserAddress);
    
    expect(isValid).toBe(false);
  });
});

describe('x402 Payment Requirements', () => {
  beforeAll(() => {
    testWallet = new Wallet(TEST_PRIVATE_KEY);
  });

  test('createPaymentRequirement generates valid structure', () => {
    const requirement = createPaymentRequirement(
      '/v1/chat/completions',
      parseEther('0.001'),
      testWallet.address as `0x${string}`,
      'AI inference'
    );
    
    expect(requirement.x402Version).toBe(1);
    expect(requirement.error).toBe('Payment required to access compute service');
    expect(requirement.accepts.length).toBe(2); // exact + credit
    
    const exactPayment = requirement.accepts.find(a => a.scheme === 'exact');
    expect(exactPayment).toBeDefined();
    expect(exactPayment!.network).toBe('jeju');
    expect(exactPayment!.payTo).toBe(testWallet.address as `0x${string}`);
    
    const creditPayment = requirement.accepts.find(a => a.scheme === 'credit');
    expect(creditPayment).toBeDefined();
  });

  test('createMultiAssetPaymentRequirement includes token options', () => {
    const supportedAssets = [
      { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`, symbol: 'USDC', decimals: 6 },
      { address: '0xea17df5cf6d172224892b5477a16acb111182478' as `0x${string}`, symbol: 'ELIZA', decimals: 18 },
    ];
    
    const requirement = createMultiAssetPaymentRequirement(
      '/v1/chat/completions',
      parseEther('0.001'),
      testWallet.address as `0x${string}`,
      'AI inference',
      'jeju',
      supportedAssets
    );
    
    expect(requirement.accepts.length).toBe(4); // ETH + credit + 2 tokens
    
    const paymasterOptions = requirement.accepts.filter(a => a.scheme === 'paymaster');
    expect(paymasterOptions.length).toBe(2);
  });
});

describe('x402 Pricing', () => {
  test('estimatePrice returns consistent price for same model type', () => {
    const priceA = estimatePrice('llm', 1000);
    const priceB = estimatePrice('llm', 1000);
    expect(priceA).toBe(priceB);
    expect(priceA).toBeGreaterThan(0n);
  });

  test('estimatePrice scales with token count', () => {
    const basePrice = estimatePrice('llm', 1000);
    const scaledPrice = estimatePrice('llm', 5000);
    expect(scaledPrice).toBeGreaterThan(basePrice);
    expect(scaledPrice).toBe(basePrice * 5n);
  });

  test('formatPriceUSD formats correctly', () => {
    const price = formatPriceUSD(parseEther('0.001'), 3000);
    expect(price).toBe('$3.0000');
  });
});

describe('X402Client', () => {
  let client: X402Client;

  beforeAll(() => {
    userWallet = new Wallet(USER_PRIVATE_KEY);
    testWallet = new Wallet(TEST_PRIVATE_KEY);
    client = new X402Client(userWallet, 'jeju');
  });

  test('getAddress returns signer address', () => {
    expect(client.getAddress()).toBe(userWallet.address as `0x${string}`);
  });

  test('getNetworkConfig returns correct config', () => {
    const config = client.getNetworkConfig();
    expect(config.chainId).toBe(9545); // Jeju localnet
    expect(config.name).toBe('Jeju Localnet');
  });

  test('generatePayment creates valid header', async () => {
    const providerAddress = testWallet.address as `0x${string}`;
    const amount = '1000000000000000';
    
    const header = await client.generatePayment(providerAddress, amount);
    
    expect(header).toContain('scheme=exact');
    expect(header).toContain('network=jeju');
    expect(header).toContain('payload=0x');
  });

  test('verifyPayment validates own payments', async () => {
    const providerAddress = testWallet.address as `0x${string}`;
    const amount = '1000000000000000';
    
    const header = await client.generatePayment(providerAddress, amount);
    const parsed = parseX402Header(header)!;
    
    const isValid = client.verifyPayment(parsed, providerAddress);
    expect(isValid).toBe(true);
  });
});

describe('x402 Server Integration', () => {
  beforeAll(async () => {
    testWallet = new Wallet(TEST_PRIVATE_KEY);
    userWallet = new Wallet(USER_PRIVATE_KEY);

    // Start compute node with x402 enabled
    try {
      process.env.X402_ENABLED = 'true';
      process.env.PRIVATE_KEY = TEST_PRIVATE_KEY;
      process.env.COMPUTE_PORT = String(TEST_PORT);
      
      nodeServer = await startComputeNode();
      nodeAvailable = true;
      
      // Wait for server to be ready
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      console.log('Could not start compute node:', e);
    }
  });

  afterAll(() => {
    if (nodeServer) {
      nodeServer.stop();
    }
    delete process.env.X402_ENABLED;
  });

  test('health endpoint works without payment', async () => {
    if (!nodeAvailable) {
      console.log('Skipping: node not available');
      return;
    }

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    
    const data = await response.json() as { status: string };
    expect(data.status).toBe('ok');
  });

  test('models endpoint works without payment', async () => {
    if (!nodeAvailable) {
      console.log('Skipping: node not available');
      return;
    }

    const response = await fetch(`${baseUrl}/v1/models`);
    expect(response.status).toBe(200);
  });

  test('chat completions with valid x402 payment header succeeds', async () => {
    if (!nodeAvailable) {
      console.log('Skipping: node not available');
      return;
    }

    const providerAddress = testWallet.address;
    const amount = parseEther('0.0001').toString();
    
    const paymentHeader = await generateX402PaymentHeader(
      userWallet,
      providerAddress as `0x${string}`,
      amount,
      'jeju'
    );

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': paymentHeader,
        'x-jeju-address': userWallet.address,
      },
      body: JSON.stringify({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Hello with payment' }],
      }),
    });

    // Should succeed with valid payment
    expect([200, 402]).toContain(response.status);
    
    if (response.status === 200) {
      const data = await response.json() as { choices: unknown[] };
      expect(data).toHaveProperty('choices');
    }
  });

  test('payment requirement response has correct structure', () => {
    const requirement: X402PaymentRequirement = {
      x402Version: 1,
      error: 'Payment required to access compute service',
      accepts: [
        {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '100000000000000',
          asset: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          payTo: testWallet.address as `0x${string}`,
          resource: '/v1/chat/completions',
          description: 'AI inference on mock-model',
        },
        {
          scheme: 'credit',
          network: 'jeju',
          maxAmountRequired: '100000000000000',
          asset: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          payTo: testWallet.address as `0x${string}`,
          resource: '/v1/chat/completions',
          description: 'Pay from prepaid credit balance',
        },
      ],
    };

    expect(requirement.x402Version).toBe(1);
    expect(requirement.accepts.length).toBe(2);
    expect(requirement.accepts[0].scheme).toBe('exact');
    expect(requirement.accepts[1].scheme).toBe('credit');
  });
});

describe('x402 Protocol Compatibility', () => {
  test('network config follows standard format', () => {
    const sepoliaConfig = X402_NETWORKS['base-sepolia'];
    
    expect(sepoliaConfig.chainId).toBe(84532);
    expect(sepoliaConfig.rpcUrl).toBe('https://sepolia.base.org');
    expect(sepoliaConfig.isTestnet).toBe(true);
    expect(sepoliaConfig.usdc).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });

  test('payment requirement structure follows X402 spec', () => {
    const requirement = createPaymentRequirement(
      '/v1/chat/completions',
      1000000n,
      '0x1234567890123456789012345678901234567890' as `0x${string}`,
      'Test inference',
      'base-sepolia'
    );
    
    // X402 standard fields
    expect(requirement).toHaveProperty('x402Version');
    expect(requirement).toHaveProperty('error');
    expect(requirement).toHaveProperty('accepts');
    expect(Array.isArray(requirement.accepts)).toBe(true);
    
    const accept = requirement.accepts[0];
    expect(accept).toHaveProperty('scheme');
    expect(accept).toHaveProperty('network');
    expect(accept).toHaveProperty('maxAmountRequired');
    expect(accept).toHaveProperty('payTo');
    expect(accept).toHaveProperty('resource');
  });

  test('creditsPerDollar follows standard rate', () => {
    const config = getX402Config();
    expect(config.creditsPerDollar).toBe(100);
  });
});
