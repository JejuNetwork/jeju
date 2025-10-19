import {
  AgentRuntime,
  type IAgentRuntime,
  type UUID,
  type Character,
  type Plugin,
  elizaLogger,
  type IDatabaseAdapter,
} from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import formsPlugin from '../../../../plugin-forms/src';
import sqlPlugin from '../../../../plugin-sql/src';

export interface TestRuntimeOptions {
  character?: Partial<Character>;
  plugins?: Plugin[];
  environment?: Record<string, string>;
  databasePath?: string;
}

export interface TestRuntimeResult {
  runtime: IAgentRuntime;
  cleanup: () => Promise<void>;
}

/**
 * Create a real runtime instance for testing
 */
export async function createRealTestRuntime(
  options: TestRuntimeOptions = {}
): Promise<TestRuntimeResult> {
  const {
    character = {},
    plugins = [],
    environment = {},
    databasePath = `.test-db-${Date.now()}`,
  } = options;

  // Set up environment
  Object.entries(environment).forEach(([key, value]) => {
    process.env[key] = value;
  });

  // Set test mode
  process.env.ELIZA_TEST_MODE = 'true';
  process.env.SECRET_SALT = process.env.SECRET_SALT || 'test-salt-for-testing-only';
  process.env.DATABASE_PATH = databasePath;

  // Create test database directory
  const dbDir = path.resolve(databasePath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Create character with defaults
  const testCharacter: Character = {
    name: character.name || 'TestAgent',
    bio: character.bio || ['A test agent for automated testing'],
    system: character.system || 'You are a test agent for automated testing.',
    settings: {
      model: 'gpt-4o-mini',
      modelVendor: 'openai',
      ...(character.settings || {}),
    },
    secrets: character.secrets || {},
    plugins: character.plugins || [],
    knowledge: character.knowledge || [],
    messageExamples: character.messageExamples || [],
    style: character.style || {},
    topics: character.topics || [],
    adjectives: character.adjectives || [],
    ...character,
  };

  // Create runtime
  const runtime = new AgentRuntime({
    agentId: uuidv4() as UUID,
    character: testCharacter,
    plugins: [sqlPlugin, formsPlugin, ...plugins],
  });

  // Override getSetting to use test environment
  const originalGetSetting = runtime.getSetting;
  runtime.getSetting = (key: string) => {
    // Check test environment first
    if (key in environment) {
      return environment[key];
    }
    // Then check process.env
    if (process.env[key]) {
      return process.env[key];
    }
    // Then check character settings
    if (testCharacter.settings?.[key]) {
      return testCharacter.settings[key];
    }
    // Finally use original getSetting
    return originalGetSetting.call(runtime, key);
  };

  // Initialize runtime
  await runtime.initialize();

  // Set up cleanup function
  const cleanup = async () => {
    elizaLogger.info('Cleaning up test runtime...');

    // Stop runtime
    await runtime.stop();

    // Clean up test database
    if (existsSync(dbDir)) {
      rmSync(dbDir, { recursive: true, force: true });
    }

    // Clean up environment
    Object.keys(environment).forEach((key) => {
      delete process.env[key];
    });
    delete process.env.ELIZA_TEST_MODE;
  };

  return {
    runtime,
    cleanup,
  };
}
