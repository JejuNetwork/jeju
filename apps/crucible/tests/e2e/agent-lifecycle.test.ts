import { describe, test, expect } from 'bun:test';
import { AgentRuntime, type Character } from '@elizaos/core';
import { PGLiteDatabaseAdapter } from '@elizaos/plugin-sql';
import { bootstrapPlugin } from '@elizaos/plugin-bootstrap';
import { cruciblePlugin } from '../../packages/plugin-crucible/src/index';

/**
 * E2E Tests: Agent Lifecycle
 * 
 * Tests complete agent creation, initialization, and shutdown
 */

describe('Agent Lifecycle E2E', () => {
  test('can create and initialize a hacker agent runtime', async () => {
    const character: Character = {
      name: 'TestHacker',
      bio: ['Test hacker agent'],
      system: 'You are a test security agent',
      messageExamples: [],
      topics: ['testing'],
      style: {
        all: ['Be concise'],
        chat: ['Be helpful']
      },
      settings: {
        model: 'gpt-3.5-turbo',
        temperature: 0.3,
        secrets: {
          AGENT_TYPE: 'hacker',
          STAKE_TIER: 'SMALL',
          REDTEAM_PRIVATE_KEY: process.env.HACKER_WALLET_1,
          JEJU_L2_RPC: 'http://127.0.0.1:9545',
          GUARDIAN_ADDRESS_LOCALNET: process.env.GUARDIAN_ADDRESS_LOCALNET,
          IDENTITY_REGISTRY: process.env.IDENTITY_REGISTRY,
          REPUTATION_REGISTRY: process.env.REPUTATION_REGISTRY
        }
      },
      plugins: []
    };

    // Create database adapter
    const db = new PGLiteDatabaseAdapter({
      dataDir: './data/test-agent'
    });
    await db.init();

    // Create runtime
    const runtime = new AgentRuntime({
      character,
      databaseAdapter: db,
      plugins: [bootstrapPlugin, cruciblePlugin]
    });

    // Initialize
    await runtime.initialize();
    expect(runtime).toBeDefined();
    expect(runtime.character.name).toBe('TestHacker');

    // Verify plugins loaded
    const actions = runtime.actions;
    expect(actions.length).toBeGreaterThan(0);
    
    // Should have REGISTER_TO_NETWORK action from registry plugin
    const registerAction = actions.find(a => a.name === 'REGISTER_TO_NETWORK');
    expect(registerAction).toBeDefined();

    // Start runtime
    await runtime.start();
    
    // Stop runtime
    await runtime.stop();

    console.log('✅ Agent lifecycle test passed');
  }, 30000); // 30 second timeout for initialization

  test('can load character from JSON file', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const characterPath = path.join(process.cwd(), 'characters', 'hacker.json');
    const characterData = await fs.readFile(characterPath, 'utf-8');
    const character = JSON.parse(characterData);

    expect(character).toHaveProperty('name');
    expect(character).toHaveProperty('bio');
    expect(character).toHaveProperty('system');
    expect(character).toHaveProperty('plugins');
    expect(Array.isArray(character.plugins)).toBe(true);
  });
});

