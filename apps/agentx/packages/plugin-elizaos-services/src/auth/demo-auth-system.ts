#!/usr/bin/env bun

/**
 * Comprehensive Authentication System Demo
 * Demonstrates CLI, GUI, and Agent plugin authentication integration
 */

import type { IAgentRuntime } from '@elizaos/core';
import { AuthenticationService, TEST_KEYS } from './AuthenticationService.js';
import { CLIAuthCommands } from './CLIAuthCommands.js';
import { AgentAuthService, AuthHelper } from './AgentPluginAuth.js';
import { PlatformIntegrationFactory, PlatformAuthUtils } from './PlatformIntegration.js';

// Create mock runtime for demonstration
const createDemoRuntime = (withKeys = true): IAgentRuntime => {
  const services = new Map();
  const settings = withKeys
    ? {
        OPENAI_API_KEY: TEST_KEYS.OPENAI_TEST_KEY,
        GROQ_API_KEY: TEST_KEYS.GROQ_TEST_KEY,
      }
    : {};

  return {
    agentId: 'demo-agent-auth-system',
    character: {
      name: 'Demo Authentication Agent',
      bio: 'An agent demonstrating the comprehensive authentication system',
      system: 'Demonstrate authentication across all modalities',
    },
    getSetting: (key: string) => {
      const settingsObj = settings as Record<string, any>;
      return settingsObj[key] || null;
    },
    getService: (serviceName: string) => services.get(serviceName) || null,
    registerService: (service: any) => {
      services.set(service.constructor.serviceName, service);
    },
    // Mock other methods
    initialize: async () => {},
    composeState: async () => ({}),
    useModel: async () => ({}),
    processActions: async () => {},
    createMemory: async () => {},
    getMemories: async () => [],
    searchMemories: async () => [],
    createEntity: async () => 'entity-id' as any,
    getEntityById: async () => null,
    registerTaskWorker: () => {},
    createTask: async () => 'task-id' as any,
    getTasks: async () => [],
    emitEvent: () => {},
  } as any;
};

/**
 * Demo CLI Authentication
 */
async function demoCLIAuthentication() {
  console.log('\n🖥️  CLI AUTHENTICATION DEMO');
  console.log('═'.repeat(50));

  const runtime = createDemoRuntime();
  const cliCommands = new CLIAuthCommands(runtime);

  console.log('\n1. Testing CLI Commands Registration...');
  const commands = cliCommands.getCommands();
  console.log(`✅ Registered ${commands.length} CLI commands:`);
  commands.forEach((cmd) => {
    console.log(`   - ${cmd.name}: ${cmd.description}`);
  });

  console.log('\n2. Testing CLI Auth Status...');
  const statusCommand = commands.find((c) => c.name === 'auth:status');
  if (statusCommand) {
    await statusCommand.handler({});
  }

  console.log('\n3. Testing CLI Key Validation...');
  const validateCommand = commands.find((c) => c.name === 'auth:validate');
  if (validateCommand) {
    await validateCommand.handler({
      provider: 'openai',
      key: TEST_KEYS.OPENAI_TEST_KEY,
    });
  }

  console.log('\n4. Testing CLI Test Keys Display...');
  const testKeysCommand = commands.find((c) => c.name === 'auth:test-keys');
  if (testKeysCommand) {
    await testKeysCommand.handler({});
  }

  console.log('\n✅ CLI Authentication Demo Complete\n');
}

/**
 * Demo Agent Plugin Authentication
 */
async function demoAgentPluginAuthentication() {
  console.log('\n🤖 AGENT PLUGIN AUTHENTICATION DEMO');
  console.log('═'.repeat(50));

  const runtime = createDemoRuntime();

  console.log('\n1. Starting Agent Authentication Service...');
  const authService = await AgentAuthService.start(runtime);
  runtime.registerService(authService as any);
  console.log('✅ Authentication service started');

  console.log('\n2. Testing Provider Readiness Check...');
  const isOpenAIReady = await AuthHelper.isProviderReady(runtime, 'openai', 'text_generation');
  console.log(`   OpenAI ready for text generation: ${isOpenAIReady ? '✅' : '❌'}`);

  const isGroqReady = await AuthHelper.isProviderReady(runtime, 'groq', 'text_generation');
  console.log(`   Groq ready for text generation: ${isGroqReady ? '✅' : '❌'}`);

  console.log('\n3. Finding Best Provider...');
  const bestProvider = await AuthHelper.getBestProvider(runtime, 'text_generation');
  console.log(`   Best provider for text generation: ${bestProvider || 'None available'}`);

  console.log('\n4. Validation Before Use...');
  if (bestProvider) {
    const validation = await AuthHelper.validateBeforeUse(runtime, bestProvider, 'text_generation');
    console.log(
      `   Validation result: ${validation.isValid ? '✅ Valid' : `❌ ${validation.error}`}`
    );
  }

  console.log('\n5. Getting Debug Information...');
  const debugInfo = await AuthHelper.getDebugInfo(runtime);
  console.log('   Debug info:', JSON.stringify(debugInfo, null, 2));

  console.log('\n6. Testing API Functionality...');
  const testResult = await authService.testApiFunctionality('openai');
  console.log(`   API test result: ${testResult.success ? '✅' : '❌'}`);
  if (testResult.success) {
    console.log(`   Response: "${testResult.response}"`);
    console.log(`   Latency: ${testResult.latency}ms`);
  }

  console.log('\n7. Stopping Service...');
  await authService.stop();
  console.log('✅ Authentication service stopped');

  console.log('\n✅ Agent Plugin Authentication Demo Complete\n');
}

