#!/usr/bin/env bun
/**
 * Configuration Helper
 * 
 * Creates .env file from template with provided API key
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const OPENAI_KEY = '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';

async function main() {
  console.log('⚙️  Configuring Crucible environment...');
  
  const template = await readFile('env.template', 'utf-8');
  
  // Replace placeholder with actual API key
  const envContent = template.replace(
    'OPENAI_API_KEY=',
    `OPENAI_API_KEY=${OPENAI_KEY}`
  );
  
  await writeFile('.env', envContent);
  
  console.log('✅ Created .env file with OpenAI API key');
  console.log('');
  console.log('Next steps:');
  console.log('  1. bun run agents:fund');
  console.log('  2. docker-compose -f docker/docker-compose.yml up -d');
}

main().catch(console.error);

