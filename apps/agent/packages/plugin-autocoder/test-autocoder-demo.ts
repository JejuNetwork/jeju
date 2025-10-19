#!/usr/bin/env bun

/**
 * Autocoder Plugin Demo and Test Script
 *
 * This script demonstrates the complete autocoder workflow:
 * 1. Project creation with forms
 * 2. PRD generation based on research
 * 3. Code generation with proper approach (clone/extend/new)
 * 4. Real-time status tracking
 * 5. Validation and testing
 */

import { AgentRuntime, type UUID } from '@elizaos/core';
import { autocoderPlugin } from './src/index';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { promises as fs } from 'fs';
import { config } from 'dotenv';

// Import required plugins
import sqlPlugin from '@elizaos/plugin-sql';
import formsPlugin from '@elizaos/plugin-forms';
import inferencePlugin from '@elizaos/plugin-inference';
import openaiPlugin from '@elizaos/plugin-openai';
import anthropicPlugin from '@elizaos/plugin-anthropic';

// Load environment variables
config({ path: path.join(__dirname, '../../.env') });

async function main() {
  console.log('🚀 Autocoder Plugin Demo Starting...\n');

  // Check API keys
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasOpenAI && !hasAnthropic) {
    console.error('❌ No API keys found. Please set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env');
    process.exit(1);
  }

  console.log('🔑 Available API Keys:');
  if (hasOpenAI) console.log('   ✓ OpenAI');
  if (hasAnthropic) console.log('   ✓ Anthropic');
  console.log('');

  // Initialize runtime
  console.log('📦 Initializing runtime...');
  const runtime = new AgentRuntime({
    agentId: uuidv4() as UUID,
    character: {
      name: 'AutoCoder Demo Agent',
      bio: ['Demo agent for showcasing autocoder capabilities'],
      system: 'You are a helpful coding assistant that creates high-quality ElizaOS plugins.',
      settings: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        USE_CLAUDE_PROXY: hasAnthropic ? 'false' : 'true',
      },
    },
  });

  // Register plugins
  console.log('🔌 Loading plugins...');
  await runtime.registerPlugin(sqlPlugin);
  await runtime.registerPlugin(inferencePlugin);

  if (hasAnthropic) {
    await runtime.registerPlugin(anthropicPlugin);
  } else {
    await runtime.registerPlugin(openaiPlugin);
  }

  await runtime.registerPlugin(formsPlugin);
  await runtime.registerPlugin(autocoderPlugin);

  // Initialize runtime
  
    await runtime.initialize();
    console.log('✅ Runtime initialized successfully\n');
  } catch (error) {
    console.error('❌ Failed to initialize runtime:', error);
    // Continue anyway for demo purposes
  }

  // Get services
  const codeGenService = runtime.getService('code-generation') as any;
  const statusManager = runtime.getService('project-status-manager') as any;
  // Note: project-planning service is available but not used in this demo

  if (!codeGenService || !statusManager) {
    console.error('❌ Required services not available');
    process.exit(1);
  }

  // Set up status tracking
  console.log('📊 Setting up real-time status tracking...\n');
  statusManager.on('update', (update: any) => {
    const progress = update.progress || 0;
    const bar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
    console.log(
      `[${bar}] ${progress}% - ${update.currentStep || update.status}: ${update.message || ''}`
    );
  });

  // Demo projects
  const demoProjects = [
    {
      name: 'Simple Hello World Plugin',
      request: {
        projectName: 'hello-world-plugin',
        description: 'A simple plugin that greets users',
        targetType: 'plugin' as const,
        requirements: [
          'Create a GREET action that responds with personalized greetings',
          'Support multiple languages (English, Spanish, French)',
          'Include a greeting counter provider',
        ],
        apis: [],
        testScenarios: ['Should greet in different languages', 'Should track greeting count'],
      },
    },
    {
      name: 'Weather Alert Plugin (with API)',
      request: {
        projectName: 'weather-alert-plugin',
        description: 'A plugin that monitors weather and sends alerts',
        targetType: 'plugin' as const,
        requirements: [
          'Check weather for specified cities',
          'Send alerts for severe weather conditions',
          'Cache weather data for 10 minutes',
        ],
        apis: ['OpenWeatherMap'],
        testScenarios: [
          'Should fetch weather data',
          'Should cache results',
          'Should alert on severe weather',
        ],
      },
    },
    {
      name: 'Enhanced Shell Plugin (Extension)',
      request: {
        projectName: 'enhanced-shell-plugin',
        description: 'Extends the existing shell plugin with command history and aliases',
        targetType: 'plugin' as const,
        requirements: [
          'Execute shell commands (extend existing functionality)',
          'Add command history tracking',
          'Support command aliases',
          'Add safety restrictions for dangerous commands',
        ],
        apis: [],
        testScenarios: [
          'Should execute safe commands',
          'Should track history',
          'Should support aliases',
        ],
      },
    },
  ];

  // Run demos
  for (const demo of demoProjects) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Demo: ${demo.name}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      console.log('🚀 Starting code generation...\n');
      const startTime = Date.now();

      const result = await codeGenService.generateCode(demo.request);

      const duration = Date.now() - startTime;
      console.log(`\n⏱️  Completed in ${(duration / 1000).toFixed(1)} seconds`);

      if (result.success) {
        console.log('\n✅ Generation successful!');
        console.log(`📁 Project location: ${result.projectPath}`);
        console.log(`📄 Files generated: ${result.files?.length || 0}`);

        // Check PRD
        try {
          const prdPath = path.join(result.projectPath, 'PRD.json');
          const prd = JSON.parse(await fs.readFile(prdPath, 'utf-8'));
          console.log(`\n📋 PRD Summary:`);
          console.log(`   - Approach: ${prd.architecture.approach}`);
          console.log(`   - Components: ${prd.architecture.components.join(', ')}`);
          console.log(
            `   - API Keys Required: ${prd.apiKeys.length > 0 ? prd.apiKeys.join(', ') : 'None'}`
          );
        

        // Show validation results
        if (result.executionResults) {
          console.log(`\n🧪 Validation Results:`);
          console.log(`   - Lint: ${result.executionResults.lintPass ? '✅' : '❌'}`);
          console.log(`   - Types: ${result.executionResults.typesPass ? '✅' : '❌'}`);
          console.log(`   - Tests: ${result.executionResults.testsPass ? '✅' : '❌'}`);
          console.log(`   - Build: ${result.executionResults.buildPass ? '✅' : '❌'}`);
        }

        // Show some generated files
        console.log(`\n📝 Sample Generated Files:`);
        const filesToShow = ['src/index.ts', 'package.json', 'README.md'];
        for (const file of filesToShow) {
          const fileContent = result.files?.find((f) => f.path === file);
          if (fileContent) {
            console.log(`\n--- ${file} (first 200 chars) ---`);
            console.log(`${fileContent.content.substring(0, 200)}...`);
          }
        }
      } else {
        console.log('\n❌ Generation failed:');
        console.log(result.errors?.join('\n'));
      }
    } catch (error) {
      console.error('\n❌ Demo failed:', error);
    }

    // Wait a bit before next demo
    if (demo !== demoProjects[demoProjects.length - 1]) {
      console.log('\n⏳ Waiting 5 seconds before next demo...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  // Show final summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 Final Summary');
  console.log(`${'='.repeat(60)}\n`);

  const summary = statusManager.getStatusSummary();
  console.log(`Projects:`);
  console.log(`   - Active: ${summary.active}`);
  console.log(`   - Completed: ${summary.completed}`);
  console.log(`   - Failed: ${summary.failed}`);
  console.log(`   - Total Files Generated: ${summary.totalGenerated}`);
  console.log(`   - Average Duration: ${(summary.averageDuration / 1000).toFixed(1)}s`);

  console.log('\n✨ Demo completed!');
}

// Run the demo
main().catch(console.error);