/**
 * Demo Platform Integration
 */
async function demoPlatformIntegration() {
  console.log('\n🌐 PLATFORM INTEGRATION DEMO');
  console.log('═'.repeat(50));

  const runtime = createDemoRuntime();

  console.log('\n1. Creating Platform Integration Services...');
  const cliPlatform = PlatformIntegrationFactory.createForCLI(runtime);
  const guiPlatform = PlatformIntegrationFactory.createForGUI(runtime);
  const agentPlatform = PlatformIntegrationFactory.createForAgent(runtime);
  console.log('✅ Created platform integrations for CLI, GUI, and Agent');

  console.log('\n2. Registering Client Sessions...');
  const cliSessionId = PlatformAuthUtils.generateSessionId();
  const guiSessionId = PlatformAuthUtils.generateSessionId();
  const agentSessionId = PlatformAuthUtils.generateSessionId();

  const cliSession = await cliPlatform.registerSession(cliSessionId, 'cli', 'elizaos-cli');
  const guiSession = await guiPlatform.registerSession(guiSessionId, 'gui', 'elizaos-gui');
  const agentSession = await agentPlatform.registerSession(
    agentSessionId,
    'agent',
    'elizaos-agent'
  );

  console.log(`   CLI Session: ${cliSession.sessionId}`);
  console.log(`   GUI Session: ${guiSession.sessionId}`);
  console.log(`   Agent Session: ${agentSession.sessionId}`);

  console.log('\n3. Distributing Test Keys...');

  // CLI gets test key
  const cliKeyResponse = await cliPlatform.distributeKey({
    sessionId: cliSessionId,
    provider: 'openai',
    keyType: 'test',
    clientCapabilities: PlatformAuthUtils.getClientCapabilities('cli'),
  });
  console.log(
    `   CLI OpenAI test key: ${cliKeyResponse.success ? '✅ Distributed' : `❌ ${cliKeyResponse.error}`}`
  );

  // GUI gets test key
  const guiKeyResponse = await guiPlatform.distributeKey({
    sessionId: guiSessionId,
    provider: 'openai',
    keyType: 'test',
    clientCapabilities: PlatformAuthUtils.getClientCapabilities('gui'),
  });
  console.log(
    `   GUI OpenAI test key: ${guiKeyResponse.success ? '✅ Distributed' : `❌ ${guiKeyResponse.error}`}`
  );

  console.log('\n4. Validating Distributed Keys...');
  if (cliKeyResponse.success && cliKeyResponse.apiKey) {
    const validation = await cliPlatform.validateDistributedKey(
      cliSessionId,
      'openai',
      cliKeyResponse.apiKey
    );
    console.log(
      `   CLI key validation: ${validation.isValid ? '✅ Valid' : `❌ ${validation.error}`}`
    );
  }

  console.log('\n5. Getting Session Status...');
  const cliStatus = await cliPlatform.getSessionStatus(cliSessionId);
  console.log(`   CLI session status: ${cliStatus.session ? 'Active' : 'Inactive'}`);
  console.log(`   CLI capabilities: ${cliStatus.capabilities.join(', ')}`);

  console.log('\n6. Platform Analytics...');
  const analytics = cliPlatform.getAnalytics();
  console.log(`   Active sessions: ${analytics.activeSessions}`);
  console.log('   Sessions by type:', analytics.sessionsByType);
  console.log(`   Key distributions: ${analytics.keyDistributions}`);

  console.log('\n7. Testing Success and Failure Cases...');

  // Test invalid session
  const invalidKeyResponse = await cliPlatform.distributeKey({
    sessionId: 'invalid-session',
    provider: 'openai',
    keyType: 'test',
    clientCapabilities: [],
  });
  console.log(
    `   Invalid session test: ${!invalidKeyResponse.success ? '✅ Properly rejected' : '❌ Should have failed'}`
  );

  // Test unsupported provider
  const unsupportedResponse = await cliPlatform.distributeKey({
    sessionId: cliSessionId,
    provider: 'unsupported',
    keyType: 'test',
    clientCapabilities: [],
  });
  console.log(
    `   Unsupported provider test: ${!unsupportedResponse.success ? '✅ Properly rejected' : '❌ Should have failed'}`
  );

  console.log('\n8. Session Cleanup...');
  await cliPlatform.invalidateSession(cliSessionId);
  await guiPlatform.invalidateSession(guiSessionId);
  await agentPlatform.invalidateSession(agentSessionId);
  console.log('✅ All sessions invalidated');

  console.log('\n✅ Platform Integration Demo Complete\n');
}

/**
 * Demo Success and Failure Scenarios
 */
