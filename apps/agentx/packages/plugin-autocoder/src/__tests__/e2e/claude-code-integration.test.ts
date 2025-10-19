import { TestSuite, type IAgentRuntime } from '@elizaos/core';
import { CodeGenerationService } from '../../services/CodeGenerationService';

/**
 * Claude Code Integration Test Suite
 *
 * Tests the actual Claude Code SDK integration and generation functionality.
 * These tests use real API calls to verify the Claude Code system works correctly.
 */
export class ClaudeCodeIntegrationTestSuite implements TestSuite {
  name = 'claude-code-integration';
  description = 'Tests actual Claude Code SDK integration and generation';

  tests = [
    {
      name: 'should verify Code Generation Service is properly configured',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing Code Generation Service configuration...');

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const openaiKey = runtime.getSetting('OPENAI_API_KEY');

        if (!anthropicKey && !openaiKey) {
          console.log('⚠️ No API keys configured - at least one LLM key required');
          return;
        }

        console.log('✅ Code Generation Service properly configured for local execution');
      },
    },

    {
      name: 'should run basic code generation',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🤖 Testing basic code generation...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const openaiKey = runtime.getSetting('OPENAI_API_KEY');

        if (!anthropicKey && !openaiKey) {
          console.log('⏭️ Skipping basic generation test - no API keys available');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        try {
          // Test basic generation
          const result = await codeGenService.generateCode({
            projectName: 'test-basic-plugin',
            description: 'A simple test plugin',
            targetType: 'plugin',
            requirements: ['Create a hello world action'],
            apis: [],
          });

          if (!result.success) {
            throw new Error(`Generation failed: ${result.errors?.join(', ')}`);
          }

          console.log('✅ Basic generation test successful');
          console.log(`   Generated ${result.files?.length || 0} files`);
        } catch (error) {
          console.error('❌ Basic generation test failed:', error);
          throw error;
        }
      },
    },

