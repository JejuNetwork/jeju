import type { TestSuite } from '@elizaos/core';

/**
 * AutoCoder Real-World Scenarios Test Suite
 *
 * This test suite validates the autocoder's ability to generate complete,
 * working applications for real-world use cases with actual API integrations.
 */
export class AutoCoderScenariosTestSuite implements TestSuite {
  name = 'autocoder-real-world-scenarios';
  description = 'Real-world application generation scenarios using live APIs and runtime';

  tests = [
    {
      name: 'Generate Tesla News Discord Bot',
      fn: async (runtime: any) => {
        console.log('🚀 Testing Tesla News Discord Bot generation...');

        // Skip if required APIs are not available
        if (!process.env.DISCORD_BOT_TOKEN) {
          console.log('⏭️ Skipping Discord bot test - no DISCORD_BOT_TOKEN');
          return;
        }

        const codeGenService = runtime.getService('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        const teslaNewsProject = {
          projectName: 'tesla-news-discord-bot',
          description: 'Discord bot that monitors RSS feeds for Tesla news and sends alerts',
          targetType: 'plugin' as const,
          requirements: [
            'Monitor RSS feeds for Tesla-related news',
            'Send Discord notifications when Tesla news is found',
            'Filter news by keywords (Tesla, Elon Musk, stock)',
            'Throttle notifications to avoid spam',
            'Store seen articles to prevent duplicates',
            'Support multiple RSS sources',
            'Include article title, summary, and link in Discord messages',
          ],
          apis: ['Discord API', 'RSS feed parsing', 'Web scraping for article content'],
          testScenarios: [
            'Parse RSS feed and extract Tesla articles',
            'Send formatted Discord message',
            'Handle duplicate article detection',
            'Process multiple RSS sources',
            'Throttle notification frequency',
          ],
          githubRepo: `tesla-news-test-${Date.now()}`,
        };

        const result = await codeGenService.generateCode(teslaNewsProject);

        if (!result.success) {
          throw new Error(`Tesla news bot generation failed: ${result.errors?.join(', ')}`);
        }

        console.log('✅ Tesla news Discord bot generated successfully');

        // Verify essential components exist
        if (!result.files || result.files.length === 0) {
          throw new Error('No files generated');
        }

        const fileNames = result.files.map((f: any) => f.path);
        const requiredFiles = ['src/index.ts', 'package.json', 'README.md'];

        for (const file of requiredFiles) {
          if (!fileNames.includes(file)) {
            throw new Error(`Missing required file: ${file}`);
          }
        }

        // Verify Discord and RSS functionality
        const indexFile = result.files.find((f: any) => f.path === 'src/index.ts');
        if (!indexFile) {
          throw new Error('Missing index.ts file');
        }

        const content = indexFile.content.toLowerCase();
        if (!content.includes('discord') || !content.includes('rss')) {
          throw new Error('Generated code missing Discord or RSS functionality');
        }

        console.log(`📁 Generated ${result.files.length} files for Tesla news bot`);
      },
    },

    {
      name: 'Generate Global Weather App',
      fn: async (runtime: any) => {
        console.log('🌤️ Testing Global Weather App generation...');

        // Skip if required APIs are not available
        if (!process.env.OPENWEATHER_API_KEY) {
          console.log('⏭️ Skipping weather app test - no OPENWEATHER_API_KEY');
          return;
        }

        const codeGenService = runtime.getService('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        const weatherAppProject = {
          projectName: 'global-weather-app',
          description: 'Complete weather application supporting global location queries',
          targetType: 'agent' as const,
          requirements: [
            'Query weather for any location worldwide',
            'Support city names, coordinates, and postal codes',
            'Provide current weather and forecasts',
            'Include weather alerts and warnings',
            'Support multiple weather data providers',
            'Cache weather data to reduce API calls',
            'Handle location disambiguation',
            'Provide weather maps and radar',
          ],
          apis: [
            'OpenWeatherMap API',
            'WeatherAPI.com',
            'Location geocoding services',
            'Time zone APIs',
          ],
          testScenarios: [
            'Query weather for major cities',
            'Handle ambiguous location names',
            'Provide accurate forecasts',
            'Display weather alerts',
            'Cache and retrieve weather data',
            'Support different units (metric/imperial)',
          ],
          githubRepo: `weather-app-test-${Date.now()}`,
          personality: 'Helpful and informative weather assistant',
          knowledge: [
            'Weather patterns and terminology',
            'Global geography and time zones',
            'Weather safety and alerts',
          ],
        };

        const result = await codeGenService.generateCode(weatherAppProject);

        if (!result.success) {
          throw new Error(`Weather app generation failed: ${result.errors?.join(', ')}`);
        }

        console.log('✅ Global weather app generated successfully');

        // Verify essential components exist
        if (!result.files || result.files.length === 0) {
          throw new Error('No files generated');
        }

        const fileNames = result.files.map((f: any) => f.path);
        const requiredFiles = ['src/index.ts', 'package.json', 'character.json'];

        for (const file of requiredFiles) {
          if (!fileNames.includes(file)) {
            throw new Error(`Missing required file: ${file}`);
          }
        }

        // Verify weather functionality
        const indexFile = result.files.find((f: any) => f.path === 'src/index.ts');
        if (!indexFile) {
          throw new Error('Missing index.ts file');
        }

        const content = indexFile.content.toLowerCase();
        if (!content.includes('weather')) {
          throw new Error('Generated code missing weather functionality');
        }

        // Verify character file for agent
        const characterFile = result.files.find((f: any) => f.path === 'character.json');
        if (!characterFile) {
          throw new Error('Missing character.json file for agent');
        }

        const character = JSON.parse(characterFile.content);
        if (!character.name || !character.bio) {
          throw new Error('Invalid character configuration');
        }

        console.log(`📁 Generated ${result.files.length} files for weather app`);
        if (result.agentId) {
          console.log(`🤖 Agent ID: ${result.agentId}`);
        }
      },
    },

    {
      name: 'Validate RSS Monitoring Functionality',
      fn: async (runtime: any) => {
        console.log('🔍 Testing RSS monitoring capabilities...');

        if (!process.env.DISCORD_BOT_TOKEN) {
          console.log('⏭️ Skipping RSS monitoring test - no DISCORD_BOT_TOKEN');
          return;
        }

        const codeGenService = runtime.getService('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        const rssProject = {
          projectName: 'rss-monitor-test',
          description: 'RSS monitoring with keyword filtering',
          targetType: 'plugin' as const,
          requirements: [
            'Parse RSS feeds from multiple sources',
            'Filter articles by keywords',
            'Detect duplicate articles',
            'Schedule periodic RSS checks',
            'Handle RSS feed errors gracefully',
          ],
          apis: ['RSS parsing', 'Web scraping'],
          testScenarios: [
            'Parse valid RSS feed',
            'Handle invalid RSS feed',
            'Filter by keywords',
            'Detect duplicates',
          ],
        };

        const result = await codeGenService.generateCode(rssProject);

        if (!result.success) {
          throw new Error(`RSS monitoring generation failed: ${result.errors?.join(', ')}`);
        }

        // Verify RSS-specific functionality
        if (!result.files) {
          throw new Error('No files generated');
        }

        const rssFiles = result.files.filter(
          (f: any) =>
            f.content.toLowerCase().includes('rss') ||
            f.content.toLowerCase().includes('feed') ||
            f.content.toLowerCase().includes('xml')
        );

        if (rssFiles.length === 0) {
          throw new Error('No RSS functionality found in generated code');
        }

        // Check for keyword filtering
        const hasKeywordFiltering = result.files.some(
          (f: any) =>
            f.content.toLowerCase().includes('filter') &&
            f.content.toLowerCase().includes('keyword')
        );

        if (!hasKeywordFiltering) {
          throw new Error('Missing keyword filtering functionality');
        }

        console.log('✅ RSS monitoring functionality verified');
      },
    },

    {
      name: 'Test Weather API Integration',
      fn: async (runtime: any) => {
        console.log('🌍 Testing weather API integration...');

        if (!process.env.OPENWEATHER_API_KEY) {
          console.log('⏭️ Skipping weather API test - no OPENWEATHER_API_KEY');
          return;
        }

        const codeGenService = runtime.getService('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        const weatherApiProject = {
          projectName: 'weather-api-integration',
          description: 'Weather API integration with caching and error handling',
          targetType: 'plugin' as const,
          requirements: [
            'Connect to OpenWeatherMap API',
            'Implement data caching',
            'Handle API rate limits',
            'Support multiple location formats',
            'Provide error recovery',
          ],
          apis: ['OpenWeatherMap API'],
          testScenarios: [
            'Query weather by city name',
            'Query weather by coordinates',
            'Handle API errors',
            'Test caching behavior',
          ],
        };

        const result = await codeGenService.generateCode(weatherApiProject);

        if (!result.success) {
          throw new Error(`Weather API integration failed: ${result.errors?.join(', ')}`);
        }

        if (!result.files) {
          throw new Error('No files generated');
        }

        // Verify API integration
        const apiFiles = result.files.filter(
          (f: any) =>
            f.content.toLowerCase().includes('api') ||
            f.content.toLowerCase().includes('fetch') ||
            f.content.toLowerCase().includes('request')
        );

        if (apiFiles.length === 0) {
          throw new Error('No API integration found in generated code');
        }

        // Check for caching implementation
        const hasCaching = result.files.some(
          (f: any) =>
            f.content.toLowerCase().includes('cache') ||
            f.content.toLowerCase().includes('redis') ||
            f.content.toLowerCase().includes('storage')
        );

        if (!hasCaching) {
          throw new Error('Missing caching functionality');
        }

        // Check for error handling
        const hasErrorHandling = result.files.some(
          (f: any) =>
            (f.content.includes('try') && f.content.includes('catch')) ||
            f.content.includes('error') ||
            f.content.includes('Error')
        );

        if (!hasErrorHandling) {
          throw new Error('Missing error handling');
        }

        console.log('✅ Weather API integration verified');
      },
    },

    {
      name: 'End-to-End Application Validation',
      fn: async (runtime: any) => {
        console.log('🔍 Testing complete application functionality...');

        if (!process.env.ANTHROPIC_API_KEY || !process.env.E2B_API_KEY) {
          console.log('⏭️ Skipping E2E validation - missing API keys');
          return;
        }

        const codeGenService = runtime.getService('code-generation');
        if (!codeGenService) {
          throw new Error('CodeGenerationService not available');
        }

        const e2eProject = {
          projectName: 'e2e-validation-test',
          description: 'Complete application with comprehensive validation',
          targetType: 'agent' as const,
          requirements: [
            'Multi-step conversation flow',
            'External API integration',
            'Data persistence',
            'Error handling',
            'Comprehensive testing',
          ],
          apis: ['Mock external API'],
          testScenarios: [
            'Complete conversation flow',
            'API integration test',
            'Data persistence test',
            'Error recovery test',
            'Performance test',
          ],
          personality: 'Professional and helpful assistant',
          knowledge: ['Domain-specific knowledge base'],
        };

        const result = await codeGenService.generateCode(e2eProject);

        if (!result.success) {
          throw new Error(`E2E validation failed: ${result.errors?.join(', ')}`);
        }

        // Verify comprehensive file generation
        if (!result.files || result.files.length <= 5) {
          throw new Error('Insufficient files generated for complete application');
        }

        // Check for essential components
        const fileNames = result.files.map((f: any) => f.path);
        const requiredFiles = ['src/index.ts', 'package.json', 'character.json', 'README.md'];

        for (const file of requiredFiles) {
          if (!fileNames.includes(file)) {
            throw new Error(`Missing required file: ${file}`);
          }
        }

        // Verify test files exist
        const hasTests = result.files.some(
          (f: any) => f.path.includes('test') || f.path.includes('spec')
        );

        if (!hasTests) {
          throw new Error('No test files found in generated application');
        }

        console.log('✅ Complete application functionality validated');
        console.log(`📁 Generated ${result.files.length} files total`);
      },
    },
  ];
}

export default new AutoCoderScenariosTestSuite();
