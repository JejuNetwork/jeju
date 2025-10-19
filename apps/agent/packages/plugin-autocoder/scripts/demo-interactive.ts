#!/usr/bin/env bun

import { InteractiveClaudeCodeTester } from '../src/interactive-test';

/**
 * Demo script to showcase the interactive test capabilities
 */
async function runDemo() {
  console.log('🎬 Interactive Claude Code Test Demo');
  console.log('===================================\n');

  // Check environment
  const requiredKeys = ['ANTHROPIC_API_KEY'];
  const missingKeys = requiredKeys.filter((key) => !process.env[key]);

  if (missingKeys.length > 0) {
    console.error('❌ Missing required environment variables for demo:');
    missingKeys.forEach((key) => console.error(`   - ${key}`));
    console.log('\nTo run the demo:');
    console.log('1. Set your Anthropic API key:');
    console.log('   export ANTHROPIC_API_KEY="your_api_key_here"');
    console.log('2. Run the demo:');
    console.log('   bun run scripts/demo-interactive.ts');
    console.log('\nTo run the interactive test:');
    console.log('   bun run test:interactive');
    console.log('   # or');
    console.log('   ./scripts/test-interactive.sh');
    return;
  }

  console.log('✅ Environment is ready for demo!\n');

  console.log('🌟 Features of the Interactive Test:');
  console.log('');
  console.log('1. 🧠 Direct Claude Code Integration');
  console.log('   - Send prompts directly to Claude Code SDK');
  console.log('   - Real-time response streaming');
  console.log('   - Example: claude Create a TypeScript function');
  console.log('');
  console.log('2. 🚀 Complete Project Generation');
  console.log('   - Generate full ElizaOS plugins and agents');
  console.log('   - Automatic quality assurance workflow');
  console.log('   - Example: generate A weather plugin for OpenWeatherMap');
  console.log('');
  console.log('3. 🏗️  Live Sandbox Environment');
  console.log('   - Real E2B sandbox (if API key provided)');
  console.log('   - Mock sandbox for testing without E2B');
  console.log('   - File operations and command execution');
  console.log('   - Example: run npm install');
  console.log('');
  console.log('4. 📁 File Operations');
  console.log('   - Write files to sandbox');
  console.log('   - Read files from sandbox');
  console.log('   - List directory contents');
  console.log('   - Example: write src/index.ts console.log("hello")');
  console.log('');

  console.log('📚 Available Commands:');
  console.log('   help                     - Show help message');
  console.log('   status                   - Show session status');
  console.log('   claude <prompt>          - Send direct prompt to Claude Code');
  console.log('   generate <description>   - Generate complete project');
  console.log('   run <command>            - Run command in sandbox');
  console.log('   write <file> <content>   - Write file to sandbox');
  console.log('   read <file>              - Read file from sandbox');
  console.log('   ls [path]                - List files in sandbox');
  console.log('   clear                    - Clear terminal');
  console.log('   exit                     - Exit test session');
  console.log('');

  console.log('🎯 Example Session Flow:');
  console.log('1. Start: bun run test:interactive');
  console.log('2. Generate: generate A calculator plugin');
  console.log('3. Check: ls src/');
  console.log('4. Read: read src/index.ts');
  console.log('5. Test: run npm test');
  console.log('6. Exit: exit');
  console.log('');

  console.log('🚀 Ready to start? Run one of these commands:');
  console.log('   bun run test:interactive');
  console.log('   ./scripts/test-interactive.sh');
  console.log('');

  console.log('💡 Pro Tips:');
  console.log('   - Use Ctrl+C to exit gracefully');
  console.log('   - The sandbox persists during the session');
  console.log('   - Generated projects are saved to the sandbox');
  console.log('   - All Claude Code responses are logged');
  console.log('   - Mock services are used when APIs are not available');
  console.log('');
}

// Run the demo
runDemo().catch(console.error);
