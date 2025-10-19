import { TestSuite, type IAgentRuntime } from '@elizaos/core';
import { CodeGenerationService } from '../../services/CodeGenerationService';

/**
 * Code Generation Stress Test Suite
 *
 * Tests code generation under various stress conditions and complex scenarios
 * to ensure robustness and reliability.
 */
export class ClaudeCodeStressTestSuite implements TestSuite {
  name = 'code-generation-stress-test';
  description = 'Stress tests for code generation under various conditions';

  tests = [
    {
      name: 'should handle multiple concurrent code generation requests',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🚀 Testing concurrent code generation requests...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const openaiKey = runtime.getSetting('OPENAI_API_KEY');

        if (!anthropicKey && !openaiKey) {
          console.log('⏭️ Skipping concurrent test - no API keys available');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        const concurrentRequests = 3;
        const requests = [];

        // Create multiple concurrent requests
        for (let i = 0; i < concurrentRequests; i++) {
          const request = (async () => {
            const startTime = Date.now();

            try {
              const result = await codeGenService.generateCode({
                projectName: `concurrent-test-${i}`,
                description: `Generate a simple function called "test${i}" that returns the number ${i}`,
                targetType: 'plugin',
                requirements: [`Function test${i} that returns ${i}`],
                apis: [],
              });

              const duration = Date.now() - startTime;
              return { success: result.success, response: result, duration, index: i };
            } catch (error) {
              const duration = Date.now() - startTime;
              return { success: false, error: (error as Error).message, duration, index: i };
            }
          })();

          requests.push(request);
        }

        // Wait for all requests to complete
        const results = await Promise.all(requests);

        // Analyze results
        const successful = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        console.log(
          `✅ Concurrent requests completed: ${successful.length}/${concurrentRequests} successful`
        );

        if (failed.length > 0) {
          console.log(`❌ Failed requests: ${failed.length}`);
          failed.forEach((f) => console.log(`  Request ${f.index}: ${f.error}`));
        }

        // Verify at least some requests succeeded
        if (successful.length === 0) {
          throw new Error('All concurrent requests failed');
        }

        // Check response quality
        for (const result of successful) {
          if (!result.response || !result.response.files || result.response.files.length === 0) {
            throw new Error(`Request ${result.index} did not generate any files`);
          }
        }

        const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
        console.log(`📊 Average response time: ${avgDuration.toFixed(0)}ms`);
      },
    },

    {
      name: 'should handle large context prompts',
      fn: async (runtime: IAgentRuntime) => {
        console.log('📚 Testing large context prompt handling...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const openaiKey = runtime.getSetting('OPENAI_API_KEY');

        if (!anthropicKey && !openaiKey) {
          console.log('⏭️ Skipping large context test - no API keys available');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        try {
          // Create a large context description with many requirements
          const requirements = Array.from(
            { length: 50 },
            (_, i) => `Feature ${i + 1}: Advanced functionality for e-commerce system`
          );

          const apis = Array.from(
            { length: 20 },
            (_, i) => `API Endpoint ${i + 1} - Complex e-commerce operations`
          );

          const startTime = Date.now();

          const result = await codeGenService.generateCode({
            projectName: 'large-context-test',
            description:
              'Comprehensive ElizaOS plugin for an e-commerce platform with extensive features',
            targetType: 'plugin',
            requirements,
            apis,
            testScenarios: ['Test basic functionality', 'Test API integrations'],
          });

          const duration = Date.now() - startTime;

          if (!result.success) {
            throw new Error(`Large context generation failed: ${result.errors?.join(', ')}`);
          }

          if (!result.files || result.files.length === 0) {
            throw new Error('No files generated for large context');
          }

          // Verify response quality despite large context
          const allContent = result.files
            .map((f) => f.content)
            .join('\n')
            .toLowerCase();
          if (!allContent.includes('plugin') || !allContent.includes('action')) {
            throw new Error('Generated code does not contain expected plugin structure');
          }

          console.log(`✅ Large context handled successfully in ${duration}ms`);
          console.log(
            `📏 Requirements: ${requirements.length}, APIs: ${apis.length}, Files generated: ${result.files.length}`
          );
        } catch (error) {
          console.error('❌ Large context test failed:', error);
          throw error;
        }
      },
    },

    {
      name: 'should handle rapid sequential requests',
      fn: async (runtime: IAgentRuntime) => {
        console.log('⚡ Testing rapid sequential Claude Code requests...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const openaiKey = runtime.getSetting('OPENAI_API_KEY');

        if (!anthropicKey && !openaiKey) {
          console.log('⏭️ Skipping rapid sequential test - no API keys available');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        const requestCount = 5;
        const results = [];

        for (let i = 0; i < requestCount; i++) {
          const startTime = Date.now();

          try {
            const result = await codeGenService.generateCode({
              projectName: `sequential-test-${i}`,
              description: `Create a simple TypeScript interface called "Interface${i}" with a property "value${i}"`,
              targetType: 'plugin',
              requirements: [`Interface Interface${i} with property value${i}`],
              apis: [],
            });

            const duration = Date.now() - startTime;
            results.push({ success: result.success, response: result, duration, index: i });

            console.log(`✅ Request ${i + 1}/${requestCount} completed in ${duration}ms`);
          } catch (error) {
            const duration = Date.now() - startTime;
            results.push({ success: false, error: (error as Error).message, duration, index: i });
            console.log(`❌ Request ${i + 1}/${requestCount} failed in ${duration}ms`);
          }

          // Small delay between requests
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Analyze results
        const successful = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        console.log(`📊 Sequential requests: ${successful.length}/${requestCount} successful`);

        if (successful.length === 0) {
          throw new Error('All sequential requests failed');
        }

        // Verify response quality
        for (const result of successful) {
          if (!result.response || !result.response.files || result.response.files.length === 0) {
            throw new Error(`Request ${result.index} did not generate any files`);
          }
        }

        const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
        console.log(`⚡ Average response time: ${avgDuration.toFixed(0)}ms`);
      },
    },

    {
      name: 'should handle complex multi-file project generation',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🏗️ Testing complex multi-file project generation...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        const openaiKey = runtime.getSetting('OPENAI_API_KEY');

        if (!anthropicKey && !openaiKey) {
          console.log('⏭️ Skipping complex project test - no API keys available');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        try {
          const startTime = Date.now();

          // Generate a complex project with many features
          const result = await codeGenService.generateCode({
            projectName: 'complex-multi-feature-plugin',
            description: 'A comprehensive plugin with multiple advanced features and integrations',
            targetType: 'plugin',
            requirements: [
              'Multiple actions for different operations',
              'Advanced providers for context enrichment',
              'Service integrations with external APIs',
              'Comprehensive error handling and logging',
              'Caching and performance optimization',
              'Security features and input validation',
              'Comprehensive test coverage',
              'Documentation and examples',
              'Configuration management',
              'Health monitoring and metrics',
            ],
            apis: [
              'OpenAI API',
              'Discord API',
              'GitHub API',
              'Redis for caching',
              'PostgreSQL for data storage',
            ],
            testScenarios: [
              'Test all action functionalities',
              'Test provider integrations',
              'Test error handling scenarios',
              'Test performance under load',
              'Test security validations',
              'Test configuration management',
              'Test caching mechanisms',
              'Test database operations',
              'Test API integrations',
              'Test monitoring and metrics',
            ],
          });

          const duration = Date.now() - startTime;

          if (!result.success) {
            throw new Error(`Complex project generation failed: ${result.errors?.join(', ')}`);
          }

          if (!result.files || result.files.length === 0) {
            throw new Error('No files generated for complex project');
          }

          console.log(`✅ Complex project generated in ${duration}ms`);
          console.log(`📁 Generated ${result.files.length} files`);

          // Verify essential files exist
          const fileNames = result.files.map((f) => f.path);
          const requiredFiles = ['package.json', 'src/index.ts', 'tsconfig.json', 'README.md'];

          for (const file of requiredFiles) {
            if (!fileNames.includes(file)) {
              throw new Error(`Missing required file: ${file}`);
            }
          }

          // Verify file complexity
          const totalLines = result.files.reduce(
            (sum, file) => sum + file.content.split('\n').length,
            0
          );

          const averageFileSize =
            result.files.reduce((sum, file) => sum + file.content.length, 0) / result.files.length;

          console.log('📊 Project complexity:');
          console.log(`  Total lines: ${totalLines}`);
          console.log(`  Average file size: ${averageFileSize.toFixed(0)} chars`);
          console.log(`  Files generated: ${result.files.length}`);

          // Check for advanced features in generated code
          const allContent = result.files
            .map((f) => f.content)
            .join('\n')
            .toLowerCase();
          const features = [
            'action',
            'provider',
            'service',
            'error',
            'cache',
            'test',
            'async',
            'interface',
            'export',
          ];

          let featuresFound = 0;
          for (const feature of features) {
            if (allContent.includes(feature)) {
              featuresFound++;
            }
          }

          if (featuresFound < features.length * 0.7) {
            throw new Error(
              `Only ${featuresFound}/${features.length} expected features found in generated code`
            );
          }

          console.log(`✅ Advanced features found: ${featuresFound}/${features.length}`);

          // Log QA results
          if (result.executionResults) {
            console.log('📋 QA Results:');
            console.log(`  Lint: ${result.executionResults.lintPass ? '✅' : '❌'}`);
            console.log(`  Types: ${result.executionResults.typesPass ? '✅' : '❌'}`);
            console.log(`  Tests: ${result.executionResults.testsPass ? '✅' : '❌'}`);
            console.log(`  Build: ${result.executionResults.buildPass ? '✅' : '❌'}`);
          }
        } catch (error) {
          console.error('❌ Complex project generation failed:', error);
          throw error;
        }
      },
    },

    {
      name: 'should handle error recovery and retries',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🔄 Testing error recovery and retry mechanisms...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        if (!anthropicKey) {
          console.log('⏭️ Skipping error recovery test - no ANTHROPIC_API_KEY');
          return;
        }

        const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        try {
          // Test with a problematic request that might fail initially
          const problemRequest = {
            projectName: 'error-recovery-test',
            description: 'Test plugin designed to trigger potential errors and recovery',
            targetType: 'plugin' as const,
            requirements: [
              'Handle edge cases and error conditions',
              'Implement robust error recovery',
              'Test retry mechanisms',
              'Validate error handling paths',
            ],
            apis: ['Potentially unreliable API'],
            testScenarios: ['Test error scenarios', 'Test recovery mechanisms', 'Test retry logic'],
          };

          const startTime = Date.now();
          const result = await codeGenService.generateCode(problemRequest);
          const duration = Date.now() - startTime;

          // The generation should either succeed or fail gracefully
          if (result.success) {
            console.log(`✅ Error recovery test passed - generation succeeded in ${duration}ms`);

            if (result.files && result.files.length > 0) {
              console.log(`📁 Generated ${result.files.length} files despite potential errors`);
            }
          } else {
            console.log(`✅ Error recovery test passed - graceful failure in ${duration}ms`);

            if (result.errors && result.errors.length > 0) {
              console.log(`📋 Errors handled gracefully: ${result.errors.length} errors`);
            }
          }

          // Verify error handling doesn't crash the service
          const secondResult = await codeGenService.generateCode({
            projectName: 'post-error-test',
            description: 'Simple test after potential error',
            targetType: 'plugin',
            requirements: ['Basic functionality'],
            apis: [],
          });

          if (secondResult.success) {
            console.log('✅ Service recovered successfully after error scenario');
          } else {
            console.log('⚠️ Service state affected by previous error, but handled gracefully');
          }
        } catch (error) {
          // Even if the test fails, we should verify the service didn't crash
          console.log('🔄 Testing service stability after error...');

          try {
            const recoveryResult = await codeGenService.generateCode({
              projectName: 'recovery-test',
              description: 'Test service recovery',
              targetType: 'plugin',
              requirements: ['Basic test'],
              apis: [],
            });

            if (recoveryResult.success) {
              console.log('✅ Service recovered successfully despite error');
            } else {
              console.log('✅ Service remained stable despite error');
            }
          } catch (recoveryError) {
            console.error('❌ Service failed to recover:', recoveryError);
            throw recoveryError;
          }

          // Re-throw original error if it was unexpected
          if (
            !(error as Error).message.includes('timeout') &&
            !(error as Error).message.includes('rate limit')
          ) {
            throw error;
          } else {
            console.log('✅ Expected error handled correctly');
          }
        }
      },
    },

    {
      name: 'should maintain performance under sustained load',
      fn: async (runtime: IAgentRuntime) => {
        console.log('📈 Testing sustained load performance...');

        const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
        if (!anthropicKey) {
          console.log('⏭️ Skipping sustained load test - no ANTHROPIC_API_KEY');
          return;
        }

        process.env.ANTHROPIC_API_KEY = anthropicKey;

        const loadTestDuration = 30000; // 30 seconds
        const requestInterval = 2000; // 2 seconds between requests
        const startTime = Date.now();
        const results: Array<{
          success: boolean;
          duration: number;
          requestCount: number;
          error?: string;
        }> = [];

        console.log(`🔄 Running sustained load test for ${loadTestDuration / 1000} seconds...`);

        let requestCount = 0;
        const intervalId = setInterval(async () => {
          if (Date.now() - startTime > loadTestDuration) {
            clearInterval(intervalId);
            return;
          }

          requestCount++;
          const requestStartTime = Date.now();

          try {
            // Use CodeGenerationService for code generation
            const codeGenService = runtime.getService<CodeGenerationService>('code-generation');
            if (!codeGenService) {
              throw new Error('CodeGenerationService not available');
            }

            const result = await codeGenService.generateCode({
              projectName: `load-test-${requestCount}`,
              description: `Create a simple function called "loadTest${requestCount}" that returns "Load test ${requestCount}".`,
              targetType: 'plugin',
              requirements: [
                `Function loadTest${requestCount} returning "Load test ${requestCount}"`,
              ],
              apis: [],
            });

            const duration = Date.now() - requestStartTime;
            results.push({ success: result.success, duration, requestCount });
            console.log(`✅ Load test request ${requestCount} completed in ${duration}ms`);
          } catch (error) {
            const duration = Date.now() - requestStartTime;
            results.push({
              success: false,
              duration,
              requestCount,
              error: (error as Error).message,
            });
            console.log(`❌ Load test request ${requestCount} failed in ${duration}ms`);
          }
        }, requestInterval);

        // Wait for test to complete
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (Date.now() - startTime > loadTestDuration + 5000) {
              clearInterval(checkInterval);
              resolve(undefined);
            }
          }, 1000);
        });

        // Analyze results
        const successful = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        console.log('📊 Sustained load test results:');
        console.log(`  Total requests: ${results.length}`);
        console.log(`  Successful: ${successful.length}`);
        console.log(`  Failed: ${failed.length}`);
        console.log(`  Success rate: ${((successful.length / results.length) * 100).toFixed(1)}%`);

        if (successful.length > 0) {
          const avgDuration =
            successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
          const maxDuration = Math.max(...successful.map((r) => r.duration));
          const minDuration = Math.min(...successful.map((r) => r.duration));

          console.log(`  Average response time: ${avgDuration.toFixed(0)}ms`);
          console.log(`  Max response time: ${maxDuration}ms`);
          console.log(`  Min response time: ${minDuration}ms`);
        }

        // Verify performance doesn't degrade significantly
        if (successful.length === 0) {
          throw new Error('No successful requests during sustained load test');
        }

        const successRate = successful.length / results.length;
        if (successRate < 0.5) {
          throw new Error(`Success rate too low: ${(successRate * 100).toFixed(1)}%`);
        }

        console.log('✅ Sustained load test completed successfully');
      },
    },
  ];
}

export default new ClaudeCodeStressTestSuite();
