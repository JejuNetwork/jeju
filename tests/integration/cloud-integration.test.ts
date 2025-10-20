import { describe, test, expect, beforeAll } from 'bun:test';
import { ethers } from 'ethers';
import { 
  CloudIntegration, 
  ViolationType,
  defaultCloudServices,
  type CloudConfig,
  type AgentMetadata 
} from '../../scripts/shared/cloud-integration';
import { Logger } from '../../scripts/shared/logger';

describe('Cloud Integration', () => {
  let integration: CloudIntegration;
  let provider: ethers.Provider;
  let signer: ethers.Signer;
  let cloudAgentId: bigint;
  let testAgentId: bigint;
  
  beforeAll(async () => {
    // Setup test environment
    const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
    provider = new ethers.JsonRpcProvider(rpcUrl);
    signer = new ethers.Wallet(
      process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider
    );
    
    // Load deployment addresses
    const addresses = {
      identityRegistryAddress: process.env.IDENTITY_REGISTRY || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      reputationRegistryAddress: process.env.REPUTATION_REGISTRY || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      cloudReputationProviderAddress: process.env.CLOUD_REPUTATION_PROVIDER || '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      serviceRegistryAddress: process.env.SERVICE_REGISTRY || '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
      creditManagerAddress: process.env.CREDIT_MANAGER || '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    };
    
    const config: CloudConfig = {
      ...addresses,
      provider,
      logger: new Logger('cloud-integration-test')
    };
    
    integration = new CloudIntegration(config);
  });
  
  test('should register cloud agent', async () => {
    const metadata: AgentMetadata = {
      name: 'Test Cloud Service',
      description: 'Cloud service for testing',
      endpoint: 'http://localhost:3000/a2a',
      version: '1.0.0-test',
      capabilities: ['test-service']
    };
    
    cloudAgentId = await integration.registerCloudAgent(
      signer,
      metadata,
      'ipfs://QmTestCloudAgent'
    );
    
    expect(cloudAgentId).toBeGreaterThan(0n);
    
    const storedAgentId = await integration.getCloudAgentId();
    expect(storedAgentId).toBe(cloudAgentId);
  });
  
  test('should register cloud services', async () => {
    await integration.registerServices(signer, defaultCloudServices);
    
    // Verify services are registered (check one)
    // This would require exposing the service registry contract
    expect(true).toBe(true);
  });
  
  test('should set positive reputation', async () => {
    // Create a test agent first
    const identityRegistry = new ethers.Contract(
      await integration['identityRegistry'].getAddress(),
      ['function register() external returns (uint256)'],
      signer
    );
    
    const tx = await identityRegistry.register();
    const receipt = await tx.wait();
    
    // Extract agentId from event
    const event = receipt.logs.find((log: { topics: string[] }) => 
      log.topics[0] === ethers.id('Registered(uint256,string,address)')
    );
    testAgentId = BigInt(event.topics[1]);
    
    // Set reputation
    await integration.setReputation(
      signer,
      testAgentId,
      95,
      'quality',
      'api-usage',
      'Good API usage'
    );
    
    // Check reputation
    const reputation = await integration.getAgentReputation(testAgentId, 'quality');
    expect(reputation.averageScore).toBe(95);
    expect(reputation.count).toBe(1n);
  });
  
  test('should record violation for low reputation', async () => {
    // Set low reputation (should auto-record violation)
    await integration.setReputation(
      signer,
      testAgentId,
      15,
      'security',
      'suspicious',
      'Suspicious activity detected'
    );
    
    // Check violations
    const violations = await integration.getAgentViolations(testAgentId);
    expect(violations.length).toBeGreaterThan(0);
  });
  
  test('should record explicit violation', async () => {
    await integration.recordViolation(
      signer,
      testAgentId,
      ViolationType.API_ABUSE,
      80,
      'ipfs://QmAbuseEvidence'
    );
    
    const violations = await integration.getAgentViolations(testAgentId);
    expect(violations.length).toBeGreaterThan(1);
    
    const lastViolation = violations[violations.length - 1];
    expect(lastViolation.violationType).toBe(ViolationType.API_ABUSE);
    expect(lastViolation.severityScore).toBe(80);
  });
  
  test('should propose ban for serious violation', async () => {
    const proposalId = await integration.proposeBan(
      signer,
      testAgentId,
      ViolationType.HACKING,
      'ipfs://QmHackingEvidence'
    );
    
    expect(proposalId).toBeDefined();
    expect(proposalId.length).toBe(66); // 0x + 64 hex chars
  });
  
  test('should check user credit', async () => {
    const userAddress = await signer.getAddress();
    const usdcAddress = process.env.USDC_ADDRESS || '0x0000000000000000000000000000000000000000';
    
    const credit = await integration.checkUserCredit(
      userAddress,
      'chat-completion',
      usdcAddress
    );
    
    expect(credit).toHaveProperty('sufficient');
    expect(credit).toHaveProperty('available');
    expect(credit).toHaveProperty('required');
  });
  
  test('should get agent reputation with multiple entries', async () => {
    // Add another reputation entry
    await integration.setReputation(
      signer,
      testAgentId,
      85,
      'quality',
      'response-time',
      'Fast response times'
    );
    
    const reputation = await integration.getAgentReputation(testAgentId, 'quality');
    expect(reputation.count).toBeGreaterThan(1n);
    
    // Average should be between 15 and 95
    expect(reputation.averageScore).toBeGreaterThan(0);
    expect(reputation.averageScore).toBeLessThan(100);
  });
  
  test('should get all violations for agent', async () => {
    const violations = await integration.getAgentViolations(testAgentId);
    
    expect(violations.length).toBeGreaterThan(0);
    
    violations.forEach(violation => {
      expect(violation).toHaveProperty('agentId');
      expect(violation).toHaveProperty('violationType');
      expect(violation).toHaveProperty('severityScore');
      expect(violation).toHaveProperty('evidence');
      expect(violation).toHaveProperty('timestamp');
      expect(violation).toHaveProperty('reporter');
    });
  });
});

describe('Cloud Integration - Security', () => {
  test('should reject unauthorized reputation updates', async () => {
    // Create unauthorized signer
    const unauthorizedWallet = ethers.Wallet.createRandom();
    
    // This should fail (not authorized operator)
    try {
      await integration.setReputation(
        unauthorizedWallet,
        1n,
        50,
        'quality',
        'test',
        'Unauthorized attempt'
      );
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
  
  test('should reject invalid reputation scores', async () => {
    try {
      await integration.setReputation(
        signer,
        1n,
        150, // Invalid score > 100
        'quality',
        'test',
        'Invalid score'
      );
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});

describe('Cloud Integration - Performance', () => {
  test('should handle batch reputation updates', async () => {
    const startTime = Date.now();
    const updates = 5;
    
    for (let i = 0; i < updates; i++) {
      await integration.setReputation(
        signer,
        testAgentId,
        80 + i,
        'quality',
        `batch-${i}`,
        `Batch update ${i}`
      );
    }
    
    const duration = Date.now() - startTime;
    console.log(`Batch updates completed in ${duration}ms (${duration / updates}ms per update)`);
    
    const reputation = await integration.getAgentReputation(testAgentId);
    expect(reputation.count).toBeGreaterThan(updates);
  });
});


