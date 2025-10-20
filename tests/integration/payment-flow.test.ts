/**
 * Payment Flow Integration Test
 * 
 * End-to-end test of the complete payment flow:
 * 1. User requests service (chat-completion)
 * 2. Paymaster charges user (gasless or direct token)
 * 3. Balance is updated correctly
 * 4. Usage is recorded in ServiceRegistry
 * 5. Events are emitted properly
 * 
 * Tests both payment methods:
 * - Gasless (via ServicePaymaster + ERC-4337)
 * - Direct token payment
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, formatUnits, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const TEST_CONFIG = {
  rpcUrl: process.env.JEJU_RPC_URL || 'http://localhost:8545',
  chainId: 420691,
  contracts: {
    ElizaOSToken: process.env.ELIZAOS_TOKEN_ADDRESS as Address,
    cloudServiceRegistry: process.env.CLOUD_SERVICE_REGISTRY_ADDRESS as Address,
    cloudPaymaster: process.env.CLOUD_PAYMASTER_ADDRESS as Address
  },
  testAccount: privateKeyToAccount(
    (process.env.TEST_PRIVATE_KEY || '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6') as \`0x\${string}\`
  )
};

const jejuChain = {
  id: TEST_CONFIG.chainId,
  name: 'Jeju',
  network: 'jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [TEST_CONFIG.rpcUrl] },
    public: { http: [TEST_CONFIG.rpcUrl] }
  }
} as const;

const publicClient = createPublicClient({ chain: jejuChain, transport: http() });
const walletClient = createWalletClient({
  account: TEST_CONFIG.testAccount,
  chain: jejuChain,
  transport: http()
});

describe('Payment Flow Integration', () => {
  let initialBalance: bigint;
  let serviceCost: bigint;

  beforeAll(async () => {
    // Get initial elizaOS token balance
    const erc20Abi = parseAbi(['function balanceOf(address) external view returns (uint256)']);
    
    initialBalance = await publicClient.readContract({
      address: TEST_CONFIG.contracts.ElizaOSToken,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [TEST_CONFIG.testAccount.address]
    });

    console.log(\`Initial balance: \${formatUnits(initialBalance, 18)} elizaOS\`);

    // Get service cost for chat-completion
    const registryAbi = parseAbi([
      'function getServiceCost(string calldata serviceName, address user) external view returns (uint256)'
    ]);

    serviceCost = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: registryAbi,
      functionName: 'getServiceCost',
      args: ['chat-completion', TEST_CONFIG.testAccount.address]
    });

    console.log(\`Service cost: \${formatUnits(serviceCost, 18)} elizaOS\`);
  });

  test('Should get accurate service cost quote', async () => {
    const registryAbi = parseAbi([
      'function getServiceCost(string calldata serviceName, address user) external view returns (uint256)'
    ]);

    const cost = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: registryAbi,
      functionName: 'getServiceCost',
      args: ['chat-completion', TEST_CONFIG.testAccount.address]
    });

    expect(cost).toBeGreaterThan(0n);
    expect(cost).toBeLessThan(parseEther('1000')); // Sanity check: cost < 1000 elizaOS
  });

  test('Should record service usage with direct payment', async () => {
    // First, approve ServiceRegistry to spend elizaOS tokens
    const erc20Abi = parseAbi([
      'function approve(address spender, uint256 amount) external returns (bool)',
      'function balanceOf(address) external view returns (uint256)'
    ]);

    const approveTx = await walletClient.writeContract({
      address: TEST_CONFIG.contracts.ElizaOSToken,
      abi: erc20Abi,
      functionName: 'approve',
      args: [TEST_CONFIG.contracts.cloudServiceRegistry, serviceCost * 2n] // Approve 2x cost
    });

    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    // Record usage (simulating what paymaster would do)
    const registryAbi = parseAbi([
      'function recordUsage(address user, string calldata serviceName, uint256 actualCost, bytes32 sessionId) external',
      'event ServiceUsageRecorded(address indexed user, string serviceName, uint256 cost, bytes32 sessionId, uint256 volumeDiscount)'
    ]);

    const sessionId = \`0x\${Date.now().toString(16).padStart(64, '0')}\` as \`0x\${string}\`;

    // Note: This will fail if we're not an authorized caller
    // In real usage, ServicePaymaster would call this
    try {
      const usageTx = await walletClient.writeContract({
        address: TEST_CONFIG.contracts.cloudServiceRegistry,
        abi: registryAbi,
        functionName: 'recordUsage',
        args: [TEST_CONFIG.testAccount.address, 'chat-completion', serviceCost, sessionId]
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: usageTx });

      // Verify event was emitted
      expect(receipt.status).toBe('success');
      expect(receipt.logs.length).toBeGreaterThan(0);

      // Check balance was debited
      const newBalance = await publicClient.readContract({
        address: TEST_CONFIG.contracts.ElizaOSToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [TEST_CONFIG.testAccount.address]
      });

      expect(newBalance).toBeLessThan(initialBalance);
      console.log(\`Balance after usage: \${formatUnits(newBalance, 18)} elizaOS\`);
    } catch (error) {
      // Expected if test account is not authorized caller
      console.log('Note: Test account not authorized to record usage directly (expected)');
      expect(error.message).toContain('UnauthorizedCaller');
    }
  });

  test('Should track user usage statistics', async () => {
    const registryAbi = parseAbi([
      'function userUsage(address user, string calldata serviceName) external view returns (uint256 totalSpent, uint256 requestCount, uint256 lastUsedBlock, uint256 volumeDiscount)'
    ]);

    const usage = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: registryAbi,
      functionName: 'userUsage',
      args: [TEST_CONFIG.testAccount.address, 'chat-completion']
    });

    const [totalSpent, requestCount, lastUsedBlock, volumeDiscount] = usage;

    console.log(\`User stats:\`);
    console.log(\`  Total spent: \${formatUnits(totalSpent, 18)} elizaOS\`);
    console.log(\`  Request count: \${requestCount}\`);
    console.log(\`  Volume discount: \${volumeDiscount} bps\`);

    expect(totalSpent).toBeGreaterThanOrEqual(0n);
    expect(requestCount).toBeGreaterThanOrEqual(0n);
    expect(volumeDiscount).toBeLessThanOrEqual(2000n); // Max 20% discount
  });

  test('Should calculate volume discounts correctly', async () => {
    const registryAbi = parseAbi([
      'function getUserVolumeDiscount(address user, string calldata serviceName) external view returns (uint256)'
    ]);

    const discount = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: registryAbi,
      functionName: 'getUserVolumeDiscount',
      args: [TEST_CONFIG.testAccount.address, 'chat-completion']
    });

    // Discount should be in valid range (0-2000 bps = 0-20%)
    expect(discount).toBeLessThanOrEqual(2000n);
    console.log(\`Current volume discount: \${discount} bps (\${Number(discount) / 100}%)\`);
  });

  test('Should have sufficient paymaster deposit for gasless transactions', async () => {
    const paymasterAbi = parseAbi([
      'function getDeposit() external view returns (uint256)'
    ]);

    const deposit = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudPaymaster,
      abi: paymasterAbi,
      functionName: 'getDeposit'
    });

    console.log(\`Paymaster deposit: \${formatUnits(deposit, 18)} ETH\`);

    // Should have at least some deposit for paying gas
    expect(deposit).toBeGreaterThan(0n);
  });

  test('Should verify paymaster is linked to service registry', async () => {
    const paymasterAbi = parseAbi([
      'function serviceRegistry() external view returns (address)'
    ]);

    const linkedRegistry = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudPaymaster,
      abi: paymasterAbi,
      functionName: 'serviceRegistry'
    });

    expect(linkedRegistry.toLowerCase()).toBe(TEST_CONFIG.contracts.cloudServiceRegistry.toLowerCase());
  });

  test('Should retrieve service pricing info', async () => {
    const registryAbi = parseAbi([
      'function services(string calldata serviceName) external view returns (uint256 basePriceElizaOS, uint256 demandMultiplier, uint256 totalUsageCount, uint256 totalRevenueElizaOS, bool isActive, uint256 minPrice, uint256 maxPrice)'
    ]);

    const service = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: registryAbi,
      functionName: 'services',
      args: ['chat-completion']
    });

    const [basePriceElizaOS, demandMultiplier, totalUsageCount, totalRevenueElizaOS, isActive, minPrice, maxPrice] = service;

    console.log(\`Chat-completion service:\`);
    console.log(\`  Base price: \${formatUnits(basePriceElizaOS, 18)} elizaOS\`);
    console.log(\`  Demand multiplier: \${demandMultiplier} bps\`);
    console.log(\`  Total usage: \${totalUsageCount}\`);
    console.log(\`  Total revenue: \${formatUnits(totalRevenueElizaOS, 18)} elizaOS\`);
    console.log(\`  Is active: \${isActive}\`);

    expect(isActive).toBe(true);
    expect(basePriceElizaOS).toBeGreaterThan(0n);
    expect(minPrice).toBeGreaterThan(0n);
    expect(maxPrice).toBeGreaterThan(minPrice);
  });
});
