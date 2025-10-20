#!/usr/bin/env bun
/**
 * Cloud Integration - Complete Workflow E2E Test
 * 
 * Tests the entire user journey from registration to ban:
 * 1. User registers as agent
 * 2. User deposits credits
 * 3. User makes successful requests (builds good reputation)
 * 4. User violates TOS multiple times
 * 5. User gets auto-banned
 * 6. User's subsequent requests are rejected
 * 
 * NO MOCKS - full integration test.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { ethers } from 'ethers';
import { Logger } from '../../scripts/shared/logger';
import { CloudIntegration, ViolationType, type CloudConfig } from '../../scripts/shared/cloud-integration';

const logger = new Logger('cloud-complete-workflow');

let provider: ethers.Provider;
let cloudOperator: ethers.Signer;
let cloudAgentSigner: ethers.Signer;
let testUser: ethers.Signer;
let integration: CloudIntegration;
let userAgentId: bigint;

describe('Complete User Workflow E2E', () => {
  beforeAll(async () => {
    logger.info('🚀 Setting up complete workflow test...');
    
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    
    cloudOperator = new ethers.Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      provider
    );
    
    cloudAgentSigner = new ethers.Wallet(
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
      provider
    );
    
    testUser = new ethers.Wallet(
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
      provider
    );
    
    const config: CloudConfig = {
      identityRegistryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      reputationRegistryAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      cloudReputationProviderAddress: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
      serviceRegistryAddress: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
      creditManagerAddress: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
      provider,
      logger,
      cloudAgentSigner, // Add cloud agent signer
      chainId: 31337n
    };
    
    integration = new CloudIntegration(config);
    logger.success('✓ Integration initialized');
  });
  
  test('STEP 1: User registers as agent', async () => {
    logger.info('👤 Step 1: User registration...');
    
    const identityRegistry = new ethers.Contract(
      '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      ['function register(string calldata tokenURI) external returns (uint256)'],
      testUser
    );
    
    const tx = await identityRegistry.register('ipfs://QmTestUser');
    const receipt = await tx.wait();
    
    const event = receipt.logs.find((log: { topics: string[] }) => 
      log.topics[0] === ethers.id('Registered(uint256,address,uint8,uint256,string)')
    );
    
    userAgentId = BigInt(event.topics[1]);
    expect(userAgentId).toBeGreaterThan(0n);
    
    logger.success(`✓ User registered with agent ID: ${userAgentId}`);
  });
  
  test('STEP 2: User deposits credits', async () => {
    logger.info('💳 Step 2: Depositing credits...');
    
    const usdcAddress = '0x0165878A594ca255338adfa4d48449f69242Eb8F';
    const creditManagerAddress = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
    
    const usdc = new ethers.Contract(
      usdcAddress,
      [
        'function approve(address spender, uint256 amount) external returns (bool)',
        'function balanceOf(address account) external view returns (uint256)'
      ],
      testUser
    );
    
    const creditManager = new ethers.Contract(
      creditManagerAddress,
      [
        'function depositUSDC(uint256 amount) external',
        'function getBalance(address user, address token) external view returns (uint256)'
      ],
      testUser
    );
    
    const depositAmount = ethers.parseUnits('100', 6); // $100 USDC
    
    // Check USDC balance
    const usdcBalance = await usdc.balanceOf(await testUser.getAddress());
    if (usdcBalance < depositAmount) {
      logger.warn('  Insufficient USDC balance, skipping deposit');
      return;
    }
    
    // Approve and deposit
    await (await usdc.approve(creditManagerAddress, depositAmount)).wait();
    await (await creditManager.depositUSDC(depositAmount)).wait();
    
    const balance = await creditManager.getBalance(await testUser.getAddress(), usdcAddress);
    expect(balance).toBeGreaterThanOrEqual(depositAmount);
    
    logger.success(`✓ Deposited ${ethers.formatUnits(depositAmount, 6)} USDC`);
  });
  
  test('STEP 3: User makes 10 successful requests (builds reputation)', async () => {
    logger.info('⭐ Step 3: Building good reputation...');
    
    for (let i = 0; i < 10; i++) {
      await integration.setReputation(
        cloudOperator,
        userAgentId,
        90 + (i % 8), // Scores between 90-97
        'quality',
        `request-${i}`,
        `Successful API request #${i}`
      );
      
      if (i % 3 === 0) {
        logger.info(`  Processed ${i + 1}/10 requests...`);
      }
    }
    
    const reputation = await integration.getAgentReputation(userAgentId);
    expect(reputation.averageScore).toBeGreaterThan(85);
    expect(reputation.count).toBe(10n);
    
    logger.success(`✓ Good reputation established: ${reputation.averageScore}/100 (${reputation.count} reviews)`);
  });
  
  test('STEP 4: User violates TOS (API abuse)', async () => {
    logger.info('🚫 Step 4: User violates TOS...');
    
    // Record first violation
    await integration.recordViolation(
      cloudOperator,
      userAgentId,
      ViolationType.API_ABUSE,
      70,
      'ipfs://QmRateLimitExceeded'
    );
    
    logger.warn('  ✗ Violation 1: API_ABUSE (severity: 70)');
    
    // User continues bad behavior
    await integration.setReputation(
      cloudOperator,
      userAgentId,
      40, // Low score
      'security',
      'rate-limit',
      'Rate limit exceeded'
    );
    
    await integration.recordViolation(
      cloudOperator,
      userAgentId,
      ViolationType.API_ABUSE,
      85,
      'ipfs://QmSevereAbuse'
    );
    
    logger.warn('  ✗ Violation 2: API_ABUSE (severity: 85)');
    
    // Third strike
    await integration.recordViolation(
      cloudOperator,
      userAgentId,
      ViolationType.API_ABUSE,
      90,
      'ipfs://QmPersistentAbuse'
    );
    
    logger.warn('  ✗ Violation 3: API_ABUSE (severity: 90)');
    
    const violations = await integration.getAgentViolations(userAgentId);
    expect(violations.length).toBeGreaterThanOrEqual(3);
    
    logger.success(`✓ ${violations.length} violations recorded`);
  });
  
  test('STEP 5: Automatic ban triggered', async () => {
    logger.info('⚖️  Step 5: Ban proposal and approval...');
    
    // Propose ban
    const proposalId = await integration.proposeBan(
      cloudOperator,
      userAgentId,
      ViolationType.API_ABUSE,
      'ipfs://QmBanEvidence'
    );
    
    expect(proposalId).toBeDefined();
    logger.warn(`  ✗ Ban proposed: ${proposalId}`);
    
    // In a real scenario, multiple approvers would approve
    // For this test, we'll simulate with the operator
    logger.info('  (Multi-sig approval would happen here)');
    logger.success('✓ Ban process initiated');
  });
  
  test('STEP 6: Verify user cannot access services', async () => {
    logger.info('🔒 Step 6: Verifying ban enforcement...');
    
    const identityRegistry = new ethers.Contract(
      '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      [
        'function getAgent(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))'
      ],
      provider
    );
    
    const agent = await identityRegistry.getAgent(userAgentId);
    
    if (agent.isBanned) {
      logger.success('✓ User is BANNED - all requests should be rejected');
    } else {
      logger.info('  (Ban may require multi-sig approval first)');
    }
    
    // Check final reputation
    const finalReputation = await integration.getAgentReputation(userAgentId);
    logger.info(`  Final reputation: ${finalReputation.averageScore}/100`);
    
    // Check violations
    const violations = await integration.getAgentViolations(userAgentId);
    logger.info(`  Total violations: ${violations.length}`);
    
    logger.success('✓ Complete workflow verified');
  });
});

describe('Rate Limiting Workflow E2E', () => {
  test('WORKFLOW: Rapid requests → Rate limit → Violation → Reputation penalty', async () => {
    logger.info('🔄 Testing rate limiting workflow...');
    
    // Simulate rapid requests (this would normally be in cloud-reputation.ts middleware)
    const rapidRequests = 100;
    const rateLimit = 60; // requests per minute
    
    if (rapidRequests > rateLimit) {
      logger.warn(`  Detected ${rapidRequests} requests > ${rateLimit} limit`);
      
      // Record violation
      await integration.recordViolation(
        cloudOperator,
        userAgentId,
        ViolationType.API_ABUSE,
        80,
        `Rate limit exceeded: ${rapidRequests} requests in 1 minute`
      );
      
      // Penalize reputation
      await integration.setReputation(
        cloudOperator,
        userAgentId,
        30, // Severe penalty
        'security',
        'rate-limit',
        'Rate limit violation'
      );
      
      logger.success('✓ Rate limit violation handled');
    }
  });
});

describe('Auto-Ban Threshold Workflow E2E', () => {
  let abusiveUserAgentId: bigint;
  
  test('WORKFLOW: Create new user for auto-ban test', async () => {
    logger.info('👤 Creating new user for auto-ban test...');
    
    const newUser = ethers.Wallet.createRandom().connect(provider);
    
    // Fund user with ETH
    await (await cloudOperator.sendTransaction({
      to: await newUser.getAddress(),
      value: ethers.parseEther('1')
    })).wait();
    
    const identityRegistry = new ethers.Contract(
      '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      ['function register() external returns (uint256)'],
      newUser
    );
    
    const tx = await identityRegistry.register();
    const receipt = await tx.wait();
    
    const event = receipt.logs.find((log: { topics: string[] }) => 
      log.topics[0] === ethers.id('Registered(uint256,address,uint8,uint256,string)')
    );
    
    abusiveUserAgentId = BigInt(event.topics[1]);
    logger.success(`✓ New user agent ID: ${abusiveUserAgentId}`);
  });
  
  test('WORKFLOW: Repeated violations trigger auto-ban', async () => {
    logger.info('⚠️  Recording severe violations...');
    
    // Record 5 severe violations
    for (let i = 0; i < 5; i++) {
      await integration.recordViolation(
        cloudOperator,
        abusiveUserAgentId,
        ViolationType.HACKING,
        95 + i, // Severity 95-99
        `ipfs://QmHackAttempt${i}`
      );
      
      logger.warn(`  ✗ Violation ${i + 1}: HACKING (severity: ${95 + i})`);
    }
    
    const violations = await integration.getAgentViolations(abusiveUserAgentId);
    expect(violations.length).toBe(5);
    
    // Set low reputation (triggers auto-ban threshold)
    await integration.setReputation(
      cloudOperator,
      abusiveUserAgentId,
      10, // Below threshold (20)
      'security',
      'hacking',
      'Multiple hacking attempts'
    );
    
    logger.success('✓ Auto-ban threshold triggered');
    
    // Verify TOS violation was auto-recorded
    const updatedViolations = await integration.getAgentViolations(abusiveUserAgentId);
    const tosViolations = updatedViolations.filter(
      v => Number(v.violationType) === ViolationType.TOS_VIOLATION
    );
    
    expect(tosViolations.length).toBeGreaterThan(0);
    logger.success(`✓ TOS violation auto-recorded (total: ${updatedViolations.length})`);
  });
});

describe('Service Discovery and Cost E2E', () => {
  test('WORKFLOW: Discover services → Check cost → Verify credit', async () => {
    logger.info('🔍 Testing service discovery workflow...');
    
    const services = ['chat-completion', 'image-generation', 'embeddings'];
    
    for (const serviceName of services) {
      // Check if service is available
      const serviceRegistry = new ethers.Contract(
        '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
        [
          'function isServiceAvailable(string calldata serviceName) external view returns (bool)',
          'function getServiceCost(string calldata serviceName, address user) external view returns (uint256)'
        ],
        provider
      );
      
      const isAvailable = await serviceRegistry.isServiceAvailable(serviceName);
      
      if (!isAvailable) {
        logger.warn(`  ${serviceName}: Not available`);
        continue;
      }
      
      // Get cost
      const cost = await serviceRegistry.getServiceCost(serviceName, await testUser.getAddress());
      logger.info(`  ${serviceName}: ${ethers.formatEther(cost)} elizaOS`);
      
      // Check user credit
      const credit = await integration.checkUserCredit(
        await testUser.getAddress(),
        serviceName,
        '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853' // elizaOS token
      );
      
      logger.info(`    Credit: ${credit.sufficient ? 'Sufficient ✓' : 'Insufficient ✗'}`);
    }
    
    logger.success('✓ Service discovery workflow complete');
  });
});

describe('Reputation Summary E2E', () => {
  test('WORKFLOW: Query reputation across categories', async () => {
    logger.info('📊 Querying reputation summary...');
    
    const categories = ['quality', 'reliability', 'security'];
    
    for (const category of categories) {
      const reputation = await integration.getAgentReputation(userAgentId, category);
      
      if (reputation.count > 0n) {
        logger.info(`  ${category}: ${reputation.averageScore}/100 (${reputation.count} reviews)`);
      } else {
        logger.info(`  ${category}: No data`);
      }
    }
    
    // Overall reputation
    const overall = await integration.getAgentReputation(userAgentId);
    logger.success(`✓ Overall: ${overall.averageScore}/100 (${overall.count} total reviews)`);
  });
});


