#!/usr/bin/env node

/**
 * Script to verify sandbox-based Claude Code generation works
 *
 * Usage:
 *   ANTHROPIC_API_KEY=your_key E2B_API_KEY=your_key node scripts/verify-sandbox.js
 */

console.log('🧪 Verifying Sandbox-based Claude Code Generation\n');

// Check environment variables
const requiredEnvVars = ['ANTHROPIC_API_KEY', 'E2B_API_KEY'];
const missing = requiredEnvVars.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:', missing.join(', '));
  console.log('\nPlease set:');
  missing.forEach((key) => console.log(`  export ${key}=your_api_key_here`));
  process.exit(1);
}

console.log('✅ API keys configured\n');

// Quick test to verify the concept
async function testSandboxGeneration() {
  try {
    // Import required modules
    const { E2BService } = await import('@elizaos/plugin-e2b');
    const { CodeGenerationService } = await import('../dist/services/CodeGenerationService.js');
    const { elizaLogger } = await import('@elizaos/core');

    console.log('📦 Modules loaded\n');

    // Create a minimal runtime mock
    const e2bService = new E2BService();

    const mockRuntime = {
      agentId: 'test-agent',
      getSetting: (key) => process.env[key],
      getService: (name) => {
        if (name === 'e2b') return e2bService;
        if (name === 'forms') return { createForm: async () => ({ id: 'test-form' }) };
        return null;
      },
      logger: elizaLogger,
    };

    // Start E2B service
    console.log('🚀 Starting E2B service...');
    await e2bService.start();
    console.log('✅ E2B service started\n');

    // Create code generation service
    const codeGenService = new CodeGenerationService(mockRuntime);
    codeGenService.e2bService = e2bService;
    codeGenService.formsService = mockRuntime.getService('forms');

    console.log('🧪 Testing sandbox code generation...\n');

    // Simple test request
    const testRequest = {
      projectName: 'test-hello-plugin',
      description: 'A simple test plugin that says hello',
      targetType: 'plugin',
      requirements: [
        'Create a simple hello action',
        'Include TypeScript types',
        'Add a basic test',
      ],
      apis: [],
      testScenarios: ['Test that hello action works'],
    };

    console.log('📋 Request:', JSON.stringify(testRequest, null, 2), '\n');

    // Run generation
    console.log('⏳ Generating code (this may take a few minutes)...\n');
    const result = await codeGenService.generateCode(testRequest);

    if (result.success) {
      console.log('✅ Code generation successful!\n');
      console.log('📊 Results:');
      console.log(`  Files created: ${result.files?.length || 0}`);
      console.log(`  Tests pass: ${result.executionResults?.testsPass ? '✅' : '❌'}`);
      console.log(`  Build pass: ${result.executionResults?.buildPass ? '✅' : '❌'}`);

      if (result.files && result.files.length > 0) {
        console.log('\n📁 Generated files:');
        result.files.forEach((f) => console.log(`  - ${f.path}`));

        // Show package.json
        const pkg = result.files.find((f) => f.path === 'package.json');
        if (pkg) {
          console.log('\n📦 package.json preview:');
          const pkgData = JSON.parse(pkg.content);
          console.log(`  Name: ${pkgData.name}`);
          console.log(`  Version: ${pkgData.version}`);
          console.log(`  Dependencies: ${Object.keys(pkgData.dependencies || {}).length}`);
        }
      }
    } else {
      console.error('❌ Generation failed:', result.errors);
    }

    // Cleanup
    await e2bService.stop();
    console.log('\n🧹 Cleanup complete');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testSandboxGeneration()
  .then(() => {
    console.log('\n✅ Verification complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Verification failed:', err);
    process.exit(1);
  });
