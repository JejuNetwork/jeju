#!/usr/bin/env bun
/**
 * Configuration Helper
 * 
 * Validates environment configuration and creates .env from template if needed
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';

async function main() {
  console.log('⚙️  Configuring Crucible environment...');
  
  // Check if .env already exists
  try {
    await access('.env', constants.F_OK);
    console.log('✓ .env file already exists');
    
    // Load and validate required variables
    const envContent = await readFile('.env', 'utf-8');
    const hasOpenAIKey = envContent.includes('OPENAI_API_KEY=') && 
                         !envContent.match(/OPENAI_API_KEY=\s*$/m);
    
    if (!hasOpenAIKey) {
      console.log('⚠️  OPENAI_API_KEY is not set in .env');
      console.log('   Please add your OpenAI API key to .env file');
    } else {
      console.log('✓ OPENAI_API_KEY is configured');
    }
  } catch {
    // .env doesn't exist, create from template
    console.log('Creating .env from template...');
    
    try {
      const template = await readFile('env.template', 'utf-8');
      await writeFile('.env', template);
      console.log('✅ Created .env file from template');
      console.log('');
      console.log('⚠️  Important: Add your OpenAI API key to .env file');
      console.log('   OPENAI_API_KEY=your-key-here');
    } catch (error) {
      console.error('❌ Failed to create .env from template:', error);
      throw error;
    }
  }
  
  console.log('');
  console.log('Next steps:');
  console.log('  1. Ensure OPENAI_API_KEY is set in .env');
  console.log('  2. bun run agents:fund');
  console.log('  3. docker-compose -f docker/docker-compose.yml up -d');
}

main().catch(console.error);