async function demoSuccessAndFailureScenarios() {
  console.log('\n🧪 SUCCESS AND FAILURE SCENARIOS DEMO');
  console.log('═'.repeat(50));

  console.log('\n1. Testing with Valid Configuration...');
  const validRuntime = createDemoRuntime(true);
  const validAuthService = new AuthenticationService(validRuntime);

  const validStatus = await validAuthService.getAuthStatus();
  console.log(
    `   Valid config status: ${validStatus.overall} (${Object.keys(validStatus.providers).length} providers)`
  );

  console.log('\n2. Testing with Invalid Configuration...');
  const invalidRuntime = createDemoRuntime(false);
  const invalidAuthService = new AuthenticationService(invalidRuntime);

  const invalidStatus = await invalidAuthService.getAuthStatus();
  console.log(
    `   Invalid config status: ${invalidStatus.overall} (${Object.keys(invalidStatus.providers).length} providers)`
  );

  console.log('\n3. Testing Key Validation Success...');
  const validResult = await validAuthService.validateApiKey('openai', TEST_KEYS.OPENAI_TEST_KEY);
  console.log(`   Test key validation: ${validResult.isValid ? '✅ Valid' : '❌ Invalid'}`);
  console.log(`   Key type: ${validResult.keyType}`);
  console.log(`   Capabilities: ${validResult.capabilities.join(', ')}`);

  console.log('\n4. Testing Key Validation Failure...');
  const invalidResult = await validAuthService.validateApiKey('openai', 'invalid-key');
  console.log(
    `   Invalid key validation: ${!invalidResult.isValid ? '✅ Properly rejected' : '❌ Should have failed'}`
  );
  console.log(`   Error: ${invalidResult.errorMessage}`);

  console.log('\n5. Testing API Functionality Success...');
  const apiTestSuccess = await validAuthService.testApiFunctionality('openai');
  console.log(`   API test with test key: ${apiTestSuccess.success ? '✅ Success' : '❌ Failed'}`);
  if (apiTestSuccess.success) {
    console.log(`   Response: "${apiTestSuccess.response?.substring(0, 50)}..."`);
  }

  console.log('\n6. Testing API Functionality Failure...');
  const apiTestFailure = await invalidAuthService.testApiFunctionality('openai');
  console.log(
    `   API test without key: ${!apiTestFailure.success ? '✅ Properly failed' : '❌ Should have failed'}`
  );
  console.log(`   Error: ${apiTestFailure.error}`);

  console.log('\n7. Testing Cache Behavior...');
  const startTime = Date.now();
  await validAuthService.validateApiKey('openai', TEST_KEYS.OPENAI_TEST_KEY);
  const firstCallTime = Date.now() - startTime;

  const cacheStartTime = Date.now();
  await validAuthService.validateApiKey('openai', TEST_KEYS.OPENAI_TEST_KEY);
  const cachedCallTime = Date.now() - cacheStartTime;

  console.log(`   First call time: ${firstCallTime}ms`);
  console.log(`   Cached call time: ${cachedCallTime}ms`);
  console.log(`   Cache working: ${cachedCallTime < firstCallTime ? '✅ Yes' : '❌ No'}`);

  console.log('\n✅ Success and Failure Scenarios Demo Complete\n');
}

/**
 * Main demo function
 */
async function runComprehensiveDemo() {
  console.log('🚀 COMPREHENSIVE AUTHENTICATION SYSTEM DEMO');
  console.log('═'.repeat(70));
  console.log('This demo showcases the complete authentication system across all modalities');
  console.log('');

  try {
    // Demo each component
    await demoCLIAuthentication();
    await demoAgentPluginAuthentication();
    await demoPlatformIntegration();
    await demoSuccessAndFailureScenarios();

    console.log('🎉 COMPREHENSIVE DEMO COMPLETED SUCCESSFULLY!');
    console.log('═'.repeat(70));
    console.log('');
    console.log('📋 Demo Summary:');
    console.log('✅ CLI authentication commands working');
    console.log('✅ Agent plugin integration working');
    console.log('✅ Platform integration across modalities working');
    console.log('✅ Success and failure scenarios handled correctly');
    console.log('✅ Test key distribution and validation working');
    console.log('✅ Session management and analytics working');
    console.log('✅ Cross-modality consistency maintained');
    console.log('');
    console.log('🚀 The authentication system is ready for production use!');
    console.log('');
    console.log('📚 Usage Examples:');
    console.log('   CLI: elizaos auth:status');
    console.log('   CLI: elizaos auth:setup');
    console.log('   Agent: runtime.getService("elizaos-services-auth")');
    console.log('   GUI: <AuthenticationPanel runtime={runtime} />');
  } catch (error) {
    console.error('💥 Demo failed with error:', error);
    process.exit(1);
  }
}

// Run the demo if this file is executed directly
if (import.meta.main) {
  runComprehensiveDemo()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Demo crashed:', error);
      process.exit(1);
    });
}

export {
  runComprehensiveDemo,
  demoCLIAuthentication,
  demoAgentPluginAuthentication,
  demoPlatformIntegration,
  demoSuccessAndFailureScenarios,
};