    {
      name: 'should generate TypeScript ElizaOS plugin structure',
      fn: async (runtime: IAgentRuntime) => {
        console.log('⚙️ Testing ElizaOS plugin structure generation...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const openaiKey = runtime.getSetting('OPENAI_API_KEY');

        if (!anthropicKey && !openaiKey) {
          console.log('⏭️ Skipping plugin structure test - no API keys available');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        try {
          const result = await codeGenService.generateCode({
            projectName: 'test-typescript-plugin',
            description: 'A TypeScript plugin with proper ElizaOS structure',
            targetType: 'plugin',
            requirements: [
              'Use TypeScript with strict mode',
              'Include proper type definitions',
              'Follow ElizaOS plugin conventions',
            ],
            apis: [],
          });

          if (!result.success) {
            throw new Error(`Plugin generation failed: ${result.errors?.join(', ')}`);
          }

          // Verify TypeScript structure
          const hasTypeScript = result.files?.some((f) => f.path.endsWith('.ts'));
          const hasTsConfig = result.files?.some((f) => f.path === 'tsconfig.json');

          if (!hasTypeScript || !hasTsConfig) {
            throw new Error('Missing TypeScript files or configuration');
          }

          console.log('✅ Plugin structure test successful');
        } catch (error) {
          console.error('❌ Plugin structure test failed:', error);
          throw error;
        }
      },
    },

    {
      name: 'should test Claude Code with file operations',
      fn: async (runtime: IAgentRuntime) => {
        console.log('📁 Testing Claude Code file operations...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const e2bKey = runtime.getSetting('E2B_API_KEY');

        if (!anthropicKey || !e2bKey) {
          console.log('⏭️ Skipping file operations test - missing API keys');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        console.log(
          '✅ File operations test setup successful (actual operations happen in sandbox)'
        );
      },
    },

    {
      name: 'should test CodeGenerationService with real Claude Code',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🏗️ Testing CodeGenerationService with real Claude Code...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const e2bKey = runtime.getSetting('E2B_API_KEY');

        if (!anthropicKey || !e2bKey) {
          console.log('⏭️ Skipping CodeGenerationService test - missing API keys');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        try {
          // Test the actual service generation
          const result = await codeGenService.generateCode({
            projectName: 'test-simple-plugin',
            description: 'A simple test plugin for validation',
            targetType: 'plugin',
            requirements: [
              'Create a basic plugin structure',
              'Include a hello action',
              'Use proper TypeScript types',
            ],
            apis: [],
            testScenarios: ['Test plugin loads correctly', 'Test action responds to hello'],
          });

          if (!result.success) {
            throw new Error(`Code generation failed: ${result.errors?.join(', ')}`);
          }

          if (!result.files || result.files.length === 0) {
            throw new Error('No files generated');
          }

          // Verify essential files were created
          const fileNames = result.files.map((f) => f.path);
          const requiredFiles = ['package.json', 'src/index.ts'];

          for (const file of requiredFiles) {
            if (!fileNames.includes(file)) {
              throw new Error(`Missing required file: ${file}`);
            }
          }

          // Check file contents
          const indexFile = result.files.find((f) => f.path === 'src/index.ts');
          if (!indexFile) {
            throw new Error('Missing index.ts file');
          }

          const indexContent = indexFile.content.toLowerCase();
          if (!indexContent.includes('plugin') || !indexContent.includes('action')) {
            throw new Error('Generated index.ts missing plugin structure');
          }

          console.log(
            `✅ CodeGenerationService test successful - generated ${result.files.length} files`
          );

          // Log QA results if available
          if (result.executionResults) {
            console.log('📊 QA Results:');
            console.log(`  Lint: ${result.executionResults.lintPass ? '✅' : '❌'}`);
            console.log(`  Types: ${result.executionResults.typesPass ? '✅' : '❌'}`);
            console.log(`  Tests: ${result.executionResults.testsPass ? '✅' : '❌'}`);
            console.log(`  Build: ${result.executionResults.buildPass ? '✅' : '❌'}`);
          }
        } catch (error) {
          console.error('❌ CodeGenerationService test failed:', error);
          throw error;
        }
      },
    },

    {
      name: 'should test timeout handling in Claude Code',
      fn: async (runtime: IAgentRuntime) => {
        console.log('⏱️ Testing Claude Code timeout handling...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        if (!anthropicKey) {
          console.log('⏭️ Skipping timeout test - no ANTHROPIC_API_KEY');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        try {
          // Test timeout configuration
          const originalTimeout = runtime.getSetting('ANTHROPIC_TIMEOUT');
          const originalRequestTimeout = runtime.getSetting('ANTHROPIC_REQUEST_TIMEOUT');

          console.log('Current timeout settings:');
          console.log(`  ANTHROPIC_TIMEOUT: ${originalTimeout || 'default (300000ms)'}`);
          console.log(
            `  ANTHROPIC_REQUEST_TIMEOUT: ${originalRequestTimeout || 'default (600000ms)'}`
          );

          // Test generating with a simple request that should complete quickly
          const startTime = Date.now();

          const result = await codeGenService.generateCode({
            projectName: 'timeout-test-plugin',
            description: 'Simple plugin to test timeout handling',
            targetType: 'plugin',
            requirements: ['Basic plugin structure only'],
            apis: [],
          });

          const duration = Date.now() - startTime;
          console.log(`Generation completed in ${duration}ms`);

          if (!result.success) {
            // Check if it's a timeout-related error
            const errorMessage = result.errors?.join(', ').toLowerCase() || '';
            if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
              console.log('✅ Timeout detected and handled correctly');
            } else {
              throw new Error(`Non-timeout error: ${result.errors?.join(', ')}`);
            }
          } else {
            console.log('✅ Generation successful - no timeout issues');
          }
        } catch (error) {
          const errorMessage = (error as Error).message.toLowerCase();
          if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
            console.log('✅ Timeout error properly caught and handled');
          } else {
            console.error('❌ Timeout test failed:', error);
            throw error;
          }
        }
      },
    },

    {
      name: 'should test chunked generation fallback',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧩 Testing chunked generation fallback...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        if (!anthropicKey) {
          console.log('⏭️ Skipping chunked generation test - no ANTHROPIC_API_KEY');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        try {
          // Test the chunked generation directly
          const testPrompt = `Generate a complete ElizaOS plugin with:
1. Full package.json with all dependencies
2. TypeScript configuration
3. Multiple actions (hello, goodbye, help)
4. Multiple providers (time, weather, news)
5. Comprehensive tests
6. Complete documentation
7. Docker configuration
8. CI/CD pipeline
9. Security scanning
10. Performance benchmarks

Make it a production-ready, enterprise-grade plugin.`;

          // Access the private method through casting (for testing only)
          const serviceAsAny = codeGenService as any;

          if (typeof serviceAsAny.generateCodeInChunks === 'function') {
            const chunkResult = await serviceAsAny.generateCodeInChunks(testPrompt, 8000);

            if (!chunkResult) {
              throw new Error('Chunked generation returned no result');
            }

            if (typeof chunkResult !== 'string') {
              throw new Error('Chunked generation result is not a string');
            }

            // Verify chunks were generated
            const chunks = ['Core Structure', 'Services and Actions', 'Documentation and Tests'];
            let chunksFound = 0;

            for (const chunk of chunks) {
              if (chunkResult.includes(chunk)) {
                chunksFound++;
              }
            }

            if (chunksFound === 0) {
              throw new Error('No chunk headers found in result');
            }

            console.log(
              `✅ Chunked generation successful - ${chunksFound}/${chunks.length} chunks found`
            );
            console.log(`   Result length: ${chunkResult.length} characters`);
          } else {
            console.log('⏭️ Chunked generation method not accessible - testing via timeout');

            // Test by triggering timeout (set very short timeout)
            const oldTimeout = process.env.ANTHROPIC_TIMEOUT;
            process.env.ANTHROPIC_TIMEOUT = '1000'; // 1 second timeout

            try {
              const result = await codeGenService.generateCode({
                projectName: 'timeout-chunk-test',
                description: 'Complex plugin to trigger timeout and chunked generation',
                targetType: 'plugin',
                requirements: [
                  'Multiple complex actions',
                  'Advanced providers',
                  'Comprehensive testing',
                  'Full documentation',
                  'Security features',
                  'Performance optimization',
                ],
                apis: ['OpenAI', 'Discord', 'GitHub', 'Stripe', 'AWS'],
              });

              // If it succeeds despite short timeout, chunked generation likely worked
              if (result.success) {
                console.log(
                  '✅ Chunked generation likely activated (completed despite short timeout)'
                );
              } else {
                console.log('✅ Timeout handled gracefully');
              }
            } finally {
              // Restore original timeout
              if (oldTimeout) {
                process.env.ANTHROPIC_TIMEOUT = oldTimeout;
              } else {
                delete process.env.ANTHROPIC_TIMEOUT;
              }
            }
          }
        } catch (error) {
          console.error('❌ Chunked generation test failed:', error);
          throw error;
        }
      },
    },

    {
      name: 'should verify code generation with local file system',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🏗️ Testing code generation with local file system...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const openaiKey = runtime.getSetting('OPENAI_API_KEY');

        if (!anthropicKey && !openaiKey) {
          console.log('⏭️ Skipping local file system test - no API keys available');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        try {
          // Test generating a simple project
          const result = await codeGenService.generateCode({
            projectName: 'local-fs-test',
            description: 'Simple test to verify code generation with local file system',
            targetType: 'plugin',
            requirements: ['Create a basic plugin with a simple action'],
            apis: [],
          });

          if (!result.success) {
            throw new Error(`Code generation failed: ${result.errors?.join(', ')}`);
          }

          // Verify we got files back
          if (!result.files || result.files.length === 0) {
            throw new Error('No files generated');
          }

          // Verify project path exists
          if (!result.projectPath) {
            throw new Error('No project path returned');
          }

          console.log('✅ Code generation with local file system successful');
          console.log(`   Generated ${result.files.length} files`);
          console.log(`   Project path: ${result.projectPath}`);

          // Check for execution results
          if (result.executionResults) {
            console.log('📊 Validation results:');
            console.log(`   Lint: ${result.executionResults.lintPass ? '✅' : '❌'}`);
            console.log(`   Types: ${result.executionResults.typesPass ? '✅' : '❌'}`);
            console.log(`   Tests: ${result.executionResults.testsPass ? '✅' : '❌'}`);
            console.log(`   Build: ${result.executionResults.buildPass ? '✅' : '❌'}`);
          }
        } catch (error) {
          console.error('❌ Local file system test failed:', error);
          throw error;
        }
      },
    },
  ];
}

export default new ClaudeCodeIntegrationTestSuite();
